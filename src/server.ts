import express from "express";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import { serverConfig } from "@/config/env";
import {
  rateLimiter,
  corsOptions,
  requestLogger,
  errorHandler,
  notFoundHandler,
} from "@/middleware/security.middleware";
import imageRoutes from "@/routes/image.routes";
import { logger } from "@/utils/logger";
import { redisService } from "@/services/redisService";
import { queueService } from "@/services/queueService";
import { imageProcessingService } from "@/services/imageProcessingService";

const app = express();

// Security middleware
app.use(helmet());
app.use(corsOptions);
app.use(rateLimiter);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Compression middleware
app.use(compression());

// Logging middleware
app.use(morgan("combined"));
app.use(requestLogger);

// Health check endpoint
app.get("/health", (req: any, res: any) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: serverConfig.nodeEnv,
  });
});


// API routes
app.use("/api/images", imageRoutes);

// Error handling middleware
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const PORT = serverConfig.port;

app.listen(PORT, async () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`📊 Environment: ${serverConfig.nodeEnv}`);
  logger.info(`🔗 Health check: http://localhost:${PORT}/health`);
  logger.info(`📸 Image API: http://localhost:${PORT}/api/images`);
  // Initialize Redis connections and basic event subscription for observability
  try {
    await redisService.connect();
    await redisService.subscribeToImageEvents((type, payload) => {
      logger.info(`Redis event: ${type} -> ${JSON.stringify(payload)}`);
    });
    logger.info('🔔 Redis Pub/Sub initialized');
  } catch (e) {
    logger.warn('Redis initialization failed; continuing without Pub/Sub', e);
  }

  // Initialize BullMQ worker (image conversion example)
  try {
    await queueService.initializeWorker(async (job) => {
      if (job.name === 'image-convert') {
        const start = Date.now();
        const buffer = Buffer.from(job.data.bufferBase64, 'base64');
        const out = await imageProcessingService.convertToFormat(
          buffer,
          job.data.target,
          { filename: job.data.filename, originalName: job.data.originalName }
        );
        return {
          success: true,
          sizeBytes: out.length,
          durationMs: Date.now() - start,
        };
      }
      return { success: true };
    });
    logger.info('🧵 Queue worker initialized');
  } catch (e) {
    logger.warn('Queue worker init failed; continuing without worker', e);
  }
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down gracefully");
  process.exit(0);
});

export default app;
