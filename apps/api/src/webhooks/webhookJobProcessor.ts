/**
 * @file webhookJobProcessor.ts
 * @description BullMQ worker for asynchronous webhook event processing with retry logic,
 *              provider-specific dispatching, and dead-letter queue support.
 * @layer infrastructure
 */
import { Worker, Job, Queue } from "bullmq";
import Redis from "ioredis";
import { UniversalWebhookHandler } from "./webhookHandler.js";
import type { WebhookEventType, Provider, PrismaClient } from "@infra/prisma";
import { webhookLogger } from "../lib/logger.js";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";
import type { MentionFetchEnqueue, MentionFetchJob } from "./mentionFetchEnqueue.js";

export interface WebhookJobData {
  eventId: string;
  provider: Provider;
  eventType: WebhookEventType;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  signature: string;
  accountId?: string;
  projectId?: string;
  retryCount: number;
  originalReceivedAt: string;
}

export interface WebhookJobResult {
  success: boolean;
  processedAt: string;
  processingTimeMs: number;
  normalizedData?: Record<string, unknown>;
  error?: string;
}

/**
 * Webhook Job Processor
 * Handles webhook events as background jobs with retry logic and dead letter queues
 */
export class WebhookJobProcessor {
  private webhookQueue: Queue<WebhookJobData, WebhookJobResult>;
  private deadLetterQueue: Queue<WebhookJobData, WebhookJobResult>;
  private mentionIngestQueue: Queue<MentionFetchJob>;
  private worker!: Worker<WebhookJobData, WebhookJobResult>;
  private deadLetterWorker!: Worker<WebhookJobData, WebhookJobResult>;
  private redis: Redis;
  private readonly prisma: PrismaClient;
  private webhookHandler: UniversalWebhookHandler;

  constructor(redisConnection: Redis, prisma: PrismaClient) {
    this.redis = redisConnection;
    this.prisma = prisma;

    // Mention-fetch producer: a mention webhook is a notification, so the
    // handler enqueues a fetch-before-process job for the mention-ingest worker.
    this.mentionIngestQueue = new Queue<MentionFetchJob>(QUEUE_NAMES.MENTION_INGEST, {
      connection: this.redis,
      defaultJobOptions: {
        removeOnComplete: 200,
        removeOnFail: 100,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      },
    });
    const mentionEnqueue: MentionFetchEnqueue = async (job) => {
      await this.mentionIngestQueue.add("mention-fetch", job, {
        jobId: `mention-fetch-${job.provider}-${job.providerMentionId}`,
      });
    };
    this.webhookHandler = new UniversalWebhookHandler(prisma, undefined, mentionEnqueue);

    // Initialize queues
    this.webhookQueue = new Queue<WebhookJobData, WebhookJobResult>(
      QUEUE_NAMES.WEBHOOK_PROCESSING,
      {
        connection: this.redis,
        defaultJobOptions: {
          removeOnComplete: 100, // Keep last 100 completed jobs
          removeOnFail: 50, // Keep last 50 failed jobs
          attempts: 3, // Retry up to 3 times
          backoff: {
            type: "exponential",
            delay: 5000, // Start with 5 second delay
          },
          delay: 0, // Process immediately
        },
      }
    );

    this.deadLetterQueue = new Queue<WebhookJobData, WebhookJobResult>(
      QUEUE_NAMES.WEBHOOK_DEAD_LETTER,
      {
        connection: this.redis,
        defaultJobOptions: {
          removeOnComplete: 1000, // Keep more dead letter records
          removeOnFail: 1000,
          attempts: 1, // No retries for dead letter queue
        },
      }
    );

    // Initialize workers
    this.initializeWorkers();
  }

  /**
   * Initialize background workers for processing webhook events
   */
  private initializeWorkers(): void {
    // Main webhook processing worker
    this.worker = new Worker<WebhookJobData, WebhookJobResult>(
      QUEUE_NAMES.WEBHOOK_PROCESSING,
      async (job) => this.processWebhookJob(job),
      {
        connection: this.redis,
        concurrency: 10, // Process up to 10 webhooks concurrently
        limiter: {
          max: 100, // Maximum 100 jobs per duration
          duration: 60000, // 1 minute
        },
      }
    );

    // Dead letter queue worker (for manual intervention)
    this.deadLetterWorker = new Worker<WebhookJobData, WebhookJobResult>(
      QUEUE_NAMES.WEBHOOK_DEAD_LETTER,
      async (job) => this.processDeadLetterJob(job),
      {
        connection: this.redis,
        concurrency: 1, // Process dead letters one at a time
      }
    );

    // Set up event listeners
    this.setupEventListeners();
  }

