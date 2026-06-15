/**
 * @file index.ts
 * @description Dead-letter queue manager — captures failed operations via BullMQ, stores retry
 *              metadata, supports manual reprocessing, and emits Prometheus metrics.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import { Queue, Worker, Job, QueueEvents } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";
import { v4 as uuidv4 } from "uuid";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";

const logger = pino({
  name: "dead-letter-queue",
  level: process.env.LOG_LEVEL || "info",
});

export interface FailedOperation {
  id: string;
  service: string;
  operation: string;
  args: unknown[];
  context: {
    originalError: Error;
    retryCount: number;
    firstAttempt: Date;
    lastAttempt: Date;
    fallbackAttempted: boolean;
    fallbackError?: Error;
  };
  metadata: {
    userId?: string;
    requestId?: string;
    priority: "critical" | "high" | "normal" | "low";
    source: string;
  };
  status: "pending" | "retrying" | "resolved" | "abandoned";
  createdAt: Date;
  updatedAt: Date;
}

export interface DeadLetterQueueConfig {
  redisUrl: string;
  queueName?: string;
  maxRetentionDays?: number;
  batchSize?: number;
  processingConcurrency?: number;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  backoffMultiplier: number;
  jitterEnabled: boolean;
}

/**
 * Compute deterministic jitter for retry delays.
 *
 * Uses Knuth's multiplicative hash to derive a pseudo-random factor
 * from the attempt number, producing repeatable jitter without
 * relying on `Math.random()`.
 *
 * @param attempt - The current retry attempt (0-based)
 * @param exponentialDelay - The base exponential delay in ms
 * @returns The delay with deterministic jitter applied (never negative)
 */
function computeDeterministicJitter(attempt: number, exponentialDelay: number): number {
  // Knuth's multiplicative hash constant (golden ratio * 2^32)
  const KNUTH_CONSTANT = 2654435761;
  const jitterFactor = ((attempt * KNUTH_CONSTANT) % 100) / 100;
  const jitterAmount = exponentialDelay * 0.25;
  const deterministicJitter = (jitterFactor - 0.5) * 2 * jitterAmount;
  return Math.max(0, exponentialDelay + deterministicJitter);
}

export class DeadLetterQueueManager {
  private redis: Redis;
  private queue: Queue;
  private worker: Worker | null = null;
  private queueEvents: QueueEvents;
  private config: Required<DeadLetterQueueConfig>;
  private isProcessing = false;

  /**
   * Registry that maps a service name to the BullMQ queue where its
   * failed operations should be re-enqueued.
   *
   * Consumers call `registerRetryTarget()` so the DLQ knows where to
   * send retries. If a service has no registered target the operation
   * is marked as `abandoned`.
   */
  private retryTargets: Map<string, string> = new Map();

  /**
   * Cache of BullMQ Queue instances keyed by queue name.
   * Created lazily on first use and reused for subsequent re-enqueue calls.
   */
  private retryQueues: Map<string, Queue> = new Map();

  constructor(config: DeadLetterQueueConfig) {
    this.config = {
      queueName: QUEUE_NAMES.DEAD_LETTER_QUEUE,
      maxRetentionDays: 30,
      batchSize: 10,
      processingConcurrency: 3,
      ...config,
    };

    this.redis = new Redis(this.config.redisUrl, {
      enableReadyCheck: false,
      maxRetriesPerRequest: null, // Required by BullMQ
      lazyConnect: true,
      // No commandTimeout: this connection backs both a BullMQ Worker and
      // a QueueEvents reader. Both issue blocking commands (BZPOPMIN,
      // XREAD BLOCK) that legitimately wait indefinitely for jobs/events.
      // Any commandTimeout interrupts those polls mid-flight and surfaces
      // as spurious "Command timed out" errors (BullMQ issue #2619).
      // Liveness via lockDuration + stalledInterval (BullMQ-side) and TCP
      // keepAlive (transport-side).
      connectTimeout: 10_000,
      keepAlive: 30_000,
    });

    this.queue = new Queue(this.config.queueName, {
      connection: this.redis,
      defaultJobOptions: {
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 500, // Keep last 500 failed jobs
        attempts: 1, // Dead letter jobs don't auto-retry
      },
    });

    this.queueEvents = new QueueEvents(this.config.queueName, {
      connection: this.redis,
    });

    this.setupEventListeners();
  }

