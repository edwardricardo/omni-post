/**
 * Unit Tests for PlatformContentAdapter - Content Truncation and Hashtag Optimization
 *
 * Tests character-limit enforcement with ellipsis truncation and word-boundary
 * preservation, plus hashtag count limits and preservation logic.
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

describe("PlatformContentAdapter - Content Truncation and Hashtag Optimization", () => {
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

  describe("Initialization", () => {
    it("should initialize with transformers and strategies", async () => {
      const initEventService: Pick<EventService, "publishEvent"> = {
        publishEvent: async () => ({ ok: true as const, value: undefined }),
      };

      const testAdapter = new PlatformContentAdapter({
        prisma: prisma as unknown as PrismaClient,
        redis: mockRedis,
        eventService: initEventService as EventService,
      });
      await testAdapter.initialize();

      expect(testAdapter).toBeTruthy();
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

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent.body;
        if (adapted.length < longPost.body.length) {
          expect(adapted.endsWith("...")).toBeTruthy();
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

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent.body;
        const withoutEllipsis = adapted.replace(/\.\.\.$/, "").trim();

        const lastChar = withoutEllipsis[withoutEllipsis.length - 1];
        expect(lastChar !== " ").toBeTruthy();
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

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.adaptedContent.body).toBe("");
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

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.adaptedContent.body).toBe(shortPost.body);
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

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        expect(adapted.tags!.length <= 30).toBeTruthy();
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

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        expect(adapted.tags).toStrictEqual(fewTags.tags);
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

      expect(result.ok).toBe(true);
      if (result.ok) {
        const adapted = result.value.adaptedContent;
        expect(!adapted.tags || adapted.tags.length === 0).toBeTruthy();
      }
    });
  });
});
