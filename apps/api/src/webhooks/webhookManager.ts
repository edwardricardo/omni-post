/**
 * @file webhookManager.ts
 * @description Webhook subscription management and ingestion orchestrator handling
 *              subscription CRUD, secret rotation, and incoming webhook dispatch.
 * @layer infrastructure
 */
import {
  createWebhookJobProcessor,
  type WebhookJobProcessor,
  type WebhookJobData,
} from "./webhookJobProcessor.js";
import type { PrismaClient, Provider, WebhookEventType } from "@infra/prisma";
import Redis from "ioredis";
import { webhookLogger } from "../lib/logger.js";
import { AppError } from "../lib/errors/AppError.js";
import { z } from "zod";
import { randomBytes } from "crypto";
import { env } from "../config/env.js";

// Webhook subscription schemas
const CreateWebhookSubscriptionSchema = z.object({
  provider: z.enum(["X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK"]),
  projectId: z.string().uuid().optional(),
  eventTypes: z.array(
    z.enum([
      "POST_PUBLISHED",
      "POST_UPDATED",
      "POST_DELETED",
      "POST_ENGAGEMENT_UPDATE",
      "STORY_PUBLISHED",
      "STORY_EXPIRED",
      "REEL_PUBLISHED",
      "LIKE_RECEIVED",
      "COMMENT_RECEIVED",
      "SHARE_RECEIVED",
      "MENTION_RECEIVED",
      "ACCOUNT_CONNECTED",
      "ACCOUNT_DISCONNECTED",
      "PERMISSION_CHANGED",
      "RATE_LIMIT_REACHED",
      "QUOTA_EXCEEDED",
      "API_ERROR",
      "VIDEO_PROCESSED",
      "VIDEO_MONETIZED",
      "LIVE_STREAM_STARTED",
      "LIVE_STREAM_ENDED",
      "MILESTONE_REACHED",
      "VIRAL_CONTENT_DETECTED",
    ])
  ),
  webhookUrl: z.string().url().optional(),
  verifyToken: z.string().optional(),
});

const UpdateWebhookSubscriptionSchema = z.object({
  isActive: z.boolean().optional(),
  eventTypes: z
    .array(
      z.enum([
        "POST_PUBLISHED",
        "POST_UPDATED",
        "POST_DELETED",
        "POST_ENGAGEMENT_UPDATE",
        "STORY_PUBLISHED",
        "STORY_EXPIRED",
        "REEL_PUBLISHED",
        "LIKE_RECEIVED",
        "COMMENT_RECEIVED",
        "SHARE_RECEIVED",
        "MENTION_RECEIVED",
        "ACCOUNT_CONNECTED",
        "ACCOUNT_DISCONNECTED",
        "PERMISSION_CHANGED",
        "RATE_LIMIT_REACHED",
        "QUOTA_EXCEEDED",
        "API_ERROR",
        "VIDEO_PROCESSED",
        "VIDEO_MONETIZED",
        "LIVE_STREAM_STARTED",
        "LIVE_STREAM_ENDED",
        "MILESTONE_REACHED",
        "VIRAL_CONTENT_DETECTED",
      ])
    )
    .optional(),
  verifyToken: z.string().optional(),
});

/**
 * Webhook Manager
 * Central service for managing webhook subscriptions, processing, and monitoring
 */
export class WebhookManager {
  private jobProcessor: WebhookJobProcessor;
  private redis: Redis;

  constructor(
    private readonly prisma: PrismaClient,
    redis: Redis
  ) {
    this.redis = redis;
    this.jobProcessor = createWebhookJobProcessor(prisma, redis);
  }

  /**
   * @method createSubscription
   * @description Creates a new webhook subscription with secret key generation and provider setup instructions.
   * @param accountId - The account ID owning the subscription
   * @param data - Validated subscription creation payload including provider, event types, and optional webhook URL
   * @returns The created subscription (without secret key) along with provider-specific setup instructions
   */
  async createSubscription(
    accountId: string,
    data: z.infer<typeof CreateWebhookSubscriptionSchema>
  ) {
    const validated = CreateWebhookSubscriptionSchema.parse(data);

    // Generate webhook URL if not provided
    const webhookUrl =
      validated.webhookUrl || `${env.API_BASE_URL}/webhooks/${validated.provider.toLowerCase()}`;

    // Generate secret key for signature verification
    const secretKey = this.generateSecretKey();

    // Generate verification token for platforms that need it (Facebook)
    const verifyToken = validated.verifyToken || this.generateVerifyToken();

    const subscription = await this.prisma.webhookSubscription.create({
      data: {
        accountId,
        ...(validated.projectId !== undefined && { projectId: validated.projectId }),
        provider: validated.provider,
        webhookUrl,
        secretKey,
        verifyToken,
        eventTypes: validated.eventTypes,
        isActive: true,
      },
    });

    // Future: call provider SDK to register webhook URL with the platform

    const { secretKey: _secretKey, ...safeSubscription } = subscription;
    return {
      ...safeSubscription,
      setupInstructions: this.generateSetupInstructions({
        provider: subscription.provider,
        verifyToken: subscription.verifyToken || "",
      }),
    };
  }