  /**
   * Set up event listeners for job processing
   */
  private setupEventListeners(): void {
    // Main worker events
    this.worker.on("completed", async (job, result) => {
      webhookLogger.info(
        { jobId: job.id, processingTimeMs: result.processingTimeMs },
        "Webhook job completed successfully"
      );
      await this.updateWebhookEventStatus(job.data.eventId, "COMPLETED", result);
    });

    this.worker.on("failed", async (job, error) => {
      webhookLogger.error({ err: error, jobId: job?.id }, "Webhook job failed");

      if (job) {
        const shouldMoveToDeadLetter = job.attemptsMade >= (job.opts?.attempts || 3);

        if (shouldMoveToDeadLetter) {
          // Move to dead letter queue
          await this.moveToDeadLetterQueue(job.data, error.message);
          await this.updateWebhookEventStatus(job.data.eventId, "DEAD_LETTER", {
            success: false,
            processedAt: new Date().toISOString(),
            processingTimeMs: 0,
            error: error.message,
          });
        } else {
          // Update retry status
          await this.updateWebhookEventStatus(job.data.eventId, "RETRYING", {
            success: false,
            processedAt: new Date().toISOString(),
            processingTimeMs: 0,
            error: error.message,
          });
        }
      }
    });

    this.worker.on("stalled", async (jobId, prev) => {
      webhookLogger.warn({ jobId, prev }, "Webhook job stalled");
    });

    // Dead letter worker events
    this.deadLetterWorker.on("completed", async (job, result) => {
      webhookLogger.info({ jobId: job.id, recovered: result.success }, "Dead letter job processed");

      if (result.success) {
        // Remove from dead letter database if recovered
        await this.prisma.webhookDeadLetter.deleteMany({
          where: { originalEventId: job.data.eventId },
        });
      }
    });

    this.deadLetterWorker.on("failed", async (job, error) => {
      webhookLogger.error({ err: error, jobId: job?.id }, "Dead letter job failed permanently");
    });
  }

  /**
   * @method addWebhookJob
   * @description Adds a webhook event to the BullMQ processing queue with calculated priority and delay.
   * @param jobData - The webhook job payload including provider, event type, and raw data
   * @returns The assigned BullMQ job ID
   */
  async addWebhookJob(jobData: WebhookJobData): Promise<string> {
    const job = await this.webhookQueue.add("process-webhook", jobData, {
      jobId: `webhook-${jobData.provider}-${jobData.eventId}`,
      priority: this.calculateJobPriority(jobData),
      delay: this.calculateInitialDelay(jobData),
    });

    return job.id as string;
  }

  /**
   * Process webhook job
   */
  private async processWebhookJob(
    job: Job<WebhookJobData, WebhookJobResult>
  ): Promise<WebhookJobResult> {
    const startTime = Date.now();
    const { provider, signature, payload, headers, eventId: _eventId } = job.data;

    try {
      // Update job status
      await job.updateProgress(10);

      // Process the webhook using the universal handler
      const result = await this.webhookHandler.handleWebhook(
        provider,
        signature,
        JSON.stringify(payload),
        headers
      );

      await job.updateProgress(90);

      if (!result.success) {
        throw new Error(result.error || "Webhook processing failed");
      }

      await job.updateProgress(100);

      return {
        success: true,
        processedAt: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
        ...(result.normalizedData !== undefined ? { normalizedData: result.normalizedData } : {}),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        success: false,
        processedAt: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
        error: errorMessage,
      };
    }
  }

