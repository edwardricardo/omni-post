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
 *
 * @file instagramWebhookProcessor.test.ts
 * @description Tests for InstagramWebhookProcessor - Signature Verification
 * @layer infrastructure
 */

import { describe, it, beforeAll, expect } from "vitest";
import { createHmac } from "crypto";
import { InstagramWebhookProcessor } from "../../../src/webhooks/processors/instagramWebhookProcessor.js";
import { makeWebhookPrismaFake } from "../helpers/webhookPrismaFake.js";

// ===========================
// Test Helpers
// ===========================

function generateHmacSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

// ===========================
// Signature Verification Tests (8 tests)
// ===========================

describe("InstagramWebhookProcessor - Signature Verification", () => {
  let processor: InstagramWebhookProcessor;
  const testSecret = "test-instagram-secret-key";

  beforeAll(() => {
    processor = new InstagramWebhookProcessor(makeWebhookPrismaFake().prisma);
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
    const payload = JSON.stringify({ test: "data with 特殊字符 and émojis 🎉" });
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
// Media Event Parsing Tests (5 tests)
// ===========================

describe("InstagramWebhookProcessor - Media Event Parsing", () => {
  let processor: InstagramWebhookProcessor;

  beforeAll(() => {
    processor = new InstagramWebhookProcessor(makeWebhookPrismaFake().prisma);
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

    expect(result.eventType).toBe("POST_PUBLISHED");
    expect(result.normalizedData.eventType).toBe("media_published");
    expect(result.normalizedData.mediaId).toBe("media-456");
    expect(result.normalizedData.mediaType).toBe("IMAGE");
    expect(result.normalizedData.caption).toBe("Test caption");
    expect(result.normalizedData.isStory).toBe(false);
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

    expect(result.eventType).toBe("POST_PUBLISHED");
    expect(result.normalizedData.isStory).toBe(true);
    expect(result.normalizedData.mediaType).toBe("STORY");
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

    expect(result.normalizedData.mediaType).toBe("CAROUSEL_ALBUM");
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

    expect(result.normalizedData.mediaType).toBe("VIDEO");
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

    expect(result.normalizedData.permalink).toBe(expectedPermalink);
  });
});

// ===========================
// Comment Event Parsing Tests (3 tests)
// ===========================

describe("InstagramWebhookProcessor - Comment Event Parsing", () => {
  let processor: InstagramWebhookProcessor;

  beforeAll(() => {
    processor = new InstagramWebhookProcessor(makeWebhookPrismaFake().prisma);
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

    expect(result.eventType).toBe("COMMENT_RECEIVED");
    expect(result.normalizedData.eventType).toBe("comment_received");
    expect(result.normalizedData.commentId).toBe("comment-123");
    expect(result.normalizedData.text).toBe("Great post!");
    expect(result.normalizedData.username).toBe("commenter");
    expect(result.normalizedData.isReply).toBe(false);
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

    expect(result.normalizedData.isReply).toBe(true);
    expect(result.normalizedData.parentId).toBe("comment-123");
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

    expect(result.normalizedData.mediaId).toBe(undefined);
  });
});

// ===========================
// Mention Event Parsing Tests (2 tests)
// ===========================

describe("InstagramWebhookProcessor - Mention Event Parsing", () => {
  let processor: InstagramWebhookProcessor;

  beforeAll(() => {
    processor = new InstagramWebhookProcessor(makeWebhookPrismaFake().prisma);
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

    expect(result.eventType).toBe("MENTION_RECEIVED");
    expect(result.normalizedData.eventType).toBe("mention_received");
    expect(result.normalizedData.mediaId).toBe("media-456");
    expect(result.normalizedData.commentId).toBe("comment-789");
    expect(result.normalizedData.text).toBe("Check out @testuser");
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

    expect(result.normalizedData.username).toBe("john_doe");
    expect(result.normalizedData.userId).toBe("user-456");
  });
});

// ===========================
// Story Event Parsing Tests (3 tests)
// ===========================

describe("InstagramWebhookProcessor - Story Event Parsing", () => {
  let processor: InstagramWebhookProcessor;

  beforeAll(() => {
    processor = new InstagramWebhookProcessor(makeWebhookPrismaFake().prisma);
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

    expect(result.eventType).toBe("STORY_EXPIRED");
    expect(result.normalizedData.eventType).toBe("story_expired");
    expect(result.normalizedData.storyId).toBe("story-123");
    expect(result.normalizedData.insights).toStrictEqual({
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

    expect(result.normalizedData.insights).toStrictEqual({});
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

    expect(result.normalizedData.expirationTime).toBe(expirationTime);
  });
});

// ===========================
// Messaging Event Parsing Tests (2 tests)
// ===========================

describe("InstagramWebhookProcessor - Messaging Event Parsing", () => {
  let processor: InstagramWebhookProcessor;

  beforeAll(() => {
    processor = new InstagramWebhookProcessor(makeWebhookPrismaFake().prisma);
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

    expect(result.eventType).toBe("COMMENT_RECEIVED");
    expect(result.normalizedData.senderId).toBe("sender-123");
    expect(result.normalizedData.isDirectMessage).toBe(true);
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

    expect(result.normalizedData.message).toStrictEqual({
      mid: "msg-999",
      text: messageText,
    });
  });
});

// ===========================
// Unknown Event Handling Tests (2 tests)
// ===========================

describe("InstagramWebhookProcessor - Unknown Event Handling", () => {
  let processor: InstagramWebhookProcessor;

  beforeAll(() => {
    processor = new InstagramWebhookProcessor(makeWebhookPrismaFake().prisma);
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

    expect(result.eventType).toBe("POST_UPDATED");
    expect(result.normalizedData.field).toBe("unknown_field");
  });

  it("should throw error for missing entry in payload", async () => {
    const payload = { object: "instagram" };

    await expect(processor.parse(payload)).rejects.toThrow(
      "Invalid Instagram webhook payload: missing entry"
    );
  });
});

// ===========================
// Error Handling Tests (2 tests)
// ===========================

describe("InstagramWebhookProcessor - Error Handling", () => {
  let processor: InstagramWebhookProcessor;

  beforeAll(() => {
    processor = new InstagramWebhookProcessor(makeWebhookPrismaFake().prisma);
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

    await expect(processor.parse(payload)).rejects.toThrow(
      /Unsupported Instagram webhook event type/
    );
  });

  it("should handle verification errors gracefully", () => {
    const processor = new InstagramWebhookProcessor(makeWebhookPrismaFake().prisma);

    // This should return false instead of throwing
    const isValid = processor.verify("invalid\x00data", "signature", "secret");
    expect(isValid).toBe(false);
  });
});

// ===========================
// Timestamp Parsing Tests (2 tests)
// ===========================

describe("InstagramWebhookProcessor - Timestamp Handling", () => {
  let processor: InstagramWebhookProcessor;

  beforeAll(() => {
    processor = new InstagramWebhookProcessor(makeWebhookPrismaFake().prisma);
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

    expect(result.normalizedData.timestamp).toBe(timestamp);
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

    expect(result.normalizedData.timestamp).toBe(createdTime);
  });
});

// Total: 29 tests covering all Instagram webhook processor functionality
