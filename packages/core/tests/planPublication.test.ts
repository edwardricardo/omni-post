/**
 * Comprehensive Tests for planPublication
 *
 * Tests the publication planning logic that converts canonical posts into
 * provider-specific rendered posts.
 */

import { describe, it, beforeEach, expect, vi } from "vitest";
import { planPublication } from "../src/planPublication.js";
import type { CanonicalPost } from "@shared/types";
import type { ProviderAdapter, RenderedPost, RenderResult } from "@ports/core";

// ========================================
// MOCK PROVIDER ADAPTERS
// ========================================

class MockSuccessAdapter implements Partial<ProviderAdapter> {
  id = "mock-success";

  render(post: CanonicalPost): RenderResult {
    return {
      ok: true,
      value: {
        type: "single" as const,
        content: {
          text: post.body,
          media: post.media ?? [],
        } as RenderedPost,
      },
    };
  }
}

class MockErrorAdapter implements Partial<ProviderAdapter> {
  id = "mock-error";

  render(_post: CanonicalPost): RenderResult {
    return {
      ok: false,
      error: "Rendering failed",
    };
  }
}

class MockThreadAdapter implements Partial<ProviderAdapter> {
  id = "mock-thread";

  render(post: CanonicalPost): RenderResult {
    return {
      ok: true,
      value: {
        type: "thread" as const,
        content: [
          {
            text: post.body.substring(0, 280),
            media: [],
          },
          {
            text: post.body.substring(280),
            media: post.media ?? [],
          },
        ] as RenderedPost[],
      },
    };
  }
}

class MockEmptyAdapter implements Partial<ProviderAdapter> {
  id = "mock-empty";

  render(_post: CanonicalPost): RenderResult {
    return {
      ok: true,
      value: {
        type: "single" as const,
        content: {
          text: "",
          media: [],
        } as RenderedPost,
      },
    };
  }
}

// ========================================
// TEST SUITE
// ========================================

