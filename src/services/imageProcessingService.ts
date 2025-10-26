import sharp from "sharp";
import crypto from "node:crypto";
import {
  RekognitionClient,
  DetectFacesCommand,
} from "@aws-sdk/client-rekognition";
import { awsConfig, imageConfig } from "@/config/env";
import { prisma } from "@/config/database";
import { ValidationResult, ImageMetadata } from "@/types";
import { logger } from "@/utils/logger";

class ImageProcessingService {
  private rekognitionClient: RekognitionClient;

  constructor() {
    this.rekognitionClient = new RekognitionClient({
      region: awsConfig.region,
      credentials: {
        accessKeyId: awsConfig.accessKeyId,
        secretAccessKey: awsConfig.secretAccessKey,
      },
    });
  }

  /**
   * Validate an image buffer
   */
  async validateImage(buffer: Buffer): Promise<ValidationResult> {
    const errors: string[] = [];
    let metadata: ImageMetadata = {
      width: 0,
      height: 0,
      size: 0,
      format: "unknown",
    };

    try {
      // Get image metadata
      const imageInfo = await sharp(buffer).metadata();
      metadata = {
        width: imageInfo.width || 0,
        height: imageInfo.height || 0,
        size: buffer.length,
        format: imageInfo.format || "unknown",
      };

      // 1. Check minimum size/resolution
      if (
        metadata.width < imageConfig.minWidth ||
        metadata.height < imageConfig.minHeight
      ) {
        errors.push(
          `Image too small. Minimum size: ${imageConfig.minWidth}x${imageConfig.minHeight}, got: ${metadata.width}x${metadata.height}`
        );
      }

      // 2. Check maximum size/resolution
      if (
        metadata.width > imageConfig.maxWidth ||
        metadata.height > imageConfig.maxHeight
      ) {
        errors.push(
          `Image too large. Maximum size: ${imageConfig.maxWidth}x${imageConfig.maxHeight}, got: ${metadata.width}x${metadata.height}`
        );
      }

      // 3. Check file format
      const allowedFormats = ["jpeg", "jpg", "png", "heic"];
      if (!allowedFormats.includes(metadata.format.toLowerCase())) {
        errors.push(
          `Invalid format. Allowed: ${allowedFormats.join(", ")}, got: ${
            metadata.format
          }`
        );
      }

      // Special handling for HEIC files - skip advanced validation
      if (
        metadata.format.toLowerCase() === "heic" ||
        metadata.format.toLowerCase() === "heif"
      ) {
        logger.warn("HEIC file detected - skipping advanced validation");
        return {
          isValid: errors.length === 0,
          errors,
          metadata: {
            width: metadata.width,
            height: metadata.height,
            size: metadata.size,
            format: metadata.format,
            // Skip blur and face detection for HEIC files
          },
        };
      }

      // 4. Check file size
      if (metadata.size > imageConfig.maxFileSize) {
        errors.push(
          `File too large. Maximum size: ${imageConfig.maxFileSize} bytes, got: ${metadata.size}`
        );
      }

      // 5. Check for blur using Laplacian variance
      try {
        const blurScore = await this.calculateBlurScore(buffer);
        metadata.blurScore = blurScore;

        if (blurScore < 150) {
          // Stricter threshold for blur detection
          errors.push(
            `❌ Image appears to be blurry (blur score: ${blurScore.toFixed(
              2
            )}). Please upload a clear, sharp image.`
          );
        } else {
          logger.info(
            `✅ Image quality validation passed: Blur score=${blurScore.toFixed(
              2
            )}`
          );
        }
      } catch (blurError) {
        logger.warn(
          "Blur detection failed, skipping blur validation:",
          blurError
        );
        // Don't fail validation if blur detection fails
        metadata.blurScore = 150; // Assume good quality if detection fails
      }

      // 6. Face detection using AWS Rekognition
      try {
        const faceData = await this.detectFaces(buffer);
        metadata.faceCount = faceData.faceCount;
        metadata.faceSize = faceData.faceSize;

        // Strict face validation rules
        if (faceData.faceCount === 0) {
          errors.push(
            "❌ No face detected in the image. Please upload an image with a clear face."
          );
        } else if (faceData.faceCount > 1) {
          errors.push(
            `❌ Multiple faces detected (${faceData.faceCount}). Only one face is allowed. Please crop the image to show only one person.`
          );
        } else if (faceData.faceSize < 0.15) {
          // Face should be at least 15% of image (increased from 10%)
          errors.push(
            `❌ Face too small relative to image (${(
              faceData.faceSize * 100
            ).toFixed(
              1
            )}%). Please upload a closer photo where the face takes up more of the image.`
          );
        } else if (faceData.faceSize > 0.8) {
          // Face shouldn't be too large either
          errors.push(
            `❌ Face too large relative to image (${(
              faceData.faceSize * 100
            ).toFixed(
              1
            )}%). Please upload a photo with some background visible.`
          );
        } else {
          // Face validation passed
          logger.info(
            `✅ Face validation passed: Count=${faceData.faceCount}, Size=${(
              faceData.faceSize * 100
            ).toFixed(1)}%`
          );
        }
      } catch (faceError) {
        logger.error("Face detection failed:", faceError);
        // Fail validation if face detection fails - this is important for security
        errors.push(
          "❌ Face detection service unavailable. Please try again later."
        );
        metadata.faceCount = 0;
        metadata.faceSize = 0;
      }

      // 7. Generate hash for duplicate detection
      metadata.hash = this.generateImageHash(buffer);

      return {
        isValid: errors.length === 0,
        errors,
        metadata,
      };
    } catch (error) {
      logger.error("Error validating image:", error);
      return {
        isValid: false,
        errors: [
          `Image processing error: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        ],
        metadata,
      };
    }
  }

  /**
   * Convert HEIC image to JPEG
   */
  async convertHeicToJpeg(buffer: Buffer): Promise<Buffer> {
    try {
      // For HEIC files, Sharp cannot process them without special build
      // So we'll return the original buffer and let the frontend handle it
      logger.warn(
        "HEIC file detected - Sharp cannot process HEIC files. Returning original buffer."
      );
      logger.info(
        "HEIC files will be stored as-is and should be handled by the frontend for display."
      );

      // Return the original buffer - the frontend will need to handle HEIC display
      return buffer;
    } catch (error) {
      logger.error("Error in HEIC conversion:", error);

      // If anything fails, return the original buffer
      logger.warn("HEIC conversion failed, returning original buffer");
      return buffer;
    }
  }

  /**
   * Check for duplicate images
   */
  async checkForDuplicates(hash: string): Promise<boolean> {
    try {
      const existingImage = await prisma.image.findFirst({
        where: { hash },
      });

      return !!existingImage;
    } catch (error) {
      logger.error("Error checking for duplicates:", error);
      return false;
    }
  }

  /**
   * Calculate blur score using Laplacian variance
   */
  private async calculateBlurScore(buffer: Buffer): Promise<number> {
    try {
      // Convert to grayscale and apply Laplacian filter
      const grayscale = await sharp(buffer).grayscale().raw().toBuffer();

      const imageInfo = await sharp(buffer).metadata();
      const width = imageInfo.width || 0;
      const height = imageInfo.height || 0;

      let variance = 0;
      let mean = 0;
      let count = 0;

      // Calculate Laplacian variance
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          const laplacian =
            grayscale[idx - width] +
            grayscale[idx + width] +
            grayscale[idx - 1] +
            grayscale[idx + 1] -
            4 * grayscale[idx];

          mean += laplacian;
          count++;
        }
      }

      mean /= count;

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          const laplacian =
            grayscale[idx - width] +
            grayscale[idx + width] +
            grayscale[idx - 1] +
            grayscale[idx + 1] -
            4 * grayscale[idx];

          variance += Math.pow(laplacian - mean, 2);
        }
      }

      return variance / count;
    } catch (error) {
      logger.error("Error calculating blur score:", error);
      return 0;
    }
  }

  /**
   * Detect faces using AWS Rekognition
   */
  public async detectFaces(
    buffer: Buffer
  ): Promise<{ faceCount: number; faceSize: number }> {
    try {
      logger.info("Calling AWS Rekognition detectFaces...");
      const command = new DetectFacesCommand({
        Image: {
          Bytes: buffer,
        },
        Attributes: ["ALL"],
      });

      const response = await this.rekognitionClient.send(command);
      const faces = response.FaceDetails || [];

      logger.info(`AWS Rekognition returned ${faces.length} faces`);

      let maxFaceSize = 0;
      for (const face of faces) {
        if (face.BoundingBox) {
          const faceSize =
            (face.BoundingBox.Width || 0) * (face.BoundingBox.Height || 0);
          maxFaceSize = Math.max(maxFaceSize, faceSize);
          logger.info(
            `Face bounding box: Width=${face.BoundingBox.Width}, Height=${face.BoundingBox.Height}, Size=${faceSize}`
          );
        }
      }

      const result = {
        faceCount: faces.length,
        faceSize: maxFaceSize,
      };

      logger.info(`Face detection result: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      logger.error("Error detecting faces:", error);
      logger.error("Face detection error details:", {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : "Unknown",
      });
      return { faceCount: 0, faceSize: 0 };
    }
  }

  /**
   * Generate hash for duplicate detection
   */
  private generateImageHash(buffer: Buffer): string {
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }

  /**
   * Get image dimensions and metadata
   */
  async getImageMetadata(
    buffer: Buffer
  ): Promise<{ width: number; height: number; format: string }> {
    try {
      const metadata = await sharp(buffer).metadata();
      return {
        width: metadata.width || 0,
        height: metadata.height || 0,
        format: metadata.format || "unknown",
      };
    } catch (error) {
      logger.error("Error getting image metadata:", error);
      throw new Error(
        `Failed to get image metadata: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}

export const imageProcessingService = new ImageProcessingService();
export default imageProcessingService;
