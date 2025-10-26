import type { ImageStatus } from "../generated/prisma/client";

// Image related types
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  metadata?: {
    width: number;
    height: number;
    size: number;
    format: string;
    blurScore?: number;
    faceCount?: number;
    faceSize?: number;
    hash?: string;
  };
}

export interface ImageMetadata {
  width: number;
  height: number;
  size: number;
  format: string;
  blurScore?: number;
  faceCount?: number;
  faceSize?: number;
  hash?: string;
}

export interface ImageResponse {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  status: ImageStatus;
  blurScore?: number | null;
  faceCount?: number | null;
  faceSize?: number | null;
  downloadUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ImageListResponse {
  images: ImageResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// Upload related types
export interface ChunkUploadRequest {
  sessionId?: string;
  filename: string;
  mimeType: string;
  totalChunks: number;
  chunkIndex: number;
  chunkData: string; // Base64 encoded chunk
}

export interface ChunkUploadResponse {
  success: boolean;
  completed: boolean;
  sessionId?: string;
  progress?: {
    uploaded: number;
    total: number;
    percentage: number;
  };
  image?: ImageResponse;
}

export interface UploadProgress {
  uploaded: number;
  total: number;
  percentage: number;
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  details?: any;
}

export interface PaginationParams {
  page: number;
  limit: number;
  status?: ImageStatus;
}

// Error types
export interface ApiError {
  message: string;
  code?: string;
  details?: any;
}

// Request types
export interface ImageUploadRequest {
  filename: string;
  mimeType: string;
  size: number;
}

export interface ImageDeleteRequest {
  id: string;
}

// Re-export Prisma types
export type { ImageStatus } from "../generated/prisma/client";
