/**
 * Webhook Event Mapper - Anti-Corruption Layer (ACL)
 *
 * Translates normalized webhook data (already provider-agnostic, produced by
 * individual webhook processors) into strongly-typed domain webhook events.
 *
 * This is the boundary between the external social media webhook world and the
 * internal domain model. Downstream code works with typed events; it never sees
 * raw provider-specific payloads.
 *
 * Flow:
 *   Raw Provider Payload
 *     → XWebhookProcessor.parsePayload()  → NormalizedWebhookData + WebhookEventType
 *     → WebhookEventMapper.fromNormalized() → TypedDomainWebhookEvent
 *     → processEvent() handlers (strongly-typed)
 *
 * @module webhooks/WebhookEventMapper
 */

import { randomUUID } from "crypto";
import type { WebhookEventType, ProviderName } from "@shared/types";
import type { RelatedEntities } from "./processors/AbstractWebhookProcessor.js";

// ============================================================
// Domain Webhook Event Interfaces
// ============================================================

/**
 * Base fields present on every domain webhook event.
 * Provider-agnostic representation of an external social media event.
 */
export interface DomainWebhookEvent {
  /** Unique ID generated at mapping time (not from provider) */
  readonly domainEventId: string;
  /** Provider-agnostic classification of the event */
  readonly eventType: WebhookEventType;
  /** Source social media provider */
  readonly provider: ProviderName;
  /** When the event was received and mapped */
  readonly occurredAt: Date;
  /** Database entities associated with this event */
  readonly relatedEntities: RelatedEntities;
}

/**
 * A post or story was successfully published to the provider platform.
 */
export interface WebhookPostPublishedEvent extends DomainWebhookEvent {
  readonly eventType: "POST_PUBLISHED" | "STORY_PUBLISHED" | "REEL_PUBLISHED";
  /** Provider-platform post/content ID (e.g. tweet ID, Instagram media ID) */
  readonly externalPostId?: string;
  readonly publishedAt?: Date;
  /** Initial engagement snapshot at publication time */
  readonly engagementSnapshot: {
    readonly likes: number;
    readonly shares: number;
    readonly comments: number;
    readonly views: number;
  };
}

/**
 * A post was updated on the provider platform.
 */
export interface WebhookPostUpdatedEvent extends DomainWebhookEvent {
  readonly eventType: "POST_UPDATED";
  readonly externalPostId?: string;
  readonly updatedAt?: Date;
}

/**
 * A previously published post or content was deleted from the provider platform.
 */
export interface WebhookPostDeletedEvent extends DomainWebhookEvent {
  readonly eventType: "POST_DELETED";
  readonly externalPostId?: string;
  readonly deletedAt: Date;
}

/**
 * Analytics data was updated by the platform (views, reach, impressions, etc.).
 */
export interface WebhookAnalyticsUpdatedEvent extends DomainWebhookEvent {
  readonly eventType: "POST_ENGAGEMENT_UPDATE" | "MILESTONE_REACHED" | "VIRAL_CONTENT_DETECTED";
  readonly externalPostId?: string;
  readonly metrics: {
    readonly views?: number;
    readonly likes?: number;
    readonly shares?: number;
    readonly comments?: number;
    readonly clicks?: number;
    readonly impressions?: number;
    readonly reach?: number;
    readonly engagementRate?: number;
  };
}

/**
 * An engagement action (like, share, comment, mention) was received on a post.
 */
export interface WebhookEngagementEvent extends DomainWebhookEvent {
  readonly eventType: "LIKE_RECEIVED" | "COMMENT_RECEIVED" | "SHARE_RECEIVED" | "MENTION_RECEIVED";
  /** Provider-specific ID of the post that received engagement */
  readonly externalPostId?: string;
  /** Provider-specific ID of the user who engaged */
  readonly externalUserId?: string;
  /** Incremental change in engagement counts caused by this event */
  readonly delta: {
    readonly likes?: number;
    readonly comments?: number;
    readonly shares?: number;
    readonly mentions?: number;
  };
}

/**
 * A video was processed, published, or monetized on the platform.
 */
export interface WebhookVideoEvent extends DomainWebhookEvent {
  readonly eventType: "VIDEO_PROCESSED" | "VIDEO_MONETIZED";
  readonly externalVideoId?: string;
  readonly status?: string;
}

/**
 * A live stream started or ended on the platform.
 */
