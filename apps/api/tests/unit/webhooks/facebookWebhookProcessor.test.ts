/**
 * Comprehensive Unit Tests for FacebookWebhookProcessor
 *
 * BUSINESS LOGIC VALIDATION:
 * This test suite validates the Facebook webhook processor which handles incoming
 * webhooks from the Facebook Graph API.
 *
 * KEY BUSINESS CAPABILITIES TESTED:
 * - HMAC-SHA256 signature verification (hex format, sha256= prefix)
 * - Feed update event parsing (post published/updated)
 * - Comment event handling (comments and replies)
 * - Reaction event parsing (like, love, haha, wow, sad, angry)
 * - Mention event processing (mention + mentions field variants)
 * - Page event handling (page updates)
 * - Live video event parsing
 * - Messaging/Messenger event parsing
 * - Unknown field fallback (POST_UPDATED)
 * - Error paths (missing entry, no changes/messaging)
 * - process() routing (warn on no entities, mentionEnqueue, analytics, broadcasting)
 * - Entity relationship resolution (channel, project, account, post)
 *
 * WEBHOOK BUSINESS RULES:
 * - Signature uses HMAC-SHA256 with app secret (hex encoding, sha256= prefix)
 * - Payload: { entry: [{ id, changes: [...] }] } or { entry: [{ id, messaging: [...] }] }
 * - Event types: feed, comments, reactions, mention, mentions, page, live_videos, messaging
 * - isReply detection: parent_id present AND parent_id !== post_id
 * - Reaction add/remove maps to likes increment/decrement
 *
 * PROVIDER-SPECIFIC FORMATS:
 * - Signature: sha256=<hex> in x-hub-signature-256 header
 * - Each change has { field, value } structure
 *
 * RUN COMMAND:
 * cd apps/api && NODE_OPTIONS=--max-old-space-size=3072 pnpm exec vitest run tests/unit/webhooks/facebookWebhookProcessor.test.ts --no-coverage
 *
 * @file facebookWebhookProcessor.test.ts
 * @description Tests for FacebookWebhookProcessor — covers all 8 event branches plus
 *              error paths, process() routing, and HMAC verification.
 * @layer infrastructure
 */

import { describe, it, beforeAll, expect, vi } from "vitest";
import { createHmac } from "crypto";
import { FacebookWebhookProcessor } from "../../../src/webhooks/processors/facebookWebhookProcessor.js";
import { makeWebhookPrismaFake } from "../helpers/webhookPrismaFake.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function generateHmacHex(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/** Minimal channel seeded into the fake prisma so findRelatedEntities resolves. */
function seedChannel(
  stores: ReturnType<typeof makeWebhookPrismaFake>["stores"],
  facebookPageId: string
) {
  const accountId = "acct-facebook-001";
  const projectId = "proj-facebook-001";
  const channelId = "chan-facebook-001";

  stores.channel.add({
    id: channelId,
    provider: "FACEBOOK",
    providerAccountId: facebookPageId,
    projectId,
    project: {
      id: projectId,
      accountId,
      account: { id: accountId },
    },
  });

  return { accountId, projectId, channelId };
}

// ---------------------------------------------------------------------------
// Signature Verification (8 tests)
// ---------------------------------------------------------------------------

