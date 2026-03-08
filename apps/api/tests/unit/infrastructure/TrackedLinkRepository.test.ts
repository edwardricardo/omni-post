/**
 * Infrastructure Layer - Prisma TrackedLink Repository Unit Tests
 *
 * Part of Sprint 19: Link Tracking Feature
 * Tests PrismaTrackedLinkRepository in isolation using a mocked PrismaClient.
 * Tier 0: No database required.
 */

import { describe, it, beforeEach } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";

import { PrismaTrackedLinkRepository } from "../../../src/infrastructure/repositories/PrismaTrackedLinkRepository.js";
import { TrackedLink, TrackedLinkId, ProjectId, LinkClick } from "../../../src/domain/index.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const LINK_ID = "a0000000-0000-4000-8000-000000000050";
const PROJECT_ID = "b0000000-0000-4000-8000-000000000001";

function baseRow() {
  return {
    id: LINK_ID,
    projectId: PROJECT_ID,
    originalUrl: "https://example.com/page1",
    shortCode: "abc123",
    vanitySlug: null as string | null,
    clicks: 0,
    isActive: true,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function makeMockPrisma(t: TestContext) {
  const txClient = {
    linkClick: {
      create: t.mock.fn(async () => ({})),
      deleteMany: t.mock.fn(async () => ({ count: 0 })),
    },
    trackedLink: {
      update: t.mock.fn(async () => baseRow()),
      delete: t.mock.fn(async () => baseRow()),
    },
  };

  return {
    _txClient: txClient,
    trackedLink: {
      findUnique: t.mock.fn(async () => baseRow()),
      findFirst: t.mock.fn(async () => baseRow()),
      findMany: t.mock.fn(async () => [baseRow()]),
      create: t.mock.fn(async () => baseRow()),
      update: t.mock.fn(async () => baseRow()),
      delete: t.mock.fn(async () => baseRow()),
    },
    linkClick: {
      create: t.mock.fn(async () => ({})),
      findMany: t.mock.fn(async () => [
        { country: "US", timestamp: new Date() },
        { country: "US", timestamp: new Date() },
        { country: "UK", timestamp: new Date() },
      ]),
      deleteMany: t.mock.fn(async () => ({ count: 0 })),
    },
    // $transaction: supports both array form and callback form
    $transaction: t.mock.fn(async (arg: unknown) => {
      if (Array.isArray(arg)) {
        // Array transaction (used by delete and recordClick)
        for (const op of arg as Promise<unknown>[]) {
          await op;
        }
        return [];
      }
      // Callback transaction
      return (arg as (tx: typeof txClient) => Promise<unknown>)(txClient);
    }),
  };
}

/** Build a domain TrackedLink for use in tests without hitting the DB. */
function buildTestLink(): TrackedLink {
  const result = TrackedLink.create({
    projectId: ProjectId.fromStringUnsafe(PROJECT_ID),
    originalUrl: "https://example.com/page1",
  });
  if (!result.ok) throw new Error("Failed to create test TrackedLink");
  return result.value;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PrismaTrackedLinkRepository", { concurrency: 1 }, () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: PrismaTrackedLinkRepository;

  beforeEach((t) => {
    prisma = makeMockPrisma(t);
    repo = new PrismaTrackedLinkRepository(prisma as never);
  });

  // ── save ────────────────────────────────────────────────────────────────────

  describe("save — create path", () => {
    it("calls trackedLink.create when the link does not exist yet", async () => {
      // findUnique returns null → create path
      prisma.trackedLink.findUnique.mock.mockImplementation(async () => null);

      const link = buildTestLink();
      const result = await repo.save(link);

      assert.ok(result.ok);
      assert.equal(prisma.trackedLink.create.mock.calls.length, 1);
      assert.equal(prisma.trackedLink.update.mock.calls.length, 0);
    });

    it("persists the correct fields on create", async () => {
      prisma.trackedLink.findUnique.mock.mockImplementation(async () => null);

      const link = buildTestLink();
      await repo.save(link);

      const callRecord = prisma.trackedLink.create.mock.calls[0];
      const args = callRecord?.arguments[0] as { data: Record<string, unknown> } | undefined;
      assert.equal(args?.data.id, link.id.value);
      assert.equal(args?.data.projectId, PROJECT_ID);
      assert.equal(args?.data.originalUrl, "https://example.com/page1");
      assert.equal(typeof args?.data.shortCode, "string");
    });

    it("returns err when create throws", async () => {
      prisma.trackedLink.findUnique.mock.mockImplementation(async () => null);
      prisma.trackedLink.create.mock.mockImplementation(async () => {
        throw new Error("Unique constraint violation");
      });

      const link = buildTestLink();
      const result = await repo.save(link);

      assert.ok(!result.ok);
      assert.match(result.error.message, /Unique constraint/);
    });
  });

  describe("save — update path", () => {
    it("calls trackedLink.update when the link already exists", async () => {
      // findUnique returns existing row → update path
      prisma.trackedLink.findUnique.mock.mockImplementation(async () => baseRow());

      const link = buildTestLink();
      const result = await repo.save(link);

      assert.ok(result.ok);
      assert.equal(prisma.trackedLink.update.mock.calls.length, 1);
      assert.equal(prisma.trackedLink.create.mock.calls.length, 0);
    });

    it("updates clicks and isActive on update", async () => {
      prisma.trackedLink.findUnique.mock.mockImplementation(async () => baseRow());

      const link = buildTestLink();
      link.recordClick();
      link.recordClick();

      await repo.save(link);

      const callRecord = prisma.trackedLink.update.mock.calls[0];
      const args = callRecord?.arguments[0] as
        | { data: { clicks: number; isActive: boolean } }
        | undefined;
      assert.equal(args?.data.clicks, 2);
      assert.equal(args?.data.isActive, true);
    });
  });

  // ── findById ────────────────────────────────────────────────────────────────

  describe("findById", () => {
    it("returns ok(TrackedLink) when link exists", async () => {
      const id = TrackedLinkId.fromStringUnsafe(LINK_ID);
      const result = await repo.findById(id);

      assert.ok(result.ok);
      assert.equal(result.value.originalUrl, "https://example.com/page1");
      assert.equal(result.value.isActive, true);
      assert.equal(prisma.trackedLink.findUnique.mock.calls.length, 1);
    });

    it("returns err(EntityNotFoundError) when link does not exist", async () => {
      prisma.trackedLink.findUnique.mock.mockImplementation(async () => null);
      const id = TrackedLinkId.fromStringUnsafe(LINK_ID);
      const result = await repo.findById(id);

      assert.ok(!result.ok);
      assert.match(result.error.message, /TrackedLink/);
    });

    it("maps vanitySlug when present", async () => {
      prisma.trackedLink.findUnique.mock.mockImplementation(async () => ({
        ...baseRow(),
        vanitySlug: "my-campaign",
      }));

      const id = TrackedLinkId.fromStringUnsafe(LINK_ID);
      const result = await repo.findById(id);

      assert.ok(result.ok);
      assert.equal(result.value.vanitySlug, "my-campaign");
    });
  });

  // ── findByShortCode ─────────────────────────────────────────────────────────

  describe("findByShortCode", () => {
    it("returns ok(TrackedLink) when found by short code", async () => {
      const result = await repo.findByShortCode("abc123");

      assert.ok(result.ok);
      assert.equal(result.value.id.value, LINK_ID);
      assert.equal(prisma.trackedLink.findFirst.mock.calls.length, 1);
    });

    it("passes OR clause with both shortCode and vanitySlug", async () => {
      await repo.findByShortCode("some-slug");

      const callRecord = prisma.trackedLink.findFirst.mock.calls[0];
      const args = callRecord?.arguments[0] as
        | { where: { OR: { shortCode?: string; vanitySlug?: string }[] } }
        | undefined;
      assert.ok(Array.isArray(args?.where.OR));
      assert.equal(args?.where.OR.length, 2);
      const hasShortCode = args?.where.OR.some((c) => "shortCode" in c);
      const hasVanitySlug = args?.where.OR.some((c) => "vanitySlug" in c);
      assert.ok(hasShortCode);
      assert.ok(hasVanitySlug);
    });

    it("returns err(EntityNotFoundError) when not found", async () => {
      prisma.trackedLink.findFirst.mock.mockImplementation(async () => null);
      const result = await repo.findByShortCode("nonexistent");

      assert.ok(!result.ok);
      assert.match(result.error.message, /TrackedLink/);
    });
  });

  // ── findByProjectId ─────────────────────────────────────────────────────────

  describe("findByProjectId", () => {
    it("returns all links for a project", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const links = await repo.findByProjectId(projectId);

      assert.equal(links.length, 1);
      assert.equal(links[0]?.originalUrl, "https://example.com/page1");
      assert.equal(prisma.trackedLink.findMany.mock.calls.length, 1);
    });

    it("filters by projectId in the where clause", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.findByProjectId(projectId);

      const callRecord = prisma.trackedLink.findMany.mock.calls[0];
      const args = callRecord?.arguments[0] as
        | { where: { projectId: string; isActive?: boolean } }
        | undefined;
      assert.equal(args?.where.projectId, PROJECT_ID);
    });

    it("adds isActive: true filter when activeOnly option is set", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.findByProjectId(projectId, { activeOnly: true });

      const callRecord = prisma.trackedLink.findMany.mock.calls[0];
      const args = callRecord?.arguments[0] as
        | { where: { projectId: string; isActive?: boolean } }
        | undefined;
      assert.equal(args?.where.isActive, true);
    });

    it("does not include isActive filter when activeOnly is not set", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.findByProjectId(projectId);

      const callRecord = prisma.trackedLink.findMany.mock.calls[0];
      const args = callRecord?.arguments[0] as { where: Record<string, unknown> } | undefined;
      assert.equal(Object.prototype.hasOwnProperty.call(args?.where, "isActive"), false);
    });

    it("returns empty array when project has no links", async () => {
      prisma.trackedLink.findMany.mock.mockImplementation(async () => []);
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const links = await repo.findByProjectId(projectId);
      assert.equal(links.length, 0);
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("returns ok when link exists", async () => {
      const id = TrackedLinkId.fromStringUnsafe(LINK_ID);
      const result = await repo.delete(id);

      assert.ok(result.ok);
      // Used $transaction to cascade-delete clicks first
      assert.equal(prisma.$transaction.mock.calls.length, 1);
    });

    it("returns err(EntityNotFoundError) when link does not exist", async () => {
      prisma.trackedLink.findUnique.mock.mockImplementation(async () => null);
      const id = TrackedLinkId.fromStringUnsafe(LINK_ID);
      const result = await repo.delete(id);

      assert.ok(!result.ok);
      assert.match(result.error.message, /TrackedLink/);
      assert.equal(prisma.$transaction.mock.calls.length, 0);
    });
  });

  // ── recordClick ─────────────────────────────────────────────────────────────

  describe("recordClick", () => {
    it("calls $transaction with linkClick.create and trackedLink.update", async () => {
      const linkId = TrackedLinkId.fromStringUnsafe(LINK_ID);
      const clickResult = LinkClick.create({
        trackedLinkId: linkId,
        country: "US",
        city: "New York",
      });
      assert.ok(clickResult.ok);

      const result = await repo.recordClick(linkId, clickResult.value);

      assert.ok(result.ok);
      assert.equal(prisma.$transaction.mock.calls.length, 1);
    });

    it("returns err when $transaction throws", async () => {
      prisma.$transaction.mock.mockImplementation(async () => {
        throw new Error("DB error during click");
      });

      const linkId = TrackedLinkId.fromStringUnsafe(LINK_ID);
      const clickResult = LinkClick.create({ trackedLinkId: linkId });
      assert.ok(clickResult.ok);

      const result = await repo.recordClick(linkId, clickResult.value);

      assert.ok(!result.ok);
      assert.match(result.error.message, /DB error during click/);
    });
  });

  // ── getClickStats ────────────────────────────────────────────────────────────

  describe("getClickStats", () => {
    it("returns totalClicks and clicksByCountry breakdown", async () => {
      prisma.trackedLink.findUnique.mock.mockImplementation(async () => ({
        ...baseRow(),
        clicks: 3,
      }));
      prisma.linkClick.findMany.mock.mockImplementation(async () => [
        { country: "US", timestamp: new Date() },
        { country: "US", timestamp: new Date() },
        { country: "UK", timestamp: new Date() },
      ]);

      const linkId = TrackedLinkId.fromStringUnsafe(LINK_ID);
      const stats = await repo.getClickStats(linkId);

      assert.equal(stats.totalClicks, 3);
      assert.equal(stats.clicksByCountry["US"], 2);
      assert.equal(stats.clicksByCountry["UK"], 1);
    });

    it("returns zero counts when link has no clicks", async () => {
      prisma.trackedLink.findUnique.mock.mockImplementation(async () => ({
        ...baseRow(),
        clicks: 0,
      }));
      prisma.linkClick.findMany.mock.mockImplementation(async () => []);

      const linkId = TrackedLinkId.fromStringUnsafe(LINK_ID);
      const stats = await repo.getClickStats(linkId);

      assert.equal(stats.totalClicks, 0);
      assert.deepEqual(stats.clicksByCountry, {});
    });

    it("groups clicks with null country under Unknown", async () => {
      prisma.trackedLink.findUnique.mock.mockImplementation(async () => ({
        ...baseRow(),
        clicks: 1,
      }));
      prisma.linkClick.findMany.mock.mockImplementation(async () => [
        { country: null, timestamp: new Date() },
      ]);

      const linkId = TrackedLinkId.fromStringUnsafe(LINK_ID);
      const stats = await repo.getClickStats(linkId);

      assert.equal(stats.totalClicks, 1);
      assert.equal(stats.clicksByCountry["Unknown"], 1);
    });
  });
});
