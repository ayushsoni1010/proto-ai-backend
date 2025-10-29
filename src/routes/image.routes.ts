import { Router } from "express";
import multer from "multer";
import { imageController } from "@/controllers/image.controller";
import { chunkedUploadController } from "@/controllers/upload.controller";
import {
  validateChunkUpload,
  validateImageId,
  validateImageListQuery,
  validateFileUpload,
} from "@/middleware/validation.middleware";

const router = Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/heic",
    ];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only JPEG, PNG, and HEIC images are allowed."
        )
      );
    }
  },
});

// Image routes
router.get("/", validateImageListQuery, imageController.getImages);
router.get("/:id", validateImageId, imageController.getImageById);
router.get(
  "/:id/placeholder",
  validateImageId,
  imageController.getImagePlaceholder
);
router.get("/:id/url", validateImageId, imageController.getImageUrl);
router.get("/:id/serve", validateImageId, imageController.serveImage);
router.post(
  "/upload",
  upload.single("file"),
  validateFileUpload,
  imageController.uploadImage
);
router.delete("/:id", validateImageId, imageController.deleteImage);
router.patch("/:id/status", validateImageId, imageController.updateImageStatus);

// Chunked upload routes
router.post(
  "/chunked-upload",
  validateChunkUpload,
  chunkedUploadController.uploadChunk
);
router.get(
  "/chunked-upload/:sessionId/status",
  chunkedUploadController.getSessionStatus
);
router.delete(
  "/chunked-upload/:sessionId",
  chunkedUploadController.cancelSession
);

// Test endpoint for face detection
router.post(
  "/test-face-detection",
  upload.single("file"),
  async (req, res): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file provided" });
        return;
      }

      const { imageProcessingService } = await import(
        "@/services/image-processing.service"
      );
      const buffer = Buffer.from(req.file.buffer);

      // Test face detection directly
      const faceData = await (imageProcessingService as any).detectFaces(
        buffer
      );

      res.json({
        success: true,
        faceDetection: faceData,
        message: "Face detection test completed",
      });
    } catch (error) {
      res.status(500).json({
        error: "Face detection test failed",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

export default router;
