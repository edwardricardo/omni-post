/**
 * @file PinterestAdapter.test.ts
 * @description Unit tests for PinterestAdapter covering metadata, render,
 *              publish, validateCredentials, fetchAnalytics, and error handling.
 *              Adapter is stateless w.r.t. credentials — tests inject a fake
 *              apiClientFactory and pass credentials per-call.
 *              All tests are Tier 0 (no network, no DB, no Redis).
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { PinterestAdapter, type PinterestApiClientFactory } from "../src/PinterestAdapter.js";
import type { PinterestApiClient, PinterestCredentials } from "../src/apiClient.js";
import type { CanonicalPost, RenderedPost } from "@shared/types";
import type { PublishInput } from "@ports/core";

// ============================================================================
// Test helpers
// ============================================================================

interface FakeApiClient {
  createPin: ReturnType<typeof vi.fn>;
  getUserAccount: ReturnType<typeof vi.fn>;
  getPinAnalytics: ReturnType<typeof vi.fn>;
}

function makeFakeApiClient(overrides: Partial<FakeApiClient> = {}): FakeApiClient {
  return {
    createPin: vi.fn(async () => ({
      id: "pin-12345",
      title: "Test Pin",
      description: "Test description",
      link: "",
      board_id: "board-001",
      created_at: "2024-06-01T12:00:00Z",
      media: { media_type: "image" as const },
    })),
    getUserAccount: vi.fn(async () => ({
      username: "testuser",
      account_type: "BUSINESS" as const,
      profile_image: "https://example.com/avatar.jpg",
      pin_count: 42,
      board_count: 5,
    })),
    getPinAnalytics: vi.fn(async () => ({
      all: {
        lifetime_metrics: {
          IMPRESSION: 1500,
          SAVE: 30,
          PIN_CLICK: 120,
          OUTBOUND_CLICK: 45,
        },
      },
    })),
    ...overrides,
  };
}

function makeAdapter(client: FakeApiClient = makeFakeApiClient()): {
  adapter: PinterestAdapter;
  client: FakeApiClient;
} {
  const factory: PinterestApiClientFactory = () => client as unknown as PinterestApiClient;
  const adapter = new PinterestAdapter({ apiClientFactory: factory });
  return { adapter, client };
}

const VALID_CREDS: PinterestCredentials = {
  accessToken: "test-token",
  refreshToken: "test-refresh",
  boardId: "board-001",
};

function makeCanonicalPost(overrides?: Partial<CanonicalPost>): CanonicalPost {
  return {
    id: "post-001",
    projectId: "project-001",
    locale: "en",
    body: "Test pin description",
    media: [
      {
        id: "media-001",
        type: "image" as const,
        url: "https://example.com/image.jpg",
        alt: "Alt text",
      },
    ],
    ...overrides,
  };
}

function makePublishInput(overrides?: Partial<PublishInput>): PublishInput {
  return {
    channelId: "channel-pinterest-001",
    post: {
      body: "Pin description",
      text: "Pin description",
      media: [{ url: "https://example.com/image.jpg", type: "image" as const }],
      meta: { title: "Pin Title" },
    },
    dedupeKey: "dedupe-001",
    ...overrides,
  };
}

// ============================================================================
// 1. Metadata Tests
// ============================================================================

describe("PinterestAdapter - Metadata", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns correct provider ID", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.id, "pinterest");
  });

  it("returns correct metadata fields", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.metadata.id, "pinterest");
    assert.strictEqual(adapter.metadata.name, "pinterest");
    assert.strictEqual(adapter.metadata.displayName, "Pinterest");
    assert.strictEqual(adapter.metadata.color, "#BD081C");
    assert.strictEqual(adapter.metadata.authType, "oauth");
    assert.strictEqual(adapter.metadata.status, "active");
    assert.strictEqual(adapter.metadata.website, "https://pinterest.com");
  });

  it("returns correct limits", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.limits.maxChars, 500);
    assert.strictEqual(adapter.limits.maxMediaPerPost, 1);
    assert.strictEqual(adapter.limits.threadingSupported, false);
    assert.deepStrictEqual(adapter.limits.allowedMedia, ["image", "video"]);
    assert.deepStrictEqual(adapter.limits.aspectRatios, ["1:1", "4:5", "3:2"]);
    assert.strictEqual(adapter.limits.maxVideoDuration, 900);
  });

  it("returns correct capabilities", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.capabilities.publish, true);
    assert.strictEqual(adapter.capabilities.schedule, true);
    assert.strictEqual(adapter.capabilities.analytics, true);
    assert.strictEqual(adapter.capabilities.comments, false);
    assert.strictEqual(adapter.capabilities.replies, false);
    assert.strictEqual(adapter.capabilities.threading, false);
  });

  it("has correct required scopes", () => {
    const { adapter } = makeAdapter();
    assert.deepStrictEqual(adapter.metadata.requiredScopes, [
      "boards:read",
      "boards:write",
      "pins:read",
      "pins:write",
      "user_accounts:read",
    ]);
  });

  it("has businessAccountRequired set to false", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.constraints.businessAccountRequired, false);
  });

  it("exports a factory function", async () => {
    const { createPinterestAdapter } = await import("../src/PinterestAdapter.js");
    const adapter = createPinterestAdapter();
    assert.ok(adapter instanceof PinterestAdapter);
    assert.strictEqual(adapter.id, "pinterest");
  });
});

// ============================================================================
// 2. Render Tests
// ============================================================================

describe("PinterestAdapter - Render", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns VALIDATION_ERROR when no media is provided", () => {
    const { adapter } = makeAdapter();
    const post = makeCanonicalPost({ media: [] });
    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    }
  });

  it("returns VALIDATION_ERROR when media is undefined", () => {
    const { adapter } = makeAdapter();
    const post = makeCanonicalPost({ media: undefined });
    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    }
  });

  it("returns UNSUPPORTED_MEDIA for gif media type", () => {
    const { adapter } = makeAdapter();
    const post = makeCanonicalPost({
      media: [{ id: "m1", type: "gif", url: "https://example.com/image.gif" }],
    });
    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "UNSUPPORTED_MEDIA");
    }
  });

  it("renders correctly for image media", () => {
    const { adapter } = makeAdapter();
    const post = makeCanonicalPost({
      body: "My pin title\nDetailed description of the pin",
      media: [
        {
          id: "m1",
          type: "image",
          url: "https://example.com/image.jpg",
          alt: "Alt text for image",
        },
      ],
    });

    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed");
    if (result.ok) {
      assert.strictEqual(result.value.type, "single");
      const content = result.value.content as RenderedPost;
      assert.ok(content.media, "Media should be present");
      assert.strictEqual(content.media?.length, 1);
      assert.strictEqual(content.media?.[0]?.url, "https://example.com/image.jpg");
      assert.strictEqual(content.media?.[0]?.type, "image");
      assert.strictEqual(content.media?.[0]?.alt, "Alt text for image");
      assert.strictEqual(content.meta?.title, "My pin title");
    }
  });

  it("renders correctly for video media", () => {
    const { adapter } = makeAdapter();
    const post = makeCanonicalPost({
      body: "Video pin",
      media: [{ id: "m1", type: "video", url: "https://example.com/video.mp4" }],
    });

    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed");
    if (result.ok) {
      assert.strictEqual(result.value.meta?.pinType, "video");
    }
  });

  it("extracts title from first line when short enough", () => {
    const { adapter } = makeAdapter();
    const post = makeCanonicalPost({
      body: "Short Title\nLonger description follows here",
      media: [{ id: "m1", type: "image", url: "https://example.com/image.jpg" }],
    });

    const result = adapter.render(post);

    assert.ok(result.ok);
    if (result.ok) {
      const content = result.value.content as RenderedPost;
      assert.strictEqual(content.meta?.title, "Short Title");
      assert.strictEqual(content.body, "Longer description follows here");
    }
  });

  it("truncates title when first line exceeds 100 chars", () => {
    const { adapter } = makeAdapter();
    const longFirstLine =
      "This is a very long first line that exceeds the maximum title length of one hundred characters and keeps going further";
    const post = makeCanonicalPost({
      body: longFirstLine,
      media: [{ id: "m1", type: "image", url: "https://example.com/image.jpg" }],
    });

    const result = adapter.render(post);

    assert.ok(result.ok);
    if (result.ok) {
      const content = result.value.content as RenderedPost;
      const title = content.meta?.title as string;
      assert.ok(title.length <= 100, `Title should be <= 100 chars, got ${title.length}`);
    }
  });

  it("sets altText in meta when media has alt", () => {
    const { adapter } = makeAdapter();
    const post = makeCanonicalPost({
      body: "Pin with alt text",
      media: [
        {
          id: "m1",
          type: "image",
          url: "https://example.com/image.jpg",
          alt: "Descriptive alt text",
        },
      ],
    });

    const result = adapter.render(post);

    assert.ok(result.ok);
    if (result.ok) {
      const content = result.value.content as RenderedPost;
      assert.strictEqual(content.meta?.altText, "Descriptive alt text");
    }
  });

  it("sets pinType to image for image media", () => {
    const { adapter } = makeAdapter();
    const post = makeCanonicalPost({
      body: "Image pin",
      media: [{ id: "m1", type: "image", url: "https://example.com/image.jpg" }],
    });

    const result = adapter.render(post);

    assert.ok(result.ok);
    if (result.ok) {
      assert.strictEqual(result.value.meta?.pinType, "image");
    }
  });
});

// ============================================================================
// 3. Publish Tests
// ============================================================================

describe("PinterestAdapter - Publish", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes image pin successfully and returns receipt", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.publish(makePublishInput(), VALID_CREDS);

    assert.ok(result.ok, "Publish should succeed");
    if (result.ok) {
      assert.strictEqual(result.value.providerPostId, "pin-12345");
      assert.strictEqual(result.value.url, "https://www.pinterest.com/pin/pin-12345/");
      assert.ok(result.value.publishedAt instanceof Date);
    }
  });

  it("calls createPin with correct board_id from credentials", async () => {
    const { adapter, client } = makeAdapter();
    await adapter.publish(makePublishInput(), VALID_CREDS);

    assert.strictEqual(client.createPin.mock.calls.length, 1);
    const callArgs = client.createPin.mock.calls[0]?.[0] as Record<string, unknown>;
    assert.strictEqual(callArgs.board_id, "board-001");
  });

  it("passes title from meta to createPin", async () => {
    const { adapter, client } = makeAdapter();
    const input = makePublishInput({
      post: {
        body: "Pin desc",
        text: "Pin desc",
        media: [{ url: "https://example.com/img.jpg", type: "image" as const }],
        meta: { title: "My Pin Title" },
      },
    });

    await adapter.publish(input, VALID_CREDS);

    const callArgs = client.createPin.mock.calls[0]?.[0] as Record<string, unknown>;
    assert.strictEqual(callArgs.title, "My Pin Title");
  });

  it("uses image_url source type for image media", async () => {
    const { adapter, client } = makeAdapter();
    await adapter.publish(makePublishInput(), VALID_CREDS);

    const callArgs = client.createPin.mock.calls[0]?.[0] as Record<string, unknown>;
    const mediaSource = callArgs.media_source as Record<string, unknown>;
    assert.strictEqual(mediaSource.source_type, "image_url");
    assert.strictEqual(mediaSource.url, "https://example.com/image.jpg");
  });

  it("uses video_id source type for video media", async () => {
    const { adapter, client } = makeAdapter();
    const input = makePublishInput({
      post: {
        body: "Video pin",
        text: "Video pin",
        media: [{ url: "video-media-id-123", type: "video" as const }],
        meta: {},
      },
    });

    await adapter.publish(input, VALID_CREDS);

    const callArgs = client.createPin.mock.calls[0]?.[0] as Record<string, unknown>;
    const mediaSource = callArgs.media_source as Record<string, unknown>;
    assert.strictEqual(mediaSource.source_type, "video_id");
    assert.strictEqual(mediaSource.media_id, "video-media-id-123");
  });

  it("returns VALIDATION error when post has no media URL", async () => {
    const { adapter } = makeAdapter();
    const input = makePublishInput({
      post: {
        body: "No media post",
        text: "No media post",
        media: [],
        meta: {},
      },
    });

    const result = await adapter.publish(input, VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "VALIDATION");
    }
  });

  it("returns AUTH error when credentials are missing", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.publish(makePublishInput(), undefined);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH");
    }
  });

  it("returns AUTH error when credentials lack accessToken", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.publish(makePublishInput(), {
      refreshToken: "x",
      boardId: "y",
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH");
    }
  });

  it("returns NETWORK error when circuit breaker is open", async () => {
    const client = makeFakeApiClient({
      createPin: vi.fn(async () => {
        throw new Error("Circuit breaker is OPEN for pinterest-api");
      }),
    });
    const { adapter } = makeAdapter(client);
    const result = await adapter.publish(makePublishInput(), VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "NETWORK");
    }
  });

  it("returns RATE_LIMIT error on 429 status", async () => {
    const rateLimitError = Object.assign(new Error("Rate limited"), { status: 429 });
    const client = makeFakeApiClient({
      createPin: vi.fn(async () => {
        throw rateLimitError;
      }),
    });
    const { adapter } = makeAdapter(client);
    const result = await adapter.publish(makePublishInput(), VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "RATE_LIMIT");
    }
  });

  it("returns NETWORK error on 500 status", async () => {
    const serverError = Object.assign(new Error("Server Error"), { status: 500 });
    const client = makeFakeApiClient({
      createPin: vi.fn(async () => {
        throw serverError;
      }),
    });
    const { adapter } = makeAdapter(client);
    const result = await adapter.publish(makePublishInput(), VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "NETWORK");
    }
  });
});

// ============================================================================
// 4. ValidateCredentials Tests
// ============================================================================

describe("PinterestAdapter - ValidateCredentials", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok with valid credentials", async () => {
    const { adapter, client } = makeAdapter();
    const result = await adapter.validateCredentials(VALID_CREDS);

    assert.ok(result.ok, "Validation should succeed");
    assert.strictEqual(client.getUserAccount.mock.calls.length, 1);
  });

  it("returns AUTH_INVALID when accessToken is missing", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.validateCredentials({ ...VALID_CREDS, accessToken: "" });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH_INVALID");
    }
  });

  it("returns AUTH_INVALID when refreshToken is missing", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.validateCredentials({ ...VALID_CREDS, refreshToken: "" });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH_INVALID");
    }
  });

  it("returns AUTH_INVALID when boardId is missing", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.validateCredentials({ ...VALID_CREDS, boardId: "" });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH_INVALID");
    }
  });

  it("returns AUTH_EXPIRED when API returns 401", async () => {
    const authError = Object.assign(new Error("Unauthorized"), { status: 401 });
    const client = makeFakeApiClient({
      getUserAccount: vi.fn(async () => {
        throw authError;
      }),
    });
    const { adapter } = makeAdapter(client);
    const result = await adapter.validateCredentials(VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH_EXPIRED");
    }
  });

  it("returns AUTH_INVALID when API throws generic error", async () => {
    const client = makeFakeApiClient({
      getUserAccount: vi.fn(async () => {
        throw new Error("Connection failed");
      }),
    });
    const { adapter } = makeAdapter(client);
    const result = await adapter.validateCredentials(VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH_INVALID");
    }
  });
});

// ============================================================================
// 5. FetchAnalytics Tests
// ============================================================================

describe("PinterestAdapter - FetchAnalytics", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns analytics data with correct metrics mapping", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.fetchAnalytics(
      {
        channelId: "channel-001",
        since: new Date("2024-01-01"),
        until: new Date("2024-01-31"),
      },
      VALID_CREDS
    );

    assert.ok(result.ok, "FetchAnalytics should succeed");
    if (result.ok) {
      const data = result.value as Record<string, unknown>;
      assert.strictEqual(data.channelId, "channel-001");

      const metrics = data.metrics as Record<string, unknown>;
      assert.strictEqual(metrics.pinCount, 42);
      assert.strictEqual(metrics.boardCount, 5);
      assert.strictEqual(metrics.accountType, "BUSINESS");
    }
  });

  it("uses default 30-day range when no dates provided", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.fetchAnalytics({ channelId: "channel-001" }, VALID_CREDS);

    assert.ok(result.ok);
    if (result.ok) {
      const data = result.value as Record<string, unknown>;
      const period = data.period as Record<string, Date>;
      const diffMs = period.until.getTime() - period.since.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      assert.ok(diffDays >= 29 && diffDays <= 31, `Expected ~30 days, got ${diffDays}`);
    }
  });

  it("returns AUTH error when credentials are missing", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.fetchAnalytics({ channelId: "channel-001" }, undefined);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH");
    }
  });

  it("returns NETWORK error when API call fails", async () => {
    const client = makeFakeApiClient({
      getUserAccount: vi.fn(async () => {
        throw new Error("API unavailable");
      }),
    });
    const { adapter } = makeAdapter(client);
    const result = await adapter.fetchAnalytics({ channelId: "channel-001" }, VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "NETWORK");
    }
  });

  it("includes dateRange formatted as YYYY-MM-DD strings", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.fetchAnalytics(
      {
        channelId: "channel-001",
        since: new Date("2024-06-01T00:00:00Z"),
        until: new Date("2024-06-30T00:00:00Z"),
      },
      VALID_CREDS
    );

    assert.ok(result.ok);
    if (result.ok) {
      const data = result.value as Record<string, unknown>;
      const dateRange = data.dateRange as Record<string, string>;
      assert.strictEqual(dateRange.startDate, "2024-06-01");
      assert.strictEqual(dateRange.endDate, "2024-06-30");
    }
  });
});

// ============================================================================
// 6. Threading (Not Supported)
// ============================================================================

describe("PinterestAdapter - Threading", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("planThread returns THREAD_PLANNING_FAILED error", () => {
    const { adapter } = makeAdapter();
    const post = makeCanonicalPost();
    const result = adapter.planThread(post);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "THREAD_PLANNING_FAILED");
    }
  });

  it("publishThread returns VALIDATION error", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.publishThread(
      {
        channelId: "channel-001",
        threadPlan: {
          strategy: "AUTO",
          tweets: [],
          totalChars: 0,
          estimatedReach: 0,
          needsThreading: false,
        },
        dedupeKey: "dedupe-001",
      },
      VALID_CREDS
    );

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "VALIDATION");
    }
  });
});
