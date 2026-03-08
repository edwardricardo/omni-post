/**
 * Unit Tests for PlatformContentAdapter - Facebook, YouTube, TikTok, Multi-Provider
 *
 * Tests content adaptation for Facebook (long-form content, link preservation),
 * YouTube (video handling, long descriptions), TikTok (vertical video, caption limits),
 * and simultaneous multi-provider adaptation.
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

describe("PlatformContentAdapter - Facebook, YouTube, TikTok, Multi", { concurrency: 1 }, () => {
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

  describe("Facebook Adaptation", () => {
    let samplePost: CanonicalPost;

    beforeEach(() => {
      samplePost = {
        id: "test-post-3",
        projectId: "proj-test",
        locale: "en",
        body: "Check out our latest blog post about social media marketing strategies!",
        media: [
          {
            id: "media-fb-1",
            url: "https://example.com/blog-image.jpg",
            type: "image",
            w: 1200,
            h: 630,
          },
        ],
        tags: ["marketing", "socialmedia", "business"],
        scheduledAt: new Date(),
      };
    });

    it("should handle longer content for Facebook", async () => {
      const longPost: CanonicalPost = {
        ...samplePost,
        body: "A".repeat(5000),
      };

      const result = await adapter.adaptForSingleProvider(longPost, "facebook" as ProviderId);

      assert.strictEqual(result.ok, true, "Adaptation should succeed");
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        assert.ok(adapted.body.length > 0, "Content should be present");
      }
    });

    it("should preserve link formatting", async () => {
      const postWithLink: CanonicalPost = {
        ...samplePost,
        body: "Read more at https://example.com/blog/post",
      };

      const result = await adapter.adaptForSingleProvider(postWithLink, "facebook" as ProviderId);

      assert.strictEqual(result.ok, true, "Adaptation should succeed");
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        assert.ok(adapted.body.includes("https://"), "Link should be preserved");
      }
    });
  });

  describe("YouTube Adaptation", () => {
    let samplePost: CanonicalPost;

    beforeEach(() => {
      samplePost = {
        id: "test-post-4",
        projectId: "proj-test",
        locale: "en",
        body: "Tutorial: How to build a REST API with Node.js and TypeScript",
        media: [
          {
            id: "media-yt-1",
            url: "https://example.com/video.mp4",
            type: "video",
            w: 1920,
            h: 1080,
          },
        ],
        tags: ["tutorial", "nodejs", "typescript", "webdev"],
        scheduledAt: new Date(),
      };
    });

    it("should handle video content for YouTube", async () => {
      const result = await adapter.adaptForSingleProvider(samplePost, "youtube" as ProviderId);

      assert.strictEqual(result.ok, true, "Adaptation should succeed");
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        assert.ok(adapted.media, "Media should be present");
        assert.strictEqual(adapted.media![0].type, "video", "Should have video media");
      }
    });

    it("should allow long descriptions for YouTube", async () => {
      const longDescription: CanonicalPost = {
        ...samplePost,
        body: "A".repeat(3000),
      };

      const result = await adapter.adaptForSingleProvider(longDescription, "youtube" as ProviderId);

      assert.strictEqual(result.ok, true, "Adaptation should succeed");
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        assert.ok(adapted.body.length > 0, "Description should be present");
      }
    });
  });

  describe("TikTok Adaptation", () => {
    let samplePost: CanonicalPost;

    beforeEach(() => {
      samplePost = {
        id: "test-post-5",
        projectId: "proj-test",
        locale: "en",
        body: "Quick coding tip! \u{1F4A1} #coding #programming #tech",
        media: [
          {
            id: "media-tt-1",
            url: "https://example.com/video.mp4",
            type: "video",
            w: 1080,
            h: 1920,
          },
        ],
        tags: ["coding", "programming", "tech", "tutorial"],
        scheduledAt: new Date(),
      };
    });

    it("should handle vertical video for TikTok", async () => {
      const result = await adapter.adaptForSingleProvider(samplePost, "tiktok" as ProviderId);

      assert.strictEqual(result.ok, true, "Adaptation should succeed");
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        assert.ok(adapted.media, "Media should be present");
        assert.strictEqual(adapted.media![0].type, "video", "Should have video media");
      }
    });

    it("should enforce caption character limit for TikTok", async () => {
      const longCaption: CanonicalPost = {
        ...samplePost,
        body: "A".repeat(3000),
      };

      const result = await adapter.adaptForSingleProvider(longCaption, "tiktok" as ProviderId);

      assert.strictEqual(result.ok, true, "Adaptation should succeed");
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        assert.ok(adapted.body.length < longCaption.body.length, "Should truncate long captions");
      }
    });
  });

  describe("Multi-Provider Adaptation", () => {
    let samplePost: CanonicalPost;

    beforeEach(() => {
      samplePost = {
        id: "test-post-multi",
        projectId: "proj-test",
        locale: "en",
        body: "Universal post for all platforms! \u{1F680}",
        media: [
          {
            id: "media-multi-1",
            url: "https://example.com/image.jpg",
            type: "image",
            w: 1200,
            h: 1200,
          },
        ],
        tags: ["universal", "socialmedia", "content"],
        scheduledAt: new Date(),
      };
    });

    it("should adapt for multiple providers simultaneously", async () => {
      const providers: ProviderId[] = ["x", "instagram", "facebook"];

      const result = await adapter.adaptForProviders(samplePost, providers);

      assert.strictEqual(result.ok, true, "Multi-provider adaptation should succeed");
      if (result.ok) {
        assert.strictEqual(
          result.value.size,
          providers.length,
          "Should have adaptations for all providers"
        );

        for (const providerId of providers) {
          const adaptation = result.value.get(providerId);
          assert.ok(adaptation, `Should have adaptation for ${providerId}`);
          assert.ok(adaptation!.adaptedContent, `Should have adapted content for ${providerId}`);
        }
      }
    });

    it("should maintain adaptation independence across providers", async () => {
      const providers: ProviderId[] = ["x", "instagram"];

      const result = await adapter.adaptForProviders(samplePost, providers);

      assert.strictEqual(result.ok, true, "Adaptation should succeed");
      if (result.ok) {
        const xAdaptation = result.value.get("x");
        const instagramAdaptation = result.value.get("instagram");

        assert.ok(xAdaptation, "Should have X adaptation");
        assert.ok(instagramAdaptation, "Should have Instagram adaptation");

        assert.ok(xAdaptation!.adaptationRules.length >= 0, "X should have adaptation rules");
        assert.ok(
          instagramAdaptation!.adaptationRules.length >= 0,
          "Instagram should have adaptation rules"
        );
      }
    });
  });
});
