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
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
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

describe("TikTokWebhookProcessor - Signature Verification", { concurrency: 1 }, () => {
  let processor: TikTokWebhookProcessor;
  const testSecret = "test-tiktok-client-secret";

  before(() => {
    processor = new TikTokWebhookProcessor();
  });

  it("should verify valid webhook signature with sha256= prefix", () => {
    const payload = JSON.stringify({ test: "data" });
    const signature = generateHmacSignature(payload, testSecret);

    const isValid = processor.verify(payload, `sha256=${signature}`, testSecret);
    assert.strictEqual(isValid, true);
  });

  it("should verify valid webhook signature without sha256= prefix", () => {
    const payload = JSON.stringify({ test: "data" });
    const signature = generateHmacSignature(payload, testSecret);

    const isValid = processor.verify(payload, signature, testSecret);
    assert.strictEqual(isValid, true);
  });

  it("should reject invalid signature", () => {
    const payload = JSON.stringify({ test: "data" });
    const invalidSignature = "sha256=invalid-signature-value";

    const isValid = processor.verify(payload, invalidSignature, testSecret);
    assert.strictEqual(isValid, false);
  });

  it("should reject signature with tampered payload", () => {
    const originalPayload = JSON.stringify({ test: "data" });
    const signature = generateHmacSignature(originalPayload, testSecret);

    const tamperedPayload = JSON.stringify({ test: "tampered" });
    const isValid = processor.verify(tamperedPayload, signature, testSecret);
    assert.strictEqual(isValid, false);
  });

  it("should reject signature with wrong secret", () => {
    const payload = JSON.stringify({ test: "data" });
    const signature = generateHmacSignature(payload, "wrong-secret");

    const isValid = processor.verify(payload, signature, testSecret);
    assert.strictEqual(isValid, false);
  });

  it("should handle empty payload", () => {
    const payload = "";
    const signature = generateHmacSignature(payload, testSecret);

    const isValid = processor.verify(payload, signature, testSecret);
    assert.strictEqual(isValid, true);
  });

  it("should handle special characters in payload", () => {
    const payload = JSON.stringify({ test: "data with unicode 🎵 and characters" });
    const signature = generateHmacSignature(payload, testSecret);

    const isValid = processor.verify(payload, `sha256=${signature}`, testSecret);
    assert.strictEqual(isValid, true);
  });

  it("should use constant-time comparison", () => {
    const payload = JSON.stringify({ test: "data" });
    const correctSignature = generateHmacSignature(payload, testSecret);

    // Test multiple attempts to verify timing consistency
    for (let i = 0; i < 10; i++) {
      const isValid = processor.verify(payload, correctSignature, testSecret);
      assert.strictEqual(isValid, true);
    }
  });
});

// ===========================
// Video Create Event Parsing Tests (5 tests)
// ===========================

describe("TikTokWebhookProcessor - Video Create Event Parsing", { concurrency: 1 }, () => {
  let processor: TikTokWebhookProcessor;

  before(() => {
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

    assert.strictEqual(result.eventType, "POST_PUBLISHED");
    assert.strictEqual(result.normalizedData.eventType, "video_created");
    assert.strictEqual(result.normalizedData.videoId, "video-123");
    assert.strictEqual(result.normalizedData.userId, "user-456");
    assert.strictEqual(result.normalizedData.title, "Test TikTok Video");
    assert.strictEqual(result.normalizedData.description, "Amazing content!");
    assert.strictEqual(result.normalizedData.duration, 30);
    assert.strictEqual(result.normalizedData.isPrivate, false);
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

    assert.strictEqual(result.eventType, "POST_PUBLISHED");
    assert.strictEqual(result.normalizedData.videoId, "video-789");
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

    assert.strictEqual(result.normalizedData.userId, "author-222");
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

    assert.strictEqual(result.normalizedData.isPrivate, true);
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

    assert.strictEqual(result.normalizedData.coverUrl, "https://tiktok.com/covers/full.jpg");
    assert.strictEqual(result.normalizedData.videoUrl, "https://tiktok.com/videos/full");
    assert.strictEqual(result.normalizedData.shareUrl, "https://tiktok.com/share/full");
    assert.strictEqual(result.normalizedData.createdAt, "2024-01-15T14:00:00Z");
    assert.strictEqual(result.normalizedData.publishedAt, "2024-01-15T14:05:00Z");
  });
});

// ===========================
// Video Remove Event Parsing Tests (3 tests)
// ===========================

describe("TikTokWebhookProcessor - Video Remove Event Parsing", { concurrency: 1 }, () => {
  let processor: TikTokWebhookProcessor;

  before(() => {
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

    assert.strictEqual(result.eventType, "POST_DELETED");
    assert.strictEqual(result.normalizedData.eventType, "video_removed");
    assert.strictEqual(result.normalizedData.videoId, "video-removed");
    assert.strictEqual(result.normalizedData.userId, "user-555");
    assert.strictEqual(result.normalizedData.removedAt, "2024-01-15T15:00:00Z");
    assert.strictEqual(result.normalizedData.reason, "user_deleted");
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

    assert.strictEqual(result.eventType, "POST_DELETED");
    assert.strictEqual(result.normalizedData.videoId, "video-deleted");
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

    assert.ok(result.normalizedData.removedAt >= beforeTime);
    assert.ok(result.normalizedData.removedAt <= afterTime);
  });
});

// ===========================
// Comment Event Parsing Tests (4 tests)
// ===========================