  /**
   * Process dead letter queue job (manual recovery)
   */
  private async processDeadLetterJob(
    job: Job<WebhookJobData, WebhookJobResult>
  ): Promise<WebhookJobResult> {
    // Try to reprocess the failed webhook
    try {
      const result = await this.processWebhookJob(job);

      if (result.success) {
        // Mark as recovered in database
        await this.prisma.webhookDeadLetter.updateMany({
          where: { originalEventId: job.data.eventId },
          data: {
            resolvedAt: new Date(),
            resolvedBy: "system_recovery",
          },
        });
      }

      return result;
    } catch (error) {
      return {
        success: false,
        processedAt: new Date().toISOString(),
        processingTimeMs: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Move failed job to dead letter queue
   */
  private async moveToDeadLetterQueue(jobData: WebhookJobData, error: string): Promise<void> {
    // Add to dead letter queue for manual intervention
    await this.deadLetterQueue.add(
      "process-dead-letter",
      {
        ...jobData,
        retryCount: jobData.retryCount + 1,
      },
      {
        jobId: `dead-letter-${jobData.provider}-${jobData.eventId}`,
        priority: 1, // Low priority for dead letters
        delay: 24 * 60 * 60 * 1000, // Wait 24 hours before attempting recovery
      }
    );

    // Update database record
    await this.prisma.webhookDeadLetter.upsert({
      where: { originalEventId: jobData.eventId },
      create: {
        originalEventId: jobData.eventId,
        provider: jobData.provider,
        eventType: jobData.eventType,
        payload: jobData.payload as Record<string, string | number | boolean | null>,
        headers: jobData.headers as Record<string, string>,
        failureReason: error,
        finalError: error,
        retryCount: jobData.retryCount,
        firstFailedAt: new Date(),
        lastRetryAt: new Date(),
      },
      update: {
        finalError: error,
        retryCount: jobData.retryCount,
        lastRetryAt: new Date(),
      },
    });
  }

  /**
   * Update webhook event status in database
   */
  private async updateWebhookEventStatus(
    eventId: string,
    status: "PROCESSING" | "COMPLETED" | "FAILED" | "RETRYING" | "DEAD_LETTER",
    result: WebhookJobResult
  ): Promise<void> {
    try {
      const updateData: Record<string, unknown> = {
        status,
        processed: result.success,
        processingTime: result.processingTimeMs,
      };
      if (result.success && result.processedAt) {
        updateData.processedAt = new Date(result.processedAt);
      }
      if (result.normalizedData) {
        updateData.normalizedData = result.normalizedData as Record<
          string,
          string | number | boolean | null
        >;
      }
      if (result.error) {
        updateData.lastError = result.error;
      }

      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: updateData,
      });
    } catch (error) {
      webhookLogger.error({ err: error }, "Failed to update webhook event status");
    }
  }

  /**
   * Calculate job priority based on event type and provider
   */
  private calculateJobPriority(jobData: WebhookJobData): number {
    // Higher priority for engagement events
    if (
      jobData.eventType === "LIKE_RECEIVED" ||
      jobData.eventType === "COMMENT_RECEIVED" ||
      jobData.eventType === "SHARE_RECEIVED"
    ) {
      return 10;
    }

    // Medium priority for post events
    if (jobData.eventType === "POST_PUBLISHED" || jobData.eventType === "POST_UPDATED") {
      return 5;
    }

    // Lower priority for other events
    return 1;
  }

  /**
   * Calculate initial delay for job processing
   */
  private calculateInitialDelay(jobData: WebhookJobData): number {
    // No delay for first attempt
    if (jobData.retryCount === 0) {
      return 0;
    }

    // Exponential backoff for retries
    return Math.min(300000, 5000 * Math.pow(2, jobData.retryCount - 1)); // Max 5 minutes
  }

  /**
   * @method getQueueStats
   * @description Returns current job counts across the webhook and dead-letter queues.
   * @returns Object with waiting, active, completed, failed, and dead-letter counts
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    deadLetter: number;
  }> {
    const [waiting, active, completed, failed] = await Promise.all([
      this.webhookQueue.getWaiting(),
      this.webhookQueue.getActive(),
      this.webhookQueue.getCompleted(),
      this.webhookQueue.getFailed(),
    ]);

    const deadLetter = await this.deadLetterQueue.getWaiting();

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      deadLetter: deadLetter.length,
    };
  }

  /**
   * @method retryDeadLetterJobs
   * @description Moves all dead-letter jobs back to the main processing queue with reset retry counts.
   * @param maxAge - Optional minimum received date; events older than this are skipped
   * @returns The number of jobs successfully re-enqueued
   */
  async retryDeadLetterJobs(maxAge?: Date): Promise<number> {
    const deadLetterJobs = await this.deadLetterQueue.getJobs(["waiting", "failed"]);
    let retriedCount = 0;

    for (const job of deadLetterJobs) {
      if (maxAge && new Date(job.data.originalReceivedAt) < maxAge) {
        continue;
      }

      // Move back to main processing queue
      await this.addWebhookJob({
        ...job.data,
        retryCount: 0, // Reset retry count for manual retry
      });

      // Remove from dead letter queue
      await job.remove();
      retriedCount++;
    }

    return retriedCount;
  }

  /**
   * @method cleanupOldJobs
   * @description Removes old completed and failed jobs from the webhook and dead-letter queues.
   * @param maxAge - The cutoff date; jobs older than this are removed
   * @returns Object with counts of cleaned jobs from each queue
   */
  async cleanupOldJobs(maxAge: Date): Promise<{
    webhookQueueCleaned: number;
    deadLetterQueueCleaned: number;
  }> {
    const webhookCleaned = await this.webhookQueue.clean(
      Date.now() - maxAge.getTime(),
      0,
      "completed"
    );

    const deadLetterCleaned = await this.deadLetterQueue.clean(
      Date.now() - maxAge.getTime(),
      0,
      "failed"
    );

    return {
      webhookQueueCleaned: webhookCleaned.length,
      deadLetterQueueCleaned: deadLetterCleaned.length,
    };
  }

  /**
   * @method shutdown
   * @description Gracefully shuts down all BullMQ workers and closes both processing queues.
   * @returns Resolves when all workers and queues are fully closed
   */
  async shutdown(): Promise<void> {
    webhookLogger.info("Shutting down webhook job processor");

    await Promise.all([this.worker.close(), this.deadLetterWorker.close()]);

    await Promise.all([
      this.webhookQueue.close(),
      this.deadLetterQueue.close(),
      this.mentionIngestQueue.close(),
    ]);

    webhookLogger.info("Webhook job processor shutdown complete");
  }
}

/**
 * Initialize webhook job processor
 */
export function createWebhookJobProcessor(redis: Redis, prisma: PrismaClient): WebhookJobProcessor {
  return new WebhookJobProcessor(redis, prisma);
}
