/**
 * Infrastructure Layer - Prisma Post Repository Unit Tests
 *
 * Part of FASE H12: Hexagonal Architecture - Soft Delete + Post Adapter
 * Tests PrismaPostRepository in isolation using a mocked PrismaClient.
 * Tier 0: No database required.
 */

import { describe, it, beforeEach, before, after } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";

import { PrismaPostRepository } from "../../../src/infrastructure/repositories/PrismaPostRepository.js";
import { PostId, ProjectId, PUBLISH_STATUS } from "../../../src/domain/index.js";

// ── console suppression ───────────────────────────────────────────────────────

let _originalConsoleLog: typeof console.log;
before(() => {
  _originalConsoleLog = console.log;
  console.log = () => {};
});
after(() => {
  console.log = _originalConsoleLog;
});

// ── helpers ───────────────────────────────────────────────────────────────────

const POST_ID = "c0000000-0000-4000-8000-000000000001";
const PROJECT_ID = "b0000000-0000-4000-8000-000000000001";
const POST_ID_2 = "c0000000-0000-4000-8000-000000000002";

function basePostRow() {
  return {
    id: POST_ID,
    projectId: PROJECT_ID,
    status: "DRAFT",
    scheduledAt: null as Date | null,
    publishedAt: null as Date | null,
    deletedAt: null as Date | null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    contents: [
      {
        id: "d0000000-0000-4000-8000-000000000001",
        postId: POST_ID,
        locale: "en",
        title: "Test Post Title",
        summary: null as string | null,
        body: "Hello world content",
        tags: ["tag1", "tag2"],
        revision: 1,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ],
    media: [] as {
      id: string;
      postId: string;
      type: "image" | "video" | "gif";
      url: string;
      width: number | null;
      height: number | null;
      durationMs: number | null;
      alt: string | null;
      hash: string | null;
    }[],
    contentVersions: [] as { id: string; version: number }[],
  };
}

function makeTransactionMockClient(t: TestContext) {
  return {
    post: {
      create: t.mock.fn(async () => ({})),
      update: t.mock.fn(async () => ({})),
      delete: t.mock.fn(async () => ({})),
    },
    postContent: {
      create: t.mock.fn(async () => ({})),
      upsert: t.mock.fn(async () => ({})),
      deleteMany: t.mock.fn(async () => ({ count: 0 })),
    },
    postMedia: {
      findMany: t.mock.fn(async () => [] as { id: string }[]),
      createMany: t.mock.fn(async () => ({ count: 0 })),
      deleteMany: t.mock.fn(async () => ({ count: 0 })),
      upsert: t.mock.fn(async () => ({})),
    },
    publishLog: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    analytics: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    contentVersion: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    tweet: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    thread: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
  };
}

function makeMockPrisma(t: TestContext) {
  const txClient = makeTransactionMockClient(t);

  return {
    _txClient: txClient,
    post: {
      findFirst: t.mock.fn(async () => basePostRow()),
      findMany: t.mock.fn(async () => [basePostRow()]),
      create: t.mock.fn(async () => basePostRow()),
      update: t.mock.fn(async () => basePostRow()),
      delete: t.mock.fn(async () => basePostRow()),
      count: t.mock.fn(async () => 1),
      updateMany: t.mock.fn(async () => ({ count: 1 })),
    },
    postContent: {
      create: t.mock.fn(async () => ({})),
      upsert: t.mock.fn(async () => ({})),
    },
    postMedia: {
      findMany: t.mock.fn(async () => [] as { id: string }[]),
      createMany: t.mock.fn(async () => ({ count: 0 })),
      deleteMany: t.mock.fn(async () => ({ count: 0 })),
    },
    publishLog: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    analytics: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    contentVersion: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    tweet: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    thread: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    // $transaction executes the callback immediately with the txClient
    $transaction: t.mock.fn(async (cb: (tx: typeof txClient) => Promise<unknown>) => cb(txClient)),
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PrismaPostRepository", { concurrency: 1 }, () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: PrismaPostRepository;

  beforeEach((t) => {
    prisma = makeMockPrisma(t);
    repo = new PrismaPostRepository(prisma as never);
  });

  // ── findById ────────────────────────────────────────────────────────────────

  describe("findById", { concurrency: 1 }, () => {
    it("returns ok(PostAggregate) when row exists", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.findById(id);

      assert.ok(result.ok);
      assert.equal(result.value.id.value, POST_ID);
      assert.equal(result.value.projectId.value, PROJECT_ID);
      assert.equal(result.value.content.body, "Hello world content");
      assert.equal(result.value.status.value, "DRAFT");
      assert.equal(prisma.post.findFirst.mock.calls.length, 1);
    });

    it("queries with deletedAt: null to exclude soft-deleted posts", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      await repo.findById(id);

      const callRecord = prisma.post.findFirst.mock.calls[0];
      const args = callRecord?.arguments[0] as { where: { deletedAt: unknown } } | undefined;
      assert.deepEqual(args?.where.deletedAt, null);
    });

    it("returns err(EntityNotFoundError) when row is null", async () => {
      prisma.post.findFirst.mock.mockImplementation(async () => null);
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.findById(id);

      assert.ok(!result.ok);
      assert.match(result.error.message, /Post/);
    });

    it("maps media attachments when present", async () => {
      const rowWithMedia = {
        ...basePostRow(),
        media: [
          {
            id: "e0000000-0000-4000-8000-000000000001",
            postId: POST_ID,
            type: "image" as const,
            url: "https://example.com/image.jpg",
            width: 1080,
            height: 1080,
            durationMs: null,
            alt: "An image",
            hash: null,
          },
        ],
      };
      prisma.post.findFirst.mock.mockImplementation(async () => rowWithMedia);

      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.findById(id);

      assert.ok(result.ok);
      assert.equal(result.value.media.length, 1);
      assert.equal(result.value.media[0]?.type, "image");
      assert.equal(result.value.media[0]?.url, "https://example.com/image.jpg");
    });

    it("maps scheduled post with scheduledAt", async () => {
      const futureDate = new Date(Date.now() + 3600_000);
      const scheduledRow = {
        ...basePostRow(),
        status: "SCHEDULED",
        scheduledAt: futureDate,
      };
      prisma.post.findFirst.mock.mockImplementation(async () => scheduledRow);

      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.findById(id);

      assert.ok(result.ok);
      assert.equal(result.value.status.value, "SCHEDULED");
      assert.ok(result.value.scheduledAt !== undefined);
    });
  });

  // ── exists ──────────────────────────────────────────────────────────────────

  describe("exists", { concurrency: 1 }, () => {
    it("returns true when count > 0", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.exists(id);
      assert.equal(result, true);
    });

    it("returns false when count is 0", async () => {
      prisma.post.count.mock.mockImplementation(async () => 0);
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.exists(id);
      assert.equal(result, false);
    });

    it("counts only non-deleted posts (deletedAt: null)", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      await repo.exists(id);

      const callRecord = prisma.post.count.mock.calls[0];
      const args = callRecord?.arguments[0] as { where: { deletedAt: unknown } } | undefined;
      assert.deepEqual(args?.where.deletedAt, null);
    });
  });

  // ── delete (soft) ───────────────────────────────────────────────────────────

  describe("delete (soft delete)", { concurrency: 1 }, () => {
    it("calls post.update with deletedAt and returns ok when post exists", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.delete(id);

      assert.ok(result.ok);
      // Soft delete: update, NOT hard delete
      assert.equal(prisma.post.update.mock.calls.length, 1);
      assert.equal(prisma.post.delete.mock.calls.length, 0);

      const callRecord = prisma.post.update.mock.calls[0];
      const args = callRecord?.arguments[0] as { data: { deletedAt: unknown } } | undefined;
      assert.ok(args?.data.deletedAt instanceof Date);
    });

    it("returns err(EntityNotFoundError) when post does not exist", async () => {
      prisma.post.count.mock.mockImplementation(async () => 0);
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.delete(id);

      assert.ok(!result.ok);
      assert.match(result.error.message, /Post/);
      assert.equal(prisma.post.update.mock.calls.length, 0);
    });
  });

  // ── hardDelete ──────────────────────────────────────────────────────────────

  describe("hardDelete", { concurrency: 1 }, () => {
    it("returns ok and executes cascade deletions in correct FK order", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.hardDelete(id);

      assert.ok(result.ok);
      // Transaction was called
      assert.equal(prisma.$transaction.mock.calls.length, 1);

      const tx = prisma._txClient;
      // Verify all cascade deletes were called
      assert.equal(tx.publishLog.deleteMany.mock.calls.length, 1);
      assert.equal(tx.analytics.deleteMany.mock.calls.length, 1);
      assert.equal(tx.contentVersion.deleteMany.mock.calls.length, 1);
      assert.equal(tx.postMedia.deleteMany.mock.calls.length, 1);
      assert.equal(tx.tweet.deleteMany.mock.calls.length, 1);
      assert.equal(tx.thread.deleteMany.mock.calls.length, 1);
      assert.equal(tx.postContent.deleteMany.mock.calls.length, 1);
      assert.equal(tx.post.delete.mock.calls.length, 1);
    });

    it("can delete even soft-deleted posts (findFirst has no deletedAt filter)", async () => {
      // findFirst returns a soft-deleted post (has deletedAt set)
      const softDeletedRow = { ...basePostRow(), deletedAt: new Date("2026-01-15") };
      prisma.post.findFirst.mock.mockImplementation(async () => softDeletedRow);

      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.hardDelete(id);

      assert.ok(result.ok);
      assert.equal(prisma.$transaction.mock.calls.length, 1);
    });

    it("returns err(EntityNotFoundError) when post does not exist at all", async () => {
      prisma.post.findFirst.mock.mockImplementation(async () => null);
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.hardDelete(id);

      assert.ok(!result.ok);
      assert.match(result.error.message, /Post/);
      assert.equal(prisma.$transaction.mock.calls.length, 0);
    });
  });

  // ── save (create path) ──────────────────────────────────────────────────────

  describe("save — new aggregate (create path)", { concurrency: 1 }, () => {
    it("calls $transaction and creates post + content when post does not exist", async () => {
      // exists() returns false → create path
      prisma.post.count.mock.mockImplementation(async () => 0);

      const postResult = await import("../../../src/domain/index.js").then((m) =>
        m.PostAggregate.create({
          projectId: ProjectId.fromStringUnsafe(PROJECT_ID),
          body: "New post content",
        })
      );
      assert.ok(postResult.ok);

      const saveResult = await repo.save(postResult.value);

      assert.ok(saveResult.ok);
      assert.equal(prisma.$transaction.mock.calls.length, 1);

      const tx = prisma._txClient;
      assert.equal(tx.post.create.mock.calls.length, 1);
      assert.equal(tx.postContent.create.mock.calls.length, 1);
    });

    it("returns err when $transaction throws during create", async () => {
      prisma.post.count.mock.mockImplementation(async () => 0);
      prisma.$transaction.mock.mockImplementation(async () => {
        throw new Error("DB write failed");
      });

      const postResult = await import("../../../src/domain/index.js").then((m) =>
        m.PostAggregate.create({
          projectId: ProjectId.fromStringUnsafe(PROJECT_ID),
          body: "Content",
        })
      );
      assert.ok(postResult.ok);

      const saveResult = await repo.save(postResult.value);

      assert.ok(!saveResult.ok);
      assert.match(saveResult.error.message, /DB write failed/);
    });
  });

  // ── save (update path) ──────────────────────────────────────────────────────

  describe("save — existing aggregate (update path)", { concurrency: 1 }, () => {
    it("calls $transaction and upserts content when post exists", async () => {
      // exists() returns true → update path
      prisma.post.count.mock.mockImplementation(async () => 1);

      const findResult = await repo.findById(PostId.fromStringUnsafe(POST_ID));
      assert.ok(findResult.ok);

      const saveResult = await repo.save(findResult.value);

      assert.ok(saveResult.ok);
      assert.equal(prisma.$transaction.mock.calls.length, 1);

      const tx = prisma._txClient;
      assert.equal(tx.post.update.mock.calls.length, 1);
      assert.equal(tx.postContent.upsert.mock.calls.length, 1);
    });

    it("returns err when $transaction throws during update", async () => {
      prisma.post.count.mock.mockImplementation(async () => 1);
      prisma.$transaction.mock.mockImplementation(async () => {
        throw new Error("Constraint violation");
      });

      const findResult = await repo.findById(PostId.fromStringUnsafe(POST_ID));
      assert.ok(findResult.ok);

      const saveResult = await repo.save(findResult.value);

      assert.ok(!saveResult.ok);
      assert.match(saveResult.error.message, /Constraint violation/);
    });
  });

  // ── findByProjectId ─────────────────────────────────────────────────────────

  describe("findByProjectId", { concurrency: 1 }, () => {
    it("returns paginated result with correct structure", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const result = await repo.findByProjectId(projectId);

      assert.equal(result.items.length, 1);
      assert.equal(result.total, 1);
      assert.equal(result.page, 1);
      assert.equal(result.limit, 20);
      assert.equal(result.totalPages, 1);
      assert.equal(result.hasNext, false);
      assert.equal(result.hasPrevious, false);
    });

    it("applies custom pagination correctly", async () => {
      // Return multiple rows so pagination kicks in
      prisma.post.findMany.mock.mockImplementation(async () => [
        basePostRow(),
        { ...basePostRow(), id: POST_ID_2 },
      ]);
      prisma.post.count.mock.mockImplementation(async () => 10);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const result = await repo.findByProjectId(projectId, { page: 2, limit: 2 });

      assert.equal(result.page, 2);
      assert.equal(result.limit, 2);
      assert.equal(result.total, 10);
      assert.equal(result.totalPages, 5);
      assert.equal(result.hasNext, true);
      assert.equal(result.hasPrevious, true);

      // Verify skip was calculated correctly (page 2, limit 2 → skip 2)
      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.arguments[0] as { skip: number; take: number } | undefined;
      assert.equal(args?.skip, 2);
      assert.equal(args?.take, 2);
    });

    it("filters by projectId and deletedAt: null", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.findByProjectId(projectId);

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.arguments[0] as { where: Record<string, unknown> } | undefined;
      assert.equal(args?.where.projectId, PROJECT_ID);
      assert.deepEqual(args?.where.deletedAt, null);
    });

    it("applies sort parameter correctly", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.findByProjectId(projectId, undefined, { field: "scheduledAt", direction: "asc" });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.arguments[0] as { orderBy: Record<string, unknown> } | undefined;
      assert.deepEqual(args?.orderBy, { scheduledAt: "asc" });
    });
  });

  // ── findByStatus ────────────────────────────────────────────────────────────

  describe("findByStatus", { concurrency: 1 }, () => {
    it("returns paginated posts for a single status", async () => {
      const scheduledRow = { ...basePostRow(), status: "SCHEDULED" };
      prisma.post.findMany.mock.mockImplementation(async () => [scheduledRow]);
      prisma.post.count.mock.mockImplementation(async () => 1);

      const result = await repo.findByStatus(PUBLISH_STATUS.SCHEDULED);

      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]?.status.value, "SCHEDULED");
    });

    it("accepts an array of statuses", async () => {
      await repo.findByStatus([PUBLISH_STATUS.DRAFT, PUBLISH_STATUS.SCHEDULED]);

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.arguments[0] as { where: { status: { in: string[] } } } | undefined;
      assert.deepEqual(args?.where.status.in, ["DRAFT", "SCHEDULED"]);
    });

    it("always includes deletedAt: null filter", async () => {
      await repo.findByStatus(PUBLISH_STATUS.DRAFT);

      const callRecord = prisma.post.count.mock.calls[0];
      const args = callRecord?.arguments[0] as { where: { deletedAt: unknown } } | undefined;
      assert.deepEqual(args?.where.deletedAt, null);
    });
  });

  // ── findReadyForPublishing ──────────────────────────────────────────────────

  describe("findReadyForPublishing", { concurrency: 1 }, () => {
    it("returns posts with SCHEDULED status and past scheduledAt", async () => {
      const pastDate = new Date(Date.now() - 3600_000);
      const scheduledRow = {
        ...basePostRow(),
        status: "SCHEDULED",
        scheduledAt: pastDate,
      };
      prisma.post.findMany.mock.mockImplementation(async () => [scheduledRow]);

      const posts = await repo.findReadyForPublishing();

      assert.equal(posts.length, 1);
      assert.equal(posts[0]?.status.value, "SCHEDULED");
    });

    it("passes limit to Prisma take", async () => {
      prisma.post.findMany.mock.mockImplementation(async () => []);

      await repo.findReadyForPublishing(50);

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.arguments[0] as { take: number } | undefined;
      assert.equal(args?.take, 50);
    });

    it("uses default limit of 100 when not specified", async () => {
      prisma.post.findMany.mock.mockImplementation(async () => []);

      await repo.findReadyForPublishing();

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.arguments[0] as { take: number } | undefined;
      assert.equal(args?.take, 100);
    });

    it("filters by SCHEDULED status and lte scheduledAt", async () => {
      prisma.post.findMany.mock.mockImplementation(async () => []);

      await repo.findReadyForPublishing();

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.arguments[0] as
        | {
            where: { status: string; scheduledAt: { lte: Date }; deletedAt: unknown };
          }
        | undefined;
      assert.equal(args?.where.status, "SCHEDULED");
      assert.ok(args?.where.scheduledAt.lte instanceof Date);
      assert.deepEqual(args?.where.deletedAt, null);
    });
  });

  // ── findWithFilters ─────────────────────────────────────────────────────────

  describe("findWithFilters", { concurrency: 1 }, () => {
    it("returns paginated result with no filters (base deletedAt: null)", async () => {
      const result = await repo.findWithFilters({});

      assert.equal(result.items.length, 1);
      assert.equal(result.total, 1);
    });

    it("applies projectId filter", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.findWithFilters({ projectId });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.arguments[0] as { where: { projectId: string } } | undefined;
      assert.equal(args?.where.projectId, PROJECT_ID);
    });

    it("applies status filter (array)", async () => {
      await repo.findWithFilters({ status: [PUBLISH_STATUS.DRAFT, PUBLISH_STATUS.PUBLISHED] });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.arguments[0] as { where: { status: { in: string[] } } } | undefined;
      assert.deepEqual(args?.where.status.in, ["DRAFT", "PUBLISHED"]);
    });

    it("applies date range filters for scheduledBefore and scheduledAfter", async () => {
      const before = new Date("2026-02-01");
      const after = new Date("2026-01-01");
      await repo.findWithFilters({ scheduledBefore: before, scheduledAfter: after });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.arguments[0] as
        | {
            where: { scheduledAt: { lte: Date; gte: Date } };
          }
        | undefined;
      assert.deepEqual(args?.where.scheduledAt.lte, before);
      assert.deepEqual(args?.where.scheduledAt.gte, after);
    });

    it("applies date range filters for createdBefore and createdAfter", async () => {
      const before = new Date("2026-02-01");
      const after = new Date("2026-01-01");
      await repo.findWithFilters({ createdBefore: before, createdAfter: after });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.arguments[0] as
        | {
            where: { createdAt: { lte: Date; gte: Date } };
          }
        | undefined;
      assert.deepEqual(args?.where.createdAt.lte, before);
      assert.deepEqual(args?.where.createdAt.gte, after);
    });

    it("applies hasMedia: true filter using some: {}", async () => {
      await repo.findWithFilters({ hasMedia: true });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.arguments[0] as { where: { media: unknown } } | undefined;
      assert.deepEqual(args?.where.media, { some: {} });
    });

    it("applies hasMedia: false filter using none: {}", async () => {
      await repo.findWithFilters({ hasMedia: false });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.arguments[0] as { where: { media: unknown } } | undefined;
      assert.deepEqual(args?.where.media, { none: {} });
    });

    it("applies searchText filter on contents body and title", async () => {
      await repo.findWithFilters({ searchText: "hello" });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.arguments[0] as { where: { OR: unknown[] } } | undefined;
      assert.ok(Array.isArray(args?.where.OR));
      assert.equal(args?.where.OR.length, 2);
    });
  });

  // ── countByProjectId ────────────────────────────────────────────────────────

  describe("countByProjectId", { concurrency: 1 }, () => {
    it("returns count of non-deleted posts for a project", async () => {
      prisma.post.count.mock.mockImplementation(async () => 7);
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const count = await repo.countByProjectId(projectId);

      assert.equal(count, 7);
      const callRecord = prisma.post.count.mock.calls[0];
      const args = callRecord?.arguments[0] as
        | {
            where: { projectId: string; deletedAt: unknown };
          }
        | undefined;
      assert.equal(args?.where.projectId, PROJECT_ID);
      assert.deepEqual(args?.where.deletedAt, null);
    });

    it("returns 0 when project has no posts", async () => {
      prisma.post.count.mock.mockImplementation(async () => 0);
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const count = await repo.countByProjectId(projectId);
      assert.equal(count, 0);
    });
  });

  // ── countByStatus ───────────────────────────────────────────────────────────

  describe("countByStatus", { concurrency: 1 }, () => {
    it("counts posts for a specific project and status", async () => {
      prisma.post.count.mock.mockImplementation(async () => 3);
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const count = await repo.countByStatus(projectId, PUBLISH_STATUS.DRAFT);

      assert.equal(count, 3);
      const callRecord = prisma.post.count.mock.calls[0];
      const args = callRecord?.arguments[0] as
        | {
            where: { projectId: string; status: string; deletedAt: unknown };
          }
        | undefined;
      assert.equal(args?.where.projectId, PROJECT_ID);
      assert.equal(args?.where.status, "DRAFT");
      assert.deepEqual(args?.where.deletedAt, null);
    });

    it("returns 0 when no posts match status", async () => {
      prisma.post.count.mock.mockImplementation(async () => 0);
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const count = await repo.countByStatus(projectId, PUBLISH_STATUS.PUBLISHED);
      assert.equal(count, 0);
    });
  });

  // ── getProjectStats ─────────────────────────────────────────────────────────

  describe("getProjectStats", { concurrency: 1 }, () => {
    it("returns correct stats object with all fields", async () => {
      // Simulate 5 sequential count calls: total, drafts, scheduled, published, failed
      let callCount = 0;
      const counts = [10, 5, 2, 2, 1];
      prisma.post.count.mock.mockImplementation(async () => counts[callCount++] ?? 0);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const stats = await repo.getProjectStats(projectId);

      assert.equal(stats.total, 10);
      assert.equal(stats.drafts, 5);
      assert.equal(stats.scheduled, 2);
      assert.equal(stats.published, 2);
      assert.equal(stats.failed, 1);
    });

    it("makes 5 count queries (total + 4 statuses)", async () => {
      prisma.post.count.mock.mockImplementation(async () => 0);
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getProjectStats(projectId);

      assert.equal(prisma.post.count.mock.calls.length, 5);
    });

    it("all queries include deletedAt: null and projectId filters", async () => {
      prisma.post.count.mock.mockImplementation(async () => 0);
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getProjectStats(projectId);

      for (const call of prisma.post.count.mock.calls) {
        const args = call?.arguments[0] as
          | { where: { projectId: string; deletedAt: unknown } }
          | undefined;
        assert.equal(args?.where.projectId, PROJECT_ID);
        assert.deepEqual(args?.where.deletedAt, null);
      }
    });
  });

  // ── bulkUpdateStatus ────────────────────────────────────────────────────────

  describe("bulkUpdateStatus", { concurrency: 1 }, () => {
    it("calls updateMany with correct ids and status, returns ok", async () => {
      const postIds = [PostId.fromStringUnsafe(POST_ID), PostId.fromStringUnsafe(POST_ID_2)];

      const result = await repo.bulkUpdateStatus(postIds, PUBLISH_STATUS.PUBLISHED);

      assert.ok(result.ok);
      assert.equal(prisma.post.updateMany.mock.calls.length, 1);

      const callRecord = prisma.post.updateMany.mock.calls[0];
      const args = callRecord?.arguments[0] as
        | {
            where: { id: { in: string[] }; deletedAt: unknown };
            data: { status: string };
          }
        | undefined;
      assert.deepEqual(args?.where.id.in, [POST_ID, POST_ID_2]);
      assert.deepEqual(args?.where.deletedAt, null);
      assert.equal(args?.data.status, "PUBLISHED");
    });

    it("returns ok with empty array (no-op)", async () => {
      const result = await repo.bulkUpdateStatus([], PUBLISH_STATUS.DRAFT);
      assert.ok(result.ok);
    });

    it("returns err when updateMany throws", async () => {
      prisma.post.updateMany.mock.mockImplementation(async () => {
        throw new Error("Bulk update failed");
      });

      const postIds = [PostId.fromStringUnsafe(POST_ID)];
      const result = await repo.bulkUpdateStatus(postIds, PUBLISH_STATUS.FAILED);

      assert.ok(!result.ok);
      assert.match(result.error.message, /Bulk update failed/);
    });
  });
});
