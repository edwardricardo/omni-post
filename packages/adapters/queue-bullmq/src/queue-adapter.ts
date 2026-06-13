/**
 * @file queue-adapter.ts
 * @description BullMQ producer adapter implementing `QueuePort`. Parametrised
 *              by queue name so a single connection can host multiple
 *              queues. Resilience layer (circuit breaker + exponential
 *              backoff) is shared with the original implementation.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { QueuePort, QueueJob, QueueHealth } from "@ports/core";
import { Queue, type DefaultJobOptions } from "bullmq";
import type Redis from "ioredis";
import { createLogger } from "@observability/logger";

import {
  createCircuitBreaker,
  withExponentialBackoff,
  MetricsCollector,
  type ResilienceMetrics,
} from "./resilience.js";
import type { QueueName } from "./constants.js";

const logger = createLogger("adapter:queue-bullmq");

export interface BullMQQueueAdapterOptions {
  queueName: QueueName | string;
  /**
   * Shared Redis connection, owned and supplied by the composition root
   * (typically via `BullMQQueuePortRegistry`, so multiple adapters share one
   * socket). The adapter never self-constructs a connection from `process.env`:
   * that would reintroduce the CWE-798 insecure fallback (SECURITY_CANON
   * §Secrets) and violate the DI canon (ARCHITECTURE_CANON §Dependency
   * Injection — only a composition root may construct an adapter's transport).
   *
   * REQUIRED: every caller now injects a composition-root-owned connection, so
   * the TS compiler enforces injection at every call site. The runtime throw
   * below is the belt-and-suspenders safety net for non-TS callers that pass
   * `undefined` through a cast.
   */
  connection: Redis;
  /**
   * Default options applied to every job added to this queue.
   * `attempts` + `backoff` enable BullMQ's built-in retry policy without
   * requiring callers to pass them on every `enqueue` call. The full set
   * of `DefaultJobOptions` is exposed so callers can also tweak
   * `removeOnComplete`, `priority`, `lifo`, etc. when relevant.
   *
   * BullMQ supports an optional `jitter` (0..1) inside `backoff` to
   * randomise retry delays — recommended to avoid thundering-herd on
   * batch failures.
   */
  defaultJobOptions?: DefaultJobOptions;
}

export type BullMQQueueAdapter = QueuePort & {
  getResilienceMetrics(): ResilienceMetrics;
  /** Close the underlying queue. The injected connection is owned by the
   *  composition root and is never quit here. */
  close(): Promise<void>;
};

export function createBullMQQueueAdapter(options: BullMQQueueAdapterOptions): BullMQQueueAdapter {
  if (options.connection === undefined) {
    throw new Error(
      "BullMQ queue adapter requires an injected Redis connection " +
        "(composition-root-owned). Self-construction from process.env is " +
        "forbidden — see ARCHITECTURE_CANON §Dependency Injection and " +
        "SECURITY_CANON §Secrets."
    );
  }
  const connection = options.connection;

  const queue = new Queue(options.queueName, {
    connection,
    ...(options.defaultJobOptions !== undefined && {
      defaultJobOptions: options.defaultJobOptions,
    }),
  });
  const metricsCollector = new MetricsCollector();

  const enqueueBreaker = createCircuitBreaker(
    async (job: QueueJob) => {
      const opts: { jobId: string; delay?: number } = { jobId: job.dedupeKey };
      if (job.runAt) {
        opts.delay = Math.max(0, job.runAt.getTime() - Date.now());
      }
      const bullJob = await queue.add(options.queueName, job.payload, opts);
      return bullJob.id as string;
    },
    {
      timeout: 10000,
      errorThresholdPercentage: 60,
      resetTimeout: 30000,
    }
  );

  const enqueueBulkBreaker = createCircuitBreaker(
    async (jobs: QueueJob[]) => {
      const bulk = jobs.map((job) => {
        const opts: { jobId: string; delay?: number } = { jobId: job.dedupeKey };
        if (job.runAt) {
          opts.delay = Math.max(0, job.runAt.getTime() - Date.now());
        }
        return { name: options.queueName, data: job.payload, opts };
      });
      const created = await queue.addBulk(bulk);
      return created.map((bullJob) => bullJob.id as string);
    },
    {
      timeout: 15000,
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

  metricsCollector.setupCircuitBreakerMetrics(enqueueBreaker);
  metricsCollector.setupCircuitBreakerMetrics(enqueueBulkBreaker);
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

    async enqueueBulk(
      jobs: QueueJob[]
    ): Promise<Result<string[], "CONNECTION_ERROR" | "VALIDATION_ERROR">> {
      if (jobs.length === 0) {
        return ok([]);
      }
      try {
        const ids = (await withExponentialBackoff(() => enqueueBulkBreaker.fire(jobs), {
          maxRetries: 2,
          baseDelay: 200,
        })) as string[];
        return ok(ids);
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

    async getJobStates(jobIds) {
      try {
        const aggregate = { completed: 0, failed: 0, pending: 0 };
        for (const jobId of jobIds) {
          const job = await queue.getJob(jobId);
          if (!job) {
            // Missing — treat as failed so the saga cannot silently transition
            // Post.status to PUBLISHED on a job that no longer exists.
            aggregate.failed++;
            continue;
          }
          const state = await job.getState();
          if (state === "completed") aggregate.completed++;
          else if (state === "failed") aggregate.failed++;
          else aggregate.pending++; // waiting / active / delayed / unknown
        }
        return ok(aggregate);
      } catch (error) {
        logger.warn(
          { err: error, queueName: options.queueName, jobCount: jobIds.length },
          "Failed to read job states from BullMQ"
        );
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
        await queue.close();
        // The injected connection is owned by the composition root, which
        // quits it during shutdown. The adapter never quits a connection it
        // does not own.
        logger.info({ queueName: options.queueName }, "Queue adapter closed");
      } catch (error) {
        logger.warn({ err: error, queueName: options.queueName }, "Queue cleanup warning");
      }
    },
  };
}