describe("planPublication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Basic Publication Planning", () => {
    it("should plan publication for single successful channel", () => {
      const post: CanonicalPost = {
        id: "post-1",
        projectId: "test-project",
        locale: "en",
        body: "Test post content",
        media: [],
      };

      const channels = [
        {
          channelId: "channel-1",
          provider: new MockSuccessAdapter() as ProviderAdapter,
        },
      ];

      const result = planPublication(post, channels);

      expect(result.ok).toBeTruthy();
      expect(result.value.length).toBe(1);
      expect(result.value[0]!.providerId).toBe("mock-success");
      expect(result.value[0]!.channelId).toBe("channel-1");
      expect(result.value[0]!.dedupeKey).toBe("post-1:channel-1");
      expect(result.value[0]!.rendered.text).toBe("Test post content");
    });

    it("should plan publication for multiple successful channels", () => {
      const post: CanonicalPost = {
        id: "post-2",
        projectId: "test-project",
        locale: "en",
        body: "Multi-channel post",
        media: [],
      };

      const channels = [
        { channelId: "channel-1", provider: new MockSuccessAdapter() as ProviderAdapter },
        { channelId: "channel-2", provider: new MockSuccessAdapter() as ProviderAdapter },
        { channelId: "channel-3", provider: new MockSuccessAdapter() as ProviderAdapter },
      ];

      const result = planPublication(post, channels);

      expect(result.ok).toBeTruthy();
      expect(result.value.length).toBe(3);
      expect(result.value.every((plan) => plan.providerId === "mock-success")).toBeTruthy();
      expect(result.value[0]!.dedupeKey).toBe("post-2:channel-1");
      expect(result.value[1]!.dedupeKey).toBe("post-2:channel-2");
      expect(result.value[2]!.dedupeKey).toBe("post-2:channel-3");
    });

    it("should handle empty channel list", () => {
      const post: CanonicalPost = {
        id: "post-3",
        projectId: "test-project",
        locale: "en",
        body: "No channels",
        media: [],
      };

      const channels: Array<{ channelId: string; provider: ProviderAdapter }> = [];

      const result = planPublication(post, channels);

      expect(result.ok).toBeTruthy();
      expect(result.value.length).toBe(0);
    });

    it("should include media in rendered post", () => {
      const post: CanonicalPost = {
        id: "post-4",
        projectId: "test-project",
        locale: "en",
        body: "Post with media",
        media: [
          { id: "media-1", url: "https://example.com/image1.jpg", type: "image" },
          { id: "media-2", url: "https://example.com/image2.jpg", type: "image" },
        ],
      };

      const channels = [
        { channelId: "channel-1", provider: new MockSuccessAdapter() as ProviderAdapter },
      ];

      const result = planPublication(post, channels);

      expect(result.ok).toBeTruthy();
      const firstPlan = result.value[0];
      expect(firstPlan).toBeTruthy();
      expect(firstPlan!.rendered.media.length).toBe(2);
      const firstMedia = firstPlan!.rendered.media[0];
      expect(firstMedia).toBeTruthy();
      expect(firstMedia!.url).toBe("https://example.com/image1.jpg");
    });
  });

  describe("Error Handling", () => {
    it("should fail when single channel fails to render", () => {
      const post: CanonicalPost = {
        id: "post-5",
        projectId: "test-project",
        locale: "en",
        body: "Error post",
        media: [],
      };

      const channels = [
        { channelId: "channel-1", provider: new MockErrorAdapter() as ProviderAdapter },
      ];

      const result = planPublication(post, channels);

      expect(result.ok).toBeFalsy();
      expect(result.error).toBe("RENDER_ERRORS");
    });

    it("should fail when any channel fails to render", () => {
      const post: CanonicalPost = {
        id: "post-6",
        projectId: "test-project",
        locale: "en",
        body: "Mixed results",
        media: [],
      };

      const channels = [
        { channelId: "channel-1", provider: new MockSuccessAdapter() as ProviderAdapter },
        { channelId: "channel-2", provider: new MockErrorAdapter() as ProviderAdapter },
        { channelId: "channel-3", provider: new MockSuccessAdapter() as ProviderAdapter },
      ];

      const result = planPublication(post, channels);

      expect(result.ok).toBeFalsy();
      expect(result.error).toBe("RENDER_ERRORS");
    });

    it("should fail when all channels fail to render", () => {
      const post: CanonicalPost = {
        id: "post-7",
        projectId: "test-project",
        locale: "en",
        body: "All fail",
        media: [],
      };

      const channels = [
        { channelId: "channel-1", provider: new MockErrorAdapter() as ProviderAdapter },
        { channelId: "channel-2", provider: new MockErrorAdapter() as ProviderAdapter },
      ];

      const result = planPublication(post, channels);

      expect(result.ok).toBeFalsy();
      expect(result.error).toBe("RENDER_ERRORS");
    });
  });

  describe("Thread Handling", () => {
    it("should skip thread content (not yet implemented)", () => {
      const post: CanonicalPost = {
        id: "post-8",
        projectId: "test-project",
        locale: "en",
        body: "a".repeat(500),
        media: [],
      };

      const channels = [
        { channelId: "channel-1", provider: new MockThreadAdapter() as ProviderAdapter },
      ];

      const result = planPublication(post, channels);

      expect(result.ok).toBeTruthy();
      expect(result.value.length).toBe(0);
    });

    it("should handle mix of single and thread providers", () => {
      const post: CanonicalPost = {
        id: "post-9",
        projectId: "test-project",
        locale: "en",
        body: "Mixed content types",
        media: [],
      };

      const channels = [
        { channelId: "channel-1", provider: new MockSuccessAdapter() as ProviderAdapter },
        { channelId: "channel-2", provider: new MockThreadAdapter() as ProviderAdapter },
        { channelId: "channel-3", provider: new MockSuccessAdapter() as ProviderAdapter },
      ];

      const result = planPublication(post, channels);

      expect(result.ok).toBeTruthy();
      expect(result.value.length).toBe(2);
      expect(result.value.every((plan) => plan.providerId === "mock-success")).toBeTruthy();
    });
  });

  describe("Dedupe Key Generation", () => {
    it("should generate unique dedupe keys for different channels", () => {
      const post: CanonicalPost = {
        id: "post-10",
        projectId: "test-project",
        locale: "en",
        body: "Dedupe test",
        media: [],
      };

      const channels = [
        { channelId: "channel-1", provider: new MockSuccessAdapter() as ProviderAdapter },
        { channelId: "channel-2", provider: new MockSuccessAdapter() as ProviderAdapter },
      ];

      const result = planPublication(post, channels);

      expect(result.ok).toBeTruthy();
      const dedupeKeys = result.value.map((plan) => plan.dedupeKey);
      expect(dedupeKeys[0]).not.toBe(dedupeKeys[1]);
      expect(dedupeKeys[0]).toBe("post-10:channel-1");
      expect(dedupeKeys[1]).toBe("post-10:channel-2");
    });

    it("should use post ID and channel ID in dedupe key", () => {
      const post: CanonicalPost = {
        id: "unique-post-id",
        projectId: "test-project",
        locale: "en",
        body: "Dedupe format test",
        media: [],
      };

      const channels = [
        { channelId: "unique-channel-id", provider: new MockSuccessAdapter() as ProviderAdapter },
      ];

      const result = planPublication(post, channels);

      expect(result.ok).toBeTruthy();
      expect(result.value[0]!.dedupeKey).toBe("unique-post-id:unique-channel-id");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty post body", () => {
      const post: CanonicalPost = {
        id: "post-11",
        projectId: "test-project",
        locale: "en",
        body: "",
        media: [],
      };

      const channels = [
        { channelId: "channel-1", provider: new MockEmptyAdapter() as ProviderAdapter },
      ];

      const result = planPublication(post, channels);

      expect(result.ok).toBeTruthy();
      expect(result.value.length).toBe(1);
      expect(result.value[0]!.rendered.text).toBe("");
    });

    it("should handle post with only media", () => {
      const post: CanonicalPost = {
        id: "post-12",
        projectId: "test-project",
        locale: "en",
        body: "",
        media: [{ id: "media-1", url: "https://example.com/image.jpg", type: "image" }],
      };

      const channels = [
        { channelId: "channel-1", provider: new MockSuccessAdapter() as ProviderAdapter },
      ];

      const result = planPublication(post, channels);

      expect(result.ok).toBeTruthy();
      const firstPlan = result.value[0];
      expect(firstPlan).toBeTruthy();
      expect(firstPlan!.rendered.media.length).toBe(1);
    });

    it("should handle very long channel IDs", () => {
      const post: CanonicalPost = {
        id: "post-13",
        projectId: "test-project",
        locale: "en",
        body: "Long channel ID test",
        media: [],
      };

      const longChannelId = "channel-" + "x".repeat(100);
      const channels = [
        { channelId: longChannelId, provider: new MockSuccessAdapter() as ProviderAdapter },
      ];

      const result = planPublication(post, channels);

      expect(result.ok).toBeTruthy();
      expect(result.value[0]!.channelId).toBe(longChannelId);
      expect(result.value[0]!.dedupeKey).toBe(`post-13:${longChannelId}`);
    });

    it("should handle special characters in post ID and channel ID", () => {
      const post: CanonicalPost = {
        id: "post-with-special-chars-@#$",
        projectId: "test-project",
        locale: "en",
        body: "Special chars test",
        media: [],
      };

      const channels = [
        {
          channelId: "channel-with-special-chars-@#$",
          provider: new MockSuccessAdapter() as ProviderAdapter,
        },
      ];

      const result = planPublication(post, channels);

      expect(result.ok).toBeTruthy();
      expect(result.value[0]!.dedupeKey).toBe(
        "post-with-special-chars-@#$:channel-with-special-chars-@#$"
      );
    });

    it("should preserve provider ID in plan", () => {
      const post: CanonicalPost = {
        id: "post-14",
        projectId: "test-project",
        locale: "en",
        body: "Provider ID test",
        media: [],
      };

      const channels = [
        { channelId: "channel-1", provider: new MockSuccessAdapter() as ProviderAdapter },
      ];

      const result = planPublication(post, channels);

      expect(result.ok).toBeTruthy();
      expect(result.value[0]!.providerId).toBe("mock-success");
    });

    it("should handle multiple media items", () => {
      const post: CanonicalPost = {
        id: "post-15",
        projectId: "test-project",
        locale: "en",
        body: "Multiple media test",
        media: [
          { id: "media-1", url: "https://example.com/image1.jpg", type: "image" },
          { id: "media-2", url: "https://example.com/image2.jpg", type: "image" },
          { id: "media-3", url: "https://example.com/video1.mp4", type: "video" },
          { id: "media-4", url: "https://example.com/image3.jpg", type: "image" },
        ],
      };

      const channels = [
        { channelId: "channel-1", provider: new MockSuccessAdapter() as ProviderAdapter },
      ];

      const result = planPublication(post, channels);

      expect(result.ok).toBeTruthy();
      const firstPlan = result.value[0];
      expect(firstPlan).toBeTruthy();
      expect(firstPlan!.rendered.media.length).toBe(4);
      const thirdMedia = firstPlan!.rendered.media[2];
      expect(thirdMedia).toBeTruthy();
      expect(thirdMedia!.type).toBe("video");
    });
  });
});
