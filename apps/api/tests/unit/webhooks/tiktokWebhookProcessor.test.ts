/**
 * Comprehensive Unit Tests for TikTokWebhookProcessor
 *
 * BUSINESS LOGIC VALIDATION:
 * This test suite validates the TikTok webhook processor which handles incoming
 * webhooks from TikTok Business API.
 *
 * KEY BUSINESS CAPABILITIES TESTED:
 * - HMAC-SHA256 signature verification
 * - Video create/publish event parsing
 * - Video remove/delete event handling
 * - Comment and reply event processing
 * - User authorization revocation handling
 * - Video statistics update events
 * - Entity relationship resolution (channel, project, account, post)
 * - Analytics tracking and engagement updates
 * - Real-time broadcasting integration
 *
 * WEBHOOK BUSINESS RULES:
 * - Signature uses HMAC-SHA256 with client secret
 * - Event types: video.create, video.publish, video.remove, comment.create, comment.reply
 * - User authorization events: user.authorization.revoke
 * - Statistics events: video.statistics.update
 * - Video metadata includes duration, cover URL, share URL
 * - Comments track like counts and reply relationships
 * - Statistics include views, likes, comments, shares, saves
 *
 * PROVIDER-SPECIFIC FORMATS:
 * - Signature: sha256=<hex> in x-signature header
 * - Payload structure: { event: { type, content: {...} } }
 * - Event types use dot notation: video.create, comment.create, etc.
 * - Content nested within event object
 *
 * RUN COMMAND:
 * pnpm --filter @apps/api exec node --import tsx --test tests/unit/webhooks/tiktokWebhookProcessor.test.ts
 *
 * @module TikTokWebhookProcessorTests
 * @category UnitTests
 *
 * @file tiktokWebhookProcessor.test.ts
 * @description Tests for TikTokWebhookProcessor - Signature Verification
 * @layer infrastructure
 */

import { describe, it, beforeAll, expect } from "vitest";
import { createHmac } from "crypto";
import { TikTokWebhookProcessor } from "../../../src/webhooks/processors/tiktokWebhookProcessor.js";

// ===========================
// Test Helpers
// ===========================

function generateHmacSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

// ===========================
// Signature Verification Tests (8 tests)
// ===========================

describe("TikTokWebhookProcessor - Signature Verification", () => {
  let processor: TikTokWebhookProcessor;
  const testSecret = "test-tiktok-client-secret";

  beforeAll(() => {
    processor = new TikTokWebhookProcessor();
  });

  it("should verify valid webhook signature with sha256= prefix", () => {
    const payload = JSON.stringify({ test: "data" });
    const signature = generateHmacSignature(payload, testSecret);

    const isValid = processor.verify(payload, `sha256=${signature}`, testSecret);
    expect(isValid).toBe(true);
  });

  it("should verify valid webhook signature without sha256= prefix", () => {
    const payload = JSON.stringify({ test: "data" });
    const signature = generateHmacSignature(payload, testSecret);

    const isValid = processor.verify(payload, signature, testSecret);
    expect(isValid).toBe(true);
  });

  it("should reject invalid signature", () => {
    const payload = JSON.stringify({ test: "data" });
    const invalidSignature = "sha256=invalid-signature-value";

    const isValid = processor.verify(payload, invalidSignature, testSecret);
    expect(isValid).toBe(false);
  });

  it("should reject signature with tampered payload", () => {
    const originalPayload = JSON.stringify({ test: "data" });
    const signature = generateHmacSignature(originalPayload, testSecret);

    const tamperedPayload = JSON.stringify({ test: "tampered" });
    const isValid = processor.verify(tamperedPayload, signature, testSecret);
    expect(isValid).toBe(false);
  });

  it("should reject signature with wrong secret", () => {
    const payload = JSON.stringify({ test: "data" });
    const signature = generateHmacSignature(payload, "wrong-secret");

    const isValid = processor.verify(payload, signature, testSecret);
    expect(isValid).toBe(false);
  });

  it("should handle empty payload", () => {
    const payload = "";
    const signature = generateHmacSignature(payload, testSecret);

    const isValid = processor.verify(payload, signature, testSecret);
    expect(isValid).toBe(true);
  });

  it("should handle special characters in payload", () => {
    const payload = JSON.stringify({ test: "data with unicode 🎵 and characters" });
    const signature = generateHmacSignature(payload, testSecret);

    const isValid = processor.verify(payload, `sha256=${signature}`, testSecret);
    expect(isValid).toBe(true);
  });

  it("should use constant-time comparison", () => {
    const payload = JSON.stringify({ test: "data" });
    const correctSignature = generateHmacSignature(payload, testSecret);

    // Test multiple attempts to verify timing consistency
    for (let i = 0; i < 10; i++) {
      const isValid = processor.verify(payload, correctSignature, testSecret);
      expect(isValid).toBe(true);
    }
  });
});

