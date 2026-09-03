/**
 * Infrastructure Layer - Prisma Project Repository Unit Tests
 *
 * Part of FASE H4b / H12: Hexagonal Architecture - Prisma Adapters + Soft Delete
 * Tests PrismaProjectRepository in isolation using a mocked PrismaClient.
 * Tier 0: No database required.
 *
 * @file PrismaProjectRepository.test.ts
 * @description Tests for PrismaProjectRepository
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { PrismaProjectRepository } from "../../../src/infrastructure/repositories/PrismaProjectRepository.js";
import { ProjectId, AccountId } from "@core/domain/index.js";
import { toAdminActorId, type AdminActorId } from "@core/domain/value-objects/AdminActorId.js";

/** Construct a branded admin actor id for the hard-delete context (throws on bad setup). */
function actorId(raw: string): AdminActorId {
  const result = toAdminActorId(raw);
  if (!result.ok) {
    throw new Error(`test setup: invalid admin actor id ${raw}`);
  }
  return result.value;
}

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

function makeMockPrisma() {
  const models = {
    project: {
      findFirst: vi.fn(async () => baseRow()),
      findMany: vi.fn(async () => [baseRow()]),
      upsert: vi.fn(async () => baseRow()),
      update: vi.fn(async () => baseRow()),
      count: vi.fn(async () => 1),
      delete: vi.fn(async () => baseRow()),
    },
    post: {
      findMany: vi.fn(async () => [] as { id: string }[]),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      count: vi.fn(async () => 0),
    },
    // The CHILD dimension of the pre-flight size probe. Both are read on every
    // `countHardDeleteImpact` call, so an absent accessor is a TypeError inside the
    // method rather than a wrong number.
    task: {
      count: vi.fn(async () => 0),
    },
    publishLog: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findMany: vi.fn(async () => []),
    },
    analytics: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    postMedia: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    postContent: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    contentVersion: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    tweet: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    thread: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    channel: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    contentTemplate: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    instagramStoryProject: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    videoProcessingJob: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    instagramAnalytics: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    schedulingRule: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    webhookEvent: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      count: vi.fn(async () => 0),
    },
    webhookSubscription: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    template: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    // Model the real client: createMany reports how many rows it inserted, so the
    // repository's tombstone-count integrity check sees a truthful number.
    deletionRecord: {
      createMany: vi.fn(async (args: { data: unknown[] }) => ({ count: args.data.length })),
    },
  };
  // `hardDelete` runs its whole FK-ordered cascade inside ONE transaction, so
  // the double has to model `$transaction` like the real client does: hand the
  // callback a transaction client. Handing back the same double keeps every
  // per-model spy observable, and the spy on `$transaction` itself is what lets
  // a test assert the cascade was atomic rather than a loose sequence of writes.
  return Object.assign(models, {
    $transaction: vi.fn(async (fn: (tx: typeof models) => Promise<unknown>) => fn(models)),
  });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PrismaProjectRepository", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: PrismaProjectRepository;

  beforeEach(() => {
    prisma = makeMockPrisma();
    repo = new PrismaProjectRepository(prisma as never);
  });

  describe("findById", () => {
    it("returns ok(project) when row exists", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.findById(id);

      expect(result.ok).toBeTruthy();
      expect(result.value.name).toBe("My Project");
      expect(result.value.locale).toBe("es");
      // Uses findFirst (not findUnique) to allow deletedAt: null filter
      expect(prisma.project.findFirst.mock.calls.length).toBe(1);
    });

    it("returns err(EntityNotFoundError) when row is null", async () => {
      prisma.project.findFirst.mockImplementation(async () => null);
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.findById(id);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Project/);
    });
  });

  describe("findByAccountId", () => {
    it("returns array of projects", async () => {
      const accountId = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const projects = await repo.findByAccountId(accountId);

      expect(projects.length).toBe(1);
      expect(projects[0]?.name).toBe("My Project");
      expect(prisma.project.findMany.mock.calls.length).toBe(1);
    });

    it("returns empty array when no projects exist", async () => {
      prisma.project.findMany.mockImplementation(async () => []);
      const accountId = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const projects = await repo.findByAccountId(accountId);

      expect(projects.length).toBe(0);
    });
  });

  describe("save", () => {
    it("calls upsert and returns ok", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const findResult = await repo.findById(id);
      expect(findResult.ok).toBeTruthy();

      const saveResult = await repo.save(findResult.value);
      expect(saveResult.ok).toBeTruthy();
      expect(prisma.project.upsert.mock.calls.length).toBe(1);
    });

    it("returns err when prisma throws", async () => {
      prisma.project.upsert.mockImplementation(async () => {
        throw new Error("Unique constraint violation");
      });

      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const findResult = await repo.findById(id);
      expect(findResult.ok).toBeTruthy();

      const saveResult = await repo.save(findResult.value);
      expect(saveResult.ok).toBeFalsy();
      expect(saveResult.error.message).toMatch(/Unique constraint/);
    });
  });

  describe("exists", () => {
    it("returns true when count > 0", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.exists(id);
      expect(result).toBe(true);
    });

    it("returns false when count is 0", async () => {
      prisma.project.count.mockImplementation(async () => 0);
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.exists(id);
      expect(result).toBe(false);
    });
  });

  describe("delete (soft delete)", () => {
    it("calls update with deletedAt and returns ok when project exists", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.delete(id);

      expect(result.ok).toBeTruthy();
      // Soft delete: update, NOT delete
      expect(prisma.project.update.mock.calls.length).toBe(1);
      expect(prisma.project.delete.mock.calls.length).toBe(0);

      const callRecord = prisma.project.update.mock.calls[0];
      const args = callRecord?.[0] as { data: { deletedAt: unknown } } | undefined;
      expect(args?.data.deletedAt instanceof Date).toBeTruthy();
    });

    it("returns err when project does not exist", async () => {
      prisma.project.count.mockImplementation(async () => 0);
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.delete(id);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Project/);
      expect(prisma.project.update.mock.calls.length).toBe(0);
    });
  });

  describe("hardDelete", () => {
    const CONTEXT = { deletedBy: actorId("admin-1"), reason: "GDPR erasure request" };

    it("returns ok and calls delete when project exists (even if soft-deleted)", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.hardDelete(id, CONTEXT);

      expect(result.ok).toBeTruthy();
      // Hard delete: calls the actual DB delete
      expect(prisma.project.delete.mock.calls.length).toBe(1);
    });

    it("runs the whole cascade inside a single transaction", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      await repo.hardDelete(id, CONTEXT);

      // Atomicity is the point: without one transaction, a failure partway
      // through leaves the project half-destroyed — its posts and media already
      // gone, the project row still there.
      expect(prisma.$transaction.mock.calls.length).toBe(1);
    });

    it("writes a tombstone carrying the identity the deleted rows no longer hold", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const before = Date.now();
      await repo.hardDelete(id, CONTEXT);

      expect(prisma.deletionRecord.createMany.mock.calls.length).toBe(1);
      const args = prisma.deletionRecord.createMany.mock.calls[0]?.[0] as {
        data: Array<Record<string, unknown>>;
      };
      expect(args.data.length).toBe(1);
      const record = args.data[0] as Record<string, unknown>;
      expect(record.entityType).toBe("PROJECT");
      expect(record.entityId).toBe("b0000000-0000-4000-8000-000000000001");
      expect(record.name).toBe("My Project");
      expect(record.accountId).toBe("a0000000-0000-4000-8000-000000000001");
      // clientSince is when the relationship began: the row's own createdAt,
      // not the moment of the delete.
      expect(record.clientSince).toEqual(new Date("2026-01-01"));
      expect(record.clientUntil instanceof Date).toBeTruthy();
      expect((record.clientUntil as Date).getTime()).toBeGreaterThanOrEqual(before);
      expect(record.deletedBy).toBe("admin-1");
    });

    it("writes the tombstone inside the same transaction as the delete", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      let txCallbackRan = false;
      prisma.$transaction.mockImplementation(
        async (fn: (tx: typeof prisma) => Promise<unknown>) => {
          // Nothing has been written before the transaction opens...
          expect(prisma.deletionRecord.createMany.mock.calls.length).toBe(0);
          expect(prisma.project.delete.mock.calls.length).toBe(0);
          const out = await fn(prisma);
          // ...and both writes happened while it was open.
          expect(prisma.deletionRecord.createMany.mock.calls.length).toBe(1);
          expect(prisma.project.delete.mock.calls.length).toBe(1);
          txCallbackRan = true;
          return out;
        }
      );

      await repo.hardDelete(id, CONTEXT);
      expect(txCallbackRan).toBe(true);
    });

    it("does not delete the project when the tombstone write fails", async () => {
      // No tombstone, no delete: a destruction with no durable record of what
      // was destroyed is the exact outcome this record exists to prevent.
      // Post-cascade-reduction this is also the only remaining step that can
      // fail before the delete, so it is where a mid-transaction failure is
      // planted (the hand-written FK cascade it replaced is gone — the database
      // performs it now).
      prisma.deletionRecord.createMany.mockRejectedValue(new Error("tombstone write failed"));
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");

      await expect(repo.hardDelete(id, CONTEXT)).rejects.toThrow("tombstone write failed");
      expect(prisma.project.delete.mock.calls.length).toBe(0);
    });

    it("aborts the delete when createMany reports fewer rows than the tombstone handed it", async () => {
      // A silent short write would leave the row destroyed with no tombstone. The
      // count is ASSERTED, not assumed: a mismatch (0 written vs the 1 handed in)
      // throws before the delete, so nothing is destroyed without its record.
      prisma.deletionRecord.createMany.mockResolvedValue({ count: 0 });
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");

      await expect(repo.hardDelete(id, CONTEXT)).rejects.toThrow(
        /Tombstone integrity check failed/
      );
      expect(prisma.project.delete.mock.calls.length).toBe(0);
    });

    it("runs its standalone transaction at Serializable isolation with an explicit timeout", async () => {
      // When no outer Unit of Work is active the repository owns the transaction,
      // so it must set the bounds itself: Serializable and a real timeout budget.
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      await repo.hardDelete(id, CONTEXT);

      const options = prisma.$transaction.mock.calls[0]?.[1] as
        { isolationLevel?: unknown; timeout?: unknown } | undefined;
      expect(options?.isolationLevel).toBe("Serializable");
      expect(typeof options?.timeout).toBe("number");
      expect(options?.timeout as number).toBeGreaterThan(0);
    });

    it("countHardDeleteImpact measures BOTH dimensions the transaction budget is spent on", async () => {
      prisma.post.count.mockResolvedValue(1234);
      prisma.task.count.mockResolvedValue(70);
      prisma.webhookEvent.count.mockResolvedValue(30);
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");

      const impact = await repo.countHardDeleteImpact(id);

      expect(impact.posts).toBe(1234);
      // The child dimension is the SUM of the countable child populations, not one of
      // them: the guard bounds the rows the cascade touches, and reporting only tasks
      // would let a webhook-heavy project through the exact hole this closes.
      expect(impact.childRows).toBe(100);
      const postWhere = prisma.post.count.mock.calls[0]?.[0] as { where?: Record<string, unknown> };
      expect(postWhere?.where).toEqual({ projectId: id.value });
      const taskWhere = prisma.task.count.mock.calls[0]?.[0] as { where?: Record<string, unknown> };
      expect(taskWhere?.where).toEqual({ projectId: id.value });
      const hookWhere = prisma.webhookEvent.count.mock.calls[0]?.[0] as {
        where?: Record<string, unknown>;
      };
      expect(hookWhere?.where).toEqual({ projectId: id.value });
    });

    it("counts posts WITHOUT a deletedAt filter, because the cascade takes soft-deleted rows too", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");

      await repo.countHardDeleteImpact(id);

      // A probe that filtered `deletedAt: null` would under-report exactly the rows a
      // soft-delete-then-erase workflow accumulates, and the ceiling would admit a
      // project the transaction cannot finish.
      const postWhere = prisma.post.count.mock.calls[0]?.[0] as { where?: Record<string, unknown> };
      expect(postWhere?.where).not.toHaveProperty("deletedAt");
    });

    it("returns err(EntityNotFoundError) when project is not found at all", async () => {
      prisma.project.findFirst.mockImplementation(async () => null);
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const result = await repo.hardDelete(id, CONTEXT);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Project/);
      expect(prisma.project.delete.mock.calls.length).toBe(0);
      expect(prisma.deletionRecord.createMany.mock.calls.length).toBe(0);
    });
  });

  describe("findByName", () => {
    it("returns Project when found by account and name", async () => {
      const accountId = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const project = await repo.findByName(accountId, "My Project");

      expect(project !== null).toBeTruthy();
      expect(project?.name).toBe("My Project");
      expect(prisma.project.findFirst.mock.calls.length).toBe(1);
    });

    it("returns null when not found", async () => {
      prisma.project.findFirst.mockImplementation(async () => null);
      const accountId = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const project = await repo.findByName(accountId, "Nonexistent");

      expect(project).toBe(null);
    });

    it("only searches non-deleted projects (deletedAt: null in where clause)", async () => {
      const accountId = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      await repo.findByName(accountId, "My Project");

      const callRecord = prisma.project.findFirst.mock.calls[0];
      const args = callRecord?.[0] as { where: Record<string, unknown> } | undefined;
      expect(args?.where.deletedAt).toEqual(null);
    });
  });

  describe("findPublishLogsByProjectId", () => {
    it("calls publishLog.findMany and returns an array", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const logs = await repo.findPublishLogsByProjectId(id);

      expect(Array.isArray(logs)).toBe(true);
      expect(prisma.publishLog.findMany.mock.calls.length).toBe(1);
    });

    it("queries by post.projectId using nested filter", async () => {
      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      await repo.findPublishLogsByProjectId(id);

      const callRecord = prisma.publishLog.findMany.mock.calls[0];
      const args = callRecord?.[0] as { where: { post: { projectId: string } } } | undefined;
      expect(args?.where.post.projectId).toBe("b0000000-0000-4000-8000-000000000001");
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
      prisma.project.findFirst.mockImplementation(async () => crisisRow);
      prisma.project.upsert.mockImplementation(async () => crisisRow);

      const id = ProjectId.fromStringUnsafe("b0000000-0000-4000-8000-000000000001");
      const findResult = await repo.findById(id);
      expect(findResult.ok).toBeTruthy();

      const project = findResult.value;
      expect(project.isInCrisisMode).toBe(true);
      expect(project.crisisReason).toBe("PR disaster");
      expect(project.crisisModeHistory.length).toBe(1);
    });
  });
});