export interface WebhookLiveStreamEvent extends DomainWebhookEvent {
  readonly eventType: "LIVE_STREAM_STARTED" | "LIVE_STREAM_ENDED";
  readonly externalStreamId?: string;
}

/**
 * A story published to the platform has expired.
 */
export interface WebhookStoryExpiredEvent extends DomainWebhookEvent {
  readonly eventType: "STORY_EXPIRED";
  readonly externalPostId?: string;
  readonly expiredAt: Date;
}

/**
 * An account was connected to or disconnected from the platform.
 */
export interface WebhookAccountStatusEvent extends DomainWebhookEvent {
  readonly eventType: "ACCOUNT_CONNECTED" | "ACCOUNT_DISCONNECTED" | "PERMISSION_CHANGED";
  readonly externalUserId?: string;
}

/**
 * The provider platform returned a rate-limit or quota exceeded signal.
 */
export interface WebhookRateLimitEvent extends DomainWebhookEvent {
  readonly eventType: "RATE_LIMIT_REACHED" | "QUOTA_EXCEEDED" | "API_ERROR";
  readonly retryAfterMs?: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

/**
 * Union of all strongly-typed domain webhook events.
 * Downstream code should switch on `eventType` and handle each branch.
 */
export type TypedDomainWebhookEvent =
  | WebhookPostPublishedEvent
  | WebhookPostUpdatedEvent
  | WebhookPostDeletedEvent
  | WebhookAnalyticsUpdatedEvent
  | WebhookEngagementEvent
  | WebhookVideoEvent
  | WebhookLiveStreamEvent
  | WebhookStoryExpiredEvent
  | WebhookAccountStatusEvent
  | WebhookRateLimitEvent;

// ============================================================
// Mapper (Anti-Corruption Layer)
// ============================================================

/**
 * Anti-Corruption Layer: translates normalized webhook data into typed domain events.
 *
 * All static methods are pure functions with no I/O side-effects, making them
 * trivially unit-testable.
 *
 * Conforms to `exactOptionalPropertyTypes: true` — optional fields are set via
 * conditional spreads (`...(val !== undefined && { field: val })`) so no explicit
 * `undefined` values are ever assigned to `readonly field?: Type` properties.
 */
export class WebhookEventMapper {
  /**
   * Create a strongly-typed domain webhook event from the normalized data
   * produced by an `AbstractWebhookProcessor` subclass.
   *
   * @param eventType  - Provider-agnostic classification (from processor.parsePayload)
   * @param provider   - Source social media provider
   * @param normalized - Normalized payload from the webhook processor
   * @param related    - Database entities found for this event
   * @returns Strongly-typed domain webhook event
   */
  static fromNormalized(
    eventType: WebhookEventType,
    provider: ProviderName,
    normalized: Record<string, unknown>,
    related: RelatedEntities
  ): TypedDomainWebhookEvent {
    const base = {
      domainEventId: randomUUID(),
      provider,
      occurredAt: new Date(),
      relatedEntities: related,
    };

    const externalId = WebhookEventMapper.extractExternalId(normalized, provider);

    switch (eventType) {
      // ── Publication events ───────────────────────────────────────────
      case "POST_PUBLISHED":
      case "STORY_PUBLISHED":
      case "REEL_PUBLISHED": {
        const publishedAt = WebhookEventMapper.extractDate(normalized, "createdAt");
        const event: WebhookPostPublishedEvent = {
          ...base,
          eventType,
          ...(externalId !== undefined && { externalPostId: externalId }),
          ...(publishedAt !== undefined && { publishedAt }),
          engagementSnapshot: {
            likes: WebhookEventMapper.toNumber(
              normalized.likes ?? normalized.favoriteCount ?? normalized.likeCount ?? 0
            ),
            shares: WebhookEventMapper.toNumber(
              normalized.shares ?? normalized.retweetCount ?? normalized.shareCount ?? 0
            ),
            comments: WebhookEventMapper.toNumber(
              normalized.comments ?? normalized.commentCount ?? 0
            ),
            views: WebhookEventMapper.toNumber(normalized.views ?? normalized.viewCount ?? 0),
          },
        };
        return event;
      }

      // ── Update ───────────────────────────────────────────────────────
      case "POST_UPDATED": {
        const updatedAt = WebhookEventMapper.extractDate(normalized, "updatedAt");
        const event: WebhookPostUpdatedEvent = {
          ...base,
          eventType: "POST_UPDATED",
          ...(externalId !== undefined && { externalPostId: externalId }),
          ...(updatedAt !== undefined && { updatedAt }),
        };
        return event;
      }

      // ── Deletion ─────────────────────────────────────────────────────
      case "POST_DELETED": {
        const deletedAt =
          WebhookEventMapper.extractDate(normalized, "deletedAt") ??
          WebhookEventMapper.extractDate(normalized, "timestamp") ??
          new Date();
        const event: WebhookPostDeletedEvent = {
          ...base,
          eventType: "POST_DELETED",
          ...(externalId !== undefined && { externalPostId: externalId }),
          deletedAt,
        };
        return event;
      }

      // ── Story expiry ──────────────────────────────────────────────────
      case "STORY_EXPIRED": {
        const expiredAt =
          WebhookEventMapper.extractDate(normalized, "expiredAt") ??
          WebhookEventMapper.extractDate(normalized, "timestamp") ??
          new Date();
        const event: WebhookStoryExpiredEvent = {
          ...base,
          eventType: "STORY_EXPIRED",
          ...(externalId !== undefined && { externalPostId: externalId }),
          expiredAt,
        };
        return event;
      }

      // ── Engagement delta events ───────────────────────────────────────
      case "LIKE_RECEIVED": {
        const userId = typeof normalized.userId === "string" ? normalized.userId : undefined;
        const event: WebhookEngagementEvent = {
          ...base,
          eventType: "LIKE_RECEIVED",
          ...(externalId !== undefined && { externalPostId: externalId }),
          ...(userId !== undefined && { externalUserId: userId }),
          delta: { likes: 1 },
        };
        return event;
      }

      case "SHARE_RECEIVED": {
        const userId = typeof normalized.userId === "string" ? normalized.userId : undefined;
        const event: WebhookEngagementEvent = {
          ...base,
          eventType: "SHARE_RECEIVED",
          ...(externalId !== undefined && { externalPostId: externalId }),
          ...(userId !== undefined && { externalUserId: userId }),
          delta: { shares: 1 },
        };
        return event;
      }

      case "COMMENT_RECEIVED": {
        const userId = typeof normalized.userId === "string" ? normalized.userId : undefined;
        const event: WebhookEngagementEvent = {
          ...base,
          eventType: "COMMENT_RECEIVED",
          ...(externalId !== undefined && { externalPostId: externalId }),
          ...(userId !== undefined && { externalUserId: userId }),
          delta: { comments: 1 },
        };
        return event;
      }

      case "MENTION_RECEIVED": {
        const userId = typeof normalized.userId === "string" ? normalized.userId : undefined;
        const event: WebhookEngagementEvent = {
          ...base,
          eventType: "MENTION_RECEIVED",
          ...(externalId !== undefined && { externalPostId: externalId }),
          ...(userId !== undefined && { externalUserId: userId }),
          delta: { mentions: 1 },
        };
        return event;
      }

      // ── Analytics bulk updates ────────────────────────────────────────
      case "POST_ENGAGEMENT_UPDATE":
      case "MILESTONE_REACHED":
      case "VIRAL_CONTENT_DETECTED": {
        const event: WebhookAnalyticsUpdatedEvent = {
          ...base,
          eventType,
          ...(externalId !== undefined && { externalPostId: externalId }),
          metrics: WebhookEventMapper.extractMetrics(normalized),
        };
        return event;
      }

      // ── Video events ──────────────────────────────────────────────────
      case "VIDEO_PROCESSED":
      case "VIDEO_MONETIZED": {
        const videoId =
          typeof normalized.videoId === "string"
            ? normalized.videoId
            : typeof normalized.itemId === "string"
              ? normalized.itemId
              : undefined;
        const status = typeof normalized.status === "string" ? normalized.status : undefined;
        const event: WebhookVideoEvent = {
          ...base,
          eventType,
          ...(videoId !== undefined && { externalVideoId: videoId }),
          ...(status !== undefined && { status }),
        };
        return event;
      }

      // ── Live stream events ────────────────────────────────────────────
      case "LIVE_STREAM_STARTED":
      case "LIVE_STREAM_ENDED": {
        const streamId =
          typeof normalized.streamId === "string"
            ? normalized.streamId
            : typeof normalized.videoId === "string"
              ? normalized.videoId
              : undefined;
        const event: WebhookLiveStreamEvent = {
          ...base,
          eventType,
          ...(streamId !== undefined && { externalStreamId: streamId }),
        };
        return event;
      }

      // ── Account/permission events ─────────────────────────────────────
      case "ACCOUNT_CONNECTED":
      case "ACCOUNT_DISCONNECTED":
      case "PERMISSION_CHANGED": {
        const userId = typeof normalized.userId === "string" ? normalized.userId : undefined;
        const event: WebhookAccountStatusEvent = {
          ...base,
          eventType,
          ...(userId !== undefined && { externalUserId: userId }),
        };
        return event;
      }

      // ── Platform error/limit signals ──────────────────────────────────
      case "RATE_LIMIT_REACHED":
      case "QUOTA_EXCEEDED":
      case "API_ERROR": {
        const retryAfterMs =
          typeof normalized.retryAfterMs === "number" ? normalized.retryAfterMs : undefined;
        const errorCode =
          typeof normalized.errorCode === "string" ? normalized.errorCode : undefined;
        const errorMessage =
          typeof normalized.errorMessage === "string" ? normalized.errorMessage : undefined;
        const event: WebhookRateLimitEvent = {
          ...base,
          eventType,
          ...(retryAfterMs !== undefined && { retryAfterMs }),
          ...(errorCode !== undefined && { errorCode }),
          ...(errorMessage !== undefined && { errorMessage }),
        };
        return event;
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Extract the provider-specific external content ID from normalized data.
   * Each provider uses different field names for the same concept (post/media ID).
   */
  private static extractExternalId(
    data: Record<string, unknown>,
    provider: ProviderName
  ): string | undefined {
    switch (provider) {
      case "X":
        return typeof data.tweetId === "string"
          ? data.tweetId
          : typeof data.originalTweetId === "string"
            ? data.originalTweetId
            : undefined;
      case "INSTAGRAM":
        return typeof data.mediaId === "string"
          ? data.mediaId
          : typeof data.postId === "string"
            ? data.postId
            : undefined;
      case "FACEBOOK":
        return typeof data.postId === "string"
          ? data.postId
          : typeof data.videoId === "string"
            ? data.videoId
            : undefined;
      case "YOUTUBE":
        return typeof data.videoId === "string" ? data.videoId : undefined;
      case "TIKTOK":
        return typeof data.videoId === "string"
          ? data.videoId
          : typeof data.itemId === "string"
            ? data.itemId
            : undefined;
    }
  }

  /**
   * Extract analytics metrics from normalized data.
   * Omits fields that are absent in the payload (no explicit undefined assignments).
   */
  private static extractMetrics(
    data: Record<string, unknown>
  ): WebhookAnalyticsUpdatedEvent["metrics"] {
    const pick = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

    const views = pick(data.views ?? data.viewCount);
    const likes = pick(data.likes ?? data.likeCount ?? data.favoriteCount);
    const shares = pick(data.shares ?? data.shareCount ?? data.retweetCount);
    const comments = pick(data.comments ?? data.commentCount);
    const clicks = pick(data.clicks);
    const impressions = pick(data.impressions);
    const reach = pick(data.reach);
    const engagementRate = pick(data.engagementRate);

    return {
      ...(views !== undefined && { views }),
      ...(likes !== undefined && { likes }),
      ...(shares !== undefined && { shares }),
      ...(comments !== undefined && { comments }),
      ...(clicks !== undefined && { clicks }),
      ...(impressions !== undefined && { impressions }),
      ...(reach !== undefined && { reach }),
      ...(engagementRate !== undefined && { engagementRate }),
    };
  }

  /**
   * Safely parse a Date from normalized data by field name.
   * Accepts Date objects, ISO strings, or Unix timestamps (ms).
   */
  private static extractDate(data: Record<string, unknown>, field: string): Date | undefined {
    const value = data[field];
    if (!value) return undefined;
    if (value instanceof Date) return isNaN(value.getTime()) ? undefined : value;
    if (typeof value === "string" || typeof value === "number") {
      const d = new Date(value);
      return isNaN(d.getTime()) ? undefined : d;
    }
    return undefined;
  }

  /**
   * Safely coerce any value to a non-negative number, defaulting to 0.
   */
  private static toNumber(value: unknown): number {
    if (typeof value === "number" && !isNaN(value)) return Math.max(0, value);
    if (typeof value === "string") {
      const n = Number(value);
      return isNaN(n) ? 0 : Math.max(0, n);
    }
    return 0;
  }
}
