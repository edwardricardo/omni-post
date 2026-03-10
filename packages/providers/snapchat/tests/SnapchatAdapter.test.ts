/**
 * @file SnapchatAdapter.test.ts
 * @description Test suite for the Snapchat provider adapter.
 *              Covers getProviderInfo, render, publish, validateCredentials,
 *              fetchAnalytics, and error handling scenarios.
 *              All tests are Tier 0 (no network, no DB, no Redis).
 * @layer test
 */

import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { SnapchatAdapter } from "../src/SnapchatAdapter.js";
import { ok } from "@shared/types";
import type { CanonicalPost, RenderedPost } from "@shared/types";
import type { PublishInput } from "@ports/core";

// ============================================================================
// Credential Fixtures
// ============================================================================

const MOCK_CREDENTIALS = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  accessToken: "test-access-token",
  refreshToken: "test-refresh-token",
  organizationId: "test-org-id",
} as const;

// ============================================================================
// Factory Helpers
// ============================================================================

function createTestCanonicalPost(overrides: Partial<CanonicalPost> = {}): CanonicalPost {
  return {
    id: "post-snap-001",
    projectId: "project-test",
    locale: "en",
    body: "Test Snapchat story",
    media: [
      {
        id: "media-001",
        type: "image",
        url: "https://example.com/image.jpg",
      },
    ],
    ...overrides,
  };
}

function createTestRenderedPost(overrides: Partial<RenderedPost> = {}): RenderedPost {
  return {
    body: "Test snap caption",
    media: [
      {
        url: "https://example.com/image.jpg",
        type: "image",
      },
    ],
    meta: {},
    ...overrides,
  };
}

function createTestPublishInput(postOverrides: Partial<RenderedPost> = {}): PublishInput {
  return {
    channelId: "channel-snap-123",
    post: createTestRenderedPost(postOverrides),
    dedupeKey: `dedupe-snap-${Date.now()}`,
  };
}

function createMockApiClient() {
  return {
    validateCredentials: mock.fn(async () => ({
      organizations: [{ id: "org-123", name: "Test Org" }],
    })),
    uploadMedia: mock.fn(async (_url: string, _type: string) => ({
      media: {
        id: "media-uploaded-123",
        type: "IMAGE",
        media_status: "PENDING",
        name: "omnipost-media-test",
      },
    })),
    createStory: mock.fn(async (_mediaId: string, _caption?: string) => ({
      creative: {
        id: "creative-123",
        name: "omnipost-story-test",
        type: "SNAP_AD",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        top_snap_media_id: _mediaId,
      },
    })),
    getStoryAnalytics: mock.fn(async (_creativeId: string) => ({
      total_views: 1500,
      unique_views: 1200,
      screenshots: 45,
      swipe_ups: 80,
      shares: 30,
      avg_view_time_seconds: 4.5,
    })),
    refreshAccessToken: mock.fn(async () => ({
      access_token: "new-access-token",
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: "new-refresh-token",
      scope: "snapchat-marketing-api",
    })),
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
    uploadMedia: mock.fn(async () => {
      throw makeError();
    }),
    createStory: mock.fn(async () => {
      throw makeError();
    }),
    getStoryAnalytics: mock.fn(async () => {
      throw makeError();
    }),
    refreshAccessToken: mock.fn(async () => {
      throw makeError();
    }),
    getCircuitBreakerStatus: mock.fn(() => ({})),
    clearCache: mock.fn(() => undefined),
  };
}

// ============================================================================
// 1. Provider Info / Metadata Tests (5 tests)
// ============================================================================