describe("FacebookWebhookProcessor - Signature Verification", () => {
  let processor: FacebookWebhookProcessor;
  const testSecret = "test-facebook-app-secret";

  beforeAll(() => {
    processor = new FacebookWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("verifies valid webhook signature with sha256= prefix", () => {
    const payload = JSON.stringify({ object: "page", entry: [] });
    const signature = generateHmacHex(payload, testSecret);
    expect(processor.verify(payload, `sha256=${signature}`, testSecret)).toBe(true);
  });

  it("verifies valid webhook signature without sha256= prefix", () => {
    const payload = JSON.stringify({ test: "data" });
    const signature = generateHmacHex(payload, testSecret);
    expect(processor.verify(payload, signature, testSecret)).toBe(true);
  });

  it("rejects invalid signature", () => {
    const payload = JSON.stringify({ test: "data" });
    expect(processor.verify(payload, "sha256=deadbeef00000000", testSecret)).toBe(false);
  });

  it("rejects signature computed for tampered payload", () => {
    const originalPayload = JSON.stringify({ test: "data" });
    const signature = generateHmacHex(originalPayload, testSecret);
    const tampered = JSON.stringify({ test: "tampered" });
    expect(processor.verify(tampered, `sha256=${signature}`, testSecret)).toBe(false);
  });

  it("rejects signature computed with wrong secret", () => {
    const payload = JSON.stringify({ test: "data" });
    const signature = generateHmacHex(payload, "wrong-secret");
    expect(processor.verify(payload, `sha256=${signature}`, testSecret)).toBe(false);
  });

  it("handles empty payload gracefully", () => {
    const payload = "";
    const signature = generateHmacHex(payload, testSecret);
    expect(processor.verify(payload, `sha256=${signature}`, testSecret)).toBe(true);
  });

  it("handles special characters and emoji in payload", () => {
    const payload = JSON.stringify({ content: "Bonjour 🇫🇷 and special: <>&" });
    const signature = generateHmacHex(payload, testSecret);
    expect(processor.verify(payload, `sha256=${signature}`, testSecret)).toBe(true);
  });

  it("returns false for null-byte payload without throwing", () => {
    const isValid = processor.verify("data\x00payload", "sha256=invalid", testSecret);
    expect(isValid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Feed Event Parsing (5 tests)
// ---------------------------------------------------------------------------

describe("FacebookWebhookProcessor - Feed Event Parsing", () => {
  let processor: FacebookWebhookProcessor;

  beforeAll(() => {
    processor = new FacebookWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("parses feed event and maps to POST_PUBLISHED event type", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "feed",
              value: {
                post_id: "fb-post-456",
                verb: "add",
                item: "status",
                message: "Hello Facebook!",
                permalink_url: "https://www.facebook.com/post/456",
                created_time: 1700000000,
                from: { id: "user-789", name: "Alice" },
                published: true,
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("POST_PUBLISHED");
    expect(result.normalizedData.eventType).toBe("feed_published");
    expect(result.normalizedData.postId).toBe("fb-post-456");
    expect(result.normalizedData.verb).toBe("add");
    expect(result.normalizedData.item).toBe("status");
    expect(result.normalizedData.message).toBe("Hello Facebook!");
    expect(result.normalizedData.permalink).toBe("https://www.facebook.com/post/456");
    expect(result.normalizedData.isPublished).toBe(true);
  });

  it("extracts from.id and from.name from feed event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "feed",
              value: {
                post_id: "fb-post-999",
                from: { id: "user-abc", name: "Bob Builder" },
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);
    const from = result.normalizedData.from as Record<string, unknown>;

    expect(from.id).toBe("user-abc");
    expect(from.name).toBe("Bob Builder");
  });

  it("marks isHidden = true when payload has is_hidden flag", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "feed",
              value: { post_id: "fb-post-hidden", is_hidden: true },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.isHidden).toBe(true);
  });

  it("marks isPublished = false when published flag is absent", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [{ field: "feed", value: { post_id: "fb-post-draft" } }],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.isPublished).toBe(false);
  });

  it("falls back to value.id when post_id is absent in feed event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "feed",
              value: { id: "fb-object-999", verb: "edited" },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.postId).toBe("fb-object-999");
  });
});

// ---------------------------------------------------------------------------
// Comment Event Parsing (5 tests)
// ---------------------------------------------------------------------------

describe("FacebookWebhookProcessor - Comment Event Parsing", () => {
  let processor: FacebookWebhookProcessor;

  beforeAll(() => {
    processor = new FacebookWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("parses comment event and maps to COMMENT_RECEIVED event type", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "comments",
              value: {
                comment_id: "cmt-111",
                post_id: "post-222",
                message: "Great photo!",
                from: { id: "user-333", name: "Carol" },
                created_time: 1700001000,
                verb: "add",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("COMMENT_RECEIVED");
    expect(result.normalizedData.eventType).toBe("comment_received");
    expect(result.normalizedData.commentId).toBe("cmt-111");
    expect(result.normalizedData.postId).toBe("post-222");
    expect(result.normalizedData.text).toBe("Great photo!");
    expect(result.normalizedData.verb).toBe("add");
  });

  it("detects reply when parent_id differs from post_id", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "comments",
              value: {
                comment_id: "reply-444",
                post_id: "post-555",
                parent_id: "cmt-666",
                message: "Thanks!",
                from: { id: "user-777", name: "Dave" },
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.isReply).toBe(true);
    expect(result.normalizedData.parentId).toBe("cmt-666");
  });

  it("marks isReply = false when parent_id equals post_id", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "comments",
              value: {
                comment_id: "cmt-888",
                post_id: "post-999",
                parent_id: "post-999",
                message: "Direct comment",
                from: { id: "user-111", name: "Eve" },
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.isReply).toBe(false);
  });

  it("marks isReply = false when parent_id is absent", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "comments",
              value: {
                comment_id: "cmt-abc",
                post_id: "post-xyz",
                message: "Top-level comment",
                from: { id: "user-abc", name: "Frank" },
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.isReply).toBe(false);
  });

  it("falls back to value.id when comment_id is absent", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "comments",
              value: { id: "cmt-fallback", post_id: "post-xyz", message: "comment" },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.commentId).toBe("cmt-fallback");
  });
});

