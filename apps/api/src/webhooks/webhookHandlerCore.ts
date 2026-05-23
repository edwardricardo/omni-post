/**
 * @file webhookHandlerCore.ts
 * @description Core webhook processing: signature verification, event storage,
 *              deduplication, retry logic, dead-letter queue, and processing stats.
 * @layer infrastructure
 */

import type { WebhookEvent, Provider, PrismaClient, WebhookEventType } from "@infra/prisma";
import { createHash, createHmac } from "crypto";
import type { RealtimeWebhookBroadcaster } from "./realtimeWebhookBroadcaster.js";
import { webhookLogger } from "../lib/logger.js";
import { AppError } from "../lib/errors/AppError.js";
import { InstagramWebhookProcessor } from "./processors/instagramWebhookProcessor.js";
import { FacebookWebhookProcessor } from "./processors/facebookWebhookProcessor.js";
import { XWebhookProcessor } from "./processors/xWebhookProcessor.js";
import { YouTubeWebhookProcessor } from "./processors/youtubeWebhookProcessor.js";
import { TikTokWebhookProcessor } from "./processors/tiktokWebhookProcessor.js";
import { LinkedInWebhookProcessor } from "./processors/linkedinWebhookProcessor.js";
import { TelegramWebhookProcessor } from "./processors/telegramWebhookProcessor.js";
import { ThreadsWebhookProcessor } from "./processors/threadsWebhookProcessor.js";
import type { MentionFetchEnqueue } from "./mentionFetchEnqueue.js";
import type {
  WebhookEventInput,
  WebhookProcessingResult,
  WebhookProcessor,
} from "./webhookTypes.js";

/**
 * Subscription fields needed by the grace-window-aware verifier. Kept narrow
 * (and decoupled from the full Prisma model) so the helper can be unit-tested
 * without standing up Prisma.
 */
export interface VerifierSubscription {
  id: string;
  secretKey: string;
  previousSecretKey: string | null;
  previousSecretKeyExpiresAt: Date | null;
}

export interface VerifyWithGraceInput {
  processor: WebhookProcessor;
  payload: string;
  signature: string;
  headers: Record<string, string>;
  subscription: VerifierSubscription;
  now: Date;
}

export interface VerifyWithGraceResult {
  isValid: boolean;
  acceptedViaPrevious: boolean;
}

/** Outcome of edge verification for an inbound webhook POST. */
export type InboundVerification =
  | { ok: true; eventId: string; eventType: WebhookEventType; payload: Record<string, unknown> }
  | { ok: false; status: 400 | 401 | 404; reason: string };

/** Response for a provider GET verification handshake. */
export interface InboundChallenge {
  status: number;
  body: string;
}

/**
 * Verifies a webhook signature against the active secretKey, falling back to
 * `previousSecretKey` when the rotation grace window is still open. Pure
 * function — no I/O, no logger, no Prisma. The caller emits the audit warning.
 *
 * Golden cases:
 *  1. Valid signature + active secret → accepted (acceptedViaPrevious=false)
 *  2. Invalid against active + valid against previous within window → accepted
 *  3. Invalid against active + valid against previous AFTER window → rejected
 *  4. Invalid against both → rejected
 */
export function verifyWithGraceWindow(input: VerifyWithGraceInput): VerifyWithGraceResult {
  const { processor, payload, signature, headers, subscription, now } = input;
  if (processor.verify(payload, signature, subscription.secretKey, headers)) {
    return { isValid: true, acceptedViaPrevious: false };
  }
  if (
    subscription.previousSecretKey !== null &&
    subscription.previousSecretKeyExpiresAt !== null &&
    subscription.previousSecretKeyExpiresAt.getTime() > now.getTime()
  ) {
    if (processor.verify(payload, signature, subscription.previousSecretKey, headers)) {
      return { isValid: true, acceptedViaPrevious: true };
    }
  }
  return { isValid: false, acceptedViaPrevious: false };
}

/**
 * Universal webhook handler for all social media providers
 */
export class UniversalWebhookHandler {
  private processors = new Map<Provider, WebhookProcessor>();
  private maxRetries = 3;
  private retryDelayMs = 5000;
  private readonly prisma: PrismaClient;
  private broadcaster: RealtimeWebhookBroadcaster | undefined;
  private mentionEnqueue: MentionFetchEnqueue | undefined;

  constructor(
    prisma: PrismaClient,
    broadcaster?: RealtimeWebhookBroadcaster,
    mentionEnqueue?: MentionFetchEnqueue
  ) {
    this.prisma = prisma;
    if (broadcaster !== undefined) {
      this.broadcaster = broadcaster;
    }
    if (mentionEnqueue !== undefined) {
      this.mentionEnqueue = mentionEnqueue;
    }
    this.registerProcessors();
  }

