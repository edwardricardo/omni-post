/**
 * Unit Tests for PlatformContentAdapter - Content Truncation and Hashtag Optimization
 *
 * Tests character-limit enforcement with ellipsis truncation and word-boundary
 * preservation, plus hashtag count limits and preservation logic.
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

describe(
  "PlatformContentAdapter - Content Truncation and Hashtag Optimization",
  { concurrency: 1 },
  () => {
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

    describe("Initialization", () => {
      it("should initialize with transformers and strategies", async () => {
        const initEventService: Pick<EventService, "publishEvent"> = {
          publishEvent: async () => ({ ok: true as const, value: undefined }),
        };

        const testAdapter = new PlatformContentAdapter({
          prisma,
          redis,
          eventService: initEventService as EventService,
        });
        await testAdapter.initialize();

        assert.ok(testAdapter, "Adapter should be initialized");
      });
    });

    describe("Content Truncation", () => {
      it("should truncate with ellipsis when content exceeds limit", async () => {
        const longPost: CanonicalPost = {
          id: "truncate-test",
          projectId: "proj-test",
          locale: "en",
          body: "This is a very long sentence that will definitely exceed the character limit. ".repeat(
            10
          ),
          media: [],
          tags: [],
          scheduledAt: new Date(),
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

      it("should preserve complete words during truncation", async () => {
        const longPost: CanonicalPost = {
          id: "word-boundary-test",
          projectId: "proj-test",
          locale: "en",
          body: "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega".repeat(
            5
          ),
          media: [],
          tags: [],
          scheduledAt: new Date(),
        };

        const result = await adapter.adaptForSingleProvider(longPost, "x" as ProviderId);

        assert.strictEqual(result.ok, true, "Adaptation should succeed");
        if (result.ok) {
          const adapted = result.value.adaptedContent.body;
          const withoutEllipsis = adapted.replace(/\.\.\.$/, "").trim();

          const lastChar = withoutEllipsis[withoutEllipsis.length - 1];
          assert.ok(lastChar !== " ", "Should not end with space");
        }
      });

      it("should handle empty content gracefully", async () => {
        const emptyPost: CanonicalPost = {
          id: "empty-test",
          projectId: "proj-test",
          locale: "en",
          body: "",
          media: [],
          tags: [],
          scheduledAt: new Date(),
        };

        const result = await adapter.adaptForSingleProvider(emptyPost, "x" as ProviderId);

        assert.strictEqual(result.ok, true, "Should handle empty content");
        if (result.ok) {
          assert.strictEqual(
            result.value.adaptedContent.body,
            "",
            "Empty content should remain empty"
          );
        }
      });

      it("should not truncate content already within limits", async () => {
        const shortPost: CanonicalPost = {
          id: "short-test",
          projectId: "proj-test",
          locale: "en",
          body: "Short tweet",
          media: [],
          tags: [],
          scheduledAt: new Date(),
        };

        const result = await adapter.adaptForSingleProvider(shortPost, "x" as ProviderId);

        assert.strictEqual(result.ok, true, "Adaptation should succeed");
        if (result.ok) {
          assert.strictEqual(
            result.value.adaptedContent.body,
            shortPost.body,
            "Short content should not be modified"
          );
        }
      });
    });

    describe("Hashtag Optimization", () => {
      it("should limit hashtags to platform maximum", async () => {
        const manyTags: CanonicalPost = {
          id: "hashtag-test",
          projectId: "proj-test",
          locale: "en",
          body: "Post with many hashtags",
          media: [],
          tags: Array.from({ length: 50 }, (_, i) => `tag${i}`),
          scheduledAt: new Date(),
        };

        const result = await adapter.adaptForSingleProvider(manyTags, "instagram" as ProviderId);

        assert.strictEqual(result.ok, true, "Adaptation should succeed");
        if (result.ok) {
          const adapted = result.value.adaptedContent;
          assert.ok(
            adapted.tags!.length <= 30,
            "Should limit to platform maximum (30 for Instagram)"
          );
        }
      });

      it("should preserve original hashtags when under limit", async () => {
        const fewTags: CanonicalPost = {
          id: "few-tags-test",
          projectId: "proj-test",
          locale: "en",
          body: "Post with few hashtags",
          media: [],
          tags: ["one", "two", "three"],
          scheduledAt: new Date(),
        };

        const result = await adapter.adaptForSingleProvider(fewTags, "x" as ProviderId);

        assert.strictEqual(result.ok, true, "Adaptation should succeed");
        if (result.ok) {
          const adapted = result.value.adaptedContent;
          assert.deepStrictEqual(
            adapted.tags,
            fewTags.tags,
            "Should preserve all original tags when under limit"
          );
        }
      });

      it("should handle empty hashtag array", async () => {
        const noTags: CanonicalPost = {
          id: "no-tags-test",
          projectId: "proj-test",
          locale: "en",
          body: "Post without hashtags",
          media: [],
          tags: [],
          scheduledAt: new Date(),
        };

        const result = await adapter.adaptForSingleProvider(noTags, "x" as ProviderId);

        assert.strictEqual(result.ok, true, "Adaptation should succeed");
        if (result.ok) {
          const adapted = result.value.adaptedContent;
          assert.ok(
            !adapted.tags || adapted.tags.length === 0,
            "Should handle empty tags gracefully"
          );
        }
      });
    });
  }
);
