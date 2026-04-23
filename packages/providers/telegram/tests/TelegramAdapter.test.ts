/**
 * @file TelegramAdapter.test.ts
 * @description Test suite for the Telegram provider adapter.
 *              Covers getProviderInfo, render, publish (text, photo, video,
 *              media group), validateCredentials, and error handling scenarios.
 *              All tests are Tier 0 (no network, no DB, no Redis).
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { TelegramAdapter } from "../src/TelegramAdapter.js";
import { ok } from "@shared/types";
import type { CanonicalPost, RenderedPost } from "@shared/types";
import type { PublishInput } from "@ports/core";

// ============================================================================
// Credential Fixtures
// ============================================================================

const MOCK_CREDENTIALS = {
  botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
  chatId: "@testchannel",
} as const;

// ============================================================================
// Factory Helpers
// ============================================================================

function createTestCanonicalPost(overrides: Partial<CanonicalPost> = {}): CanonicalPost {
  return {
    id: "post-tg-001",
    projectId: "project-test",
    locale: "en",
    body: "Test Telegram message",
    ...overrides,
  };
}

function createTestRenderedPost(overrides: Partial<RenderedPost> = {}): RenderedPost {
  return {
    body: "Test Telegram message",
    meta: {},
    ...overrides,
  };
}

function createTestPublishInput(postOverrides: Partial<RenderedPost> = {}): PublishInput {
  return {
    channelId: "channel-tg-123",
    post: createTestRenderedPost(postOverrides),
    dedupeKey: `dedupe-tg-${Date.now()}`,
  };
}

const MOCK_DATE_UNIX = 1705312800; // 2024-01-15T10:00:00Z

function createMockApiClient() {
  return {
    validateCredentials: vi.fn(async () => ({
      id: 123456789,
      is_bot: true,
      first_name: "TestBot",
      username: "test_bot",
    })),
    getChatMember: vi.fn(async (_botUserId: number) => ({
      status: "administrator" as const,
      user: {
        id: 123456789,
        is_bot: true,
        first_name: "TestBot",
        username: "test_bot",
      },
    })),
    sendMessage: vi.fn(async (_text: string) => ({
      message_id: 42,
      chat: { id: -1001234567890, title: "Test Channel", type: "channel" },
      date: MOCK_DATE_UNIX,
      text: _text,
    })),
    sendPhoto: vi.fn(async (_photoUrl: string, _caption?: string) => ({
      message_id: 43,
      chat: { id: -1001234567890, title: "Test Channel", type: "channel" },
      date: MOCK_DATE_UNIX,
    })),
    sendVideo: vi.fn(async (_videoUrl: string, _caption?: string) => ({
      message_id: 44,
      chat: { id: -1001234567890, title: "Test Channel", type: "channel" },
      date: MOCK_DATE_UNIX,
    })),
    sendMediaGroup: vi.fn(
      async (_mediaItems: Array<{ type: "image" | "video"; url: string }>, _caption?: string) => [
        {
          message_id: 45,
          chat: { id: -1001234567890, title: "Test Channel", type: "channel" },
          date: MOCK_DATE_UNIX,
        },
        {
          message_id: 46,
          chat: { id: -1001234567890, title: "Test Channel", type: "channel" },
          date: MOCK_DATE_UNIX,
        },
      ]
    ),
    getCircuitBreakerStatus: vi.fn(() => ({})),
    clearCache: vi.fn(() => undefined),
  };
}

function createFailingApiClient(errorMessage = "API error", statusCode?: number) {
  const makeError = () => {
    const error = new Error(errorMessage) as Error & { status?: number };
    if (statusCode !== undefined) {
      error.status = statusCode;
    }
    return error;
  };

  return {
    validateCredentials: vi.fn(async () => {
      throw makeError();
    }),
    getChatMember: vi.fn(async () => {
      throw makeError();
    }),
    sendMessage: vi.fn(async () => {
      throw makeError();
    }),
    sendPhoto: vi.fn(async () => {
      throw makeError();
    }),
    sendVideo: vi.fn(async () => {
      throw makeError();
    }),
    sendMediaGroup: vi.fn(async () => {
      throw makeError();
    }),
    getCircuitBreakerStatus: vi.fn(() => ({})),
    clearCache: vi.fn(() => undefined),
  };
}

// ============================================================================
// 1. Provider Info / Metadata Tests (5 tests)
// ============================================================================

describe("TelegramAdapter - getProviderInfo / metadata", { concurrency: 1 }, () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TelegramAdapter();
  });

  it("returns correct provider id", () => {
    assert.strictEqual(adapter.id, "telegram");
  });

  it("returns correct metadata with display name and color", () => {
    assert.strictEqual(adapter.metadata.id, "telegram");
    assert.strictEqual(adapter.metadata.displayName, "Telegram");
    assert.strictEqual(adapter.metadata.color, "#26A5E4");
    assert.strictEqual(adapter.metadata.status, "active");
    assert.strictEqual(adapter.metadata.authType, "api_key");
  });

  it("returns correct character limit of 4096", () => {
    assert.strictEqual(adapter.limits.maxChars, 4096);
  });

  it("returns correct media constraints", () => {
    assert.strictEqual(adapter.limits.maxMediaPerPost, 10);
    assert.deepStrictEqual(adapter.limits.allowedMedia, ["image", "video"]);
    assert.strictEqual(adapter.limits.threadingSupported, false);
  });

  it("reports correct capabilities", () => {
    assert.strictEqual(adapter.capabilities.publish, true);
    assert.strictEqual(adapter.capabilities.schedule, false);
    assert.strictEqual(adapter.capabilities.analytics, true);
    assert.strictEqual(adapter.capabilities.threading, false);
    assert.strictEqual(adapter.capabilities.media, true);
    assert.strictEqual(adapter.capabilities.images, true);
    assert.strictEqual(adapter.capabilities.videos, true);
    assert.strictEqual(adapter.capabilities.comments, false);
    assert.strictEqual(adapter.capabilities.replies, false);
  });

  it("has correct metadata description", () => {
    assert.strictEqual(
      adapter.metadata.description,
      "Send messages to Telegram channels and groups via bot"
    );
  });

  it("has correct metadata website", () => {
    assert.strictEqual(adapter.metadata.website, "https://telegram.org");
  });

  it("has correct rateLimitHints", () => {
    assert.deepStrictEqual(adapter.limits.rateLimitHints, { burst: 30, perSeconds: 1 });
  });

  it("has empty aspect ratios", () => {
    assert.deepStrictEqual(adapter.limits.aspectRatios, []);
  });

  it("requires botToken and chatId credentials", () => {
    // @ts-expect-error — accessing protected field for testing
    const fields = adapter.requiredCredentialFields;
    assert.deepStrictEqual(fields, ["botToken", "chatId"]);
  });
});

// ============================================================================
// 2. Render Tests (7 tests)
// ============================================================================

describe("TelegramAdapter - render()", { concurrency: 1 }, () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TelegramAdapter();
  });

  it("returns correct RenderedContent for text-only content", () => {
    const post = createTestCanonicalPost({ body: "Hello Telegram!" });
    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed");
    assert.strictEqual(result.value.type, "single");

    const content = result.value.content as RenderedPost;
    assert.strictEqual(content.body, "Hello Telegram!");
    assert.strictEqual(content.meta?.parseMode, "HTML");
  });

  it("returns correct RenderedContent for content with single image", () => {
    const post = createTestCanonicalPost({
      body: "Photo caption",
      media: [
        {
          id: "media-001",
          type: "image",
          url: "https://example.com/photo.jpg",
          alt: "Test photo",
        },
      ],
    });

    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed");
    const content = result.value.content as RenderedPost;
    assert.strictEqual(content.body, "Photo caption");
    assert.ok(content.media, "Should have media array");
    assert.strictEqual(content.media?.length, 1);
    assert.strictEqual(content.media?.[0]?.url, "https://example.com/photo.jpg");
    assert.strictEqual(content.media?.[0]?.type, "image");
    assert.strictEqual(content.media?.[0]?.alt, "Test photo");
    assert.strictEqual(content.meta?.captionLength, 13);
  });

  it("returns correct RenderedContent for content with multiple media", () => {
    const post = createTestCanonicalPost({
      body: "Multi media",
      media: [
        { id: "m1", type: "image", url: "https://example.com/1.jpg" },
        { id: "m2", type: "video", url: "https://example.com/2.mp4" },
        { id: "m3", type: "image", url: "https://example.com/3.jpg" },
      ],
    });

    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed");
    const content = result.value.content as RenderedPost;
    assert.strictEqual(content.media?.length, 3);
  });

  it("returns CONTENT_TOO_LONG for text exceeding 4096 chars", () => {
    const post = createTestCanonicalPost({ body: "X".repeat(4097) });
    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "CONTENT_TOO_LONG");
  });

  it("returns CONTENT_TOO_LONG for media caption exceeding 1024 chars", () => {
    const post = createTestCanonicalPost({
      body: "X".repeat(1025),
      media: [{ id: "m1", type: "image", url: "https://example.com/photo.jpg" }],
    });

    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "CONTENT_TOO_LONG");
  });

  it("returns VALIDATION_ERROR when media count exceeds 10", () => {
    const media = Array.from({ length: 11 }, (_, i) => ({
      id: `m${i}`,
      type: "image" as const,
      url: `https://example.com/${i}.jpg`,
    }));

    const post = createTestCanonicalPost({ body: "Too many images", media });
    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "VALIDATION_ERROR");
  });

  it("handles empty body gracefully", () => {
    const post = createTestCanonicalPost({ body: "" });
    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed with empty body");
    const content = result.value.content as RenderedPost;
    assert.strictEqual(content.body, "");
  });
});

// ============================================================================
// 3. Threading Tests (2 tests)
// ============================================================================

describe("TelegramAdapter - threading (not supported)", { concurrency: 1 }, () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TelegramAdapter();
  });

  it("planThread returns THREAD_PLANNING_FAILED error", () => {
    const post = createTestCanonicalPost();
    const result = adapter.planThread(post);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "THREAD_PLANNING_FAILED");
  });

  it("publishThread returns THREAD_INTERRUPTED error", async () => {
    const result = await adapter.publishThread({
      channelId: "channel-tg-123",
      threadPlan: {
        strategy: "AUTO",
        tweets: [],
        totalChars: 0,
        estimatedReach: 0,
        needsThreading: false,
      },
      dedupeKey: "thread-dedupe-1",
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "THREAD_INTERRUPTED");
  });
});

// ============================================================================
// 4. Publish Text Message Tests (3 tests)
// ============================================================================

describe("TelegramAdapter - publish() text messages", { concurrency: 1 }, () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TelegramAdapter();
  });

  it("publishes a text message successfully via sendMessage", async () => {
    const mockClient = createMockApiClient();
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () => ok(MOCK_CREDENTIALS));
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => mockClient);

    const input = createTestPublishInput({ body: "Hello Telegram!" });
    const result = await adapter.publish(input);

    assert.ok(result.ok, "Publish should succeed");
    assert.strictEqual(result.value.providerPostId, "42");
    assert.ok(result.value.url?.includes("testchannel"), "URL should contain channel name");
    assert.ok(result.value.publishedAt instanceof Date, "publishedAt should be a Date");
    assert.strictEqual(
      mockClient.sendMessage.mock.calls.length,
      1,
      "sendMessage should be called once"
    );
    assert.strictEqual(mockClient.sendPhoto.mock.calls.length, 0, "sendPhoto should not be called");
  });

  it("builds correct URL for public channel with @ prefix", async () => {
    const mockClient = createMockApiClient();
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () =>
      ok({ botToken: "token", chatId: "@mychannel" })
    );
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => mockClient);

    const input = createTestPublishInput({ body: "Public channel" });
    const result = await adapter.publish(input);

    assert.ok(result.ok);
    assert.strictEqual(result.value.url, "https://t.me/mychannel/42");
  });

  it("builds correct URL for numeric chat ID (supergroup)", async () => {
    const mockClient = createMockApiClient();
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () =>
      ok({ botToken: "token", chatId: "-1001234567890" })
    );
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => mockClient);

    const input = createTestPublishInput({ body: "Supergroup" });
    const result = await adapter.publish(input);

    assert.ok(result.ok);
    assert.strictEqual(result.value.url, "https://t.me/c/1234567890/42");
  });
});

// ============================================================================
// 5. Publish Media Tests (4 tests)
// ============================================================================

describe("TelegramAdapter - publish() with media", { concurrency: 1 }, () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TelegramAdapter();
  });

  it("publishes single image via sendPhoto", async () => {
    const mockClient = createMockApiClient();
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () => ok(MOCK_CREDENTIALS));
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => mockClient);

    const input = createTestPublishInput({
      body: "Photo caption",
      media: [{ url: "https://example.com/photo.jpg", type: "image" }],
    });

    const result = await adapter.publish(input);

    assert.ok(result.ok, "Publish should succeed");
    assert.strictEqual(result.value.providerPostId, "43");
    assert.strictEqual(
      mockClient.sendPhoto.mock.calls.length,
      1,
      "sendPhoto should be called once"
    );
    assert.strictEqual(
      mockClient.sendMessage.mock.calls.length,
      0,
      "sendMessage should not be called"
    );

    const photoCall = mockClient.sendPhoto.mock.calls[0];
    assert.ok(photoCall);
    assert.strictEqual(photoCall[0], "https://example.com/photo.jpg");
    assert.strictEqual(photoCall[1], "Photo caption");
  });

  it("publishes single video via sendVideo", async () => {
    const mockClient = createMockApiClient();
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () => ok(MOCK_CREDENTIALS));
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => mockClient);

    const input = createTestPublishInput({
      body: "Video caption",
      media: [{ url: "https://example.com/video.mp4", type: "video" }],
    });

    const result = await adapter.publish(input);

    assert.ok(result.ok, "Publish should succeed");
    assert.strictEqual(result.value.providerPostId, "44");
    assert.strictEqual(
      mockClient.sendVideo.mock.calls.length,
      1,
      "sendVideo should be called once"
    );
  });

  it("publishes multiple media via sendMediaGroup", async () => {
    const mockClient = createMockApiClient();
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () => ok(MOCK_CREDENTIALS));
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => mockClient);

    const input = createTestPublishInput({
      body: "Group caption",
      media: [
        { url: "https://example.com/1.jpg", type: "image" },
        { url: "https://example.com/2.jpg", type: "image" },
      ],
    });

    const result = await adapter.publish(input);

    assert.ok(result.ok, "Publish should succeed");
    assert.strictEqual(result.value.providerPostId, "45");
    assert.strictEqual(
      mockClient.sendMediaGroup.mock.calls.length,
      1,
      "sendMediaGroup should be called once"
    );

    const mediaGroupCall = mockClient.sendMediaGroup.mock.calls[0];
    assert.ok(mediaGroupCall);
    const mediaItems = mediaGroupCall[0];
    assert.strictEqual(mediaItems.length, 2);
    assert.strictEqual(mediaGroupCall[1], "Group caption");
  });

  it("converts gif media type to image when sending media group", async () => {
    const mockClient = createMockApiClient();
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () => ok(MOCK_CREDENTIALS));
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => mockClient);

    const input = createTestPublishInput({
      body: "With gifs",
      media: [
        { url: "https://example.com/1.gif", type: "gif" },
        { url: "https://example.com/2.jpg", type: "image" },
      ],
    });

    const result = await adapter.publish(input);

    assert.ok(result.ok, "Publish should succeed");
    const mediaGroupCall = mockClient.sendMediaGroup.mock.calls[0];
    assert.ok(mediaGroupCall);
    const mediaItems = mediaGroupCall[0] as Array<{
      type: string;
      url: string;
    }>;
    assert.strictEqual(mediaItems[0]?.type, "image", "gif should be converted to image");
  });
});

// ============================================================================
// 6. Publish Error Handling Tests (4 tests)
// ============================================================================

describe("TelegramAdapter - publish() error handling", { concurrency: 1 }, () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TelegramAdapter();
  });

  it("returns AUTH error when credentials fail", async () => {
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () => ({
      ok: false,
      error: "AUTH",
    }));

    const input = createTestPublishInput();
    const result = await adapter.publish(input);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "AUTH");
  });

  it("returns NETWORK error when circuit breaker is OPEN", async () => {
    const failingClient = createFailingApiClient("Circuit breaker is OPEN");
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () => ok(MOCK_CREDENTIALS));
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => failingClient);

    const input = createTestPublishInput({ body: "Circuit breaker test" });
    const result = await adapter.publish(input);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "NETWORK");
  });

  it("maps 429 status to RATE_LIMIT error", async () => {
    const failingClient = createFailingApiClient("Too Many Requests", 429);
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () => ok(MOCK_CREDENTIALS));
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => failingClient);

    const input = createTestPublishInput({ body: "Rate limited" });
    const result = await adapter.publish(input);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "RATE_LIMIT");
  });

  it("maps 401 status to AUTH error", async () => {
    const failingClient = createFailingApiClient("Unauthorized", 401);
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () => ok(MOCK_CREDENTIALS));
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => failingClient);

    const input = createTestPublishInput({ body: "Unauthorized" });
    const result = await adapter.publish(input);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "AUTH");
  });
});

// ============================================================================
// 7. Validate Credentials Tests (4 tests)
// ============================================================================

describe("TelegramAdapter - validateCredentials()", { concurrency: 1 }, () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TelegramAdapter();
  });

  it("returns ok with valid bot token and admin status", async () => {
    const mockClient = createMockApiClient();
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => mockClient);

    const result = await adapter.validateCredentials(MOCK_CREDENTIALS);

    assert.ok(result.ok, "Validation should succeed");
    assert.strictEqual(
      mockClient.validateCredentials.mock.calls.length,
      1,
      "validateCredentials should be called"
    );
    assert.strictEqual(
      mockClient.getChatMember.mock.calls.length,
      1,
      "getChatMember should be called"
    );

    // Verify bot user ID was passed to getChatMember
    const getChatMemberCall = mockClient.getChatMember.mock.calls[0];
    assert.ok(getChatMemberCall);
    assert.strictEqual(getChatMemberCall[0], 123456789, "Should pass bot user ID");
  });

  it("returns AUTH_INVALID when required fields are missing", async () => {
    const result = await adapter.validateCredentials({
      botToken: "some-token",
      // missing chatId
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "AUTH_INVALID");
  });

  it("returns AUTH_INVALID when bot is not admin of the chat", async () => {
    const mockClient = createMockApiClient();
    mockClient.getChatMember = vi.fn(async () => ({
      status: "member" as const,
      user: {
        id: 123456789,
        is_bot: true,
        first_name: "TestBot",
        username: "test_bot",
      },
    }));
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => mockClient);

    const result = await adapter.validateCredentials(MOCK_CREDENTIALS);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "AUTH_INVALID");
  });

  it("returns AUTH_EXPIRED when API returns 401", async () => {
    const failingClient = createFailingApiClient("Unauthorized", 401);
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => failingClient);

    const result = await adapter.validateCredentials(MOCK_CREDENTIALS);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "AUTH_EXPIRED");
  });
});

// ============================================================================
// 8. Content Validation Tests (3 tests)
// ============================================================================

describe("TelegramAdapter - validateContent()", { concurrency: 1 }, () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TelegramAdapter();
  });

  it("returns valid for content within 4096 character limit", async () => {
    const post = createTestCanonicalPost({ body: "Short message" });
    const result = await adapter.validateContent(post);

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  it("returns error for content exceeding 4096 character limit", async () => {
    const post = createTestCanonicalPost({ body: "X".repeat(4097) });
    const result = await adapter.validateContent(post);

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0, "Should have validation errors");
    assert.ok(result.errors[0]?.message.includes("4096"), "Error should mention 4096 char limit");
  });

  it("returns error when media count exceeds 10", async () => {
    const media = Array.from({ length: 11 }, (_, i) => ({
      id: `m${i}`,
      type: "image" as const,
      url: `https://example.com/${i}.jpg`,
    }));

    const post = createTestCanonicalPost({ body: "Too many media", media });
    const result = await adapter.validateContent(post);

    assert.strictEqual(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.field === "media"),
      "Should have media validation error"
    );
  });
});

// ============================================================================
// 9. Poll Rendering Tests
// ============================================================================

describe("TelegramAdapter - render() polls", { concurrency: 1 }, () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TelegramAdapter();
  });

  it("renders a poll from tags with poll: prefix", () => {
    const post = createTestCanonicalPost({
      body: "What is your favorite color?",
      tags: ["poll:Red|Blue|Green"],
    });
    const result = adapter.render(post);

    assert.ok(result.ok);
    const content = result.value.content as RenderedPost;
    assert.strictEqual(content.body, "What is your favorite color?");
    assert.strictEqual(content.meta?.isPoll, true);
    assert.deepStrictEqual(content.meta?.pollOptions, ["Red", "Blue", "Green"]);
  });

  it("returns VALIDATION_ERROR for poll with fewer than 2 options", () => {
    const post = createTestCanonicalPost({
      body: "Question?",
      tags: ["poll:OnlyOne"],
    });
    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "VALIDATION_ERROR");
  });

  it("returns VALIDATION_ERROR for poll with more than 10 options", () => {
    const options = Array.from({ length: 11 }, (_, i) => `Option${i}`).join("|");
    const post = createTestCanonicalPost({
      body: "Question?",
      tags: [`poll:${options}`],
    });
    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "VALIDATION_ERROR");
  });

  it("accepts poll with exactly 2 options", () => {
    const post = createTestCanonicalPost({
      body: "Yes or no?",
      tags: ["poll:Yes|No"],
    });
    const result = adapter.render(post);
    assert.ok(result.ok);
  });

  it("accepts poll with exactly 10 options", () => {
    const options = Array.from({ length: 10 }, (_, i) => `Opt${i}`).join("|");
    const post = createTestCanonicalPost({
      body: "Pick one",
      tags: [`poll:${options}`],
    });
    const result = adapter.render(post);
    assert.ok(result.ok);
  });

  it("returns VALIDATION_ERROR for poll with empty question", () => {
    const post = createTestCanonicalPost({
      body: "",
      tags: ["poll:A|B"],
    });
    const result = adapter.render(post);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "VALIDATION_ERROR");
  });

  it("returns CONTENT_TOO_LONG for poll question > 300 chars", () => {
    const post = createTestCanonicalPost({
      body: "Q".repeat(301),
      tags: ["poll:A|B"],
    });
    const result = adapter.render(post);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "CONTENT_TOO_LONG");
  });

  it("accepts poll question of exactly 300 chars", () => {
    const post = createTestCanonicalPost({
      body: "Q".repeat(300),
      tags: ["poll:A|B"],
    });
    const result = adapter.render(post);
    assert.ok(result.ok);
  });

  it("filters empty options from poll", () => {
    const post = createTestCanonicalPost({
      body: "Question?",
      tags: ["poll:A||B| |C"],
    });
    const result = adapter.render(post);
    assert.ok(result.ok);
    const content = result.value.content as RenderedPost;
    assert.deepStrictEqual(content.meta?.pollOptions, ["A", "B", "C"]);
  });
});

// ============================================================================
// 10. Credentials from Environment Tests
// ============================================================================

describe("TelegramAdapter - getCredentialsFromEnvironment()", { concurrency: 1 }, () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TelegramAdapter();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  it("returns AUTH error when env vars are not set", () => {
    // @ts-expect-error — accessing protected method for testing
    const result = adapter.getCredentialsFromEnvironment();
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "AUTH");
  });

  it("returns AUTH error when only botToken is set", () => {
    process.env.TELEGRAM_BOT_TOKEN = "real-token";
    // @ts-expect-error — accessing protected method for testing
    const result = adapter.getCredentialsFromEnvironment();
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "AUTH");
  });

  it("returns AUTH error when only chatId is set", () => {
    process.env.TELEGRAM_CHAT_ID = "@realchat";
    // @ts-expect-error — accessing protected method for testing
    const result = adapter.getCredentialsFromEnvironment();
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "AUTH");
  });

  it("returns credentials when both env vars are set", () => {
    process.env.TELEGRAM_BOT_TOKEN = "123456:ABC-DEF";
    process.env.TELEGRAM_CHAT_ID = "@mychannel";

    // @ts-expect-error — accessing protected method for testing
    const result = adapter.getCredentialsFromEnvironment();
    assert.ok(result.ok);
    assert.strictEqual(result.value.botToken, "123456:ABC-DEF");
    assert.strictEqual(result.value.chatId, "@mychannel");
  });
});

// ============================================================================
// 11. Publish Poll Tests
// ============================================================================

describe("TelegramAdapter - publish() polls", { concurrency: 1 }, () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TelegramAdapter();
  });

  it("publishes a poll via sendPoll when meta.isPoll is true", async () => {
    const mockClient = {
      ...createMockApiClient(),
      sendPoll: vi.fn(async () => ({
        message_id: 50,
        chat: { id: -1001234567890, title: "Test Channel", type: "channel" },
        date: MOCK_DATE_UNIX,
      })),
    };
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () => ok(MOCK_CREDENTIALS));
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => mockClient);

    const input = createTestPublishInput({
      body: "What color?",
      meta: { isPoll: true, pollOptions: ["Red", "Blue", "Green"] },
    });

    const result = await adapter.publish(input);
    assert.ok(result.ok);
    assert.strictEqual(result.value.providerPostId, "50");
    assert.strictEqual(mockClient.sendPoll.mock.calls.length, 1);
    assert.strictEqual(mockClient.sendPoll.mock.calls[0]?.[0], "What color?");
    assert.deepStrictEqual(mockClient.sendPoll.mock.calls[0]?.[1], ["Red", "Blue", "Green"]);
  });
});

// ============================================================================
// 12. Analytics Tests
// ============================================================================

describe("TelegramAdapter - fetchAnalytics()", { concurrency: 1 }, () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TelegramAdapter();
  });

  it("returns member count analytics", async () => {
    const mockClient = {
      ...createMockApiClient(),
      getChatMemberCount: vi.fn(async () => 5000),
    };
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () => ok(MOCK_CREDENTIALS));
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => mockClient);

    const result = await adapter.fetchAnalytics!({ channelId: "ch-1" });
    assert.ok(result.ok);
    const data = result.value as { memberCount: number; provider: string; channelId: string };
    assert.strictEqual(data.memberCount, 5000);
    assert.strictEqual(data.provider, "telegram");
    assert.strictEqual(data.channelId, "ch-1");
  });

  it("includes since and until when provided", async () => {
    const mockClient = {
      ...createMockApiClient(),
      getChatMemberCount: vi.fn(async () => 100),
    };
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () => ok(MOCK_CREDENTIALS));
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => mockClient);

    const since = new Date("2025-01-01");
    const until = new Date("2025-01-31");
    const result = await adapter.fetchAnalytics!({ channelId: "ch-1", since, until });

    assert.ok(result.ok);
    const data = result.value as { since?: string; until?: string };
    assert.strictEqual(data.since, since.toISOString());
    assert.strictEqual(data.until, until.toISOString());
  });

  it("omits since and until when not provided", async () => {
    const mockClient = {
      ...createMockApiClient(),
      getChatMemberCount: vi.fn(async () => 100),
    };
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () => ok(MOCK_CREDENTIALS));
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => mockClient);

    const result = await adapter.fetchAnalytics!({ channelId: "ch-1" });
    assert.ok(result.ok);
    const data = result.value as Record<string, unknown>;
    assert.strictEqual(Object.prototype.hasOwnProperty.call(data, "since"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(data, "until"), false);
  });

  it("returns AUTH error when credentials fail", async () => {
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () => ({
      ok: false,
      error: "AUTH",
    }));

    const result = await adapter.fetchAnalytics!({ channelId: "ch-1" });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "AUTH");
  });

  it("returns NETWORK error when API call fails", async () => {
    const mockClient = {
      ...createMockApiClient(),
      getChatMemberCount: vi.fn(async () => {
        throw new Error("API error");
      }),
    };
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () => ok(MOCK_CREDENTIALS));
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => mockClient);

    const result = await adapter.fetchAnalytics!({ channelId: "ch-1" });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "NETWORK");
  });
});

// ============================================================================
// 13. Caption Truncation and Edge Cases
// ============================================================================

describe("TelegramAdapter - publish() edge cases", { concurrency: 1 }, () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TelegramAdapter();
  });

  it("truncates caption to 1024 chars for single media", async () => {
    const mockClient = createMockApiClient();
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () => ok(MOCK_CREDENTIALS));
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => mockClient);

    const longCaption = "C".repeat(2000);
    const input = createTestPublishInput({
      body: longCaption,
      media: [{ url: "https://example.com/photo.jpg", type: "image" }],
    });

    await adapter.publish(input);
    const photoCall = mockClient.sendPhoto.mock.calls[0];
    assert.ok(photoCall);
    assert.strictEqual(photoCall[1]?.length, 1024);
  });

  it("truncates caption to 1024 chars for media group", async () => {
    const mockClient = createMockApiClient();
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () => ok(MOCK_CREDENTIALS));
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => mockClient);

    const longCaption = "D".repeat(2000);
    const input = createTestPublishInput({
      body: longCaption,
      media: [
        { url: "https://example.com/1.jpg", type: "image" },
        { url: "https://example.com/2.jpg", type: "image" },
      ],
    });

    await adapter.publish(input);
    const groupCall = mockClient.sendMediaGroup.mock.calls[0];
    assert.ok(groupCall);
    assert.strictEqual(groupCall[1]?.length, 1024);
  });

  it("passes undefined caption when body is empty for single media", async () => {
    const mockClient = createMockApiClient();
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () => ok(MOCK_CREDENTIALS));
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => mockClient);

    const input = createTestPublishInput({
      body: "",
      media: [{ url: "https://example.com/photo.jpg", type: "image" }],
    });

    await adapter.publish(input);
    const photoCall = mockClient.sendPhoto.mock.calls[0];
    assert.ok(photoCall);
    assert.strictEqual(photoCall[1], undefined);
  });

  it("returns NETWORK when sendMediaGroup returns empty array", async () => {
    const mockClient = createMockApiClient();
    mockClient.sendMediaGroup = vi.fn(async () => []);
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () => ok(MOCK_CREDENTIALS));
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => mockClient);

    const input = createTestPublishInput({
      body: "Group",
      media: [
        { url: "https://example.com/1.jpg", type: "image" },
        { url: "https://example.com/2.jpg", type: "image" },
      ],
    });

    const result = await adapter.publish(input);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "NETWORK");
  });

  it("converts message date from unix timestamp to Date", async () => {
    const mockClient = createMockApiClient();
    vi.spyOn(adapter as any, "getCredentials").mockImplementation(async () => ok(MOCK_CREDENTIALS));
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => mockClient);

    const input = createTestPublishInput({ body: "Date test" });
    const result = await adapter.publish(input);
    assert.ok(result.ok);
    assert.strictEqual(result.value.publishedAt.getTime(), MOCK_DATE_UNIX * 1000);
  });

  it("validates credentials with creator status as admin", async () => {
    const mockClient = createMockApiClient();
    mockClient.getChatMember = vi.fn(async () => ({
      status: "creator" as const,
      user: { id: 123456789, is_bot: true, first_name: "TestBot", username: "test_bot" },
    }));
    vi.spyOn(adapter as any, "createApiClient").mockImplementation(() => mockClient);

    const result = await adapter.validateCredentials(MOCK_CREDENTIALS);
    assert.ok(result.ok, "Creator status should be treated as admin");
  });
});

// ============================================================================
// 14. Render Edge Cases
// ============================================================================

describe("TelegramAdapter - render() edge cases", { concurrency: 1 }, () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TelegramAdapter();
  });

  it("accepts text of exactly 4096 chars", () => {
    const post = createTestCanonicalPost({ body: "X".repeat(4096) });
    const result = adapter.render(post);
    assert.ok(result.ok);
  });

  it("accepts media caption of exactly 1024 chars", () => {
    const post = createTestCanonicalPost({
      body: "X".repeat(1024),
      media: [{ id: "m1", type: "image", url: "https://example.com/photo.jpg" }],
    });
    const result = adapter.render(post);
    assert.ok(result.ok);
    const content = result.value.content as RenderedPost;
    assert.strictEqual(content.meta?.captionLength, 1024);
  });

  it("omits alt from media when not provided", () => {
    const post = createTestCanonicalPost({
      body: "test",
      media: [{ id: "m1", type: "image", url: "https://example.com/photo.jpg" }],
    });
    const result = adapter.render(post);
    assert.ok(result.ok);
    const content = result.value.content as RenderedPost;
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(content.media?.[0] || {}, "alt"),
      false
    );
  });

  it("sets parseMode to HTML in meta", () => {
    const post = createTestCanonicalPost({ body: "test" });
    const result = adapter.render(post);
    assert.ok(result.ok);
    const content = result.value.content as RenderedPost;
    assert.strictEqual(content.meta?.parseMode, "HTML");
  });

  it("does not include captionLength in meta for text-only messages", () => {
    const post = createTestCanonicalPost({ body: "text only" });
    const result = adapter.render(post);
    assert.ok(result.ok);
    const content = result.value.content as RenderedPost;
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(content.meta || {}, "captionLength"),
      false
    );
  });

  it("handles exactly 10 media items (boundary)", () => {
    const media = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      type: "image" as const,
      url: `https://example.com/${i}.jpg`,
    }));
    const post = createTestCanonicalPost({ body: "10 items", media });
    const result = adapter.render(post);
    assert.ok(result.ok);
  });

  it("handles undefined body", () => {
    const post = createTestCanonicalPost({ body: undefined as unknown as string });
    const result = adapter.render(post);
    assert.ok(result.ok);
    const content = result.value.content as RenderedPost;
    assert.strictEqual(content.body, "");
  });
});
