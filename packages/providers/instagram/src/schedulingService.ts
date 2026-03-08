import { ok, err, AppError, type Result } from "@shared/types";
import { type InstagramCredentials } from "./apiClient.js";
import { InstagramMediaProcessor, type VideoSplitOptions } from "./mediaProcessor.js";
import { createExternalApiCircuitBreaker } from "@adapters/external-apis";
import { createBullMQQueueAdapter } from "@adapters/queue-bullmq";
import client from "prom-client";
import { createLogger } from "@observability/logger";

const logger = createLogger("provider:instagram:scheduling");

export interface InstagramScheduleJob {
  id: string;
  accountId: string;
  projectId: string;
  queueId: string;
  contentType: "FEED" | "STORIES" | "REELS" | "CAROUSEL";
  content: {
    text?: string;
    media?: Array<{
      url: string;
      type: "image" | "video";
      alt?: string;
    }>;
  };
  options?: {
    shareToFeed?: boolean; // For Reels
    enableRemixing?: boolean; // For Reels
    videoSplitOptions?: VideoSplitOptions; // For Stories video splitting
    storyDuration?: number; // For Stories
  };
  scheduledAt: Date;
  timezone: string;
  retryCount: number;
  maxRetries: number;
}

export interface ScheduleResult {
  success: boolean;
  queueJobId?: string;
  scheduledAt: Date;
  estimatedPublishTime: Date;
  error?: string;
}

export interface InstagramScheduleOptions {
  optimizeForEngagement?: boolean; // Post at optimal times
  respectRateLimits?: boolean;
  autoRetry?: boolean;
  maxRetries?: number;
}

// Global registry for circuit breaker metrics
const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);

export class InstagramSchedulingService {
  private queueAdapter = createBullMQQueueAdapter();
  private mediaProcessor: InstagramMediaProcessor;

  constructor() {
    this.mediaProcessor = new InstagramMediaProcessor();
  }

