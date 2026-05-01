/**
 * @file consumer-adapter.ts
 * @description BullMQ consumer adapter — creates a Worker bound to a single
 *              queue name. Concurrency, removeOnComplete and removeOnFail
 *              are now caller-provided (previously hardcoded to 5/100/50).
 *              Workers must be closed explicitly via `Worker.close()`.
 * @layer infrastructure
 */
import { Worker } from "bullmq";
import Redis from "ioredis";
import { createLogger } from "@observability/logger";
import type { QueueName } from "./constants.js";

const logger = createLogger("adapter:queue-bullmq:consumer");

export interface BullMQConsumerAdapterOptions {
  queueName: QueueName | string;
  concurrency?: number;
  removeOnComplete?: { count: number };
  removeOnFail?: { count: number };
  /**
   * Optional shared Redis connection. When omitted, the adapter creates a
   * dedicated connection. Workers require `maxRetriesPerRequest: null`
   * because BullMQ blocks on `BRPOPLPUSH` indefinitely.
   */
  connection?: Redis;
}

export interface BullMQConsumerAdapter {
  subscribe(
    handler: (job: { payload: Record<string, unknown>; dedupeKey: string }) => Promise<void>
  ): Promise<Worker>;
  close(): Promise<void>;
}

export function createBullMQConsumerAdapter(
  options: BullMQConsumerAdapterOptions
): BullMQConsumerAdapter {
  const ownsConnection = options.connection === undefined;
  const connection =
    options.connection ??
    new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });

  const concurrency = options.concurrency ?? 5;
  const removeOnComplete = options.removeOnComplete ?? { count: 100 };
  const removeOnFail = options.removeOnFail ?? { count: 50 };

  let worker: Worker | null = null;

  return {
    async subscribe(handler) {
      worker = new Worker(
        options.queueName,
        async (job) => {
          await handler({
            payload: job.data,
            dedupeKey: job.id as string,
          });
        },
        {
          connection,
          concurrency,
          removeOnComplete,
          removeOnFail,
        }
      );

      worker.on("error", (error) => {
        logger.error({ err: error, queueName: options.queueName }, "Worker error");
      });

      return worker;
    },

    async close(): Promise<void> {
      try {
        if (worker) {
          await worker.close();
          worker = null;
        }
        if (ownsConnection) {
          await connection.quit();
        }
        logger.info({ queueName: options.queueName }, "Consumer adapter closed");
      } catch (error) {
        logger.warn({ err: error, queueName: options.queueName }, "Consumer cleanup warning");
      }
    },
  };
}
