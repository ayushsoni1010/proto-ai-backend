import { Queue, Worker, QueueEvents, JobsOptions, Processor } from 'bullmq';
import IORedis from 'ioredis';
import { redisConfig } from '@/config/env';
import { logger } from '@/utils/logger';

export type ImageJobType = 'image-convert' | 'image-validate' | 'rekognition-analyze' | 'cleanup';

export interface ImageConvertJobData {
  bufferBase64: string; // base64 for serialization
  target: 'jpeg' | 'png';
  filename?: string;
  originalName?: string;
}

export interface GenericJobResult {
  success: boolean;
  sizeBytes?: number;
  durationMs?: number;
  error?: string;
}

class QueueService {
  private connection: IORedis;
  public imageQueue: Queue<ImageConvertJobData>;
  public events: QueueEvents;
  private worker?: Worker<ImageConvertJobData, GenericJobResult, ImageJobType>;

  constructor() {
    this.connection = new IORedis(redisConfig.url, { maxRetriesPerRequest: 2 });

    this.imageQueue = new Queue<ImageConvertJobData>(
      'image-processing',
      { connection: this.connection as any }
    );

    this.events = new QueueEvents('image-processing', { connection: this.connection as any });

    this.events.on('failed', ({ jobId, failedReason }) => {
      logger.warn(`Queue job failed ${jobId}: ${failedReason}`);
    });

    this.events.on('completed', ({ jobId }) => {
      logger.info(`Queue job completed ${jobId}`);
    });
  }

  async initializeWorker(processor: Processor<ImageConvertJobData, GenericJobResult, ImageJobType>): Promise<void> {
    if (this.worker) return;
    const concurrency = Number.parseInt(process.env.QUEUE_CONCURRENCY ?? '5');
    this.worker = new Worker<ImageConvertJobData, GenericJobResult, ImageJobType>(
      'image-processing',
      processor,
      { connection: this.connection as any, concurrency }
    );

    this.worker.on('error', (err) => logger.error('Queue worker error', err));
  }

  defaultJobOptions(): JobsOptions {
    const attempts = Number.parseInt(process.env.QUEUE_MAX_ATTEMPTS ?? '3');
    const backoffMs = Number.parseInt(process.env.QUEUE_BACKOFF_MS ?? '1000');
    return {
      attempts,
      backoff: { type: 'exponential', delay: backoffMs },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    };
  }
}

export const queueService = new QueueService();
export default queueService;
