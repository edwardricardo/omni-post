/**
 * Infrastructure Layer - Prisma Post Query Repository Unit Tests
 *
 * Part of P2-3: CQRS Read Side Implementation
 * Tests PrismaPostQueryRepository in isolation using a mocked PrismaClient.
 * Tier 0: No database required.
 */

import { describe, it, beforeEach } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";

import { PrismaPostQueryRepository } from "../../../src/infrastructure/repositories/PrismaPostQueryRepository.js";
import { PostId, ProjectId } from "../../../src/domain/index.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const POST_ID = "c0000000-0000-4000-8000-000000000001";
const PROJECT_ID = "b0000000-0000-4000-8000-000000000001";

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

function makeMockPrisma(t: TestContext) {
  return {
    post: {
      findFirst: t.mock.fn(async () => baseRow()),
      findMany: t.mock.fn(async () => [baseRow()]),
      count: t.mock.fn(async () => 1),
    },
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PrismaPostQueryRepository", { concurrency: 1 }, () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: PrismaPostQueryRepository;

  beforeEach((t) => {
    prisma = makeMockPrisma(t);
    repo = new PrismaPostQueryRepository(prisma as never);
  });

  // ── getById ──────────────────────────────────────────────────────────────────

  describe("getById", { concurrency: 1 }, () => {
    it("returns ok(PostReadModel) for existing post", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id);

      assert.ok(result.ok);
      assert.equal(result.value.id, POST_ID);
      assert.equal(result.value.projectId, PROJECT_ID);
      assert.equal(result.value.status, "DRAFT");
      assert.equal(prisma.post.findFirst.mock.calls.length, 1);
    });

    it("returns err(EntityNotFoundError) for missing post", async () => {
      prisma.post.findFirst.mock.mockImplementation(async () => null);
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id);

      assert.ok(!result.ok);
      assert.match(result.error.message, /Post/);
    });

    it("filters out soft-deleted posts (deletedAt not null)", async () => {
      // Soft-deleted posts should be excluded — findFirst with deletedAt: null returns null
      prisma.post.findFirst.mock.mockImplementation(async () => null);
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id);

      assert.ok(!result.ok);

      // Verify the query includes the deletedAt: null filter
      const callArgs = prisma.post.findFirst.mock.calls[0]?.arguments[0] as {
        where: { deletedAt: null };
      };
      assert.equal(callArgs?.where?.deletedAt, null);
    });

    it("maps content fields correctly (title, body, locale, tags)", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id);

      assert.ok(result.ok);
      assert.equal(result.value.title, "Hello World");
      assert.equal(result.value.body, "This is the post body");
      assert.equal(result.value.locale, "en");
      assert.deepEqual(result.value.tags, ["tag1", "tag2"]);
    });

    it("returns mediaCount from _count.media", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id);

      assert.ok(result.ok);
      assert.equal(result.value.mediaCount, 3);
    });

    it("handles missing content gracefully (defaults)", async () => {
      prisma.post.findFirst.mock.mockImplementation(async () => ({
        ...baseRow(),
        contents: [],
        _count: { media: 0 },
      }));
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id);

      assert.ok(result.ok);
      assert.equal(result.value.body, "");
      assert.equal(result.value.locale, "en");
      assert.deepEqual(result.value.tags, []);
      assert.equal(result.value.mediaCount, 0);
      // title should not be present when content is missing
      assert.equal(Object.prototype.hasOwnProperty.call(result.value, "title"), false);
    });

    it("maps scheduledAt when present", async () => {
      prisma.post.findFirst.mock.mockImplementation(async () => scheduledRow());
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id);

      assert.ok(result.ok);
      assert.ok(result.value.scheduledAt instanceof Date);
    });

    it("omits scheduledAt when null (exactOptionalPropertyTypes compliance)", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id);

      assert.ok(result.ok);
      assert.equal(Object.prototype.hasOwnProperty.call(result.value, "scheduledAt"), false);
    });

    it("maps publishedAt when present", async () => {
      prisma.post.findFirst.mock.mockImplementation(async () => publishedRow());
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id);

      assert.ok(result.ok);
      assert.ok(result.value.publishedAt instanceof Date);
    });

    it("maps summary field when present", async () => {
      prisma.post.findFirst.mock.mockImplementation(async () => rowWithSummary());
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id);

      assert.ok(result.ok);
      assert.equal(result.value.summary, "A short summary");
    });

    it("omits summary when null (exactOptionalPropertyTypes compliance)", async () => {
      // baseRow has summary: null — property must be absent, not undefined
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.getById(id);

      assert.ok(result.ok);
      assert.equal(Object.prototype.hasOwnProperty.call(result.value, "summary"), false);
    });
  });

  // ── listByProject ─────────────────────────────────────────────────────────────

  describe("listByProject", { concurrency: 1 }, () => {
    it("returns paginated results", async () => {
      prisma.post.count.mock.mockImplementation(async () => 5);
      prisma.post.findMany.mock.mockImplementation(async () => [baseRow(), baseRow()]);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const result = await repo.listByProject(projectId, { page: 1, limit: 2 });

      assert.equal(result.items.length, 2);
      assert.equal(result.total, 5);
      assert.equal(result.page, 1);
      assert.equal(result.limit, 2);
      assert.equal(result.totalPages, 3);
      assert.equal(result.hasNext, true);
      assert.equal(result.hasPrevious, false);
    });

    it("uses default pagination when not provided", async () => {
      prisma.post.count.mock.mockImplementation(async () => 1);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.listByProject(projectId);

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.arguments[0] as {
        skip: number;
        take: number;
      };
      assert.equal(findManyArgs?.skip, 0); // (1 - 1) * 20
      assert.equal(findManyArgs?.take, 20); // DEFAULT_LIMIT
    });

    it("respects MAX_LIMIT cap (100)", async () => {
      prisma.post.count.mock.mockImplementation(async () => 0);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.listByProject(projectId, { page: 1, limit: 9999 });

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.arguments[0] as { take: number };
      assert.equal(findManyArgs?.take, 100);
    });

    it("applies sort parameters", async () => {
      prisma.post.count.mock.mockImplementation(async () => 0);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.listByProject(
        projectId,
        { page: 1, limit: 10 },
        { field: "scheduledAt", direction: "asc" }
      );

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.arguments[0] as {
        orderBy: unknown;
      };
      assert.deepEqual(findManyArgs?.orderBy, { scheduledAt: "asc" });
    });

    it("calculates hasNext and hasPrevious correctly for middle page", async () => {
      prisma.post.count.mock.mockImplementation(async () => 30);
      prisma.post.findMany.mock.mockImplementation(async () => [baseRow()]);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const result = await repo.listByProject(projectId, { page: 2, limit: 10 });

      assert.equal(result.hasNext, true);
      assert.equal(result.hasPrevious, true);
      assert.equal(result.totalPages, 3);
    });

    it("calculates hasNext false on last page", async () => {
      prisma.post.count.mock.mockImplementation(async () => 10);
      prisma.post.findMany.mock.mockImplementation(async () => [baseRow()]);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const result = await repo.listByProject(projectId, { page: 1, limit: 10 });

      assert.equal(result.hasNext, false);
      assert.equal(result.hasPrevious, false);
      assert.equal(result.totalPages, 1);
    });

    it("returns items as PostReadModel array", async () => {
      prisma.post.count.mock.mockImplementation(async () => 1);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const result = await repo.listByProject(projectId);

      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]?.id, POST_ID);
      assert.equal(result.items[0]?.body, "This is the post body");
    });
  });

  // ── search ────────────────────────────────────────────────────────────────────

  describe("search", { concurrency: 1 }, () => {
    it("searches in title and body (case-insensitive)", async () => {
      prisma.post.count.mock.mockImplementation(async () => 1);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.search(projectId, "hello");

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.arguments[0] as {
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
      assert.ok(Array.isArray(orConditions));
      assert.equal(orConditions.length, 2);

      const titleCond = orConditions.find((c) => c.title);
      const bodyCond = orConditions.find((c) => c.body);
      assert.equal(titleCond?.title?.contains, "hello");
      assert.equal(titleCond?.title?.mode, "insensitive");
      assert.equal(bodyCond?.body?.contains, "hello");
      assert.equal(bodyCond?.body?.mode, "insensitive");
    });

    it("returns paginated results", async () => {
      prisma.post.count.mock.mockImplementation(async () => 2);
      prisma.post.findMany.mock.mockImplementation(async () => [baseRow(), baseRow()]);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const result = await repo.search(projectId, "world", { page: 1, limit: 10 });

      assert.equal(result.items.length, 2);
      assert.equal(result.total, 2);
    });

    it("returns empty result for no matches", async () => {
      prisma.post.count.mock.mockImplementation(async () => 0);
      prisma.post.findMany.mock.mockImplementation(async () => []);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const result = await repo.search(projectId, "nonexistent");

      assert.equal(result.items.length, 0);
      assert.equal(result.total, 0);
      assert.equal(result.totalPages, 0);
      assert.equal(result.hasNext, false);
      assert.equal(result.hasPrevious, false);
    });
  });

  // ── getUpcoming ───────────────────────────────────────────────────────────────

  describe("getUpcoming", { concurrency: 1 }, () => {
    it("returns SCHEDULED posts with future scheduledAt", async () => {
      prisma.post.findMany.mock.mockImplementation(async () => [scheduledRow()]);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const results = await repo.getUpcoming(projectId);

      assert.equal(results.length, 1);
      assert.equal(results[0]?.status, "SCHEDULED");
      assert.ok(results[0]?.scheduledAt instanceof Date);
    });

    it("queries with status=SCHEDULED and scheduledAt >= now", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getUpcoming(projectId);

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.arguments[0] as {
        where: {
          status: string;
          scheduledAt: { gte: Date };
        };
        orderBy: { scheduledAt: string };
      };

      assert.equal(findManyArgs?.where?.status, "SCHEDULED");
      assert.ok(findManyArgs?.where?.scheduledAt?.gte instanceof Date);
    });

    it("orders by scheduledAt ascending", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getUpcoming(projectId);

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.arguments[0] as {
        orderBy: { scheduledAt: string };
      };

      assert.deepEqual(findManyArgs?.orderBy, { scheduledAt: "asc" });
    });

    it("respects the limit parameter", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getUpcoming(projectId, 5);

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.arguments[0] as { take: number };
      assert.equal(findManyArgs?.take, 5);
    });

    it("caps limit at MAX_LIMIT (100)", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getUpcoming(projectId, 9999);

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.arguments[0] as { take: number };
      assert.equal(findManyArgs?.take, 100);
    });
  });

  // ── getRecentlyPublished ──────────────────────────────────────────────────────

  describe("getRecentlyPublished", { concurrency: 1 }, () => {
    it("returns PUBLISHED posts", async () => {
      prisma.post.findMany.mock.mockImplementation(async () => [publishedRow()]);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const results = await repo.getRecentlyPublished(projectId);

      assert.equal(results.length, 1);
      assert.equal(results[0]?.status, "PUBLISHED");
      assert.ok(results[0]?.publishedAt instanceof Date);
    });

    it("queries with status=PUBLISHED and publishedAt not null", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getRecentlyPublished(projectId);

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.arguments[0] as {
        where: {
          status: string;
          publishedAt: { not: null };
        };
      };

      assert.equal(findManyArgs?.where?.status, "PUBLISHED");
      assert.equal(findManyArgs?.where?.publishedAt?.not, null);
    });

    it("orders by publishedAt descending", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getRecentlyPublished(projectId);

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.arguments[0] as {
        orderBy: { publishedAt: string };
      };

      assert.deepEqual(findManyArgs?.orderBy, { publishedAt: "desc" });
    });

    it("respects the limit parameter", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getRecentlyPublished(projectId, 7);

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.arguments[0] as { take: number };
      assert.equal(findManyArgs?.take, 7);
    });

    it("caps limit at MAX_LIMIT (100)", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getRecentlyPublished(projectId, 500);

      const findManyArgs = prisma.post.findMany.mock.calls[0]?.arguments[0] as { take: number };
      assert.equal(findManyArgs?.take, 100);
    });
  });
});
