/**
 * Unit Tests for PlatformContentAdapter - Media Transformations, Error Handling,
 * and Adaptation Recommendations
 *
 * Tests media count limits, media preservation, error handling for invalid providers,
 * confidence scoring, warnings, and content recommendation generation.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import Redis from "ioredis";
import promClient from "prom-client";
import { PlatformContentAdapter } from "../../src/content/PlatformContentAdapter.js";
import { EventService } from "../../src/events/EventService.js";

import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../../src/providers/providerAdapter.interface.js";

describe("PlatformContentAdapter - Media, Errors, and Recommendations", { concurrency: 1 }, () => {
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

      assert.strictEqual(result.ok, true, "Adaptation should succeed");
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        assert.ok(adapted.media!.length <= 4, "Should limit to platform maximum (4 for Twitter/X)");
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

      assert.strictEqual(result.ok, true, "Adaptation should succeed");
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        assert.strictEqual(
          adapted.media!.length,
          fewMedia.media!.length,
          "Should preserve all media when under limit"
        );
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

      assert.strictEqual(result.ok, true, "Adaptation should succeed");
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        assert.ok(
          !adapted.media || adapted.media.length === 0,
          "Should handle no media gracefully"
        );
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

      assert.strictEqual(result.ok, false, "Should fail for invalid provider");
      if (!result.ok) {
        assert.ok(
          result.error.message.includes("not found"),
          "Error should indicate provider not found"
        );
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

      assert.strictEqual(result.ok, true, "Adaptation should succeed");
      if (result.ok) {
        assert.ok(result.value.confidence !== undefined, "Should have confidence score");
        assert.ok(
          result.value.confidence >= 0 && result.value.confidence <= 1,
          "Confidence should be between 0 and 1"
        );
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

      assert.strictEqual(result.ok, true, "Adaptation should succeed with warnings");
      if (result.ok) {
        assert.ok(result.value.warnings !== undefined, "Should have warnings array");
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

      assert.ok(recommendations.size > 0, "Should generate recommendations");

      const xRecommendations = recommendations.get("x" as ProviderId);
      assert.ok(
        xRecommendations && xRecommendations.length > 0,
        "Should have recommendations for Twitter/X"
      );
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
      assert.ok(xRecommendations, "Should have recommendations");
      assert.ok(
        xRecommendations!.some((r) => r.includes("shorten")),
        "Should recommend shortening text"
      );
    });
  });
});
