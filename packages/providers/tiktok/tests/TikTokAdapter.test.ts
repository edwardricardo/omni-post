/**
 * @file TikTokAdapter.test.ts
 * @description Mutation-killing tests for TikTokAdapter — metadata, render
 *   (video + photo carousel), credential validation, publish flow (video and
 *   photo), hashtag strategy enrichment, fetchAnalytics, and the
 *   not-yet-implemented promoted-content path. The adapter takes credentials
 *   per-call; tests inject fake API / research / marketing factories so no
 *   network call is made.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import {
  TikTokAdapter,
  type TikTokApiClientFactory,
  type ResearchClientFactory,
  type MarketingClientFactory,
} from "../src/TikTokAdapter.js";
import type { TikTokApiClient, TikTokCredentials } from "../src/apiClient.js";
import type { TikTokResearchApiClient } from "../src/researchApiClient.js";
import type { TikTokMarketingApiClient } from "../src/marketingApiClient.js";
import type { CanonicalPost, RenderedPost } from "@shared/types";
import type { PublishInput } from "@ports/core";

// ============================================================================
// Helpers
// ============================================================================

interface FakeApiClient {
  validateCredentials: ReturnType<typeof vi.fn>;
  uploadVideo: ReturnType<typeof vi.fn>;
  publishPhotoPost: ReturnType<typeof vi.fn>;
  getUserInfo: ReturnType<typeof vi.fn>;
}

function makeFakeApiClient(overrides: Partial<FakeApiClient> = {}): FakeApiClient {
  return {
    validateCredentials: vi.fn(async () => ({
      openId: "user-123",
      unionId: "union-123",
      avatarUrl: "https://example.com/a.jpg",
      displayName: "Test User",
      followerCount: 1000,
      followingCount: 200,
      likesCount: 5000,
      videoCount: 50,
      profileDeepLink: "https://tiktok.com/@user",
    })),
    uploadVideo: vi.fn(async () => ({
      shareId: "video-001",
      shareUrl: "https://www.tiktok.com/@user/video/video-001",
      uniqueId: "video-001",
    })),
    publishPhotoPost: vi.fn(async () => ({
      shareId: "photo-001",
      shareUrl: "https://www.tiktok.com/@user/photo/photo-001",
      uniqueId: "photo-001",
    })),
    getUserInfo: vi.fn(async () => ({
      openId: "user-123",
      unionId: "union-123",
      avatarUrl: "https://example.com/a.jpg",
      displayName: "Test User",
      followerCount: 1000,
      followingCount: 200,
      likesCount: 5000,
      videoCount: 50,
      profileDeepLink: "https://tiktok.com/@user",
    })),
    ...overrides,
  };
}

interface FakeResearchClient {
  getTrendingHashtags: ReturnType<typeof vi.fn>;
  getCredentialScope: ReturnType<typeof vi.fn>;
}

function makeFakeResearchClient(shouldFail = false): FakeResearchClient {
  if (shouldFail) {
    return {
      getTrendingHashtags: vi.fn(async () => {
        throw new Error("Research API unavailable");
      }),
      getCredentialScope: vi.fn(() => "mock-research-scope"),
    };
  }
  return {
    getTrendingHashtags: vi.fn(async () => [
      {
        hashtag: "viral",
        volume: 100000,
        growth: 50,
        difficulty: 40,
        engagement: 85,
        category: "general",
        relatedHashtags: ["trending"],
        trendingScore: 90,
      },
    ]),
    getCredentialScope: vi.fn(() => "mock-research-scope"),
  };
}

interface FakeMarketingClient {
  getAdAccount: ReturnType<typeof vi.fn>;
}

interface AdapterDepsForTest {
  client?: FakeApiClient;
  research?: FakeResearchClient;
  marketing?: FakeMarketingClient;
}

function makeAdapter(deps: AdapterDepsForTest = {}) {
  const apiClient = deps.client ?? makeFakeApiClient();
  const apiClientFactory: TikTokApiClientFactory = () => apiClient as unknown as TikTokApiClient;

  const adapterDeps: {
    apiClientFactory: TikTokApiClientFactory;
    researchClientFactory?: ResearchClientFactory;
    marketingClientFactory?: MarketingClientFactory;
  } = { apiClientFactory };

  if (deps.research) {
    const research = deps.research;
    adapterDeps.researchClientFactory = () => research as unknown as TikTokResearchApiClient;
  }
  if (deps.marketing) {
    const marketing = deps.marketing;
    adapterDeps.marketingClientFactory = () => marketing as unknown as TikTokMarketingApiClient;
  }

  return new TikTokAdapter(adapterDeps);
}

const VALID_CREDS: TikTokCredentials = {
  clientKey: "key",
  clientSecret: "secret",
  accessToken: "token",
  openId: "user-123",
};

function makeCanonicalPost(overrides: Partial<CanonicalPost> = {}): CanonicalPost {
  return {
    id: "post-1",
    projectId: "project-1",
    locale: "en",
    body: "TikTok video description",
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

describe("TikTokAdapter", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  describe("metadata and capabilities", () => {
    const adapter = makeAdapter();

    it("has correct provider id", () => {
      assert.equal(adapter.id, "tiktok");
    });

    it("has correct character limit of 2200", () => {
      assert.equal(adapter.limits.maxChars, 2200);
    });

    it("declares maxMediaPerPost as 35", () => {
      assert.equal(adapter.limits.maxMediaPerPost, 35);
    });

    it("declares threading as false", () => {
      assert.equal(adapter.capabilities.threading, false);
    });

    it("has correct metadata displayName", () => {
      assert.equal(adapter.metadata.displayName, "TikTok");
    });

    it("has correct metadata authType", () => {
      assert.equal(adapter.metadata.authType, "oauth");
    });

    it("has correct metadata status", () => {
      assert.equal(adapter.metadata.status, "active");
    });

    it("allows both video and image media", () => {
      assert.deepEqual(adapter.limits.allowedMedia, ["video", "image"]);
    });

    it("declares publish as true", () => {
      assert.equal(adapter.capabilities.publish, true);
    });

    it("declares schedule as false", () => {
      assert.equal(adapter.capabilities.schedule, false);
    });

    it("declares analytics as true", () => {
      assert.equal(adapter.capabilities.analytics, true);
    });

    it("declares comments as false", () => {
      assert.equal(adapter.capabilities.comments, false);
    });

    it("declares replies as false", () => {
      assert.equal(adapter.capabilities.replies, false);
    });

    it("has correct rateLimitHints", () => {
      assert.deepEqual(adapter.limits.rateLimitHints, { burst: 50, perSeconds: 3600 });
    });

    it("has correct aspect ratios", () => {
      assert.deepEqual(adapter.limits.aspectRatios, ["9:16", "1:1", "16:9"]);
    });

    it("declares threadingSupported as false in limits", () => {
      assert.equal(adapter.limits.threadingSupported, false);
    });

    it("requires correct OAuth scopes", () => {
      assert.deepEqual(adapter.metadata.requiredScopes, ["video.upload", "user.info.basic"]);
    });

    it("has correct metadata color", () => {
      assert.equal(adapter.metadata.color, "#000000");
    });

    it("has correct metadata website", () => {
      assert.equal(adapter.metadata.website, "https://tiktok.com");
    });

    it("has correct metadata icon", () => {
      assert.equal(adapter.metadata.icon, "/providers/tiktok-icon.svg");
    });

    it("has correct metadata name", () => {
      assert.equal(adapter.metadata.name, "tiktok");
    });

    it("has empty constraints object", () => {
      assert.deepEqual(adapter.constraints, {});
    });
  });

  // --------------------------------------------------------------------------
  describe("render — video posts", () => {
    const adapter = makeAdapter();

    it("returns ok with type=single for valid video post", () => {
      const result = adapter.render(makeCanonicalPost());
      assert.ok(result.ok);
      assert.equal(result.value.type, "single");
      const content = result.value.content as { body: string; videoUrl: string };
      assert.equal(content.body, "TikTok video description");
      assert.equal(content.videoUrl, "https://example.com/video.mp4");
    });

    it("does not set meta.contentType for video posts", () => {
      const result = adapter.render(makeCanonicalPost());
      assert.ok(result.ok);
      assert.equal(result.value.meta?.contentType, undefined);
    });

    it("returns CONTENT_TOO_LONG for body > 2200 chars", () => {
      const result = adapter.render(makeCanonicalPost({ body: "x".repeat(2201) }));
      assert.ok(!result.ok);
      assert.equal(result.error, "CONTENT_TOO_LONG");
    });

    it("returns ok for body exactly 2200 chars", () => {
      const result = adapter.render(makeCanonicalPost({ body: "x".repeat(2200) }));
      assert.ok(result.ok);
    });

    it("returns MEDIA_REQUIRED when media is empty", () => {
      const result = adapter.render(makeCanonicalPost({ media: [] }));
      assert.ok(!result.ok);
      assert.equal(result.error, "MEDIA_REQUIRED");
    });

    it("returns TOO_MANY_MEDIA when video post has more than 1 video", () => {
      const result = adapter.render(
        makeCanonicalPost({
          media: [
            { id: "v1", type: "video", url: "https://example.com/v1.mp4" },
            { id: "v2", type: "video", url: "https://example.com/v2.mp4" },
          ],
        })
      );
      assert.ok(!result.ok);
      assert.equal(result.error, "TOO_MANY_MEDIA");
    });

    it("returns INVALID_MEDIA_TYPE for mixed image+video media", () => {
      const result = adapter.render(
        makeCanonicalPost({
          media: [
            { id: "img1", type: "image", url: "https://example.com/i.jpg" },
            { id: "v1", type: "video", url: "https://example.com/v.mp4" },
          ],
        })
      );
      assert.ok(!result.ok);
      assert.equal(result.error, "INVALID_MEDIA_TYPE");
    });
  });

  // --------------------------------------------------------------------------
  describe("render — photo posts", () => {
    const adapter = makeAdapter();

    it("renders a single-image post as photo", () => {
      const result = adapter.render(
        makeCanonicalPost({
          body: "Photo post",
          media: [{ id: "img1", type: "image", url: "https://example.com/photo.jpg" }],
        })
      );
      assert.ok(result.ok);
      assert.equal(result.value.meta?.contentType, "photo");
      const content = result.value.content as { media: unknown[] };
      assert.equal(content.media.length, 1);
    });

    it("renders a multi-image carousel as photo", () => {
      const result = adapter.render(
        makeCanonicalPost({
          body: "Carousel",
          media: [
            { id: "1", type: "image", url: "https://example.com/p1.jpg" },
            { id: "2", type: "image", url: "https://example.com/p2.jpg" },
            { id: "3", type: "image", url: "https://example.com/p3.jpg" },
          ],
        })
      );
      assert.ok(result.ok);
      const content = result.value.content as { media: unknown[] };
      assert.equal(content.media.length, 3);
      assert.equal(result.value.meta?.contentType, "photo");
    });

    it("returns TOO_MANY_MEDIA when photo post exceeds 35 images", () => {
      const media = Array.from({ length: 36 }, (_, i) => ({
        id: `img-${i}`,
        type: "image" as const,
        url: `https://example.com/p${i}.jpg`,
      }));
      const result = adapter.render(makeCanonicalPost({ body: "Too many", media }));
      assert.ok(!result.ok);
      assert.equal(result.error, "TOO_MANY_MEDIA");
    });

    it("accepts exactly 35 images", () => {
      const media = Array.from({ length: 35 }, (_, i) => ({
        id: `img-${i}`,
        type: "image" as const,
        url: `https://example.com/p${i}.jpg`,
      }));
      const result = adapter.render(makeCanonicalPost({ body: "Max", media }));
      assert.ok(result.ok);
    });

    it("includes alt text in mapped media when provided", () => {
      const result = adapter.render(
        makeCanonicalPost({
          body: "alt test",
          media: [
            { id: "1", type: "image", url: "https://example.com/p1.jpg", alt: "Alt A" },
            { id: "2", type: "image", url: "https://example.com/p2.jpg" },
          ],
        })
      );
      assert.ok(result.ok);
      const media = (result.value.content as { media: Array<{ alt?: string }> }).media;
      assert.equal(media[0]?.alt, "Alt A");
      assert.equal(Object.prototype.hasOwnProperty.call(media[1], "alt"), false);
    });
  });

  // --------------------------------------------------------------------------
  describe("validateCredentials", () => {
    it("returns AUTH_INVALID when missing clientKey", async () => {
      const adapter = makeAdapter();
      const result = await adapter.validateCredentials({
        clientSecret: "x",
        accessToken: "x",
        openId: "x",
      });
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH_INVALID");
    });

    it("returns AUTH_INVALID when missing accessToken", async () => {
      const adapter = makeAdapter();
      const result = await adapter.validateCredentials({
        clientKey: "x",
        clientSecret: "x",
        openId: "x",
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

    it("returns ok when credentials are valid and API call succeeds", async () => {
      const adapter = makeAdapter();
      const result = await adapter.validateCredentials(VALID_CREDS);
      assert.ok(result.ok);
    });

    it("returns AUTH_INVALID on generic API failure", async () => {
      const client = makeFakeApiClient({
        validateCredentials: vi.fn(async () => {
          throw new Error("API failure");
        }),
      });
      const adapter = makeAdapter({ client });
      const result = await adapter.validateCredentials(VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH_INVALID");
    });

    it("returns AUTH_EXPIRED on 401 error", async () => {
      const client = makeFakeApiClient({
        validateCredentials: vi.fn(async () => {
          const e = new Error("Unauthorized") as Error & { status: number };
          e.status = 401;
          throw e;
        }),
      });
      const adapter = makeAdapter({ client });
      const result = await adapter.validateCredentials(VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH_EXPIRED");
    });
  });

  // --------------------------------------------------------------------------
  describe("publish — auth & validation", () => {
    it("returns AUTH when credentials are missing", async () => {
      const adapter = makeAdapter();
      const result = await adapter.publish(makeInput(), undefined);
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });

    it("returns AUTH when credentials are incomplete", async () => {
      const adapter = makeAdapter();
      const result = await adapter.publish(makeInput(), { clientKey: "x" });
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });

    it("returns VALIDATION when post has no media", async () => {
      const adapter = makeAdapter();
      const result = await adapter.publish(makeInput({ media: [] }), VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "VALIDATION");
    });
  });

  // --------------------------------------------------------------------------
  describe("publish — video flow", () => {
    it("uploads a public video by default", async () => {
      const client = makeFakeApiClient();
      const adapter = makeAdapter({ client });
      const result = await adapter.publish(makeInput({ body: "Hello TikTok" }), VALID_CREDS);
      assert.ok(result.ok);
      assert.equal(result.value.providerPostId, "video-001");
      const call = client.uploadVideo.mock.calls[0];
      assert.ok(call);
      assert.equal((call[0] as { privacy: string }).privacy, "public");
    });

    it("uploads a private video when meta.privacy='private'", async () => {
      const client = makeFakeApiClient();
      const adapter = makeAdapter({ client });
      const result = await adapter.publish(
        makeInput({ body: "Private", meta: { privacy: "private" } }),
        VALID_CREDS
      );
      assert.ok(result.ok);
      const call = client.uploadVideo.mock.calls[0];
      assert.ok(call);
      assert.equal((call[0] as { privacy: string }).privacy, "private");
    });

    it("forwards interaction settings (disableComment, disableDuet, disableStitch)", async () => {
      const client = makeFakeApiClient();
      const adapter = makeAdapter({ client });
      await adapter.publish(
        makeInput({
          meta: { disableComment: true, disableDuet: false, disableStitch: true },
        }),
        VALID_CREDS
      );
      const call = client.uploadVideo.mock.calls[0];
      assert.ok(call);
      const args = call[0] as {
        disableComment?: boolean;
        disableDuet?: boolean;
        disableStitch?: boolean;
      };
      assert.equal(args.disableComment, true);
      assert.equal(args.disableDuet, false);
      assert.equal(args.disableStitch, true);
    });

    it("falls back to a constructed URL when shareUrl is empty", async () => {
      const client = makeFakeApiClient({
        uploadVideo: vi.fn(async () => ({
          shareId: "vid-xyz",
          shareUrl: "",
          uniqueId: "vid-xyz",
        })),
      });
      const adapter = makeAdapter({ client });
      const result = await adapter.publish(makeInput(), VALID_CREDS);
      assert.ok(result.ok);
      assert.equal(result.value.url, "https://www.tiktok.com/@user-123/video/vid-xyz");
    });

    it("returns NETWORK on circuit-breaker open during publish", async () => {
      const client = makeFakeApiClient({
        uploadVideo: vi.fn(async () => {
          throw new Error("Circuit breaker is OPEN for tiktok-api");
        }),
      });
      const adapter = makeAdapter({ client });
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
      const adapter = makeAdapter({ client });
      const result = await adapter.publish(makeInput(), VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });
  });

  // --------------------------------------------------------------------------
  describe("publish — photo flow", () => {
    it("publishes a photo carousel via publishPhotoPost", async () => {
      const client = makeFakeApiClient();
      const adapter = makeAdapter({ client });
      const result = await adapter.publish(
        {
          channelId: "channel-001",
          dedupeKey: "dedupe-001",
          post: {
            body: "My carousel",
            media: [
              { type: "image", url: "https://example.com/p1.jpg" },
              { type: "image", url: "https://example.com/p2.jpg" },
            ],
            meta: { contentType: "photo" },
          },
        },
        VALID_CREDS
      );
      assert.ok(result.ok);
      assert.equal(result.value.providerPostId, "photo-001");
      const call = client.publishPhotoPost.mock.calls[0];
      assert.ok(call);
      const args = call[0] as { imageUrls: string[]; privacy: string };
      assert.equal(args.imageUrls.length, 2);
      assert.equal(args.privacy, "PUBLIC_TO_EVERYONE");
    });

    it("auto-detects photo post when all media are images", async () => {
      const client = makeFakeApiClient();
      const adapter = makeAdapter({ client });
      const result = await adapter.publish(
        {
          channelId: "channel-001",
          dedupeKey: "dedupe-002",
          post: {
            body: "Auto-detected",
            media: [{ type: "image", url: "https://example.com/p1.jpg" }],
            meta: {},
          },
        },
        VALID_CREDS
      );
      assert.ok(result.ok);
      assert.equal(client.publishPhotoPost.mock.calls.length, 1);
      assert.equal(client.uploadVideo.mock.calls.length, 0);
    });

    it("uses SELF_ONLY privacy for private photo posts", async () => {
      const client = makeFakeApiClient();
      const adapter = makeAdapter({ client });
      await adapter.publish(
        {
          channelId: "channel-001",
          dedupeKey: "dedupe-003",
          post: {
            body: "private photo",
            media: [{ type: "image", url: "https://example.com/p1.jpg" }],
            meta: { contentType: "photo", privacy: "private" },
          },
        },
        VALID_CREDS
      );
      const call = client.publishPhotoPost.mock.calls[0];
      assert.ok(call);
      assert.equal((call[0] as { privacy: string }).privacy, "SELF_ONLY");
    });

    it("returns VALIDATION when contentType is photo but no images present", async () => {
      const client = makeFakeApiClient();
      const adapter = makeAdapter({ client });
      const result = await adapter.publish(
        {
          channelId: "channel-001",
          dedupeKey: "dedupe-004",
          post: {
            body: "no images",
            media: [{ type: "video", url: "https://example.com/v.mp4" }],
            meta: { contentType: "photo" },
          },
        },
        VALID_CREDS
      );
      assert.ok(!result.ok);
      assert.equal(result.error, "VALIDATION");
    });

    it("falls back to constructed photo URL when shareUrl is empty", async () => {
      const client = makeFakeApiClient({
        publishPhotoPost: vi.fn(async () => ({
          shareId: "ph-xyz",
          shareUrl: "",
          uniqueId: "ph-xyz",
        })),
      });
      const adapter = makeAdapter({ client });
      const result = await adapter.publish(
        {
          channelId: "channel-001",
          dedupeKey: "dedupe-005",
          post: {
            body: "fallback url",
            media: [{ type: "image", url: "https://example.com/p1.jpg" }],
            meta: { contentType: "photo" },
          },
        },
        VALID_CREDS
      );
      assert.ok(result.ok);
      assert.equal(result.value.url, "https://www.tiktok.com/@user-123/photo/ph-xyz");
    });
  });

  // --------------------------------------------------------------------------
  describe("publish — hashtag strategy enrichment", () => {
    it("does not enrich description when useHashtagStrategy is unset", async () => {
      const client = makeFakeApiClient();
      const research = makeFakeResearchClient();
      const adapter = makeAdapter({ client, research });
      await adapter.publish(makeInput({ body: "plain text" }), VALID_CREDS);
      const call = client.uploadVideo.mock.calls[0];
      assert.ok(call);
      assert.equal((call[0] as { description: string }).description, "plain text");
    });

    it("does not enrich when useHashtagStrategy is true but no research factory wired", async () => {
      const client = makeFakeApiClient();
      const adapter = makeAdapter({ client }); // no research client
      await adapter.publish(
        makeInput({ body: "plain", meta: { useHashtagStrategy: true } }),
        VALID_CREDS
      );
      const call = client.uploadVideo.mock.calls[0];
      assert.ok(call);
      assert.equal((call[0] as { description: string }).description, "plain");
    });

    it("enriches description with hashtags when research factory is wired", async () => {
      const client = makeFakeApiClient();
      const research = makeFakeResearchClient();
      const adapter = makeAdapter({ client, research });
      await adapter.publish(
        makeInput({
          body: "video",
          meta: { useHashtagStrategy: true, contentCategory: "dance" },
        }),
        VALID_CREDS
      );
      const call = client.uploadVideo.mock.calls[0];
      assert.ok(call);
      const description = (call[0] as { description: string }).description;
      assert.ok(description.startsWith("video"), "original body must be preserved");
      assert.ok(description.includes("#"), "hashtags must be appended");
    });

    it("falls back to original description when research factory itself throws", async () => {
      const client = makeFakeApiClient();
      // Research factory throws synchronously — bypasses internal circuit breaker fallbacks.
      const adapter = new TikTokAdapter({
        apiClientFactory: () => client as unknown as TikTokApiClient,
        researchClientFactory: () => {
          throw new Error("Research client init failed");
        },
      });
      await adapter.publish(
        makeInput({ body: "fallback", meta: { useHashtagStrategy: true } }),
        VALID_CREDS
      );
      const call = client.uploadVideo.mock.calls[0];
      assert.ok(call);
      assert.equal((call[0] as { description: string }).description, "fallback");
    });
  });

  // --------------------------------------------------------------------------
  describe("publish — promoted content", () => {
    it("logs and swallows the NOT_IMPLEMENTED error when meta.promotedContent is set", async () => {
      const client = makeFakeApiClient();
      const adapter = makeAdapter({ client });
      const result = await adapter.publish(
        makeInput({
          body: "promoted",
          meta: { promotedContent: true, marketingBudget: 500 },
        }),
        VALID_CREDS
      );
      // Publish should still succeed — promoted content runs async and rejects
      // internally without blocking the receipt.
      assert.ok(result.ok);
      assert.equal(result.value.providerPostId, "video-001");
    });
  });

  // --------------------------------------------------------------------------
  describe("fetchAnalytics", () => {
    it("returns AUTH when credentials are missing", async () => {
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
          impressions: number;
          likes: number;
          shares: number;
          comments: number;
          clicks: number;
          engagements: number;
        };
      };
      assert.equal(data.channelId, "ch-1");
      assert.equal(data.metrics.impressions, 1000);
      assert.equal(data.metrics.likes, 5000);
      assert.equal(data.metrics.shares, 0);
      assert.equal(data.metrics.comments, 0);
      assert.equal(data.metrics.clicks, 50);
      // engagements = likesCount + followingCount  ⇒ 5000 + 200
      assert.equal(data.metrics.engagements, 5200);
    });

    it("returns NETWORK on circuit-breaker open", async () => {
      const client = makeFakeApiClient({
        getUserInfo: vi.fn(async () => {
          throw new Error("Circuit breaker is OPEN for tiktok-api");
        }),
      });
      const adapter = makeAdapter({ client });
      const result = await adapter.fetchAnalytics({ channelId: "ch-1" }, VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "NETWORK");
    });

    it("returns NETWORK on generic error", async () => {
      const client = makeFakeApiClient({
        getUserInfo: vi.fn(async () => {
          throw new Error("Connection timeout");
        }),
      });
      const adapter = makeAdapter({ client });
      const result = await adapter.fetchAnalytics({ channelId: "ch-1" }, VALID_CREDS);
      assert.ok(!result.ok);
      assert.equal(result.error, "NETWORK");
    });
  });

  // --------------------------------------------------------------------------
  describe("publishThread — not supported", () => {
    it("publishThread is not implemented (threading not supported on TikTok)", () => {
      const adapter = makeAdapter();
      assert.equal(
        typeof (adapter as unknown as { publishThread?: unknown }).publishThread,
        "undefined"
      );
    });
  });
});