describe("SnapchatAdapter - getProviderInfo / metadata", { concurrency: 1 }, () => {
  let adapter: SnapchatAdapter;

  beforeEach(() => {
    adapter = new SnapchatAdapter();
  });

  it("returns correct provider id", () => {
    assert.strictEqual(adapter.id, "snapchat");
  });

  it("returns correct metadata with display name and color", () => {
    assert.strictEqual(adapter.metadata.id, "snapchat");
    assert.strictEqual(adapter.metadata.displayName, "Snapchat");
    assert.strictEqual(adapter.metadata.color, "#FFFC00");
    assert.strictEqual(adapter.metadata.status, "active");
    assert.strictEqual(adapter.metadata.authType, "oauth");
  });

  it("returns correct character limit of 250", () => {
    assert.strictEqual(adapter.limits.maxChars, 250);
  });

  it("returns correct media constraints", () => {
    assert.strictEqual(adapter.limits.maxMediaPerPost, 1);
    assert.deepStrictEqual(adapter.limits.allowedMedia, ["image", "video"]);
    assert.deepStrictEqual(adapter.limits.aspectRatios, ["9:16"]);
    assert.strictEqual(adapter.limits.maxVideoDuration, 60);
  });

  it("reports correct capabilities", () => {
    assert.strictEqual(adapter.capabilities.publish, true);
    assert.strictEqual(adapter.capabilities.schedule, false);
    assert.strictEqual(adapter.capabilities.analytics, true);
    assert.strictEqual(adapter.capabilities.threading, false);
    assert.strictEqual(adapter.capabilities.stories, true);
  });
});

// ============================================================================
// 2. Render Tests (6 tests)
// ============================================================================

describe("SnapchatAdapter - render()", { concurrency: 1 }, () => {
  let adapter: SnapchatAdapter;

  beforeEach(() => {
    adapter = new SnapchatAdapter();
  });

  it("returns VALIDATION_ERROR when no media is provided", () => {
    const post = createTestCanonicalPost({ media: [] });
    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "VALIDATION_ERROR");
  });

  it("returns VALIDATION_ERROR when media is undefined", () => {
    const post = createTestCanonicalPost({ media: undefined });
    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "VALIDATION_ERROR");
  });

  it("returns correct RenderedContent for image media", () => {
    const post = createTestCanonicalPost({
      body: "Check out this snap!",
      media: [
        {
          id: "media-001",
          type: "image",
          url: "https://example.com/photo.jpg",
          alt: "A cool photo",
        },
      ],
    });

    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed");
    assert.strictEqual(result.value.type, "single");

    const content = result.value.content as RenderedPost;
    assert.strictEqual(content.body, "Check out this snap!");
    assert.ok(content.media, "Should have media array");
    assert.strictEqual(content.media?.length, 1);
    assert.strictEqual(content.media?.[0]?.url, "https://example.com/photo.jpg");
    assert.strictEqual(content.media?.[0]?.type, "image");
    assert.strictEqual(content.media?.[0]?.alt, "A cool photo");
    assert.strictEqual(content.meta?.contentType, "story");
    assert.strictEqual(content.meta?.aspectRatio, "9:16");
  });

  it("returns correct RenderedContent for video media", () => {
    const post = createTestCanonicalPost({
      body: "New video snap",
      media: [
        {
          id: "media-002",
          type: "video",
          url: "https://example.com/video.mp4",
        },
      ],
    });

    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed");
    const content = result.value.content as RenderedPost;
    assert.strictEqual(content.media?.[0]?.type, "video");
    assert.strictEqual(content.meta?.maxDuration, 60);
  });

  it("truncates caption to 250 characters", () => {
    const longBody = "A".repeat(300);
    const post = createTestCanonicalPost({
      body: longBody,
      media: [
        {
          id: "media-003",
          type: "image",
          url: "https://example.com/photo.jpg",
        },
      ],
    });

    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed");
    const content = result.value.content as RenderedPost;
    assert.strictEqual(content.body?.length, 250);
  });

  it("returns UNSUPPORTED_MEDIA for gif media type", () => {
    const post = createTestCanonicalPost({
      media: [
        {
          id: "media-004",
          type: "gif",
          url: "https://example.com/animation.gif",
        },
      ],
    });

    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "UNSUPPORTED_MEDIA");
  });
});

// ============================================================================
// 3. Threading Tests (2 tests)
// ============================================================================