  /**
   * Register a retry target so the DLQ knows where to re-enqueue
   * failed operations for a given service.
   *
   * @param service  - The logical service name (e.g. "publishing", "webhooks")
   * @param queueName - The BullMQ queue name to re-enqueue into
   */
  registerRetryTarget(service: string, queueName: string): void {
    this.retryTargets.set(service, queueName);
    logger.info({ service, queueName }, "Registered retry target for service");
  }

  private setupEventListeners(): void {
    this.queueEvents.on("completed", (jobId) => {
      logger.info(`Dead letter job ${jobId} completed`);
    });

    this.queueEvents.on("failed", (jobId, error) => {
      logger.error(`Dead letter job ${jobId} failed: ${error}`);
    });

    this.redis.on("error", (error) => {
      logger.error(`Redis connection error in dead letter queue: ${error}`);
    });
  }

  /**
   * Get or create a BullMQ Queue instance for re-enqueueing to a
   * specific target queue.
   */
  private getRetryQueue(queueName: string): Queue {
    const existing = this.retryQueues.get(queueName);
    if (existing) {
      return existing;
    }

    const retryQueue = new Queue(queueName, {
      connection: this.redis,
    });
    this.retryQueues.set(queueName, retryQueue);
    return retryQueue;
  }

  /**
   * Add a failed operation to the dead letter queue
   */
  async addFailedOperation(
    service: string,
    operation: string,
    args: unknown[],
    originalError: Error,
    context: {
      retryCount: number;
      firstAttempt: Date;
      fallbackAttempted: boolean;
      fallbackError?: Error;
      metadata?: {
        userId?: string;
        requestId?: string;
        priority?: "critical" | "high" | "normal" | "low";
        source?: string;
      };
    }
  ): Promise<Result<string, "QUEUE_ERROR">> {
    try {
      const failedOp: FailedOperation = {
        id: uuidv4(),
        service,
        operation,
        args,
        context: {
          originalError: {
            name: originalError.name,
            message: originalError.message,
            stack: originalError.stack,
          } as Error,
          retryCount: context.retryCount,
          firstAttempt: context.firstAttempt,
          lastAttempt: new Date(),
          fallbackAttempted: context.fallbackAttempted,
          ...(context.fallbackError
            ? {
                fallbackError: {
                  name: context.fallbackError.name,
                  message: context.fallbackError.message,
                  stack: context.fallbackError.stack,
                } as Error,
              }
            : {}),
        },
        metadata: {
          ...(context.metadata?.userId ? { userId: context.metadata.userId } : {}),
          ...(context.metadata?.requestId ? { requestId: context.metadata.requestId } : {}),
          priority: context.metadata?.priority || "normal",
          source: context.metadata?.source || "unknown",
        },
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Calculate priority score for job ordering
      const priorityScores = { critical: 100, high: 75, normal: 50, low: 25 };
      const priority = priorityScores[failedOp.metadata.priority];

      const _job = await this.queue.add("process-failed-operation", failedOp, {
        priority,
        delay: this.calculateInitialDelay(failedOp.metadata.priority),
        jobId: failedOp.id,
      });

      logger.warn(
        `Added failed operation to dead letter queue: ${JSON.stringify({
          id: failedOp.id,
          service,
          operation,
          priority: failedOp.metadata.priority,
          retryCount: context.retryCount,
        })}`
      );

      return ok(failedOp.id);
    } catch (error: unknown) {
      logger.error(`Failed to add operation to dead letter queue: ${error}`);
      return err("QUEUE_ERROR");
    }
  }

  /**
   * Start processing dead letter queue jobs
   */
  async startProcessing(): Promise<void> {
    if (this.isProcessing) {
      logger.warn("Dead letter queue processing already started");
      return;
    }

    this.worker = new Worker(
      this.config.queueName,
      async (job: Job) => {
        return this.processFailedOperation(job);
      },
      {
        connection: this.redis,
        concurrency: this.config.processingConcurrency,
      }
    );

    this.worker.on("completed", (job) => {
      logger.info(`Processed dead letter job ${job.id}`);
    });

    this.worker.on("failed", (job, error) => {
      logger.error(`Dead letter job ${job?.id} processing failed: ${error}`);
    });

    this.isProcessing = true;
    logger.info("Dead letter queue processing started");
  }

  /**
   * Stop processing dead letter queue jobs
   */
  async stopProcessing(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    this.isProcessing = false;
    logger.info("Dead letter queue processing stopped");
  }

  /**
   * Process a failed operation by re-enqueueing it to the original
   * service's queue. The DLQ does NOT execute the operation itself --
   * it only dispatches the job back so the worker that owns the
   * service can retry it.
   *
   * If max retries are reached or no retry target is registered for
   * the service, the operation is marked as `abandoned`.
   */
  private async processFailedOperation(job: Job): Promise<void> {
    const failedOp: FailedOperation = job.data;

    logger.info(
      `Processing dead letter operation ${failedOp.id}: ${JSON.stringify({
        service: failedOp.service,
        operation: failedOp.operation,
        priority: failedOp.metadata.priority,
        retryCount: failedOp.context.retryCount,
      })}`
    );

    const retryConfig: RetryConfig = {
      maxRetries: 5,
      baseDelay: 60000, // 1 minute
      maxDelay: 3600000, // 1 hour
      backoffMultiplier: 2,
      jitterEnabled: true,
    };

    // Check if max retries reached
    if (failedOp.context.retryCount >= retryConfig.maxRetries) {
      failedOp.status = "abandoned";
      failedOp.updatedAt = new Date();
      logger.error(
        `Operation ${failedOp.id} abandoned after ${failedOp.context.retryCount} retries (max: ${retryConfig.maxRetries})`
      );
      return;
    }

    // Resolve target queue name
    const targetQueueName = this.retryTargets.get(failedOp.service);

    if (!targetQueueName) {
      failedOp.status = "abandoned";
      failedOp.updatedAt = new Date();
      logger.error(
        `No retry target registered for service "${failedOp.service}". ` +
          `Call registerRetryTarget("${failedOp.service}", "<queue-name>") before processing. ` +
          `Operation ${failedOp.id} abandoned.`
      );
      return;
    }

    // Re-enqueue the job into the original service's queue
    try {
      failedOp.status = "retrying";
      failedOp.context.retryCount++;
      failedOp.context.lastAttempt = new Date();
      failedOp.updatedAt = new Date();

      const delay = calculateRetryDelay(
        failedOp.context.retryCount,
        retryConfig.baseDelay,
        retryConfig.maxDelay,
        retryConfig.backoffMultiplier,
        retryConfig.jitterEnabled
      );

      const retryQueue = this.getRetryQueue(targetQueueName);

      await retryQueue.add(
        failedOp.operation,
        {
          ...(failedOp.args[0] && typeof failedOp.args[0] === "object"
            ? (failedOp.args[0] as Record<string, unknown>)
            : {}),
          _dlqRetry: {
            dlqJobId: failedOp.id,
            retryCount: failedOp.context.retryCount,
            originalError: failedOp.context.originalError.message,
          },
        },
        {
          delay,
          jobId: `${failedOp.id}-retry-${failedOp.context.retryCount}`,
        }
      );

      logger.info(
        `Re-enqueued operation ${failedOp.id} to queue "${targetQueueName}": ${JSON.stringify({
          attempt: failedOp.context.retryCount,
          delaySeconds: Math.round(delay / 1000),
          operation: failedOp.operation,
        })}`
      );
    } catch (error: unknown) {
      logger.error(`Error re-enqueueing dead letter operation ${failedOp.id}: ${error}`);
      failedOp.status = "pending"; // Reset to pending for later retry
      throw error; // Let BullMQ handle the job failure
    }
  }

  private calculateInitialDelay(priority: "critical" | "high" | "normal" | "low"): number {
    // Critical operations retry immediately, others have initial delays
    const delays = {
      critical: 0,
      high: 30000, // 30 seconds
      normal: 300000, // 5 minutes
      low: 900000, // 15 minutes
    };
    return delays[priority];
  }

  /**
   * Get dead letter queue statistics
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const waiting = await this.queue.getWaiting();
    const active = await this.queue.getActive();
    const completed = await this.queue.getCompleted();
    const failed = await this.queue.getFailed();
    const delayed = await this.queue.getDelayed();

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
    };
  }

  /**
   * Get failed operations by status
   */
  async getFailedOperations(
    status?: "pending" | "retrying" | "resolved" | "abandoned",
    limit = 50
  ): Promise<FailedOperation[]> {
    const jobs = await this.queue.getJobs(
      ["waiting", "active", "completed", "failed", "delayed"],
      0,
      limit
    );

    return jobs
      .map((job) => job.data as FailedOperation)
      .filter((op) => !status || op.status === status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Manually retry a specific failed operation
   */
  async manualRetry(operationId: string): Promise<Result<void, "NOT_FOUND" | "QUEUE_ERROR">> {
    try {
      const jobs = await this.queue.getJobs(["waiting", "delayed", "failed"], 0, 1000);
      const job = jobs.find((j) => j.data.id === operationId);

      if (!job) {
        return err("NOT_FOUND");
      }

      const failedOp: FailedOperation = job.data;
      failedOp.status = "pending";
      failedOp.updatedAt = new Date();

      await this.queue.add("process-failed-operation", failedOp, {
        priority: 100, // High priority for manual retries
        jobId: `${operationId}-manual-${Date.now()}`,
      });

      logger.info(`Manually triggered retry for operation ${operationId}`);
      return ok(undefined);
    } catch (error: unknown) {
      logger.error(`Failed to manually retry operation ${operationId}: ${error}`);
      return err("QUEUE_ERROR");
    }
  }

  /**
   * Clean up old completed/failed jobs
   */
  async cleanup(): Promise<void> {
    const _cutoffDate = new Date();
    _cutoffDate.setDate(_cutoffDate.getDate() - this.config.maxRetentionDays);

    await this.queue.clean(this.config.maxRetentionDays * 24 * 60 * 60 * 1000, 0, "completed");
    await this.queue.clean(this.config.maxRetentionDays * 24 * 60 * 60 * 1000, 0, "failed");

    logger.info(
      `Cleaned up dead letter queue jobs older than ${this.config.maxRetentionDays} days`
    );
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    await this.stopProcessing();
    await this.queueEvents.close();
    await this.queue.close();

    // Close all retry queue connections
    for (const [name, retryQueue] of this.retryQueues) {
      try {
        await retryQueue.close();
      } catch (error) {
        logger.warn(`Failed to close retry queue "${name}": ${error}`);
      }
    }
    this.retryQueues.clear();

    await this.redis.quit();
  }
}

/**
 * Calculate retry delay with exponential backoff and optional
 * deterministic jitter.
 *
 * When jitter is enabled, uses Knuth's multiplicative hash instead of
 * `Math.random()` so the delay is reproducible for a given attempt.
 */
export function calculateRetryDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  multiplier: number,
  jitter: boolean
): number {
  const exponentialDelay = Math.min(baseDelay * Math.pow(multiplier, attempt), maxDelay);

  if (!jitter) {
    return exponentialDelay;
  }

  return computeDeterministicJitter(attempt, exponentialDelay);
}

// Global instance
let globalDeadLetterQueue: DeadLetterQueueManager | null = null;

export function createDeadLetterQueue(config: DeadLetterQueueConfig): DeadLetterQueueManager {
  if (!globalDeadLetterQueue) {
    globalDeadLetterQueue = new DeadLetterQueueManager(config);
  }
  return globalDeadLetterQueue;
}

export function getDeadLetterQueue(): DeadLetterQueueManager | null {
  return globalDeadLetterQueue;
}

export function resetDeadLetterQueue(): void {
  globalDeadLetterQueue = null;
}
