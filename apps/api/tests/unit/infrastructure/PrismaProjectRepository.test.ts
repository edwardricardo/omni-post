/**
 * Infrastructure Layer - Prisma Project Repository Unit Tests
 *
 * Part of FASE H4b / H12: Hexagonal Architecture - Prisma Adapters + Soft Delete
 * Tests PrismaProjectRepository in isolation using a mocked PrismaClient.
 * Tier 0: No database required.
 */

import { describe, it, beforeEach } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";

import { PrismaProjectRepository } from "../../../src/infrastructure/repositories/PrismaProjectRepository.js";
import { ProjectId, AccountId } from "../../../src/domain/index.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function baseRow() {
  return {
    id: "b0000000-0000-4000-8000-000000000001",
    accountId: "a0000000-0000-4000-8000-000000000001",
    name: "My Project",
    locale: "es",
    isInCrisisMode: false,
    crisisStartedAt: null as Date | null,
    crisisReason: null as string | null,
    crisisModeHistory: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    channels: [] as { id: string }[],
    posts: [] as { id: string }[],
  };
}

function makeMockPrisma(t: TestContext) {
  return {
    project: {
      findFirst: t.mock.fn(async () => baseRow()),
      findMany: t.mock.fn(async () => [baseRow()]),
      upsert: t.mock.fn(async () => baseRow()),
      update: t.mock.fn(async () => baseRow()),
      count: t.mock.fn(async () => 1),
      delete: t.mock.fn(async () => baseRow()),
    },
    post: {
      findMany: t.mock.fn(async () => [] as { id: string }[]),
      deleteMany: t.mock.fn(async () => ({ count: 0 })),
    },
    publishLog: {
      deleteMany: t.mock.fn(async () => ({ count: 0 })),
      findMany: t.mock.fn(async () => []),
    },
    analytics: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    postMedia: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    postContent: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    contentVersion: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    publishingQueue: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    tweet: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    thread: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    channel: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    providerConnection: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    contentTemplate: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    instagramStoryProject: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    videoProcessingJob: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    instagramAnalytics: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    schedulingRule: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    webhookEvent: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    webhookSubscription: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
    template: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PrismaProjectRepository", { concurrency: 1 }, () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: PrismaProjectRepository;

  beforeEach((t) => {
    prisma = makeMockPrisma(t);
    repo = new PrismaProjectRepository(prisma as never);
  });

  describe("findById", () => {
    it("returns ok(project) when row exists", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.findById(id);

      assert.ok(result.ok);
      assert.equal(result.value.name, "My Project");
      assert.equal(result.value.locale, "es");
      // Uses findFirst (not findUnique) to allow deletedAt: null filter
      assert.equal(prisma.project.findFirst.mock.calls.length, 1);
    });

    it("returns err(EntityNotFoundError) when row is null", async () => {
      prisma.project.findFirst.mock.mockImplementation(async () => null);
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.findById(id);

      assert.ok(!result.ok);
      assert.match(result.error.message, /Project/);
    });
  });

  describe("findByAccountId", () => {
    it("returns array of projects", async () => {
      const accountId = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const projects = await repo.findByAccountId(accountId);

      assert.equal(projects.length, 1);
      assert.equal(projects[0]?.name, "My Project");
      assert.equal(prisma.project.findMany.mock.calls.length, 1);
    });

    it("returns empty array when no projects exist", async () => {
      prisma.project.findMany.mock.mockImplementation(async () => []);
      const accountId = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const projects = await repo.findByAccountId(accountId);

      assert.equal(projects.length, 0);
    });
  });

  describe("save", () => {
    it("calls upsert and returns ok", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const findResult = await repo.findById(id);
      assert.ok(findResult.ok);

      const saveResult = await repo.save(findResult.value);
      assert.ok(saveResult.ok);
      assert.equal(prisma.project.upsert.mock.calls.length, 1);
    });

    it("returns err when prisma throws", async () => {
      prisma.project.upsert.mock.mockImplementation(async () => {
        throw new Error("Unique constraint violation");
      });

      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const findResult = await repo.findById(id);
      assert.ok(findResult.ok);

      const saveResult = await repo.save(findResult.value);
      assert.ok(!saveResult.ok);
      assert.match(saveResult.error.message, /Unique constraint/);
    });
  });

  describe("exists", () => {
    it("returns true when count > 0", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.exists(id);
      assert.equal(result, true);
    });

    it("returns false when count is 0", async () => {
      prisma.project.count.mock.mockImplementation(async () => 0);
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.exists(id);
      assert.equal(result, false);
    });
  });

  describe("delete (soft delete)", () => {
    it("calls update with deletedAt and returns ok when project exists", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.delete(id);

      assert.ok(result.ok);
      // Soft delete: update, NOT delete
      assert.equal(prisma.project.update.mock.calls.length, 1);
      assert.equal(prisma.project.delete.mock.calls.length, 0);

      const callRecord = prisma.project.update.mock.calls[0];
      const args = callRecord?.arguments[0] as { data: { deletedAt: unknown } } | undefined;
      assert.ok(args?.data.deletedAt instanceof Date);
    });

    it("returns err when project does not exist", async () => {
      prisma.project.count.mock.mockImplementation(async () => 0);
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.delete(id);

      assert.ok(!result.ok);
      assert.match(result.error.message, /Project/);
      assert.equal(prisma.project.update.mock.calls.length, 0);
    });
  });

  describe("hardDelete", () => {
    it("returns ok and calls delete when project exists (even if soft-deleted)", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.hardDelete(id);

      assert.ok(result.ok);
      // Hard delete: calls the actual DB delete
      assert.equal(prisma.project.delete.mock.calls.length, 1);
    });

    it("returns err(EntityNotFoundError) when project is not found at all", async () => {
      prisma.project.findFirst.mock.mockImplementation(async () => null);
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.hardDelete(id);

      assert.ok(!result.ok);
      assert.match(result.error.message, /Project/);
      assert.equal(prisma.project.delete.mock.calls.length, 0);
    });
  });

  describe("findByName", () => {
    it("returns Project when found by account and name", async () => {
      const accountId = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const project = await repo.findByName(accountId, "My Project");

      assert.ok(project !== null);
      assert.equal(project?.name, "My Project");
      assert.equal(prisma.project.findFirst.mock.calls.length, 1);
    });

    it("returns null when not found", async () => {
      prisma.project.findFirst.mock.mockImplementation(async () => null);
      const accountId = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const project = await repo.findByName(accountId, "Nonexistent");

      assert.equal(project, null);
    });

    it("only searches non-deleted projects (deletedAt: null in where clause)", async () => {
      const accountId = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      await repo.findByName(accountId, "My Project");

      const callRecord = prisma.project.findFirst.mock.calls[0];
      const args = callRecord?.arguments[0] as { where: Record<string, unknown> } | undefined;
      assert.deepEqual(args?.where.deletedAt, null);
    });
  });

  describe("findPublishLogsByProjectId", () => {
    it("calls publishLog.findMany and returns an array", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const logs = await repo.findPublishLogsByProjectId(id);

      assert.equal(Array.isArray(logs), true);
      assert.equal(prisma.publishLog.findMany.mock.calls.length, 1);
    });

    it("queries by post.projectId using nested filter", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      await repo.findPublishLogsByProjectId(id);

      const callRecord = prisma.publishLog.findMany.mock.calls[0];
      const args = callRecord?.arguments[0] as
        | { where: { post: { projectId: string } } }
        | undefined;
      assert.equal(args?.where.post.projectId, "b0000000-0000-4000-8000-000000000001");
    });
  });

  describe("crisis mode roundtrip", () => {
    it("preserves crisis mode history during save/load cycle", async () => {
      const crisisRow = {
        ...baseRow(),
        isInCrisisMode: true,
        crisisStartedAt: new Date("2026-01-15"),
        crisisReason: "PR disaster",
        crisisModeHistory: [{ reason: "PR disaster", startedAt: "2026-01-15T00:00:00.000Z" }],
      };
      prisma.project.findFirst.mock.mockImplementation(async () => crisisRow);
      prisma.project.upsert.mock.mockImplementation(async () => crisisRow);

      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const findResult = await repo.findById(id);
      assert.ok(findResult.ok);

      const project = findResult.value;
      assert.equal(project.isInCrisisMode, true);
      assert.equal(project.crisisReason, "PR disaster");
      assert.equal(project.crisisModeHistory.length, 1);
    });
  });
});
