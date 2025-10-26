# Deployment Guide

This guide covers different deployment options for the Proto AI Backend.

## Prerequisites

- Node.js 18+ installed
- PostgreSQL database
- AWS account with S3 bucket
- Docker (optional)

## Local Development

1. **Clone and install dependencies**
   ```bash
   git clone <repository-url>
   cd proto-ai-backend
   npm install
   ```

2. **Set up environment**
   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

3. **Set up database**
   ```bash
   npm run db:push
   ```

4. **Start development server**
   ```bash
   npm run dev
   ```

## Docker Deployment

### Using Docker Compose (Recommended for local development)

1. **Start all services**
   ```bash
   docker-compose up -d
   ```

2. **View logs**
   ```bash
   docker-compose logs -f api
   ```

3. **Stop services**
   ```bash
   docker-compose down
   ```

### Using Docker directly

1. **Build the image**
   ```bash
   docker build -t proto-ai-backend .
   ```

2. **Run the container**
   ```bash
   docker run -p 3001:3001 \
     -e DATABASE_URL="postgresql://user:pass@host:5432/db" \
     -e AWS_ACCESS_KEY_ID="your_key" \
     -e AWS_SECRET_ACCESS_KEY="your_secret" \
     -e AWS_S3_BUCKET="your_bucket" \
     proto-ai-backend
   ```

## Production Deployment

### Environment Variables

Set the following environment variables in production:

```bash
# Database
DATABASE_URL="postgresql://username:password@host:5432/database"

# AWS Configuration
AWS_REGION="us-east-1"
AWS_ACCESS_KEY_ID="your_access_key"
AWS_SECRET_ACCESS_KEY="your_secret_key"
AWS_S3_BUCKET="your_bucket_name"

# Server Configuration
PORT="3001"
NODE_ENV="production"

# Security
JWT_SECRET="your_secure_jwt_secret_32_chars_min"
RATE_LIMIT_WINDOW_MS="900000"
RATE_LIMIT_MAX_REQUESTS="100"

# Logging
LOG_LEVEL="info"
```

### AWS S3 Setup

1. **Create S3 bucket**
   - Go to AWS S3 Console
   - Create a new bucket
   - Configure bucket policies for public read access to images

2. **Set up IAM user**
   - Create IAM user with programmatic access
   - Attach policy for S3 full access
   - Note down Access Key ID and Secret Access Key

3. **Configure CORS**
   ```json
   [
     {
       "AllowedHeaders": ["*"],
       "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
       "AllowedOrigins": ["*"],
       "ExposeHeaders": []
     }
   ]
   ```

### Database Setup

1. **PostgreSQL on AWS RDS**
   - Create RDS PostgreSQL instance
   - Configure security groups
   - Note down connection string

2. **Local PostgreSQL**
   ```bash
   # Install PostgreSQL
   sudo apt-get install postgresql postgresql-contrib
   
   # Create database
   sudo -u postgres createdb proto_ai_db
   
   # Create user
   sudo -u postgres createuser --interactive
   ```

### Deployment Options

#### Option 1: Traditional VPS/Server

1. **Set up server**
   ```bash
   # Update system
   sudo apt update && sudo apt upgrade -y
   
   # Install Node.js
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   
   # Install PM2
   sudo npm install -g pm2
   ```

2. **Deploy application**
   ```bash
   # Clone repository
   git clone <repository-url>
   cd proto-ai-backend
   
   # Install dependencies
   npm ci --production
   
   # Build application
   npm run build
   
   # Start with PM2
   pm2 start dist/server.js --name proto-ai-backend
   pm2 save
   pm2 startup
   ```

#### Option 2: AWS EC2

1. **Launch EC2 instance**
   - Choose Ubuntu 20.04 LTS
   - Select appropriate instance type (t3.medium recommended)
   - Configure security groups (ports 22, 3001)

2. **Set up application**
   ```bash
   # Connect to instance
   ssh -i your-key.pem ubuntu@your-instance-ip
   
   # Install dependencies
   sudo apt update
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   
   # Clone and setup
   git clone <repository-url>
   cd proto-ai-backend
   npm ci --production
   npm run build
   ```

