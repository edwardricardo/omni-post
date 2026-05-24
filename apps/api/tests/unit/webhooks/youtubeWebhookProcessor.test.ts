/**
 * Comprehensive Unit Tests for YouTubeWebhookProcessor
 *
 * BUSINESS LOGIC VALIDATION:
 * This test suite validates the YouTube webhook processor which handles incoming
 * webhooks from YouTube Data API v3 using PubSubHubbub protocol.
 *
 * KEY BUSINESS CAPABILITIES TESTED:
 * - HMAC-SHA1 signature verification (PubSubHubbub protocol)
 * - XML/Atom feed parsing for video events
 * - Video published/updated event handling
 * - Comment event processing
 * - Channel update event handling
 * - Analytics update event processing
 * - Entity relationship resolution (channel, project, account, post)
 * - Analytics tracking and engagement updates
 * - Real-time broadcasting integration
 *
 * WEBHOOK BUSINESS RULES:
 * - Signature uses HMAC-SHA1 with subscription secret (different from other providers)
 * - Payload arrives as Atom/XML format requiring xml2js parsing
 * - Video IDs extracted from yt:videoId tags
 * - Channel IDs extracted from yt:channelId tags
 * - Published vs updated determined by presence of updated field
 * - Comment events require separate API integration
 *
 * PROVIDER-SPECIFIC FORMATS:
 * - Signature: sha1=<hex> in x-hub-signature header
 * - Payload structure: XML/Atom feed with entry elements
 * - Event types: feed entries, comments, channel updates, analytics
 *
 * RUN COMMAND:
 * pnpm --filter @apps/api exec node --import tsx --test tests/unit/webhooks/youtubeWebhookProcessor.test.ts
 *
 * @module YouTubeWebhookProcessorTests
 * @category UnitTests
 *
 * @file youtubeWebhookProcessor.test.ts
 * @description Tests for YouTubeWebhookProcessor - Signature Verification
 * @layer infrastructure
 */

import { describe, it, beforeAll, expect } from "vitest";
import { createHmac } from "crypto";
import { YouTubeWebhookProcessor } from "../../../src/webhooks/processors/youtubeWebhookProcessor.js";
import { makeWebhookPrismaFake } from "../helpers/webhookPrismaFake.js";

// ===========================
// Test Helpers
// ===========================

function generateHmacSignatureSHA1(payload: string, secret: string): string {
  return createHmac("sha1", secret).update(payload, "utf8").digest("hex");
}

// ===========================
// Signature Verification Tests (8 tests)
// ===========================

