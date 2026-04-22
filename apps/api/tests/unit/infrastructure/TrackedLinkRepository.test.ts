/**
 * Infrastructure Layer - Prisma TrackedLink Repository Unit Tests
 *
 * Tests PrismaTrackedLinkRepository in isolation using a mocked PrismaClient.
 * Tier 0: No database required.
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
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

function makeMockPrisma() {
  const txClient = {
    linkClick: {
      create: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    trackedLink: {
      update: vi.fn(async () => baseRow()),
      delete: vi.fn(async () => baseRow()),
    },
  };

  return {
    _txClient: txClient,
    trackedLink: {
      findUnique: vi.fn(async () => baseRow()),
      findFirst: vi.fn(async () => baseRow()),
      findMany: vi.fn(async () => [baseRow()]),
      create: vi.fn(async () => baseRow()),
      update: vi.fn(async () => baseRow()),
      delete: vi.fn(async () => baseRow()),
    },
    linkClick: {
      create: vi.fn(async () => ({})),
      findMany: vi.fn(async () => [
        { country: "US", timestamp: new Date() },
        { country: "US", timestamp: new Date() },
        { country: "UK", timestamp: new Date() },
      ]),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    // $transaction: supports both array form and callback form
    $transaction: vi.fn(async (arg: unknown) => {
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

describe("PrismaTrackedLinkRepository", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: PrismaTrackedLinkRepository;

  beforeEach(() => {
    prisma = makeMockPrisma();
    repo = new PrismaTrackedLinkRepository(prisma as never);
  });

  // ── save ────────────────────────────────────────────────────────────────────

  describe("save — create path", () => {
    it("calls trackedLink.create when the link does not exist yet", async () => {
      // findUnique returns null → create path
      prisma.trackedLink.findUnique.mockImplementation(async () => null);

      const link = buildTestLink();
      const result = await repo.save(link);

      expect(result.ok).toBeTruthy();
      expect(prisma.trackedLink.create.mock.calls.length).toBe(1);
      expect(prisma.trackedLink.update.mock.calls.length).toBe(0);
    });

    it("persists the correct fields on create", async () => {
      prisma.trackedLink.findUnique.mockImplementation(async () => null);

      const link = buildTestLink();
      await repo.save(link);

      const callRecord = prisma.trackedLink.create.mock.calls[0];
      const args = callRecord?.[0] as { data: Record<string, unknown> } | undefined;
      expect(args?.data.id).toBe(link.id.value);
      expect(args?.data.projectId).toBe(PROJECT_ID);
      expect(args?.data.originalUrl).toBe("https://example.com/page1");
      expect(typeof args?.data.shortCode).toBe("string");
    });

    it("returns err when create throws", async () => {
      prisma.trackedLink.findUnique.mockImplementation(async () => null);
      prisma.trackedLink.create.mockImplementation(async () => {
        throw new Error("Unique constraint violation");
      });

      const link = buildTestLink();
      const result = await repo.save(link);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Unique constraint/);
    });
  });

  describe("save — update path", () => {
    it("calls trackedLink.update when the link already exists", async () => {
      // findUnique returns existing row → update path
      prisma.trackedLink.findUnique.mockImplementation(async () => baseRow());

      const link = buildTestLink();
      const result = await repo.save(link);

      expect(result.ok).toBeTruthy();
      expect(prisma.trackedLink.update.mock.calls.length).toBe(1);
      expect(prisma.trackedLink.create.mock.calls.length).toBe(0);
    });

    it("updates clicks and isActive on update", async () => {
      prisma.trackedLink.findUnique.mockImplementation(async () => baseRow());

      const link = buildTestLink();
      link.recordClick();
      link.recordClick();

      await repo.save(link);

      const callRecord = prisma.trackedLink.update.mock.calls[0];
      const args = callRecord?.[0] as { data: { clicks: number; isActive: boolean } } | undefined;
      expect(args?.data.clicks).toBe(2);
      expect(args?.data.isActive).toBe(true);
    });
  });

  // ── findById ────────────────────────────────────────────────────────────────

  describe("findById", () => {
    it("returns ok(TrackedLink) when link exists", async () => {
      const id = TrackedLinkId.fromStringUnsafe(LINK_ID);
      const result = await repo.findById(id);

      expect(result.ok).toBeTruthy();
      expect(result.value.originalUrl).toBe("https://example.com/page1");
      expect(result.value.isActive).toBe(true);
      expect(prisma.trackedLink.findUnique.mock.calls.length).toBe(1);
    });

    it("returns err(EntityNotFoundError) when link does not exist", async () => {
      prisma.trackedLink.findUnique.mockImplementation(async () => null);
      const id = TrackedLinkId.fromStringUnsafe(LINK_ID);
      const result = await repo.findById(id);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/TrackedLink/);
    });

    it("maps vanitySlug when present", async () => {
      prisma.trackedLink.findUnique.mockImplementation(async () => ({
        ...baseRow(),
        vanitySlug: "my-campaign",
      }));

      const id = TrackedLinkId.fromStringUnsafe(LINK_ID);
      const result = await repo.findById(id);

      expect(result.ok).toBeTruthy();
      expect(result.value.vanitySlug).toBe("my-campaign");
    });
  });

  // ── findByShortCode ─────────────────────────────────────────────────────────

  describe("findByShortCode", () => {
    it("returns ok(TrackedLink) when found by short code", async () => {
      const result = await repo.findByShortCode("abc123");

      expect(result.ok).toBeTruthy();
      expect(result.value.id.value).toBe(LINK_ID);
      expect(prisma.trackedLink.findFirst.mock.calls.length).toBe(1);
    });

    it("passes OR clause with both shortCode and vanitySlug", async () => {
      await repo.findByShortCode("some-slug");

      const callRecord = prisma.trackedLink.findFirst.mock.calls[0];
      const args = callRecord?.[0] as
        | { where: { OR: { shortCode?: string; vanitySlug?: string }[] } }
        | undefined;
      expect(Array.isArray(args?.where.OR)).toBeTruthy();
      expect(args?.where.OR.length).toBe(2);
      const hasShortCode = args?.where.OR.some((c) => "shortCode" in c);
      const hasVanitySlug = args?.where.OR.some((c) => "vanitySlug" in c);
      expect(hasShortCode).toBeTruthy();
      expect(hasVanitySlug).toBeTruthy();
    });

    it("returns err(EntityNotFoundError) when not found", async () => {
      prisma.trackedLink.findFirst.mockImplementation(async () => null);
      const result = await repo.findByShortCode("nonexistent");

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/TrackedLink/);
    });
  });

  // ── findByProjectId ─────────────────────────────────────────────────────────

  describe("findByProjectId", () => {
    it("returns all links for a project", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const links = await repo.findByProjectId(projectId);

      expect(links.length).toBe(1);
      expect(links[0]?.originalUrl).toBe("https://example.com/page1");
      expect(prisma.trackedLink.findMany.mock.calls.length).toBe(1);
    });

    it("filters by projectId in the where clause", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.findByProjectId(projectId);

      const callRecord = prisma.trackedLink.findMany.mock.calls[0];
      const args = callRecord?.[0] as
        | { where: { projectId: string; isActive?: boolean } }
        | undefined;
      expect(args?.where.projectId).toBe(PROJECT_ID);
    });

    it("adds isActive: true filter when activeOnly option is set", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.findByProjectId(projectId, { activeOnly: true });

      const callRecord = prisma.trackedLink.findMany.mock.calls[0];
      const args = callRecord?.[0] as
        | { where: { projectId: string; isActive?: boolean } }
        | undefined;
      expect(args?.where.isActive).toBe(true);
    });

    it("does not include isActive filter when activeOnly is not set", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.findByProjectId(projectId);

      const callRecord = prisma.trackedLink.findMany.mock.calls[0];
      const args = callRecord?.[0] as { where: Record<string, unknown> } | undefined;
      expect(Object.prototype.hasOwnProperty.call(args?.where, "isActive")).toBe(false);
    });

    it("returns empty array when project has no links", async () => {
      prisma.trackedLink.findMany.mockImplementation(async () => []);
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const links = await repo.findByProjectId(projectId);
      expect(links.length).toBe(0);
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("returns ok when link exists", async () => {
      const id = TrackedLinkId.fromStringUnsafe(LINK_ID);
      const result = await repo.delete(id);

      expect(result.ok).toBeTruthy();
      // Used $transaction to cascade-delete clicks first
      expect(prisma.$transaction.mock.calls.length).toBe(1);
    });

    it("returns err(EntityNotFoundError) when link does not exist", async () => {
      prisma.trackedLink.findUnique.mockImplementation(async () => null);
      const id = TrackedLinkId.fromStringUnsafe(LINK_ID);
      const result = await repo.delete(id);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/TrackedLink/);
      expect(prisma.$transaction.mock.calls.length).toBe(0);
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
      expect(clickResult.ok).toBeTruthy();

      const result = await repo.recordClick(linkId, clickResult.value);

      expect(result.ok).toBeTruthy();
      expect(prisma.$transaction.mock.calls.length).toBe(1);
    });

    it("returns err when $transaction throws", async () => {
      prisma.$transaction.mockImplementation(async () => {
        throw new Error("DB error during click");
      });

      const linkId = TrackedLinkId.fromStringUnsafe(LINK_ID);
      const clickResult = LinkClick.create({ trackedLinkId: linkId });
      expect(clickResult.ok).toBeTruthy();

      const result = await repo.recordClick(linkId, clickResult.value);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/DB error during click/);
    });
  });

  // ── getClickStats ────────────────────────────────────────────────────────────

  describe("getClickStats", () => {
    it("returns totalClicks and clicksByCountry breakdown", async () => {
      prisma.trackedLink.findUnique.mockImplementation(async () => ({
        ...baseRow(),
        clicks: 3,
      }));
      prisma.linkClick.findMany.mockImplementation(async () => [
        { country: "US", timestamp: new Date() },
        { country: "US", timestamp: new Date() },
        { country: "UK", timestamp: new Date() },
      ]);

      const linkId = TrackedLinkId.fromStringUnsafe(LINK_ID);
      const stats = await repo.getClickStats(linkId);

      expect(stats.totalClicks).toBe(3);
      expect(stats.clicksByCountry["US"]).toBe(2);
      expect(stats.clicksByCountry["UK"]).toBe(1);
    });

    it("returns zero counts when link has no clicks", async () => {
      prisma.trackedLink.findUnique.mockImplementation(async () => ({
        ...baseRow(),
        clicks: 0,
      }));
      prisma.linkClick.findMany.mockImplementation(async () => []);

      const linkId = TrackedLinkId.fromStringUnsafe(LINK_ID);
      const stats = await repo.getClickStats(linkId);

      expect(stats.totalClicks).toBe(0);
      expect(stats.clicksByCountry).toEqual({});
    });

    it("groups clicks with null country under Unknown", async () => {
      prisma.trackedLink.findUnique.mockImplementation(async () => ({
        ...baseRow(),
        clicks: 1,
      }));
      prisma.linkClick.findMany.mockImplementation(async () => [
        { country: null, timestamp: new Date() },
      ]);

      const linkId = TrackedLinkId.fromStringUnsafe(LINK_ID);
      const stats = await repo.getClickStats(linkId);

      expect(stats.totalClicks).toBe(1);
      expect(stats.clicksByCountry["Unknown"]).toBe(1);
    });
  });
});
