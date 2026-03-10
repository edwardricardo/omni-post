/**
 * @file TelegramAdapter.test.ts
 * @description Test suite for the Telegram provider adapter.
 *              Covers getProviderInfo, render, publish (text, photo, video,
 *              media group), validateCredentials, and error handling scenarios.
 *              All tests are Tier 0 (no network, no DB, no Redis).
 * @layer test
 */

import { describe, it, beforeEach, mock } from "node:test";
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
    validateCredentials: mock.fn(async () => ({
      id: 123456789,
      is_bot: true,
      first_name: "TestBot",
      username: "test_bot",
    })),
    getChatMember: mock.fn(async (_botUserId: number) => ({
      status: "administrator" as const,
      user: {
        id: 123456789,
        is_bot: true,
        first_name: "TestBot",
        username: "test_bot",
      },
    })),
    sendMessage: mock.fn(async (_text: string) => ({
      message_id: 42,
      chat: { id: -1001234567890, title: "Test Channel", type: "channel" },
      date: MOCK_DATE_UNIX,
      text: _text,
    })),
    sendPhoto: mock.fn(async (_photoUrl: string, _caption?: string) => ({
      message_id: 43,
      chat: { id: -1001234567890, title: "Test Channel", type: "channel" },
      date: MOCK_DATE_UNIX,
    })),
    sendVideo: mock.fn(async (_videoUrl: string, _caption?: string) => ({
      message_id: 44,
      chat: { id: -1001234567890, title: "Test Channel", type: "channel" },
      date: MOCK_DATE_UNIX,
    })),
    sendMediaGroup: mock.fn(
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
    getCircuitBreakerStatus: mock.fn(() => ({})),
    clearCache: mock.fn(() => undefined),
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
    validateCredentials: mock.fn(async () => {
      throw makeError();
    }),
    getChatMember: mock.fn(async () => {
      throw makeError();
    }),
    sendMessage: mock.fn(async () => {
      throw makeError();
    }),
    sendPhoto: mock.fn(async () => {
      throw makeError();
    }),
    sendVideo: mock.fn(async () => {
      throw makeError();
    }),
    sendMediaGroup: mock.fn(async () => {
      throw makeError();
    }),
    getCircuitBreakerStatus: mock.fn(() => ({})),
    clearCache: mock.fn(() => undefined),
  };
}

// ============================================================================
// 1. Provider Info / Metadata Tests (5 tests)
// ============================================================================

describe("TelegramAdapter - getProviderInfo / metadata", { concurrency: 1 }, () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
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
    assert.strictEqual(adapter.capabilities.analytics, false);
    assert.strictEqual(adapter.capabilities.threading, false);
    assert.strictEqual(adapter.capabilities.media, true);
  });
});

// ============================================================================
// 2. Render Tests (7 tests)
// ============================================================================

describe("TelegramAdapter - render()", { concurrency: 1 }, () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
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
    adapter = new TelegramAdapter();
  });

  it("publishes a text message successfully via sendMessage", async () => {
    const mockClient = createMockApiClient();
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => mockClient);

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
    mock.method(adapter as any, "getCredentials", async () =>
      ok({ botToken: "token", chatId: "@mychannel" })
    );
    mock.method(adapter as any, "createApiClient", () => mockClient);

    const input = createTestPublishInput({ body: "Public channel" });
    const result = await adapter.publish(input);

    assert.ok(result.ok);
    assert.strictEqual(result.value.url, "https://t.me/mychannel/42");
  });

  it("builds correct URL for numeric chat ID (supergroup)", async () => {
    const mockClient = createMockApiClient();
    mock.method(adapter as any, "getCredentials", async () =>
      ok({ botToken: "token", chatId: "-1001234567890" })
    );
    mock.method(adapter as any, "createApiClient", () => mockClient);

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
    adapter = new TelegramAdapter();
  });

  it("publishes single image via sendPhoto", async () => {
    const mockClient = createMockApiClient();
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => mockClient);

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
    assert.strictEqual(photoCall.arguments[0], "https://example.com/photo.jpg");
    assert.strictEqual(photoCall.arguments[1], "Photo caption");
  });

  it("publishes single video via sendVideo", async () => {
    const mockClient = createMockApiClient();
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => mockClient);

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
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => mockClient);

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
    const mediaItems = mediaGroupCall.arguments[0];
    assert.strictEqual(mediaItems.length, 2);
    assert.strictEqual(mediaGroupCall.arguments[1], "Group caption");
  });

  it("converts gif media type to image when sending media group", async () => {
    const mockClient = createMockApiClient();
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => mockClient);

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
    const mediaItems = mediaGroupCall.arguments[0] as Array<{
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
    adapter = new TelegramAdapter();
  });

  it("returns AUTH error when credentials fail", async () => {
    mock.method(adapter as any, "getCredentials", async () => ({
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
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => failingClient);

    const input = createTestPublishInput({ body: "Circuit breaker test" });
    const result = await adapter.publish(input);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "NETWORK");
  });

  it("maps 429 status to RATE_LIMIT error", async () => {
    const failingClient = createFailingApiClient("Too Many Requests", 429);
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => failingClient);

    const input = createTestPublishInput({ body: "Rate limited" });
    const result = await adapter.publish(input);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "RATE_LIMIT");
  });

  it("maps 401 status to AUTH error", async () => {
    const failingClient = createFailingApiClient("Unauthorized", 401);
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => failingClient);

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
    adapter = new TelegramAdapter();
  });

  it("returns ok with valid bot token and admin status", async () => {
    const mockClient = createMockApiClient();
    mock.method(adapter as any, "createApiClient", () => mockClient);

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
    assert.strictEqual(getChatMemberCall.arguments[0], 123456789, "Should pass bot user ID");
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
    mockClient.getChatMember = mock.fn(async () => ({
      status: "member" as const,
      user: {
        id: 123456789,
        is_bot: true,
        first_name: "TestBot",
        username: "test_bot",
      },
    }));
    mock.method(adapter as any, "createApiClient", () => mockClient);

    const result = await adapter.validateCredentials(MOCK_CREDENTIALS);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "AUTH_INVALID");
  });

  it("returns AUTH_EXPIRED when API returns 401", async () => {
    const failingClient = createFailingApiClient("Unauthorized", 401);
    mock.method(adapter as any, "createApiClient", () => failingClient);

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
