import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, 'Database URL is required'),
  
  // AWS Configuration
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().min(1, 'AWS Access Key ID is required'),
  AWS_SECRET_ACCESS_KEY: z.string().min(1, 'AWS Secret Access Key is required'),
  AWS_S3_BUCKET: z.string().min(1, 'S3 Bucket name is required'),
  
  // Server Configuration
  PORT: z.string().default('3001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Redis / Queue
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_IMAGE_EVENTS_CHANNEL: z.string().default('image:events'),
  
  // Image Processing Configuration
  MIN_IMAGE_WIDTH: z.string().default('300'),
  MIN_IMAGE_HEIGHT: z.string().default('300'),
  MAX_IMAGE_WIDTH: z.string().default('4000'),
  MAX_IMAGE_HEIGHT: z.string().default('4000'),
  MAX_FILE_SIZE: z.string().default('10485760'), // 10MB
  
  // Security
  JWT_SECRET: z.string().min(32, 'JWT Secret must be at least 32 characters'),
  RATE_LIMIT_WINDOW_MS: z.string().default('900000'), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: z.string().default('100'),
  
  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parseResult.error.format());
  process.exit(1);
}

export const env = parseResult.data;

// Export individual configs for convenience
export const dbConfig = {
  url: env.DATABASE_URL,
};

export const awsConfig = {
  region: env.AWS_REGION,
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  s3Bucket: env.AWS_S3_BUCKET,
};

export const serverConfig = {
  port: Number.parseInt(env.PORT),
  nodeEnv: env.NODE_ENV,
};

export const redisConfig = {
  url: env.REDIS_URL,
  imageEventsChannel: env.REDIS_IMAGE_EVENTS_CHANNEL,
};

export const imageConfig = {
  minWidth: Number.parseInt(env.MIN_IMAGE_WIDTH),
  minHeight: Number.parseInt(env.MIN_IMAGE_HEIGHT),
  maxWidth: Number.parseInt(env.MAX_IMAGE_WIDTH),
  maxHeight: Number.parseInt(env.MAX_IMAGE_HEIGHT),
  maxFileSize: Number.parseInt(env.MAX_FILE_SIZE),
};

export const securityConfig = {
  jwtSecret: env.JWT_SECRET,
  rateLimitWindowMs: Number.parseInt(env.RATE_LIMIT_WINDOW_MS),
  rateLimitMaxRequests: Number.parseInt(env.RATE_LIMIT_MAX_REQUESTS),
};

export const loggingConfig = {
  level: env.LOG_LEVEL,
};
