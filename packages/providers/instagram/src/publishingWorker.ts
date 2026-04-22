import { InstagramApiClient, type InstagramCredentials } from "./apiClient.js";
import { InstagramMediaProcessor } from "./mediaProcessor.js";
import { createBullMQConsumerAdapter, createBullMQQueueAdapter } from "@adapters/queue-bullmq";
import { createExternalApiCircuitBreaker } from "@adapters/external-apis";
import { createPrismaRepoAdapter } from "@adapters/db-prisma";
import {
  isOk,
  isErr as _isErr,
  unwrap as _unwrap,
  AppError,
  type Result as _Result,
} from "@shared/types";
import client from "prom-client";
import { createLogger } from "@observability/logger";

const logger = createLogger("provider:instagram:publishing-worker");

/**
 * Validate required environment variables
 */
function validateEnvironment(): void {
  const requiredVars = ["AWS_REGION", "AWS_S3_BUCKET"];

  const optionalVars = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_ENDPOINT", "REDIS_URL"];

  const missing = requiredVars.filter((v) => !process.env[v]);

  if (missing.length > 0) {
    throw AppError.configuration(`Missing required environment variables: ${missing.join(", ")}`);
  }

  logger.info(
    { requiredVars, optionalVars: optionalVars.filter((v) => process.env[v]) },
    "Environment validation passed"
  );
}

export interface InstagramPublishPayload {
  type: "instagram_publish";
  contentType: "FEED" | "STORIES" | "REELS" | "CAROUSEL";
  credentials: InstagramCredentials;
  content: {
    text?: string;
    media?: Array<{
      url: string;
      type: "image" | "video";
      alt?: string;
    }>;
  };
  options?: {
    shareToFeed?: boolean;
    enableRemixing?: boolean;
  };
  accountId: string;
  projectId: string;
  postId?: string;
  channelId?: string;
  queueId: string;
  retryCount: number;
  maxRetries: number;
}

export interface PublishResult {
  success: boolean;
  providerPostId?: string;
  url?: string;
  publishedAt?: Date;
  error?: string;
  retryable?: boolean;
}

// Global registry for circuit breaker metrics
const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);

export class InstagramPublishingWorker {
  private consumerAdapter = createBullMQConsumerAdapter();
  private queueAdapter = createBullMQQueueAdapter();
  private repoAdapter = createPrismaRepoAdapter();
  private mediaProcessor: InstagramMediaProcessor;
  private isRunning = false;

  constructor() {
    // Validate environment variables on construction
    validateEnvironment();

    this.mediaProcessor = new InstagramMediaProcessor();
  }

