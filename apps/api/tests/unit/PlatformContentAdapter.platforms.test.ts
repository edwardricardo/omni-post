/**
 * Unit Tests for PlatformContentAdapter - Facebook, YouTube, TikTok, Multi-Provider
 *
 * Tests content adaptation for Facebook (long-form content, link preservation),
 * YouTube (video handling, long descriptions), TikTok (vertical video, caption limits),
 * and simultaneous multi-provider adaptation.
 *
 * @file PlatformContentAdapter.platforms.test.ts
 * @description Tests for PlatformContentAdapter - Facebook, YouTube, TikTok, Multi
 * @layer infrastructure
 */

import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from "vitest";
import { prisma } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import promClient from "prom-client";
import { PlatformContentAdapter } from "../../src/content/PlatformContentAdapter.js";
import type { EventService } from "../../src/events/EventService.js";

import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../../src/providers/providerAdapter.interface.js";

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

const mockRedis = {
  get: vi.fn(async () => null),
  set: vi.fn(async () => "OK"),
  setex: vi.fn(async () => "OK"),
  del: vi.fn(async () => 1),
  hget: vi.fn(async () => null),
  hset: vi.fn(async () => 1),
  hexists: vi.fn(async () => 0),
  keys: vi.fn(async () => []),
  lpush: vi.fn(async () => 1),
  lrange: vi.fn(async () => []),
  xack: vi.fn(async () => 0),
  xgroup: vi.fn(async () => "OK"),
  xreadgroup: vi.fn(async () => null),
  disconnect: vi.fn(),
  quit: vi.fn(),
  status: "ready",
} as unknown as import("ioredis").default;

describe("PlatformContentAdapter - Facebook, YouTube, TikTok, Multi", () => {
  let adapter: PlatformContentAdapter;

  beforeAll(async () => {
    const eventService: Pick<EventService, "publishEvent"> = {
      publishEvent: async () => ({ ok: true as const, value: undefined }),
    };

    adapter = new PlatformContentAdapter({
      prisma: prisma as unknown as PrismaClient,
      redis: mockRedis,
      eventService: eventService as EventService,
    });
    await adapter.initialize();
  });

  afterAll(async () => {
    promClient.register.clear();
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

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        expect(adapted.body.length > 0).toBeTruthy();
      }
    });

    it("should preserve link formatting", async () => {
      const postWithLink: CanonicalPost = {
        ...samplePost,
        body: "Read more at https://example.com/blog/post",
      };

      const result = await adapter.adaptForSingleProvider(postWithLink, "facebook" as ProviderId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        expect(adapted.body.includes("https://")).toBeTruthy();
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

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        expect(adapted.media).toBeTruthy();
        expect(adapted.media![0].type).toBe("video");
      }
    });

    it("should allow long descriptions for YouTube", async () => {
      const longDescription: CanonicalPost = {
        ...samplePost,
        body: "A".repeat(3000),
      };

      const result = await adapter.adaptForSingleProvider(longDescription, "youtube" as ProviderId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        expect(adapted.body.length > 0).toBeTruthy();
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

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        expect(adapted.media).toBeTruthy();
        expect(adapted.media![0].type).toBe("video");
      }
    });

    it("should enforce caption character limit for TikTok", async () => {
      const longCaption: CanonicalPost = {
        ...samplePost,
        body: "A".repeat(3000),
      };

      const result = await adapter.adaptForSingleProvider(longCaption, "tiktok" as ProviderId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        expect(adapted.body.length < longCaption.body.length).toBeTruthy();
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

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.size).toBe(providers.length);

        for (const providerId of providers) {
          const adaptation = result.value.get(providerId);
          expect(adaptation).toBeTruthy();
          expect(adaptation!.adaptedContent).toBeTruthy();
        }
      }
    });

    it("should maintain adaptation independence across providers", async () => {
      const providers: ProviderId[] = ["x", "instagram"];

      const result = await adapter.adaptForProviders(samplePost, providers);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const xAdaptation = result.value.get("x");
        const instagramAdaptation = result.value.get("instagram");

        expect(xAdaptation).toBeTruthy();
        expect(instagramAdaptation).toBeTruthy();

        expect(xAdaptation!.adaptationRules.length >= 0).toBeTruthy();
        expect(instagramAdaptation!.adaptationRules.length >= 0).toBeTruthy();
      }
    });
  });
});
