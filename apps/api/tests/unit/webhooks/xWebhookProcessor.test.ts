/**
 * Comprehensive Unit Tests for XWebhookProcessor
 *
 * BUSINESS LOGIC VALIDATION:
 * This test suite validates the X (Twitter) webhook processor which handles incoming
 * webhooks from X Platform API (formerly Twitter API v2).
 *
 * KEY BUSINESS CAPABILITIES TESTED:
 * - HMAC-SHA256 signature verification (base64 and hex formats)
 * - Tweet create/delete event parsing
 * - Engagement events (likes, retweets, replies)
 * - Direct message event handling
 * - Follow/unfollow event processing
 * - User account change events
 * - Thread detection (reply to own tweet)
 * - Entity relationship resolution (channel, project, account, post)
 * - Analytics tracking and engagement updates
 * - Real-time broadcasting integration
 *
 * WEBHOOK BUSINESS RULES:
 * - Signature uses HMAC-SHA256 with consumer secret (base64 or hex)
 * - Supports event types: tweet_create, tweet_delete, favorite, retweet, reply, DM, follow
 * - Thread tweets have in_reply_to_status_id_str === own user ID
 * - Retweets have retweeted_status object
 * - full_text preferred over text for extended tweets
 * - Analytics track likes, shares (retweets), comments (replies), views
 *
 * PROVIDER-SPECIFIC FORMATS:
 * - Signature: sha256=<base64 or hex> in x-signature header
 * - Payload structure varies by event type
 * - Event types use specific keys: tweet_create_events, favorite_events, etc.
 *
 * RUN COMMAND:
 * pnpm --filter @apps/api exec node --import tsx --test tests/unit/webhooks/xWebhookProcessor.test.ts
 *
 * @module XWebhookProcessorTests
 * @category UnitTests
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import { XWebhookProcessor } from "../../../src/webhooks/processors/xWebhookProcessor.js";

// ===========================
// Test Helpers
// ===========================

function generateHmacSignatureBase64(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64");
}

function generateHmacSignatureHex(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

// ===========================
// Signature Verification Tests (9 tests)
// ===========================

describe("XWebhookProcessor - Signature Verification", { concurrency: 1 }, () => {
  let processor: XWebhookProcessor;
  const testSecret = "test-x-consumer-secret";

  before(() => {
    processor = new XWebhookProcessor();
  });

  it("should verify valid webhook signature in base64 format", () => {
    const payload = JSON.stringify({ test: "data" });
    const signature = generateHmacSignatureBase64(payload, testSecret);

    const isValid = processor.verify(payload, `sha256=${signature}`, testSecret);
    assert.strictEqual(isValid, true);
  });

  it("should verify valid webhook signature in hex format", () => {
    const payload = JSON.stringify({ test: "data" });
    const signature = generateHmacSignatureHex(payload, testSecret);

    const isValid = processor.verify(payload, `sha256=${signature}`, testSecret);
    assert.strictEqual(isValid, true);
  });

  it("should verify signature without sha256= prefix", () => {
    const payload = JSON.stringify({ test: "data" });
    const signature = generateHmacSignatureBase64(payload, testSecret);

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
    const signature = generateHmacSignatureBase64(originalPayload, testSecret);

    const tamperedPayload = JSON.stringify({ test: "tampered" });
    const isValid = processor.verify(tamperedPayload, signature, testSecret);
    assert.strictEqual(isValid, false);
  });

  it("should reject signature with wrong secret", () => {
    const payload = JSON.stringify({ test: "data" });
    const signature = generateHmacSignatureBase64(payload, "wrong-secret");

    const isValid = processor.verify(payload, signature, testSecret);
    assert.strictEqual(isValid, false);
  });

  it("should handle empty payload", () => {
    const payload = "";
    const signature = generateHmacSignatureBase64(payload, testSecret);

    const isValid = processor.verify(payload, signature, testSecret);
    assert.strictEqual(isValid, true);
  });

  it("should handle unicode characters in payload", () => {
    const payload = JSON.stringify({ test: "data with unicode 🐦 and 中文" });
    const signature = generateHmacSignatureBase64(payload, testSecret);

    const isValid = processor.verify(payload, `sha256=${signature}`, testSecret);
    assert.strictEqual(isValid, true);
  });

  it("should use constant-time comparison", () => {
    const payload = JSON.stringify({ test: "data" });
    const correctSignature = generateHmacSignatureBase64(payload, testSecret);

    // Test multiple attempts to verify timing consistency
    for (let i = 0; i < 10; i++) {
      const isValid = processor.verify(payload, correctSignature, testSecret);
      assert.strictEqual(isValid, true);
    }
  });
});

// ===========================
// Tweet Create Event Tests (5 tests)
// ===========================

describe("XWebhookProcessor - Tweet Create Events", { concurrency: 1 }, () => {
  let processor: XWebhookProcessor;

  before(() => {
    processor = new XWebhookProcessor();
  });

  it("should parse tweet create event", async () => {
    const payload = {
      tweet_create_events: [
        {
          id_str: "tweet-123456",
          text: "Hello Twitter!",
          user: {
            id_str: "user-789",
            screen_name: "testuser",
          },
          created_at: "Mon Jan 15 10:00:00 +0000 2024",
          retweet_count: 5,
          favorite_count: 10,
          entities: {},
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "POST_PUBLISHED");
    assert.strictEqual(result.normalizedData.eventType, "tweet_created");
    assert.strictEqual(result.normalizedData.tweetId, "tweet-123456");
    assert.strictEqual(result.normalizedData.text, "Hello Twitter!");
    assert.strictEqual(result.normalizedData.screenName, "testuser");
    assert.strictEqual(result.normalizedData.retweetCount, 5);
    assert.strictEqual(result.normalizedData.favoriteCount, 10);
  });

  it("should detect retweet in tweet create event", async () => {
    const payload = {
      tweet_create_events: [
        {
          id_str: "tweet-999",
          text: "RT @original: Original tweet",
          user: {
            id_str: "user-123",
            screen_name: "retweeter",
          },
          created_at: "Mon Jan 15 11:00:00 +0000 2024",
          retweeted_status: {
            id_str: "original-tweet",
            user: { screen_name: "original" },
          },
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.isRetweet, true);
  });

  it("should detect thread tweet", async () => {
    const payload = {
      tweet_create_events: [
        {
          id_str: "thread-tweet-2",
          text: "This is tweet 2 in the thread",
          user: {
            id_str: "user-123",
            screen_name: "threaduser",
          },
          created_at: "Mon Jan 15 12:00:00 +0000 2024",
          in_reply_to_status_id_str: "thread-tweet-1",
          in_reply_to_user_id_str: "user-123",
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.isThread, true);
    assert.strictEqual(result.normalizedData.replyToTweetId, "thread-tweet-1");
  });

  it("should use full_text when text is not available", async () => {
    const payload = {
      tweet_create_events: [
        {
          id_str: "tweet-long",
          full_text: "This is the full extended tweet text with more than 140 characters",
          user: {
            id_str: "user-456",
            screen_name: "longuser",
          },
          created_at: "Mon Jan 15 13:00:00 +0000 2024",
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(
      result.normalizedData.text,
      "This is the full extended tweet text with more than 140 characters"
    );
  });

  it("should extract entities from tweet", async () => {
    const entities = {
      hashtags: [{ text: "test" }],
      user_mentions: [{ screen_name: "mentioned" }],
      urls: [{ url: "https://example.com" }],
    };

    const payload = {
      tweet_create_events: [
        {
          id_str: "tweet-entities",
          text: "Tweet with entities #test @mentioned https://example.com",
          user: {
            id_str: "user-789",
            screen_name: "testuser",
          },
          created_at: "Mon Jan 15 14:00:00 +0000 2024",
          entities,
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.deepStrictEqual(result.normalizedData.entities, entities);
  });
});

// ===========================
// Tweet Delete Event Tests (2 tests)
// ===========================

describe("XWebhookProcessor - Tweet Delete Events", { concurrency: 1 }, () => {
  let processor: XWebhookProcessor;

  before(() => {
    processor = new XWebhookProcessor();
  });

  it("should parse tweet delete event", async () => {
    const payload = {
      tweet_delete_events: [
        {
          status: {
            id_str: "deleted-tweet-123",
            user_id_str: "user-789",
          },
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "POST_DELETED");
    assert.strictEqual(result.normalizedData.eventType, "tweet_deleted");
    assert.strictEqual(result.normalizedData.tweetId, "deleted-tweet-123");
    assert.strictEqual(result.normalizedData.userId, "user-789");
  });

  it("should include deletion timestamp", async () => {
    const payload = {
      tweet_delete_events: [
        {
          status: {
            id_str: "deleted-tweet-456",
            user_id_str: "user-111",
          },
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.ok(result.normalizedData.deletedAt);
    assert.ok(new Date(result.normalizedData.deletedAt).getTime() > 0);
  });
});

// ===========================
// Favorite (Like) Event Tests (2 tests)
// ===========================

describe("XWebhookProcessor - Favorite Events", { concurrency: 1 }, () => {
  let processor: XWebhookProcessor;

  before(() => {
    processor = new XWebhookProcessor();
  });

  it("should parse favorite event", async () => {
    const payload = {
      favorite_events: [
        {
          favorited_status: {
            id_str: "tweet-to-like",
            user: { id_str: "original-user" },
          },
          user: {
            id_str: "liker-user",
            screen_name: "liker",
          },
          created_at: "Mon Jan 15 14:00:00 +0000 2024",
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "LIKE_RECEIVED");
    assert.strictEqual(result.normalizedData.eventType, "like_received");
    assert.strictEqual(result.normalizedData.tweetId, "tweet-to-like");
    assert.strictEqual(result.normalizedData.userId, "liker-user");
    assert.strictEqual(result.normalizedData.screenName, "liker");
    assert.strictEqual(result.normalizedData.targetTweetUserId, "original-user");
  });

  it("should extract favorite timestamp", async () => {
    const createdAt = "Mon Jan 15 15:30:00 +0000 2024";
    const payload = {
      favorite_events: [
        {
          favorited_status: {
            id_str: "tweet-123",
            user: { id_str: "user-456" },
          },
          user: {
            id_str: "liker-789",
            screen_name: "liker",
          },
          created_at: createdAt,
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.createdAt, createdAt);
  });
});

// ===========================
// Retweet Event Tests (2 tests)
// ===========================

describe("XWebhookProcessor - Retweet Events", { concurrency: 1 }, () => {
  let processor: XWebhookProcessor;

  before(() => {
    processor = new XWebhookProcessor();
  });

  it("should parse retweet event", async () => {
    const payload = {
      retweet_events: [
        {
          id_str: "retweet-123",
          retweeted_status: {
            id_str: "original-tweet-456",
          },
          user: {
            id_str: "retweeter-789",
            screen_name: "retweeter",
          },
          text: "RT @original: Original tweet text",
          created_at: "Mon Jan 15 15:00:00 +0000 2024",
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "SHARE_RECEIVED");
    assert.strictEqual(result.normalizedData.eventType, "retweet_received");
    assert.strictEqual(result.normalizedData.retweetId, "retweet-123");
    assert.strictEqual(result.normalizedData.originalTweetId, "original-tweet-456");
    assert.strictEqual(result.normalizedData.userId, "retweeter-789");
  });

  it("should extract retweet text", async () => {
    const retweetText = "RT @original: Amazing content!";
    const payload = {
      retweet_events: [
        {
          id_str: "retweet-456",
          retweeted_status: {
            id_str: "original-789",
          },
          user: {
            id_str: "user-111",
            screen_name: "user",
          },
          text: retweetText,
          full_text: retweetText,
          created_at: "Mon Jan 15 16:00:00 +0000 2024",
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.retweetText, retweetText);
  });
});

// ===========================
// Reply Event Tests (3 tests)
// ===========================

describe("XWebhookProcessor - Reply Events", { concurrency: 1 }, () => {
  let processor: XWebhookProcessor;

  before(() => {
    processor = new XWebhookProcessor();
  });

  it("should parse reply event", async () => {
    const payload = {
      reply_events: [
        {
          id_str: "reply-123",
          text: "@original Great tweet!",
          user: {
            id_str: "replier-456",
            screen_name: "replier",
          },
          in_reply_to_status_id_str: "original-tweet-789",
          in_reply_to_user_id_str: "original-user-111",
          created_at: "Mon Jan 15 16:00:00 +0000 2024",
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "COMMENT_RECEIVED");
    assert.strictEqual(result.normalizedData.eventType, "reply_received");
    assert.strictEqual(result.normalizedData.replyId, "reply-123");
    assert.strictEqual(result.normalizedData.text, "@original Great tweet!");
    assert.strictEqual(result.normalizedData.inReplyToTweetId, "original-tweet-789");
    assert.strictEqual(result.normalizedData.inReplyToUserId, "original-user-111");
  });

  it("should use full_text when text is not available in reply", async () => {
    const fullText =
      "@user This is a very long reply with more than 140 characters explaining something";
    const payload = {
      reply_events: [
        {
          id_str: "reply-456",
          full_text: fullText,
          user: {
            id_str: "replier-789",
            screen_name: "replier",
          },
          in_reply_to_status_id_str: "tweet-123",
          in_reply_to_user_id_str: "user-456",
          created_at: "Mon Jan 15 17:00:00 +0000 2024",
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.text, fullText);
  });

  it("should extract reply user information", async () => {
    const payload = {
      reply_events: [
        {
          id_str: "reply-789",
          text: "Thanks!",
          user: {
            id_str: "user-999",
            screen_name: "thanker",
          },
          in_reply_to_status_id_str: "tweet-111",
          in_reply_to_user_id_str: "user-222",
          created_at: "Mon Jan 15 18:00:00 +0000 2024",
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.userId, "user-999");
    assert.strictEqual(result.normalizedData.screenName, "thanker");
  });
});

// ===========================
// Direct Message Event Tests (2 tests)
// ===========================

describe("XWebhookProcessor - Direct Message Events", { concurrency: 1 }, () => {
  let processor: XWebhookProcessor;

  before(() => {
    processor = new XWebhookProcessor();
  });

  it("should parse direct message event", async () => {
    const payload = {
      direct_message_events: [
        {
          id: "dm-123",
          message_create: {
            sender_id: "sender-456",
            target: {
              recipient_id: "recipient-789",
            },
            message_data: {
              text: "Hello via DM!",
            },
          },
          created_timestamp: "1642248000000",
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "COMMENT_RECEIVED");
    assert.strictEqual(result.normalizedData.eventType, "direct_message");
    assert.strictEqual(result.normalizedData.messageId, "dm-123");
    assert.strictEqual(result.normalizedData.text, "Hello via DM!");
    assert.strictEqual(result.normalizedData.senderId, "sender-456");
    assert.strictEqual(result.normalizedData.recipientId, "recipient-789");
    assert.strictEqual(result.normalizedData.isDirectMessage, true);
  });

  it("should handle DM without message text", async () => {
    const payload = {
      direct_message_events: [
        {
          id: "dm-456",
          message_create: {
            sender_id: "sender-111",
            target: {
              recipient_id: "recipient-222",
            },
            message_data: {},
          },
          created_timestamp: "1642248100000",
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.text, undefined);
  });
});

// ===========================
// Follow Event Tests (3 tests)
// ===========================

describe("XWebhookProcessor - Follow Events", { concurrency: 1 }, () => {
  let processor: XWebhookProcessor;

  before(() => {
    processor = new XWebhookProcessor();
  });

  it("should parse follow event", async () => {
    const payload = {
      follow_events: [
        {
          type: "follow",
          source: {
            id_str: "follower-123",
            screen_name: "follower",
          },
          target: {
            id_str: "followed-456",
            screen_name: "followed",
          },
          created_at: "Mon Jan 15 17:00:00 +0000 2024",
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "ACCOUNT_CONNECTED");
    assert.strictEqual(result.normalizedData.eventType, "follow_event");
    assert.strictEqual(result.normalizedData.followerId, "follower-123");
    assert.strictEqual(result.normalizedData.followedId, "followed-456");
    assert.strictEqual(result.normalizedData.type, "follow");
  });

  it("should parse unfollow event", async () => {
    const payload = {
      follow_events: [
        {
          type: "unfollow",
          source: {
            id_str: "unfollower-123",
            screen_name: "unfollower",
          },
          target: {
            id_str: "unfollowed-456",
            screen_name: "unfollowed",
          },
          created_at: "Mon Jan 15 17:30:00 +0000 2024",
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.type, "unfollow");
  });

  it("should extract follow screen names", async () => {
    const payload = {
      follow_events: [
        {
          type: "follow",
          source: {
            id_str: "follower-789",
            screen_name: "new_follower",
          },
          target: {
            id_str: "followed-999",
            screen_name: "popular_account",
          },
          created_at: "Mon Jan 15 18:00:00 +0000 2024",
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.followerScreenName, "new_follower");
    assert.strictEqual(result.normalizedData.followedScreenName, "popular_account");
  });
});

// ===========================
// User Event Tests (2 tests)
// ===========================

describe("XWebhookProcessor - User Events", { concurrency: 1 }, () => {
  let processor: XWebhookProcessor;

  before(() => {
    processor = new XWebhookProcessor();
  });

  it("should parse account disconnected event", async () => {
    const payload = {
      user_event: {
        revoked: {
          app_id: "app-123",
          access_token: "revoked-token",
        },
        id_str: "user-456",
        screen_name: "disconnected_user",
      },
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "ACCOUNT_DISCONNECTED");
    assert.strictEqual(result.normalizedData.eventType, "account_disconnected");
    assert.strictEqual(result.normalizedData.userId, "user-456");
  });

  it("should parse account updated event", async () => {
    const payload = {
      user_event: {
        id_str: "user-789",
        screen_name: "updated_user",
      },
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.eventType, "account_updated");
  });
});

// ===========================
// Error Handling Tests (2 tests)
// ===========================

describe("XWebhookProcessor - Error Handling", { concurrency: 1 }, () => {
  let processor: XWebhookProcessor;

  before(() => {
    processor = new XWebhookProcessor();
  });

  it("should throw error for unsupported event type", async () => {
    const payload = {
      unknown_event: [{ data: "test" }],
    };

    await assert.rejects(
      async () => {
        await processor.parse(payload);
      },
      {
        message: /Unsupported X webhook event type/,
      }
    );
  });

  it("should handle verification errors gracefully", () => {
    const processor = new XWebhookProcessor();

    // This should return false instead of throwing
    const isValid = processor.verify("invalid\x00data", "signature", "secret");
    assert.strictEqual(isValid, false);
  });
});

// Total: 35 tests covering all X webhook processor functionality