  /**
   * Start the publishing worker
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Instagram publishing worker is already running");
      return;
    }

    try {
      logger.info("Starting Instagram publishing worker");

      await this.consumerAdapter.subscribe(
        {
          concurrency: 3, // Process up to 3 Instagram jobs concurrently
          removeOnComplete: 100,
          removeOnFail: 50,
        },
        async (job) => {
          await this.processJob(job);
        }
      );

      this.isRunning = true;
      logger.info("Instagram publishing worker started successfully");
    } catch (error) {
      logger.error({ err: error }, "Failed to start Instagram publishing worker");
      throw error;
    }
  }

  /**
   * Stop the publishing worker
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      await this.consumerAdapter.close();
      this.isRunning = false;
      logger.info("Instagram publishing worker stopped");
    } catch (error) {
      logger.error({ err: error }, "Error stopping Instagram publishing worker");
      throw error;
    }
  }

  /**
   * Process a single publishing job
   */
  private async processJob(job: {
    payload: Record<string, unknown>;
    dedupeKey: string;
  }): Promise<void> {
    // Validate and cast payload
    if (!job.payload || typeof job.payload !== "object") {
      throw AppError.badRequest("Invalid job payload");
    }
    const payload = job.payload as unknown as InstagramPublishPayload;

    logger.info(
      { contentType: payload.contentType, dedupeKey: job.dedupeKey },
      "Processing Instagram job"
    );

    try {
      const result = await this.publishContent(payload);

      if (result.success) {
        logger.info(
          { contentType: payload.contentType, providerPostId: result.providerPostId },
          "Successfully published Instagram content"
        );
        // Update the database with success status
        await this.updatePublishingQueue(payload.queueId, "PUBLISHED", result, payload);
      } else {
        logger.error(
          { contentType: payload.contentType, error: result.error },
          "Failed to publish Instagram content"
        );

        if (result.retryable && payload.retryCount < payload.maxRetries) {
          // Schedule retry
          logger.info(
            {
              retryCount: payload.retryCount + 1,
              maxRetries: payload.maxRetries,
              dedupeKey: job.dedupeKey,
            },
            "Scheduling retry"
          );
          await this.scheduleRetry(payload);
        } else {
          // Mark as failed
          await this.updatePublishingQueue(payload.queueId, "FAILED", result, payload);
        }
      }
    } catch (error) {
      logger.error(
        { err: error, dedupeKey: job.dedupeKey },
        "Unexpected error processing Instagram job"
      );
      await this.updatePublishingQueue(
        payload.queueId,
        "FAILED",
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          retryable: false,
        },
        payload
      );
    }
  }

  /**
   * Publish content to Instagram based on content type
   */
  private async publishContent(payload: InstagramPublishPayload): Promise<PublishResult> {
    const publishCall = async (): Promise<PublishResult> => {
      const apiClient = new InstagramApiClient(payload.credentials);

      try {
        switch (payload.contentType) {
          case "FEED":
            return await this.publishFeedPost(apiClient, payload);
          case "STORIES":
            return await this.publishStory(apiClient, payload);
          case "REELS":
            return await this.publishReel(apiClient, payload);
          case "CAROUSEL":
            return await this.publishCarousel(apiClient, payload);
          default:
            return {
              success: false,
              error: `Unsupported content type: ${payload.contentType}`,
              retryable: false,
            };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isRetryable = this.isRetryableError(error);

        return {
          success: false,
          error: errorMessage,
          retryable: isRetryable,
        };
      }
    };

    try {
      return await circuitBreaker.call(
        "publish-content",
        payload.contentType.toLowerCase(),
        publishCall,
        [],
        {
          timeout: 120000, // 2 minutes for content publishing
          maxRetries: 1,
          baseDelay: 2000,
          jitterEnabled: true,
        }
      );
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        retryable: this.isRetryableError(error),
      };
    }
  }

  /**
   * Publish a regular feed post
   */
  private async publishFeedPost(
    apiClient: InstagramApiClient,
    payload: InstagramPublishPayload
  ): Promise<PublishResult> {
    if (!payload.content.media || payload.content.media.length === 0) {
      return {
        success: false,
        error: "Feed posts require at least one media item",
        retryable: false,
      };
    }

    const media = payload.content.media[0];
    if (!media) {
      return {
        success: false,
        error: "No media found in feed post",
        retryable: false,
      };
    }

    const mediaType = media.type === "video" ? "VIDEO" : "IMAGE";

    // Create media container
    const container = await apiClient.createMediaContainer(
      media.url,
      payload.content.text,
      mediaType
    );

    // Wait for container to be ready
    await this.waitForContainer(apiClient, container.id);

    // Publish the media
    const result = await apiClient.publishMedia(container.id);

    return {
      success: true,
      providerPostId: result.id,
      url: result.permalink,
      publishedAt: new Date(result.timestamp),
    };
  }

  /**
   * Publish an Instagram Story
   */
  private async publishStory(
    apiClient: InstagramApiClient,
    payload: InstagramPublishPayload
  ): Promise<PublishResult> {
    if (!payload.content.media || payload.content.media.length === 0) {
      return {
        success: false,
        error: "Stories require at least one media item",
        retryable: false,
      };
    }

    const media = payload.content.media[0];
    if (!media) {
      return {
        success: false,
        error: "No media found in story",
        retryable: false,
      };
    }

    const mediaType = media.type === "video" ? "VIDEO" : "IMAGE";

    // Create Stories container
    const container = await apiClient.createStoriesContainer(media.url, mediaType);

    // Wait for container to be ready
    await this.waitForContainer(apiClient, container.id);

    // Publish the story
    const result = await apiClient.publishMedia(container.id);

    return {
      success: true,
      providerPostId: result.id,
      url: result.permalink,
      publishedAt: new Date(result.timestamp),
    };
  }

  /**
   * Publish an Instagram Reel
   */
  private async publishReel(
    apiClient: InstagramApiClient,
    payload: InstagramPublishPayload
  ): Promise<PublishResult> {
    if (
      !payload.content.media ||
      payload.content.media.length !== 1 ||
      payload.content.media[0]?.type !== "video"
    ) {
      return {
        success: false,
        error: "Reels require exactly one video",
        retryable: false,
      };
    }

    const media = payload.content.media[0];
    if (!media) {
      return {
        success: false,
        error: "No media found in reel",
        retryable: false,
      };
    }

    // Validate video for Reels (max 90 seconds)
    const validationResult = await this.mediaProcessor.validateVideo(media.url, "REELS");
    if (!validationResult.valid) {
      return {
        success: false,
        error: `Video validation failed: ${validationResult.issues.join(", ")}`,
        retryable: false,
      };
    }

    // Optimize video if needed
    const optimizedVideoUrl = await this.mediaProcessor.optimizeForReels(media.url);

    // Create Reels container
    const container = await apiClient.createReelsContainer(
      optimizedVideoUrl,
      payload.content.text,
      payload.options?.shareToFeed ?? true,
      payload.options?.enableRemixing ?? true
    );

    // Wait for container to be ready (Reels may take longer to process)
    await this.waitForContainer(apiClient, container.id, 180000); // 3 minutes timeout

    // Publish the reel
    const result = await apiClient.publishMedia(container.id);

    return {
      success: true,
      providerPostId: result.id,
      url: result.permalink,
      publishedAt: new Date(result.timestamp),
    };
  }

  /**
   * Publish an Instagram Carousel
   */
  private async publishCarousel(
    apiClient: InstagramApiClient,
    payload: InstagramPublishPayload
  ): Promise<PublishResult> {
    if (
      !payload.content.media ||
      payload.content.media.length < 2 ||
      payload.content.media.length > 10
    ) {
      return {
        success: false,
        error: "Carousel posts require 2-10 media items",
        retryable: false,
      };
    }

    const carouselItems = payload.content.media.map((media) => ({
      media_type: (media.type === "video" ? "VIDEO" : "IMAGE") as "IMAGE" | "VIDEO",
      media_url: media.url,
    }));

    // Create carousel container
    const container = await apiClient.createCarouselContainer(carouselItems, payload.content.text);

    // Wait for container to be ready
    await this.waitForContainer(apiClient, container.id);

    // Publish the carousel
    const result = await apiClient.publishMedia(container.id);

    return {
      success: true,
      providerPostId: result.id,
      url: result.permalink,
      publishedAt: new Date(result.timestamp),
    };
  }

  /**
   * Wait for Instagram media container to be ready
   */
  private async waitForContainer(
    apiClient: InstagramApiClient,
    containerId: string,
    timeout = 60000
  ): Promise<void> {
    const maxAttempts = Math.floor(timeout / 1000); // 1 second between checks
    const delay = 1000;

    for (let i = 0; i < maxAttempts; i++) {
      const status = await apiClient.getContainerStatus(containerId);

      if (status.status === "FINISHED") {
        return;
      }

      if (status.status === "ERROR") {
        throw AppError.externalService(
          "instagram",
          `Media container failed: ${status.status_code}`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    throw AppError.externalService("instagram", "Media container timeout");
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const retryableErrors = [
      "timeout",
      "network",
      "connection",
      "temporary",
      "rate limit",
      "server error",
      "503",
      "502",
      "500",
    ];

    const errorMessage = error.message.toLowerCase();
    return retryableErrors.some((retryableError) => errorMessage.includes(retryableError));
  }

  /**
   * Schedule a retry for a failed job
   */
  private async scheduleRetry(payload: InstagramPublishPayload): Promise<void> {
    try {
      // Exponential backoff: 1min, 2min, 4min, 8min, etc.
      const backoffMs = Math.min(60000 * Math.pow(2, payload.retryCount), 30 * 60000); // Max 30 minutes
      const retryAt = new Date(Date.now() + backoffMs);

      // Create updated payload with incremented retry count
      const retryPayload: InstagramPublishPayload = {
        ...payload,
        retryCount: payload.retryCount + 1,
      };

      // Re-enqueue the job with delay
      const enqueueResult = await this.queueAdapter.enqueue({
        payload: retryPayload as unknown as Record<string, unknown>,
        dedupeKey: `${payload.queueId}_retry_${retryPayload.retryCount}`,
        runAt: retryAt,
      });

      if (enqueueResult.ok) {
        logger.info(
          { retryAt: retryAt.toISOString(), jobId: enqueueResult.value },
          "Retry scheduled"
        );

        // Update database with retry status
        await this.updatePublishingQueue(
          payload.queueId,
          "RETRY_SCHEDULED",
          {
            success: false,
            error: "Retry scheduled",
            retryable: true,
          },
          payload
        );
      } else {
        logger.error({ error: enqueueResult.error }, "Failed to schedule retry");

        // Mark as failed if we can't schedule retry
        await this.updatePublishingQueue(
          payload.queueId,
          "FAILED",
          {
            success: false,
            error: `Retry scheduling failed: ${String(enqueueResult.error)}`,
            retryable: false,
          },
          payload
        );
      }
    } catch (error) {
      logger.error({ err: error }, "Error scheduling retry");

      // Mark as failed if retry scheduling fails
      await this.updatePublishingQueue(
        payload.queueId,
        "FAILED",
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          retryable: false,
        },
        payload
      );
    }
  }

  /**
   * Update the publishing queue status in the database
   */
  private async updatePublishingQueue(
    queueId: string,
    status: string,
    result: PublishResult,
    payload?: InstagramPublishPayload
  ): Promise<void> {
    try {
      // Map status to database publish log status
      let logStatus: "QUEUED" | "RUNNING" | "OK" | "ERR";
      switch (status) {
        case "PUBLISHED":
          logStatus = "OK";
          break;
        case "FAILED":
          logStatus = "ERR";
          break;
        case "RETRY_SCHEDULED":
          logStatus = "RUNNING";
          break;
        default:
          logStatus = "RUNNING";
      }

      // Create or update publish log entry
      const logPayload = {
        success: result.success,
        ...(result.providerPostId && { providerPostId: result.providerPostId }),
        ...(result.url && { url: result.url }),
        ...(result.publishedAt && { publishedAt: result.publishedAt }),
        ...(result.error && { error: result.error }),
        ...(result.retryable !== undefined && { retryable: result.retryable }),
        status: logStatus,
        updatedAt: new Date(),
      };

      const updateResult = await this.repoAdapter.logPublish({
        postId: payload?.postId || queueId.split("_")[0] || "", // Use postId from payload or extract from queueId
        provider: "instagram",
        channelId: payload?.channelId || queueId.split("_")[1] || "", // Use channelId from payload or extract from queueId
        status: logStatus,
        payload: logPayload,
        dedupeKey: queueId,
      });

      if (isOk(updateResult)) {
        logger.info({ queueId, status }, "Database updated for queue");
      } else {
        logger.error({ queueId, error: updateResult.error }, "Failed to update database for queue");
      }
    } catch (error) {
      logger.error({ err: error, queueId }, "Database update error for queue");
    }
  }

  /**
   * Get worker health status
   */
  getHealth() {
    return {
      isRunning: this.isRunning,
      circuitBreakerStatus: circuitBreaker.getAllStatuses(),
    };
  }

  /**
   * Get metrics registry for monitoring
   */
  static getMetricsRegistry(): client.Registry {
    return registry;
  }
}

// Export convenience function for creating the worker
export function createInstagramPublishingWorker(): InstagramPublishingWorker {
  return new InstagramPublishingWorker();
}