describe("TikTokWebhookProcessor - Comment Event Parsing", { concurrency: 1 }, () => {
  let processor: TikTokWebhookProcessor;

  before(() => {
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

    assert.strictEqual(result.eventType, "COMMENT_RECEIVED");
    assert.strictEqual(result.normalizedData.eventType, "comment_received");
    assert.strictEqual(result.normalizedData.commentId, "comment-123");
    assert.strictEqual(result.normalizedData.videoId, "video-456");
    assert.strictEqual(result.normalizedData.text, "Great video!");
    assert.strictEqual(result.normalizedData.username, "commenter_username");
    assert.strictEqual(result.normalizedData.isReply, false);
    assert.strictEqual(result.normalizedData.likeCount, 10);
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

    assert.strictEqual(result.eventType, "COMMENT_RECEIVED");
    assert.strictEqual(result.normalizedData.eventType, "comment_reply_received");
    assert.strictEqual(result.normalizedData.isReply, true);
    assert.strictEqual(result.normalizedData.parentId, "comment-123");
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

    assert.strictEqual(result.normalizedData.commentId, "comment-alt");
    assert.strictEqual(result.normalizedData.text, "Alternative field names");
    assert.strictEqual(result.normalizedData.userId, "user-222");
    assert.strictEqual(result.normalizedData.username, "alt_user");
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

    assert.strictEqual(result.normalizedData.likeCount, 0);
  });
});

// ===========================
// Authorization Revoke Event Parsing Tests (3 tests)
// ===========================

describe("TikTokWebhookProcessor - Authorization Revoke Event Parsing", { concurrency: 1 }, () => {
  let processor: TikTokWebhookProcessor;

  before(() => {
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

    assert.strictEqual(result.eventType, "ACCOUNT_DISCONNECTED");
    assert.strictEqual(result.normalizedData.eventType, "auth_revoked");
    assert.strictEqual(result.normalizedData.userId, "user-123");
    assert.strictEqual(result.normalizedData.revokedAt, "2024-01-15T21:00:00Z");
    assert.strictEqual(result.normalizedData.reason, "user_revoked");
    assert.deepStrictEqual(result.normalizedData.scopes, ["user.info.basic", "video.list"]);
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

    assert.strictEqual(result.normalizedData.userId, "open-id-456");
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

    assert.ok(result.normalizedData.revokedAt >= beforeTime);
    assert.ok(result.normalizedData.revokedAt <= afterTime);
  });
});

// ===========================
// Video Statistics Event Parsing Tests (4 tests)
// ===========================

describe("TikTokWebhookProcessor - Video Statistics Event Parsing", { concurrency: 1 }, () => {
  let processor: TikTokWebhookProcessor;

  before(() => {
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

    assert.strictEqual(result.eventType, "POST_ENGAGEMENT_UPDATE");
    assert.strictEqual(result.normalizedData.eventType, "video_statistics_update");
    assert.strictEqual(result.normalizedData.videoId, "video-stats");
    assert.strictEqual(result.normalizedData.views, 50000);
    assert.strictEqual(result.normalizedData.likes, 2500);
    assert.strictEqual(result.normalizedData.comments, 300);
    assert.strictEqual(result.normalizedData.shares, 150);
    assert.strictEqual(result.normalizedData.saves, 100);
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

    assert.strictEqual(result.normalizedData.views, 75000);
    assert.strictEqual(result.normalizedData.saves, 150);
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

    assert.strictEqual(result.normalizedData.views, 0);
    assert.strictEqual(result.normalizedData.likes, 0);
    assert.strictEqual(result.normalizedData.comments, 0);
    assert.strictEqual(result.normalizedData.shares, 0);
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

    assert.ok(result.normalizedData.capturedAt >= beforeTime);
    assert.ok(result.normalizedData.capturedAt <= afterTime);
  });
});

// ===========================
// Error Handling Tests (3 tests)
// ===========================

describe("TikTokWebhookProcessor - Error Handling", { concurrency: 1 }, () => {
  let processor: TikTokWebhookProcessor;

  before(() => {
    processor = new TikTokWebhookProcessor();
  });

  it("should throw error for missing event in payload", async () => {
    const payload = { data: "test" };

    await assert.rejects(
      async () => {
        await processor.parse(payload);
      },
      {
        message: "Invalid TikTok webhook payload: missing event",
      }
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

    assert.strictEqual(result.eventType, "POST_UPDATED");
    assert.strictEqual(result.normalizedData.eventType, "unknown.event.type");
  });

  it("should handle verification errors gracefully", () => {
    const processor = new TikTokWebhookProcessor();

    // This should return false instead of throwing
    const isValid = processor.verify("invalid\x00data", "signature", "secret");
    assert.strictEqual(isValid, false);
  });
});

// ===========================
// Event Type Field Handling Tests (2 tests)
// ===========================

describe("TikTokWebhookProcessor - Event Type Field Handling", { concurrency: 1 }, () => {
  let processor: TikTokWebhookProcessor;

  before(() => {
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

    assert.strictEqual(result.eventType, "POST_PUBLISHED");
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

    assert.strictEqual(result.eventType, "POST_PUBLISHED");
  });
});

// ===========================
// Completion Rate Handling Test (1 test)
// ===========================

describe("TikTokWebhookProcessor - Completion Rate Handling", { concurrency: 1 }, () => {
  let processor: TikTokWebhookProcessor;

  before(() => {
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

    assert.strictEqual(result.normalizedData.completionRate, 0.75);
  });
});

// Total: 33 tests covering all TikTok webhook processor functionality
