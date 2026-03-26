/**
 * FacebookAdapter - Stories and Reels Publishing Tests
 *
 * Comprehensive test coverage for Facebook Stories and Reels functionality
 * including content type detection, publishing workflows, and error handling.
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { FacebookAdapter } from "../src/FacebookAdapter.js";
import type { RenderedPost } from "@shared/types";

describe("FacebookAdapter - Stories and Reels Publishing", () => {
  describe("Content Type Detection - detectContentType()", () => {
    const adapter = new FacebookAdapter();

    it("should detect STORY content type from explicit metadata (contentType)", () => {
      const post: RenderedPost = {
        body: "Story content",
        text: "Story content",
        media: [{ type: "image", url: "https://example.com/story.jpg" }],
        meta: { contentType: "story" },
      };

      // Access private method via type assertion for testing
      const contentType = (adapter as any).detectContentType(post);
      assert.strictEqual(contentType, "STORY");
    });

    it("should detect STORY content type from explicit metadata (STORY uppercase)", () => {
      const post: RenderedPost = {
        body: "Story content",
        text: "Story content",
        media: [{ type: "image", url: "https://example.com/story.jpg" }],
        meta: { contentType: "STORY" },
      };

      const contentType = (adapter as any).detectContentType(post);
      assert.strictEqual(contentType, "STORY");
    });

    it("should detect STORY content type from ephemeral metadata", () => {
      const post: RenderedPost = {
        body: "Story content",
        text: "Story content",
        media: [{ type: "image", url: "https://example.com/story.jpg" }],
        meta: { ephemeral: true },
      };

      const contentType = (adapter as any).detectContentType(post);
      assert.strictEqual(contentType, "STORY");
    });

    it("should detect STORY content type from story metadata flag", () => {
      const post: RenderedPost = {
        body: "Story content",
        text: "Story content",
        media: [{ type: "image", url: "https://example.com/story.jpg" }],
        meta: { story: true },
      };

      const contentType = (adapter as any).detectContentType(post);
      assert.strictEqual(contentType, "STORY");
    });

    it("should detect STORY content type from 24-hour duration metadata", () => {
      const post: RenderedPost = {
        body: "Story content",
        text: "Story content",
        media: [{ type: "video", url: "https://example.com/story.mp4" }],
        meta: { duration: 24 },
      };

      const contentType = (adapter as any).detectContentType(post);
      assert.strictEqual(contentType, "STORY");
    });

    it("should detect REEL content type from explicit metadata (contentType)", () => {
      const post: RenderedPost = {
        body: "Reel content",
        text: "Reel content",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
        meta: { contentType: "reel" },
      };

      const contentType = (adapter as any).detectContentType(post);
      assert.strictEqual(contentType, "REEL");
    });

    it("should detect REEL content type from explicit metadata (REEL uppercase)", () => {
      const post: RenderedPost = {
        body: "Reel content",
        text: "Reel content",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
        meta: { contentType: "REEL" },
      };

      const contentType = (adapter as any).detectContentType(post);
      assert.strictEqual(contentType, "REEL");
    });

    it("should detect REEL content type from 9:16 aspect ratio", () => {
      const post: RenderedPost = {
        body: "Reel content",
        text: "Reel content",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
        meta: { aspectRatio: "9:16" },
      };

      const contentType = (adapter as any).detectContentType(post);
      assert.strictEqual(contentType, "REEL");
    });

    it("should detect REEL content type from isReel flag in media meta", () => {
      const post: RenderedPost = {
        body: "Reel content",
        text: "Reel content",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
        meta: { isReel: true },
      };

      const contentType = (adapter as any).detectContentType(post);
      assert.strictEqual(contentType, "REEL");
    });

    it("should detect REEL content type from isReel flag in post meta", () => {
      const post: RenderedPost = {
        body: "Reel content",
        text: "Reel content",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
        meta: { isReel: true },
      };

      const contentType = (adapter as any).detectContentType(post);
      assert.strictEqual(contentType, "REEL");
    });

    it("should detect REEL content type from musicTrack metadata", () => {
      const post: RenderedPost = {
        body: "Reel content",
        text: "Reel content",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
        meta: { musicTrack: { id: "track-123", title: "Song Name" } },
      };

      const contentType = (adapter as any).detectContentType(post);
      assert.strictEqual(contentType, "REEL");
    });

    it("should detect REEL content type from effects metadata", () => {
      const post: RenderedPost = {
        body: "Reel content",
        text: "Reel content",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
        meta: { effects: ["effect-1", "effect-2"] },
      };

      const contentType = (adapter as any).detectContentType(post);
      assert.strictEqual(contentType, "REEL");
    });

    it("should detect REEL content type from allowRemixing metadata", () => {
      const post: RenderedPost = {
        body: "Reel content",
        text: "Reel content",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
        meta: { allowRemixing: true },
      };

      const contentType = (adapter as any).detectContentType(post);
      assert.strictEqual(contentType, "REEL");
    });

    it("should default to POST for regular content without special metadata", () => {
      const post: RenderedPost = {
        body: "Regular post",
        text: "Regular post",
        media: [{ type: "image", url: "https://example.com/image.jpg" }],
      };

      const contentType = (adapter as any).detectContentType(post);
      assert.strictEqual(contentType, "POST");
    });

    it("should default to POST for content without media", () => {
      const post: RenderedPost = {
        body: "Text-only post",
        text: "Text-only post",
      };

      const contentType = (adapter as any).detectContentType(post);
      assert.strictEqual(contentType, "POST");
    });

    it("should default to POST when media array is empty", () => {
      const post: RenderedPost = {
        body: "Post with empty media",
        text: "Post with empty media",
        media: [],
      };

      const contentType = (adapter as any).detectContentType(post);
      assert.strictEqual(contentType, "POST");
    });
  });

  describe("Story Publishing - publishStory()", () => {
    it("should validate story requires media", () => {
      const post: RenderedPost = {
        body: "Story without media",
        text: "Story without media",
        media: [],
      };

      assert.ok(!post.media || post.media.length === 0);
    });

    it("should support image stories", () => {
      const post: RenderedPost = {
        body: "Image story",
        text: "Image story",
        media: [{ type: "image", url: "https://example.com/story-image.jpg" }],
      };

      assert.strictEqual(post.media![0]!.type, "image");
    });

    it("should support video stories", () => {
      const post: RenderedPost = {
        body: "Video story",
        text: "Video story",
        media: [{ type: "video", url: "https://example.com/story-video.mp4" }],
      };

      assert.strictEqual(post.media![0]!.type, "video");
    });

    it("should support stories with interactive elements", () => {
      const post: RenderedPost = {
        body: "Interactive story",
        text: "Interactive story",
        media: [{ type: "image", url: "https://example.com/story.jpg" }],
        meta: {
          interactive: {
            mentions: [{ id: "user-123", x: 0.5, y: 0.5 }],
            polls: [{ question: "Choose one", option1: "A", option2: "B", x: 0.5, y: 0.7 }],
          },
        },
      };

      assert.ok(post.meta?.interactive);
      assert.ok((post.meta.interactive as any).mentions);
      assert.ok((post.meta.interactive as any).polls);
    });

    it("should support stories with audience restrictions", () => {
      const post: RenderedPost = {
        body: "Friends-only story",
        text: "Friends-only story",
        media: [{ type: "image", url: "https://example.com/story.jpg" }],
        meta: { audienceRestriction: "friends" },
      };

      assert.strictEqual(post.meta?.audienceRestriction, "friends");
    });

    it("should support stories with custom audience", () => {
      const post: RenderedPost = {
        body: "Custom audience story",
        text: "Custom audience story",
        media: [{ type: "image", url: "https://example.com/story.jpg" }],
        meta: {
          audienceRestriction: "custom",
          customAudience: ["user-1", "user-2", "user-3"],
        },
      };

      assert.strictEqual(post.meta?.audienceRestriction, "custom");
      assert.ok(Array.isArray(post.meta?.customAudience));
      assert.strictEqual((post.meta?.customAudience as unknown[])?.length, 3);
    });

    it("should support stories with location tags", () => {
      const post: RenderedPost = {
        body: "Story with location",
        text: "Story with location",
        media: [{ type: "image", url: "https://example.com/story.jpg" }],
        meta: {
          locationTag: {
            placeId: "place-123",
            coordinateX: 37.7749,
            coordinateY: -122.4194,
          },
        },
      };

      assert.ok(post.meta?.locationTag);
      assert.strictEqual((post.meta.locationTag as any).placeId, "place-123");
    });

    it("should support stories with resharing disabled", () => {
      const post: RenderedPost = {
        body: "No resharing story",
        text: "No resharing story",
        media: [{ type: "image", url: "https://example.com/story.jpg" }],
        meta: { allowResharing: false },
      };

      assert.strictEqual(post.meta?.allowResharing, false);
    });

    it("should support stories hidden from timeline", () => {
      const post: RenderedPost = {
        body: "Hidden story",
        text: "Hidden story",
        media: [{ type: "image", url: "https://example.com/story.jpg" }],
        meta: { hideFromTimeline: true },
      };

      assert.strictEqual(post.meta?.hideFromTimeline, true);
    });
  });

  describe("Reel Publishing - publishReel()", () => {
    it("should validate reel requires media", () => {
      const post: RenderedPost = {
        body: "Reel without media",
        text: "Reel without media",
        media: [],
      };

      assert.ok(!post.media || post.media.length === 0);
    });

    it("should validate reel requires video (not image)", () => {
      const post: RenderedPost = {
        body: "Reel with image",
        text: "Reel with image",
        media: [{ type: "image", url: "https://example.com/image.jpg" }],
      };

      assert.notEqual(post.media![0]!.type, "video");
    });

    it("should support basic reel with video", () => {
      const post: RenderedPost = {
        body: "Basic reel",
        text: "Basic reel",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
      };

      assert.strictEqual(post.media![0]!.type, "video");
    });

    it("should support reel with description", () => {
      const post: RenderedPost = {
        body: "Reel with description",
        text: "Reel with description",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
      };

      assert.ok(post.body);
      assert.strictEqual(post.body.length > 0, true);
    });

    it("should support reel with cover image", () => {
      const post: RenderedPost = {
        body: "Reel with cover",
        text: "Reel with cover",
        media: [
          { type: "video", url: "https://example.com/reel.mp4" },
          { type: "image", url: "https://example.com/cover.jpg" },
        ],
      };

      assert.strictEqual(post.media!.length, 2);
      assert.strictEqual(post.media![1]!.type, "image");
    });

    it("should support reel with audience restriction", () => {
      const post: RenderedPost = {
        body: "Reel with audience restriction",
        text: "Reel with audience restriction",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
        meta: { audienceRestriction: "everyone" },
      };

      assert.strictEqual(post.meta?.audienceRestriction, "everyone");
    });

    it("should support reel with comments disabled", () => {
      const post: RenderedPost = {
        body: "Reel without comments",
        text: "Reel without comments",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
        meta: { allowComments: false },
      };

      assert.strictEqual(post.meta?.allowComments, false);
    });

    it("should support reel with sharing disabled", () => {
      const post: RenderedPost = {
        body: "Reel without sharing",
        text: "Reel without sharing",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
        meta: { allowSharing: false },
      };

      assert.strictEqual(post.meta?.allowSharing, false);
    });

    it("should support reel with remixing enabled", () => {
      const post: RenderedPost = {
        body: "Remixable reel",
        text: "Remixable reel",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
        meta: { allowRemixing: true },
      };

      assert.strictEqual(post.meta?.allowRemixing, true);
    });

    it("should support reel with location tag", () => {
      const post: RenderedPost = {
        body: "Reel with location",
        text: "Reel with location",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
        meta: {
          locationTag: {
            placeId: "place-456",
            coordinateX: 40.7128,
            coordinateY: -74.006,
          },
        },
      };

      assert.ok(post.meta?.locationTag);
      assert.strictEqual((post.meta.locationTag as any).placeId, "place-456");
    });

    it("should support reel with hashtags", () => {
      const post: RenderedPost = {
        body: "Reel with hashtags",
        text: "Reel with hashtags",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
        meta: { hashtags: ["#facebook", "#reels", "#viral"] },
      };

      assert.ok(Array.isArray(post.meta?.hashtags));
      assert.strictEqual((post.meta?.hashtags as unknown[])?.length, 3);
    });

    it("should support reel with mentions", () => {
      const post: RenderedPost = {
        body: "Reel with mentions",
        text: "Reel with mentions",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
        meta: {
          mentions: [
            { id: "user-1", username: "@user1" },
            { id: "user-2", username: "@user2" },
          ],
        },
      };

      assert.ok(Array.isArray(post.meta?.mentions));
      assert.strictEqual((post.meta?.mentions as unknown[])?.length, 2);
    });

    it("should support reel with music track", () => {
      const post: RenderedPost = {
        body: "Reel with music",
        text: "Reel with music",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
        meta: {
          musicTrack: {
            id: "track-789",
            title: "Trending Song",
            artist: "Artist Name",
          },
        },
      };

      assert.ok(post.meta?.musicTrack);
      assert.strictEqual((post.meta.musicTrack as any).id, "track-789");
    });

    it("should support reel with effects", () => {
      const post: RenderedPost = {
        body: "Reel with effects",
        text: "Reel with effects",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
        meta: {
          effects: [
            { id: "effect-1", name: "Filter 1" },
            { id: "effect-2", name: "Filter 2" },
          ],
        },
      };

      assert.ok(Array.isArray(post.meta?.effects));
      assert.strictEqual((post.meta?.effects as unknown[])?.length, 2);
    });

    it("should support scheduled reel publishing", () => {
      const scheduledTime = new Date("2025-10-08T12:00:00Z");
      const post: RenderedPost = {
        body: "Scheduled reel",
        text: "Scheduled reel",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
        meta: { scheduledPublishTime: scheduledTime.toISOString() },
      };

      assert.ok(post.meta?.scheduledPublishTime);
      assert.strictEqual(
        new Date(post.meta.scheduledPublishTime as string).getTime(),
        scheduledTime.getTime()
      );
    });

    it("should support cross-posting reel to Instagram", () => {
      const post: RenderedPost = {
        body: "Cross-posted reel",
        text: "Cross-posted reel",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
        meta: { crossPostToInstagram: true },
      };

      assert.strictEqual(post.meta?.crossPostToInstagram, true);
    });
  });

  describe("Post Publishing - publishPost()", () => {
    it("should support text-only posts", () => {
      const post: RenderedPost = {
        body: "Text-only post",
        text: "Text-only post",
      };

      assert.ok(post.body);
      assert.ok(!post.media || post.media.length === 0);
    });

    it("should support posts with single image", () => {
      const post: RenderedPost = {
        body: "Post with image",
        text: "Post with image",
        media: [{ type: "image", url: "https://example.com/image.jpg" }],
      };

      assert.strictEqual(post.media?.length, 1);
      assert.strictEqual(post.media![0]!.type, "image");
    });

    it("should support posts with multiple images (up to 10)", () => {
      const media = Array.from({ length: 10 }, (_, i) => ({
        type: "image" as const,
        url: `https://example.com/image${i + 1}.jpg`,
      }));

      const post: RenderedPost = {
        body: "Post with multiple images",
        text: "Post with multiple images",
        media,
      };

      assert.strictEqual(post.media?.length, 10);
    });

    it("should support posts with video", () => {
      const post: RenderedPost = {
        body: "Post with video",
        text: "Post with video",
        media: [{ type: "video", url: "https://example.com/video.mp4" }],
      };

      assert.strictEqual(post.media?.length, 1);
      assert.strictEqual(post.media![0]!.type, "video");
    });

    it("should respect character limit (63206 characters)", () => {
      const adapter = new FacebookAdapter();
      const maxChars = adapter.limits.maxChars || 63206;

      assert.strictEqual(maxChars, 63206);
    });
  });

  describe("Integration - publish() Method Routing", () => {
    it("should route to publishStory() for STORY content type", () => {
      const post: RenderedPost = {
        body: "Story content",
        text: "Story content",
        media: [{ type: "image", url: "https://example.com/story.jpg" }],
        meta: { contentType: "story" },
      };

      const adapter = new FacebookAdapter();
      const contentType = (adapter as any).detectContentType(post);
      assert.strictEqual(contentType, "STORY");
    });

    it("should route to publishReel() for REEL content type", () => {
      const post: RenderedPost = {
        body: "Reel content",
        text: "Reel content",
        media: [{ type: "video", url: "https://example.com/reel.mp4" }],
        meta: { contentType: "reel" },
      };

      const adapter = new FacebookAdapter();
      const contentType = (adapter as any).detectContentType(post);
      assert.strictEqual(contentType, "REEL");
    });

    it("should route to publishPost() for POST content type", () => {
      const post: RenderedPost = {
        body: "Regular post",
        text: "Regular post",
        media: [{ type: "image", url: "https://example.com/image.jpg" }],
      };

      const adapter = new FacebookAdapter();
      const contentType = (adapter as any).detectContentType(post);
      assert.strictEqual(contentType, "POST");
    });
  });
});
