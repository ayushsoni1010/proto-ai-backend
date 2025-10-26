# Proto AI Backend

A robust Node.js backend API for image processing and management, built with Express, Prisma, PostgreSQL, and AWS S3.

## Features

- **Image Upload & Processing**: Support for JPEG, PNG, and HEIC formats
- **Chunked Upload**: Handle large files with resumable uploads
- **Image Validation**: Blur detection, face detection, and duplicate prevention
- **Cloud Storage**: AWS S3 integration for scalable file storage
- **Database**: PostgreSQL with Prisma ORM for metadata storage
- **Security**: Rate limiting, CORS, input validation, and sanitization
- **HEIC Conversion**: Automatic conversion of HEIC images to JPEG
- **Face Detection**: AWS Rekognition integration for face validation

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Storage**: AWS S3
- **Image Processing**: Sharp
- **Face Detection**: AWS Rekognition
- **Validation**: Zod
- **Security**: Helmet, CORS, Rate Limiting
- **Logging**: Winston

## Project Structure

```
src/
├── config/           # Configuration files
│   ├── database.ts   # Prisma client setup
│   └── env.ts        # Environment validation
├── controllers/      # Request handlers
│   ├── imageController.ts
│   └── chunkedUploadController.ts
├── middleware/       # Express middleware
│   ├── security.ts   # Security middleware
│   └── validation.ts # Input validation
├── routes/           # API routes
│   └── imageRoutes.ts
├── services/         # Business logic
│   ├── s3Service.ts
│   └── imageProcessingService.ts
├── types/            # TypeScript type definitions
│   └── index.ts
├── utils/            # Utility functions
│   └── logger.ts
├── server.ts         # Express app setup
└── index.ts          # Entry point
```

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd proto-ai-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp env.example .env
   ```
   
   Update the `.env` file with your configuration:
   ```env
   # Database
   DATABASE_URL="postgresql://username:password@localhost:5432/proto_ai_db?schema=public"
   
   # AWS Configuration
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=your_access_key_here
   AWS_SECRET_ACCESS_KEY=your_secret_key_here
   AWS_S3_BUCKET=proto-ai-images
   
   # Server Configuration
   PORT=3001
   NODE_ENV=development
   
   # Image Processing Configuration
   MIN_IMAGE_WIDTH=300
   MIN_IMAGE_HEIGHT=300
   MAX_IMAGE_WIDTH=4000
   MAX_IMAGE_HEIGHT=4000
   MAX_FILE_SIZE=10485760
   
   # Security
   JWT_SECRET=your_jwt_secret_here
   RATE_LIMIT_WINDOW_MS=900000
   RATE_LIMIT_MAX_REQUESTS=100
   
   # Logging
   LOG_LEVEL=info
   ```

4. **Set up the database**
   ```bash
   # Generate Prisma client
   npm run db:generate
   
   # Push schema to database
   npm run db:push
   
   # Or run migrations
   npm run db:migrate
   ```

5. **Start the development server**
   ```bash
   npm run dev
   ```

## API Endpoints

### Images

#### GET /api/images
Get all images with pagination and filtering.

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10, max: 100)
- `status` (optional): Filter by status (PENDING, PROCESSING, VALIDATED, REJECTED, ERROR)

**Response:**
```json
{
  "images": [
    {
      "id": "string",
      "filename": "string",
      "originalName": "string",
      "mimeType": "string",
      "size": 0,
      "width": 0,
      "height": 0,
      "status": "VALIDATED",
      "blurScore": 0,
      "faceCount": 0,
      "faceSize": 0,
      "downloadUrl": "string",
      "createdAt": "2023-01-01T00:00:00.000Z",
      "updatedAt": "2023-01-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "pages": 10
  }
}
```

#### GET /api/images/:id
Get a specific image by ID.

**Response:**
```json
{
  "id": "string",
  "filename": "string",
  "originalName": "string",
  "mimeType": "string",
  "size": 0,
  "width": 0,
  "height": 0,
  "status": "VALIDATED",
  "blurScore": 0,
  "faceCount": 0,
  "faceSize": 0,
  "downloadUrl": "string",
  "createdAt": "2023-01-01T00:00:00.000Z",
  "updatedAt": "2023-01-01T00:00:00.000Z"
}
```

#### POST /api/images/upload
Upload a new image.

**Request:** Multipart form data with `file` field

**Response:**
```json
{
  "success": true,
  "image": {
    "id": "string",
    "filename": "string",
    "originalName": "string",
    "mimeType": "string",
    "size": 0,
    "width": 0,
    "height": 0,
    "status": "VALIDATED",
    "blurScore": 0,
    "faceCount": 0,
    "faceSize": 0,
    "downloadUrl": "string",
    "createdAt": "2023-01-01T00:00:00.000Z",
    "updatedAt": "2023-01-01T00:00:00.000Z"
  }
}
```

#### DELETE /api/images/:id
Delete an image.

**Response:**
```json
{
  "success": true
}
```

#### PATCH /api/images/:id/status
Update image status.

**Request Body:**
```json
{
  "status": "VALIDATED"
}
```

**Response:**
```json
{
  "success": true,
  "image": { /* Image object */ }
}
```

### Chunked Upload

#### POST /api/images/chunked-upload
Upload image in chunks.

**Request Body:**
```json
{
  "sessionId": "string (optional)",
  "filename": "string",
  "mimeType": "string",
  "totalChunks": 0,
  "chunkIndex": 0,
  "chunkData": "base64 string"
}
```

**Response (In Progress):**
```json
{
  "success": true,
  "completed": false,
  "sessionId": "string",
  "progress": {
    "uploaded": 5,
    "total": 10,
    "percentage": 50
  }
}
```

**Response (Completed):**
```json
{
  "success": true,
  "completed": true,
  "image": { /* Image object */ }
}
```

#### GET /api/images/chunked-upload/:sessionId/status
Get upload session status.

**Response:**
```json
{
  "success": true,
  "session": {
    "id": "string",
    "filename": "string",
    "status": "IN_PROGRESS",
    "progress": {
      "uploaded": 5,
      "total": 10,
      "percentage": 50
    },
    "createdAt": "2023-01-01T00:00:00.000Z",
    "expiresAt": "2023-01-02T00:00:00.000Z"
  }
}
```

#### DELETE /api/images/chunked-upload/:sessionId
Cancel upload session.

**Response:**
```json
{
  "success": true
}
```

## Image Validation

The API performs comprehensive image validation:

1. **Format Validation**: Only JPEG, PNG, and HEIC images are allowed
2. **Size Validation**: Images must be within specified dimensions and file size limits
3. **Blur Detection**: Uses Laplacian variance to detect blurry images
4. **Face Detection**: AWS Rekognition integration for face validation
5. **Duplicate Detection**: SHA-256 hash-based duplicate prevention
6. **HEIC Conversion**: Automatic conversion to JPEG format

## Security Features

- **Rate Limiting**: Configurable request rate limiting
- **CORS**: Cross-origin resource sharing configuration
- **Input Validation**: Comprehensive input validation using Zod
- **Input Sanitization**: XSS protection and input sanitization
- **Security Headers**: Helmet.js for security headers
- **File Type Validation**: Strict file type validation
- **File Size Limits**: Configurable file size limits

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `AWS_REGION` | AWS region | us-east-1 |
| `AWS_ACCESS_KEY_ID` | AWS access key | Required |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | Required |
| `AWS_S3_BUCKET` | S3 bucket name | Required |
| `PORT` | Server port | 3001 |
| `NODE_ENV` | Environment | development |
| `MIN_IMAGE_WIDTH` | Minimum image width | 300 |
| `MIN_IMAGE_HEIGHT` | Minimum image height | 300 |
| `MAX_IMAGE_WIDTH` | Maximum image width | 4000 |
| `MAX_IMAGE_HEIGHT` | Maximum image height | 4000 |
| `MAX_FILE_SIZE` | Maximum file size in bytes | 10485760 |
| `JWT_SECRET` | JWT secret key | Required |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window | 900000 |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | 100 |
| `LOG_LEVEL` | Logging level | info |

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run db:generate` - Generate Prisma client
- `npm run db:push` - Push schema to database
- `npm run db:migrate` - Run database migrations
- `npm run db:studio` - Open Prisma Studio
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint errors

## Development

1. **Database Setup**: Ensure PostgreSQL is running and create a database
2. **AWS Setup**: Create an S3 bucket and configure AWS credentials
3. **Environment**: Copy `env.example` to `.env` and configure
4. **Dependencies**: Run `npm install`
5. **Database**: Run `npm run db:push`
6. **Start**: Run `npm run dev`

## Production Deployment

1. **Build**: `npm run build`
2. **Environment**: Set production environment variables
3. **Database**: Run migrations
4. **Start**: `npm start`

## Error Handling

The API returns consistent error responses:

```json
{
  "error": "Error message",
  "details": "Additional error details (development only)"
}
```

## Logging

Logs are written to:
- `logs/error.log` - Error logs only
- `logs/combined.log` - All logs
- Console output (development only)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.
