import IORedis, { Redis, RedisOptions } from "ioredis";
import { redisConfig } from "@/config/env";
import { logger } from "@/utils/logger";
import { promisify } from "node:util";
import { gzip as gzipCb, gunzip as gunzipCb } from "node:zlib";

const gzip = promisify(gzipCb);
const gunzip = promisify(gunzipCb);

export type ImageEventType =
  | "image.conversion.started"
  | "image.conversion.completed"
  | "image.conversion.failed";

export interface ImageEventPayload {
  id?: string;
  filename?: string;
  originalName?: string;
  mimeType?: string;
  targetFormat?: "jpeg" | "png";
  sizeBytes?: number;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

class RedisService {
  private client: Redis;
  private publisher: Redis;
  private subscriber: Redis;

  constructor() {
    const options: RedisOptions = {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => Math.min(times * 100, 2000),
    };

    this.client = new IORedis(redisConfig.url, options);
    this.publisher = new IORedis(redisConfig.url, options);
    this.subscriber = new IORedis(redisConfig.url, options);

    // Attach basic logging
    for (const [name, conn] of [
      ["client", this.client],
      ["publisher", this.publisher],
      ["subscriber", this.subscriber],
    ] as const) {
      conn.on("connect", () => logger.info(`Redis ${name} connected`));
      conn.on("error", (err) => logger.error(`Redis ${name} error`, err));
      conn.on("reconnecting", () =>
        logger.warn(`Redis ${name} reconnecting...`)
      );
    }
  }

  async connect(): Promise<void> {
    await Promise.all([
      this.client.connect(),
      this.publisher.connect(),
      this.subscriber.connect(),
    ]);
  }

  async disconnect(): Promise<void> {
    await Promise.all([
      this.client.quit(),
      this.publisher.quit(),
      this.subscriber.quit(),
    ]);
  }

  // Pub/Sub
  async publishImageEvent(
    type: ImageEventType,
    payload: ImageEventPayload
  ): Promise<number> {
    const message = JSON.stringify({ type, payload, at: Date.now() });
    return this.publisher.publish(redisConfig.imageEventsChannel, message);
  }

  async subscribeToImageEvents(
    handler: (type: ImageEventType, payload: ImageEventPayload) => void
  ): Promise<void> {
    await this.subscriber.subscribe(redisConfig.imageEventsChannel);
    this.subscriber.on("message", (_channel, message) => {
      try {
        const parsed = JSON.parse(message) as {
          type: ImageEventType;
          payload: ImageEventPayload;
        };
        handler(parsed.type, parsed.payload);
      } catch (err) {
        logger.error("Failed to parse image event message", err);
      }
    });
  }

  // Gzip-compressed cache helpers
  async setCompressed(
    key: string,
    value: unknown,
    ttlSeconds?: number
  ): Promise<void> {
    const json = JSON.stringify(value);
    const compressed = await gzip(Buffer.from(json));
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, compressed, "EX", ttlSeconds);
    } else {
      await this.client.set(key, compressed);
    }
  }

  async getCompressed<T = unknown>(key: string): Promise<T | null> {
    const data = await this.client.getBuffer(key);
    if (!data) return null;
    const decompressed = await gunzip(data);
    return JSON.parse(decompressed.toString("utf-8")) as T;
  }

  // Binary chunk helpers (optionally compressed)
  async setChunk(
    key: string,
    chunkIndex: number,
    buffer: Buffer
  ): Promise<void> {
    const field = String(chunkIndex);
    await this.client.hset(key, field, buffer);
  }

  async getChunk(key: string, chunkIndex: number): Promise<Buffer | null> {
    const field = String(chunkIndex);
    const buf = (await this.client.hgetBuffer(key, field)) as Buffer | null;
    return buf ?? null;
  }

  async deleteKey(key: string): Promise<number> {
    return this.client.del(key);
  }
}

export const redisService = new RedisService();
export default redisService;
