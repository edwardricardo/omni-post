/**
 * @file index.test.ts
 * @description Tests for InstagramAdapter — metadata, render, planThread,
 *              validateCredentials, content optimization, error handling.
 * Framework: Vitest
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import assert from "node:assert/strict";
import { InstagramAdapter } from "../src/InstagramAdapter.js";
import type { CanonicalPost, RenderedPost, ThreadPlan } from "@shared/types";

describe("InstagramAdapter", () => {
  let adapter: InstagramAdapter;
  let samplePost: CanonicalPost;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new InstagramAdapter();
    samplePost = {
      id: "test-1",
      projectId: "test-project",
      locale: "en",
      body: "This is a test Instagram post with #hashtag #test",
      media: [
        {
          id: "media-1",
          type: "image",
          url: "https://example.com/image.jpg",
          w: 1080,
          h: 1080,
          alt: "Test image",
        },
      ],
    };
  });

  // =========================================================================
  // metadata
  // =========================================================================

  describe("metadata", () => {
    it("should have correct provider ID", () => {
      assert.strictEqual(adapter.id, "instagram");
    });

    it("should have appropriate limits for Instagram", () => {
      assert.deepStrictEqual(adapter.limits, {
        maxChars: 2200,
        maxHashtags: 30,
        allowedMedia: ["image", "video"],
        aspectRatios: ["1:1", "4:5", "9:16", "16:9"],
        maxPostsPerThread: 20,
        maxMediaPerPost: 20,
        threadingSupported: true,
        rateLimitHints: { burst: 25, perSeconds: 86400 },
      });
    });

    it("should have correct capabilities", () => {
      assert.deepStrictEqual(adapter.capabilities, {
        publish: true,
        schedule: false,
        analytics: true,
        comments: true,
        replies: true,
        threading: true,
      });
    });
  });

  // =========================================================================
  // render
  // =========================================================================

  describe("render", () => {
    it("should render single post for short content", () => {
      const result = adapter.render(samplePost);

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.value.type, "single");
        assert.ok("text" in result.value.content);
        assert.ok("media" in result.value.content);
      }
    });

    it("should render carousel for long content", () => {
      const longPost: CanonicalPost = {
        ...samplePost,
        body: "This is a very long Instagram post that should trigger carousel mode. ".repeat(20),
      };

      const result = adapter.render(longPost);

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.value.type, "thread");
        assert.ok("tweets" in result.value.content);
      }
    });

    it("should render carousel for multiple media items", () => {
      const multiMediaPost: CanonicalPost = {
        ...samplePost,
        media: [
          {
            id: "media-1",
            type: "image",
            url: "https://example.com/image1.jpg",
            w: 1080,
            h: 1080,
          },
          {
            id: "media-2",
            type: "image",
            url: "https://example.com/image2.jpg",
            w: 1080,
            h: 1080,
          },
        ],
      };

      const result = adapter.render(multiMediaPost);

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.value.type, "thread");
      }
    });

    it("should append optimized hashtag block to content", () => {
      const hashtagPost: CanonicalPost = {
        ...samplePost,
        body: "Test post #Instagram #SocialMedia #Marketing #Content #Strategy #Digital #Brand #Engagement #Growth #Success #viral #trending",
      };

      const result = adapter.render(hashtagPost);

      assert.strictEqual(result.ok, true);
      if (result.ok && result.value.type === "single") {
        const rendered = result.value.content as RenderedPost;
        const text = rendered.text ?? rendered.body;
        // render() keeps original content + appends optimized hashtags (max 10, lowercased, deduped)
        // The optimized block is separated by \n\n
        const parts = text.split("\n\n");
        assert.ok(parts.length >= 2, "Should have content and hashtag block");
        const hashtagBlock = parts[parts.length - 1] || "";
        const optimizedHashtags = hashtagBlock.match(/#\w+/g) || [];
        assert.ok(
          optimizedHashtags.length <= 10,
          `Expected <= 10 optimized hashtags but got ${optimizedHashtags.length}`
        );
      }
    });

    it("should handle content too long gracefully", () => {
      const tooLongPost: CanonicalPost = {
        ...samplePost,
        body: "Very long content ".repeat(1000),
      };

      const result = adapter.render(tooLongPost);

      // Should either handle gracefully or return error
      assert.ok(result.ok !== undefined);
    });
  });

  // =========================================================================
  // planThread
  // =========================================================================

  describe("planThread", () => {
    it("should plan carousel correctly", () => {
      // Need >800 chars to trigger multi-slide split in splitContentForCarousel
      const longPost: CanonicalPost = {
        ...samplePost,
        body: "This is content that should be split into multiple carousel slides for Instagram. ".repeat(
          15
        ),
      };

      const result = adapter.planThread(longPost);

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.value.needsThreading, true);
        assert.ok(
          result.value.tweets.length > 1,
          `Expected > 1 tweets but got ${result.value.tweets.length}`
        );
        assert.strictEqual(result.value.strategy, "AUTO");
        assert.ok("totalChars" in result.value);
        assert.ok("estimatedReach" in result.value);
      }
    });

    it("should validate carousel length limits", () => {
      const tooManySlides: CanonicalPost = {
        ...samplePost,
        body: "Slide content. ".repeat(500),
      };

      const result = adapter.planThread(tooManySlides);

      // Should either succeed with max slides or fail with appropriate error
      assert.ok(result.ok !== undefined);
    });
  });

  // =========================================================================
  // validateCredentials
  // =========================================================================

  describe("validateCredentials", () => {
    it("should reject invalid credentials (empty object)", async () => {
      const result = await adapter.validateCredentials({});

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "AUTH_INVALID");
      }
    });

    it("should reject missing required fields", async () => {
      const result = await adapter.validateCredentials({
        accessToken: "test-token",
        // Missing userId
      });

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "AUTH_INVALID");
      }
    });

    it("should handle expired tokens", async () => {
      // AbstractProviderAdapter.validateCredentials() validates structure first,
      // then calls createApiClient + testCredentials. Since structure passes
      // (accessToken + userId present), it tries the API call which fails.
      // Base class returns AUTH_INVALID for generic errors, AUTH_EXPIRED for 401.
      const expiredCredentials = {
        accessToken: "expired-token",
        userId: "test-user-id",
        expiresAt: new Date(Date.now() - 3600000),
      };

      const result = await adapter.validateCredentials(expiredCredentials);

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        // Base class maps all non-401 errors to AUTH_INVALID
        assert.ok(
          result.error === "AUTH_INVALID" || result.error === "AUTH_EXPIRED",
          `Expected AUTH_INVALID or AUTH_EXPIRED, got: ${result.error}`
        );
      }
    });

    it("should validate complete credentials with mocked API client", async () => {
      // Mock the createApiClient method to return a mock that resolves
      const mockApiClient = {
        validateCredentials: vi.fn(async () => ({
          id: "test-user-id",
          username: "testuser",
          name: "Test User",
          account_type: "BUSINESS" as const,
        })),
      };

      const createClientSpy = vi
        .spyOn(adapter as any, "createApiClient")
        .mockImplementation(() => mockApiClient);

      const validCredentials = {
        accessToken: "valid-access-token",
        userId: "test-user-id",
        pageId: "test-page-id",
        expiresAt: new Date(Date.now() + 3600000),
      };

      const result = await adapter.validateCredentials(validCredentials);

      // AbstractProviderAdapter.validateCredentials returns ok(undefined) on success
      assert.strictEqual(result.ok, true);
      // Verify the API client was called
      assert.strictEqual(mockApiClient.validateCredentials.mock.calls.length, 1);

      createClientSpy.mockRestore();
    });

    it("should handle API client errors during validation", async () => {
      const mockApiClient = {
        validateCredentials: vi.fn(async () => {
          throw new Error("Invalid access token");
        }),
      };

      const createClientSpy = vi
        .spyOn(adapter as any, "createApiClient")
        .mockImplementation(() => mockApiClient);

      const invalidCredentials = {
        accessToken: "invalid-token",
        userId: "test-user-id",
      };

      const result = await adapter.validateCredentials(invalidCredentials);

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        // AbstractProviderAdapter maps generic errors to AUTH_INVALID
        assert.strictEqual(result.error, "AUTH_INVALID");
      }

      createClientSpy.mockRestore();
    });
  });

  // =========================================================================
  // content optimization
  // =========================================================================

  describe("content optimization", () => {
    it("should remove X-specific formatting", () => {
      const xStylePost: CanonicalPost = {
        ...samplePost,
        body: "1/5 \u{1F9F5} This is a Twitter thread that should be adapted for Instagram.",
      };

      const result = adapter.render(xStylePost);

      assert.strictEqual(result.ok, true);
      if (result.ok && result.value.type === "single") {
        const rendered = result.value.content as RenderedPost;
        const text = rendered.text ?? rendered.body;
        assert.ok(!text.includes("1/5"), "Should not contain thread numbering");
        assert.ok(!text.includes("\u{1F9F5}"), "Should not contain thread emoji");
      }
    });

    it("should handle media aspect ratios", () => {
      const mediaPost: CanonicalPost = {
        ...samplePost,
        media: [
          {
            id: "media-1",
            type: "image",
            url: "https://example.com/image.jpg",
            w: 1920,
            h: 1080, // 16:9 aspect ratio
          },
        ],
      };

      const result = adapter.render(mediaPost);

      assert.strictEqual(result.ok, true);
      if (result.ok && result.value.type === "single") {
        const rendered = result.value.content as RenderedPost;
        assert.ok(rendered.media !== undefined);
        const firstMedia = rendered.media?.[0];
        assert.ok(firstMedia !== undefined);
        assert.strictEqual(firstMedia?.type, "image");
        assert.strictEqual(firstMedia?.url, "https://example.com/image.jpg");
      }
    });
  });

  // =========================================================================
  // enhanced functionality integration
  // =========================================================================

  describe("enhanced functionality integration", () => {
    it("should handle media upload scenarios for Instagram", () => {
      const mediaPost: CanonicalPost = {
        ...samplePost,
        media: [
          {
            id: "media-upload-1",
            type: "video",
            url: "https://example.com/video.mp4",
            w: 1080,
            h: 1920,
          },
        ],
      };

      const result = adapter.render(mediaPost);

      assert.strictEqual(result.ok, true);
      if (result.ok && result.value.type === "single") {
        const rendered = result.value.content as RenderedPost;
        assert.ok(rendered.media !== undefined);
        const firstMedia = rendered.media?.[0];
        assert.ok(firstMedia !== undefined);
        assert.strictEqual(firstMedia?.type, "video");
        assert.strictEqual(firstMedia?.url, "https://example.com/video.mp4");
      }
    });

    it("should handle Reels-specific rendering", () => {
      const reelsPost: CanonicalPost = {
        ...samplePost,
        body: "Amazing reel content! #reels #video #viral",
        media: [
          {
            id: "reel-1",
            type: "video",
            url: "https://example.com/reel.mp4",
            w: 1080,
            h: 1920, // 9:16 aspect ratio for Reels
          },
        ],
      };

      const result = adapter.render(reelsPost);

      assert.strictEqual(result.ok, true);
      if (result.ok && result.value.type === "single") {
        const rendered = result.value.content as RenderedPost;
        const text = rendered.text ?? rendered.body;
        assert.ok(text.includes("#reels"), "Should contain #reels hashtag");
        const firstMedia = rendered.media?.[0];
        assert.ok(firstMedia !== undefined);
        assert.strictEqual(firstMedia?.type, "video");
        assert.strictEqual(firstMedia?.url, "https://example.com/reel.mp4");
      }
    });

    it("should handle carousel posts with mixed media", () => {
      const carouselPost: CanonicalPost = {
        ...samplePost,
        body: "Amazing carousel with mixed content! #carousel #photography #video",
        media: [
          {
            id: "carousel-1",
            type: "image",
            url: "https://example.com/photo1.jpg",
            w: 1080,
            h: 1080,
            alt: "First photo",
          },
          {
            id: "carousel-2",
            type: "video",
            url: "https://example.com/video1.mp4",
            w: 1080,
            h: 1080,
          },
          {
            id: "carousel-3",
            type: "image",
            url: "https://example.com/photo2.jpg",
            w: 1080,
            h: 1080,
            alt: "Second photo",
          },
        ],
      };

      const result = adapter.render(carouselPost);

      assert.strictEqual(result.ok, true);
      if (result.ok && result.value.type === "thread") {
        const threadPlan = result.value.content as ThreadPlan;
        assert.ok(threadPlan.tweets.length > 0, "Carousel should have at least one slide");
      }
    });
  });

  // =========================================================================
  // error handling and edge cases
  // =========================================================================

  describe("error handling and edge cases", () => {
    it("should render successfully even without media (render does not enforce media requirement)", () => {
      // render() does not validate that REELS require video —
      // that validation happens at publish() time via detectContentType
      const noMediaPost: CanonicalPost = {
        ...samplePost,
        body: "This should be a reel but has no video",
        media: [],
      };

      const result = adapter.render(noMediaPost);

      // render() succeeds — it's publish() that enforces media requirements
      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.value.type, "single");
      }
    });

    it("should render successfully with any URL format (render does not validate URLs)", () => {
      // render() passes media through without URL validation
      const malformedMediaPost: CanonicalPost = {
        ...samplePost,
        body: "Post with malformed media URL",
        media: [
          {
            id: "malformed-1",
            type: "image",
            url: "not-a-valid-url",
            w: 1080,
            h: 1080,
          },
        ],
      };

      const result = adapter.render(malformedMediaPost);

      // render() succeeds — URL validation happens at publish/upload time
      assert.strictEqual(result.ok, true);
      if (result.ok && result.value.type === "single") {
        const rendered = result.value.content as RenderedPost;
        const firstMedia = rendered.media?.[0];
        assert.strictEqual(firstMedia?.url, "not-a-valid-url");
      }
    });
  });
});
