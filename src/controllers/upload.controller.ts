import { Request, Response } from "express";
import { prisma } from "@/config/database";
import { s3Service } from "@/services/s3.service";
import { imageProcessingService } from "@/services/image-processing.service";
import { ChunkUploadRequest, ChunkUploadResponse } from "@/types";
import { logger } from "@/utils/logger";

// In-memory storage for chunks (in production, use Redis or database)
const chunkStorage = new Map<string, Buffer[]>();

class ChunkedUploadController {
  /**
   * Handle chunked upload
   */
  async uploadChunk(req: Request, res: Response): Promise<void> {
    try {
      const {
        sessionId,
        filename,
        mimeType,
        totalChunks,
        chunkIndex,
        chunkData,
      }: ChunkUploadRequest = req.body;

      // Create or get session
      let session = sessionId
        ? await prisma.uploadSession.findUnique({
            where: { id: sessionId },
          })
        : null;

      if (!session) {
        session = await prisma.uploadSession.create({
          data: {
            filename,
            totalChunks,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
          },
        });
      }

      // Decode and store chunk
      const chunkBuffer = Buffer.from(chunkData, "base64");

      if (!chunkStorage.has(session.id)) {
        chunkStorage.set(session.id, new Array(totalChunks));
      }

      const chunks = chunkStorage.get(session.id)!;
      chunks[chunkIndex] = chunkBuffer;

      // Update session progress
      await prisma.uploadSession.update({
        where: { id: session.id },
        data: {
          uploadedChunks: chunkIndex + 1,
        },
      });

      // Check if all chunks are uploaded
      const allChunksReceived = chunks.every((chunk) => chunk !== undefined);

      if (allChunksReceived) {
        try {
          // Combine all chunks
          const completeBuffer = Buffer.concat(chunks);

          // Convert HEIC to JPEG/PNG if needed
          let processedBuffer: Buffer = completeBuffer;
          let finalMimeType = mimeType;

          if (
            mimeType === "image/heic" ||
            filename.toLowerCase().endsWith(".heic")
          ) {
            const target = "jpeg";
            processedBuffer = await imageProcessingService.convertToFormat(
              completeBuffer,
              target,
              { filename, originalName: filename }
            );
            if (processedBuffer !== completeBuffer) {
              finalMimeType = "image/jpeg";
            }
          }

          // Validate image
          const validationResult = await imageProcessingService.validateImage(
            processedBuffer
          );

          if (!validationResult.isValid) {
            // Clean up session and chunks
            await prisma.uploadSession.update({
              where: { id: session.id },
              data: { status: "FAILED" },
            });
            chunkStorage.delete(session.id);

            res.status(400).json({
              error: "Image validation failed",
              details: validationResult.errors,
            });
            return;
          }

          // Check for duplicates
          if (validationResult.metadata?.hash) {
            const isDuplicate = await imageProcessingService.checkForDuplicates(
              validationResult.metadata.hash
            );
            if (isDuplicate) {
              await prisma.uploadSession.update({
                where: { id: session.id },
                data: { status: "FAILED" },
              });
              chunkStorage.delete(session.id);

              res.status(400).json({
                error: "Duplicate image detected",
              });
              return;
            }
          }

          // Generate S3 key
          const timestamp = Date.now();
          const s3Key = `images/${timestamp}-${filename}`;

          // Upload to S3
          await s3Service.uploadFile(s3Key, processedBuffer, finalMimeType);

          // Get image dimensions
          const imageInfo = await imageProcessingService.getImageMetadata(
            processedBuffer
          );

          // Save to database
          const image = await prisma.image.create({
            data: {
              filename: `${timestamp}-${filename}`,
              originalName: filename,
              mimeType: finalMimeType,
              size: processedBuffer.length,
              width: imageInfo.width,
              height: imageInfo.height,
              s3Key,
              status: "VALIDATED",
              hash: validationResult.metadata?.hash,
              blurScore: validationResult.metadata?.blurScore,
              faceCount: validationResult.metadata?.faceCount,
              faceSize: validationResult.metadata?.faceSize,
              validationResults: {
                isValid: validationResult.isValid,
                errors: validationResult.errors,
              },
            },
          });

          // Update session as completed
          await prisma.uploadSession.update({
            where: { id: session.id },
            data: {
              status: "COMPLETED",
              s3Key,
            },
          });

          // Clean up chunks
          chunkStorage.delete(session.id);

          // Generate signed URL
          const downloadUrl = await s3Service.getSignedDownloadUrl(s3Key);

          const response: ChunkUploadResponse = {
            success: true,
            completed: true,
            image: {
              id: image.id,
              filename: image.filename,
              originalName: image.originalName,
              mimeType: image.mimeType,
              size: image.size,
              width: image.width || 0,
              height: image.height || 0,
              status: image.status,
              blurScore: image.blurScore ?? undefined,
              faceCount: image.faceCount ?? undefined,
              faceSize: image.faceSize ?? undefined,
              downloadUrl,
              createdAt: image.createdAt,
              updatedAt: image.updatedAt,
            },
          };

          res.json(response);
        } catch (error) {
          // Mark session as failed
          await prisma.uploadSession.update({
            where: { id: session.id },
            data: { status: "FAILED" },
          });
          chunkStorage.delete(session.id);

          logger.error("Error processing completed chunks:", error);
          res.status(500).json({
            error: "Failed to process image",
            details: error instanceof Error ? error.message : "Unknown error",
          });
        }
      } else {
        const response: ChunkUploadResponse = {
          success: true,
          completed: false,
          sessionId: session.id,
          progress: {
            uploaded: chunkIndex + 1,
            total: totalChunks,
            percentage: Math.round(((chunkIndex + 1) / totalChunks) * 100),
          },
        };

        res.json(response);
      }
    } catch (error) {
      logger.error("Chunked upload error:", error);
      res.status(500).json({
        error: "Chunked upload failed",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Get upload session status
   */
  async getSessionStatus(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;

      const session = await prisma.uploadSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const progress = {
        uploaded: session.uploadedChunks,
        total: session.totalChunks,
        percentage: Math.round(
          (session.uploadedChunks / session.totalChunks) * 100
        ),
      };

      res.json({
        success: true,
        session: {
          id: session.id,
          filename: session.filename,
          status: session.status,
          progress,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        },
      });
    } catch (error) {
      logger.error("Error getting session status:", error);
      res.status(500).json({
        error: "Failed to get session status",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Cancel upload session
   */
  async cancelSession(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;

      const session = await prisma.uploadSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      // Update session status
      await prisma.uploadSession.update({
        where: { id: sessionId },
        data: { status: "FAILED" },
      });

      // Clean up chunks
      chunkStorage.delete(sessionId);

      res.json({ success: true });
    } catch (error) {
      logger.error("Error canceling session:", error);
      res.status(500).json({
        error: "Failed to cancel session",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Clean up expired sessions (should be called periodically)
   */
  async cleanupExpiredSessions(): Promise<void> {
    try {
      const expiredSessions = await prisma.uploadSession.findMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
          status: {
            in: ["IN_PROGRESS", "FAILED"],
          },
        },
      });

      for (const session of expiredSessions) {
        // Clean up chunks
        chunkStorage.delete(session.id);

        // Update session status
        await prisma.uploadSession.update({
          where: { id: session.id },
          data: { status: "EXPIRED" },
        });
      }

      logger.info(`Cleaned up ${expiredSessions.length} expired sessions`);
    } catch (error) {
      logger.error("Error cleaning up expired sessions:", error);
    }
  }
}

export const chunkedUploadController = new ChunkedUploadController();
export default chunkedUploadController;
