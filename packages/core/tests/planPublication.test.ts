/**
 * Comprehensive Tests for planPublication
 *
 * Tests the publication planning logic that converts canonical posts into
 * provider-specific rendered posts.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
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

describe("planPublication", { concurrency: 1 }, () => {
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

      assert.ok(result.ok, "Should succeed for valid channel");
      assert.strictEqual(result.value.length, 1, "Should create one plan");
      assert.strictEqual(
        result.value[0]!.providerId,
        "mock-success",
        "Should have correct provider ID"
      );
      assert.strictEqual(result.value[0]!.channelId, "channel-1", "Should have correct channel ID");
      assert.strictEqual(
        result.value[0]!.dedupeKey,
        "post-1:channel-1",
        "Should have correct dedupe key"
      );
      assert.strictEqual(
        result.value[0]!.rendered.text,
        "Test post content",
        "Should have rendered text"
      );
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

      assert.ok(result.ok, "Should succeed for all channels");
      assert.strictEqual(result.value.length, 3, "Should create three plans");
      assert.ok(
        result.value.every((plan) => plan.providerId === "mock-success"),
        "All plans should have correct provider ID"
      );
      assert.strictEqual(result.value[0]!.dedupeKey, "post-2:channel-1");
      assert.strictEqual(result.value[1]!.dedupeKey, "post-2:channel-2");
      assert.strictEqual(result.value[2]!.dedupeKey, "post-2:channel-3");
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

      assert.ok(result.ok, "Should succeed with empty channel list");
      assert.strictEqual(result.value.length, 0, "Should create no plans");
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

      assert.ok(result.ok, "Should succeed with media");
      const firstPlan = result.value[0];
      assert.ok(firstPlan, "Should have at least one plan");
      assert.strictEqual(firstPlan.rendered.media.length, 2, "Should include media");
      const firstMedia = firstPlan.rendered.media[0];
      assert.ok(firstMedia, "Should have first media item");
      assert.strictEqual(
        firstMedia.url,
        "https://example.com/image1.jpg",
        "Should preserve media URL"
      );
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

      assert.ok(!result.ok, "Should fail when channel fails");
      assert.strictEqual(result.error, "RENDER_ERRORS", "Should return RENDER_ERRORS");
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

      assert.ok(!result.ok, "Should fail when any channel fails");
      assert.strictEqual(result.error, "RENDER_ERRORS", "Should return RENDER_ERRORS");
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

      assert.ok(!result.ok, "Should fail when all channels fail");
      assert.strictEqual(result.error, "RENDER_ERRORS");
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

      assert.ok(result.ok, "Should succeed (threads are skipped)");
      assert.strictEqual(result.value.length, 0, "Should skip thread content");
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

      assert.ok(result.ok, "Should succeed");
      assert.strictEqual(result.value.length, 2, "Should only include single posts");
      assert.ok(
        result.value.every((plan) => plan.providerId === "mock-success"),
        "Should only include success adapters"
      );
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

      assert.ok(result.ok, "Should succeed");
      const dedupeKeys = result.value.map((plan) => plan.dedupeKey);
      assert.notStrictEqual(dedupeKeys[0], dedupeKeys[1], "Dedupe keys should be different");
      assert.strictEqual(dedupeKeys[0], "post-10:channel-1");
      assert.strictEqual(dedupeKeys[1], "post-10:channel-2");
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

      assert.ok(result.ok, "Should succeed");
      assert.strictEqual(
        result.value[0]!.dedupeKey,
        "unique-post-id:unique-channel-id",
        "Dedupe key should follow post-id:channel-id format"
      );
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

      assert.ok(result.ok, "Should succeed with empty body");
      assert.strictEqual(result.value.length, 1, "Should create one plan");
      assert.strictEqual(result.value[0]!.rendered.text, "", "Should preserve empty text");
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

      assert.ok(result.ok, "Should succeed with media-only post");
      const firstPlan = result.value[0];
      assert.ok(firstPlan, "Should have at least one plan");
      assert.strictEqual(firstPlan.rendered.media.length, 1, "Should include media");
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

      assert.ok(result.ok, "Should succeed with long channel ID");
      assert.strictEqual(
        result.value[0]!.channelId,
        longChannelId,
        "Should preserve long channel ID"
      );
      assert.strictEqual(
        result.value[0]!.dedupeKey,
        `post-13:${longChannelId}`,
        "Should include long channel ID in dedupe key"
      );
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

      assert.ok(result.ok, "Should succeed with special characters");
      assert.strictEqual(
        result.value[0]!.dedupeKey,
        "post-with-special-chars-@#$:channel-with-special-chars-@#$",
        "Should preserve special characters in dedupe key"
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

      assert.ok(result.ok, "Should succeed");
      assert.strictEqual(
        result.value[0]!.providerId,
        "mock-success",
        "Should preserve provider ID"
      );
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

      assert.ok(result.ok, "Should succeed with multiple media");
      const firstPlan = result.value[0];
      assert.ok(firstPlan, "Should have at least one plan");
      assert.strictEqual(firstPlan.rendered.media.length, 4, "Should include all media items");
      const thirdMedia = firstPlan.rendered.media[2];
      assert.ok(thirdMedia, "Should have third media item");
      assert.strictEqual(thirdMedia.type, "video", "Should preserve media types");
    });
  });
});
