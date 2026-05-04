/**
 * @file SnapchatAdapter.test.ts
 * @description Test suite for the Snapchat provider adapter.
 *              Covers metadata, render, publish, validateCredentials,
 *              fetchAnalytics, and error handling. Adapter is stateless
 *              w.r.t. credentials — tests inject a fake apiClientFactory and
 *              pass credentials per-call.
 *              All tests are Tier 0 (no network, no DB, no Redis).
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { SnapchatAdapter, type SnapchatApiClientFactory } from "../src/SnapchatAdapter.js";
import type { SnapchatApiClient } from "../src/apiClient.js";
import type { SnapchatCredentials } from "../src/types.js";
import type { CanonicalPost, RenderedPost } from "@shared/types";
import type { PublishInput } from "@ports/core";

// ============================================================================
// Credential Fixtures
// ============================================================================

const VALID_CREDS: SnapchatCredentials = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  accessToken: "test-access-token",
  refreshToken: "test-refresh-token",
  organizationId: "test-org-id",
};

// ============================================================================
// Factory Helpers
// ============================================================================

interface FakeApiClient {
  validateCredentials: ReturnType<typeof vi.fn>;
  uploadMedia: ReturnType<typeof vi.fn>;
  createStory: ReturnType<typeof vi.fn>;
  getStoryAnalytics: ReturnType<typeof vi.fn>;
  refreshAccessToken: ReturnType<typeof vi.fn>;
}

function makeFakeApiClient(overrides: Partial<FakeApiClient> = {}): FakeApiClient {
  return {
    validateCredentials: vi.fn(async () => ({
      organizations: [{ id: "org-123", name: "Test Org" }],
    })),
    uploadMedia: vi.fn(async () => ({
      media: {
        id: "media-uploaded-123",
        type: "IMAGE",
        media_status: "PENDING",
        name: "omnipost-media-test",
      },
    })),
    createStory: vi.fn(async (mediaId: string) => ({
      creative: {
        id: "creative-123",
        name: "omnipost-story-test",
        type: "SNAP_AD",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        top_snap_media_id: mediaId,
      },
    })),
    getStoryAnalytics: vi.fn(async () => ({
      total_views: 1500,
      unique_views: 1200,
      screenshots: 45,
      swipe_ups: 80,
      shares: 30,
      avg_view_time_seconds: 4.5,
    })),
    refreshAccessToken: vi.fn(async () => ({
      access_token: "new-access-token",
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: "new-refresh-token",
      scope: "snapchat-marketing-api",
    })),
    ...overrides,
  };
}

function makeFailingApiClient(errorMessage = "API error", statusCode?: number): FakeApiClient {
  const makeError = (): Error & { status?: number } => {
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
    uploadMedia: vi.fn(async () => {
      throw makeError();
    }),
    createStory: vi.fn(async () => {
      throw makeError();
    }),
    getStoryAnalytics: vi.fn(async () => {
      throw makeError();
    }),
    refreshAccessToken: vi.fn(async () => {
      throw makeError();
    }),
  };
}

function makeAdapter(client: FakeApiClient = makeFakeApiClient()): {
  adapter: SnapchatAdapter;
  client: FakeApiClient;
} {
  const factory: SnapchatApiClientFactory = () => client as unknown as SnapchatApiClient;
  const adapter = new SnapchatAdapter({ apiClientFactory: factory });
  return { adapter, client };
}

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

// ============================================================================
// 1. Provider Info / Metadata Tests
// ============================================================================

describe("SnapchatAdapter - getProviderInfo / metadata", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns correct provider id", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.id, "snapchat");
  });

  it("returns correct metadata with display name and color", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.metadata.id, "snapchat");
    assert.strictEqual(adapter.metadata.displayName, "Snapchat");
    assert.strictEqual(adapter.metadata.color, "#FFFC00");
    assert.strictEqual(adapter.metadata.status, "active");
    assert.strictEqual(adapter.metadata.authType, "oauth");
  });

  it("returns correct character limit of 250", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.limits.maxChars, 250);
  });

  it("returns correct media constraints", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.limits.maxMediaPerPost, 1);
    assert.deepStrictEqual(adapter.limits.allowedMedia, ["image", "video"]);
    assert.deepStrictEqual(adapter.limits.aspectRatios, ["9:16"]);
    assert.strictEqual(adapter.limits.maxVideoDuration, 60);
  });

  it("reports correct capabilities", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.capabilities.publish, true);
    assert.strictEqual(adapter.capabilities.schedule, false);
    assert.strictEqual(adapter.capabilities.analytics, true);
    assert.strictEqual(adapter.capabilities.threading, false);
    assert.strictEqual(adapter.capabilities.stories, true);
    assert.strictEqual(adapter.capabilities.comments, false);
    assert.strictEqual(adapter.capabilities.replies, false);
    assert.strictEqual(adapter.capabilities.media, true);
    assert.strictEqual(adapter.capabilities.images, true);
    assert.strictEqual(adapter.capabilities.videos, true);
  });

  it("has correct metadata description", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(
      adapter.metadata.description,
      "Publish stories and spotlight content to Snapchat"
    );
  });

  it("has correct metadata website", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.metadata.website, "https://www.snapchat.com");
  });

  it("has correct metadata icon path", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.metadata.icon, "/providers/snapchat-icon.svg");
  });

  it("has correct required scopes", () => {
    const { adapter } = makeAdapter();
    assert.deepStrictEqual(adapter.metadata.requiredScopes, [
      "snapchat-marketing-api",
      "snapchat-profile-api",
    ]);
  });

  it("requires business account", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.constraints.businessAccountRequired, true);
  });

  it("has correct rateLimitHints", () => {
    const { adapter } = makeAdapter();
    assert.deepStrictEqual(adapter.limits.rateLimitHints, { burst: 20, perSeconds: 1 });
  });

  it("declares threading not supported", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.limits.threadingSupported, false);
  });

  it("exports a factory function", async () => {
    const { createSnapchatAdapter } = await import("../src/SnapchatAdapter.js");
    const adapter = createSnapchatAdapter();
    assert.ok(adapter instanceof SnapchatAdapter);
    assert.strictEqual(adapter.id, "snapchat");
  });
});

// ============================================================================
// 2. Render Tests
// ============================================================================

describe("SnapchatAdapter - render()", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns VALIDATION_ERROR when no media is provided", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({ media: [] });
    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    }
  });

  it("returns VALIDATION_ERROR when media is undefined", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({ media: undefined });
    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    }
  });

  it("returns correct RenderedContent for image media", () => {
    const { adapter } = makeAdapter();
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
    if (result.ok) {
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
    }
  });

  it("returns correct RenderedContent for video media", () => {
    const { adapter } = makeAdapter();
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
    if (result.ok) {
      const content = result.value.content as RenderedPost;
      assert.strictEqual(content.media?.[0]?.type, "video");
      assert.strictEqual(content.meta?.maxDuration, 60);
    }
  });

  it("truncates caption to 250 characters", () => {
    const { adapter } = makeAdapter();
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
    if (result.ok) {
      const content = result.value.content as RenderedPost;
      assert.strictEqual(content.body?.length, 250);
    }
  });

  it("returns UNSUPPORTED_MEDIA for gif media type", () => {
    const { adapter } = makeAdapter();
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
    if (!result.ok) {
      assert.strictEqual(result.error, "UNSUPPORTED_MEDIA");
    }
  });

  it("uses empty string for caption when body is undefined", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({
      body: undefined as unknown as string,
      media: [{ id: "m1", type: "image", url: "https://example.com/img.jpg" }],
    });

    const result = adapter.render(post);
    assert.ok(result.ok);
    if (result.ok) {
      const content = result.value.content as { body: string };
      assert.strictEqual(content.body, "");
    }
  });

  it("includes alt text when media has it", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({
      media: [
        {
          id: "m1",
          type: "image",
          url: "https://example.com/img.jpg",
          alt: "Photo description",
        },
      ],
    });

    const result = adapter.render(post);
    assert.ok(result.ok);
    if (result.ok) {
      const content = result.value.content as { media: Array<{ alt?: string }> };
      assert.strictEqual(content.media[0]?.alt, "Photo description");
    }
  });

  it("omits alt from media when not provided", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({
      media: [
        {
          id: "m1",
          type: "image",
          url: "https://example.com/img.jpg",
        },
      ],
    });

    const result = adapter.render(post);
    assert.ok(result.ok);
    if (result.ok) {
      const content = result.value.content as { media: Array<Record<string, unknown>> };
      assert.strictEqual(Object.prototype.hasOwnProperty.call(content.media[0], "alt"), false);
    }
  });

  it("sets meta.platform to snapchat", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost();
    const result = adapter.render(post);
    assert.ok(result.ok);
    if (result.ok) {
      assert.strictEqual(result.value.meta?.platform, "snapchat");
    }
  });

  it("sets meta.storyFormat to true", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost();
    const result = adapter.render(post);
    assert.ok(result.ok);
    if (result.ok) {
      assert.strictEqual(result.value.meta?.storyFormat, true);
    }
  });

  it("sets content.text equal to content.body", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({ body: "Same text" });
    const result = adapter.render(post);
    assert.ok(result.ok);
    if (result.ok) {
      const content = result.value.content as { body: string; text: string };
      assert.strictEqual(content.text, content.body);
      assert.strictEqual(content.text, "Same text");
    }
  });

  it("truncates caption to exactly 250 chars boundary", () => {
    const { adapter } = makeAdapter();
    const body250 = "X".repeat(250);
    const post = createTestCanonicalPost({
      body: body250,
      media: [{ id: "m1", type: "image", url: "https://example.com/img.jpg" }],
    });
    const result = adapter.render(post);
    assert.ok(result.ok);
    if (result.ok) {
      const content = result.value.content as { body: string };
      assert.strictEqual(content.body.length, 250);
    }
  });

  it("does not truncate caption at exactly 249 chars", () => {
    const { adapter } = makeAdapter();
    const body249 = "Y".repeat(249);
    const post = createTestCanonicalPost({
      body: body249,
      media: [{ id: "m1", type: "image", url: "https://example.com/img.jpg" }],
    });
    const result = adapter.render(post);
    assert.ok(result.ok);
    if (result.ok) {
      const content = result.value.content as { body: string };
      assert.strictEqual(content.body.length, 249);
    }
  });

  it("takes only first media item", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost({
      media: [{ id: "m1", type: "image", url: "https://example.com/1.jpg" }],
    });
    const result = adapter.render(post);
    assert.ok(result.ok);
    if (result.ok) {
      const content = result.value.content as { media: Array<{ url: string }> };
      assert.strictEqual(content.media.length, 1);
      assert.strictEqual(content.media[0]?.url, "https://example.com/1.jpg");
    }
  });
});

// ============================================================================
// 3. Threading Tests
// ============================================================================

describe("SnapchatAdapter - threading (not supported)", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("planThread returns THREAD_PLANNING_FAILED error", () => {
    const { adapter } = makeAdapter();
    const post = createTestCanonicalPost();
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
        channelId: "channel-snap-123",
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
    if (!result.ok) {
      assert.strictEqual(result.error, "VALIDATION");
    }
  });
});

// ============================================================================
// 4. Publish Tests
// ============================================================================

describe("SnapchatAdapter - publish()", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes a story successfully with media", async () => {
    const { adapter, client } = makeAdapter();
    const input = createTestPublishInput({
      body: "My snap story",
      media: [
        {
          url: "https://example.com/photo.jpg",
          type: "image",
        },
      ],
    });

    const result = await adapter.publish(input, VALID_CREDS);

    assert.ok(result.ok, "Publish should succeed");
    if (result.ok) {
      assert.strictEqual(result.value.providerPostId, "creative-123");
      assert.ok(result.value.url?.includes("creative-123"), "URL should contain creative ID");
      assert.ok(result.value.publishedAt instanceof Date, "publishedAt should be a Date");
    }
    assert.strictEqual(client.uploadMedia.mock.calls.length, 1);
    assert.strictEqual(client.createStory.mock.calls.length, 1);
  });

  it("passes correct media type for video uploads", async () => {
    const { adapter, client } = makeAdapter();
    const input = createTestPublishInput({
      body: "Video snap",
      media: [
        {
          url: "https://example.com/video.mp4",
          type: "video",
        },
      ],
    });

    const result = await adapter.publish(input, VALID_CREDS);

    assert.ok(result.ok, "Publish should succeed");
    const uploadCall = client.uploadMedia.mock.calls[0];
    assert.ok(uploadCall, "uploadMedia should have been called");
    assert.strictEqual(uploadCall[1], "video/mp4");
  });

  it("returns VALIDATION error when post has no media", async () => {
    const { adapter } = makeAdapter();
    const input = createTestPublishInput({
      body: "Text only snap",
      media: [],
    });

    const result = await adapter.publish(input, VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "VALIDATION");
    }
  });

  it("returns AUTH error when credentials are missing", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.publish(createTestPublishInput(), undefined);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH");
    }
  });

  it("returns NETWORK error when circuit breaker is OPEN", async () => {
    const failingClient = makeFailingApiClient("Circuit breaker is OPEN");
    const { adapter } = makeAdapter(failingClient);

    const input = createTestPublishInput({
      body: "Snap with circuit breaker open",
      media: [
        {
          url: "https://example.com/photo.jpg",
          type: "image",
        },
      ],
    });

    const result = await adapter.publish(input, VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "NETWORK");
    }
  });
});

// ============================================================================
// 5. Publish Error Mapping Tests
// ============================================================================

describe("SnapchatAdapter - publish error mapping", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps 429 status to RATE_LIMIT error", async () => {
    const failingClient = makeFailingApiClient("Rate limit exceeded", 429);
    const { adapter } = makeAdapter(failingClient);

    const input = createTestPublishInput({
      body: "Rate limited snap",
      media: [
        {
          url: "https://example.com/photo.jpg",
          type: "image",
        },
      ],
    });

    const result = await adapter.publish(input, VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "RATE_LIMIT");
    }
  });

  it("maps 401 status to AUTH error", async () => {
    const failingClient = makeFailingApiClient("Unauthorized", 401);
    const { adapter } = makeAdapter(failingClient);

    const input = createTestPublishInput({
      body: "Auth error snap",
      media: [
        {
          url: "https://example.com/photo.jpg",
          type: "image",
        },
      ],
    });

    const result = await adapter.publish(input, VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH");
    }
  });

  it("maps 500 status to NETWORK error", async () => {
    const failingClient = makeFailingApiClient("Internal server error", 500);
    const { adapter } = makeAdapter(failingClient);

    const input = createTestPublishInput({
      body: "Server error snap",
      media: [
        {
          url: "https://example.com/photo.jpg",
          type: "image",
        },
      ],
    });

    const result = await adapter.publish(input, VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "NETWORK");
    }
  });
});

// ============================================================================
// 6. Validate Credentials Tests
// ============================================================================

describe("SnapchatAdapter - validateCredentials()", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok with valid credentials", async () => {
    const { adapter, client } = makeAdapter();
    const result = await adapter.validateCredentials(VALID_CREDS);

    assert.ok(result.ok, "Validation should succeed");
    assert.strictEqual(client.validateCredentials.mock.calls.length, 1);
  });

  it("returns AUTH_INVALID when required fields are missing", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.validateCredentials({
      clientId: "test",
      // missing clientSecret, accessToken, refreshToken, organizationId
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH_INVALID");
    }
  });

  it("returns AUTH_EXPIRED when API returns 401", async () => {
    const failingClient = makeFailingApiClient("Unauthorized", 401);
    const { adapter } = makeAdapter(failingClient);

    const result = await adapter.validateCredentials(VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH_EXPIRED");
    }
  });

  it("returns AUTH_INVALID when API throws generic error", async () => {
    const failingClient = makeFailingApiClient("Connection reset");
    const { adapter } = makeAdapter(failingClient);

    const result = await adapter.validateCredentials(VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH_INVALID");
    }
  });
});

// ============================================================================
// 7. Fetch Analytics Tests
// ============================================================================

describe("SnapchatAdapter - fetchAnalytics()", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns analytics with correct metrics mapping", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.fetchAnalytics({ channelId: "creative-123" }, VALID_CREDS);

    assert.ok(result.ok, "fetchAnalytics should succeed");
    if (result.ok) {
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
    }
  });

  it("passes date range parameters when provided", async () => {
    const { adapter } = makeAdapter();
    const since = new Date("2025-01-01T00:00:00Z");
    const until = new Date("2025-01-31T23:59:59Z");

    const result = await adapter.fetchAnalytics(
      { channelId: "creative-456", since, until },
      VALID_CREDS
    );

    assert.ok(result.ok, "fetchAnalytics should succeed");
    if (result.ok) {
      const data = result.value as { since?: Date; until?: Date };
      assert.deepStrictEqual(data.since, since);
      assert.deepStrictEqual(data.until, until);
    }
  });

  it("returns AUTH error when credentials are missing", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.fetchAnalytics({ channelId: "creative-789" }, undefined);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH");
    }
  });

  it("returns NETWORK error when API call fails", async () => {
    const failingClient = makeFailingApiClient("Server error", 500);
    const { adapter } = makeAdapter(failingClient);

    const result = await adapter.fetchAnalytics({ channelId: "creative-broken" }, VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "NETWORK");
    }
  });
});

// ============================================================================
// 8. Publish Additional Edge Cases
// ============================================================================

describe("SnapchatAdapter - publish() additional edge cases", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses post.text as caption when post.body is empty", async () => {
    const { adapter, client } = makeAdapter();
    const input = createTestPublishInput({
      body: "",
      text: "Fallback caption",
      media: [{ url: "https://example.com/photo.jpg", type: "image" }],
    });

    const result = await adapter.publish(input, VALID_CREDS);
    assert.ok(result.ok);
    const storyCall = client.createStory.mock.calls[0];
    assert.ok(storyCall, "createStory should have been called");
    assert.strictEqual(storyCall[1], "Fallback caption");
  });

  it("passes undefined caption when both body and text are empty", async () => {
    const { adapter, client } = makeAdapter();
    const input = createTestPublishInput({
      body: "",
      text: "",
      media: [{ url: "https://example.com/photo.jpg", type: "image" }],
    });

    const result = await adapter.publish(input, VALID_CREDS);
    assert.ok(result.ok);
    const storyCall = client.createStory.mock.calls[0];
    assert.strictEqual(storyCall?.[1], undefined);
  });

  it("returns VALIDATION when media is undefined in post", async () => {
    const { adapter } = makeAdapter();

    const input = {
      channelId: "chan-1",
      dedupeKey: "d-1",
      post: { body: "text", media: undefined },
    };

    const result = await adapter.publish(input, VALID_CREDS);
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "VALIDATION");
    }
  });

  it("constructs correct story URL from creative ID", async () => {
    const { adapter } = makeAdapter();
    const input = createTestPublishInput({
      media: [{ url: "https://example.com/photo.jpg", type: "image" }],
    });

    const result = await adapter.publish(input, VALID_CREDS);
    assert.ok(result.ok);
    if (result.ok) {
      assert.strictEqual(result.value.url, "https://www.snapchat.com/stories/creative-123");
    }
  });

  it("parses publishedAt from creative.created_at", async () => {
    const client = makeFakeApiClient({
      createStory: vi.fn(async () => ({
        creative: {
          id: "cr-x",
          name: "test",
          type: "SNAP_AD",
          created_at: "2025-06-15T12:30:00Z",
          updated_at: "2025-06-15T12:30:00Z",
          top_snap_media_id: "m-x",
        },
      })),
    });
    const { adapter } = makeAdapter(client);

    const input = createTestPublishInput({
      media: [{ url: "https://example.com/photo.jpg", type: "image" }],
    });

    const result = await adapter.publish(input, VALID_CREDS);
    assert.ok(result.ok);
    if (result.ok) {
      assert.strictEqual(result.value.publishedAt.toISOString(), "2025-06-15T12:30:00.000Z");
    }
  });

  it("passes image/jpeg for image media type", async () => {
    const { adapter, client } = makeAdapter();
    const input = createTestPublishInput({
      media: [{ url: "https://example.com/photo.jpg", type: "image" }],
    });

    await adapter.publish(input, VALID_CREDS);
    const uploadCall = client.uploadMedia.mock.calls[0];
    assert.strictEqual(uploadCall?.[1], "image/jpeg");
  });

  it("returns mapped error when non-circuit-breaker error occurs", async () => {
    const failingClient = makeFailingApiClient("Something went wrong");
    const { adapter } = makeAdapter(failingClient);

    const input = createTestPublishInput({
      media: [{ url: "https://example.com/photo.jpg", type: "image" }],
    });

    const result = await adapter.publish(input, VALID_CREDS);
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      // mapErrorToPublishError maps to NETWORK for generic errors
      assert.strictEqual(result.error, "NETWORK");
    }
  });
});

// ============================================================================
// 9. Analytics Edge Cases
// ============================================================================

describe("SnapchatAdapter - fetchAnalytics() edge cases", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("omits since from result when not provided", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.fetchAnalytics({ channelId: "cr-1" }, VALID_CREDS);
    assert.ok(result.ok);
    if (result.ok) {
      const data = result.value as Record<string, unknown>;
      assert.strictEqual(Object.prototype.hasOwnProperty.call(data, "since"), false);
    }
  });

  it("omits until from result when not provided", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.fetchAnalytics({ channelId: "cr-1" }, VALID_CREDS);
    assert.ok(result.ok);
    if (result.ok) {
      const data = result.value as Record<string, unknown>;
      assert.strictEqual(Object.prototype.hasOwnProperty.call(data, "until"), false);
    }
  });

  it("maps circuit breaker OPEN error to NETWORK in analytics", async () => {
    const failingClient = makeFailingApiClient("Circuit breaker is OPEN");
    const { adapter } = makeAdapter(failingClient);

    const result = await adapter.fetchAnalytics({ channelId: "cr-broken" }, VALID_CREDS);
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "NETWORK");
    }
  });

  it("maps hardcoded likes to 0 and comments to 0", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.fetchAnalytics({ channelId: "cr-1" }, VALID_CREDS);
    assert.ok(result.ok);
    if (result.ok) {
      const data = result.value as { metrics: { likes: number; comments: number } };
      assert.strictEqual(data.metrics.likes, 0);
      assert.strictEqual(data.metrics.comments, 0);
    }
  });
});
