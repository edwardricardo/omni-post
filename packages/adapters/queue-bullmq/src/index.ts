/**
 * @file index.ts
 * @description BullMQ adapter implementing the QueuePort — enqueue, consumer worker creation,
 *              health checks, and resilience wrappers (circuit breaker + retry).
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { QueuePort, QueueJob, QueueHealth } from "@ports/core";
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { createLogger } from "@observability/logger";

const logger = createLogger("adapter:queue-bullmq");
import {
  createCircuitBreaker,
  withExponentialBackoff,
  MetricsCollector,
  type ResilienceMetrics,
} from "./resilience.js";
import { QUEUE_NAMES } from "./constants.js";
export { QUEUE_NAMES, type QueueName } from "./constants.js";

// Global connection and queue instances for cleanup
let globalConnection: Redis | null = null;
let globalQueue: Queue | null = null;

export function createBullMQQueueAdapter(): QueuePort & {
  getResilienceMetrics(): ResilienceMetrics;
  close(): Promise<void>;
} {
  const connection =
    globalConnection ||
    new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
      enableReadyCheck: false,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  const queue = globalQueue || new Queue(QUEUE_NAMES.PUBLISH, { connection });

  // Store for cleanup
  globalConnection = connection;
  globalQueue = queue;

  const metricsCollector = new MetricsCollector();

  // Create circuit breakers for queue operations
  const enqueueBreaker = createCircuitBreaker(
    async (job: QueueJob) => {
      const opts: { jobId: string; delay?: number } = {
        jobId: job.dedupeKey,
      };

      if (job.runAt) {
        opts.delay = Math.max(0, job.runAt.getTime() - Date.now());
      }

      const bullJob = await queue.add(QUEUE_NAMES.PUBLISH, job.payload, opts);
      return bullJob.id as string;
    },
    {
      timeout: 10000,
      errorThresholdPercentage: 60,
      resetTimeout: 30000,
    }
  );

  const healthBreaker = createCircuitBreaker(async () => {
    await connection.ping();

    const waiting = await queue.getWaiting();
    const active = await queue.getActive();
    const completed = await queue.getCompleted();
    const failed = await queue.getFailed();

    return {
      connected: true,
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
    };
  });

  const removeBreaker = createCircuitBreaker(async (jobId: string) => {
    const job = await queue.getJob(jobId);

    if (!job) {
      throw new Error("Job not found");
    }

    await job.remove();
    return true;
  });

  // Setup metrics collection
  metricsCollector.setupCircuitBreakerMetrics(enqueueBreaker);
  metricsCollector.setupCircuitBreakerMetrics(healthBreaker);
  metricsCollector.setupCircuitBreakerMetrics(removeBreaker);

  return {
    async enqueue(job: QueueJob): Promise<Result<string, "CONNECTION_ERROR" | "VALIDATION_ERROR">> {
      try {
        const jobId = (await withExponentialBackoff(() => enqueueBreaker.fire(job), {
          maxRetries: 2,
          baseDelay: 200,
        })) as string;
        return ok(jobId);
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("connection") || error.message.includes("timeout"))
        ) {
          return err("CONNECTION_ERROR");
        }
        return err("VALIDATION_ERROR");
      }
    },

    async health(): Promise<Result<QueueHealth, "CONNECTION_ERROR">> {
      try {
        const health = (await withExponentialBackoff(() => healthBreaker.fire(), {
          maxRetries: 1,
          baseDelay: 100,
        })) as QueueHealth;
        return ok(health);
      } catch {
        return err("CONNECTION_ERROR");
      }
    },

    async remove(jobId: string): Promise<Result<boolean, "CONNECTION_ERROR" | "NOT_FOUND">> {
      try {
        const result = (await withExponentialBackoff(() => removeBreaker.fire(jobId), {
          maxRetries: 2,
          baseDelay: 100,
        })) as boolean;
        return ok(result);
      } catch (error) {
        if (error instanceof Error && error.message.includes("Job not found")) {
          return err("NOT_FOUND");
        }
        if (
          error instanceof Error &&
          (error.message.includes("connection") || error.message.includes("timeout"))
        ) {
          return err("CONNECTION_ERROR");
        }
        return err("NOT_FOUND");
      }
    },

    getResilienceMetrics(): ResilienceMetrics {
      return metricsCollector.getMetrics();
    },

    async close(): Promise<void> {
      try {
        if (queue) {
          await queue.close();
        }
        if (connection) {
          await connection.quit();
        }
        globalQueue = null;
        globalConnection = null;
        logger.info("Queue connections closed");
      } catch (error) {
        logger.warn({ err: error }, "Queue cleanup warning");
      }
    },
  };
}

export function createBullMQConsumerAdapter() {
  return {
    async subscribe(
      _opts: Record<string, unknown>,
      handler: (job: { payload: Record<string, unknown>; dedupeKey: string }) => Promise<void>
    ) {
      const connectionForWorkers = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
        maxRetriesPerRequest: null,
        lazyConnect: true,
      });

      const worker = new Worker(
        QUEUE_NAMES.PUBLISH,
        async (job) => {
          await handler({
            payload: job.data,
            dedupeKey: job.id as string,
          });
        },
        {
          connection: connectionForWorkers,
          concurrency: 5,
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        }
      );

      worker.on("error", (error) => {
        logger.error({ err: error }, "Worker error");
      });

      return worker;
    },

    async close(): Promise<void> {
      try {
        if (globalQueue) {
          await globalQueue.close();
          globalQueue = null;
        }
        if (globalConnection) {
          await globalConnection.quit();
          globalConnection = null;
        }
        logger.info("Queue connections closed");
      } catch (error) {
        logger.warn({ err: error }, "Queue cleanup warning");
      }
    },
  };
}