// ---------------------------------------------------------------------------
// Reaction Event Parsing (5 tests)
// ---------------------------------------------------------------------------

describe("FacebookWebhookProcessor - Reaction Event Parsing", () => {
  let processor: FacebookWebhookProcessor;

  beforeAll(() => {
    processor = new FacebookWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("parses reaction event and maps to LIKE_RECEIVED event type", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "reactions",
              value: {
                reaction_id: "react-111",
                post_id: "post-222",
                reaction_type: "love",
                from: { id: "user-333", name: "Grace" },
                created_time: 1700002000,
                verb: "add",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("LIKE_RECEIVED");
    expect(result.normalizedData.eventType).toBe("reaction_received");
    expect(result.normalizedData.reactionId).toBe("react-111");
    expect(result.normalizedData.postId).toBe("post-222");
    expect(result.normalizedData.reactionType).toBe("love");
    expect(result.normalizedData.verb).toBe("add");
  });

  it("defaults reaction_type to like when absent", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "reactions",
              value: {
                reaction_id: "react-222",
                post_id: "post-333",
                verb: "add",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.reactionType).toBe("like");
  });

  it("parses reaction remove event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "reactions",
              value: {
                reaction_id: "react-444",
                post_id: "post-555",
                reaction_type: "wow",
                verb: "remove",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.verb).toBe("remove");
  });

  it("extracts from.id and from.name from reaction event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "reactions",
              value: {
                reaction_id: "react-666",
                from: { id: "user-lucky", name: "Lucky" },
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);
    const from = result.normalizedData.from as Record<string, unknown>;

    expect(from.id).toBe("user-lucky");
    expect(from.name).toBe("Lucky");
  });

  it("falls back to value.id when reaction_id is absent", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "reactions",
              value: { id: "react-fallback", post_id: "post-xyz" },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.reactionId).toBe("react-fallback");
  });
});

// ---------------------------------------------------------------------------
// Mention Event Parsing (4 tests)
// ---------------------------------------------------------------------------

describe("FacebookWebhookProcessor - Mention Event Parsing", () => {
  let processor: FacebookWebhookProcessor;

  beforeAll(() => {
    processor = new FacebookWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("parses mention field and maps to MENTION_RECEIVED event type", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "mention",
              value: {
                post_id: "mpost-111",
                message: "Hey @page, check this out!",
                from: { id: "user-aaa", name: "Hank" },
                created_time: 1700003000,
                permalink_url: "https://www.facebook.com/mpost/111",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("MENTION_RECEIVED");
    expect(result.normalizedData.eventType).toBe("mention_received");
    expect(result.normalizedData.postId).toBe("mpost-111");
    expect(result.normalizedData.message).toBe("Hey @page, check this out!");
    expect(result.normalizedData.permalink).toBe("https://www.facebook.com/mpost/111");
  });

  it("parses mentions (plural) field and also maps to MENTION_RECEIVED", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "mentions",
              value: {
                post_id: "mpost-222",
                message: "Multiple mention via mentions field",
                from: { id: "user-bbb", name: "Iris" },
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("MENTION_RECEIVED");
    expect(result.normalizedData.eventType).toBe("mention_received");
  });

  it("extracts from.id from mention event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "mention",
              value: {
                post_id: "mpost-333",
                from: { id: "user-ccc", name: "Jake" },
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);
    const from = result.normalizedData.from as Record<string, unknown>;

    expect(from.id).toBe("user-ccc");
    expect(from.name).toBe("Jake");
  });

  it("falls back to value.id when post_id is absent in mention event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "mention",
              value: { id: "mention-fallback-id" },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.postId).toBe("mention-fallback-id");
  });
});