  private registerProcessors(): void {
    this.processors.set(
      "INSTAGRAM",
      new InstagramWebhookProcessor(this.prisma, this.broadcaster, this.mentionEnqueue)
    );
    this.processors.set(
      "FACEBOOK",
      new FacebookWebhookProcessor(this.prisma, this.broadcaster, this.mentionEnqueue)
    );
    this.processors.set("X", new XWebhookProcessor(this.prisma, this.broadcaster));
    this.processors.set("YOUTUBE", new YouTubeWebhookProcessor(this.prisma, this.broadcaster));
    this.processors.set("TIKTOK", new TikTokWebhookProcessor(this.prisma, this.broadcaster));
    this.processors.set("LINKEDIN", new LinkedInWebhookProcessor(this.prisma, this.broadcaster));
    this.processors.set("TELEGRAM", new TelegramWebhookProcessor(this.prisma, this.broadcaster));
    this.processors.set(
      "THREADS",
      new ThreadsWebhookProcessor(this.prisma, this.broadcaster, this.mentionEnqueue)
    );
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
          normalizedData: (existingEvent.normalizedData as Record<string, unknown>) || {},
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

      const verification = verifyWithGraceWindow({
        processor,
        payload,
        signature,
        headers,
        subscription,
        now: new Date(),
      });
      if (verification.acceptedViaPrevious) {
        webhookLogger.warn(
          {
            webhookSubscriptionId: subscription.id,
            provider,
            previousSecretKeyExpiresAt:
              subscription.previousSecretKeyExpiresAt?.toISOString() ?? null,
          },
          "Webhook signature verified with previousSecretKey during grace window"
        );
      }
      if (!verification.isValid) {
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

  /**
   * @method verifyInbound
   * @description Edge verification of an inbound webhook POST: parses the raw
   *   body, resolves the active subscription, and verifies the signature (with
   *   the rotation grace window). Returns the event id + type to enqueue, or a
   *   failure carrying the HTTP status the route should return.
   * @param provider - The provider the webhook arrived for.
   * @param signature - The raw signature header value.
   * @param rawBody - The unparsed request body (required for HMAC).
   * @param headers - The request headers.
   * @returns ok with eventId/eventType/payload, or a typed failure.
   */
  async verifyInbound(
    provider: Provider,
    signature: string,
    rawBody: string,
    headers: Record<string, string>
  ): Promise<InboundVerification> {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return { ok: false, status: 400, reason: "Malformed JSON payload" };
    }

    const subscription = await this.getWebhookSubscription(provider, headers);
    if (!subscription || !subscription.isActive) {
      return { ok: false, status: 404, reason: `No active webhook subscription for ${provider}` };
    }

    const processor = this.processors.get(provider);
    if (!processor) {
      return { ok: false, status: 404, reason: `No processor for ${provider}` };
    }

    const verification = verifyWithGraceWindow({
      processor,
      payload: rawBody,
      signature,
      headers,
      subscription,
      now: new Date(),
    });
    if (!verification.isValid) {
      return { ok: false, status: 401, reason: "Signature verification failed" };
    }

    const eventId = this.extractEventId(provider, payload, headers);
    const { eventType } = await processor.parse(payload);
    return { ok: true, eventId, eventType, payload };
  }

  /**
   * @method handleChallenge
   * @description Per-provider GET verification handshake. Meta (IG/FB/Threads) +
   *   YouTube WebSub echo `hub.challenge` when `hub.verify_token` matches the
   *   subscription; X answers the CRC with an HMAC of `crc_token`; others ack.
   * @param provider - The provider issuing the handshake.
   * @param query - The request query parameters.
   * @param headers - The request headers.
   * @returns The status + body the route should return.
   */
  async handleChallenge(
    provider: Provider,
    query: Record<string, string>,
    headers: Record<string, string>
  ): Promise<InboundChallenge> {
    const hubMode = query["hub.mode"];
    const hubChallenge = query["hub.challenge"];
    const hubVerifyToken = query["hub.verify_token"];
    if (hubMode === "subscribe" && hubChallenge !== undefined) {
      const subscription = await this.getWebhookSubscription(provider, headers);
      if (subscription?.verifyToken !== undefined && subscription.verifyToken === hubVerifyToken) {
        return { status: 200, body: hubChallenge };
      }
      return { status: 403, body: "verify_token mismatch" };
    }

    const crcToken = query["crc_token"];
    if (provider === "X" && crcToken !== undefined) {
      const subscription = await this.getWebhookSubscription(provider, headers);
      if (!subscription) {
        return { status: 404, body: "No active subscription" };
      }
      const responseToken = `sha256=${createHmac("sha256", subscription.secretKey)
        .update(crcToken)
        .digest("base64")}`;
      return { status: 200, body: JSON.stringify({ response_token: responseToken }) };
    }

    return { status: 200, body: "ok" };
  }

  // ---------------------------------------------------------------------------
  // Event ID Extraction
  // ---------------------------------------------------------------------------

  private extractEventId(
    provider: Provider,
    payload: Record<string, unknown>,
    headers: Record<string, string>
  ): string {
    switch (provider) {
      case "INSTAGRAM":
      case "FACEBOOK": {
        const entryArr = payload.entry as Record<string, unknown>[] | undefined;
        const firstEntry = entryArr?.[0];
        return (
          (firstEntry?.id as string) ||
          headers["x-hub-signature-256"] ||
          createHash("md5").update(JSON.stringify(payload)).digest("hex")
        );
      }

      case "X": {
        const tweetEvents = payload.tweet_create_events as Record<string, unknown>[] | undefined;
        return (
          (tweetEvents?.[0]?.id_str as string) ||
          (payload.id as string) ||
          createHash("md5").update(JSON.stringify(payload)).digest("hex")
        );
      }

      case "YOUTUBE":
        return (
          (payload.id as string) ||
          headers["x-goog-channel-id"] ||
          createHash("md5").update(JSON.stringify(payload)).digest("hex")
        );

      case "TIKTOK": {
        const tiktokEvent = payload.event as Record<string, unknown> | undefined;
        const tiktokContent = tiktokEvent?.content as Record<string, unknown> | undefined;
        return (
          (tiktokContent?.video_id as string) ||
          (payload.timestamp as string) ||
          createHash("md5").update(JSON.stringify(payload)).digest("hex")
        );
      }

      case "TELEGRAM":
        return (
          String(payload.update_id) ||
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
    return this.prisma.webhookEvent.findUnique({
      where: {
        provider_eventId: {
          provider,
          eventId,
        },
      },
    });
  }

  private async getWebhookSubscription(provider: Provider, _headers: Record<string, string>) {
    return this.prisma.webhookSubscription.findFirst({
      where: {
        provider,
        isActive: true,
      },
    });
  }

  private async storeWebhookEvent(eventInput: WebhookEventInput): Promise<WebhookEvent> {
    return this.prisma.webhookEvent.create({
      data: {
        provider: eventInput.provider,
        eventType: "POST_ENGAGEMENT_UPDATE",
        eventId: eventInput.eventId,
        signature: eventInput.signature,
        payload: eventInput.payload as Record<string, string | number | boolean | null>,
        headers: eventInput.headers as Record<string, string>,
        status: "PROCESSING",
        verified: true,
        processed: false,
        ...(eventInput.accountId !== undefined && { accountId: eventInput.accountId }),
        ...(eventInput.projectId !== undefined && { projectId: eventInput.projectId }),
        ...(eventInput.postId !== undefined && { postId: eventInput.postId }),
        ...(eventInput.channelId !== undefined && { channelId: eventInput.channelId }),
      },
    });
  }

  private async markEventProcessed(
    eventId: string,
    normalizedData: Record<string, unknown>,
    processingTimeMs: number
  ): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: "COMPLETED",
        processed: true,
        normalizedData: normalizedData as Record<string, string | number | boolean | null>,
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
    const event = await this.prisma.webhookEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) return;

    const newRetryCount = event.retryCount + 1;
    const shouldRetry = newRetryCount <= this.maxRetries;

    await this.prisma.webhookEvent.update({
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
    payload: Record<string, unknown>,
    headers: Record<string, string>,
    error: string
  ): Promise<void> {
    const event = await this.prisma.webhookEvent.findUnique({
      where: {
        provider_eventId: { provider, eventId },
      },
    });

    if (!event) return;

    await this.prisma.webhookDeadLetter.create({
      data: {
        originalEventId: event.id,
        provider,
        eventType: event.eventType,
        payload: payload as Record<string, string | number | boolean | null>,
        headers: headers as Record<string, string>,
        failureReason: error,
        finalError: error,
        retryCount: event.retryCount,
        firstFailedAt: new Date(),
        lastRetryAt: new Date(),
      },
    });

    await this.prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: "DEAD_LETTER" },
    });
  }

  private async updateSubscriptionStats(subscriptionId: string): Promise<void> {
    await this.prisma.webhookSubscription.update({
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

  private shouldRetryEvent(error: unknown): boolean {
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
    const where: Record<string, unknown> = {};

    if (provider) {
      where.provider = provider;
    }

    if (timeRange) {
      where.receivedAt = {
        gte: timeRange.start,
        lte: timeRange.end,
      };
    }

    const stats = await this.prisma.webhookEvent.groupBy({
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
      {} as Record<string, Record<string, unknown>>
    );
  }

  async retryFailedEvents(maxAge?: Date): Promise<number> {
    const where: Record<string, unknown> = {
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

    const failedEvents = await this.prisma.webhookEvent.findMany({
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
