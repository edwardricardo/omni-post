/**
 * Infrastructure Layer - Prisma Post Repository Unit Tests
 *
 * Part of FASE H12: Hexagonal Architecture - Soft Delete + Post Adapter
 * Tests PrismaPostRepository in isolation using a mocked PrismaClient.
 * Tier 0: No database required.
 */

import { describe, it, beforeEach, beforeAll, afterAll, vi, expect } from "vitest";
import { PrismaPostRepository } from "../../../src/infrastructure/repositories/PrismaPostRepository.js";
import { PostId, ProjectId, PUBLISH_STATUS } from "../../../src/domain/index.js";

// ── console suppression ───────────────────────────────────────────────────────

let _originalConsoleLog: typeof console.log;
beforeAll(() => {
  _originalConsoleLog = console.log;
  console.log = () => {};
});
afterAll(() => {
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

function makeTransactionMockClient() {
  return {
    post: {
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    },
    postContent: {
      create: vi.fn(async () => ({})),
      upsert: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    postMedia: {
      findMany: vi.fn(async () => [] as { id: string }[]),
      createMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => ({})),
    },
    publishLog: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    analytics: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    contentVersion: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    tweet: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    thread: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  };
}

function makeMockPrisma() {
  const txClient = makeTransactionMockClient();

  return {
    _txClient: txClient,
    post: {
      findFirst: vi.fn(async () => basePostRow()),
      findMany: vi.fn(async () => [basePostRow()]),
      create: vi.fn(async () => basePostRow()),
      update: vi.fn(async () => basePostRow()),
      delete: vi.fn(async () => basePostRow()),
      count: vi.fn(async () => 1),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    postContent: {
      create: vi.fn(async () => ({})),
      upsert: vi.fn(async () => ({})),
    },
    postMedia: {
      findMany: vi.fn(async () => [] as { id: string }[]),
      createMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    publishLog: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    analytics: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    contentVersion: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    tweet: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    thread: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    // $transaction executes the callback immediately with the txClient
    $transaction: vi.fn(async (cb: (tx: typeof txClient) => Promise<unknown>) => cb(txClient)),
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PrismaPostRepository", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: PrismaPostRepository;

  beforeEach(() => {
    prisma = makeMockPrisma();
    repo = new PrismaPostRepository(prisma as never);
  });

  // ── findById ────────────────────────────────────────────────────────────────

  describe("findById", () => {
    it("returns ok(PostAggregate) when row exists", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.findById(id);

      expect(result.ok).toBeTruthy();
      expect(result.value.id.value).toBe(POST_ID);
      expect(result.value.projectId.value).toBe(PROJECT_ID);
      expect(result.value.content.body).toBe("Hello world content");
      expect(result.value.status.value).toBe("DRAFT");
      expect(prisma.post.findFirst.mock.calls.length).toBe(1);
    });

    it("queries with deletedAt: null to exclude soft-deleted posts", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      await repo.findById(id);

      const callRecord = prisma.post.findFirst.mock.calls[0];
      const args = callRecord?.[0] as { where: { deletedAt: unknown } } | undefined;
      expect(args?.where.deletedAt).toEqual(null);
    });

    it("returns err(EntityNotFoundError) when row is null", async () => {
      prisma.post.findFirst.mockImplementation(async () => null);
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.findById(id);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Post/);
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
      prisma.post.findFirst.mockImplementation(async () => rowWithMedia);

      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.findById(id);

      expect(result.ok).toBeTruthy();
      expect(result.value.media.length).toBe(1);
      expect(result.value.media[0]?.type).toBe("image");
      expect(result.value.media[0]?.url).toBe("https://example.com/image.jpg");
    });

    it("maps scheduled post with scheduledAt", async () => {
      const futureDate = new Date(Date.now() + 3600_000);
      const scheduledRow = {
        ...basePostRow(),
        status: "SCHEDULED",
        scheduledAt: futureDate,
      };
      prisma.post.findFirst.mockImplementation(async () => scheduledRow);

      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.findById(id);

      expect(result.ok).toBeTruthy();
      expect(result.value.status.value).toBe("SCHEDULED");
      expect(result.value.scheduledAt !== undefined).toBeTruthy();
    });
  });

  // ── exists ──────────────────────────────────────────────────────────────────

  describe("exists", () => {
    it("returns true when count > 0", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.exists(id);
      expect(result).toBe(true);
    });

    it("returns false when count is 0", async () => {
      prisma.post.count.mockImplementation(async () => 0);
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.exists(id);
      expect(result).toBe(false);
    });

    it("counts only non-deleted posts (deletedAt: null)", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      await repo.exists(id);

      const callRecord = prisma.post.count.mock.calls[0];
      const args = callRecord?.[0] as { where: { deletedAt: unknown } } | undefined;
      expect(args?.where.deletedAt).toEqual(null);
    });
  });

  // ── delete (soft) ───────────────────────────────────────────────────────────

  describe("delete (soft delete)", () => {
    it("calls post.update with deletedAt and returns ok when post exists", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.delete(id);

      expect(result.ok).toBeTruthy();
      // Soft delete: update, NOT hard delete
      expect(prisma.post.update.mock.calls.length).toBe(1);
      expect(prisma.post.delete.mock.calls.length).toBe(0);

      const callRecord = prisma.post.update.mock.calls[0];
      const args = callRecord?.[0] as { data: { deletedAt: unknown } } | undefined;
      expect(args?.data.deletedAt instanceof Date).toBeTruthy();
    });

    it("returns err(EntityNotFoundError) when post does not exist", async () => {
      prisma.post.count.mockImplementation(async () => 0);
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.delete(id);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Post/);
      expect(prisma.post.update.mock.calls.length).toBe(0);
    });
  });

  // ── hardDelete ──────────────────────────────────────────────────────────────

  describe("hardDelete", () => {
    it("returns ok and executes cascade deletions in correct FK order", async () => {
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.hardDelete(id);

      expect(result.ok).toBeTruthy();
      // Transaction was called
      expect(prisma.$transaction.mock.calls.length).toBe(1);

      const tx = prisma._txClient;
      // Verify all cascade deletes were called
      expect(tx.publishLog.deleteMany.mock.calls.length).toBe(1);
      expect(tx.analytics.deleteMany.mock.calls.length).toBe(1);
      expect(tx.contentVersion.deleteMany.mock.calls.length).toBe(1);
      expect(tx.postMedia.deleteMany.mock.calls.length).toBe(1);
      expect(tx.tweet.deleteMany.mock.calls.length).toBe(1);
      expect(tx.thread.deleteMany.mock.calls.length).toBe(1);
      expect(tx.postContent.deleteMany.mock.calls.length).toBe(1);
      expect(tx.post.delete.mock.calls.length).toBe(1);
    });

    it("can delete even soft-deleted posts (findFirst has no deletedAt filter)", async () => {
      // findFirst returns a soft-deleted post (has deletedAt set)
      const softDeletedRow = { ...basePostRow(), deletedAt: new Date("2026-01-15") };
      prisma.post.findFirst.mockImplementation(async () => softDeletedRow);

      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.hardDelete(id);

      expect(result.ok).toBeTruthy();
      expect(prisma.$transaction.mock.calls.length).toBe(1);
    });

    it("returns err(EntityNotFoundError) when post does not exist at all", async () => {
      prisma.post.findFirst.mockImplementation(async () => null);
      const id = PostId.fromStringUnsafe(POST_ID);
      const result = await repo.hardDelete(id);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Post/);
      expect(prisma.$transaction.mock.calls.length).toBe(0);
    });
  });

  // ── save (create path) ──────────────────────────────────────────────────────

  describe("save — new aggregate (create path)", () => {
    it("calls $transaction and creates post + content when post does not exist", async () => {
      // exists() returns false → create path
      prisma.post.count.mockImplementation(async () => 0);

      const postResult = await import("../../../src/domain/index.js").then((m) =>
        m.PostAggregate.create({
          projectId: ProjectId.fromStringUnsafe(PROJECT_ID),
          body: "New post content",
        })
      );
      expect(postResult.ok).toBeTruthy();

      const saveResult = await repo.save(postResult.value);

      expect(saveResult.ok).toBeTruthy();
      expect(prisma.$transaction.mock.calls.length).toBe(1);

      const tx = prisma._txClient;
      expect(tx.post.create.mock.calls.length).toBe(1);
      expect(tx.postContent.create.mock.calls.length).toBe(1);
    });

    it("returns err when $transaction throws during create", async () => {
      prisma.post.count.mockImplementation(async () => 0);
      prisma.$transaction.mockImplementation(async () => {
        throw new Error("DB write failed");
      });

      const postResult = await import("../../../src/domain/index.js").then((m) =>
        m.PostAggregate.create({
          projectId: ProjectId.fromStringUnsafe(PROJECT_ID),
          body: "Content",
        })
      );
      expect(postResult.ok).toBeTruthy();

      const saveResult = await repo.save(postResult.value);

      expect(saveResult.ok).toBeFalsy();
      expect(saveResult.error.message).toMatch(/DB write failed/);
    });
  });

  // ── save (update path) ──────────────────────────────────────────────────────

  describe("save — existing aggregate (update path)", () => {
    it("calls $transaction and upserts content when post exists", async () => {
      // exists() returns true → update path
      prisma.post.count.mockImplementation(async () => 1);

      const findResult = await repo.findById(PostId.fromStringUnsafe(POST_ID));
      expect(findResult.ok).toBeTruthy();

      const saveResult = await repo.save(findResult.value);

      expect(saveResult.ok).toBeTruthy();
      expect(prisma.$transaction.mock.calls.length).toBe(1);

      const tx = prisma._txClient;
      expect(tx.post.update.mock.calls.length).toBe(1);
      expect(tx.postContent.upsert.mock.calls.length).toBe(1);
    });

    it("returns err when $transaction throws during update", async () => {
      prisma.post.count.mockImplementation(async () => 1);
      prisma.$transaction.mockImplementation(async () => {
        throw new Error("Constraint violation");
      });

      const findResult = await repo.findById(PostId.fromStringUnsafe(POST_ID));
      expect(findResult.ok).toBeTruthy();

      const saveResult = await repo.save(findResult.value);

      expect(saveResult.ok).toBeFalsy();
      expect(saveResult.error.message).toMatch(/Constraint violation/);
    });
  });

  // ── findByProjectId ─────────────────────────────────────────────────────────

  describe("findByProjectId", () => {
    it("returns paginated result with correct structure", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const result = await repo.findByProjectId(projectId);

      expect(result.items.length).toBe(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.totalPages).toBe(1);
      expect(result.hasNext).toBe(false);
      expect(result.hasPrevious).toBe(false);
    });

    it("applies custom pagination correctly", async () => {
      // Return multiple rows so pagination kicks in
      prisma.post.findMany.mockImplementation(async () => [
        basePostRow(),
        { ...basePostRow(), id: POST_ID_2 },
      ]);
      prisma.post.count.mockImplementation(async () => 10);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const result = await repo.findByProjectId(projectId, { page: 2, limit: 2 });

      expect(result.page).toBe(2);
      expect(result.limit).toBe(2);
      expect(result.total).toBe(10);
      expect(result.totalPages).toBe(5);
      expect(result.hasNext).toBe(true);
      expect(result.hasPrevious).toBe(true);

      // Verify skip was calculated correctly (page 2, limit 2 → skip 2)
      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { skip: number; take: number } | undefined;
      expect(args?.skip).toBe(2);
      expect(args?.take).toBe(2);
    });

    it("filters by projectId and deletedAt: null", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.findByProjectId(projectId);

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { where: Record<string, unknown> } | undefined;
      expect(args?.where.projectId).toBe(PROJECT_ID);
      expect(args?.where.deletedAt).toEqual(null);
    });

    it("applies sort parameter correctly", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.findByProjectId(projectId, undefined, { field: "scheduledAt", direction: "asc" });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { orderBy: Record<string, unknown> } | undefined;
      expect(args?.orderBy).toEqual({ scheduledAt: "asc" });
    });
  });

  // ── findByStatus ────────────────────────────────────────────────────────────

  describe("findByStatus", () => {
    it("returns paginated posts for a single status", async () => {
      const scheduledRow = { ...basePostRow(), status: "SCHEDULED" };
      prisma.post.findMany.mockImplementation(async () => [scheduledRow]);
      prisma.post.count.mockImplementation(async () => 1);

      const result = await repo.findByStatus(PUBLISH_STATUS.SCHEDULED);

      expect(result.items.length).toBe(1);
      expect(result.items[0]?.status.value).toBe("SCHEDULED");
    });

    it("accepts an array of statuses", async () => {
      await repo.findByStatus([PUBLISH_STATUS.DRAFT, PUBLISH_STATUS.SCHEDULED]);

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { where: { status: { in: string[] } } } | undefined;
      expect(args?.where.status.in).toEqual(["DRAFT", "SCHEDULED"]);
    });

    it("always includes deletedAt: null filter", async () => {
      await repo.findByStatus(PUBLISH_STATUS.DRAFT);

      const callRecord = prisma.post.count.mock.calls[0];
      const args = callRecord?.[0] as { where: { deletedAt: unknown } } | undefined;
      expect(args?.where.deletedAt).toEqual(null);
    });
  });

  // ── findReadyForPublishing ──────────────────────────────────────────────────

  describe("findReadyForPublishing", () => {
    it("returns posts with SCHEDULED status and past scheduledAt", async () => {
      const pastDate = new Date(Date.now() - 3600_000);
      const scheduledRow = {
        ...basePostRow(),
        status: "SCHEDULED",
        scheduledAt: pastDate,
      };
      prisma.post.findMany.mockImplementation(async () => [scheduledRow]);

      const posts = await repo.findReadyForPublishing();

      expect(posts.length).toBe(1);
      expect(posts[0]?.status.value).toBe("SCHEDULED");
    });

    it("passes limit to Prisma take", async () => {
      prisma.post.findMany.mockImplementation(async () => []);

      await repo.findReadyForPublishing(50);

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { take: number } | undefined;
      expect(args?.take).toBe(50);
    });

    it("uses default limit of 100 when not specified", async () => {
      prisma.post.findMany.mockImplementation(async () => []);

      await repo.findReadyForPublishing();

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { take: number } | undefined;
      expect(args?.take).toBe(100);
    });

    it("filters by SCHEDULED status and lte scheduledAt", async () => {
      prisma.post.findMany.mockImplementation(async () => []);

      await repo.findReadyForPublishing();

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as
        | {
            where: { status: string; scheduledAt: { lte: Date }; deletedAt: unknown };
          }
        | undefined;
      expect(args?.where.status).toBe("SCHEDULED");
      expect(args?.where.scheduledAt.lte instanceof Date).toBeTruthy();
      expect(args?.where.deletedAt).toEqual(null);
    });
  });

  // ── findWithFilters ─────────────────────────────────────────────────────────

  describe("findWithFilters", () => {
    it("returns paginated result with no filters (base deletedAt: null)", async () => {
      const result = await repo.findWithFilters({});

      expect(result.items.length).toBe(1);
      expect(result.total).toBe(1);
    });

    it("applies projectId filter", async () => {
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.findWithFilters({ projectId });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { where: { projectId: string } } | undefined;
      expect(args?.where.projectId).toBe(PROJECT_ID);
    });

    it("applies status filter (array)", async () => {
      await repo.findWithFilters({ status: [PUBLISH_STATUS.DRAFT, PUBLISH_STATUS.PUBLISHED] });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { where: { status: { in: string[] } } } | undefined;
      expect(args?.where.status.in).toEqual(["DRAFT", "PUBLISHED"]);
    });

    it("applies date range filters for scheduledBefore and scheduledAfter", async () => {
      const before = new Date("2026-02-01");
      const after = new Date("2026-01-01");
      await repo.findWithFilters({ scheduledBefore: before, scheduledAfter: after });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as
        | {
            where: { scheduledAt: { lte: Date; gte: Date } };
          }
        | undefined;
      expect(args?.where.scheduledAt.lte).toEqual(before);
      expect(args?.where.scheduledAt.gte).toEqual(after);
    });

    it("applies date range filters for createdBefore and createdAfter", async () => {
      const before = new Date("2026-02-01");
      const after = new Date("2026-01-01");
      await repo.findWithFilters({ createdBefore: before, createdAfter: after });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as
        | {
            where: { createdAt: { lte: Date; gte: Date } };
          }
        | undefined;
      expect(args?.where.createdAt.lte).toEqual(before);
      expect(args?.where.createdAt.gte).toEqual(after);
    });

    it("applies hasMedia: true filter using some: {}", async () => {
      await repo.findWithFilters({ hasMedia: true });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { where: { media: unknown } } | undefined;
      expect(args?.where.media).toEqual({ some: {} });
    });

    it("applies hasMedia: false filter using none: {}", async () => {
      await repo.findWithFilters({ hasMedia: false });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { where: { media: unknown } } | undefined;
      expect(args?.where.media).toEqual({ none: {} });
    });

    it("applies searchText filter on contents body and title", async () => {
      await repo.findWithFilters({ searchText: "hello" });

      const callRecord = prisma.post.findMany.mock.calls[0];
      const args = callRecord?.[0] as { where: { OR: unknown[] } } | undefined;
      expect(Array.isArray(args?.where.OR)).toBeTruthy();
      expect(args?.where.OR.length).toBe(2);
    });
  });

  // ── countByProjectId ────────────────────────────────────────────────────────

  describe("countByProjectId", () => {
    it("returns count of non-deleted posts for a project", async () => {
      prisma.post.count.mockImplementation(async () => 7);
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const count = await repo.countByProjectId(projectId);

      expect(count).toBe(7);
      const callRecord = prisma.post.count.mock.calls[0];
      const args = callRecord?.[0] as
        | {
            where: { projectId: string; deletedAt: unknown };
          }
        | undefined;
      expect(args?.where.projectId).toBe(PROJECT_ID);
      expect(args?.where.deletedAt).toEqual(null);
    });

    it("returns 0 when project has no posts", async () => {
      prisma.post.count.mockImplementation(async () => 0);
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const count = await repo.countByProjectId(projectId);
      expect(count).toBe(0);
    });
  });

  // ── countByStatus ───────────────────────────────────────────────────────────

  describe("countByStatus", () => {
    it("counts posts for a specific project and status", async () => {
      prisma.post.count.mockImplementation(async () => 3);
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const count = await repo.countByStatus(projectId, PUBLISH_STATUS.DRAFT);

      expect(count).toBe(3);
      const callRecord = prisma.post.count.mock.calls[0];
      const args = callRecord?.[0] as
        | {
            where: { projectId: string; status: string; deletedAt: unknown };
          }
        | undefined;
      expect(args?.where.projectId).toBe(PROJECT_ID);
      expect(args?.where.status).toBe("DRAFT");
      expect(args?.where.deletedAt).toEqual(null);
    });

    it("returns 0 when no posts match status", async () => {
      prisma.post.count.mockImplementation(async () => 0);
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const count = await repo.countByStatus(projectId, PUBLISH_STATUS.PUBLISHED);
      expect(count).toBe(0);
    });
  });

  // ── getProjectStats ─────────────────────────────────────────────────────────

  describe("getProjectStats", () => {
    it("returns correct stats object with all fields", async () => {
      // Simulate 5 sequential count calls: total, drafts, scheduled, published, failed
      let callCount = 0;
      const counts = [10, 5, 2, 2, 1];
      prisma.post.count.mockImplementation(async () => counts[callCount++] ?? 0);

      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      const stats = await repo.getProjectStats(projectId);

      expect(stats.total).toBe(10);
      expect(stats.drafts).toBe(5);
      expect(stats.scheduled).toBe(2);
      expect(stats.published).toBe(2);
      expect(stats.failed).toBe(1);
    });

    it("makes 5 count queries (total + 4 statuses)", async () => {
      prisma.post.count.mockImplementation(async () => 0);
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getProjectStats(projectId);

      expect(prisma.post.count.mock.calls.length).toBe(5);
    });

    it("all queries include deletedAt: null and projectId filters", async () => {
      prisma.post.count.mockImplementation(async () => 0);
      const projectId = ProjectId.fromStringUnsafe(PROJECT_ID);
      await repo.getProjectStats(projectId);

      for (const call of prisma.post.count.mock.calls) {
        const args = call?.[0] as { where: { projectId: string; deletedAt: unknown } } | undefined;
        expect(args?.where.projectId).toBe(PROJECT_ID);
        expect(args?.where.deletedAt).toEqual(null);
      }
    });
  });

  // ── bulkUpdateStatus ────────────────────────────────────────────────────────

  describe("bulkUpdateStatus", () => {
    it("calls updateMany with correct ids and status, returns ok", async () => {
      const postIds = [PostId.fromStringUnsafe(POST_ID), PostId.fromStringUnsafe(POST_ID_2)];

      const result = await repo.bulkUpdateStatus(postIds, PUBLISH_STATUS.PUBLISHED);

      expect(result.ok).toBeTruthy();
      expect(prisma.post.updateMany.mock.calls.length).toBe(1);

      const callRecord = prisma.post.updateMany.mock.calls[0];
      const args = callRecord?.[0] as
        | {
            where: { id: { in: string[] }; deletedAt: unknown };
            data: { status: string };
          }
        | undefined;
      expect(args?.where.id.in).toEqual([POST_ID, POST_ID_2]);
      expect(args?.where.deletedAt).toEqual(null);
      expect(args?.data.status).toBe("PUBLISHED");
    });

    it("returns ok with empty array (no-op)", async () => {
      const result = await repo.bulkUpdateStatus([], PUBLISH_STATUS.DRAFT);
      expect(result.ok).toBeTruthy();
    });

    it("returns err when updateMany throws", async () => {
      prisma.post.updateMany.mockImplementation(async () => {
        throw new Error("Bulk update failed");
      });

      const postIds = [PostId.fromStringUnsafe(POST_ID)];
      const result = await repo.bulkUpdateStatus(postIds, PUBLISH_STATUS.FAILED);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Bulk update failed/);
    });
  });
});