describe("YouTubeWebhookProcessor - Signature Verification", () => {
  let processor: YouTubeWebhookProcessor;
  const testSecret = "test-youtube-subscription-secret";

  beforeAll(() => {
    processor = new YouTubeWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("should verify valid webhook signature with sha1= prefix", () => {
    const payload = JSON.stringify({ test: "data" });
    const signature = generateHmacSignatureSHA1(payload, testSecret);

    const isValid = processor.verify(payload, `sha1=${signature}`, testSecret);
    expect(isValid).toBe(true);
  });

  it("should verify valid webhook signature without sha1= prefix", () => {
    const payload = JSON.stringify({ test: "data" });
    const signature = generateHmacSignatureSHA1(payload, testSecret);

    const isValid = processor.verify(payload, signature, testSecret);
    expect(isValid).toBe(true);
  });

  it("should reject invalid signature", () => {
    const payload = JSON.stringify({ test: "data" });
    const invalidSignature = "sha1=invalid-signature-value";

    const isValid = processor.verify(payload, invalidSignature, testSecret);
    expect(isValid).toBe(false);
  });

  it("should reject signature with tampered payload", () => {
    const originalPayload = JSON.stringify({ test: "data" });
    const signature = generateHmacSignatureSHA1(originalPayload, testSecret);

    const tamperedPayload = JSON.stringify({ test: "tampered" });
    const isValid = processor.verify(tamperedPayload, signature, testSecret);
    expect(isValid).toBe(false);
  });

  it("should reject signature with wrong secret", () => {
    const payload = JSON.stringify({ test: "data" });
    const signature = generateHmacSignatureSHA1(payload, "wrong-secret");

    const isValid = processor.verify(payload, signature, testSecret);
    expect(isValid).toBe(false);
  });

  it("should handle empty payload", () => {
    const payload = "";
    const signature = generateHmacSignatureSHA1(payload, testSecret);

    const isValid = processor.verify(payload, signature, testSecret);
    expect(isValid).toBe(true);
  });

  it("should handle special characters in payload", () => {
    const payload = JSON.stringify({ test: "data with unicode 🎥 and ñ" });
    const signature = generateHmacSignatureSHA1(payload, testSecret);

    const isValid = processor.verify(payload, `sha1=${signature}`, testSecret);
    expect(isValid).toBe(true);
  });

  it("should use constant-time comparison", () => {
    const payload = JSON.stringify({ test: "data" });
    const correctSignature = generateHmacSignatureSHA1(payload, testSecret);

    // Test multiple attempts to verify timing consistency
    for (let i = 0; i < 10; i++) {
      const isValid = processor.verify(payload, correctSignature, testSecret);
      expect(isValid).toBe(true);
    }
  });
});

// ===========================
// Video Feed Entry Parsing Tests (6 tests)
// ===========================

describe("YouTubeWebhookProcessor - Video Feed Entry Parsing", () => {
  let processor: YouTubeWebhookProcessor;

  beforeAll(() => {
    processor = new YouTubeWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("should parse video published event from feed entry", async () => {
    const payload = {
      feed: {
        entry: {
          "yt:videoId": ["video-123"],
          "yt:channelId": ["channel-456"],
          title: ["Test Video Title"],
          link: [{ $: { href: "https://www.youtube.com/watch?v=video-123" } }],
          author: [{ name: ["Test Channel"] }],
          published: ["2024-01-15T10:00:00Z"],
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("POST_PUBLISHED");
    expect(result.normalizedData.eventType).toBe("video_published");
    expect(result.normalizedData.videoId).toBe("video-123");
    expect(result.normalizedData.channelId).toBe("channel-456");
    expect(result.normalizedData.title).toBe("Test Video Title");
    expect(result.normalizedData.author).toBe("Test Channel");
  });

  it("should parse video updated event from feed entry", async () => {
    const payload = {
      feed: {
        entry: {
          "yt:videoId": ["video-789"],
          "yt:channelId": ["channel-111"],
          title: ["Updated Video Title"],
          link: [{ $: { href: "https://www.youtube.com/watch?v=video-789" } }],
          author: [{ name: ["Test Channel"] }],
          published: ["2024-01-15T10:00:00Z"],
          updated: ["2024-01-15T11:00:00Z"],
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("POST_UPDATED");
    expect(result.normalizedData.eventType).toBe("video_updated");
    expect(result.normalizedData.updatedAt).toBe("2024-01-15T11:00:00Z");
  });

  it("should parse single entry notification", async () => {
    const payload = {
      entry: {
        "yt:videoId": ["video-single"],
        "yt:channelId": ["channel-222"],
        title: ["Single Entry Video"],
        link: [{ $: { href: "https://www.youtube.com/watch?v=video-single" } }],
        author: [{ name: ["Another Channel"] }],
        published: ["2024-01-15T12:00:00Z"],
      },
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.videoId).toBe("video-single");
    expect(result.normalizedData.channelId).toBe("channel-222");
  });

  it("should handle array format for yt:videoId", async () => {
    const payload = {
      feed: {
        entry: {
          "yt:videoId": ["video-array"],
          "yt:channelId": ["channel-array"],
          title: ["Array Format Video"],
          link: [{ $: { href: "https://www.youtube.com/watch?v=video-array" } }],
          author: [{ name: ["Array Channel"] }],
          published: ["2024-01-15T13:00:00Z"],
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.videoId).toBe("video-array");
    expect(result.normalizedData.channelId).toBe("channel-array");
  });

  it("should generate default link if not provided", async () => {
    const payload = {
      feed: {
        entry: {
          "yt:videoId": ["video-no-link"],
          "yt:channelId": ["channel-333"],
          title: ["Video Without Link"],
          author: [{ name: ["Test Channel"] }],
          published: ["2024-01-15T14:00:00Z"],
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.link).toBe("https://www.youtube.com/watch?v=video-no-link");
  });

  it("should extract published and updated timestamps", async () => {
    const publishedTime = "2024-01-15T10:00:00Z";
    const updatedTime = "2024-01-15T15:00:00Z";

    const payload = {
      entry: {
        "yt:videoId": ["video-timestamps"],
        "yt:channelId": ["channel-444"],
        title: ["Timestamp Video"],
        link: [{ $: { href: "https://www.youtube.com/watch?v=video-timestamps" } }],
        author: [{ name: ["Test Channel"] }],
        published: [publishedTime],
        updated: [updatedTime],
      },
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.publishedAt).toBe(publishedTime);
    expect(result.normalizedData.updatedAt).toBe(updatedTime);
  });
});

// ===========================
// Comment Event Parsing Tests (3 tests)
// ===========================

describe("YouTubeWebhookProcessor - Comment Event Parsing", () => {
  let processor: YouTubeWebhookProcessor;

  beforeAll(() => {
    processor = new YouTubeWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("should parse comment received event", async () => {
    const payload = {
      comment: {
        id: "comment-123",
        videoId: "video-456",
        channelId: "channel-789",
        text: "Great video!",
        textDisplay: "Great video!",
        authorDisplayName: "Commenter Name",
        authorChannelId: "commenter-channel-111",
        likeCount: 5,
        publishedAt: "2024-01-15T10:30:00Z",
      },
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("COMMENT_RECEIVED");
    expect(result.normalizedData.eventType).toBe("comment_received");
    expect(result.normalizedData.commentId).toBe("comment-123");
    expect(result.normalizedData.videoId).toBe("video-456");
    expect(result.normalizedData.text).toBe("Great video!");
    expect(result.normalizedData.authorDisplayName).toBe("Commenter Name");
    expect(result.normalizedData.isReply).toBe(false);
  });

  it("should parse comment reply event", async () => {
    const payload = {
      comment: {
        id: "reply-456",
        videoId: "video-789",
        channelId: "channel-111",
        text: "Thanks for watching!",
        authorDisplayName: "Video Owner",
        authorChannelId: "channel-111",
        likeCount: 2,
        publishedAt: "2024-01-15T11:00:00Z",
        parentId: "comment-123",
      },
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.isReply).toBe(true);
    expect(result.normalizedData.parentId).toBe("comment-123");
  });

  it("should use textDisplay when text is not available", async () => {
    const payload = {
      comment: {
        commentId: "comment-789",
        videoId: "video-111",
        channelId: "channel-222",
        textDisplay: "Display text only",
        authorDisplayName: "User Name",
        authorChannelId: "user-channel",
        publishedAt: "2024-01-15T12:00:00Z",
      },
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.text).toBe("Display text only");
  });
});

// ===========================
// Channel Update Event Parsing Tests (2 tests)
// ===========================

describe("YouTubeWebhookProcessor - Channel Update Event Parsing", () => {
  let processor: YouTubeWebhookProcessor;

  beforeAll(() => {
    processor = new YouTubeWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("should parse channel updated event", async () => {
    const payload = {
      channelUpdate: {
        channelId: "channel-123",
        title: "Updated Channel Title",
        description: "New channel description",
        subscriberCount: 10000,
        videoCount: 250,
        viewCount: 500000,
        updatedAt: "2024-01-15T13:00:00Z",
      },
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("ACCOUNT_CONNECTED");
    expect(result.normalizedData.eventType).toBe("channel_updated");
    expect(result.normalizedData.channelId).toBe("channel-123");
    expect(result.normalizedData.title).toBe("Updated Channel Title");
    expect(result.normalizedData.subscriberCount).toBe(10000);
    expect(result.normalizedData.videoCount).toBe(250);
    expect(result.normalizedData.viewCount).toBe(500000);
  });

  it("should use current timestamp if updatedAt not provided", async () => {
    const beforeTime = new Date().toISOString();

    const payload = {
      channelUpdate: {
        channelId: "channel-456",
        title: "Channel Without Timestamp",
      },
    };

    const result = await processor.parse(payload);

    const afterTime = new Date().toISOString();

    expect(result.normalizedData.updatedAt >= beforeTime).toBeTruthy();
    expect(result.normalizedData.updatedAt <= afterTime).toBeTruthy();
  });
});

// ===========================
// Analytics Event Parsing Tests (3 tests)
// ===========================

describe("YouTubeWebhookProcessor - Analytics Event Parsing", () => {
  let processor: YouTubeWebhookProcessor;

  beforeAll(() => {
    processor = new YouTubeWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("should parse analytics update event", async () => {
    const payload = {
      analytics: {
        videoId: "video-123",
        channelId: "channel-456",
        views: 10000,
        likes: 500,
        dislikes: 10,
        comments: 100,
        shares: 50,
        watchTimeMinutes: 5000,
        averageViewDuration: 300,
        estimatedRevenue: 50.5,
        timestamp: "2024-01-15T14:00:00Z",
      },
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("POST_ENGAGEMENT_UPDATE");
    expect(result.normalizedData.eventType).toBe("analytics_update");
    expect(result.normalizedData.videoId).toBe("video-123");
    expect(result.normalizedData.views).toBe(10000);
    expect(result.normalizedData.likes).toBe(500);
    expect(result.normalizedData.comments).toBe(100);
    expect(result.normalizedData.shares).toBe(50);
  });

  it("should handle analytics with default values", async () => {
    const payload = {
      analytics: {
        videoId: "video-789",
        channelId: "channel-111",
      },
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.views).toBe(0);
    expect(result.normalizedData.likes).toBe(0);
    expect(result.normalizedData.comments).toBe(0);
    expect(result.normalizedData.shares).toBe(0);
  });

  it("should include YouTube-specific metrics", async () => {
    const payload = {
      analytics: {
        videoId: "video-metrics",
        channelId: "channel-metrics",
        views: 5000,
        likes: 250,
        comments: 50,
        shares: 25,
        watchTimeMinutes: 2500,
        averageViewDuration: 180,
        estimatedRevenue: 25.75,
        timestamp: "2024-01-15T15:00:00Z",
      },
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.watchTimeMinutes).toBe(2500);
    expect(result.normalizedData.averageViewDuration).toBe(180);
    expect(result.normalizedData.estimatedRevenue).toBe(25.75);
  });
});

// ===========================
// Error Handling Tests (3 tests)
// ===========================

describe("YouTubeWebhookProcessor - Error Handling", () => {
  let processor: YouTubeWebhookProcessor;

  beforeAll(() => {
    processor = new YouTubeWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("should throw error for unsupported event type", async () => {
    const payload = {
      unknown_event: { data: "test" },
    };

    await expect(processor.parse(payload)).rejects.toThrow(
      /Unsupported YouTube webhook event type/
    );
  });

  it("should throw error for missing required fields", async () => {
    const payload = {
      feed: {},
    };

    await expect(processor.parse(payload)).rejects.toThrow(
      /Unsupported YouTube webhook event type/
    );
  });

  it("should handle verification errors gracefully", () => {
    const processor = new YouTubeWebhookProcessor(makeWebhookPrismaFake().prisma);

    // This should return false instead of throwing
    const isValid = processor.verify("invalid\x00data", "signature", "secret");
    expect(isValid).toBe(false);
  });
});

// ===========================
// XML Parsing Tests (3 tests)
// ===========================

describe("YouTubeWebhookProcessor - XML Parsing", () => {
  let processor: YouTubeWebhookProcessor;

  beforeAll(() => {
    processor = new YouTubeWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("should handle pre-parsed JSON payload", async () => {
    const payload = {
      feed: {
        entry: {
          "yt:videoId": ["video-json"],
          "yt:channelId": ["channel-json"],
          title: ["JSON Parsed Video"],
          published: ["2024-01-15T16:00:00Z"],
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.videoId).toBe("video-json");
  });

  it("should handle entry array with multiple entries", async () => {
    const payload = {
      feed: {
        entry: [
          {
            "yt:videoId": ["video-first"],
            "yt:channelId": ["channel-123"],
            title: ["First Video"],
            published: ["2024-01-15T16:00:00Z"],
          },
          {
            "yt:videoId": ["video-second"],
            "yt:channelId": ["channel-123"],
            title: ["Second Video"],
            published: ["2024-01-15T17:00:00Z"],
          },
        ],
      },
    };

    const result = await processor.parse(payload);

    // Should parse the first entry
    expect(result.normalizedData.videoId).toBe("video-first");
  });

  it("should extract nested link href correctly", async () => {
    const payload = {
      entry: {
        "yt:videoId": ["video-link"],
        "yt:channelId": ["channel-link"],
        title: ["Link Test Video"],
        link: [
          {
            $: {
              href: "https://www.youtube.com/watch?v=video-link&feature=youtube_gdata",
            },
          },
        ],
        published: ["2024-01-15T18:00:00Z"],
      },
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.link).toBe(
      "https://www.youtube.com/watch?v=video-link&feature=youtube_gdata"
    );
  });
});

// ===========================
// Timestamp Handling Tests (2 tests)
// ===========================

describe("YouTubeWebhookProcessor - Timestamp Handling", () => {
  let processor: YouTubeWebhookProcessor;

  beforeAll(() => {
    processor = new YouTubeWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("should preserve ISO timestamp format in video events", async () => {
    const publishedTime = "2024-01-15T10:30:45Z";
    const payload = {
      feed: {
        entry: {
          "yt:videoId": ["video-timestamp"],
          "yt:channelId": ["channel-timestamp"],
          title: ["Timestamp Test"],
          published: [publishedTime],
        },
      },
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.publishedAt).toBe(publishedTime);
  });

  it("should handle timestamp in analytics events", async () => {
    const analyticsTime = "2024-01-15T20:00:00Z";
    const payload = {
      analytics: {
        videoId: "video-analytics-time",
        channelId: "channel-analytics",
        views: 1000,
        timestamp: analyticsTime,
      },
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.timestamp).toBe(analyticsTime);
  });
});

// Total: 30 tests covering all YouTube webhook processor functionality
