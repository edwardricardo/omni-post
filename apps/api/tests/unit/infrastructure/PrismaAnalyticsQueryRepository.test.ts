/**
 * Infrastructure Layer - Prisma Analytics Query Repository Unit Tests
 *
 * Part of FASE H4b: Hexagonal Architecture - Prisma Adapters
 * Tests PrismaAnalyticsQueryRepository in isolation using a mocked PrismaClient.
 * Tier 0: No database required.
 *
 * @file PrismaAnalyticsQueryRepository.test.ts
 * @description Tests for PrismaAnalyticsQueryRepository
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { PrismaAnalyticsQueryRepository } from "../../../src/infrastructure/repositories/PrismaAnalyticsQueryRepository.js";
import type { DomainAnalytics } from "@shared/types";

// ── helpers ───────────────────────────────────────────────────────────────────

function baseAnalyticsRow() {
  return {
    id: "c0000000-0000-4000-8000-000000000001",
    postId: "d0000000-0000-4000-8000-000000000001",
    channelId: "e0000000-0000-4000-8000-000000000001",
    provider: "X",
    views: 1000,
    likes: 50,
    comments: 10,
    shares: 5,
    capturedAt: new Date("2026-01-15"),
  };
}

function makeMockPrisma() {
  return {
    analytics: {
      findMany: vi.fn(async () => [baseAnalyticsRow()]),
      upsert: vi.fn(async () => baseAnalyticsRow()),
    },
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PrismaAnalyticsQueryRepository", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: PrismaAnalyticsQueryRepository;

  beforeEach(() => {
    prisma = makeMockPrisma();
    repo = new PrismaAnalyticsQueryRepository(prisma as never);
  });

  describe("findByPostId", () => {
    it("returns mapped DomainAnalytics records", async () => {
      const results = await repo.findByPostId("d0000000-0000-4000-8000-000000000001");

      expect(results.length).toBe(1);
      const record = results[0];
      expect(record !== undefined).toBeTruthy();
      expect(record.provider).toBe("X");
      expect(record.views).toBe(1000);
      expect(record.likes).toBe(50);
      expect(record.postId).toBe("d0000000-0000-4000-8000-000000000001");
      expect(prisma.analytics.findMany.mock.calls.length).toBe(1);
    });

    it("returns empty array when no records found", async () => {
      prisma.analytics.findMany.mockImplementation(async () => []);
      const results = await repo.findByPostId("unknown-post");
      expect(results.length).toBe(0);
    });
  });

  describe("findByChannelId", () => {
    it("returns records without period filter", async () => {
      const results = await repo.findByChannelId("e0000000-0000-4000-8000-000000000001");
      expect(results.length).toBe(1);
    });

    it("passes date range to prisma when period is provided", async () => {
      const period = { start: new Date("2026-01-01"), end: new Date("2026-01-31") };

      // Capture the where clause directly in the mock to avoid mock.calls[N].arguments access issues
      let capturedWhere: { capturedAt?: { gte: Date; lte: Date } } | undefined;
      prisma.analytics.findMany.mockImplementation(
        async (args: { where: { capturedAt?: { gte: Date; lte: Date } } }) => {
          capturedWhere = args.where;
          return [baseAnalyticsRow()];
        }
      );

      await repo.findByChannelId("e0000000-0000-4000-8000-000000000001", period);

      expect(capturedWhere !== undefined).toBeTruthy();
      expect(capturedWhere.capturedAt !== undefined).toBeTruthy();
      expect(capturedWhere.capturedAt).toStrictEqual({ gte: period.start, lte: period.end });
    });
  });

  describe("findByProjectId", () => {
    it("queries by channel.projectId", async () => {
      const results = await repo.findByProjectId("f0000000-0000-4000-8000-000000000001");
      expect(results.length).toBe(1);
      expect(prisma.analytics.findMany.mock.calls.length).toBe(1);
    });

    it("queries without capturedAt filter when period is not provided", async () => {
      let capturedWhere: Record<string, unknown> | undefined;
      prisma.analytics.findMany.mockImplementation(
        async (args: { where: Record<string, unknown> }) => {
          capturedWhere = args.where;
          return [baseAnalyticsRow()];
        }
      );

      await repo.findByProjectId("f0000000-0000-4000-8000-000000000001");

      expect(capturedWhere !== undefined).toBeTruthy();
      expect(Object.prototype.hasOwnProperty.call(capturedWhere, "capturedAt")).toBe(false);
    });

    it("applies date range filter when period is provided", async () => {
      const period = { start: new Date("2026-01-01"), end: new Date("2026-01-31") };

      let capturedWhere: { capturedAt?: { gte: Date; lte: Date } } | undefined;
      prisma.analytics.findMany.mockImplementation(
        async (args: { where: { capturedAt?: { gte: Date; lte: Date } } }) => {
          capturedWhere = args.where;
          return [baseAnalyticsRow()];
        }
      );

      await repo.findByProjectId("f0000000-0000-4000-8000-000000000001", period);

      expect(capturedWhere !== undefined).toBeTruthy();
      expect(capturedWhere.capturedAt !== undefined).toBeTruthy();
      expect(capturedWhere.capturedAt).toStrictEqual({ gte: period.start, lte: period.end });
    });
  });

  describe("save", () => {
    it("calls upsert and returns ok", async () => {
      const analytics: DomainAnalytics = {
        id: "c0000000-0000-4000-8000-000000000001",
        postId: "d0000000-0000-4000-8000-000000000001",
        channelId: "e0000000-0000-4000-8000-000000000001",
        provider: "X",
        views: 1200,
        likes: 60,
        comments: 12,
        shares: 8,
        capturedAt: new Date("2026-01-16"),
      };

      const result = await repo.save(analytics);
      expect(result.ok).toBeTruthy();
      expect(prisma.analytics.upsert.mock.calls.length).toBe(1);
    });

    it("returns err when prisma throws", async () => {
      prisma.analytics.upsert.mockImplementation(async () => {
        throw new Error("FK constraint violation");
      });

      const analytics: DomainAnalytics = {
        id: "c0000000-0000-4000-8000-000000000001",
        postId: null,
        channelId: "ghost-channel",
        provider: "X",
        views: null,
        likes: null,
        comments: null,
        shares: null,
        capturedAt: new Date(),
      };

      const result = await repo.save(analytics);
      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/FK constraint/);
    });
  });
});
