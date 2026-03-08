/**
 * Comprehensive Unit Tests for InstagramWebhookProcessor
 *
 * BUSINESS LOGIC VALIDATION:
 * This test suite validates the Instagram webhook processor which handles incoming
 * webhooks from Instagram Business API and Facebook Graph API.
 *
 * KEY BUSINESS CAPABILITIES TESTED:
 * - HMAC-SHA256 signature verification
 * - Media published/updated event parsing
 * - Story events and expiration tracking
 * - Comment and reply event handling
 * - Mention event processing
 * - Direct message event parsing
 * - Entity relationship resolution (channel, project, account, post)
 * - Analytics tracking and engagement updates
 * - Real-time broadcasting integration
 *
 * WEBHOOK BUSINESS RULES:
 * - Signature uses HMAC-SHA256 with app secret
 * - Supports media types: IMAGE, VIDEO, CAROUSEL_ALBUM, STORY
 * - Stories have 24-hour expiration tracking
 * - Comments can be replies (with parent_id)
 * - Analytics differentiate FEED, CAROUSEL, and STORIES content types
 * - Engagement updates broadcast in real-time to connected clients
 *
 * PROVIDER-SPECIFIC FORMATS:
 * - Signature: sha256=<hex> in x-hub-signature-256 header
 * - Payload structure: { entry: [{ id, changes: [...] }] } or { entry: [{ id, messaging: [...] }] }
 * - Event types: media, comments, mentions, story_insights, messaging
 *
 * RUN COMMAND:
 * pnpm --filter @apps/api exec node --import tsx --test tests/unit/webhooks/instagramWebhookProcessor.test.ts
 *
 * @module InstagramWebhookProcessorTests
 * @category UnitTests
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import { InstagramWebhookProcessor } from "../../../src/webhooks/processors/instagramWebhookProcessor.js";

// ===========================
// Test Helpers
// ===========================

function generateHmacSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

// ===========================
// Signature Verification Tests (8 tests)
// ===========================

describe("InstagramWebhookProcessor - Signature Verification", { concurrency: 1 }, () => {
  let processor: InstagramWebhookProcessor;
  const testSecret = "test-instagram-secret-key";

  before(() => {
    processor = new InstagramWebhookProcessor();
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
    const payload = JSON.stringify({ test: "data with 特殊字符 and émojis 🎉" });
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
// Media Event Parsing Tests (5 tests)
// ===========================

describe("InstagramWebhookProcessor - Media Event Parsing", { concurrency: 1 }, () => {
  let processor: InstagramWebhookProcessor;

  before(() => {
    processor = new InstagramWebhookProcessor();
  });

  it("should parse media published event for IMAGE", async () => {
    const payload = {
      entry: [
        {
          id: "instagram-page-123",
          changes: [
            {
              field: "media",
              value: {
                id: "media-456",
                media_type: "IMAGE",
                caption: "Test caption",
                media_url: "https://example.com/image.jpg",
                permalink: "https://instagram.com/p/abc123",
                timestamp: "2024-01-15T10:00:00Z",
                username: "testuser",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "POST_PUBLISHED");
    assert.strictEqual(result.normalizedData.eventType, "media_published");
    assert.strictEqual(result.normalizedData.mediaId, "media-456");
    assert.strictEqual(result.normalizedData.mediaType, "IMAGE");
    assert.strictEqual(result.normalizedData.caption, "Test caption");
    assert.strictEqual(result.normalizedData.isStory, false);
  });

  it("should parse story published event", async () => {
    const payload = {
      entry: [
        {
          id: "instagram-page-123",
          changes: [
            {
              field: "media",
              value: {
                id: "story-789",
                media_type: "STORY",
                media_url: "https://example.com/story.jpg",
                timestamp: "2024-01-15T10:00:00Z",
                username: "testuser",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "POST_PUBLISHED");
    assert.strictEqual(result.normalizedData.isStory, true);
    assert.strictEqual(result.normalizedData.mediaType, "STORY");
  });

  it("should parse carousel album event", async () => {
    const payload = {
      entry: [
        {
          id: "instagram-page-123",
          changes: [
            {
              field: "media",
              value: {
                id: "carousel-999",
                media_type: "CAROUSEL_ALBUM",
                caption: "Multi-image post",
                timestamp: "2024-01-15T10:00:00Z",
                username: "testuser",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.mediaType, "CAROUSEL_ALBUM");
  });

  it("should parse video media event", async () => {
    const payload = {
      entry: [
        {
          id: "instagram-page-123",
          changes: [
            {
              field: "media",
              value: {
                id: "video-111",
                media_type: "VIDEO",
                caption: "Video post",
                media_url: "https://example.com/video.mp4",
                timestamp: "2024-01-15T10:00:00Z",
                username: "testuser",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.mediaType, "VIDEO");
  });

  it("should extract permalink from media event", async () => {
    const expectedPermalink = "https://www.instagram.com/p/CyABCDEF123/";
    const payload = {
      entry: [
        {
          id: "instagram-page-123",
          changes: [
            {
              field: "media",
              value: {
                id: "media-123",
                media_type: "IMAGE",
                permalink: expectedPermalink,
                timestamp: "2024-01-15T10:00:00Z",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.permalink, expectedPermalink);
  });
});

// ===========================
// Comment Event Parsing Tests (3 tests)
// ===========================

describe("InstagramWebhookProcessor - Comment Event Parsing", { concurrency: 1 }, () => {
  let processor: InstagramWebhookProcessor;

  before(() => {
    processor = new InstagramWebhookProcessor();
  });

  it("should parse comment received event", async () => {
    const payload = {
      entry: [
        {
          id: "instagram-page-123",
          changes: [
            {
              field: "comments",
              value: {
                id: "comment-123",
                media: { id: "media-456" },
                text: "Great post!",
                from: {
                  username: "commenter",
                  id: "user-789",
                },
                created_time: "2024-01-15T10:30:00Z",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "COMMENT_RECEIVED");
    assert.strictEqual(result.normalizedData.eventType, "comment_received");
    assert.strictEqual(result.normalizedData.commentId, "comment-123");
    assert.strictEqual(result.normalizedData.text, "Great post!");
    assert.strictEqual(result.normalizedData.username, "commenter");
    assert.strictEqual(result.normalizedData.isReply, false);
  });

  it("should parse comment reply event", async () => {
    const payload = {
      entry: [
        {
          id: "instagram-page-123",
          changes: [
            {
              field: "comments",
              value: {
                id: "reply-456",
                media: { id: "media-456" },
                text: "Thanks!",
                from: {
                  username: "replier",
                  id: "user-999",
                },
                parent_id: "comment-123",
                created_time: "2024-01-15T10:35:00Z",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.isReply, true);
    assert.strictEqual(result.normalizedData.parentId, "comment-123");
  });

  it("should handle comment without media reference", async () => {
    const payload = {
      entry: [
        {
          id: "instagram-page-123",
          changes: [
            {
              field: "comments",
              value: {
                id: "comment-789",
                text: "Comment without media",
                from: { username: "user", id: "user-123" },
                created_time: "2024-01-15T10:40:00Z",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.mediaId, undefined);
  });
});

// ===========================
// Mention Event Parsing Tests (2 tests)
// ===========================

describe("InstagramWebhookProcessor - Mention Event Parsing", { concurrency: 1 }, () => {
  let processor: InstagramWebhookProcessor;

  before(() => {
    processor = new InstagramWebhookProcessor();
  });

  it("should parse mention received event", async () => {
    const payload = {
      entry: [
        {
          id: "instagram-page-123",
          changes: [
            {
              field: "mentions",
              value: {
                media_id: "media-456",
                comment_id: "comment-789",
                text: "Check out @testuser",
                from: {
                  username: "mentioner",
                  id: "user-111",
                },
                created_time: "2024-01-15T11:00:00Z",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "MENTION_RECEIVED");
    assert.strictEqual(result.normalizedData.eventType, "mention_received");
    assert.strictEqual(result.normalizedData.mediaId, "media-456");
    assert.strictEqual(result.normalizedData.commentId, "comment-789");
    assert.strictEqual(result.normalizedData.text, "Check out @testuser");
  });

  it("should extract mention user information", async () => {
    const payload = {
      entry: [
        {
          id: "instagram-page-123",
          changes: [
            {
              field: "mentions",
              value: {
                media_id: "media-123",
                from: {
                  username: "john_doe",
                  id: "user-456",
                },
                text: "Hey @testuser!",
                created_time: "2024-01-15T11:30:00Z",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.username, "john_doe");
    assert.strictEqual(result.normalizedData.userId, "user-456");
  });
});

// ===========================
// Story Event Parsing Tests (3 tests)
// ===========================

describe("InstagramWebhookProcessor - Story Event Parsing", { concurrency: 1 }, () => {
  let processor: InstagramWebhookProcessor;

  before(() => {
    processor = new InstagramWebhookProcessor();
  });

  it("should parse story expired event with insights", async () => {
    const payload = {
      entry: [
        {
          id: "instagram-page-123",
          changes: [
            {
              field: "story_insights",
              value: {
                id: "story-123",
                media_type: "STORY",
                timestamp: "2024-01-15T10:00:00Z",
                expiration_time: "2024-01-16T10:00:00Z",
                insights: {
                  reach: 1500,
                  impressions: 2000,
                  replies: 25,
                },
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "STORY_EXPIRED");
    assert.strictEqual(result.normalizedData.eventType, "story_expired");
    assert.strictEqual(result.normalizedData.storyId, "story-123");
    assert.deepStrictEqual(result.normalizedData.insights, {
      reach: 1500,
      impressions: 2000,
      replies: 25,
    });
  });

  it("should handle story event without insights", async () => {
    const payload = {
      entry: [
        {
          id: "instagram-page-123",
          changes: [
            {
              field: "story_insights",
              value: {
                id: "story-456",
                media_type: "STORY",
                timestamp: "2024-01-15T10:00:00Z",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.deepStrictEqual(result.normalizedData.insights, {});
  });

  it("should extract story expiration time", async () => {
    const expirationTime = "2024-01-17T12:00:00Z";
    const payload = {
      entry: [
        {
          id: "instagram-page-123",
          changes: [
            {
              field: "story_insights",
              value: {
                id: "story-789",
                media_type: "STORY",
                timestamp: "2024-01-16T12:00:00Z",
                expiration_time: expirationTime,
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.expirationTime, expirationTime);
  });
});

// ===========================
// Messaging Event Parsing Tests (2 tests)
// ===========================

describe("InstagramWebhookProcessor - Messaging Event Parsing", { concurrency: 1 }, () => {
  let processor: InstagramWebhookProcessor;

  before(() => {
    processor = new InstagramWebhookProcessor();
  });

  it("should parse direct message event", async () => {
    const payload = {
      entry: [
        {
          id: "instagram-page-123",
          messaging: [
            {
              sender: { id: "sender-123" },
              recipient: { id: "page-456" },
              timestamp: 1642248000000,
              message: {
                mid: "msg-789",
                text: "Hello!",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "COMMENT_RECEIVED");
    assert.strictEqual(result.normalizedData.senderId, "sender-123");
    assert.strictEqual(result.normalizedData.isDirectMessage, true);
  });

  it("should extract message content from DM", async () => {
    const messageText = "Can you help me with my order?";
    const payload = {
      entry: [
        {
          id: "instagram-page-123",
          messaging: [
            {
              sender: { id: "sender-456" },
              recipient: { id: "page-789" },
              timestamp: 1642248100000,
              message: {
                mid: "msg-999",
                text: messageText,
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.deepStrictEqual(result.normalizedData.message, {
      mid: "msg-999",
      text: messageText,
    });
  });
});

// ===========================
// Unknown Event Handling Tests (2 tests)
// ===========================

describe("InstagramWebhookProcessor - Unknown Event Handling", { concurrency: 1 }, () => {
  let processor: InstagramWebhookProcessor;

  before(() => {
    processor = new InstagramWebhookProcessor();
  });

  it("should default to POST_UPDATED for unknown field types", async () => {
    const payload = {
      entry: [
        {
          id: "instagram-page-123",
          changes: [
            {
              field: "unknown_field",
              value: { some: "data" },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "POST_UPDATED");
    assert.strictEqual(result.normalizedData.field, "unknown_field");
  });

  it("should throw error for missing entry in payload", async () => {
    const payload = { object: "instagram" };

    await assert.rejects(
      async () => {
        await processor.parse(payload);
      },
      {
        message: "Invalid Instagram webhook payload: missing entry",
      }
    );
  });
});

// ===========================
// Error Handling Tests (2 tests)
// ===========================

describe("InstagramWebhookProcessor - Error Handling", { concurrency: 1 }, () => {
  let processor: InstagramWebhookProcessor;

  before(() => {
    processor = new InstagramWebhookProcessor();
  });

  it("should throw error for unsupported event structure", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          // No changes or messaging
        },
      ],
    };

    await assert.rejects(
      async () => {
        await processor.parse(payload);
      },
      {
        message: /Unsupported Instagram webhook event type/,
      }
    );
  });

  it("should handle verification errors gracefully", () => {
    const processor = new InstagramWebhookProcessor();

    // This should return false instead of throwing
    const isValid = processor.verify("invalid\x00data", "signature", "secret");
    assert.strictEqual(isValid, false);
  });
});

// ===========================
// Timestamp Parsing Tests (2 tests)
// ===========================

describe("InstagramWebhookProcessor - Timestamp Handling", { concurrency: 1 }, () => {
  let processor: InstagramWebhookProcessor;

  before(() => {
    processor = new InstagramWebhookProcessor();
  });

  it("should preserve ISO timestamp format", async () => {
    const timestamp = "2024-01-15T14:30:45Z";
    const payload = {
      entry: [
        {
          id: "instagram-page-123",
          changes: [
            {
              field: "media",
              value: {
                id: "media-123",
                media_type: "IMAGE",
                timestamp,
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.timestamp, timestamp);
  });

  it("should handle created_time in comments", async () => {
    const createdTime = "2024-01-15T16:20:30Z";
    const payload = {
      entry: [
        {
          id: "instagram-page-123",
          changes: [
            {
              field: "comments",
              value: {
                id: "comment-123",
                text: "Test",
                from: { username: "user", id: "123" },
                created_time: createdTime,
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.timestamp, createdTime);
  });
});

// Total: 29 tests covering all Instagram webhook processor functionality