describe("SnapchatAdapter - threading (not supported)", { concurrency: 1 }, () => {
  let adapter: SnapchatAdapter;

  beforeEach(() => {
    adapter = new SnapchatAdapter();
  });

  it("planThread returns THREAD_PLANNING_FAILED error", () => {
    const post = createTestCanonicalPost();
    const result = adapter.planThread(post);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "THREAD_PLANNING_FAILED");
  });

  it("publishThread returns VALIDATION error", async () => {
    const result = await adapter.publishThread({
      channelId: "channel-snap-123",
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
    assert.strictEqual(result.error, "VALIDATION");
  });
});

// ============================================================================
// 4. Publish Tests (5 tests)
// ============================================================================

describe("SnapchatAdapter - publish()", { concurrency: 1 }, () => {
  let adapter: SnapchatAdapter;

  beforeEach(() => {
    adapter = new SnapchatAdapter();
  });

  it("publishes a story successfully with media", async () => {
    const mockClient = createMockApiClient();
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => mockClient);

    const input = createTestPublishInput({
      body: "My snap story",
      media: [
        {
          url: "https://example.com/photo.jpg",
          type: "image",
        },
      ],
    });

    const result = await adapter.publish(input);

    assert.ok(result.ok, "Publish should succeed");
    assert.strictEqual(result.value.providerPostId, "creative-123");
    assert.ok(result.value.url?.includes("creative-123"), "URL should contain creative ID");
    assert.ok(result.value.publishedAt instanceof Date, "publishedAt should be a Date");
    assert.strictEqual(
      mockClient.uploadMedia.mock.calls.length,
      1,
      "uploadMedia should be called once"
    );
    assert.strictEqual(
      mockClient.createStory.mock.calls.length,
      1,
      "createStory should be called once"
    );
  });

  it("passes correct media type for video uploads", async () => {
    const mockClient = createMockApiClient();
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => mockClient);

    const input = createTestPublishInput({
      body: "Video snap",
      media: [
        {
          url: "https://example.com/video.mp4",
          type: "video",
        },
      ],
    });

    const result = await adapter.publish(input);

    assert.ok(result.ok, "Publish should succeed");
    const uploadCall = mockClient.uploadMedia.mock.calls[0];
    assert.ok(uploadCall, "uploadMedia should have been called");
    assert.strictEqual(uploadCall.arguments[1], "video/mp4");
  });

  it("returns VALIDATION error when post has no media", async () => {
    const mockClient = createMockApiClient();
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => mockClient);

    const input = createTestPublishInput({
      body: "Text only snap",
      media: [],
    });

    const result = await adapter.publish(input);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "VALIDATION");
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

    const input = createTestPublishInput({
      body: "Snap with circuit breaker open",
      media: [
        {
          url: "https://example.com/photo.jpg",
          type: "image",
        },
      ],
    });

    const result = await adapter.publish(input);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "NETWORK");
  });
});

// ============================================================================
// 5. Publish Error Mapping Tests (3 tests)
// ============================================================================

describe("SnapchatAdapter - publish error mapping", { concurrency: 1 }, () => {
  let adapter: SnapchatAdapter;

  beforeEach(() => {
    adapter = new SnapchatAdapter();
  });

  it("maps 429 status to RATE_LIMIT error", async () => {
    const failingClient = createFailingApiClient("Rate limit exceeded", 429);
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => failingClient);

    const input = createTestPublishInput({
      body: "Rate limited snap",
      media: [
        {
          url: "https://example.com/photo.jpg",
          type: "image",
        },
      ],
    });

    const result = await adapter.publish(input);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "RATE_LIMIT");
  });

  it("maps 401 status to AUTH error", async () => {
    const failingClient = createFailingApiClient("Unauthorized", 401);
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => failingClient);

    const input = createTestPublishInput({
      body: "Auth error snap",
      media: [
        {
          url: "https://example.com/photo.jpg",
          type: "image",
        },
      ],
    });

    const result = await adapter.publish(input);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "AUTH");
  });

  it("maps 500 status to NETWORK error", async () => {
    const failingClient = createFailingApiClient("Internal server error", 500);
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => failingClient);

    const input = createTestPublishInput({
      body: "Server error snap",
      media: [
        {
          url: "https://example.com/photo.jpg",
          type: "image",
        },
      ],
    });

    const result = await adapter.publish(input);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "NETWORK");
  });
});

// ============================================================================
// 6. Validate Credentials Tests (3 tests)
// ============================================================================

