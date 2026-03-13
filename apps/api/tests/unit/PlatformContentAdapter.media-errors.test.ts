/**
 * Unit Tests for PlatformContentAdapter - Media Transformations, Error Handling,
 * and Adaptation Recommendations
 *
 * Tests media count limits, media preservation, error handling for invalid providers,
 * confidence scoring, warnings, and content recommendation generation.
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
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

describe("PlatformContentAdapter - Media, Errors, and Recommendations", () => {
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

  describe("Media Format Transformations", () => {
    it("should limit media count to platform maximum", async () => {
      const manyMedia: CanonicalPost = {
        id: "many-media-test",
        projectId: "proj-test",
        locale: "en",
        body: "Post with many images",
        media: Array.from({ length: 20 }, (_, i) => ({
          id: `media-many-${i}`,
          url: `https://example.com/image${i}.jpg`,
          type: "image" as const,
          w: 1920,
          h: 1080,
        })),
        tags: [],
        scheduledAt: new Date(),
      };

      const result = await adapter.adaptForSingleProvider(manyMedia, "x" as ProviderId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        expect(adapted.media!.length <= 4).toBeTruthy();
      }
    });

    it("should preserve media when under platform limit", async () => {
      const fewMedia: CanonicalPost = {
        id: "few-media-test",
        projectId: "proj-test",
        locale: "en",
        body: "Post with few images",
        media: [
          {
            id: "media-few-1",
            url: "https://example.com/image1.jpg",
            type: "image",
            w: 1920,
            h: 1080,
          },
          {
            id: "media-few-2",
            url: "https://example.com/image2.jpg",
            type: "image",
            w: 1920,
            h: 1080,
          },
        ],
        tags: [],
        scheduledAt: new Date(),
      };

      const result = await adapter.adaptForSingleProvider(fewMedia, "x" as ProviderId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        expect(adapted.media!.length).toBe(fewMedia.media!.length);
      }
    });

    it("should handle posts without media", async () => {
      const noMedia: CanonicalPost = {
        id: "no-media-test",
        projectId: "proj-test",
        locale: "en",
        body: "Text-only post",
        media: [],
        tags: [],
        scheduledAt: new Date(),
      };

      const result = await adapter.adaptForSingleProvider(noMedia, "x" as ProviderId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        expect(!adapted.media || adapted.media.length === 0).toBeTruthy();
      }
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid provider ID", async () => {
      const samplePost: CanonicalPost = {
        id: "error-test",
        projectId: "proj-test",
        locale: "en",
        body: "Test post",
        media: [],
        tags: [],
        scheduledAt: new Date(),
      };

      const result = await adapter.adaptForSingleProvider(
        samplePost,
        "invalid_provider" as ProviderId
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message.includes("not found")).toBeTruthy();
      }
    });

    it("should provide confidence score for adaptations", async () => {
      const samplePost: CanonicalPost = {
        id: "confidence-test",
        projectId: "proj-test",
        locale: "en",
        body: "Test post for confidence scoring",
        media: [],
        tags: ["test"],
        scheduledAt: new Date(),
      };

      const result = await adapter.adaptForSingleProvider(samplePost, "x" as ProviderId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.confidence !== undefined).toBeTruthy();
        expect(result.value.confidence >= 0 && result.value.confidence <= 1).toBeTruthy();
      }
    });

    it("should handle adaptation warnings", async () => {
      const samplePost: CanonicalPost = {
        id: "warning-test",
        projectId: "proj-test",
        locale: "en",
        body: "A".repeat(500),
        media: [],
        tags: [],
        scheduledAt: new Date(),
      };

      const result = await adapter.adaptForSingleProvider(samplePost, "x" as ProviderId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.warnings !== undefined).toBeTruthy();
      }
    });
  });

  describe("Adaptation Recommendations", () => {
    it("should generate recommendations for content", async () => {
      const problematicPost: CanonicalPost = {
        id: "recommendation-test",
        projectId: "proj-test",
        locale: "en",
        body: "A".repeat(500),
        media: Array.from({ length: 10 }, (_, i) => ({
          id: `media-rec-${i}`,
          url: `https://example.com/image${i}.jpg`,
          type: "image" as const,
          w: 1920,
          h: 1080,
        })),
        tags: [],
        scheduledAt: new Date(),
      };

      const recommendations = await adapter.getAdaptationRecommendations(problematicPost, [
        "x" as ProviderId,
      ]);

      expect(recommendations.size > 0).toBeTruthy();

      const xRecommendations = recommendations.get("x" as ProviderId);
      expect(xRecommendations && xRecommendations.length > 0).toBeTruthy();
    });

    it("should recommend text shortening for long content", async () => {
      const longPost: CanonicalPost = {
        id: "long-recommendation-test",
        projectId: "proj-test",
        locale: "en",
        body: "A".repeat(1000),
        media: [],
        tags: [],
        scheduledAt: new Date(),
      };

      const recommendations = await adapter.getAdaptationRecommendations(longPost, [
        "x" as ProviderId,
      ]);

      const xRecommendations = recommendations.get("x" as ProviderId);
      expect(xRecommendations).toBeTruthy();
      expect(xRecommendations!.some((r) => r.includes("shorten"))).toBeTruthy();
    });
  });
});
