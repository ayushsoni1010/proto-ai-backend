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
} from "@/middleware/security";
import imageRoutes from "@/routes/imageRoutes";
import { logger } from "@/utils/logger";

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

app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`📊 Environment: ${serverConfig.nodeEnv}`);
  logger.info(`🔗 Health check: http://localhost:${PORT}/health`);
  logger.info(`📸 Image API: http://localhost:${PORT}/api/images`);
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