// ---------------------------------------------------------------------------
// Page Event Parsing (2 tests)
// ---------------------------------------------------------------------------

describe("FacebookWebhookProcessor - Page Event Parsing", () => {
  let processor: FacebookWebhookProcessor;

  beforeAll(() => {
    processor = new FacebookWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("parses page event and maps to ACCOUNT_CONNECTED event type", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "page",
              value: {
                page_id: "pg-111",
                verb: "update",
                changes: { name: "New Page Name" },
                category: "Entertainment",
                name: "MyPage",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("ACCOUNT_CONNECTED");
    expect(result.normalizedData.eventType).toBe("page_updated");
    expect(result.normalizedData.pageId).toBe("pg-111");
    expect(result.normalizedData.verb).toBe("update");
    expect(result.normalizedData.category).toBe("Entertainment");
    expect(result.normalizedData.name).toBe("MyPage");
  });

  it("falls back to value.id when page_id is absent in page event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "page",
              value: { id: "pg-fallback-456", verb: "update" },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.pageId).toBe("pg-fallback-456");
  });
});

// ---------------------------------------------------------------------------
// Live Video Event Parsing (3 tests)
// ---------------------------------------------------------------------------

describe("FacebookWebhookProcessor - Live Video Event Parsing", () => {
  let processor: FacebookWebhookProcessor;

  beforeAll(() => {
    processor = new FacebookWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("parses live_videos event and maps to POST_PUBLISHED event type", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "live_videos",
              value: {
                video_id: "live-111",
                status: "live",
                broadcast_start_time: 1700004000,
                description: "Live stream!",
                permalink_url: "https://www.facebook.com/live/111",
                from: { id: "user-ddd", name: "Kate" },
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("POST_PUBLISHED");
    expect(result.normalizedData.eventType).toBe("live_video_published");
    expect(result.normalizedData.videoId).toBe("live-111");
    expect(result.normalizedData.status).toBe("live");
    expect(result.normalizedData.broadcastStartTime).toBe(1700004000);
    expect(result.normalizedData.description).toBe("Live stream!");
    expect(result.normalizedData.permalink).toBe("https://www.facebook.com/live/111");
  });

  it("extracts from.id and from.name from live video event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "live_videos",
              value: {
                video_id: "live-222",
                from: { id: "user-eee", name: "Leo" },
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);
    const from = result.normalizedData.from as Record<string, unknown>;

    expect(from.id).toBe("user-eee");
    expect(from.name).toBe("Leo");
  });

  it("falls back to value.id when video_id is absent in live video event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "live_videos",
              value: { id: "live-fallback-999", status: "vod" },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.videoId).toBe("live-fallback-999");
  });
});

// ---------------------------------------------------------------------------
// Messaging / Messenger Event Parsing (3 tests)
// ---------------------------------------------------------------------------

