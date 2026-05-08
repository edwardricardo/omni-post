/**
 * @file TelegramAdapter.test.ts
 * @description Test suite for the Telegram provider adapter. Covers metadata,
 *              render (text + media + polls), publish (text, photo, video,
 *              media group, polls), validateCredentials, fetchAnalytics, and
 *              error handling. All tests are Tier 0: the adapter is constructed
 *              with an injected fake apiClientFactory so no network or DB.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { TelegramAdapter, type TelegramApiClientFactory } from "../src/TelegramAdapter.js";
import { ok } from "@shared/types";
import type { CanonicalPost, RenderedPost } from "@shared/types";
import type { PublishInput } from "@ports/core";
import type { TelegramApiClient, TelegramCredentials } from "../src/apiClient.js";

// ============================================================================
// Credential Fixtures
// ============================================================================

const VALID_CREDS: TelegramCredentials = {
  botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
  chatId: "@testchannel",
};

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
    sendPoll: vi.fn(async (_question: string, _options: string[]) => ({
      message_id: 50,
      chat: { id: -1001234567890, title: "Test Channel", type: "channel" },
      date: MOCK_DATE_UNIX,
    })),
    getChatMemberCount: vi.fn(async () => 100),
    getCircuitBreakerStatus: vi.fn(() => ({})),
    clearCache: vi.fn(() => undefined),
  };
}

type MockClient = ReturnType<typeof createMockApiClient>;

function createFailingApiClient(errorMessage = "API error", statusCode?: number): MockClient {
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
    sendPoll: vi.fn(async () => {
      throw makeError();
    }),
    getChatMemberCount: vi.fn(async () => {
      throw makeError();
    }),
    getCircuitBreakerStatus: vi.fn(() => ({})),
    clearCache: vi.fn(() => undefined),
  } as unknown as MockClient;
}

function makeAdapter(client: MockClient = createMockApiClient()) {
  const factory: TelegramApiClientFactory = () => client as unknown as TelegramApiClient;
  return { adapter: new TelegramAdapter({ apiClientFactory: factory }), client };
}

// ============================================================================
// 1. Provider Info / Metadata Tests
// ============================================================================

describe("TelegramAdapter - getProviderInfo / metadata", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns correct provider id", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.id, "telegram");
  });

  it("returns correct metadata with display name and color", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.metadata.id, "telegram");
    assert.strictEqual(adapter.metadata.displayName, "Telegram");
    assert.strictEqual(adapter.metadata.color, "#26A5E4");
    assert.strictEqual(adapter.metadata.status, "active");
    assert.strictEqual(adapter.metadata.authType, "api_key");
  });

  it("returns correct character limit of 4096", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.limits.maxChars, 4096);
  });

  it("returns correct media constraints", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.limits.maxMediaPerPost, 10);
    assert.deepStrictEqual(adapter.limits.allowedMedia, ["image", "video"]);
    assert.strictEqual(adapter.limits.threadingSupported, false);
  });

  it("reports correct capabilities", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.capabilities.publish, true);
    assert.strictEqual(adapter.capabilities.schedule, false);
    assert.strictEqual(adapter.capabilities.analytics, true);
    assert.strictEqual(adapter.capabilities.threading, false);
    assert.strictEqual(adapter.capabilities.comments, false);
    assert.strictEqual(adapter.capabilities.replies, false);
  });

  it("has correct metadata description", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(
      adapter.metadata.description,
      "Send messages to Telegram channels and groups via bot"
    );
  });

  it("has correct metadata website", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.metadata.website, "https://telegram.org");
  });

  it("has correct rateLimitHints", () => {
    const { adapter } = makeAdapter();
    assert.deepStrictEqual(adapter.limits.rateLimitHints, { burst: 30, perSeconds: 1 });
  });

  it("has empty aspect ratios", () => {
    const { adapter } = makeAdapter();
    assert.deepStrictEqual(adapter.limits.aspectRatios, []);
  });
});

// ============================================================================
// 2. Render Tests
// ============================================================================

describe("TelegramAdapter - render()", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns correct RenderedContent for text-only content", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({ body: "Hello Telegram!" });
    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed");
    assert.strictEqual(result.value.type, "single");

    const content = result.value.content as RenderedPost;
    assert.strictEqual(content.body, "Hello Telegram!");
    assert.strictEqual(content.meta?.parseMode, "HTML");
  });

  it("returns correct RenderedContent for content with single image", () => {
    const { adapter } = makeAdapter();
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
    const { adapter } = makeAdapter();
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
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({ body: "X".repeat(4097) });
    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "CONTENT_TOO_LONG");
  });

  it("returns CONTENT_TOO_LONG for media caption exceeding 1024 chars", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({
      body: "X".repeat(1025),
      media: [{ id: "m1", type: "image", url: "https://example.com/photo.jpg" }],
    });

    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "CONTENT_TOO_LONG");
  });

  it("returns VALIDATION_ERROR when media count exceeds 10", () => {
    const { adapter } = makeAdapter();
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
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({ body: "" });
    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed with empty body");
    const content = result.value.content as RenderedPost;
    assert.strictEqual(content.body, "");
  });
});

// ============================================================================
// 3. Threading Tests
// ============================================================================

describe("TelegramAdapter - threading (not supported)", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("planThread returns THREAD_PLANNING_FAILED error", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost();
    const result = adapter.planThread(post);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "THREAD_PLANNING_FAILED");
  });

  it("publishThread returns THREAD_INTERRUPTED error", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.publishThread(
      {
        channelId: "channel-tg-123",
        threadPlan: {
          strategy: "AUTO",
          tweets: [],
          totalChars: 0,
          estimatedReach: 0,
          needsThreading: false,
        },
        dedupeKey: "thread-dedupe-1",
      },
      VALID_CREDS
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "THREAD_INTERRUPTED");
  });
});

// ============================================================================
// 4. Publish Text Message Tests
// ============================================================================

describe("TelegramAdapter - publish() text messages", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes a text message successfully via sendMessage", async () => {
    const { adapter, client } = makeAdapter();
    const input = createTestPublishInput({ body: "Hello Telegram!" });
    const result = await adapter.publish(input, VALID_CREDS);

    assert.ok(result.ok, "Publish should succeed");
    assert.strictEqual(result.value.providerPostId, "42");
    assert.ok(result.value.url?.includes("testchannel"), "URL should contain channel name");
    assert.ok(result.value.publishedAt instanceof Date, "publishedAt should be a Date");
    assert.strictEqual(client.sendMessage.mock.calls.length, 1);
    assert.strictEqual(client.sendPhoto.mock.calls.length, 0);
  });

  it("builds correct URL for public channel with @ prefix", async () => {
    const { adapter } = makeAdapter();
    const input = createTestPublishInput({ body: "Public channel" });
    const result = await adapter.publish(input, { botToken: "token", chatId: "@mychannel" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.url, "https://t.me/mychannel/42");
  });

  it("builds correct URL for numeric chat ID (supergroup)", async () => {
    const { adapter } = makeAdapter();
    const input = createTestPublishInput({ body: "Supergroup" });
    const result = await adapter.publish(input, { botToken: "token", chatId: "-1001234567890" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.url, "https://t.me/c/1234567890/42");
  });
});

// ============================================================================
// 5. Publish Media Tests
// ============================================================================

describe("TelegramAdapter - publish() with media", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes single image via sendPhoto", async () => {
    const { adapter, client } = makeAdapter();
    const input = createTestPublishInput({
      body: "Photo caption",
      media: [{ url: "https://example.com/photo.jpg", type: "image" }],
    });

    const result = await adapter.publish(input, VALID_CREDS);

    assert.ok(result.ok, "Publish should succeed");
    assert.strictEqual(result.value.providerPostId, "43");
    assert.strictEqual(client.sendPhoto.mock.calls.length, 1);
    assert.strictEqual(client.sendMessage.mock.calls.length, 0);

    const photoCall = client.sendPhoto.mock.calls[0];
    assert.ok(photoCall);
    assert.strictEqual(photoCall[0], "https://example.com/photo.jpg");
    assert.strictEqual(photoCall[1], "Photo caption");
  });

  it("publishes single video via sendVideo", async () => {
    const { adapter, client } = makeAdapter();
    const input = createTestPublishInput({
      body: "Video caption",
      media: [{ url: "https://example.com/video.mp4", type: "video" }],
    });

    const result = await adapter.publish(input, VALID_CREDS);

    assert.ok(result.ok, "Publish should succeed");
    assert.strictEqual(result.value.providerPostId, "44");
    assert.strictEqual(client.sendVideo.mock.calls.length, 1);
  });

  it("publishes multiple media via sendMediaGroup", async () => {
    const { adapter, client } = makeAdapter();
    const input = createTestPublishInput({
      body: "Group caption",
      media: [
        { url: "https://example.com/1.jpg", type: "image" },
        { url: "https://example.com/2.jpg", type: "image" },
      ],
    });

    const result = await adapter.publish(input, VALID_CREDS);

    assert.ok(result.ok, "Publish should succeed");
    assert.strictEqual(result.value.providerPostId, "45");
    assert.strictEqual(client.sendMediaGroup.mock.calls.length, 1);

    const mediaGroupCall = client.sendMediaGroup.mock.calls[0];
    assert.ok(mediaGroupCall);
    const mediaItems = mediaGroupCall[0];
    assert.strictEqual(mediaItems.length, 2);
    assert.strictEqual(mediaGroupCall[1], "Group caption");
  });

  it("converts gif media type to image when sending media group", async () => {
    const { adapter, client } = makeAdapter();
    const input = createTestPublishInput({
      body: "With gifs",
      media: [
        { url: "https://example.com/1.gif", type: "gif" },
        { url: "https://example.com/2.jpg", type: "image" },
      ],
    });

    const result = await adapter.publish(input, VALID_CREDS);

    assert.ok(result.ok, "Publish should succeed");
    const mediaGroupCall = client.sendMediaGroup.mock.calls[0];
    assert.ok(mediaGroupCall);
    const mediaItems = mediaGroupCall[0] as Array<{ type: string; url: string }>;
    assert.strictEqual(mediaItems[0]?.type, "image");
  });
});

// ============================================================================
// 6. Publish Error Handling Tests
// ============================================================================

describe("TelegramAdapter - publish() error handling", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns AUTH error when credentials are missing required fields", async () => {
    const { adapter } = makeAdapter();
    const input = createTestPublishInput();
    const result = await adapter.publish(input, { botToken: "abc" });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "AUTH");
  });

  it("returns AUTH error when credentials are null", async () => {
    const { adapter } = makeAdapter();
    const input = createTestPublishInput();
    const result = await adapter.publish(input, null);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "AUTH");
  });

  it("returns NETWORK error when circuit breaker is OPEN", async () => {
    const failingClient = createFailingApiClient("Circuit breaker is OPEN");
    const { adapter } = makeAdapter(failingClient);

    const input = createTestPublishInput({ body: "Circuit breaker test" });
    const result = await adapter.publish(input, VALID_CREDS);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "NETWORK");
  });

  it("maps 429 status to RATE_LIMIT error", async () => {
    const failingClient = createFailingApiClient("Too Many Requests", 429);
    const { adapter } = makeAdapter(failingClient);

    const input = createTestPublishInput({ body: "Rate limited" });
    const result = await adapter.publish(input, VALID_CREDS);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "RATE_LIMIT");
  });

  it("maps 401 status to AUTH error", async () => {
    const failingClient = createFailingApiClient("Unauthorized", 401);
    const { adapter } = makeAdapter(failingClient);

    const input = createTestPublishInput({ body: "Unauthorized" });
    const result = await adapter.publish(input, VALID_CREDS);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "AUTH");
  });
});

// ============================================================================
// 7. Validate Credentials Tests
// ============================================================================

describe("TelegramAdapter - validateCredentials()", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok with valid bot token and admin status", async () => {
    const { adapter, client } = makeAdapter();

    const result = await adapter.validateCredentials(VALID_CREDS);

    assert.ok(result.ok, "Validation should succeed");
    assert.strictEqual(client.validateCredentials.mock.calls.length, 1);
    assert.strictEqual(client.getChatMember.mock.calls.length, 1);

    const getChatMemberCall = client.getChatMember.mock.calls[0];
    assert.ok(getChatMemberCall);
    assert.strictEqual(getChatMemberCall[0], 123456789);
  });

  it("returns AUTH_INVALID when required fields are missing", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.validateCredentials({ botToken: "some-token" });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "AUTH_INVALID");
  });

  it("returns AUTH_INVALID when credentials object is null", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.validateCredentials(null);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "AUTH_INVALID");
  });

  it("returns AUTH_INVALID when bot is not admin of the chat", async () => {
    const client = createMockApiClient();
    client.getChatMember = vi.fn(async () => ({
      status: "member" as const,
      user: { id: 123456789, is_bot: true, first_name: "TestBot", username: "test_bot" },
    }));
    const { adapter } = makeAdapter(client);

    const result = await adapter.validateCredentials(VALID_CREDS);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "AUTH_INVALID");
  });

  it("returns AUTH_EXPIRED when API returns 401", async () => {
    const failingClient = createFailingApiClient("Unauthorized", 401);
    const { adapter } = makeAdapter(failingClient);

    const result = await adapter.validateCredentials(VALID_CREDS);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "AUTH_EXPIRED");
  });

  it("validates credentials with creator status as admin", async () => {
    const client = createMockApiClient();
    client.getChatMember = vi.fn(async () => ({
      status: "creator" as const,
      user: { id: 123456789, is_bot: true, first_name: "TestBot", username: "test_bot" },
    }));
    const { adapter } = makeAdapter(client);

    const result = await adapter.validateCredentials(VALID_CREDS);
    assert.ok(result.ok, "Creator status should be treated as admin");
  });
});

// ============================================================================
// 8. Poll Rendering Tests
// ============================================================================

describe("TelegramAdapter - render() polls", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a poll from tags with poll: prefix", () => {
    const { adapter } = makeAdapter();
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
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({
      body: "Question?",
      tags: ["poll:OnlyOne"],
    });
    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "VALIDATION_ERROR");
  });

  it("returns VALIDATION_ERROR for poll with more than 10 options", () => {
    const { adapter } = makeAdapter();
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
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({
      body: "Yes or no?",
      tags: ["poll:Yes|No"],
    });
    const result = adapter.render(post);
    assert.ok(result.ok);
  });

  it("accepts poll with exactly 10 options", () => {
    const { adapter } = makeAdapter();
    const options = Array.from({ length: 10 }, (_, i) => `Opt${i}`).join("|");
    const post = createTestCanonicalPost({
      body: "Pick one",
      tags: [`poll:${options}`],
    });
    const result = adapter.render(post);
    assert.ok(result.ok);
  });

  it("returns VALIDATION_ERROR for poll with empty question", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({
      body: "",
      tags: ["poll:A|B"],
    });
    const result = adapter.render(post);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "VALIDATION_ERROR");
  });

  it("returns CONTENT_TOO_LONG for poll question > 300 chars", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({
      body: "Q".repeat(301),
      tags: ["poll:A|B"],
    });
    const result = adapter.render(post);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "CONTENT_TOO_LONG");
  });

  it("accepts poll question of exactly 300 chars", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({
      body: "Q".repeat(300),
      tags: ["poll:A|B"],
    });
    const result = adapter.render(post);
    assert.ok(result.ok);
  });

  it("filters empty options from poll", () => {
    const { adapter } = makeAdapter();
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
// 9. Publish Poll Tests
// ============================================================================

describe("TelegramAdapter - publish() polls", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes a poll via sendPoll when meta.isPoll is true", async () => {
    const { adapter, client } = makeAdapter();
    const input = createTestPublishInput({
      body: "What color?",
      meta: { isPoll: true, pollOptions: ["Red", "Blue", "Green"] },
    });

    const result = await adapter.publish(input, VALID_CREDS);
    assert.ok(result.ok);
    assert.strictEqual(result.value.providerPostId, "50");
    assert.strictEqual(client.sendPoll.mock.calls.length, 1);
    assert.strictEqual(client.sendPoll.mock.calls[0]?.[0], "What color?");
    assert.deepStrictEqual(client.sendPoll.mock.calls[0]?.[1], ["Red", "Blue", "Green"]);
  });
});

// ============================================================================
// 10. Analytics Tests
// ============================================================================

describe("TelegramAdapter - fetchAnalytics()", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns member count analytics", async () => {
    const client = createMockApiClient();
    client.getChatMemberCount = vi.fn(async () => 5000);
    const { adapter } = makeAdapter(client);

    const result = await adapter.fetchAnalytics({ channelId: "ch-1" }, VALID_CREDS);
    assert.ok(result.ok);
    const data = result.value as { memberCount: number; provider: string; channelId: string };
    assert.strictEqual(data.memberCount, 5000);
    assert.strictEqual(data.provider, "telegram");
    assert.strictEqual(data.channelId, "ch-1");
  });

  it("includes since and until when provided", async () => {
    const { adapter } = makeAdapter();
    const since = new Date("2025-01-01");
    const until = new Date("2025-01-31");
    const result = await adapter.fetchAnalytics({ channelId: "ch-1", since, until }, VALID_CREDS);

    assert.ok(result.ok);
    const data = result.value as { since?: string; until?: string };
    assert.strictEqual(data.since, since.toISOString());
    assert.strictEqual(data.until, until.toISOString());
  });

  it("omits since and until when not provided", async () => {
    const { adapter } = makeAdapter();

    const result = await adapter.fetchAnalytics({ channelId: "ch-1" }, VALID_CREDS);
    assert.ok(result.ok);
    const data = result.value as Record<string, unknown>;
    assert.strictEqual(Object.prototype.hasOwnProperty.call(data, "since"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(data, "until"), false);
  });

  it("returns AUTH error when credentials fail validation", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.fetchAnalytics({ channelId: "ch-1" }, { botToken: "abc" });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "AUTH");
  });

  it("returns NETWORK error when API call fails", async () => {
    const client = createMockApiClient();
    client.getChatMemberCount = vi.fn(async () => {
      throw new Error("API error");
    });
    const { adapter } = makeAdapter(client);

    const result = await adapter.fetchAnalytics({ channelId: "ch-1" }, VALID_CREDS);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "NETWORK");
  });
});

// ============================================================================
// 11. Caption Truncation and Edge Cases
// ============================================================================

describe("TelegramAdapter - publish() edge cases", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("truncates caption to 1024 chars for single media", async () => {
    const { adapter, client } = makeAdapter();

    const longCaption = "C".repeat(2000);
    const input = createTestPublishInput({
      body: longCaption,
      media: [{ url: "https://example.com/photo.jpg", type: "image" }],
    });

    await adapter.publish(input, VALID_CREDS);
    const photoCall = client.sendPhoto.mock.calls[0];
    assert.ok(photoCall);
    assert.strictEqual(photoCall[1]?.length, 1024);
  });

  it("truncates caption to 1024 chars for media group", async () => {
    const { adapter, client } = makeAdapter();

    const longCaption = "D".repeat(2000);
    const input = createTestPublishInput({
      body: longCaption,
      media: [
        { url: "https://example.com/1.jpg", type: "image" },
        { url: "https://example.com/2.jpg", type: "image" },
      ],
    });

    await adapter.publish(input, VALID_CREDS);
    const groupCall = client.sendMediaGroup.mock.calls[0];
    assert.ok(groupCall);
    assert.strictEqual(groupCall[1]?.length, 1024);
  });

  it("passes undefined caption when body is empty for single media", async () => {
    const { adapter, client } = makeAdapter();

    const input = createTestPublishInput({
      body: "",
      media: [{ url: "https://example.com/photo.jpg", type: "image" }],
    });

    await adapter.publish(input, VALID_CREDS);
    const photoCall = client.sendPhoto.mock.calls[0];
    assert.ok(photoCall);
    assert.strictEqual(photoCall[1], undefined);
  });

  it("returns NETWORK when sendMediaGroup returns empty array", async () => {
    const client = createMockApiClient();
    client.sendMediaGroup = vi.fn(async () => []);
    const { adapter } = makeAdapter(client);

    const input = createTestPublishInput({
      body: "Group",
      media: [
        { url: "https://example.com/1.jpg", type: "image" },
        { url: "https://example.com/2.jpg", type: "image" },
      ],
    });

    const result = await adapter.publish(input, VALID_CREDS);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "NETWORK");
  });

  it("converts message date from unix timestamp to Date", async () => {
    const { adapter } = makeAdapter();

    const input = createTestPublishInput({ body: "Date test" });
    const result = await adapter.publish(input, VALID_CREDS);
    assert.ok(result.ok);
    assert.strictEqual(result.value.publishedAt.getTime(), MOCK_DATE_UNIX * 1000);
  });
});

// ============================================================================
// 12. Render Edge Cases
// ============================================================================

describe("TelegramAdapter - render() edge cases", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts text of exactly 4096 chars", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({ body: "X".repeat(4096) });
    const result = adapter.render(post);
    assert.ok(result.ok);
  });

  it("accepts media caption of exactly 1024 chars", () => {
    const { adapter } = makeAdapter();
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
    const { adapter } = makeAdapter();
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
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({ body: "test" });
    const result = adapter.render(post);
    assert.ok(result.ok);
    const content = result.value.content as RenderedPost;
    assert.strictEqual(content.meta?.parseMode, "HTML");
  });

  it("does not include captionLength in meta for text-only messages", () => {
    const { adapter } = makeAdapter();
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
    const { adapter } = makeAdapter();
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
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({ body: undefined as unknown as string });
    const result = adapter.render(post);
    assert.ok(result.ok);
    const content = result.value.content as RenderedPost;
    assert.strictEqual(content.body, "");
  });
});

// ============================================================================
// 13. Helpers Sanity (renderedPost types)
// ============================================================================

// Confirms `ok` import is used to silence unused-import warnings should the
// test suite trim above lines.
void ok;