describe("SnapchatAdapter - validateCredentials()", { concurrency: 1 }, () => {
  let adapter: SnapchatAdapter;

  beforeEach(() => {
    adapter = new SnapchatAdapter();
  });

  it("returns ok with valid credentials", async () => {
    const mockClient = createMockApiClient();
    mock.method(adapter as any, "createApiClient", () => mockClient);

    const result = await adapter.validateCredentials(MOCK_CREDENTIALS);

    assert.ok(result.ok, "Validation should succeed");
    assert.strictEqual(
      mockClient.validateCredentials.mock.calls.length,
      1,
      "validateCredentials should be called on API client"
    );
  });

  it("returns AUTH_INVALID when required fields are missing", async () => {
    const result = await adapter.validateCredentials({
      clientId: "test",
      // missing clientSecret, accessToken, refreshToken, organizationId
    });

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
// 7. Fetch Analytics Tests (4 tests)
// ============================================================================

describe("SnapchatAdapter - fetchAnalytics()", { concurrency: 1 }, () => {
  let adapter: SnapchatAdapter;

  beforeEach(() => {
    adapter = new SnapchatAdapter();
  });

  it("returns analytics with correct metrics mapping", async () => {
    const mockClient = createMockApiClient();
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => mockClient);

    const result = await adapter.fetchAnalytics!({
      channelId: "creative-123",
    });

    assert.ok(result.ok, "fetchAnalytics should succeed");
    const data = result.value as {
      channelId: string;
      metrics: {
        views: number;
        uniqueViews: number;
        likes: number;
        shares: number;
        comments: number;
        screenshots: number;
        swipeUps: number;
        avgViewTime: number;
      };
    };

    assert.strictEqual(data.channelId, "creative-123");
    assert.strictEqual(data.metrics.views, 1500);
    assert.strictEqual(data.metrics.uniqueViews, 1200);
    assert.strictEqual(data.metrics.likes, 0);
    assert.strictEqual(data.metrics.shares, 30);
    assert.strictEqual(data.metrics.comments, 0);
    assert.strictEqual(data.metrics.screenshots, 45);
    assert.strictEqual(data.metrics.swipeUps, 80);
    assert.strictEqual(data.metrics.avgViewTime, 4.5);
  });

  it("passes date range parameters when provided", async () => {
    const mockClient = createMockApiClient();
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => mockClient);

    const since = new Date("2025-01-01T00:00:00Z");
    const until = new Date("2025-01-31T23:59:59Z");

    const result = await adapter.fetchAnalytics!({
      channelId: "creative-456",
      since,
      until,
    });

    assert.ok(result.ok, "fetchAnalytics should succeed");
    const data = result.value as { since?: Date; until?: Date };
    assert.deepStrictEqual(data.since, since);
    assert.deepStrictEqual(data.until, until);
  });

  it("returns AUTH error when credentials fail", async () => {
    mock.method(adapter as any, "getCredentials", async () => ({
      ok: false,
      error: "AUTH",
    }));

    const result = await adapter.fetchAnalytics!({
      channelId: "creative-789",
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "AUTH");
  });

  it("returns NETWORK error when API call fails", async () => {
    const failingClient = createFailingApiClient("Server error", 500);
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => failingClient);

    const result = await adapter.fetchAnalytics!({
      channelId: "creative-broken",
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "NETWORK");
  });
});

// ============================================================================
// 8. Content Validation Tests (3 tests)
// ============================================================================

describe("SnapchatAdapter - validateContent()", { concurrency: 1 }, () => {
  let adapter: SnapchatAdapter;

  beforeEach(() => {
    adapter = new SnapchatAdapter();
  });

  it("returns valid for content within character limit", async () => {
    const post = createTestCanonicalPost({ body: "Short caption" });
    const result = await adapter.validateContent(post);

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  it("returns error for content exceeding 250 character limit", async () => {
    const post = createTestCanonicalPost({ body: "X".repeat(251) });
    const result = await adapter.validateContent(post);

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0, "Should have validation errors");
    assert.ok(result.errors[0]?.message.includes("250"), "Error should mention character limit");
  });

  it("returns error when media count exceeds max (1)", async () => {
    const post = createTestCanonicalPost({
      media: [
        { id: "m1", type: "image", url: "https://example.com/1.jpg" },
        { id: "m2", type: "image", url: "https://example.com/2.jpg" },
      ],
    });
    const result = await adapter.validateContent(post);

    assert.strictEqual(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.field === "media"),
      "Should have media validation error"
    );
  });
});
