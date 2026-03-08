/**
 * Webhook Handler - Core Processing Logic
 *
 * UniversalWebhookHandler: signature verification, event storage,
 * deduplication, retry logic, dead-letter queue, and processing stats.
 *
 * @module webhooks/webhookHandlerCore
 */

import { prisma } from "@infra/prisma";
import type { WebhookEvent, Provider } from "@infra/prisma";
import { createHash } from "crypto";
import type { RealtimeWebhookBroadcaster } from "./realtimeWebhookBroadcaster.js";
import { webhookLogger } from "../lib/logger.js";
import { AppError } from "../lib/errors/AppError.js";
import { InstagramWebhookProcessor } from "./processors/instagramWebhookProcessor.js";
import { FacebookWebhookProcessor } from "./processors/facebookWebhookProcessor.js";
import { XWebhookProcessor } from "./processors/xWebhookProcessor.js";
import { YouTubeWebhookProcessor } from "./processors/youtubeWebhookProcessor.js";
import { TikTokWebhookProcessor } from "./processors/tiktokWebhookProcessor.js";
import type {
  WebhookEventInput,
  WebhookProcessingResult,
  WebhookProcessor,
} from "./webhookTypes.js";

/**
 * Universal webhook handler for all social media providers
 */
export class UniversalWebhookHandler {
  private processors = new Map<Provider, WebhookProcessor>();
  private maxRetries = 3;
  private retryDelayMs = 5000;
  private broadcaster: RealtimeWebhookBroadcaster | undefined;

  constructor(broadcaster?: RealtimeWebhookBroadcaster) {
    if (broadcaster !== undefined) {
      this.broadcaster = broadcaster;
    }
    this.registerProcessors();
  }

  private registerProcessors(): void {
    this.processors.set("INSTAGRAM", new InstagramWebhookProcessor(this.broadcaster));
    this.processors.set("FACEBOOK", new FacebookWebhookProcessor(this.broadcaster));
    this.processors.set("X", new XWebhookProcessor(this.broadcaster));
    this.processors.set("YOUTUBE", new YouTubeWebhookProcessor(this.broadcaster));
    this.processors.set("TIKTOK", new TikTokWebhookProcessor(this.broadcaster));
  }

