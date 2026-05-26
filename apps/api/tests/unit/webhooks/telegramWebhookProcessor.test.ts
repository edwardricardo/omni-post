/**
 * @file telegramWebhookProcessor.test.ts
 * @description Unit tests for TelegramWebhookProcessor — Telegram Bot API Update
 *              handling with secret token verification (no HMAC) and event parsing
 *              for messages, channel posts, edited messages, and callback queries.
 * @layer infrastructure
 */

import { describe, it, beforeAll, expect } from "vitest";
import assert from "node:assert/strict";
import { TelegramWebhookProcessor } from "../../../src/webhooks/processors/telegramWebhookProcessor.js";
import { makeWebhookPrismaFake } from "../helpers/webhookPrismaFake.js";

// ===========================
// Signature Verification Tests (6 tests)
// ===========================

describe("TelegramWebhookProcessor - Signature Verification", () => {
  let processor: TelegramWebhookProcessor;
  const testSecret = "test-telegram-bot-secret-token";

  beforeAll(() => {
    processor = new TelegramWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("should verify valid secret token from X-Telegram-Bot-Api-Secret-Token header", () => {
    const payload = JSON.stringify({ update_id: 1 });
    const headers = { "x-telegram-bot-api-secret-token": testSecret };

    const isValid = processor.verify(payload, "", testSecret, headers);
    expect(isValid).toBe(true);
  });

  it("should verify with case-sensitive header key variant", () => {
    const payload = JSON.stringify({ update_id: 1 });
    const headers = { "X-Telegram-Bot-Api-Secret-Token": testSecret };

    const isValid = processor.verify(payload, "", testSecret, headers);
    expect(isValid).toBe(true);
  });

  it("should fall back to signature param when header is absent", () => {
    const payload = JSON.stringify({ update_id: 1 });

    const isValid = processor.verify(payload, testSecret, testSecret);
    expect(isValid).toBe(true);
  });

  it("should reject invalid secret token", () => {
    const payload = JSON.stringify({ update_id: 1 });
    const headers = { "x-telegram-bot-api-secret-token": "wrong-token" };

    const isValid = processor.verify(payload, "", testSecret, headers);
    expect(isValid).toBe(false);
  });

  it("should reject when no token provided at all", () => {
    const payload = JSON.stringify({ update_id: 1 });

    const isValid = processor.verify(payload, "", testSecret, {});
    expect(isValid).toBe(false);
  });

  it("should reject when secret is empty", () => {
    const payload = JSON.stringify({ update_id: 1 });
    const headers = { "x-telegram-bot-api-secret-token": "some-token" };

    const isValid = processor.verify(payload, "", "", headers);
    expect(isValid).toBe(false);
  });
});

// ===========================
// Message Event Parsing Tests (3 tests)
// ===========================

describe("TelegramWebhookProcessor - Message Event Parsing", () => {
  let processor: TelegramWebhookProcessor;

  beforeAll(() => {
    processor = new TelegramWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("should parse message event and map to POST_PUBLISHED", async () => {
    const payload = {
      update_id: 100001,
      message: {
        message_id: 42,
        from: { id: 12345, is_bot: false, first_name: "John", username: "john_doe" },
        chat: { id: -1001234567890, type: "supergroup", title: "Test Group" },
        date: 1718400000,
        text: "Hello world",
      },
    };

    const result = await processor.parse(payload as unknown as Record<string, unknown>);

    assert.strictEqual(result.eventType, "POST_PUBLISHED");
    assert.strictEqual(result.normalizedData.telegramEventType, "message");
    assert.strictEqual(result.normalizedData.messageId, 42);
    assert.strictEqual(result.normalizedData.chatId, -1001234567890);
    assert.strictEqual(result.normalizedData.chatType, "supergroup");
    assert.strictEqual(result.normalizedData.text, "Hello world");
    assert.strictEqual(result.normalizedData.fromId, 12345);
    assert.strictEqual(result.normalizedData.fromUsername, "john_doe");
  });

  it("should use caption when text is absent", async () => {
    const payload = {
      update_id: 100002,
      message: {
        message_id: 43,
        chat: { id: -100999, type: "group" },
        date: 1718400100,
        caption: "Photo caption text",
      },
    };

    const result = await processor.parse(payload as unknown as Record<string, unknown>);

    assert.strictEqual(result.eventType, "POST_PUBLISHED");
    assert.strictEqual(result.normalizedData.text, "Photo caption text");
  });

  it("should include chat title and username when present", async () => {
    const payload = {
      update_id: 100003,
      message: {
        message_id: 44,
        chat: { id: -100111, type: "channel", title: "My Channel", username: "my_channel" },
        date: 1718400200,
        text: "Channel message",
      },
    };

    const result = await processor.parse(payload as unknown as Record<string, unknown>);

    assert.strictEqual(result.normalizedData.chatTitle, "My Channel");
    assert.strictEqual(result.normalizedData.chatUsername, "my_channel");
  });
});

// ===========================
// Edited Message Event Parsing Tests (2 tests)
// ===========================

describe("TelegramWebhookProcessor - Edited Message Event Parsing", () => {
  let processor: TelegramWebhookProcessor;

  beforeAll(() => {
    processor = new TelegramWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("should parse edited_message event and map to POST_UPDATED", async () => {
    const payload = {
      update_id: 200001,
      edited_message: {
        message_id: 50,
        from: { id: 11111, is_bot: false, first_name: "Alice" },
        chat: { id: -200111, type: "group" },
        date: 1718401000,
        text: "Edited message content",
      },
    };

    const result = await processor.parse(payload as unknown as Record<string, unknown>);

    assert.strictEqual(result.eventType, "POST_UPDATED");
    assert.strictEqual(result.normalizedData.telegramEventType, "edited_message");
    assert.strictEqual(result.normalizedData.messageId, 50);
    assert.strictEqual(result.normalizedData.text, "Edited message content");
  });

  it("should include from info for edited messages", async () => {
    const payload = {
      update_id: 200002,
      edited_message: {
        message_id: 51,
        from: { id: 22222, is_bot: false, first_name: "Bob", username: "bob_user" },
        chat: { id: -200222, type: "group" },
        date: 1718401100,
        text: "Another edit",
      },
    };

    const result = await processor.parse(payload as unknown as Record<string, unknown>);

    assert.strictEqual(result.normalizedData.fromId, 22222);
    assert.strictEqual(result.normalizedData.fromUsername, "bob_user");
  });
});

// ===========================
// Channel Post Event Parsing Tests (2 tests)
// ===========================

describe("TelegramWebhookProcessor - Channel Post Event Parsing", () => {
  let processor: TelegramWebhookProcessor;

  beforeAll(() => {
    processor = new TelegramWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("should parse channel_post event and map to POST_PUBLISHED", async () => {
    const payload = {
      update_id: 300001,
      channel_post: {
        message_id: 60,
        chat: { id: -300111, type: "channel", title: "News Channel" },
        date: 1718402000,
        text: "Breaking news post",
      },
    };

    const result = await processor.parse(payload as unknown as Record<string, unknown>);

    assert.strictEqual(result.eventType, "POST_PUBLISHED");
    assert.strictEqual(result.normalizedData.telegramEventType, "channel_post");
    assert.strictEqual(result.normalizedData.messageId, 60);
    assert.strictEqual(result.normalizedData.text, "Breaking news post");
    assert.strictEqual(result.normalizedData.chatTitle, "News Channel");
  });

  it("should parse edited_channel_post event and map to POST_UPDATED", async () => {
    const payload = {
      update_id: 300002,
      edited_channel_post: {
        message_id: 61,
        chat: { id: -300222, type: "channel", title: "Updates Channel" },
        date: 1718402100,
        text: "Corrected channel post",
      },
    };

    const result = await processor.parse(payload as unknown as Record<string, unknown>);

    assert.strictEqual(result.eventType, "POST_UPDATED");
    assert.strictEqual(result.normalizedData.telegramEventType, "edited_channel_post");
    assert.strictEqual(result.normalizedData.messageId, 61);
  });
});

// ===========================
// Callback Query Event Parsing Tests (3 tests)
// ===========================

describe("TelegramWebhookProcessor - Callback Query Event Parsing", () => {
  let processor: TelegramWebhookProcessor;

  beforeAll(() => {
    processor = new TelegramWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("should parse callback_query event and map to POST_ENGAGEMENT_UPDATE", async () => {
    const payload = {
      update_id: 400001,
      callback_query: {
        id: "cb-001",
        from: { id: 33333, is_bot: false, first_name: "Charlie", username: "charlie_user" },
        message: {
          message_id: 70,
          chat: { id: -400111, type: "group" },
          date: 1718403000,
        },
        data: "button_action_1",
      },
    };

    const result = await processor.parse(payload as unknown as Record<string, unknown>);

    assert.strictEqual(result.eventType, "POST_ENGAGEMENT_UPDATE");
    assert.strictEqual(result.normalizedData.telegramEventType, "callback_query");
    assert.strictEqual(result.normalizedData.callbackId, "cb-001");
    assert.strictEqual(result.normalizedData.fromId, 33333);
    assert.strictEqual(result.normalizedData.fromUsername, "charlie_user");
    assert.strictEqual(result.normalizedData.callbackData, "button_action_1");
    assert.strictEqual(result.normalizedData.messageId, 70);
    assert.strictEqual(result.normalizedData.chatId, -400111);
  });

  it("should handle callback_query without message", async () => {
    const payload = {
      update_id: 400002,
      callback_query: {
        id: "cb-002",
        from: { id: 44444, is_bot: false, first_name: "Dana" },
        data: "inline_action",
      },
    };

    const result = await processor.parse(payload as unknown as Record<string, unknown>);

    assert.strictEqual(result.eventType, "POST_ENGAGEMENT_UPDATE");
    assert.strictEqual(result.normalizedData.callbackId, "cb-002");
    expect(result.normalizedData).not.toHaveProperty("messageId");
    expect(result.normalizedData).not.toHaveProperty("chatId");
  });

  it("should handle callback_query without data", async () => {
    const payload = {
      update_id: 400003,
      callback_query: {
        id: "cb-003",
        from: { id: 55555, is_bot: false, first_name: "Eve" },
      },
    };

    const result = await processor.parse(payload as unknown as Record<string, unknown>);

    assert.strictEqual(result.eventType, "POST_ENGAGEMENT_UPDATE");
    expect(result.normalizedData).not.toHaveProperty("callbackData");
  });
});

// ===========================
// Error Handling Tests (3 tests)
// ===========================

describe("TelegramWebhookProcessor - Error Handling", () => {
  let processor: TelegramWebhookProcessor;

  beforeAll(() => {
    processor = new TelegramWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("should throw error for missing update_id", async () => {
    const payload = { message: { message_id: 1, chat: { id: 1, type: "private" }, date: 1 } };

    await expect(processor.parse(payload as unknown as Record<string, unknown>)).rejects.toThrow(
      "Invalid Telegram webhook: missing update_id"
    );
  });

  it("should throw error for empty payload", async () => {
    const payload = {};

    await expect(processor.parse(payload as unknown as Record<string, unknown>)).rejects.toThrow(
      "Invalid Telegram webhook: missing update_id"
    );
  });

  it("should default to POST_ENGAGEMENT_UPDATE for unknown update type", async () => {
    const payload = {
      update_id: 999999,
      // No recognized fields (message, edited_message, channel_post, callback_query)
    };

    const result = await processor.parse(payload as unknown as Record<string, unknown>);

    assert.strictEqual(result.eventType, "POST_ENGAGEMENT_UPDATE");
    assert.strictEqual(result.normalizedData.telegramEventType, "unknown");
    assert.strictEqual(result.normalizedData.updateId, 999999);
  });
});

// ===========================
// Process Method Tests (1 test)
// ===========================

describe("TelegramWebhookProcessor - Process", () => {
  let processor: TelegramWebhookProcessor;

  beforeAll(() => {
    processor = new TelegramWebhookProcessor(makeWebhookPrismaFake().prisma);
  });

  it("should process known event types without throwing", async () => {
    const events = [
      { telegramEventType: "message", messageId: 1, chatId: -100 },
      { telegramEventType: "edited_message", messageId: 2, chatId: -200 },
      { telegramEventType: "channel_post", messageId: 3, chatId: -300 },
      { telegramEventType: "edited_channel_post", messageId: 4, chatId: -400 },
      { telegramEventType: "callback_query", callbackId: "cb-1", callbackData: "action" },
    ];

    for (const normalizedData of events) {
      await expect(
        processor.process(normalizedData, { postId: "post-1", channelId: "ch-1" })
      ).resolves.not.toThrow();
    }
  });
});

// Total: 20 tests covering Telegram webhook processor functionality
