/**
 * Infrastructure Layer - Prisma Post Query Repository Unit Tests
 *
 * Part of P2-3: CQRS Read Side Implementation
 * Tests PrismaPostQueryRepository in isolation using a mocked PrismaClient.
 * Tier 0: No database required.
 *
 * @file PrismaPostQueryRepository.test.ts
 * @description Tests for PrismaPostQueryRepository
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { PrismaPostQueryRepository } from "../../../src/infrastructure/repositories/PrismaPostQueryRepository.js";
import { AccountId, PostId, ProjectId } from "@core/domain/index.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const POST_ID = "c0000000-0000-4000-8000-000000000001";
const PROJECT_ID = "b0000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "d0000000-0000-4000-8000-000000000001";
// Server-derived caller account threaded into the scoped read methods (CWE-639).
const accountId = AccountId.fromStringUnsafe(ACCOUNT_ID);

function baseRow() {
  return {
    id: POST_ID,
    projectId: PROJECT_ID,
    status: "DRAFT",
    scheduledAt: null as Date | null,
    publishedAt: null as Date | null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
    deletedAt: null as Date | null,
    contents: [
      {
        title: "Hello World",
        summary: null as string | null,
        body: "This is the post body",
        locale: "en",
        tags: ["tag1", "tag2"],
      },
    ],
    _count: { media: 3 },
  };
}

function rowWithSummary() {
  return {
    ...baseRow(),
    contents: [
      {
        title: "Hello World",
        summary: "A short summary",
        body: "This is the post body",
        locale: "en",
        tags: ["tag1", "tag2"],
      },
    ],
  };
}

function scheduledRow() {
  return {
    ...baseRow(),
    status: "SCHEDULED",
    scheduledAt: new Date("2026-06-01T10:00:00Z"),
  };
}

function publishedRow() {
  return {
    ...baseRow(),
    status: "PUBLISHED",
    publishedAt: new Date("2026-01-15T12:00:00Z"),
  };
}

function makeMockPrisma() {
  return {
    post: {
      findFirst: vi.fn(async () => baseRow()),
      findMany: vi.fn(async () => [baseRow()]),
      count: vi.fn(async () => 1),
    },
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PrismaPostQueryRepository", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: PrismaPostQueryRepository;

  beforeEach(() => {
    prisma = makeMockPrisma();
    repo = new PrismaPostQueryRepository(prisma as never);
  });

  // ── getById ──────────────────────────────────────────────────────────────────

  describe("getById", () => {
    it("returns ok(PostReadModel) for existing post", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id, accountId);

      expect(result.ok).toBeTruthy();
      expect(result.value.id).toBe(POST_ID);
      expect(result.value.projectId).toBe(PROJECT_ID);
      expect(result.value.status).toBe("DRAFT");
      expect(prisma.post.findFirst.mock.calls.length).toBe(1);
    });

    it("returns err(EntityNotFoundError) for missing post", async () => {
      prisma.post.findFirst.mockImplementation(async () => null);
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id, accountId);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Post/);
    });

    it("filters out soft-deleted posts (deletedAt not null)", async () => {
      // Soft-deleted posts should be excluded — findFirst with deletedAt: null returns null
      prisma.post.findFirst.mockImplementation(async () => null);
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id, accountId);

      expect(result.ok).toBeFalsy();

      // Verify the query includes the deletedAt: null filter
      const callArgs = prisma.post.findFirst.mock.calls[0]?.[0] as {
        where: { deletedAt: null };
      };
      expect(callArgs?.where?.deletedAt).toBe(null);
    });

    it("scopes the query to the caller account via project.accountId (CWE-639)", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      await repo.getById(id, accountId);

      const callArgs = prisma.post.findFirst.mock.calls[0]?.[0] as {
        where: { project?: { accountId?: string } };
      };
      expect(callArgs?.where?.project?.accountId).toBe(ACCOUNT_ID);
    });

    it("maps content fields correctly (title, body, locale, tags)", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id, accountId);

      expect(result.ok).toBeTruthy();
      expect(result.value.title).toBe("Hello World");
      expect(result.value.body).toBe("This is the post body");
      expect(result.value.locale).toBe("en");
      expect(result.value.tags).toEqual(["tag1", "tag2"]);
    });

    it("returns mediaCount from _count.media", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id, accountId);

      expect(result.ok).toBeTruthy();
      expect(result.value.mediaCount).toBe(3);
    });

    it("handles missing content gracefully (defaults)", async () => {
      prisma.post.findFirst.mockImplementation(async () => ({
        ...baseRow(),
        contents: [],
        _count: { media: 0 },
      }));
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id, accountId);

      expect(result.ok).toBeTruthy();
      expect(result.value.body).toBe("");
      expect(result.value.locale).toBe("en");
      expect(result.value.tags).toEqual([]);
      expect(result.value.mediaCount).toBe(0);
      // title should not be present when content is missing
      expect(Object.prototype.hasOwnProperty.call(result.value, "title")).toBe(false);
    });

    it("maps scheduledAt when present", async () => {
      prisma.post.findFirst.mockImplementation(async () => scheduledRow());
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id, accountId);

      expect(result.ok).toBeTruthy();
      expect(result.value.scheduledAt instanceof Date).toBeTruthy();
    });

    it("omits scheduledAt when null (exactOptionalPropertyTypes compliance)", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id, accountId);

      expect(result.ok).toBeTruthy();
      expect(Object.prototype.hasOwnProperty.call(result.value, "scheduledAt")).toBe(false);
    });

    it("maps publishedAt when present", async () => {
      prisma.post.findFirst.mockImplementation(async () => publishedRow());
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id, accountId);

      expect(result.ok).toBeTruthy();
      expect(result.value.publishedAt instanceof Date).toBeTruthy();
    });

    it("maps summary field when present", async () => {
      prisma.post.findFirst.mockImplementation(async () => rowWithSummary());
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id, accountId);

      expect(result.ok).toBeTruthy();
      expect(result.value.summary).toBe("A short summary");
    });

    it("omits summary when null (exactOptionalPropertyTypes compliance)", async () => {
      // baseRow has summary: null — property must be absent, not undefined
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id, accountId);

      expect(result.ok).toBeTruthy();
      expect(Object.prototype.hasOwnProperty.call(result.value, "summary")).toBe(false);
    });
  });

  // ── listByProject ─────────────────────────────────────────────────────────────

  describe("listByProject", () => {
    it("returns paginated results", async () => {
      prisma.post.count.mockImplementation(async () => 5);
      prisma.post.findMany.mockImplementation(async () => [baseRow(), baseRow()]);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const result = await repo.listByProject(projectId, accountId, { page: 1, limit: 2 });

      expect(result.items.length).toBe(2);
      expect(result.total).toBe(5);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(2);
      expect(result.totalPages).toBe(3);
      expect(result.hasNext).toBe(true);
      expect(result.hasPrevious).toBe(false);
    });

    it("uses default pagination when not provided", async () => {
      prisma.post.count.mockImplementation(async () => 1);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.listByProject(projectId, accountId);

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.[0] as {
        skip: number;
        take: number;
      };
      expect(findManyArgs?.skip).toBe(0); // (1 - 1) * 20
      expect(findManyArgs?.take).toBe(20); // DEFAULT_LIMIT
    });

    it("respects MAX_LIMIT cap (100)", async () => {
      prisma.post.count.mockImplementation(async () => 0);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.listByProject(projectId, accountId, { page: 1, limit: 9999 });

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.[0] as { take: number };
      expect(findManyArgs?.take).toBe(100);
    });

    it("applies sort parameters", async () => {
      prisma.post.count.mockImplementation(async () => 0);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.listByProject(
        projectId,
        accountId,
        { page: 1, limit: 10 },
        { field: "scheduledAt", direction: "asc" }
      );

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.[0] as {
        orderBy: unknown;
      };
      expect(findManyArgs?.orderBy).toEqual({ scheduledAt: "asc" });
    });

    it("calculates hasNext and hasPrevious correctly for middle page", async () => {
      prisma.post.count.mockImplementation(async () => 30);
      prisma.post.findMany.mockImplementation(async () => [baseRow()]);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const result = await repo.listByProject(projectId, accountId, { page: 2, limit: 10 });

      expect(result.hasNext).toBe(true);
      expect(result.hasPrevious).toBe(true);
      expect(result.totalPages).toBe(3);
    });

    it("calculates hasNext false on last page", async () => {
      prisma.post.count.mockImplementation(async () => 10);
      prisma.post.findMany.mockImplementation(async () => [baseRow()]);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const result = await repo.listByProject(projectId, accountId, { page: 1, limit: 10 });

      expect(result.hasNext).toBe(false);
      expect(result.hasPrevious).toBe(false);
      expect(result.totalPages).toBe(1);
    });

    it("returns items as PostReadModel array", async () => {
      prisma.post.count.mockImplementation(async () => 1);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const result = await repo.listByProject(projectId, accountId);

      expect(result.items.length).toBe(1);
      expect(result.items[0]?.id).toBe(POST_ID);
      expect(result.items[0]?.body).toBe("This is the post body");
    });

    it("scopes the query to the caller account via project.accountId (CWE-639)", async () => {
      prisma.post.count.mockImplementation(async () => 0);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.listByProject(projectId, accountId, { page: 1, limit: 10 });

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.[0] as {
        where: { projectId: string; project?: { accountId?: string } };
      };
      expect(findManyArgs?.where?.projectId).toBe(PROJECT_ID);
      expect(findManyArgs?.where?.project?.accountId).toBe(ACCOUNT_ID);
    });
  });

  // ── search ────────────────────────────────────────────────────────────────────

  describe("search", () => {
    it("searches in title and body (case-insensitive)", async () => {
      prisma.post.count.mockImplementation(async () => 1);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.search(projectId, "hello");

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.[0] as {
        where: {
          contents: {
            some: {
              OR: Array<{
                title?: { contains: string; mode: string };
                body?: { contains: string; mode: string };
              }>;
            };
          };
        };
      };

      const orConditions = findManyArgs?.where?.contents?.some?.OR;
      expect(Array.isArray(orConditions)).toBeTruthy();
      expect(orConditions.length).toBe(2);

      const titleCond = orConditions.find((c) => c.title);
      const bodyCond = orConditions.find((c) => c.body);
      expect(titleCond?.title?.contains).toBe("hello");
      expect(titleCond?.title?.mode).toBe("insensitive");
      expect(bodyCond?.body?.contains).toBe("hello");
      expect(bodyCond?.body?.mode).toBe("insensitive");
    });

    it("returns paginated results", async () => {
      prisma.post.count.mockImplementation(async () => 2);
      prisma.post.findMany.mockImplementation(async () => [baseRow(), baseRow()]);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const result = await repo.search(projectId, "world", { page: 1, limit: 10 });

      expect(result.items.length).toBe(2);
      expect(result.total).toBe(2);
    });

    it("returns empty result for no matches", async () => {
      prisma.post.count.mockImplementation(async () => 0);
      prisma.post.findMany.mockImplementation(async () => []);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const result = await repo.search(projectId, "nonexistent");

      expect(result.items.length).toBe(0);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
      expect(result.hasNext).toBe(false);
      expect(result.hasPrevious).toBe(false);
    });
  });

  // ── getUpcoming ───────────────────────────────────────────────────────────────

  describe("getUpcoming", () => {
    it("returns SCHEDULED posts with future scheduledAt", async () => {
      prisma.post.findMany.mockImplementation(async () => [scheduledRow()]);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const results = await repo.getUpcoming(projectId);

      expect(results.length).toBe(1);
      expect(results[0]?.status).toBe("SCHEDULED");
      expect(results[0]?.scheduledAt instanceof Date).toBeTruthy();
    });

    it("queries with status=SCHEDULED and scheduledAt >= now", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getUpcoming(projectId);

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.[0] as {
        where: {
          status: string;
          scheduledAt: { gte: Date };
        };
        orderBy: { scheduledAt: string };
      };

      expect(findManyArgs?.where?.status).toBe("SCHEDULED");
      expect(findManyArgs?.where?.scheduledAt?.gte instanceof Date).toBeTruthy();
    });

    it("orders by scheduledAt ascending", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getUpcoming(projectId);

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.[0] as {
        orderBy: { scheduledAt: string };
      };

      expect(findManyArgs?.orderBy).toEqual({ scheduledAt: "asc" });
    });

    it("respects the limit parameter", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getUpcoming(projectId, 5);

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.[0] as { take: number };
      expect(findManyArgs?.take).toBe(5);
    });

    it("caps limit at MAX_LIMIT (100)", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getUpcoming(projectId, 9999);

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.[0] as { take: number };
      expect(findManyArgs?.take).toBe(100);
    });
  });

  // ── getRecentlyPublished ──────────────────────────────────────────────────────

  describe("getRecentlyPublished", () => {
    it("returns PUBLISHED posts", async () => {
      prisma.post.findMany.mockImplementation(async () => [publishedRow()]);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const results = await repo.getRecentlyPublished(projectId);

      expect(results.length).toBe(1);
      expect(results[0]?.status).toBe("PUBLISHED");
      expect(results[0]?.publishedAt instanceof Date).toBeTruthy();
    });

    it("queries with status=PUBLISHED and publishedAt not null", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getRecentlyPublished(projectId);

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.[0] as {
        where: {
          status: string;
          publishedAt: { not: null };
        };
      };

      expect(findManyArgs?.where?.status).toBe("PUBLISHED");
      expect(findManyArgs?.where?.publishedAt?.not).toBe(null);
    });

    it("orders by publishedAt descending", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getRecentlyPublished(projectId);

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.[0] as {
        orderBy: { publishedAt: string };
      };

      expect(findManyArgs?.orderBy).toEqual({ publishedAt: "desc" });
    });

    it("respects the limit parameter", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getRecentlyPublished(projectId, 7);

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.[0] as { take: number };
      expect(findManyArgs?.take).toBe(7);
    });

    it("caps limit at MAX_LIMIT (100)", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getRecentlyPublished(projectId, 500);

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.[0] as { take: number };
      expect(findManyArgs?.take).toBe(100);
    });
  });

  // ── listGlobal — project liveness (feed gate) ────────────────────────────────

  describe("listGlobal — project liveness (feed gate)", () => {
    const DELETED_PROJECT_ID = "b0000000-0000-4000-8000-00000000dead";
    const FOREIGN_ACCOUNT_ID = "d0000000-0000-4000-8000-0000000000ff";

    /**
     * Rows as Postgres holds them: every post is LIVE (deletedAt: null); what
     * varies is the parent project's state. `project` carries the columns the
     * relation filter consults.
     */
    function feedRows() {
      return [
        {
          ...baseRow(),
          id: "c0000000-0000-4000-8000-0000000000a1",
          project: { accountId: ACCOUNT_ID, deletedAt: null as Date | null },
        },
        {
          ...baseRow(),
          id: "c0000000-0000-4000-8000-0000000000a2",
          projectId: DELETED_PROJECT_ID,
          project: { accountId: ACCOUNT_ID, deletedAt: new Date("2026-09-02") as Date | null },
        },
        {
          ...baseRow(),
          id: "c0000000-0000-4000-8000-0000000000a3",
          project: { accountId: FOREIGN_ACCOUNT_ID, deletedAt: null as Date | null },
        },
      ];
    }
    type FeedRow = ReturnType<typeof feedRows>[number];

    /**
     * Evaluates the where-shapes listGlobal builds with Postgres relation-filter
     * semantics. Mock-fidelity rule: it THROWS on any key it does not model, so
     * a new predicate can never silently pass through this evaluator — and it
     * applies ONLY the predicates actually present in the where, so the RED
     * state (no project.deletedAt predicate) honestly returns the deleted
     * project's post.
     */
    function applyWhere(rows: FeedRow[], where: Record<string, unknown>): FeedRow[] {
      return rows.filter((row) => {
        for (const [key, value] of Object.entries(where)) {
          if (key === "deletedAt") {
            if (row.deletedAt !== value) return false;
          } else if (key === "status") {
            if (row.status !== value) return false;
          } else if (key === "project") {
            const projectWhere = value as Record<string, unknown>;
            for (const [pKey, pValue] of Object.entries(projectWhere)) {
              if (pKey === "accountId") {
                if (row.project.accountId !== pValue) return false;
              } else if (pKey === "deletedAt") {
                if (row.project.deletedAt !== pValue) return false;
              } else {
                throw new Error(
                  `applyWhere does not model project.${pKey} — extend it deliberately`
                );
              }
            }
          } else {
            throw new Error(`applyWhere does not model where.${key} — extend it deliberately`);
          }
        }
        return true;
      });
    }

    function wireFilteringMock() {
      const rows = feedRows();
      prisma.post.findMany.mockImplementation(async (args?: unknown) =>
        applyWhere(rows, (args as { where: Record<string, unknown> }).where)
      );
      prisma.post.count.mockImplementation(
        async (args?: unknown) =>
          applyWhere(rows, (args as { where: Record<string, unknown> }).where).length
      );
    }

    it("evaluator fidelity: without a project.deletedAt predicate the deleted project's post IS returned", () => {
      // Pins that the evaluator itself does no hidden filtering — which is what
      // makes the gate test below honest: its failure mode is the missing
      // predicate, never a lenient mock.
      const visible = applyWhere(feedRows(), {
        deletedAt: null,
        project: { accountId: ACCOUNT_ID },
      });
      expect(visible.map((r) => r.projectId)).toContain(DELETED_PROJECT_ID);
      expect(visible.length).toBe(2);
    });

    it("excludes a soft-deleted project's posts from the account-wide feed", async () => {
      wireFilteringMock();

      const result = await repo.listGlobal(accountId);

      expect(result.items.length).toBe(1);
      expect(result.items[0]?.projectId).toBe(PROJECT_ID);
      expect(result.items.some((item) => item.projectId === DELETED_PROJECT_ID)).toBe(false);
    });

    it("keeps total/count consistent with the filtered page (same where on both queries)", async () => {
      wireFilteringMock();

      const result = await repo.listGlobal(accountId);

      expect(result.total).toBe(1);
      const findManyWhere = prisma.post.findMany.mock.calls[0]?.[0] as {
        where: Record<string, unknown>;
      };
      const countWhere = prisma.post.count.mock.calls[0]?.[0] as {
        where: Record<string, unknown>;
      };
      expect(countWhere.where).toEqual(findManyWhere.where);
    });

    it("still excludes foreign-account posts (tenant scope unchanged by the liveness predicate)", async () => {
      wireFilteringMock();

      const result = await repo.listGlobal(accountId);

      expect(result.items.every((item) => item.id !== "c0000000-0000-4000-8000-0000000000a3")).toBe(
        true
      );
    });
  });
});