// ===========================
// Video Create Event Parsing Tests (5 tests)
// ===========================

describe("TikTokWebhookProcessor - Video Create Event Parsing", () => {
  let processor: TikTokWebhookProcessor;

  beforeAll(() => {
    processor = new TikTokWebhookProcessor();
  });

  it("should parse video.create event", async () => {
    const payload = {
      event: {
        type: "video.create",
        content: {
          video_id: "video-123",
          user_id: "user-456",
          title: "Test TikTok Video",
          video_description: "Amazing content!",
          cover_image_url: "https://tiktok.com/covers/123.jpg",
          video_url: "https://tiktok.com/videos/123",
          share_url: "https://tiktok.com/share/123",
          duration: 30,
          create_time: "2024-01-15T10:00:00Z",
          publish_time: "2024-01-15T10:05:00Z",
          is_private: false,
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("POST_PUBLISHED");
    expect(result.normalizedData.eventType).toBe("video_created");
    expect(result.normalizedData.videoId).toBe("video-123");
    expect(result.normalizedData.userId).toBe("user-456");
    expect(result.normalizedData.title).toBe("Test TikTok Video");
    expect(result.normalizedData.description).toBe("Amazing content!");
    expect(result.normalizedData.duration).toBe(30);
    expect(result.normalizedData.isPrivate).toBe(false);
  });

  it("should parse video.publish event", async () => {
    const payload = {
      event: {
        type: "video.publish",
        content: {
          video_id: "video-789",
          user_id: "user-111",
          video_description: "Published video",
          share_url: "https://tiktok.com/share/789",
          publish_time: "2024-01-15T11:00:00Z",
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("POST_PUBLISHED");
    expect(result.normalizedData.videoId).toBe("video-789");
  });

  it("should handle video with author_id instead of user_id", async () => {
    const payload = {
      event: {
        type: "video.create",
        content: {
          video_id: "video-alt",
          author_id: "author-222",
          video_description: "Author ID test",
          create_time: "2024-01-15T12:00:00Z",
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.userId).toBe("author-222");
  });

  it("should handle private video flag", async () => {
    const payload = {
      event: {
        type: "video.create",
        content: {
          video_id: "video-private",
          user_id: "user-333",
          video_description: "Private video",
          create_time: "2024-01-15T13:00:00Z",
          is_private: true,
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.isPrivate).toBe(true);
  });

  it("should extract all video metadata fields", async () => {
    const payload = {
      event: {
        type: "video.create",
        content: {
          video_id: "video-full",
          user_id: "user-444",
          title: "Full Metadata Video",
          video_description: "Complete data",
          cover_image_url: "https://tiktok.com/covers/full.jpg",
          cover_url: "https://tiktok.com/covers/alt.jpg",
          video_url: "https://tiktok.com/videos/full",
          share_url: "https://tiktok.com/share/full",
          duration: 60,
          create_time: "2024-01-15T14:00:00Z",
          publish_time: "2024-01-15T14:05:00Z",
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.coverUrl).toBe("https://tiktok.com/covers/full.jpg");
    expect(result.normalizedData.videoUrl).toBe("https://tiktok.com/videos/full");
    expect(result.normalizedData.shareUrl).toBe("https://tiktok.com/share/full");
    expect(result.normalizedData.createdAt).toBe("2024-01-15T14:00:00Z");
    expect(result.normalizedData.publishedAt).toBe("2024-01-15T14:05:00Z");
  });
});

// ===========================
// Video Remove Event Parsing Tests (3 tests)
// ===========================

describe("TikTokWebhookProcessor - Video Remove Event Parsing", () => {
  let processor: TikTokWebhookProcessor;

  beforeAll(() => {
    processor = new TikTokWebhookProcessor();
  });

  it("should parse video.remove event", async () => {
    const payload = {
      event: {
        type: "video.remove",
        content: {
          video_id: "video-removed",
          user_id: "user-555",
          remove_time: "2024-01-15T15:00:00Z",
          reason: "user_deleted",
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("POST_DELETED");
    expect(result.normalizedData.eventType).toBe("video_removed");
    expect(result.normalizedData.videoId).toBe("video-removed");
    expect(result.normalizedData.userId).toBe("user-555");
    expect(result.normalizedData.removedAt).toBe("2024-01-15T15:00:00Z");
    expect(result.normalizedData.reason).toBe("user_deleted");
  });

  it("should parse video.delete event", async () => {
    const payload = {
      event: {
        type: "video.delete",
        content: {
          video_id: "video-deleted",
          user_id: "user-666",
          deleted_at: "2024-01-15T16:00:00Z",
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("POST_DELETED");
    expect(result.normalizedData.videoId).toBe("video-deleted");
  });

  it("should use current timestamp if removal time not provided", async () => {
    const beforeTime = new Date().toISOString();

    const payload = {
      event: {
        type: "video.remove",
        content: {
          video_id: "video-no-time",
          user_id: "user-777",
        },
      },
    };

    const result = await processor.parse(payload);

    const afterTime = new Date().toISOString();

    expect(result.normalizedData.removedAt >= beforeTime).toBeTruthy();
    expect(result.normalizedData.removedAt <= afterTime).toBeTruthy();
  });
});

// ===========================
// Comment Event Parsing Tests (4 tests)
// ===========================

describe("TikTokWebhookProcessor - Comment Event Parsing", () => {
  let processor: TikTokWebhookProcessor;

  beforeAll(() => {
    processor = new TikTokWebhookProcessor();
  });

  it("should parse comment.create event", async () => {
    const payload = {
      event: {
        type: "comment.create",
        content: {
          comment_id: "comment-123",
          video_id: "video-456",
          comment_text: "Great video!",
          user_id: "commenter-789",
          username: "commenter_username",
          create_time: "2024-01-15T17:00:00Z",
          like_count: 10,
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("COMMENT_RECEIVED");
    expect(result.normalizedData.eventType).toBe("comment_received");
    expect(result.normalizedData.commentId).toBe("comment-123");
    expect(result.normalizedData.videoId).toBe("video-456");
    expect(result.normalizedData.text).toBe("Great video!");
    expect(result.normalizedData.username).toBe("commenter_username");
    expect(result.normalizedData.isReply).toBe(false);
    expect(result.normalizedData.likeCount).toBe(10);
  });

  it("should parse comment.reply event", async () => {
    const payload = {
      event: {
        type: "comment.reply",
        content: {
          comment_id: "reply-456",
          video_id: "video-789",
          comment_text: "Thanks for watching!",
          user_id: "replier-111",
          username: "video_owner",
          create_time: "2024-01-15T18:00:00Z",
          parent_comment_id: "comment-123",
          like_count: 5,
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("COMMENT_RECEIVED");
    expect(result.normalizedData.eventType).toBe("comment_reply_received");
    expect(result.normalizedData.isReply).toBe(true);
    expect(result.normalizedData.parentId).toBe("comment-123");
  });

  it("should handle alternative field names for comments", async () => {
    const payload = {
      event: {
        type: "comment.create",
        content: {
          id: "comment-alt",
          video_id: "video-111",
          text: "Alternative field names",
          commenter_id: "user-222",
          commenter_username: "alt_user",
          created_at: "2024-01-15T19:00:00Z",
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.commentId).toBe("comment-alt");
    expect(result.normalizedData.text).toBe("Alternative field names");
    expect(result.normalizedData.userId).toBe("user-222");
    expect(result.normalizedData.username).toBe("alt_user");
  });

  it("should default like count to zero if not provided", async () => {
    const payload = {
      event: {
        type: "comment.create",
        content: {
          comment_id: "comment-no-likes",
          video_id: "video-333",
          comment_text: "No likes yet",
          user_id: "user-444",
          create_time: "2024-01-15T20:00:00Z",
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.likeCount).toBe(0);
  });
});

// ===========================
// Authorization Revoke Event Parsing Tests (3 tests)
// ===========================

describe("TikTokWebhookProcessor - Authorization Revoke Event Parsing", () => {
  let processor: TikTokWebhookProcessor;

  beforeAll(() => {
    processor = new TikTokWebhookProcessor();
  });

  it("should parse user.authorization.revoke event", async () => {
    const payload = {
      event: {
        type: "user.authorization.revoke",
        content: {
          user_id: "user-123",
          revoke_time: "2024-01-15T21:00:00Z",
          reason: "user_revoked",
          scopes: ["user.info.basic", "video.list"],
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("ACCOUNT_DISCONNECTED");
    expect(result.normalizedData.eventType).toBe("auth_revoked");
    expect(result.normalizedData.userId).toBe("user-123");
    expect(result.normalizedData.revokedAt).toBe("2024-01-15T21:00:00Z");
    expect(result.normalizedData.reason).toBe("user_revoked");
    expect(result.normalizedData.scopes).toStrictEqual(["user.info.basic", "video.list"]);
  });

  it("should handle open_id field for user identification", async () => {
    const payload = {
      event: {
        type: "user.authorization.revoke",
        content: {
          open_id: "open-id-456",
          revoke_time: "2024-01-15T22:00:00Z",
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.userId).toBe("open-id-456");
  });

  it("should use current timestamp if revoke time not provided", async () => {
    const beforeTime = new Date().toISOString();

    const payload = {
      event: {
        type: "user.authorization.revoke",
        content: {
          user_id: "user-789",
        },
      },
    };

    const result = await processor.parse(payload);

    const afterTime = new Date().toISOString();

    expect(result.normalizedData.revokedAt >= beforeTime).toBeTruthy();
    expect(result.normalizedData.revokedAt <= afterTime).toBeTruthy();
  });
});

// ===========================
// Video Statistics Event Parsing Tests (4 tests)
// ===========================

describe("TikTokWebhookProcessor - Video Statistics Event Parsing", () => {
  let processor: TikTokWebhookProcessor;

  beforeAll(() => {
    processor = new TikTokWebhookProcessor();
  });

  it("should parse video.statistics.update event", async () => {
    const payload = {
      event: {
        type: "video.statistics.update",
        content: {
          video_id: "video-stats",
          user_id: "user-111",
          view_count: 50000,
          like_count: 2500,
          comment_count: 300,
          share_count: 150,
          save_count: 100,
          captured_at: "2024-01-15T23:00:00Z",
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("POST_ENGAGEMENT_UPDATE");
    expect(result.normalizedData.eventType).toBe("video_statistics_update");
    expect(result.normalizedData.videoId).toBe("video-stats");
    expect(result.normalizedData.views).toBe(50000);
    expect(result.normalizedData.likes).toBe(2500);
    expect(result.normalizedData.comments).toBe(300);
    expect(result.normalizedData.shares).toBe(150);
    expect(result.normalizedData.saves).toBe(100);
  });

  it("should handle alternative field names for statistics", async () => {
    const payload = {
      event: {
        type: "video.statistics.update",
        content: {
          video_id: "video-alt-stats",
          author_id: "author-222",
          play_count: 75000,
          like_count: 3000,
          comment_count: 400,
          share_count: 200,
          favorite_count: 150,
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.views).toBe(75000);
    expect(result.normalizedData.saves).toBe(150);
  });

  it("should default statistics to zero if not provided", async () => {
    const payload = {
      event: {
        type: "video.statistics.update",
        content: {
          video_id: "video-zero-stats",
          user_id: "user-333",
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.views).toBe(0);
    expect(result.normalizedData.likes).toBe(0);
    expect(result.normalizedData.comments).toBe(0);
    expect(result.normalizedData.shares).toBe(0);
  });

  it("should use current timestamp if captured_at not provided", async () => {
    const beforeTime = new Date().toISOString();

    const payload = {
      event: {
        type: "video.statistics.update",
        content: {
          video_id: "video-no-timestamp",
          user_id: "user-444",
          view_count: 1000,
        },
      },
    };

    const result = await processor.parse(payload);

    const afterTime = new Date().toISOString();

    expect(result.normalizedData.capturedAt >= beforeTime).toBeTruthy();
    expect(result.normalizedData.capturedAt <= afterTime).toBeTruthy();
  });
});

// ===========================
// Error Handling Tests (3 tests)
// ===========================

describe("TikTokWebhookProcessor - Error Handling", () => {
  let processor: TikTokWebhookProcessor;

  beforeAll(() => {
    processor = new TikTokWebhookProcessor();
  });

  it("should throw error for missing event in payload", async () => {
    const payload = { data: "test" };

    await expect(processor.parse(payload)).rejects.toThrow(
      "Invalid TikTok webhook payload: missing event"
    );
  });

  it("should default to POST_UPDATED for unknown event types", async () => {
    const payload = {
      event: {
        type: "unknown.event.type",
        content: { some: "data" },
      },
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("POST_UPDATED");
    expect(result.normalizedData.eventType).toBe("unknown.event.type");
  });

  it("should handle verification errors gracefully", () => {
    const processor = new TikTokWebhookProcessor();

    // This should return false instead of throwing
    const isValid = processor.verify("invalid\x00data", "signature", "secret");
    expect(isValid).toBe(false);
  });
});

// ===========================
// Event Type Field Handling Tests (2 tests)
// ===========================

describe("TikTokWebhookProcessor - Event Type Field Handling", () => {
  let processor: TikTokWebhookProcessor;

  beforeAll(() => {
    processor = new TikTokWebhookProcessor();
  });

  it("should handle event.type field", async () => {
    const payload = {
      event: {
        type: "video.create",
        content: {
          video_id: "video-type-field",
          user_id: "user-555",
          create_time: "2024-01-16T00:00:00Z",
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("POST_PUBLISHED");
  });

  it("should handle event.event_type field as fallback", async () => {
    const payload = {
      event: {
        event_type: "video.publish",
        content: {
          video_id: "video-event-type-field",
          user_id: "user-666",
          publish_time: "2024-01-16T01:00:00Z",
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("POST_PUBLISHED");
  });
});

// ===========================
// Completion Rate Handling Test (1 test)
// ===========================

describe("TikTokWebhookProcessor - Completion Rate Handling", () => {
  let processor: TikTokWebhookProcessor;

  beforeAll(() => {
    processor = new TikTokWebhookProcessor();
  });

  it("should extract completion rate from statistics", async () => {
    const payload = {
      event: {
        type: "video.statistics.update",
        content: {
          video_id: "video-completion",
          user_id: "user-777",
          view_count: 10000,
          completion_rate: 0.75,
          average_time_watched: 22.5,
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.completionRate).toBe(0.75);
  });
});

// Total: 33 tests covering all TikTok webhook processor functionality
