import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { logger } from '@/utils/logger';

/**
 * Validation result handler
 */
export const handleValidationErrors = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    logger.warn('Validation errors:', {
      errors: errors.array(),
      url: req.originalUrl,
      method: req.method,
    });
    
    res.status(400).json({
      error: 'Validation failed',
      details: errors.array(),
    });
    return;
  }
  
  next();
};

/**
 * Image upload validation
 */
export const validateImageUpload = [
  body('filename')
    .isString()
    .isLength({ min: 1, max: 255 })
    .withMessage('Filename must be a string between 1 and 255 characters'),
  
  body('mimeType')
    .isString()
    .matches(/^image\/(jpeg|jpg|png|heic)$/i)
    .withMessage('MimeType must be a valid image type (jpeg, jpg, png, heic)'),
  
  body('size')
    .isInt({ min: 1, max: 10485760 }) // 10MB max
    .withMessage('Size must be a positive integer not exceeding 10MB'),
  
  handleValidationErrors,
];

/**
 * Chunk upload validation
 */
export const validateChunkUpload = [
  body('sessionId')
    .optional()
    .isString()
    .isLength({ min: 1, max: 255 })
    .withMessage('SessionId must be a string between 1 and 255 characters'),
  
  body('filename')
    .isString()
    .isLength({ min: 1, max: 255 })
    .withMessage('Filename must be a string between 1 and 255 characters'),
  
  body('mimeType')
    .isString()
    .matches(/^image\/(jpeg|jpg|png|heic)$/i)
    .withMessage('MimeType must be a valid image type (jpeg, jpg, png, heic)'),
  
  body('totalChunks')
    .isInt({ min: 1, max: 1000 })
    .withMessage('TotalChunks must be a positive integer not exceeding 1000'),
  
  body('chunkIndex')
    .isInt({ min: 0 })
    .withMessage('ChunkIndex must be a non-negative integer'),
  
  body('chunkData')
    .isString()
    .isLength({ min: 1 })
    .withMessage('ChunkData must be a non-empty base64 string'),
  
  handleValidationErrors,
];

/**
 * Image ID parameter validation
 */
export const validateImageId = [
  param('id')
    .isString()
    .isLength({ min: 1, max: 255 })
    .withMessage('Image ID must be a string between 1 and 255 characters'),
  
  handleValidationErrors,
];

/**
 * Query parameters validation for image listing
 */
export const validateImageListQuery = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be a positive integer not exceeding 100'),
  
  query('status')
    .optional()
    .isIn(['PENDING', 'PROCESSING', 'VALIDATED', 'REJECTED', 'ERROR'])
    .withMessage('Status must be one of: PENDING, PROCESSING, VALIDATED, REJECTED, ERROR'),
  
  handleValidationErrors,
];

/**
 * File upload validation middleware
 */
export const validateFileUpload = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.file) {
    res.status(400).json({
      error: 'No file provided',
    });
    return;
  }

  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/heic'];
  const maxFileSize = 10 * 1024 * 1024; // 10MB

  if (!allowedMimeTypes.includes(req.file.mimetype)) {
    res.status(400).json({
      error: 'Invalid file type',
      details: `Allowed types: ${allowedMimeTypes.join(', ')}`,
    });
    return;
  }

  if (req.file.size > maxFileSize) {
    res.status(400).json({
      error: 'File too large',
      details: `Maximum size: ${maxFileSize} bytes`,
    });
    return;
  }

  next();
};

/**
 * Sanitize input middleware
 */
export const sanitizeInput = (req: Request, res: Response, next: NextFunction) => {
  // Sanitize string inputs
  const sanitizeString = (str: string): string => {
    return str
      .trim()
      .replaceAll(/[<>]/g, '') // Remove potential HTML tags
      .substring(0, 1000); // Limit length
  };

  // Sanitize body parameters
  if (req.body) {
    for (const key of Object.keys(req.body)) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitizeString(req.body[key]);
      }
    }
  }

  // Sanitize query parameters
  if (req.query) {
    for (const key of Object.keys(req.query)) {
      if (typeof req.query[key] === 'string') {
        req.query[key] = sanitizeString(req.query[key] as string);
      }
    }
  }

  next();
};
