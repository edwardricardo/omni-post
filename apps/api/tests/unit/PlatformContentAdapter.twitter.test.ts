/**
 * Unit Tests for PlatformContentAdapter - Twitter/X and Instagram
 *
 * Tests content adaptation for Twitter/X (280 char limit, 4 media max)
 * and Instagram (2200 char caption, 30 hashtag max, carousel support).
 *
 * @file PlatformContentAdapter.twitter.test.ts
 * @description Tests for PlatformContentAdapter - Twitter/X and Instagram
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

describe("PlatformContentAdapter - Twitter/X and Instagram", () => {
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

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adaptedLength = result.value.adaptedContent.body.length;
        expect(adaptedLength <= 280).toBeTruthy();
      }
    });

    it("should preserve hashtags within character limit", async () => {
      const result = await adapter.adaptForSingleProvider(samplePost, "x" as ProviderId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        expect(adapted.tags).toBeTruthy();
        expect(adapted.tags!.length > 0).toBeTruthy();
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

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        expect(adapted.media).toBeTruthy();
        expect(adapted.media!.length <= 4).toBeTruthy();
      }
    });

    it("should truncate long content with ellipsis", async () => {
      const longPost: CanonicalPost = {
        ...samplePost,
        body: "This is a very long post that definitely exceeds the character limit. ".repeat(10),
      };

      const result = await adapter.adaptForSingleProvider(longPost, "x" as ProviderId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent.body;
        if (adapted.length < longPost.body.length) {
          expect(adapted.endsWith("...")).toBeTruthy();
        }
      }
    });

    it("should preserve complete words when truncating", async () => {
      const longPost: CanonicalPost = {
        ...samplePost,
        body: "word ".repeat(100),
      };

      const result = await adapter.adaptForSingleProvider(longPost, "x" as ProviderId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent.body;
        const withoutEllipsis = adapted.replace(/\.\.\.$/, "").trim();
        const lastWord = withoutEllipsis.split(" ").pop() || "";
        expect(lastWord).toBe("word");
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

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        expect(adapted.body.length).toBe(2000);
      }
    });

    it("should optimize hashtags with max 30 limit", async () => {
      const manyTags: CanonicalPost = {
        ...samplePost,
        tags: Array.from({ length: 40 }, (_, i) => `tag${i}`),
      };

      const result = await adapter.adaptForSingleProvider(manyTags, "instagram" as ProviderId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        expect(adapted.tags!.length <= 30).toBeTruthy();
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

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        expect(adapted.media!.length <= 10).toBeTruthy();
      }
    });

    it("should preserve emoji in captions", async () => {
      const result = await adapter.adaptForSingleProvider(samplePost, "instagram" as ProviderId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        expect(adapted.body.includes("\u{1F305}")).toBeTruthy();
      }
    });
  });
});