3. **Configure reverse proxy with Nginx**
   ```bash
   # Install Nginx
   sudo apt install nginx
   
   # Create configuration
   sudo nano /etc/nginx/sites-available/proto-ai-backend
   ```

   Nginx configuration:
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;
       
       location / {
           proxy_pass http://localhost:3001;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

   ```bash
   # Enable site
   sudo ln -s /etc/nginx/sites-available/proto-ai-backend /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

#### Option 3: AWS ECS/Fargate

1. **Create ECS cluster**
   - Go to ECS Console
   - Create new cluster
   - Choose Fargate launch type

2. **Create task definition**
   ```json
   {
     "family": "proto-ai-backend",
     "networkMode": "awsvpc",
     "requiresCompatibilities": ["FARGATE"],
     "cpu": "512",
     "memory": "1024",
     "executionRoleArn": "arn:aws:iam::account:role/ecsTaskExecutionRole",
     "containerDefinitions": [
       {
         "name": "proto-ai-backend",
         "image": "your-account.dkr.ecr.region.amazonaws.com/proto-ai-backend:latest",
         "portMappings": [
           {
             "containerPort": 3001,
             "protocol": "tcp"
           }
         ],
         "environment": [
           {
             "name": "NODE_ENV",
             "value": "production"
           }
         ],
         "secrets": [
           {
             "name": "DATABASE_URL",
             "valueFrom": "arn:aws:secretsmanager:region:account:secret:database-url"
           }
         ],
         "logConfiguration": {
           "logDriver": "awslogs",
           "options": {
             "awslogs-group": "/ecs/proto-ai-backend",
             "awslogs-region": "us-east-1",
             "awslogs-stream-prefix": "ecs"
           }
         }
       }
     ]
   }
   ```

3. **Create service**
   - Create ECS service
   - Configure load balancer
   - Set up auto-scaling

#### Option 4: Heroku

1. **Install Heroku CLI**
   ```bash
   # Install Heroku CLI
   curl https://cli-assets.heroku.com/install.sh | sh
   ```

2. **Deploy to Heroku**
   ```bash
   # Login to Heroku
   heroku login
   
   # Create app
   heroku create proto-ai-backend
   
   # Add PostgreSQL addon
   heroku addons:create heroku-postgresql:hobby-dev
   
   # Set environment variables
   heroku config:set NODE_ENV=production
   heroku config:set AWS_ACCESS_KEY_ID=your_key
   heroku config:set AWS_SECRET_ACCESS_KEY=your_secret
   heroku config:set AWS_S3_BUCKET=your_bucket
   
   # Deploy
   git push heroku main
   ```

### Monitoring and Logging

1. **Set up monitoring**
   - Use AWS CloudWatch for logs
   - Set up alerts for errors
   - Monitor performance metrics

2. **Health checks**
   - Endpoint: `GET /health`
   - Monitor response time and status

3. **Log management**
   - Logs are written to `logs/` directory
   - Use log aggregation tools (ELK stack, Splunk, etc.)

### Security Considerations

1. **Environment variables**
   - Never commit `.env` files
   - Use secret management services
   - Rotate credentials regularly

2. **Network security**
   - Use HTTPS in production
   - Configure proper CORS policies
   - Set up rate limiting

3. **Database security**
   - Use connection pooling
   - Enable SSL connections
   - Regular backups

### Backup Strategy

1. **Database backups**
   - Automated daily backups
   - Point-in-time recovery
   - Cross-region replication

2. **File backups**
   - S3 versioning enabled
   - Cross-region replication
   - Lifecycle policies

### Scaling Considerations

1. **Horizontal scaling**
   - Use load balancers
   - Stateless application design
   - Database connection pooling

2. **Vertical scaling**
   - Monitor resource usage
   - Scale based on metrics
   - Use auto-scaling groups

3. **Caching**
   - Implement Redis for session storage
   - Cache frequently accessed data
   - Use CDN for static assets

## Troubleshooting

### Common Issues

1. **Database connection errors**
   - Check connection string
   - Verify network access
   - Check credentials

2. **S3 upload failures**
   - Verify AWS credentials
   - Check bucket permissions
   - Verify region configuration

3. **Image processing errors**
   - Check Sharp installation
   - Verify image formats
   - Check memory limits

### Debug Mode

Enable debug logging:
```bash
export LOG_LEVEL=debug
npm run dev
```

### Performance Optimization

1. **Database optimization**
   - Add proper indexes
   - Use connection pooling
   - Optimize queries

2. **Image processing**
   - Use appropriate image sizes
   - Implement caching
   - Optimize Sharp settings

3. **API optimization**
   - Implement response caching
   - Use compression
   - Optimize payload sizes
