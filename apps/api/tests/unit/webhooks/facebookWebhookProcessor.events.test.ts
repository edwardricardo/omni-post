/**
 * Unit Tests for FacebookWebhookProcessor — Comment, Reaction, Mention, Page,
 * Live Video, Messaging, Error Handling, and Unknown Event types
 *
 * RUN COMMAND:
 * pnpm --filter @apps/api exec node --import tsx --test tests/unit/webhooks/facebookWebhookProcessor.events.test.ts
 *
 * @module FacebookWebhookProcessorTests
 * @category UnitTests
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { FacebookWebhookProcessor } from "../../../src/webhooks/processors/facebookWebhookProcessor.js";

// ===========================
// Comment Event Parsing Tests (4 tests)
// ===========================

describe("FacebookWebhookProcessor - Comment Event Parsing", { concurrency: 1 }, () => {
  let processor: FacebookWebhookProcessor;

  before(() => {
    processor = new FacebookWebhookProcessor();
  });

  it("should parse comment received event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "comments",
              value: {
                comment_id: "comment-456",
                post_id: "post-789",
                message: "Great post!",
                from: {
                  id: "user-111",
                  name: "Jane Smith",
                },
                created_time: "2024-01-15T10:30:00Z",
                verb: "add",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "COMMENT_RECEIVED");
    assert.strictEqual(result.normalizedData.eventType, "comment_received");
    assert.strictEqual(result.normalizedData.commentId, "comment-456");
    assert.strictEqual(result.normalizedData.postId, "post-789");
    assert.strictEqual(result.normalizedData.text, "Great post!");
    assert.strictEqual(result.normalizedData.isReply, false);
  });

  it("should parse comment reply event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "comments",
              value: {
                comment_id: "reply-789",
                post_id: "post-456",
                parent_id: "comment-123",
                message: "Thanks for commenting!",
                from: {
                  id: "page-123",
                  name: "Page Owner",
                },
                created_time: "2024-01-15T11:00:00Z",
                verb: "add",
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

  it("should parse comment edited event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "comments",
              value: {
                comment_id: "comment-999",
                post_id: "post-111",
                message: "Edited comment text",
                from: {
                  id: "user-222",
                  name: "User Name",
                },
                created_time: "2024-01-15T12:00:00Z",
                verb: "edited",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.verb, "edited");
  });

  it("should parse comment removed event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "comments",
              value: {
                comment_id: "comment-888",
                post_id: "post-222",
                from: {
                  id: "user-333",
                  name: "Deleted User",
                },
                created_time: "2024-01-15T13:00:00Z",
                verb: "remove",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.verb, "remove");
  });
});

// ===========================
// Reaction Event Parsing Tests (5 tests)
// ===========================

describe("FacebookWebhookProcessor - Reaction Event Parsing", { concurrency: 1 }, () => {
  let processor: FacebookWebhookProcessor;

  before(() => {
    processor = new FacebookWebhookProcessor();
  });

  it("should parse like reaction event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "reactions",
              value: {
                reaction_id: "reaction-123",
                post_id: "post-456",
                reaction_type: "like",
                from: {
                  id: "user-789",
                  name: "Liker User",
                },
                created_time: "2024-01-15T14:00:00Z",
                verb: "add",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "LIKE_RECEIVED");
    assert.strictEqual(result.normalizedData.eventType, "reaction_received");
    assert.strictEqual(result.normalizedData.reactionType, "like");
    assert.strictEqual(result.normalizedData.verb, "add");
  });

  it("should parse love reaction event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "reactions",
              value: {
                reaction_id: "reaction-456",
                post_id: "post-789",
                reaction_type: "love",
                from: {
                  id: "user-111",
                  name: "Love User",
                },
                created_time: "2024-01-15T15:00:00Z",
                verb: "add",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.reactionType, "love");
  });

  it("should parse haha reaction event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "reactions",
              value: {
                reaction_id: "reaction-789",
                post_id: "post-111",
                reaction_type: "haha",
                from: {
                  id: "user-222",
                  name: "Funny User",
                },
                created_time: "2024-01-15T16:00:00Z",
                verb: "add",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.reactionType, "haha");
  });

  it("should parse wow, sad, and angry reactions", async () => {
    const reactionTypes = ["wow", "sad", "angry"];

    for (const reactionType of reactionTypes) {
      const payload = {
        entry: [
          {
            id: "page-123",
            changes: [
              {
                field: "reactions",
                value: {
                  reaction_id: `reaction-${reactionType}`,
                  post_id: "post-999",
                  reaction_type: reactionType,
                  from: {
                    id: "user-333",
                    name: "Test User",
                  },
                  created_time: "2024-01-15T17:00:00Z",
                  verb: "add",
                },
              },
            ],
          },
        ],
      };

      const result = await processor.parse(payload);

      assert.strictEqual(result.normalizedData.reactionType, reactionType);
    }
  });

  it("should parse reaction removal event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "reactions",
              value: {
                reaction_id: "reaction-remove",
                post_id: "post-888",
                reaction_type: "like",
                from: {
                  id: "user-444",
                  name: "Unlike User",
                },
                created_time: "2024-01-15T18:00:00Z",
                verb: "remove",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.verb, "remove");
  });
});

// ===========================
// Mention Event Parsing Tests (2 tests)
// ===========================

describe("FacebookWebhookProcessor - Mention Event Parsing", { concurrency: 1 }, () => {
  let processor: FacebookWebhookProcessor;

  before(() => {
    processor = new FacebookWebhookProcessor();
  });

  it("should parse mention event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "mentions",
              value: {
                post_id: "mention-post-123",
                message: "Check out @TestPage!",
                from: {
                  id: "user-456",
                  name: "Mentioning User",
                },
                created_time: "2024-01-15T19:00:00Z",
                permalink_url: "https://facebook.com/user/posts/mention-post-123",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "MENTION_RECEIVED");
    assert.strictEqual(result.normalizedData.eventType, "mention_received");
    assert.strictEqual(result.normalizedData.postId, "mention-post-123");
    assert.strictEqual(result.normalizedData.message, "Check out @TestPage!");
  });

  it("should extract mention author and permalink", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "mention",
              value: {
                post_id: "mention-456",
                message: "Tagged you!",
                from: {
                  id: "user-789",
                  name: "Tagger",
                },
                created_time: "2024-01-15T20:00:00Z",
                permalink_url: "https://facebook.com/permalink/123",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.from.id, "user-789");
    assert.strictEqual(result.normalizedData.from.name, "Tagger");
    assert.strictEqual(result.normalizedData.permalink, "https://facebook.com/permalink/123");
  });
});

// ===========================
// Page Event Parsing Tests (2 tests)
// ===========================

describe("FacebookWebhookProcessor - Page Event Parsing", { concurrency: 1 }, () => {
  let processor: FacebookWebhookProcessor;

  before(() => {
    processor = new FacebookWebhookProcessor();
  });

  it("should parse page updated event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "page",
              value: {
                page_id: "page-123",
                verb: "update",
                name: "Updated Page Name",
                category: "Entertainment",
                changes: {
                  name: "Updated Page Name",
                  description: "New description",
                },
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "ACCOUNT_CONNECTED");
    assert.strictEqual(result.normalizedData.eventType, "page_updated");
    assert.strictEqual(result.normalizedData.pageId, "page-123");
    assert.strictEqual(result.normalizedData.name, "Updated Page Name");
    assert.strictEqual(result.normalizedData.category, "Entertainment");
  });

  it("should parse page settings changes", async () => {
    const payload = {
      entry: [
        {
          id: "page-456",
          changes: [
            {
              field: "page",
              value: {
                page_id: "page-456",
                verb: "update",
                changes: {
                  privacy: "public",
                  messaging_enabled: true,
                },
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.deepStrictEqual(result.normalizedData.changes, {
      privacy: "public",
      messaging_enabled: true,
    });
  });
});

// ===========================
// Live Video Event Parsing Tests (3 tests)
// ===========================

describe("FacebookWebhookProcessor - Live Video Event Parsing", { concurrency: 1 }, () => {
  let processor: FacebookWebhookProcessor;

  before(() => {
    processor = new FacebookWebhookProcessor();
  });

  it("should parse live video published event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "live_videos",
              value: {
                video_id: "live-456",
                status: "live",
                broadcast_start_time: "2024-01-15T20:00:00Z",
                description: "Live streaming now!",
                permalink_url: "https://facebook.com/page/videos/live-456",
                from: {
                  id: "page-123",
                  name: "Test Page",
                },
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "POST_PUBLISHED");
    assert.strictEqual(result.normalizedData.eventType, "live_video_published");
    assert.strictEqual(result.normalizedData.videoId, "live-456");
    assert.strictEqual(result.normalizedData.status, "live");
  });

  it("should parse live video VOD status", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "live_videos",
              value: {
                video_id: "vod-789",
                status: "vod",
                broadcast_start_time: "2024-01-15T19:00:00Z",
                description: "Replay available",
                from: {
                  id: "page-123",
                  name: "Test Page",
                },
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.status, "vod");
  });

  it("should parse live video processing status", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "live_videos",
              value: {
                video_id: "processing-111",
                status: "processing",
                broadcast_start_time: "2024-01-15T21:00:00Z",
                from: {
                  id: "page-123",
                  name: "Test Page",
                },
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.normalizedData.status, "processing");
  });
});

// ===========================
// Messaging Event Parsing Tests (2 tests)
// ===========================

describe("FacebookWebhookProcessor - Messaging Event Parsing", { concurrency: 1 }, () => {
  let processor: FacebookWebhookProcessor;

  before(() => {
    processor = new FacebookWebhookProcessor();
  });

  it("should parse messenger message event", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          messaging: [
            {
              sender: { id: "user-456" },
              recipient: { id: "page-123" },
              timestamp: 1642248000000,
              message: {
                mid: "msg-789",
                text: "Hello via Messenger!",
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.strictEqual(result.eventType, "COMMENT_RECEIVED");
    assert.strictEqual(result.normalizedData.eventType, "comment_received");
    assert.strictEqual(result.normalizedData.senderId, "user-456");
    assert.strictEqual(result.normalizedData.recipientId, "page-123");
    assert.strictEqual(result.normalizedData.isDirectMessage, true);
    assert.strictEqual(result.normalizedData.isMessenger, true);
  });

  it("should extract message content from messenger event", async () => {
    const messageText = "Can you help me with my order?";
    const payload = {
      entry: [
        {
          id: "page-456",
          messaging: [
            {
              sender: { id: "user-789" },
              recipient: { id: "page-456" },
              timestamp: 1642248100000,
              message: {
                mid: "msg-111",
                text: messageText,
              },
            },
          ],
        },
      ],
    };

    const result = await processor.parse(payload);

    assert.deepStrictEqual(result.normalizedData.message, {
      mid: "msg-111",
      text: messageText,
    });
  });
});

// ===========================
// Error Handling Tests (3 tests)
// ===========================

describe("FacebookWebhookProcessor - Error Handling", { concurrency: 1 }, () => {
  let processor: FacebookWebhookProcessor;

  before(() => {
    processor = new FacebookWebhookProcessor();
  });

  it("should throw error for missing entry in payload", async () => {
    const payload = { object: "page" };

    await assert.rejects(
      async () => {
        await processor.parse(payload);
      },
      {
        message: "Invalid Facebook webhook payload: missing entry",
      }
    );
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
        message: /Unsupported Facebook webhook event type/,
      }
    );
  });

  it("should handle verification errors gracefully", () => {
    const processor = new FacebookWebhookProcessor();

    // This should return false instead of throwing
    const isValid = processor.verify("invalid\x00data", "signature", "secret");
    assert.strictEqual(isValid, false);
  });
});

// ===========================
// Unknown Event Handling Tests (1 test)
// ===========================

describe("FacebookWebhookProcessor - Unknown Event Handling", { concurrency: 1 }, () => {
  let processor: FacebookWebhookProcessor;

  before(() => {
    processor = new FacebookWebhookProcessor();
  });

  it("should default to POST_UPDATED for unknown field types", async () => {
    const payload = {
      entry: [
        {
          id: "page-123",
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
});