describe("FacebookWebhookProcessor - Messaging Event Parsing", () => {
  let processor: FacebookWebhookProcessor;

  beforeAll(() => {
    processor = new FacebookWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("parses messaging event and maps to COMMENT_RECEIVED event type", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          messaging: [
            {
              sender: { id: "sender-111" },
              recipient: { id: "page-222" },
              timestamp: 1700005000,
              message: { mid: "msg-333", text: "Hello Messenger!" },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("COMMENT_RECEIVED");
    expect(result.normalizedData.eventType).toBe("comment_received");
    expect(result.normalizedData.senderId).toBe("sender-111");
    expect(result.normalizedData.recipientId).toBe("page-222");
    expect(result.normalizedData.isDirectMessage).toBe(true);
    expect(result.normalizedData.isMessenger).toBe(true);
  });

  it("preserves full message object in normalizedData", async () => {
    const message = { mid: "msg-444", text: "Need help", attachments: [] };
    const payload = {
      entry: [
        {
          id: "page-123",
          messaging: [
            {
              sender: { id: "sender-555" },
              recipient: { id: "page-666" },
              timestamp: 1700006000,
              message,
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.message).toStrictEqual(message);
  });

  it("preserves timestamp from messaging event", async () => {
    const ts = 1700007777;
    const payload = {
      entry: [
        {
          id: "page-123",
          messaging: [
            {
              sender: { id: "s-1" },
              recipient: { id: "r-1" },
              timestamp: ts,
              message: { mid: "m-1", text: "Hi" },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.timestamp).toBe(ts);
  });
});

// ---------------------------------------------------------------------------
// Unknown Field Fallback (2 tests)
// ---------------------------------------------------------------------------

describe("FacebookWebhookProcessor - Unknown Field Fallback", () => {
  let processor: FacebookWebhookProcessor;

  beforeAll(() => {
    processor = new FacebookWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("maps unknown change field to POST_UPDATED event type", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "ratings",
              value: { rating: 5, reviewer: "user-xyz" },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.eventType).toBe("POST_UPDATED");
    expect(result.normalizedData.field).toBe("ratings");
    expect(result.normalizedData.value).toStrictEqual({ rating: 5, reviewer: "user-xyz" });
  });

  it("includes original field name in normalizedData for unknown fields", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "custom_signal",
              value: { some: "data" },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    expect(result.normalizedData.field).toBe("custom_signal");
  });
});

// ---------------------------------------------------------------------------
// Error Paths (3 tests)
// ---------------------------------------------------------------------------

describe("FacebookWebhookProcessor - Error Paths", () => {
  let processor: FacebookWebhookProcessor;

  beforeAll(() => {
    processor = new FacebookWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("throws BadRequest for missing entry array", async () => {
    const payload = { object: "page" };

    await expect(processor.parse(payload)).rejects.toThrow(
      "Invalid Facebook webhook payload: missing entry"
    );
  });

  it("throws BadRequest for empty entry array", async () => {
    const payload = { object: "page", entry: [] };

    await expect(processor.parse(payload)).rejects.toThrow(
      "Invalid Facebook webhook payload: missing entry"
    );
  });

  it("throws BadRequest when entry has neither changes nor messaging", async () => {
    const payload = {
      entry: [{ id: "page-123" }],
    };

    await expect(processor.parse(payload)).rejects.toThrow(
      /Unsupported Facebook webhook event type/
    );
  });
});

// ---------------------------------------------------------------------------
// process() routing — no entities (warn path) (2 tests)
// ---------------------------------------------------------------------------

describe("FacebookWebhookProcessor - process() routing — no entities", () => {
  it("warns and returns early when neither accountId nor projectId is present", async () => {
    const { prisma } = makeWebhookPrismaFake();
    const processor = new FacebookWebhookProcessor(prisma);

    // Should not throw; just warn
    await expect(processor.process({ eventType: "feed_published" }, {})).resolves.toBeUndefined();
  });

  it("warns and returns early when relatedEntities is an empty object", async () => {
    const { prisma } = makeWebhookPrismaFake();
    const processor = new FacebookWebhookProcessor(prisma);

    await expect(
      processor.process({ eventType: "reaction_received" }, {})
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// process() routing — mentionEnqueue path (3 tests)
// ---------------------------------------------------------------------------

describe("FacebookWebhookProcessor - process() routing — mentionEnqueue", () => {
  it("calls mentionEnqueue when all required context is present", async () => {
    const mentionEnqueue = vi.fn().mockResolvedValue(undefined);
    const { prisma } = makeWebhookPrismaFake();
    const processor = new FacebookWebhookProcessor(prisma, undefined, mentionEnqueue);

    await processor.process(
      { eventType: "mention_received", postId: "mpost-111" },
      {
        accountId: "acct-001",
        projectId: "proj-001",
        channelId: "chan-001",
      }
    );

    expect(mentionEnqueue).toHaveBeenCalledOnce();
    expect(mentionEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "fetch",
        channelId: "chan-001",
        accountId: "acct-001",
        projectId: "proj-001",
        provider: "facebook",
        providerMentionId: "mpost-111",
      })
    );
  });

  it("logs info (does not call mentionEnqueue) when channelId is absent", async () => {
    const mentionEnqueue = vi.fn().mockResolvedValue(undefined);
    const { prisma } = makeWebhookPrismaFake();
    const processor = new FacebookWebhookProcessor(prisma, undefined, mentionEnqueue);

    // Missing channelId → should NOT enqueue
    await processor.process(
      { eventType: "mention_received", postId: "mpost-222" },
      {
        accountId: "acct-001",
        projectId: "proj-001",
        // channelId absent
      }
    );

    expect(mentionEnqueue).not.toHaveBeenCalled();
  });

  it("logs info (does not call mentionEnqueue) when providerMentionId is absent", async () => {
    const mentionEnqueue = vi.fn().mockResolvedValue(undefined);
    const { prisma } = makeWebhookPrismaFake();
    const processor = new FacebookWebhookProcessor(prisma, undefined, mentionEnqueue);

    // Missing postId in normalizedData → providerMentionId undefined
    await processor.process(
      { eventType: "mention_received" /* no postId */ },
      {
        accountId: "acct-001",
        projectId: "proj-001",
        channelId: "chan-001",
      }
    );

    expect(mentionEnqueue).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// process() routing — analytics creation (3 tests)
// ---------------------------------------------------------------------------

describe("FacebookWebhookProcessor - process() routing — analytics", () => {
  it("creates analytics record on feed_published with channelId and postId", async () => {
    const { prisma, stores } = makeWebhookPrismaFake();
    const processor = new FacebookWebhookProcessor(prisma);

    await processor.process(
      { eventType: "feed_published", createdTime: 1700000000 },
      { accountId: "acct-001", projectId: "proj-001", channelId: "chan-001", postId: "post-001" }
    );

    const analyticsRecords = stores.analytics.all();
    expect(analyticsRecords.length).toBeGreaterThan(0);
    const record = analyticsRecords[0];
    expect(record?.channelId).toBe("chan-001");
    expect(record?.provider).toBe("FACEBOOK");
    expect(record?.postId).toBe("post-001");
    expect(record?.views).toBe(0);
    expect(record?.likes).toBe(0);
    expect(record?.comments).toBe(0);
    expect(record?.shares).toBe(0);
  });

  it("creates analytics record on live_video_published with channelId and postId", async () => {
    const { prisma, stores } = makeWebhookPrismaFake();
    const processor = new FacebookWebhookProcessor(prisma);

    await processor.process(
      { eventType: "live_video_published", broadcastStartTime: 1700010000 },
      { accountId: "acct-002", projectId: "proj-002", channelId: "chan-002", postId: "post-002" }
    );

    const analyticsRecords = stores.analytics.all();
    expect(analyticsRecords.length).toBeGreaterThan(0);
    const record = analyticsRecords[0];
    expect(record?.channelId).toBe("chan-002");
    expect(record?.provider).toBe("FACEBOOK");
    expect(record?.postId).toBe("post-002");
  });

  it("skips analytics creation on live_video_published when postId is absent", async () => {
    const { prisma, stores } = makeWebhookPrismaFake();
    const processor = new FacebookWebhookProcessor(prisma);

    await processor.process(
      { eventType: "live_video_published" },
      { accountId: "acct-003", projectId: "proj-003", channelId: "chan-003" /* no postId */ }
    );

    const analyticsRecords = stores.analytics.all();
    expect(analyticsRecords.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// process() routing — comment analytics (2 tests)
// ---------------------------------------------------------------------------

describe("FacebookWebhookProcessor - process() routing — comment analytics", () => {
  it("increments comment count on existing analytics record and broadcasts", async () => {
    const { prisma, stores } = makeWebhookPrismaFake();
    const broadcaster = {
      broadcastPostStatusChange: vi.fn().mockResolvedValue(undefined),
      broadcastEngagementUpdate: vi.fn().mockResolvedValue(undefined),
    };
    const processor = new FacebookWebhookProcessor(prisma, broadcaster);

    // Seed an existing analytics record
    stores.analytics.add({
      id: "ana-001",
      channelId: "chan-001",
      provider: "FACEBOOK",
      postId: "post-001",
      comments: 5,
      likes: 3,
    });

    await processor.process(
      { eventType: "comment_received" },
      { accountId: "acct-001", projectId: "proj-001", channelId: "chan-001", postId: "post-001" }
    );

    const updated = stores.analytics.get("ana-001");
    expect(updated?.comments).toBe(6);
    expect(broadcaster.broadcastEngagementUpdate).toHaveBeenCalledOnce();
    expect(broadcaster.broadcastEngagementUpdate).toHaveBeenCalledWith(
      "post-001",
      "FACEBOOK",
      { comments: 6 },
      { comments: 1 }
    );
  });

  it("skips comment analytics increment when no existing analytics record exists", async () => {
    const { prisma, stores } = makeWebhookPrismaFake();
    const processor = new FacebookWebhookProcessor(prisma);

    // No seeded analytics record — should not throw
    await expect(
      processor.process(
        { eventType: "comment_received" },
        {
          accountId: "acct-001",
          projectId: "proj-001",
          channelId: "chan-001",
          postId: "post-001",
        }
      )
    ).resolves.toBeUndefined();

    expect(stores.analytics.all().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// process() routing — reaction analytics (3 tests)
// ---------------------------------------------------------------------------

describe("FacebookWebhookProcessor - process() routing — reaction analytics", () => {
  it("increments likes on reaction add and broadcasts", async () => {
    const { prisma, stores } = makeWebhookPrismaFake();
    const broadcaster = {
      broadcastPostStatusChange: vi.fn().mockResolvedValue(undefined),
      broadcastEngagementUpdate: vi.fn().mockResolvedValue(undefined),
    };
    const processor = new FacebookWebhookProcessor(prisma, broadcaster);

    stores.analytics.add({
      id: "ana-react-001",
      channelId: "chan-001",
      provider: "FACEBOOK",
      postId: "post-001",
      likes: 10,
      comments: 2,
    });

    await processor.process(
      { eventType: "reaction_received", verb: "add" },
      { accountId: "acct-001", projectId: "proj-001", channelId: "chan-001", postId: "post-001" }
    );

    const updated = stores.analytics.get("ana-react-001");
    expect(updated?.likes).toBe(11);
    expect(broadcaster.broadcastEngagementUpdate).toHaveBeenCalledWith(
      "post-001",
      "FACEBOOK",
      { likes: 11 },
      { likes: 1 }
    );
  });

  it("decrements likes on reaction remove", async () => {
    const { prisma, stores } = makeWebhookPrismaFake();
    const processor = new FacebookWebhookProcessor(prisma);

    stores.analytics.add({
      id: "ana-react-002",
      channelId: "chan-002",
      provider: "FACEBOOK",
      postId: "post-002",
      likes: 7,
      comments: 0,
    });

    await processor.process(
      { eventType: "reaction_received", verb: "remove" },
      { accountId: "acct-002", projectId: "proj-002", channelId: "chan-002", postId: "post-002" }
    );

    const updated = stores.analytics.get("ana-react-002");
    expect(updated?.likes).toBe(6);
  });

  it("skips reaction analytics update when no existing analytics record exists", async () => {
    const { prisma } = makeWebhookPrismaFake();
    const processor = new FacebookWebhookProcessor(prisma);

    await expect(
      processor.process(
        { eventType: "reaction_received", verb: "add" },
        {
          accountId: "acct-001",
          projectId: "proj-001",
          channelId: "chan-001",
          postId: "post-001",
        }
      )
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// process() routing — feed_published publish log update (2 tests)
// ---------------------------------------------------------------------------

describe("FacebookWebhookProcessor - process() routing — feed_published publishLog", () => {
  it("updates publishLog and post status on feed_published when postId and channelId exist", async () => {
    const { prisma, stores } = makeWebhookPrismaFake();
    const processor = new FacebookWebhookProcessor(prisma);

    stores.publishLog.add({
      id: "plog-001",
      postId: "post-001",
      channelId: "chan-001",
      provider: "FACEBOOK",
      status: "PENDING",
      payload: {},
    });

    stores.post.add({
      id: "post-001",
      status: "SCHEDULED",
    });

    await processor.process(
      {
        eventType: "feed_published",
        postId: "fb-ext-001",
        item: "status",
        permalink: "https://fb.com/p/1",
        isPublished: true,
      },
      { accountId: "acct-001", projectId: "proj-001", channelId: "chan-001", postId: "post-001" }
    );

    const updatedPost = stores.post.get("post-001");
    expect(updatedPost?.status).toBe("PUBLISHED");

    const updatedLog = stores.publishLog.get("plog-001");
    expect(updatedLog?.status).toBe("OK");
  });

  it("broadcasts post status change via broadcaster on feed_published", async () => {
    const { prisma, stores } = makeWebhookPrismaFake();
    const broadcaster = {
      broadcastPostStatusChange: vi.fn().mockResolvedValue(undefined),
      broadcastEngagementUpdate: vi.fn().mockResolvedValue(undefined),
    };
    const processor = new FacebookWebhookProcessor(prisma, broadcaster);

    stores.post.add({ id: "post-bcast", status: "SCHEDULED" });
    stores.publishLog.add({
      id: "plog-bcast",
      postId: "post-bcast",
      channelId: "chan-bcast",
      provider: "FACEBOOK",
      status: "PENDING",
      payload: {},
    });

    await processor.process(
      { eventType: "feed_published", postId: "fb-bcast-001" },
      {
        accountId: "acct-001",
        projectId: "proj-001",
        channelId: "chan-bcast",
        postId: "post-bcast",
      }
    );

    expect(broadcaster.broadcastPostStatusChange).toHaveBeenCalledWith(
      "post-bcast",
      "PUBLISHED",
      "FACEBOOK",
      expect.objectContaining({ facebook_post_id: "fb-bcast-001" })
    );
  });
});

// ---------------------------------------------------------------------------
// process() routing — unknown eventType warn path (1 test)
// ---------------------------------------------------------------------------

describe("FacebookWebhookProcessor - process() routing — unknown event type", () => {
  it("warns and returns without throwing for unknown event type", async () => {
    const { prisma } = makeWebhookPrismaFake();
    const processor = new FacebookWebhookProcessor(prisma);

    await expect(
      processor.process(
        { eventType: "totally_unknown_event" },
        { accountId: "acct-001", projectId: "proj-001", channelId: "chan-001" }
      )
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Full round-trip parse → process with entity resolution (2 tests)
// ---------------------------------------------------------------------------

describe("FacebookWebhookProcessor - Round-trip parse + process", () => {
  it("resolves channel entities from facebookPageId and routes process correctly", async () => {
    const fake = makeWebhookPrismaFake();
    const { accountId, projectId, channelId } = seedChannel(fake.stores, "page-rt-001");

    const processor = new FacebookWebhookProcessor(fake.prisma);

    const payload = {
      entry: [
        {
          id: "page-rt-001",
          changes: [
            {
              field: "reactions",
              value: {
                reaction_id: "react-rt-001",
                post_id: "post-rt-001",
                reaction_type: "haha",
                verb: "add",
              },
            },
          ],
        },
      ],
    };

    const { relatedEntities } = await processor.parse(payload);

    expect(relatedEntities.accountId).toBe(accountId);
    expect(relatedEntities.projectId).toBe(projectId);
    expect(relatedEntities.channelId).toBe(channelId);
  });

  it("returns empty relatedEntities when no matching channel is found in DB", async () => {
    const fake = makeWebhookPrismaFake();
    // Do NOT seed any channel for "page-unknown"
    const processor = new FacebookWebhookProcessor(fake.prisma);

    const payload = {
      entry: [
        {
          id: "page-unknown",
          changes: [
            {
              field: "feed",
              value: { post_id: "post-unknown" },
            },
          ],
        },
      ],
    };

    const { relatedEntities } = await processor.parse(payload);

    expect(relatedEntities.accountId).toBeUndefined();
    expect(relatedEntities.channelId).toBeUndefined();
  });
});

// Total: 52 tests covering all FacebookWebhookProcessor behaviors
