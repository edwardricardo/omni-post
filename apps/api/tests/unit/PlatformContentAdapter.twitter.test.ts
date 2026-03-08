/**
 * Unit Tests for PlatformContentAdapter - Twitter/X and Instagram
 *
 * Tests content adaptation for Twitter/X (280 char limit, 4 media max)
 * and Instagram (2200 char caption, 30 hashtag max, carousel support).
 */

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import Redis from "ioredis";
import promClient from "prom-client";
import { PlatformContentAdapter } from "../../src/content/PlatformContentAdapter.js";
import { EventService } from "../../src/events/EventService.js";

import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../../src/providers/providerAdapter.interface.js";

describe("PlatformContentAdapter - Twitter/X and Instagram", { concurrency: 1 }, () => {
  let adapter: PlatformContentAdapter;
  let prisma: PrismaClient;
  let redis: Redis;

  before(async () => {
    prisma = createTestPrismaClient();
    redis = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
    });

    const eventService: Pick<EventService, "publishEvent"> = {
      publishEvent: async () => ({ ok: true as const, value: undefined }),
    };

    adapter = new PlatformContentAdapter({
      prisma,
      redis,
      eventService: eventService as EventService,
    });
    await adapter.initialize();
  });

  after(async () => {
    promClient.register.clear();
    redis.disconnect(false);
    await prisma.$disconnect();
  });

  describe("Twitter/X Adaptation", () => {
    let samplePost: CanonicalPost;

    beforeEach(() => {
      samplePost = {
        id: "test-post-1",
        projectId: "proj-test",
        locale: "en",
        body: "This is a sample tweet for testing platform adaptation features.",
        media: [],
        tags: ["testing", "automation", "socialmedia"],
        scheduledAt: new Date(),
      };
    });

    it("should enforce 280 character limit for Twitter/X", async () => {
      const longPost: CanonicalPost = {
        ...samplePost,
        body: "A".repeat(300),
      };

      const result = await adapter.adaptForSingleProvider(longPost, "x" as ProviderId);

      assert.strictEqual(
        result.ok,
        true,
        `Adaptation should succeed. Error: ${!result.ok ? result.error.message : "none"}`
      );
      if (result.ok) {
        const adaptedLength = result.value.adaptedContent.body.length;
        assert.ok(
          adaptedLength <= 280,
          `Adapted content should be <= 280 chars, got ${adaptedLength}`
        );
      }
    });

    it("should preserve hashtags within character limit", async () => {
      const result = await adapter.adaptForSingleProvider(samplePost, "x" as ProviderId);

      assert.strictEqual(result.ok, true, "Adaptation should succeed");
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        assert.ok(adapted.tags, "Tags should be preserved");
        assert.ok(adapted.tags!.length > 0, "Should have at least one tag");
      }
    });

    it("should handle media attachments for Twitter/X", async () => {
      const postWithMedia: CanonicalPost = {
        ...samplePost,
        media: [
          {
            id: "media-x-1",
            url: "https://example.com/image1.jpg",
            type: "image",
            w: 1920,
            h: 1080,
          },
          {
            id: "media-x-2",
            url: "https://example.com/image2.jpg",
            type: "image",
            w: 1920,
            h: 1080,
          },
        ],
      };

      const result = await adapter.adaptForSingleProvider(postWithMedia, "x" as ProviderId);

      assert.strictEqual(result.ok, true, "Adaptation should succeed");
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        assert.ok(adapted.media, "Media should be present");
        assert.ok(adapted.media!.length <= 4, "Should respect Twitter's 4 media limit");
      }
    });

    it("should truncate long content with ellipsis", async () => {
      const longPost: CanonicalPost = {
        ...samplePost,
        body: "This is a very long post that definitely exceeds the character limit. ".repeat(10),
      };

      const result = await adapter.adaptForSingleProvider(longPost, "x" as ProviderId);

      assert.strictEqual(result.ok, true, "Adaptation should succeed");
      if (result.ok) {
        const adapted = result.value.adaptedContent.body;
        if (adapted.length < longPost.body.length) {
          assert.ok(adapted.endsWith("..."), "Truncated content should end with ellipsis");
        }
      }
    });

    it("should preserve complete words when truncating", async () => {
      const longPost: CanonicalPost = {
        ...samplePost,
        body: "word ".repeat(100),
      };

      const result = await adapter.adaptForSingleProvider(longPost, "x" as ProviderId);

      assert.strictEqual(result.ok, true, "Adaptation should succeed");
      if (result.ok) {
        const adapted = result.value.adaptedContent.body;
        const withoutEllipsis = adapted.replace(/\.\.\.$/, "").trim();
        const lastWord = withoutEllipsis.split(" ").pop() || "";
        assert.strictEqual(lastWord, "word", `Last word should be complete, got "${lastWord}"`);
      }
    });
  });

  describe("Instagram Adaptation", () => {
    let samplePost: CanonicalPost;

    beforeEach(() => {
      samplePost = {
        id: "test-post-2",
        projectId: "proj-test",
        locale: "en",
        body: "Beautiful sunset photo from today's adventure! \u{1F305}",
        media: [
          {
            id: "media-ig-1",
            url: "https://example.com/sunset.jpg",
            type: "image",
            w: 1080,
            h: 1080,
          },
        ],
        tags: ["sunset", "nature", "photography", "adventure"],
        scheduledAt: new Date(),
      };
    });

    it("should allow 2200 character caption for Instagram", async () => {
      const longCaption: CanonicalPost = {
        ...samplePost,
        body: "A".repeat(2000),
      };

      const result = await adapter.adaptForSingleProvider(longCaption, "instagram" as ProviderId);

      assert.strictEqual(result.ok, true, "Adaptation should succeed");
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        assert.strictEqual(
          adapted.body.length,
          2000,
          "Content within limit should not be truncated"
        );
      }
    });

    it("should optimize hashtags with max 30 limit", async () => {
      const manyTags: CanonicalPost = {
        ...samplePost,
        tags: Array.from({ length: 40 }, (_, i) => `tag${i}`),
      };

      const result = await adapter.adaptForSingleProvider(manyTags, "instagram" as ProviderId);

      assert.strictEqual(result.ok, true, "Adaptation should succeed");
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        assert.ok(
          adapted.tags!.length <= 30,
          `Should limit to 30 tags, got ${adapted.tags!.length}`
        );
      }
    });

    it("should handle carousel posts with multiple images", async () => {
      const carouselPost: CanonicalPost = {
        ...samplePost,
        media: Array.from({ length: 10 }, (_, i) => ({
          id: `media-carousel-${i}`,
          url: `https://example.com/image${i}.jpg`,
          type: "image" as const,
          w: 1080,
          h: 1080,
        })),
      };

      const result = await adapter.adaptForSingleProvider(carouselPost, "instagram" as ProviderId);

      assert.strictEqual(result.ok, true, "Adaptation should succeed");
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        assert.ok(
          adapted.media!.length <= 10,
          "Should respect Instagram's 10 media carousel limit"
        );
      }
    });

    it("should preserve emoji in captions", async () => {
      const result = await adapter.adaptForSingleProvider(samplePost, "instagram" as ProviderId);

      assert.strictEqual(result.ok, true, "Adaptation should succeed");
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        assert.ok(adapted.body.includes("\u{1F305}"), "Emoji should be preserved");
      }
    });
  });
});