  /**
   * @method getSubscriptions
   * @description Retrieves all webhook subscriptions for an account, optionally filtered by provider.
   * @param accountId - The account ID to fetch subscriptions for
   * @param provider - Optional provider filter
   * @returns Array of subscriptions with event statistics, secret keys redacted
   */
  async getSubscriptions(accountId: string, provider?: Provider) {
    const where: { accountId: string; provider?: Provider } = { accountId };
    if (provider) {
      where.provider = provider;
    }

    const subscriptions = await this.prisma.webhookSubscription.findMany({
      where,
      include: {
        project: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return subscriptions.map((sub) => {
      const { secretKey: _secretKey, ...safeSub } = sub;
      return {
        ...safeSub,
        stats: {
          eventsReceived: sub.eventsReceived,
          eventsProcessed: sub.eventsProcessed,
          lastEventAt: sub.lastEventAt,
        },
      };
    });
  }

  /**
   * @method updateSubscription
   * @description Updates an existing webhook subscription's event types, active status, or verify token.
   * @param subscriptionId - The subscription ID to update
   * @param accountId - The owning account ID for authorization
   * @param data - Partial update payload with optional fields
   * @returns The update result count
   */
  async updateSubscription(
    subscriptionId: string,
    accountId: string,
    data: z.infer<typeof UpdateWebhookSubscriptionSchema>
  ) {
    const validated = UpdateWebhookSubscriptionSchema.parse(data);

    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(validated)) {
      if (value !== undefined) {
        updateData[key] = value;
      }
    }

    const subscription = await this.prisma.webhookSubscription.updateMany({
      where: {
        id: subscriptionId,
        accountId,
      },
      data: updateData,
    });

    if (subscription.count === 0) {
      throw AppError.notFound("Webhook subscription", { subscriptionId });
    }

    return subscription;
  }

  /**
   * @method deleteSubscription
   * @description Deletes a webhook subscription after verifying account ownership.
   * @param subscriptionId - The subscription ID to delete
   * @param accountId - The owning account ID for authorization
   * @returns Success confirmation object
   */
  async deleteSubscription(subscriptionId: string, accountId: string) {
    const subscription = await this.prisma.webhookSubscription.findFirst({
      where: {
        id: subscriptionId,
        accountId,
      },
    });

    if (!subscription) {
      throw AppError.notFound("Webhook subscription", { subscriptionId });
    }

    // Future: call provider SDK to unregister webhook URL from the platform

    await this.prisma.webhookSubscription.delete({
      where: { id: subscriptionId },
    });

    return { success: true };
  }

  /**
   * @method processIncomingWebhook
   * @description Enqueues an incoming webhook event for asynchronous processing via BullMQ.
   * @param provider - The social platform provider
   * @param eventType - The webhook event type
   * @param eventId - Unique identifier for the event
   * @param signature - The webhook signature for verification
   * @param payload - The raw webhook payload
   * @param headers - The original request headers
   * @param accountId - Optional account ID associated with the event
   * @param projectId - Optional project ID associated with the event
   * @returns The BullMQ job ID for tracking
   */
  async processIncomingWebhook(
    provider: Provider,
    eventType: WebhookEventType,
    eventId: string,
    signature: string,
    payload: Record<string, unknown>,
    headers: Record<string, string>,
    accountId?: string,
    projectId?: string
  ): Promise<string> {
    // Add to job queue for asynchronous processing
    const jobData: WebhookJobData = {
      eventId,
      provider,
      eventType,
      payload,
      headers,
      signature,
      retryCount: 0,
      originalReceivedAt: new Date().toISOString(),
      ...(accountId !== undefined && { accountId }),
      ...(projectId !== undefined && { projectId }),
    };

    const jobId = await this.jobProcessor.addWebhookJob(jobData);

    return jobId;
  }

  /**
   * @method getProcessingStats
   * @description Aggregates webhook processing statistics including success rates, queue depth, and per-provider breakdowns.
   * @param accountId - The account ID to fetch statistics for
   * @param timeRange - Optional date range filter for the statistics
   * @returns Comprehensive statistics object with totals, provider breakdown, and recent errors
   */
  async getProcessingStats(accountId: string, timeRange?: { start: Date; end: Date }) {
    const where: Record<string, unknown> = { accountId };

    if (timeRange) {
      where.receivedAt = {
        gte: timeRange.start,
        lte: timeRange.end,
      };
    }

    // Get database stats
    const [totalEvents, processedEvents, failedEvents, deadLetterEvents] = await Promise.all([
      this.prisma.webhookEvent.count({ where }),
      this.prisma.webhookEvent.count({ where: { ...where, processed: true } }),
      this.prisma.webhookEvent.count({ where: { ...where, status: "FAILED" } }),
      this.prisma.webhookDeadLetter.count({
        where: {
          resolvedAt: null,
          // Add account filter here if needed
        },
      }),
    ]);

    // Get queue stats
    const queueStats = await this.jobProcessor.getQueueStats();

    // Get processing times
    const avgProcessingTime = await this.prisma.webhookEvent.aggregate({
      where: { ...where, processingTime: { not: null } },
      _avg: { processingTime: true },
    });

    return {
      totalEvents,
      processedEvents,
      failedEvents,
      deadLetterEvents,
      successRate: totalEvents > 0 ? (processedEvents / totalEvents) * 100 : 0,
      avgProcessingTimeMs: avgProcessingTime._avg.processingTime || 0,
      queue: queueStats,
      byProvider: await this.getStatsByProvider(accountId, timeRange),
      recentErrors: await this.getRecentErrors(accountId, 10),
    };
  }

  /**
   * Get statistics by provider
   */
  private async getStatsByProvider(accountId: string, timeRange?: { start: Date; end: Date }) {
    const where: Record<string, unknown> = { accountId };

    if (timeRange) {
      where.receivedAt = {
        gte: timeRange.start,
        lte: timeRange.end,
      };
    }

    const stats = await this.prisma.webhookEvent.groupBy({
      by: ["provider", "status"],
      where,
      _count: { id: true },
      _avg: { processingTime: true },
    });

    interface ProviderStatEntry {
      total: number;
      completed: number;
      failed: number;
      processing: number;
      avgProcessingTime: number;
      [key: string]: number;
    }
    const result: Record<string, ProviderStatEntry> = {};

    for (const stat of stats) {
      if (!result[stat.provider]) {
        result[stat.provider] = {
          total: 0,
          completed: 0,
          failed: 0,
          processing: 0,
          avgProcessingTime: 0,
        };
      }

      const entry = result[stat.provider] as ProviderStatEntry;
      entry.total += stat._count.id;
      entry[stat.status.toLowerCase()] = stat._count.id;

      if (stat.status === "COMPLETED" && stat._avg.processingTime) {
        entry.avgProcessingTime = stat._avg.processingTime;
      }
    }

    return result;
  }

  /**
   * Get recent webhook errors
   */
  private async getRecentErrors(accountId: string, limit: number = 10) {
    return this.prisma.webhookEvent.findMany({
      where: {
        accountId,
        status: "FAILED",
        lastError: { not: null },
      },
      select: {
        id: true,
        provider: true,
        eventType: true,
        lastError: true,
        receivedAt: true,
        retryCount: true,
      },
      orderBy: { receivedAt: "desc" },
      take: limit,
    });
  }

  /**
   * @method retryFailedEvents
   * @description Re-enqueues failed and dead-lettered webhook events for reprocessing.
   * @param accountId - The account ID whose failed events should be retried
   * @param maxAgeDays - Optional maximum age in days; events older than this are skipped
   * @returns The number of events successfully re-enqueued
   */
  async retryFailedEvents(accountId: string, maxAgeDays?: number): Promise<number> {
    const maxAge = maxAgeDays ? new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000) : undefined;

    // Get failed events from database
    const failedEvents = await this.prisma.webhookEvent.findMany({
      where: {
        accountId,
        status: { in: ["FAILED", "DEAD_LETTER"] },
        ...(maxAge && { receivedAt: { gte: maxAge } }),
      },
    });

    let retriedCount = 0;

    for (const event of failedEvents) {
      try {
        // Add back to processing queue
        const retryJobData: WebhookJobData = {
          eventId: event.id,
          provider: event.provider,
          eventType: event.eventType,
          payload: event.payload as Record<string, unknown>,
          headers: event.headers as Record<string, string>,
          signature: event.signature,
          retryCount: 0, // Reset retry count for manual retry
          originalReceivedAt: event.receivedAt.toISOString(),
          ...(event.accountId && { accountId: event.accountId }),
          ...(event.projectId && { projectId: event.projectId }),
        };

        await this.jobProcessor.addWebhookJob(retryJobData);

        // Update status to retrying
        await this.prisma.webhookEvent.update({
          where: { id: event.id },
          data: { status: "RETRYING" },
        });

        retriedCount++;
      } catch (error) {
        webhookLogger.error({ err: error, eventId: event.id }, "Failed to retry webhook event");
      }
    }

    return retriedCount;
  }

  /**
   * @method cleanup
   * @description Removes old completed and failed webhook events from the database and cleans up stale queue jobs.
   * @param maxAgeDays - Maximum age in days for events to retain (default 30)
   * @returns Object with counts of deleted events and cleaned queue jobs
   */
  async cleanup(maxAgeDays: number = 30): Promise<{
    eventsDeleted: number;
    jobsCleanedUp: { webhookQueueCleaned: number; deadLetterQueueCleaned: number };
  }> {
    const maxAge = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

    // Clean up old webhook events from database
    const deletedEvents = await this.prisma.webhookEvent.deleteMany({
      where: {
        receivedAt: { lt: maxAge },
        status: { in: ["COMPLETED", "FAILED"] },
      },
    });

    // Clean up old jobs from queues
    const jobsCleanedUp = await this.jobProcessor.cleanupOldJobs(maxAge);

    return {
      eventsDeleted: deletedEvents.count,
      jobsCleanedUp,
    };
  }

  /**
   * Generate setup instructions for webhook subscription
   */
  private generateSetupInstructions(subscription: { provider: string; verifyToken: string }) {
    const baseUrl = env.API_BASE_URL || "https://your-api-domain.com";
    const webhookUrl = `${baseUrl}/webhooks/${subscription.provider.toLowerCase()}`;

    const instructions: Record<string, unknown> = {
      webhookUrl,
      provider: subscription.provider,
    };

    switch (subscription.provider) {
      case "FACEBOOK":
      case "INSTAGRAM":
        instructions.steps = [
          "Go to Facebook App Dashboard",
          "Navigate to Webhooks section",
          `Set webhook URL: ${webhookUrl}`,
          `Set verify token: ${subscription.verifyToken}`,
          "Subscribe to required fields based on your event types",
          "Test the webhook connection",
        ];
        instructions.verifyToken = subscription.verifyToken;
        break;

      case "X":
        instructions.steps = [
          "Go to X Developer Portal",
          "Navigate to your app settings",
          "Set up Account Activity API webhook",
          `Set webhook URL: ${webhookUrl}`,
          "Configure CRC (Challenge Response Check)",
          "Subscribe to webhook events",
        ];
        break;

      case "YOUTUBE":
        instructions.steps = [
          "Go to Google Cloud Console",
          "Enable YouTube Data API v3",
          "Set up Pub/Sub topic for notifications",
          `Configure push notification endpoint: ${webhookUrl}`,
          "Subscribe to channel or video events",
        ];
        break;

      case "TIKTOK":
        instructions.steps = [
          "Go to TikTok Developer Portal",
          "Navigate to your app settings",
          "Set up webhook configuration",
          `Set webhook URL: ${webhookUrl}`,
          "Configure event subscriptions",
          "Test webhook delivery",
        ];
        break;
    }

    return instructions;
  }

  /**
   * Generate secure secret key for webhook signature verification
   */
  private generateSecretKey(): string {
    return randomBytes(32).toString("hex");
  }

  /**
   * Generate verification token for webhook setup
   */
  private generateVerifyToken(): string {
    return randomBytes(16).toString("hex");
  }

  /**
   * @method shutdown
   * @description Gracefully shuts down the webhook manager by closing the underlying job processor.
   * @returns Resolves when all workers and queues are closed
   */
  async shutdown(): Promise<void> {
    await this.jobProcessor.shutdown();
  }
}
