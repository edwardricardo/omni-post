/**
 * Unit Tests for WebhookEventMapper
 *
 * Tests the Anti-Corruption Layer that translates normalized webhook data into
 * strongly-typed domain webhook events. All tests are pure (no I/O, no DB).
 *
 * @file WebhookEventMapper.test.ts
 * @description Tests for WebhookEventMapper
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import {
  WebhookEventMapper,
  type WebhookPostPublishedEvent,
  type WebhookPostDeletedEvent,
  type WebhookEngagementEvent,
  type WebhookAnalyticsUpdatedEvent,
  type WebhookStoryExpiredEvent,
  type WebhookVideoEvent,
  type WebhookLiveStreamEvent,
  type WebhookAccountStatusEvent,
  type WebhookRateLimitEvent,
} from "../../../src/webhooks/WebhookEventMapper.js";
import type { RelatedEntities } from "../../../src/webhooks/processors/AbstractWebhookProcessor.js";

const RELATED: RelatedEntities = {
  accountId: "acc-1",
  projectId: "proj-1",
  channelId: "chan-1",
  postId: "post-1",
};

const NO_RELATED: RelatedEntities = {};

describe("WebhookEventMapper", () => {
  // ── Base fields ──────────────────────────────────────────────────────────

  describe("common base fields", () => {
    it("should assign domainEventId (UUID format)", () => {
      const event = WebhookEventMapper.fromNormalized(
        "POST_PUBLISHED",
        "X",
        { tweetId: "123", createdAt: "2026-01-01T00:00:00Z" },
        RELATED
      );
      expect(event.domainEventId).toMatch(/^[\da-f-]{36}$/i);
    });

    it("should propagate provider", () => {
      const event = WebhookEventMapper.fromNormalized("LIKE_RECEIVED", "INSTAGRAM", {}, RELATED);
      expect(event.provider).toBe("INSTAGRAM");
    });

    it("should set occurredAt to a recent Date", () => {
      const before = Date.now();
      const event = WebhookEventMapper.fromNormalized("LIKE_RECEIVED", "X", {}, RELATED);
      const after = Date.now();
      expect(event.occurredAt instanceof Date).toBeTruthy();
      expect(event.occurredAt.getTime() >= before).toBeTruthy();
      expect(event.occurredAt.getTime() <= after).toBeTruthy();
    });

    it("should propagate relatedEntities", () => {
      const event = WebhookEventMapper.fromNormalized("LIKE_RECEIVED", "X", {}, RELATED);
      expect(event.relatedEntities).toEqual(RELATED);
    });

    it("should work with empty relatedEntities", () => {
      const event = WebhookEventMapper.fromNormalized("LIKE_RECEIVED", "X", {}, NO_RELATED);
      expect(event.relatedEntities).toEqual({});
    });
  });

  // ── POST_PUBLISHED ───────────────────────────────────────────────────────

  describe("POST_PUBLISHED (X)", () => {
    it("should extract tweetId as externalPostId", () => {
      const event = WebhookEventMapper.fromNormalized(
        "POST_PUBLISHED",
        "X",
        {
          tweetId: "tweet-abc",
          retweetCount: 5,
          favoriteCount: 10,
          createdAt: "2026-01-15T12:00:00Z",
        },
        RELATED
      ) as WebhookPostPublishedEvent;

      expect(event.eventType).toBe("POST_PUBLISHED");
      expect(event.externalPostId).toBe("tweet-abc");
    });

    it("should build engagement snapshot from X fields", () => {
      const event = WebhookEventMapper.fromNormalized(
        "POST_PUBLISHED",
        "X",
        { tweetId: "t1", retweetCount: 3, favoriteCount: 7 },
        RELATED
      ) as WebhookPostPublishedEvent;

      expect(event.engagementSnapshot.shares).toBe(3);
      expect(event.engagementSnapshot.likes).toBe(7);
      expect(event.engagementSnapshot.comments).toBe(0);
      expect(event.engagementSnapshot.views).toBe(0);
    });

    it("should fall back to originalTweetId when tweetId absent", () => {
      const event = WebhookEventMapper.fromNormalized(
        "POST_PUBLISHED",
        "X",
        { originalTweetId: "orig-99" },
        RELATED
      ) as WebhookPostPublishedEvent;

      expect(event.externalPostId).toBe("orig-99");
    });
  });

  describe("POST_PUBLISHED (INSTAGRAM)", () => {
    it("should extract mediaId as externalPostId", () => {
      const event = WebhookEventMapper.fromNormalized(
        "POST_PUBLISHED",
        "INSTAGRAM",
        { mediaId: "ig-media-1", likeCount: 20, commentCount: 3 },
        RELATED
      ) as WebhookPostPublishedEvent;

      expect(event.externalPostId).toBe("ig-media-1");
      expect(event.engagementSnapshot.likes).toBe(20);
      expect(event.engagementSnapshot.comments).toBe(3);
    });
  });

  describe("STORY_PUBLISHED", () => {
    it("should map STORY_PUBLISHED eventType", () => {
      const event = WebhookEventMapper.fromNormalized(
        "STORY_PUBLISHED",
        "INSTAGRAM",
        { mediaId: "story-1" },
        RELATED
      ) as WebhookPostPublishedEvent;

      expect(event.eventType).toBe("STORY_PUBLISHED");
      expect(event.externalPostId).toBe("story-1");
    });
  });

  describe("REEL_PUBLISHED", () => {
    it("should map REEL_PUBLISHED eventType", () => {
      const event = WebhookEventMapper.fromNormalized(
        "REEL_PUBLISHED",
        "INSTAGRAM",
        { mediaId: "reel-1" },
        RELATED
      ) as WebhookPostPublishedEvent;

      expect(event.eventType).toBe("REEL_PUBLISHED");
    });
  });

  // ── POST_DELETED ─────────────────────────────────────────────────────────

  describe("POST_DELETED", () => {
    it("should map POST_DELETED with deletedAt from payload", () => {
      const deletedAt = "2026-01-20T15:30:00Z";
      const event = WebhookEventMapper.fromNormalized(
        "POST_DELETED",
        "X",
        { tweetId: "dead-tweet", deletedAt },
        RELATED
      ) as WebhookPostDeletedEvent;

      expect(event.eventType).toBe("POST_DELETED");
      expect(event.externalPostId).toBe("dead-tweet");
      expect(event.deletedAt instanceof Date).toBeTruthy();
      expect(event.deletedAt.toISOString()).toBe(new Date(deletedAt).toISOString());
    });

    it("should use current date when deletedAt is absent", () => {
      const before = Date.now();
      const event = WebhookEventMapper.fromNormalized(
        "POST_DELETED",
        "FACEBOOK",
        { postId: "fb-post-1" },
        RELATED
      ) as WebhookPostDeletedEvent;

      expect(event.deletedAt.getTime() >= before).toBeTruthy();
    });
  });

  // ── STORY_EXPIRED ────────────────────────────────────────────────────────

  describe("STORY_EXPIRED", () => {
    it("should map STORY_EXPIRED with expiredAt", () => {
      const event = WebhookEventMapper.fromNormalized(
        "STORY_EXPIRED",
        "INSTAGRAM",
        { mediaId: "story-99", expiredAt: "2026-02-01T00:00:00Z" },
        RELATED
      ) as WebhookStoryExpiredEvent;

      expect(event.eventType).toBe("STORY_EXPIRED");
      expect(event.externalPostId).toBe("story-99");
      expect(event.expiredAt instanceof Date).toBeTruthy();
    });
  });

  // ── Engagement events ────────────────────────────────────────────────────

  describe("LIKE_RECEIVED", () => {
    it("should produce delta { likes: 1 }", () => {
      const event = WebhookEventMapper.fromNormalized(
        "LIKE_RECEIVED",
        "X",
        { tweetId: "t1", userId: "user-42" },
        RELATED
      ) as WebhookEngagementEvent;

      expect(event.eventType).toBe("LIKE_RECEIVED");
      expect(event.delta.likes).toBe(1);
      expect(event.externalUserId).toBe("user-42");
    });
  });

  describe("SHARE_RECEIVED", () => {
    it("should produce delta { shares: 1 }", () => {
      const event = WebhookEventMapper.fromNormalized(
        "SHARE_RECEIVED",
        "FACEBOOK",
        { postId: "fb-1", userId: "u1" },
        RELATED
      ) as WebhookEngagementEvent;

      expect(event.delta.shares).toBe(1);
    });
  });

  describe("COMMENT_RECEIVED", () => {
    it("should produce delta { comments: 1 }", () => {
      const event = WebhookEventMapper.fromNormalized(
        "COMMENT_RECEIVED",
        "YOUTUBE",
        { videoId: "yt-1" },
        RELATED
      ) as WebhookEngagementEvent;

      expect(event.delta.comments).toBe(1);
      expect(event.externalPostId).toBe("yt-1");
    });
  });

  describe("MENTION_RECEIVED", () => {
    it("should produce delta { mentions: 1 }", () => {
      const event = WebhookEventMapper.fromNormalized(
        "MENTION_RECEIVED",
        "X",
        { tweetId: "mention-1" },
        RELATED
      ) as WebhookEngagementEvent;

      expect(event.eventType).toBe("MENTION_RECEIVED");
      expect(event.delta.mentions).toBe(1);
    });
  });

  // ── Analytics bulk updates ───────────────────────────────────────────────

  describe("POST_ENGAGEMENT_UPDATE", () => {
    it("should extract full metrics block", () => {
      const event = WebhookEventMapper.fromNormalized(
        "POST_ENGAGEMENT_UPDATE",
        "YOUTUBE",
        {
          videoId: "yt-video-1",
          viewCount: 10000,
          likeCount: 500,
          commentCount: 75,
          impressions: 20000,
          reach: 15000,
          engagementRate: 2.875,
        },
        RELATED
      ) as WebhookAnalyticsUpdatedEvent;

      expect(event.eventType).toBe("POST_ENGAGEMENT_UPDATE");
      expect(event.externalPostId).toBe("yt-video-1");
      expect(event.metrics.views).toBe(10000);
      expect(event.metrics.likes).toBe(500);
      expect(event.metrics.comments).toBe(75);
      expect(event.metrics.impressions).toBe(20000);
      expect(event.metrics.reach).toBe(15000);
      expect(event.metrics.engagementRate).toBe(2.875);
    });

    it("should omit undefined metric fields", () => {
      const event = WebhookEventMapper.fromNormalized(
        "POST_ENGAGEMENT_UPDATE",
        "TIKTOK",
        { videoId: "tt-1", viewCount: 999 },
        RELATED
      ) as WebhookAnalyticsUpdatedEvent;

      expect(event.metrics.views).toBe(999);
      expect(event.metrics.likes).toBe(undefined);
      expect(event.metrics.impressions).toBe(undefined);
    });
  });

  describe("VIRAL_CONTENT_DETECTED", () => {
    it("should map to WebhookAnalyticsUpdatedEvent", () => {
      const event = WebhookEventMapper.fromNormalized(
        "VIRAL_CONTENT_DETECTED",
        "TIKTOK",
        { videoId: "viral-1", viewCount: 1000000, likeCount: 50000 },
        RELATED
      ) as WebhookAnalyticsUpdatedEvent;

      expect(event.eventType).toBe("VIRAL_CONTENT_DETECTED");
      expect(event.metrics.views).toBe(1000000);
    });
  });

  // ── Video events ─────────────────────────────────────────────────────────

  describe("VIDEO_PROCESSED", () => {
    it("should map YouTube videoId", () => {
      const event = WebhookEventMapper.fromNormalized(
        "VIDEO_PROCESSED",
        "YOUTUBE",
        { videoId: "yt-processed-1", status: "ready" },
        RELATED
      ) as WebhookVideoEvent;

      expect(event.eventType).toBe("VIDEO_PROCESSED");
      expect(event.externalVideoId).toBe("yt-processed-1");
      expect(event.status).toBe("ready");
    });

    it("should map TikTok itemId as video ID", () => {
      const event = WebhookEventMapper.fromNormalized(
        "VIDEO_PROCESSED",
        "TIKTOK",
        { itemId: "tt-item-1" },
        RELATED
      ) as WebhookVideoEvent;

      expect(event.externalVideoId).toBe("tt-item-1");
    });
  });

  // ── Live stream events ───────────────────────────────────────────────────

  describe("LIVE_STREAM_STARTED / LIVE_STREAM_ENDED", () => {
    it("should map streamId", () => {
      const started = WebhookEventMapper.fromNormalized(
        "LIVE_STREAM_STARTED",
        "YOUTUBE",
        { streamId: "stream-1" },
        RELATED
      ) as WebhookLiveStreamEvent;

      expect(started.eventType).toBe("LIVE_STREAM_STARTED");
      expect(started.externalStreamId).toBe("stream-1");

      const ended = WebhookEventMapper.fromNormalized(
        "LIVE_STREAM_ENDED",
        "YOUTUBE",
        { videoId: "stream-2" },
        RELATED
      ) as WebhookLiveStreamEvent;

      expect(ended.eventType).toBe("LIVE_STREAM_ENDED");
      expect(ended.externalStreamId).toBe("stream-2");
    });
  });

  // ── Account status events ────────────────────────────────────────────────

  describe("ACCOUNT_CONNECTED / ACCOUNT_DISCONNECTED / PERMISSION_CHANGED", () => {
    it("should extract externalUserId", () => {
      const connected = WebhookEventMapper.fromNormalized(
        "ACCOUNT_CONNECTED",
        "X",
        { userId: "x-user-99" },
        RELATED
      ) as WebhookAccountStatusEvent;

      expect(connected.eventType).toBe("ACCOUNT_CONNECTED");
      expect(connected.externalUserId).toBe("x-user-99");

      const disconnected = WebhookEventMapper.fromNormalized(
        "ACCOUNT_DISCONNECTED",
        "INSTAGRAM",
        { userId: "ig-user-1" },
        RELATED
      ) as WebhookAccountStatusEvent;

      expect(disconnected.eventType).toBe("ACCOUNT_DISCONNECTED");
    });

    it("should handle absent userId gracefully", () => {
      const event = WebhookEventMapper.fromNormalized(
        "PERMISSION_CHANGED",
        "FACEBOOK",
        {},
        RELATED
      ) as WebhookAccountStatusEvent;

      expect(event.externalUserId).toBe(undefined);
    });
  });

  // ── Rate limit / API error events ────────────────────────────────────────

  describe("RATE_LIMIT_REACHED / QUOTA_EXCEEDED / API_ERROR", () => {
    it("should extract retryAfterMs, errorCode, errorMessage", () => {
      const event = WebhookEventMapper.fromNormalized(
        "RATE_LIMIT_REACHED",
        "X",
        { retryAfterMs: 60000, errorCode: "88", errorMessage: "Rate limit exceeded" },
        RELATED
      ) as WebhookRateLimitEvent;

      expect(event.eventType).toBe("RATE_LIMIT_REACHED");
      expect(event.retryAfterMs).toBe(60000);
      expect(event.errorCode).toBe("88");
      expect(event.errorMessage).toBe("Rate limit exceeded");
    });

    it("should omit absent optional fields", () => {
      const event = WebhookEventMapper.fromNormalized(
        "API_ERROR",
        "TIKTOK",
        { errorCode: "E500" },
        RELATED
      ) as WebhookRateLimitEvent;

      expect(event.errorCode).toBe("E500");
      expect(event.retryAfterMs).toBe(undefined);
      expect(event.errorMessage).toBe(undefined);
    });
  });

  // ── External ID extraction per provider ──────────────────────────────────

  describe("externalPostId extraction", () => {
    const cases: Array<{
      provider: "X" | "INSTAGRAM" | "FACEBOOK" | "YOUTUBE" | "TIKTOK";
      data: Record<string, unknown>;
      expected: string;
    }> = [
      { provider: "X", data: { tweetId: "tw1" }, expected: "tw1" },
      { provider: "INSTAGRAM", data: { mediaId: "ig1" }, expected: "ig1" },
      { provider: "INSTAGRAM", data: { postId: "ig-post-1" }, expected: "ig-post-1" },
      { provider: "FACEBOOK", data: { postId: "fb1" }, expected: "fb1" },
      { provider: "FACEBOOK", data: { videoId: "fbv1" }, expected: "fbv1" },
      { provider: "YOUTUBE", data: { videoId: "yt1" }, expected: "yt1" },
      { provider: "TIKTOK", data: { videoId: "tt1" }, expected: "tt1" },
      { provider: "TIKTOK", data: { itemId: "tt-item-1" }, expected: "tt-item-1" },
    ];

    for (const { provider, data, expected } of cases) {
      it(`${provider}: extracts "${expected}"`, () => {
        const event = WebhookEventMapper.fromNormalized(
          "POST_PUBLISHED",
          provider,
          data,
          RELATED
        ) as WebhookPostPublishedEvent;
        expect(event.externalPostId).toBe(expected);
      });
    }
  });

  // ── toNumber edge cases ───────────────────────────────────────────────────

  describe("engagement number coercion", () => {
    it("should treat negative numbers as 0", () => {
      const event = WebhookEventMapper.fromNormalized(
        "POST_PUBLISHED",
        "X",
        { tweetId: "t1", favoriteCount: -5 },
        RELATED
      ) as WebhookPostPublishedEvent;

      expect(event.engagementSnapshot.likes).toBe(0);
    });

    it("should treat string numbers as numbers", () => {
      const event = WebhookEventMapper.fromNormalized(
        "POST_PUBLISHED",
        "X",
        { tweetId: "t1", favoriteCount: "42" as unknown as number },
        RELATED
      ) as WebhookPostPublishedEvent;

      expect(event.engagementSnapshot.likes).toBe(42);
    });

    it("should treat NaN as 0", () => {
      const event = WebhookEventMapper.fromNormalized(
        "POST_PUBLISHED",
        "X",
        { tweetId: "t1", favoriteCount: NaN },
        RELATED
      ) as WebhookPostPublishedEvent;

      expect(event.engagementSnapshot.likes).toBe(0);
    });
  });
});