  /**
   * Schedule a single Instagram post (Feed, Reel, or single Story)
   */
  async schedulePost(
    credentials: InstagramCredentials,
    job: InstagramScheduleJob,
    options: InstagramScheduleOptions = {}
  ): Promise<
    Result<ScheduleResult, "VALIDATION_ERROR" | "RATE_LIMIT" | "AUTH_ERROR" | "QUEUE_ERROR">
  > {
    const scheduleCall = async (): Promise<ScheduleResult> => {
      // Validate content based on type
      const validationResult = await this.validateScheduledContent(job);
      if (!validationResult.ok) {
        throw AppError.validationFailed(`Validation failed: ${validationResult.error}`);
      }

      // Check optimal posting time if requested
      const finalScheduleTime = options.optimizeForEngagement
        ? this.optimizeScheduleTime(job.scheduledAt, job.timezone)
        : job.scheduledAt;

      // Create queue job payload
      const queuePayload = {
        type: "instagram_publish",
        contentType: job.contentType,
        credentials,
        content: job.content,
        options: job.options,
        accountId: job.accountId,
        projectId: job.projectId,
        queueId: job.queueId,
        retryCount: job.retryCount,
        maxRetries: options.maxRetries || job.maxRetries,
      };

      // Enqueue the job
      const queueResult = await this.queueAdapter.enqueue({
        dedupeKey: `instagram-${job.queueId}-${job.scheduledAt.getTime()}`,
        runAt: finalScheduleTime,
        payload: queuePayload,
      });

      if (!queueResult.ok) {
        throw AppError.externalService("bullmq", `Queue error: ${queueResult.error}`);
      }

      return {
        success: true,
        queueJobId: queueResult.value,
        scheduledAt: finalScheduleTime,
        estimatedPublishTime: finalScheduleTime,
      };
    };

    try {
      const result = await circuitBreaker.call("schedule-post", "schedule", scheduleCall, [], {
        timeout: 30000,
        maxRetries: 2,
        baseDelay: 1000,
        jitterEnabled: true,
      });

      return ok(result);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("Validation failed")) {
        return err("VALIDATION_ERROR");
      }
      if (errorMessage.includes("Rate limit")) {
        return err("RATE_LIMIT");
      }
      if (errorMessage.includes("Auth")) {
        return err("AUTH_ERROR");
      }
      if (errorMessage.includes("Queue error")) {
        return err("QUEUE_ERROR");
      }

      return err("QUEUE_ERROR");
    }
  }

  /**
   * Schedule Instagram Stories with automatic video splitting
   */
  async scheduleStories(
    credentials: InstagramCredentials,
    job: InstagramScheduleJob,
    options: InstagramScheduleOptions = {}
  ): Promise<Result<ScheduleResult[], "VALIDATION_ERROR" | "PROCESSING_ERROR" | "QUEUE_ERROR">> {
    if (job.contentType !== "STORIES") {
      return err("VALIDATION_ERROR");
    }

    try {
      const storyJobs: InstagramScheduleJob[] = [];

      // Process each media item
      for (let i = 0; i < (job.content.media?.length || 0); i++) {
        const media = job.content.media![i];
        if (!media) continue; // Skip if media is undefined

        if (media.type === "video") {
          // Split video into 15-second segments for Stories
          const splitOptions: VideoSplitOptions = {
            segmentLength: 15,
            maxSegments: 20, // Instagram Stories limit
            aspectRatio: "9:16",
            quality: "high",
            ...job.options?.videoSplitOptions,
          };

          const segments = await this.mediaProcessor.splitVideoForStories(media.url, splitOptions);

          // Create a story job for each segment
          segments.forEach((segment, segmentIndex) => {
            const storyJob: InstagramScheduleJob = {
              ...job,
              id: `${job.id}-segment-${segmentIndex}`,
              queueId: `${job.queueId}-segment-${segmentIndex}`,
              content: {
                media: [
                  {
                    url: segment.url,
                    type: "video",
                    ...(media.alt && { alt: media.alt }),
                  },
                ],
              },
              // Schedule segments 1 second apart to ensure order
              scheduledAt: new Date(job.scheduledAt.getTime() + segmentIndex * 1000),
            };
            storyJobs.push(storyJob);
          });
        } else {
          // Single image story
          const storyJob: InstagramScheduleJob = {
            ...job,
            id: `${job.id}-image-${i}`,
            queueId: `${job.queueId}-image-${i}`,
            content: {
              ...(i === 0 && job.content.text && { text: job.content.text }), // Only first story gets text
              media: [media],
            },
            scheduledAt: new Date(job.scheduledAt.getTime() + i * 1000),
          };
          storyJobs.push(storyJob);
        }
      }

      // Schedule all story jobs
      const results: ScheduleResult[] = [];
      for (const storyJob of storyJobs) {
        const result = await this.schedulePost(credentials, storyJob, options);
        if (result.ok) {
          results.push(result.value);
        } else {
          // If any story fails, we continue but track the error
          results.push({
            success: false,
            scheduledAt: storyJob.scheduledAt,
            estimatedPublishTime: storyJob.scheduledAt,
            error: result.error,
          });
        }
      }

      return ok(results);
    } catch (error: unknown) {
      logger.error({ err: error }, "Stories scheduling error");
      return err("PROCESSING_ERROR");
    }
  }

  /**
   * Schedule Instagram carousel post
   */
  async scheduleCarousel(
    credentials: InstagramCredentials,
    job: InstagramScheduleJob,
    options: InstagramScheduleOptions = {}
  ): Promise<
    Result<ScheduleResult, "VALIDATION_ERROR" | "RATE_LIMIT" | "AUTH_ERROR" | "QUEUE_ERROR">
  > {
    if (job.contentType !== "CAROUSEL") {
      return err("VALIDATION_ERROR");
    }

    // Validate carousel requirements
    if (!job.content.media || job.content.media.length < 2 || job.content.media.length > 10) {
      return err("VALIDATION_ERROR");
    }

    return this.schedulePost(credentials, job, options);
  }

  /**
   * Cancel a scheduled Instagram post
   */
  async cancelScheduledPost(
    queueJobId: string
  ): Promise<Result<boolean, "NOT_FOUND" | "CONNECTION_ERROR" | "QUEUE_ERROR">> {
    try {
      const result = await this.queueAdapter.remove(queueJobId);
      return result;
    } catch (error: unknown) {
      logger.error({ err: error }, "Cancel scheduled post error");
      return err("QUEUE_ERROR");
    }
  }

  /**
   * Get queue health and statistics
   */
  async getSchedulingHealth(): Promise<Result<any, "QUEUE_ERROR">> {
    try {
      const health = await this.queueAdapter.health();
      if (!health.ok) {
        return err("QUEUE_ERROR");
      }

      return ok({
        ...health.value,
        circuitBreakerStatus: circuitBreaker.getAllStatuses(),
        resilienceMetrics: this.queueAdapter.getResilienceMetrics(),
      });
    } catch (error: unknown) {
      logger.error({ err: error }, "Get scheduling health error");
      return err("QUEUE_ERROR");
    }
  }

  /**
   * Validate scheduled content based on Instagram requirements
   */
  private async validateScheduledContent(
    job: InstagramScheduleJob
  ): Promise<Result<void, "INVALID_CONTENT" | "INVALID_MEDIA" | "INVALID_SCHEDULE">> {
    // Validate schedule time (must be in the future)
    if (job.scheduledAt <= new Date()) {
      return err("INVALID_SCHEDULE");
    }

    // Validate content based on type
    switch (job.contentType) {
      case "FEED":
        if (!job.content.media || job.content.media.length === 0) {
          return err("INVALID_MEDIA");
        }
        break;

      case "STORIES":
        if (!job.content.media || job.content.media.length === 0) {
          return err("INVALID_MEDIA");
        }
        // Validate Stories media requirements
        for (const media of job.content.media) {
          if (media.type === "video") {
            // Stories videos should be in 9:16 aspect ratio and max 60 seconds
            // This would be validated by mediaProcessor in real implementation
          }
        }
        break;

      case "REELS":
        if (
          !job.content.media ||
          job.content.media.length !== 1 ||
          !job.content.media[0] ||
          job.content.media[0].type !== "video"
        ) {
          return err("INVALID_MEDIA");
        }
        break;

      case "CAROUSEL":
        if (!job.content.media || job.content.media.length < 2 || job.content.media.length > 10) {
          return err("INVALID_MEDIA");
        }
        break;
    }

    // Validate caption length (Instagram limit: 2200 characters)
    if (job.content.text && job.content.text.length > 2200) {
      return err("INVALID_CONTENT");
    }

    return ok(undefined);
  }

  /**
   * Optimize schedule time for better engagement
   */
  private optimizeScheduleTime(originalTime: Date, _timezone: string): Date {
    // Instagram optimal posting times (general guidelines):
    // Monday-Friday: 11am-1pm, 7pm-9pm
    // Saturday-Sunday: 10am-11am, 7pm-8pm

    const scheduledDate = new Date(originalTime);
    const hour = scheduledDate.getHours();
    const dayOfWeek = scheduledDate.getDay(); // 0 = Sunday, 6 = Saturday

    // If already in optimal time, return as-is
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    const isOptimalWeekdayTime =
      isWeekday && ((hour >= 11 && hour <= 13) || (hour >= 19 && hour <= 21));
    const isOptimalWeekendTime =
      !isWeekday && ((hour >= 10 && hour <= 11) || (hour >= 19 && hour <= 20));

    if (isOptimalWeekdayTime || isOptimalWeekendTime) {
      return originalTime;
    }

    // Adjust to next optimal time
    const optimizedDate = new Date(scheduledDate);

    if (isWeekday) {
      if (hour < 11) {
        optimizedDate.setHours(11, 0, 0, 0);
      } else if (hour >= 11 && hour < 19) {
        optimizedDate.setHours(19, 0, 0, 0);
      } else {
        // Move to next day 11am
        optimizedDate.setDate(optimizedDate.getDate() + 1);
        optimizedDate.setHours(11, 0, 0, 0);
      }
    } else {
      if (hour < 10) {
        optimizedDate.setHours(10, 0, 0, 0);
      } else if (hour >= 10 && hour < 19) {
        optimizedDate.setHours(19, 0, 0, 0);
      } else {
        // Move to next day 10am
        optimizedDate.setDate(optimizedDate.getDate() + 1);
        optimizedDate.setHours(10, 0, 0, 0);
      }
    }

    return optimizedDate;
  }

  /**
   * Get metrics registry for monitoring
   */
  static getMetricsRegistry(): client.Registry {
    return registry;
  }

  /**
   * Clean up resources
   */
  async close(): Promise<void> {
    try {
      await this.queueAdapter.close();
      logger.info("Instagram scheduling service closed");
    } catch (error) {
      logger.warn({ err: error }, "Instagram scheduling service cleanup warning");
    }
  }
}

// Export convenience function for creating the service
export function createInstagramSchedulingService(): InstagramSchedulingService {
  return new InstagramSchedulingService();
}
