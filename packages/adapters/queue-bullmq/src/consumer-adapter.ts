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
      // BullMQ requirement: maxRetriesPerRequest MUST be null. The Worker
      // throws on instantiation otherwise.
      maxRetriesPerRequest: null,
      lazyConnect: true,
      // No commandTimeout: BullMQ Worker uses blocking commands (BZPOPMIN,
      // XREAD BLOCK) that legitimately wait indefinitely for jobs. Any
      // commandTimeout interrupts those polls mid-flight and surfaces as
      // spurious "Command timed out" errors even when Redis is healthy —
      // BullMQ issue #2619. Worker liveness is enforced via lockDuration +
      // stalledInterval (BullMQ-side) and TCP keepAlive (transport-side).
      connectTimeout: 10_000,
      keepAlive: 30_000,
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
          // BullMQ default lockDuration is 30 s, which is too tight for
          // publishing jobs that wait on social provider APIs. 60 s gives
          // headroom; stalledInterval halved so detection lands on tick 2.
          lockDuration: 60_000,
          stalledInterval: 30_000,
          drainDelay: 5,
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
