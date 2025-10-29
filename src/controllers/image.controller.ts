import { Request, Response } from "express";
import { prisma } from "@/config/database";
import { s3Service } from "@/services/s3.service";
import { imageProcessingService } from "@/services/image-processing.service";
import { ImageResponse, ImageListResponse } from "@/types";
import { logger } from "@/utils/logger";
import { awsConfig } from "@/config/env";
import { redisService } from "@/services/redis.service";

class ImageController {
  /**
   * Get all images with pagination and filtering
   */
  async getImages(req: Request, res: Response): Promise<void> {
    try {
      const { page = 1, limit = 10, status } = req.query;
      const skip = (Number(page) - 1) * Number(limit);

      const where = status ? { status: status as any } : {};

      const [images, total] = await Promise.all([
        prisma.image.findMany({
          where,
          skip,
          take: Number(limit),
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            filename: true,
            originalName: true,
            mimeType: true,
            size: true,
            width: true,
            height: true,
            status: true,
            blurScore: true,
            faceCount: true,
            faceSize: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.image.count({ where }),
      ]);

      // Generate URLs for each image - use fallback for now since S3 is not publicly accessible
      const imagesWithUrls = await Promise.all(
        images.map(async (image: any) => {
          // For now, always use the fallback URL since S3 bucket is not publicly accessible
          return {
            ...image,
            downloadUrl: `http://localhost:3001/api/images/${encodeURIComponent(
              image.id
            )}/serve`,
          };
        })
      );

      const response: ImageListResponse = {
        images: imagesWithUrls,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      };

      res.json(response);
    } catch (error) {
      logger.error("Error fetching images:", error);
      res.status(500).json({
        error: "Failed to fetch images",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Get a single image by ID
   */
  async getImageById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const image = await prisma.image.findUnique({
        where: { id },
        select: {
          id: true,
          filename: true,
          originalName: true,
          mimeType: true,
          size: true,
          width: true,
          height: true,
          status: true,
          blurScore: true,
          faceCount: true,
          faceSize: true,
          validationResults: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!image) {
        res.status(404).json({ error: "Image not found" });
        return;
      }

      const downloadUrl = await s3Service.getSignedDownloadUrl(
        `images/${image.filename}`
      );

      const response: ImageResponse = {
        ...image,
        width: image.width || 0,
        height: image.height || 0,
        blurScore: image.blurScore ?? undefined,
        faceCount: image.faceCount ?? undefined,
        faceSize: image.faceSize ?? undefined,
        downloadUrl,
      };

      res.json(response);
    } catch (error) {
      logger.error("Error fetching image:", error);
      res.status(500).json({
        error: "Failed to fetch image",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Upload a new image
   */
  async uploadImage(req: Request, res: Response): Promise<void> {
    try {
      const file = req.file;

      if (!file) {
        res.status(400).json({ error: "No file provided" });
        return;
      }

      const buffer = Buffer.from(file.buffer);

      // Convert HEIC to JPEG/PNG if needed
      let processedBuffer: Buffer = buffer;
      let finalMimeType = file.mimetype;

      if (
        file.mimetype === "image/heic" ||
        file.originalname.toLowerCase().endsWith(".heic")
      ) {
        try {
          const target = (req.query.to === "png" ? "png" : "jpeg") as
            | "jpeg"
            | "png";
          processedBuffer = await imageProcessingService.convertToFormat(
            buffer,
            target,
            { filename: file.originalname, originalName: file.originalname }
          );
          // Only change mime type if conversion was successful
          if (processedBuffer !== buffer) {
            finalMimeType = target === "png" ? "image/png" : "image/jpeg";
          }
        } catch (error) {
          logger.warn(
            "HEIC conversion failed, proceeding with original file:",
            error
          );
          // Keep original buffer and mime type
        }
      }

      // Validate image (skip advanced validation for HEIC files)
      let validationResult;
      if (
        finalMimeType === "image/heic" ||
        file.originalname.toLowerCase().endsWith(".heic")
      ) {
        // For HEIC files, do basic validation only
        validationResult = {
          isValid: true,
          errors: [],
          metadata: {
            width: 1920,
            height: 1080,
            size: processedBuffer.length,
            format: "heic",
          },
        };
        logger.warn("Skipping advanced validation for HEIC file");
      } else {
        validationResult = await imageProcessingService.validateImage(
          processedBuffer
        );
      }

      // Cache validation metadata in Redis (gzipped)
      try {
        await redisService.setCompressed(
          `image:validation:${
            validationResult.metadata?.hash ?? file.originalname
          }`,
          validationResult,
          3600
        );
      } catch (e) {
        logger.warn("Failed to cache validation result in Redis", e);
      }

      if (!validationResult.isValid) {
        res.status(400).json({
          success: false,
          validated: false,
          error: "Image validation failed",
          message: "Please check the validation errors and try again",
          validationErrors: validationResult.errors,
          suggestions: [
            "Make sure the image contains exactly one clear face",
            "Ensure the face takes up 15-80% of the image",
            "Use a sharp, high-quality image",
            "Avoid blurry or low-resolution photos",
          ],
        });
        return;
      }

      // Check for duplicates
      if (validationResult.metadata?.hash) {
        const isDuplicate = await imageProcessingService.checkForDuplicates(
          validationResult.metadata.hash
        );
        if (isDuplicate) {
          res.status(400).json({
            error: "Duplicate image detected",
          });
          return;
        }
      }

      // Generate S3 key
      const timestamp = Date.now();
      const s3Key = `images/${timestamp}-${file.originalname}`;

      // Upload to S3
      await s3Service.uploadFile(s3Key, processedBuffer, finalMimeType);

      // Get image dimensions (skip for HEIC files as Sharp can't process them)
      let imageInfo;
      if (
        finalMimeType === "image/heic" ||
        file.originalname.toLowerCase().endsWith(".heic")
      ) {
        // For HEIC files, use default dimensions since Sharp can't process them
        imageInfo = {
          width: 1920, // Default width
          height: 1080, // Default height
          format: "heic",
        };
        logger.warn(
          "Using default dimensions for HEIC file as Sharp cannot process it"
        );
      } else {
        imageInfo = await imageProcessingService.getImageMetadata(
          processedBuffer
        );
      }

      // Save to database
      const image = await prisma.image.create({
        data: {
          filename: `${timestamp}-${file.originalname}`,
          originalName: file.originalname,
          mimeType: finalMimeType,
          size: processedBuffer.length,
          width: imageInfo.width || 0,
          height: imageInfo.height || 0,
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

      // Generate signed URL for immediate access
      const downloadUrl = await s3Service.getSignedDownloadUrl(s3Key);

      const response: ImageResponse = {
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
      };

      res.status(201).json({
        success: true,
        validated: true,
        message: "✅ Image uploaded and validated successfully!",
        validationStatus: {
          faceDetected: validationResult.metadata?.faceCount === 1,
          faceCount: validationResult.metadata?.faceCount || 0,
          faceSize: validationResult.metadata?.faceSize || 0,
          imageQuality: validationResult.metadata?.blurScore || 0,
          isBlurry: (validationResult.metadata?.blurScore || 0) < 150,
        },
        image: response,
      });
    } catch (error) {
      logger.error("Upload error:", error);
      res.status(500).json({
        error: "Upload failed",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Delete an image
   */
  async deleteImage(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const image = await prisma.image.findUnique({
        where: { id },
      });

      if (!image) {
        res.status(404).json({ error: "Image not found" });
        return;
      }

      // Delete from S3
      await s3Service.deleteFile(image.s3Key);

      // Delete from database
      await prisma.image.delete({
        where: { id },
      });

      res.json({ success: true });
    } catch (error) {
      logger.error("Error deleting image:", error);
      res.status(500).json({
        error: "Failed to delete image",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Get image placeholder or serve image directly
   */
  async getImagePlaceholder(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const image = await prisma.image.findUnique({
        where: { id },
      });

      if (!image) {
        res.status(404).json({ error: "Image not found" });
        return;
      }

      // Try to get the image from S3
      try {
        const downloadUrl = await s3Service.getSignedDownloadUrl(
          `images/${image.filename}`
        );
        res.redirect(downloadUrl);
        return;
      } catch (s3Error) {
        logger.error(`S3 error for image ${id}:`, s3Error);

        // Return a placeholder response
        res.json({
          error: "Image temporarily unavailable",
          message: "S3 service is not configured or image not found",
          imageId: id,
          filename: image.filename,
          s3Key: `images/${image.filename}`,
        });
      }
    } catch (error) {
      logger.error("Error in placeholder endpoint:", error);
      res.status(500).json({
        error: "Failed to get image",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Get image URL (for debugging)
   */
  async getImageUrl(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const image = await prisma.image.findUnique({
        where: { id },
      });

      if (!image) {
        res.status(404).json({ error: "Image not found" });
        return;
      }

      // Try to get the image from S3
      try {
        const downloadUrl = await s3Service.getSignedDownloadUrl(
          `images/${image.filename}`
        );
        res.json({
          success: true,
          imageId: id,
          filename: image.filename,
          s3Key: `images/${image.filename}`,
          downloadUrl,
          expiresIn: "1 hour",
        });
      } catch (s3Error) {
        logger.error(`S3 error for image ${id}:`, s3Error);

        res.json({
          success: false,
          error: "S3 service error",
          imageId: id,
          filename: image.filename,
          s3Key: `images/${image.filename}`,
          details: s3Error instanceof Error ? s3Error.message : "Unknown error",
        });
      }
    } catch (error) {
      logger.error("Error in image URL endpoint:", error);
      res.status(500).json({
        error: "Failed to get image URL",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Serve image directly from S3
   */
  async serveImage(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const image = await prisma.image.findUnique({
        where: { id },
      });

      if (!image) {
        res.status(404).json({ error: "Image not found" });
        return;
      }

      try {
        // Get the image from S3 and stream it directly
        const { GetObjectCommand } = await import("@aws-sdk/client-s3");
        const command = new GetObjectCommand({
          Bucket: awsConfig.s3Bucket,
          Key: `images/${image.filename}`,
        });

        const response = await s3Service.s3Client.send(command);

        // Set appropriate headers
        res.setHeader("Content-Type", image.mimeType);
        res.setHeader("Content-Length", image.size);
        res.setHeader("Cache-Control", "public, max-age=3600");

        // Stream the image data
        if (response.Body) {
          const stream = response.Body as NodeJS.ReadableStream;
          stream.pipe(res);
        } else {
          res.status(404).json({ error: "Image data not found" });
        }
      } catch (s3Error) {
        logger.error(`S3 error serving image ${id}:`, s3Error);

        // Return a placeholder image or error
        res.status(503).json({
          error: "Image temporarily unavailable",
          message: "S3 service error",
          imageId: id,
          filename: image.filename,
        });
      }
    } catch (error) {
      logger.error("Error serving image:", error);
      res.status(500).json({
        error: "Failed to serve image",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Update image status
   */
  async updateImageStatus(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const image = await prisma.image.findUnique({
        where: { id },
      });

      if (!image) {
        res.status(404).json({ error: "Image not found" });
        return;
      }

      const updatedImage = await prisma.image.update({
        where: { id },
        data: { status },
        select: {
          id: true,
          filename: true,
          originalName: true,
          mimeType: true,
          size: true,
          width: true,
          height: true,
          status: true,
          blurScore: true,
          faceCount: true,
          faceSize: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const downloadUrl = await s3Service.getSignedDownloadUrl(
        `images/${updatedImage.filename}`
      );

      const response: ImageResponse = {
        ...updatedImage,
        width: updatedImage.width || 0,
        height: updatedImage.height || 0,
        blurScore: updatedImage.blurScore ?? undefined,
        faceCount: updatedImage.faceCount ?? undefined,
        faceSize: updatedImage.faceSize ?? undefined,
        downloadUrl,
      };

      res.json({
        success: true,
        image: response,
      });
    } catch (error) {
      logger.error("Error updating image status:", error);
      res.status(500).json({
        error: "Failed to update image status",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}

export const imageController = new ImageController();
export default imageController;