  async handleWebhook(
    provider: Provider,
    signature: string,
    payload: string,
    headers: Record<string, string>,
    _query?: Record<string, string>
  ): Promise<WebhookProcessingResult> {
    const startTime = Date.now();
    let eventId: string;

    try {
      const parsedPayload = JSON.parse(payload);
      eventId = this.extractEventId(provider, parsedPayload, headers);

      const existingEvent = await this.checkDuplicateEvent(provider, eventId);
      if (existingEvent) {
        return {
          success: true,
          eventId,
          normalizedData: (existingEvent.normalizedData as Record<string, any>) || {},
        };
      }

      const subscription = await this.getWebhookSubscription(provider, headers);
      if (!subscription || !subscription.isActive) {
        throw AppError.notFound("Webhook subscription", { provider });
      }

      const processor = this.processors.get(provider);
      if (!processor) {
        throw AppError.internal(`No processor registered for provider: ${provider}`);
      }

      const isValid = processor.verify(payload, signature, subscription.secretKey, headers);
      if (!isValid) {
        throw AppError.unauthorized(
          `Webhook signature verification failed for provider: ${provider}`
        );
      }

      const {
        eventType: _eventType,
        normalizedData,
        relatedEntities,
      } = await processor.parse(parsedPayload);

      const webhookEvent = await this.storeWebhookEvent({
        provider,
        eventType: eventId,
        eventId,
        signature,
        payload: parsedPayload,
        headers,
        ...relatedEntities,
      });

      await processor.process(normalizedData, relatedEntities);

      await this.markEventProcessed(webhookEvent.id, normalizedData, Date.now() - startTime);
      await this.updateSubscriptionStats(subscription.id);

      return {
        success: true,
        eventId,
        normalizedData,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (eventId!) {
        await this.handleEventFailure(eventId, errorMessage, Date.now() - startTime);
      }

      const shouldRetry = this.shouldRetryEvent(error);
      if (!shouldRetry) {
        await this.moveToDeadLetterQueue(
          provider,
          eventId!,
          JSON.parse(payload),
          headers,
          errorMessage
        );
      }

      return {
        success: false,
        eventId: eventId!,
        error: errorMessage,
        ...(shouldRetry && { retryAfter: this.calculateRetryDelay(1) }),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Event ID Extraction
  // ---------------------------------------------------------------------------

  private extractEventId(
    provider: Provider,
    payload: Record<string, any>,
    headers: Record<string, string>
  ): string {
    switch (provider) {
      case "INSTAGRAM":
      case "FACEBOOK":
        return (
          payload.entry?.[0]?.id ||
          headers["x-hub-signature-256"] ||
          createHash("md5").update(JSON.stringify(payload)).digest("hex")
        );

      case "X":
        return (
          payload.tweet_create_events?.[0]?.id_str ||
          payload.id ||
          createHash("md5").update(JSON.stringify(payload)).digest("hex")
        );

      case "YOUTUBE":
        return (
          payload.id ||
          headers["x-goog-channel-id"] ||
          createHash("md5").update(JSON.stringify(payload)).digest("hex")
        );

      case "TIKTOK":
        return (
          payload.event?.content?.video_id ||
          payload.timestamp ||
          createHash("md5").update(JSON.stringify(payload)).digest("hex")
        );

      default:
        return createHash("md5").update(JSON.stringify(payload)).digest("hex");
    }
  }

  // ---------------------------------------------------------------------------
  // Event Storage & Lifecycle
  // ---------------------------------------------------------------------------

  private async checkDuplicateEvent(
    provider: Provider,
    eventId: string
  ): Promise<WebhookEvent | null> {
    return prisma.webhookEvent.findUnique({
      where: {
        provider_eventId: {
          provider,
          eventId,
        },
      },
    });
  }

  private async getWebhookSubscription(provider: Provider, _headers: Record<string, string>) {
    return prisma.webhookSubscription.findFirst({
      where: {
        provider,
        isActive: true,
      },
    });
  }

  private async storeWebhookEvent(eventInput: WebhookEventInput): Promise<WebhookEvent> {
    const data: any = {
      provider: eventInput.provider,
      eventType: "POST_ENGAGEMENT_UPDATE",
      eventId: eventInput.eventId,
      signature: eventInput.signature,
      payload: eventInput.payload,
      headers: eventInput.headers,
      status: "PROCESSING",
      verified: true,
      processed: false,
    };
    if (eventInput.accountId !== undefined) data.accountId = eventInput.accountId;
    if (eventInput.projectId !== undefined) data.projectId = eventInput.projectId;
    if (eventInput.postId !== undefined) data.postId = eventInput.postId;
    if (eventInput.channelId !== undefined) data.channelId = eventInput.channelId;

    return prisma.webhookEvent.create({
      data,
    });
  }

  private async markEventProcessed(
    eventId: string,
    normalizedData: Record<string, any>,
    processingTimeMs: number
  ): Promise<void> {
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: "COMPLETED",
        processed: true,
        normalizedData,
        processedAt: new Date(),
        processingTime: processingTimeMs,
      },
    });
  }

  private async handleEventFailure(
    eventId: string,
    error: string,
    processingTimeMs: number
  ): Promise<void> {
    const event = await prisma.webhookEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) return;

    const newRetryCount = event.retryCount + 1;
    const shouldRetry = newRetryCount <= this.maxRetries;

    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: shouldRetry ? "RETRYING" : "FAILED",
        lastError: error,
        retryCount: newRetryCount,
        nextRetryAt: shouldRetry
          ? new Date(Date.now() + this.calculateRetryDelay(newRetryCount))
          : null,
        processingTime: processingTimeMs,
      },
    });
  }

  private async moveToDeadLetterQueue(
    provider: Provider,
    eventId: string,
    payload: Record<string, any>,
    headers: Record<string, string>,
    error: string
  ): Promise<void> {
    const event = await prisma.webhookEvent.findUnique({
      where: {
        provider_eventId: { provider, eventId },
      },
    });

    if (!event) return;

    await prisma.webhookDeadLetter.create({
      data: {
        originalEventId: event.id,
        provider,
        eventType: event.eventType,
        payload,
        headers,
        failureReason: error,
        finalError: error,
        retryCount: event.retryCount,
        firstFailedAt: new Date(),
        lastRetryAt: new Date(),
      },
    });

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: "DEAD_LETTER" },
    });
  }

  private async updateSubscriptionStats(subscriptionId: string): Promise<void> {
    await prisma.webhookSubscription.update({
      where: { id: subscriptionId },
      data: {
        eventsReceived: { increment: 1 },
        eventsProcessed: { increment: 1 },
        lastEventAt: new Date(),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Retry & Stats
  // ---------------------------------------------------------------------------

  private shouldRetryEvent(error: any): boolean {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (
      errorMessage.includes("signature verification failed") ||
      errorMessage.includes("not found") ||
      errorMessage.includes("Invalid payload format")
    ) {
      return false;
    }

    return true;
  }

  private calculateRetryDelay(retryCount: number): number {
    return this.retryDelayMs * Math.pow(2, retryCount - 1);
  }

  async getProcessingStats(provider?: Provider, timeRange?: { start: Date; end: Date }) {
    const where: any = {};

    if (provider) {
      where.provider = provider;
    }

    if (timeRange) {
      where.receivedAt = {
        gte: timeRange.start,
        lte: timeRange.end,
      };
    }

    const stats = await prisma.webhookEvent.groupBy({
      by: ["provider", "status"],
      where,
      _count: {
        id: true,
      },
      _avg: {
        processingTime: true,
      },
    });

    return stats.reduce(
      (acc, stat) => {
        const provider = stat.provider;
        const status = stat.status;
        if (!acc[provider]) {
          acc[provider] = {};
        }
        const avgProcessingTime = stat._avg.processingTime;
        if (status) {
          acc[provider][status] = {
            count: stat._count.id,
            ...(avgProcessingTime !== null &&
              avgProcessingTime !== undefined && { avgProcessingTime }),
          };
        }
        return acc;
      },
      {} as Record<string, Record<string, any>>
    );
  }

  async retryFailedEvents(maxAge?: Date): Promise<number> {
    const where: any = {
      status: "RETRYING",
      nextRetryAt: {
        lte: new Date(),
      },
    };

    if (maxAge) {
      where.receivedAt = {
        gte: maxAge,
      };
    }

    const failedEvents = await prisma.webhookEvent.findMany({
      where,
      include: {
        account: true,
        project: true,
      },
    });

    let retriedCount = 0;

    for (const event of failedEvents) {
      try {
        const result = await this.handleWebhook(
          event.provider,
          event.signature,
          JSON.stringify(event.payload),
          event.headers as Record<string, string>
        );

        if (result.success) {
          retriedCount++;
        }
      } catch (error) {
        webhookLogger.error({ err: error, eventId: event.id }, "Failed to retry event");
      }
    }

    return retriedCount;
  }
}
