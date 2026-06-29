/**
 * @file YouTubeAdapter.test.ts
 * @description Mutation-killing tests for YouTubeAdapter — metadata, render,
 *   credential validation, content-type routing, publish flows (Short / Live
 *   Stream / Community Post / Video), analytics, and inbox (getComments /
 *   postReply). The adapter takes credentials per-call; tests inject a fake
 *   `YouTubeApiClient` factory to avoid network/Google API calls.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { YouTubeAdapter, type YouTubeApiClientFactory } from "../src/YouTubeAdapter.js";
import type { YouTubeApiClient, YouTubeCredentials } from "../src/apiClient.js";
import type { CanonicalPost, RenderedPost } from "@shared/types";
import type { PublishInput } from "@ports/core";

// ============================================================================
// Helpers
// ============================================================================

interface FakeApiClient {
  validateCredentials: ReturnType<typeof vi.fn>;
  uploadVideo: ReturnType<typeof vi.fn>;
  getChannelAnalytics: ReturnType<typeof vi.fn>;
  getVideoComments: ReturnType<typeof vi.fn>;
  postComment: ReturnType<typeof vi.fn>;
}

function makeFakeApiClient(overrides: Partial<FakeApiClient> = {}): FakeApiClient {
  return {
    validateCredentials: vi.fn(async () => ({
      id: "channel-123",
      title: "Test Channel",
      description: "Test Description",
      subscriberCount: 1000,
      videoCount: 50,
      viewCount: 10000,
    })),
    uploadVideo: vi.fn(async (request: { title: string; description: string }) => ({
      id: "video-123",
      title: request.title,
      description: request.description,
      publishedAt: "2026-01-01T00:00:00Z",
      channelId: "channel-123",
    })),
    getChannelAnalytics: vi.fn(async () => ({
      views: 15000,
      likes: 450,
      comments: 120,
      shares: 85,
      subscribersGained: 30,
      subscribersLost: 5,
      watchTime: 72000,
    })),
    getVideoComments: vi.fn(async () => ({
      items: [
        {
          id: "thread-001",
          snippet: {
            topLevelComment: {
              id: "comment-yt-001",
              snippet: {
                textDisplay: "Great video!",
                authorDisplayName: "Alice",
                authorChannelId: { value: "channel-alice" },
                authorProfileImageUrl: "https://example.com/alice.jpg",
                publishedAt: "2026-03-10T10:00:00Z",
              },
            },
            totalReplyCount: 1,
          },
        },
        {
          id: "thread-002",
          snippet: {
            topLevelComment: {
              id: "comment-yt-002",
              snippet: {
                textDisplay: "Awesome content",
                authorDisplayName: "Bob",
                publishedAt: "2026-03-10T11:00:00Z",
              },
            },
            totalReplyCount: 0,
          },
        },
      ],
      nextPageToken: "page-token-next",
    })),
    postComment: vi.fn(async () => ({
      id: "reply-yt-new-001",
      publishedAt: "2026-03-10T12:00:00Z",
    })),
    ...overrides,
  };
}

function makeAdapter(client: FakeApiClient = makeFakeApiClient()) {
  const factory: YouTubeApiClientFactory = () => client as unknown as YouTubeApiClient;
  return new YouTubeAdapter({ apiClientFactory: factory });
}

const VALID_CREDS: YouTubeCredentials = {
  clientId: "client-id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
  channelId: "channel-001",
};

function makeCanonicalPost(overrides: Partial<CanonicalPost> = {}): CanonicalPost {
  return {
    id: "post-1",
    projectId: "project-1",
    locale: "en",
    body: "My Video Title\nThis is the description.",
    media: [{ id: "media-1", type: "video", url: "https://example.com/video.mp4" }],
    ...overrides,
  };
}

function makeInput(post: Partial<RenderedPost> = {}, channelId = "channel-001"): PublishInput {
  return {
    channelId,
    dedupeKey: "dedupe-001",
    post: {
      body: "Default body",
      media: [{ type: "video", url: "https://example.com/video.mp4" }],
      meta: {},
      ...post,
    },
  };
}

// ============================================================================
// Suite
// ============================================================================

describe("YouTubeAdapter", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  describe("metadata and capabilities", () => {
    const adapter = makeAdapter();

    it("has correct provider id", () => {
      assert.equal(adapter.id, "youtube");
    });

    it("has correct character limit of 5000", () => {
      assert.equal(adapter.limits.maxChars, 5000);
    });

    it("declares maxMediaPerPost as 1", () => {
      assert.equal(adapter.limits.maxMediaPerPost, 1);
    });

    it("declares threading as false", () => {
      assert.equal(adapter.capabilities.threading, false);
    });

    it("has correct metadata displayName", () => {
      assert.equal(adapter.metadata.displayName, "YouTube");
    });

    it("has correct metadata authType", () => {
      assert.equal(adapter.metadata.authType, "oauth");
    });

    it("has correct metadata status", () => {
      assert.equal(adapter.metadata.status, "active");
    });

    it("has correct allowed media types", () => {
      assert.deepEqual(adapter.limits.allowedMedia, ["video"]);
    });

    it("declares publish as true", () => {
      assert.equal(adapter.capabilities.publish, true);
    });

    it("declares schedule as true", () => {
      assert.equal(adapter.capabilities.schedule, true);
    });

    it("declares analytics as true", () => {
      assert.equal(adapter.capabilities.analytics, true);
    });

    it("declares comments as true", () => {
      assert.equal(adapter.capabilities.comments, true);
    });

    it("declares replies as true", () => {
      assert.equal(adapter.capabilities.replies, true);
    });

    it("has correct rateLimitHints", () => {
      assert.deepEqual(adapter.limits.rateLimitHints, { burst: 100, perSeconds: 3600 });
    });

    it("has correct aspect ratios", () => {
      assert.deepEqual(adapter.limits.aspectRatios, ["16:9", "9:16", "1:1"]);
    });

    it("declares threadingSupported as false in limits", () => {
      assert.equal(adapter.limits.threadingSupported, false);
    });

    it("requires correct OAuth scopes", () => {
      assert.deepEqual(adapter.metadata.requiredScopes, ["youtube.upload", "youtube.readonly"]);
    });

    it("has correct metadata color", () => {
      assert.equal(adapter.metadata.color, "#FF0000");
    });

    it("has correct metadata website", () => {
      assert.equal(adapter.metadata.website, "https://youtube.com");
    });

    it("has correct metadata icon", () => {
      assert.equal(adapter.metadata.icon, "/providers/youtube-icon.svg");
    });

    it("has correct metadata name", () => {
      assert.equal(adapter.metadata.name, "youtube");
    });

    it("has empty constraints object", () => {
      assert.deepEqual(adapter.constraints, {});
    });
  });

  // --------------------------------------------------------------------------
  describe("render", () => {
    const adapter = makeAdapter();

    it("returns ok with type=single for valid post with video and short body", () => {
      const result = adapter.render(makeCanonicalPost({ body: "My Video\nDescription" }));
      assert.ok(result.ok);
      assert.equal(result.value.type, "single");
      const content = result.value.content as {
        title: string;
        description: string;
        videoUrl: string;
      };
      assert.equal(content.title, "My Video");
      assert.equal(content.description, "My Video\nDescription");
      assert.equal(content.videoUrl, "https://example.com/video.mp4");
    });

    it("uses 'Untitled Video' when first line is empty", () => {
      const result = adapter.render(makeCanonicalPost({ body: "" }));
      assert.ok(result.ok);
      const content = result.value.content as { title: string };
      assert.equal(content.title, "Untitled Video");
    });

    it("returns CONTENT_TOO_LONG for description > 5000 chars", () => {
      const result = adapter.render(makeCanonicalPost({ body: "x".repeat(5001) }));
      assert.ok(!result.ok);
      assert.equal(result.error, "CONTENT_TOO_LONG");
    });

    it("returns ok for exactly 5000 chars", () => {
      const result = adapter.render(makeCanonicalPost({ body: "x".repeat(5000) }));
      assert.ok(result.ok);
    });

    it("returns VALIDATION_ERROR when no media", () => {
      const result = adapter.render(makeCanonicalPost({ media: [] }));
      assert.ok(!result.ok);
      assert.equal(result.error, "VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when more than 1 media item", () => {
      const result = adapter.render(
        makeCanonicalPost({
          media: [
            { id: "v1", type: "video", url: "https://example.com/v1.mp4" },
            { id: "v2", type: "video", url: "https://example.com/v2.mp4" },
          ],
        })
      );
      assert.ok(!result.ok);
      assert.equal(result.error, "VALIDATION_ERROR");
    });

    it("returns UNSUPPORTED_MEDIA for image media", () => {
      const result = adapter.render(
        makeCanonicalPost({
          media: [{ id: "img1", type: "image", url: "https://example.com/photo.jpg" }],
        })
      );
      assert.ok(!result.ok);
      assert.equal(result.error, "UNSUPPORTED_MEDIA");
    });

    it("includes videoUrl from media", () => {
      const url = "https://cdn.example.com/uploads/final.mp4";
      const result = adapter.render(
        makeCanonicalPost({ media: [{ id: "v1", type: "video", url }] })
      );
      assert.ok(result.ok);
      const content = result.value.content as { videoUrl: string };
      assert.equal(content.videoUrl, url);
    });
  });

  // --------------------------------------------------------------------------
  describe("validateCredentials", () => {
    it("returns AUTH_INVALID when credentials are missing clientId", async () => {
      const adapter = makeAdapter();
      const result = await adapter.validateCredentials({
        clientSecret: "x",
        refreshToken: "x",
        channelId: "x",
      });
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH_INVALID");
    });

    it("returns AUTH_INVALID when credentials are missing channelId", async () => {
      const adapter = makeAdapter();
      const result = await adapter.validateCredentials({
        clientId: "x",
        clientSecret: "x",
        refreshToken: "x",
      });
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH_INVALID");
    });

    it("returns AUTH_INVALID when credentials are null", async () => {
      const adapter = makeAdapter();
      const result = await adapter.validateCredentials(null);
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH_INVALID");
    });

    it("returns AUTH_INVALID when credentials are an empty object", async () => {
      const adapter = makeAdapter();
      const result = await adapter.validateCredentials({});
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH_INVALID");
    });

    it("returns ok when credentials are valid and API call succeeds", async () => {
      const adapter = makeAdapter();
      const result = await adapter.validateCredentials(VALID_CREDS);
      assert.ok(result.ok);
    });

    it("returns AUTH_INVALID when API call throws a generic error", async () => {
      const client = makeFakeApiClient({
        validateCredentials: vi.fn(async () => {
          throw new Error("API failure");
        }),
      });
      const adapter = makeAdapter(client);
      const result = await adapter.validateCredentials(VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH_INVALID");
    });

    it("returns AUTH_EXPIRED when API call throws a 401 error", async () => {
      const client = makeFakeApiClient({
        validateCredentials: vi.fn(async () => {
          const e = new Error("Unauthorized") as Error & { status: number };
          e.status = 401;
          throw e;
        }),
      });
      const adapter = makeAdapter(client);
      const result = await adapter.validateCredentials(VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH_EXPIRED");
    });
  });

  // --------------------------------------------------------------------------
  describe("publish — auth & validation", () => {
    it("returns AUTH error when credentials are missing", async () => {
      const adapter = makeAdapter();
      const result = await adapter.publish(makeInput(), undefined);
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });

    it("returns AUTH error when credentials lack clientId", async () => {
      const adapter = makeAdapter();
      const result = await adapter.publish(makeInput(), {
        clientSecret: "x",
        refreshToken: "x",
        channelId: "x",
      });
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });
  });

  // --------------------------------------------------------------------------
  describe("publish — VIDEO flow (default)", () => {
    it("uploads a regular video via apiClient.uploadVideo", async () => {
      const client = makeFakeApiClient();
      const adapter = makeAdapter(client);
      const result = await adapter.publish(
        makeInput({ body: "My Video\nDescription line" }),
        VALID_CREDS
      );
      assert.ok(result.ok);
      assert.equal(result.value.providerPostId, "video-123");
      assert.equal(client.uploadVideo.mock.calls.length, 1);
    });

    it("constructs the watch URL with the returned video id", async () => {
      const adapter = makeAdapter();
      const result = await adapter.publish(makeInput(), VALID_CREDS);
      assert.ok(result.ok);
      assert.equal(result.value.url, "https://www.youtube.com/watch?v=video-123");
    });

    it("extracts title from first line of body", async () => {
      const client = makeFakeApiClient();
      const adapter = makeAdapter(client);
      await adapter.publish(makeInput({ body: "Custom Title\nLine 2" }), VALID_CREDS);
      const call = client.uploadVideo.mock.calls[0];
      assert.ok(call);
      assert.equal((call[0] as { title: string }).title, "Custom Title");
    });

    it("uses 'Untitled Video' when first line is empty", async () => {
      const client = makeFakeApiClient();
      const adapter = makeAdapter(client);
      await adapter.publish(makeInput({ body: "" }), VALID_CREDS);
      const call = client.uploadVideo.mock.calls[0];
      assert.ok(call);
      assert.equal((call[0] as { title: string }).title, "Untitled Video");
    });

    it("returns NETWORK on circuit-breaker open during apiClient creation", async () => {
      const factory: YouTubeApiClientFactory = () => {
        throw new Error("Circuit breaker is OPEN for youtube-api");
      };
      const adapter = new YouTubeAdapter({ apiClientFactory: factory });
      const result = await adapter.publish(makeInput(), VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "NETWORK");
    });

    it("maps a 500 upload failure to NETWORK", async () => {
      const client = makeFakeApiClient({
        uploadVideo: vi.fn(async () => {
          const e = new Error("Internal server error") as Error & { status: number };
          e.status = 500;
          throw e;
        }),
      });
      const adapter = makeAdapter(client);
      const result = await adapter.publish(makeInput(), VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "NETWORK");
    });

    it("maps a 401 upload failure to AUTH", async () => {
      const client = makeFakeApiClient({
        uploadVideo: vi.fn(async () => {
          const e = new Error("Unauthorized") as Error & { status: number };
          e.status = 401;
          throw e;
        }),
      });
      const adapter = makeAdapter(client);
      const result = await adapter.publish(makeInput(), VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });

    // §2F Slice 1: a 403 quotaExceeded is a TRANSIENT throttle. Classifying it
    // as AUTH (the naive `status===403` path) would falsely trip reauth.
    it("maps a 403 quotaExceeded upload failure to RATE_LIMIT (NOT AUTH)", async () => {
      const client = makeFakeApiClient({
        uploadVideo: vi.fn(async () => {
          const e = new Error("quota") as Error & { status: number; errors: unknown[] };
          e.status = 403;
          e.errors = [{ reason: "quotaExceeded" }];
          throw e;
        }),
      });
      const adapter = makeAdapter(client);
      const result = await adapter.publish(makeInput(), VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "RATE_LIMIT");
    });

    // §2F Slice 1 (real propagation): the REAL Gaxios error the apiClient +
    // circuit breaker propagate carries the quota reason NESTED under
    // `response.data.error.errors[].reason` (gaxios 7 / googleapis-common 8),
    // NOT at top-level `errors[]`. Proves the adapter catch + mapper classify a
    // genuine quota 403 as RATE_LIMIT (not the false AUTH/reauth).
    it("maps a real Gaxios 403 quota (nested errors) upload failure to RATE_LIMIT", async () => {
      const client = makeFakeApiClient({
        uploadVideo: vi.fn(async () => {
          const e = new Error("exceeded your quota") as Error & {
            status: number;
            response: { status: number; data: { error: { errors: { reason: string }[] } } };
          };
          e.status = 403;
          e.response = {
            status: 403,
            data: { error: { errors: [{ reason: "quotaExceeded" }] } },
          };
          throw e;
        }),
      });
      const adapter = makeAdapter(client);
      const result = await adapter.publish(makeInput(), VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "RATE_LIMIT");
    });

    // §2F Slice 1: a ProviderError carries `statusCode` (not `status`); the
    // mapper must read it so a 401 ProviderError surfaces AUTH, not NETWORK.
    it("maps a ProviderError-shaped 401 (statusCode, not status) to AUTH", async () => {
      const client = makeFakeApiClient({
        uploadVideo: vi.fn(async () => {
          const e = new Error("token revoked") as Error & { statusCode: number; code: string };
          e.statusCode = 401;
          e.code = "AUTH_INVALID_CREDENTIALS";
          throw e;
        }),
      });
      const adapter = makeAdapter(client);
      const result = await adapter.publish(makeInput(), VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });
  });

  // --------------------------------------------------------------------------
  describe("publish — content type detection", () => {
    function detect(adapter: YouTubeAdapter, post: RenderedPost): string {
      return (
        adapter as unknown as {
          detectContentType: (p: RenderedPost) => string;
        }
      ).detectContentType(post);
    }

    it("detects SHORT from meta.contentType='short'", () => {
      const adapter = makeAdapter();
      const post: RenderedPost = {
        body: "x",
        media: [{ type: "video", url: "https://example.com/v.mp4" }],
        meta: { contentType: "short" },
      };
      assert.equal(detect(adapter, post), "SHORT");
    });

    it("detects SHORT from meta.type='SHORT'", () => {
      const adapter = makeAdapter();
      const post: RenderedPost = {
        body: "x",
        media: [{ type: "video", url: "https://example.com/v.mp4" }],
        meta: { type: "SHORT" },
      };
      assert.equal(detect(adapter, post), "SHORT");
    });

    it("detects SHORT from aspect ratio 9:16 with video", () => {
      const adapter = makeAdapter();
      const post: RenderedPost = {
        body: "x",
        media: [{ type: "video", url: "https://example.com/v.mp4" }],
        meta: { aspectRatio: "9:16" },
      };
      assert.equal(detect(adapter, post), "SHORT");
    });

    it("detects SHORT from isShort flag", () => {
      const adapter = makeAdapter();
      const post: RenderedPost = {
        body: "x",
        media: [{ type: "video", url: "https://example.com/v.mp4" }],
        meta: { isShort: true },
      };
      assert.equal(detect(adapter, post), "SHORT");
    });

    it("detects SHORT from durationSeconds<=60 + aspectRatio 9:16", () => {
      const adapter = makeAdapter();
      const post: RenderedPost = {
        body: "x",
        media: [{ type: "video", url: "https://example.com/v.mp4" }],
        meta: { aspectRatio: "9:16", durationSeconds: 30 },
      };
      assert.equal(detect(adapter, post), "SHORT");
    });

    it("detects COMMUNITY_POST from meta.contentType='community'", () => {
      const adapter = makeAdapter();
      const post: RenderedPost = { body: "x", meta: { contentType: "community" } };
      assert.equal(detect(adapter, post), "COMMUNITY_POST");
    });

    it("detects COMMUNITY_POST when no media is present", () => {
      const adapter = makeAdapter();
      const post: RenderedPost = { body: "Text only", media: [] };
      assert.equal(detect(adapter, post), "COMMUNITY_POST");
    });

    it("detects LIVE_STREAM from meta.contentType='live'", () => {
      const adapter = makeAdapter();
      const post: RenderedPost = {
        body: "x",
        media: [{ type: "video", url: "https://example.com/v.mp4" }],
        meta: { contentType: "live" },
      };
      assert.equal(detect(adapter, post), "LIVE_STREAM");
    });

    it("detects LIVE_STREAM from isLive flag", () => {
      const adapter = makeAdapter();
      const post: RenderedPost = {
        body: "x",
        media: [{ type: "video", url: "https://example.com/v.mp4" }],
        meta: { isLive: true },
      };
      assert.equal(detect(adapter, post), "LIVE_STREAM");
    });

    it("detects LIVE_STREAM from streamKey metadata", () => {
      const adapter = makeAdapter();
      const post: RenderedPost = {
        body: "x",
        media: [{ type: "video", url: "https://example.com/v.mp4" }],
        meta: { streamKey: "key-001" },
      };
      assert.equal(detect(adapter, post), "LIVE_STREAM");
    });

    it("detects LIVE_STREAM from scheduledStartTime metadata", () => {
      const adapter = makeAdapter();
      const post: RenderedPost = {
        body: "x",
        media: [{ type: "video", url: "https://example.com/v.mp4" }],
        meta: { scheduledStartTime: new Date("2026-12-01T10:00:00Z").toISOString() },
      };
      assert.equal(detect(adapter, post), "LIVE_STREAM");
    });

    it("detects VIDEO as default for horizontal video without other hints", () => {
      const adapter = makeAdapter();
      const post: RenderedPost = {
        body: "x",
        media: [{ type: "video", url: "https://example.com/v.mp4" }],
        meta: { aspectRatio: "16:9" },
      };
      assert.equal(detect(adapter, post), "VIDEO");
    });

    it("detects VIDEO for video without any specific metadata", () => {
      const adapter = makeAdapter();
      const post: RenderedPost = {
        body: "x",
        media: [{ type: "video", url: "https://example.com/v.mp4" }],
      };
      assert.equal(detect(adapter, post), "VIDEO");
    });
  });

  // --------------------------------------------------------------------------
  describe("publish — COMMUNITY_POST", () => {
    it("returns VALIDATION (out of scope without YPP)", async () => {
      const adapter = makeAdapter();
      const result = await adapter.publish(
        makeInput({ body: "Community post", media: [], meta: { contentType: "community" } }),
        VALID_CREDS
      );
      assert.ok(!result.ok);
      assert.equal(result.error, "VALIDATION");
    });
  });

  // --------------------------------------------------------------------------
  describe("fetchAnalytics", () => {
    it("returns AUTH error when credentials missing", async () => {
      const adapter = makeAdapter();
      const result = await adapter.fetchAnalytics({ channelId: "ch-1" }, undefined);
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });

    it("returns ok with channel analytics under metrics", async () => {
      const adapter = makeAdapter();
      const result = await adapter.fetchAnalytics({ channelId: "ch-1" }, VALID_CREDS);
      assert.ok(result.ok);
      const data = result.value as {
        channelId: string;
        metrics: {
          views: number;
          likes: number;
          comments: number;
          shares: number;
          watchTime: number;
          engagements: number;
          clicks: number;
        };
      };
      assert.equal(data.channelId, "ch-1");
      assert.equal(data.metrics.views, 15000);
      assert.equal(data.metrics.likes, 450);
      assert.equal(data.metrics.comments, 120);
      assert.equal(data.metrics.shares, 85);
      assert.equal(data.metrics.watchTime, 72000);
      // engagements = likes + comments
      assert.equal(data.metrics.engagements, 570);
      // clicks = subscribersGained
      assert.equal(data.metrics.clicks, 30);
    });

    it("forwards since/until to the api client", async () => {
      const client = makeFakeApiClient();
      const adapter = makeAdapter(client);
      const since = new Date("2026-01-01T00:00:00Z");
      const until = new Date("2026-01-31T23:59:59Z");
      const result = await adapter.fetchAnalytics({ channelId: "ch-1", since, until }, VALID_CREDS);
      assert.ok(result.ok);
      const call = client.getChannelAnalytics.mock.calls[0];
      assert.ok(call);
      assert.deepEqual(call[0], since);
      assert.deepEqual(call[1], until);
    });

    it("returns NETWORK on circuit-breaker open", async () => {
      const client = makeFakeApiClient({
        getChannelAnalytics: vi.fn(async () => {
          throw new Error("Circuit breaker is OPEN for youtube-api");
        }),
      });
      const adapter = makeAdapter(client);
      const result = await adapter.fetchAnalytics({ channelId: "ch-1" }, VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "NETWORK");
    });

    it("returns NETWORK on generic error", async () => {
      const client = makeFakeApiClient({
        getChannelAnalytics: vi.fn(async () => {
          throw new Error("Connection timeout");
        }),
      });
      const adapter = makeAdapter(client);
      const result = await adapter.fetchAnalytics({ channelId: "ch-1" }, VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "NETWORK");
    });
  });

  // --------------------------------------------------------------------------
  describe("getComments", () => {
    it("returns empty list when no postExternalId is provided", async () => {
      const adapter = makeAdapter();
      const result = await adapter.getComments({ channelCredentials: VALID_CREDS });
      assert.ok(result.ok);
      assert.equal(result.value.comments.length, 0);
    });

    it("returns AUTH when credentials are invalid", async () => {
      const adapter = makeAdapter();
      const result = await adapter.getComments({
        channelCredentials: {},
        postExternalId: "video-001",
      });
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });

    it("maps comment threads into ProviderComment shape", async () => {
      const adapter = makeAdapter();
      const result = await adapter.getComments({
        channelCredentials: VALID_CREDS,
        postExternalId: "video-001",
      });
      assert.ok(result.ok);
      assert.equal(result.value.comments.length, 2);

      const first = result.value.comments[0];
      assert.ok(first);
      assert.equal(first.providerMessageId, "comment-yt-001");
      assert.equal(first.authorName, "Alice");
      assert.equal(first.authorProviderId, "channel-alice");
      assert.equal(first.authorAvatarUrl, "https://example.com/alice.jpg");
      assert.equal(first.body, "Great video!");

      const second = result.value.comments[1];
      assert.ok(second);
      assert.equal(second.authorProviderId, "");
      assert.equal(second.authorAvatarUrl, undefined);

      assert.equal(result.value.nextCursor, "page-token-next");
    });

    it("forwards cursor and limit to the api client", async () => {
      const client = makeFakeApiClient();
      const adapter = makeAdapter(client);
      await adapter.getComments({
        channelCredentials: VALID_CREDS,
        postExternalId: "video-001",
        cursor: "page-token-abc",
        limit: 50,
      });
      const call = client.getVideoComments.mock.calls[0];
      assert.ok(call);
      assert.equal(call[0], "video-001");
      assert.equal(call[1], 50);
      assert.equal(call[2], "page-token-abc");
    });

    it("returns NETWORK on api client failure", async () => {
      const client = makeFakeApiClient({
        getVideoComments: vi.fn(async () => {
          throw new Error("API error");
        }),
      });
      const adapter = makeAdapter(client);
      const result = await adapter.getComments({
        channelCredentials: VALID_CREDS,
        postExternalId: "video-001",
      });
      assert.ok(!result.ok);
      assert.equal(result.error, "NETWORK");
    });

    it("returns AUTH when api client throws a 401 error", async () => {
      const client = makeFakeApiClient({
        getVideoComments: vi.fn(async () => {
          throw new Error("HTTP 401 Unauthorized");
        }),
      });
      const adapter = makeAdapter(client);
      const result = await adapter.getComments({
        channelCredentials: VALID_CREDS,
        postExternalId: "video-001",
      });
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });
  });

  // --------------------------------------------------------------------------
  describe("postReply", () => {
    it("returns AUTH when credentials missing", async () => {
      const adapter = makeAdapter();
      const result = await adapter.postReply({
        channelCredentials: undefined,
        inReplyToProviderMessageId: "comment-001",
        body: "reply",
      });
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });

    it("posts a reply and forwards parent comment id", async () => {
      const client = makeFakeApiClient();
      const adapter = makeAdapter(client);
      const result = await adapter.postReply({
        channelCredentials: VALID_CREDS,
        inReplyToProviderMessageId: "comment-yt-001",
        body: "Thanks for watching!",
        postExternalId: "video-001",
      });
      assert.ok(result.ok);
      assert.equal(result.value.providerReplyId, "reply-yt-new-001");
      assert.ok(result.value.createdAt instanceof Date);

      const call = client.postComment.mock.calls[0];
      assert.ok(call);
      assert.equal(call[0], "video-001");
      assert.equal(call[1], "Thanks for watching!");
      assert.equal(call[2], "comment-yt-001");
    });

    it("returns RATE_LIMIT on 429 error", async () => {
      const client = makeFakeApiClient({
        postComment: vi.fn(async () => {
          throw new Error("429 Too Many Requests");
        }),
      });
      const adapter = makeAdapter(client);
      const result = await adapter.postReply({
        channelCredentials: VALID_CREDS,
        inReplyToProviderMessageId: "comment-001",
        body: "reply",
        postExternalId: "video-001",
      });
      assert.ok(!result.ok);
      assert.equal(result.error, "RATE_LIMIT");
    });

    it("returns AUTH on 401/403", async () => {
      const client = makeFakeApiClient({
        postComment: vi.fn(async () => {
          throw new Error("HTTP 403 Forbidden");
        }),
      });
      const adapter = makeAdapter(client);
      const result = await adapter.postReply({
        channelCredentials: VALID_CREDS,
        inReplyToProviderMessageId: "comment-001",
        body: "reply",
        postExternalId: "video-001",
      });
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });

    it("returns NETWORK on generic error", async () => {
      const client = makeFakeApiClient({
        postComment: vi.fn(async () => {
          throw new Error("Connection refused");
        }),
      });
      const adapter = makeAdapter(client);
      const result = await adapter.postReply({
        channelCredentials: VALID_CREDS,
        inReplyToProviderMessageId: "comment-001",
        body: "reply",
        postExternalId: "video-001",
      });
      assert.ok(!result.ok);
      assert.equal(result.error, "NETWORK");
    });
  });

  // --------------------------------------------------------------------------
  describe("publishThread — not supported", () => {
    it("publishThread is not implemented (threading not supported on YouTube)", () => {
      const adapter = makeAdapter();
      assert.equal(
        typeof (adapter as unknown as { publishThread?: unknown }).publishThread,
        "undefined"
      );
    });
  });
});
