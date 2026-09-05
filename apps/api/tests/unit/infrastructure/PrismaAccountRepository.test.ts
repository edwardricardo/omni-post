/**
 * Infrastructure Layer - Prisma Account Repository Unit Tests
 *
 * Part of FASE H4b / H12: Hexagonal Architecture - Prisma Adapters + Soft Delete
 * Tests PrismaAccountRepository in isolation using a mocked PrismaClient.
 * Tier 0: No database required.
 *
 * @file PrismaAccountRepository.test.ts
 * @description Tests for PrismaAccountRepository
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { PrismaAccountRepository } from "../../../src/infrastructure/repositories/PrismaAccountRepository.js";
import { AccountId } from "@core/domain/index.js";
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
    id: "a0000000-0000-4000-8000-000000000001",
    email: "alice@example.com",
    name: "Alice",
    subscription: "BASIC",
    maxProjects: 1,
    isOnTrial: true,
    trialStartDate: new Date("2026-01-01"),
    trialEndDate: null as Date | null,
    autoRenewal: false,
    billingCycle: "monthly",
    stripeCustomerId: null as string | null,
    stripeSubscriptionId: null as string | null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    _count: { projects: 0 },
  };
}

function makeMockPrisma() {
  const models = {
    account: {
      findFirst: vi.fn(async () => baseRow()),
      findMany: vi.fn(async () => [baseRow()]),
      upsert: vi.fn(async () => baseRow()),
      update: vi.fn(async () => baseRow()),
      count: vi.fn(async () => 1),
      delete: vi.fn(async () => baseRow()),
    },
    project: {
      findMany: vi.fn(async () => [] as { id: string; name: string; createdAt: Date }[]),
    },
    // Model the real client: createMany reports how many rows it inserted, so the
    // repository's tombstone-count integrity check sees a truthful number.
    deletionRecord: {
      createMany: vi.fn(async (args: { data: unknown[] }) => ({ count: args.data.length })),
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
    publishLog: { deleteMany: vi.fn(async () => ({ count: 0 })) },
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
    apiKey: { deleteMany: vi.fn(async () => ({ count: 0 })) },
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

describe("PrismaAccountRepository", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: PrismaAccountRepository;

  beforeEach(() => {
    prisma = makeMockPrisma();
    repo = new PrismaAccountRepository(prisma as never);
  });

  describe("findById", () => {
    it("returns ok(account) when row exists", async () => {
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const result = await repo.findById(id);

      expect(result.ok).toBeTruthy();
      expect(result.value.email).toBe("alice@example.com");
      expect(result.value.name).toBe("Alice");
      // Uses findFirst (not findUnique) to allow deletedAt: null filter
      expect(prisma.account.findFirst.mock.calls.length).toBe(1);
    });

    it("returns err(EntityNotFoundError) when row is null", async () => {
      prisma.account.findFirst.mockImplementation(async () => null);
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const result = await repo.findById(id);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Account/);
    });
  });

  describe("findByEmail", () => {
    it("returns Account when found", async () => {
      const account = await repo.findByEmail("alice@example.com");

      expect(account !== null).toBeTruthy();
      expect(account?.email).toBe("alice@example.com");
      expect(prisma.account.findFirst.mock.calls.length).toBe(1);
    });

    it("returns null when not found", async () => {
      prisma.account.findFirst.mockImplementation(async () => null);
      const account = await repo.findByEmail("ghost@example.com");

      expect(account).toBe(null);
    });

    it("normalizes email to lowercase and trims whitespace before querying", async () => {
      let capturedWhere: { email?: string } | undefined;
      prisma.account.findFirst.mockImplementation(async (args: { where: { email?: string } }) => {
        capturedWhere = args.where;
        return baseRow();
      });

      await repo.findByEmail("  ALICE@EXAMPLE.COM  ");

      expect(capturedWhere !== undefined).toBeTruthy();
      expect(capturedWhere.email).toBe("alice@example.com");
    });

    it("includes deletedAt: null to exclude soft-deleted accounts", async () => {
      let capturedWhere: { deletedAt?: null } | undefined;
      prisma.account.findFirst.mockImplementation(async (args: { where: { deletedAt?: null } }) => {
        capturedWhere = args.where;
        return baseRow();
      });

      await repo.findByEmail("alice@example.com");

      expect(capturedWhere?.deletedAt).toEqual(null);
    });
  });

  describe("save", () => {
    it("calls upsert and returns ok", async () => {
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const findResult = await repo.findById(id);
      expect(findResult.ok).toBeTruthy();

      const saveResult = await repo.save(findResult.value);
      expect(saveResult.ok).toBeTruthy();
      expect(prisma.account.upsert.mock.calls.length).toBe(1);
    });

    it("returns err when prisma throws", async () => {
      prisma.account.upsert.mockImplementation(async () => {
        throw new Error("DB connection lost");
      });

      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const findResult = await repo.findById(id);
      expect(findResult.ok).toBeTruthy();

      const saveResult = await repo.save(findResult.value);
      expect(saveResult.ok).toBeFalsy();
      expect(saveResult.error.message).toMatch(/DB connection lost/);
    });
  });

  describe("exists", () => {
    it("returns true when count > 0", async () => {
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const result = await repo.exists(id);
      expect(result).toBe(true);
    });

    it("returns false when count is 0", async () => {
      prisma.account.count.mockImplementation(async () => 0);
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const result = await repo.exists(id);
      expect(result).toBe(false);
    });
  });

  describe("delete (soft delete)", () => {
    it("calls update with deletedAt and returns ok when account exists", async () => {
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const result = await repo.delete(id);

      expect(result.ok).toBeTruthy();
      // Soft delete: update, NOT delete
      expect(prisma.account.update.mock.calls.length).toBe(1);
      expect(prisma.account.delete.mock.calls.length).toBe(0);

      const callRecord = prisma.account.update.mock.calls[0];
      const args = callRecord?.[0] as { data: { deletedAt: unknown } } | undefined;
      expect(args?.data.deletedAt instanceof Date).toBeTruthy();
    });

    it("returns err(EntityNotFoundError) when account does not exist", async () => {
      prisma.account.count.mockImplementation(async () => 0);
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const result = await repo.delete(id);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Account/);
      expect(prisma.account.update.mock.calls.length).toBe(0);
    });
  });

  describe("hardDelete", () => {
    const CONTEXT = { deletedBy: actorId("admin-1"), reason: "GDPR erasure request" };
    const PROJECT_ROWS = [
      {
        id: "b0000000-0000-4000-8000-000000000001",
        name: "Alpha",
        createdAt: new Date("2026-02-01"),
      },
      {
        id: "b0000000-0000-4000-8000-000000000002",
        name: "Beta",
        createdAt: new Date("2026-03-01"),
      },
    ];

    it("returns ok and calls delete when account exists (even if soft-deleted)", async () => {
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const result = await repo.hardDelete(id, CONTEXT);

      expect(result.ok).toBeTruthy();
      // Hard delete: calls the actual DB delete
      expect(prisma.account.delete.mock.calls.length).toBe(1);
    });

    it("runs the whole cascade inside a single transaction", async () => {
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      await repo.hardDelete(id, CONTEXT);

      // Atomicity is the point: without one transaction, a failure partway
      // through leaves the tenant half-destroyed — its posts and channels
      // already gone, the account row still there. A RESTRICT interlock
      // elsewhere in the graph can still refuse the delete after the tombstones
      // are written, so that failure is real.
      expect(prisma.$transaction.mock.calls.length).toBe(1);
    });

    it("writes a tombstone for the account itself", async () => {
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const before = Date.now();
      await repo.hardDelete(id, CONTEXT);

      expect(prisma.deletionRecord.createMany.mock.calls.length).toBe(1);
      const args = prisma.deletionRecord.createMany.mock.calls[0]?.[0] as {
        data: Array<Record<string, unknown>>;
      };
      const record = args.data.find((r) => r.entityType === "ACCOUNT") as Record<string, unknown>;
      expect(record).toBeTruthy();
      expect(record.entityId).toBe("a0000000-0000-4000-8000-000000000001");
      // For an ACCOUNT record the owning account IS the entity.
      expect(record.accountId).toBe("a0000000-0000-4000-8000-000000000001");
      expect(record.name).toBe("Alice");
      expect(record.clientSince).toEqual(new Date("2026-01-01"));
      expect((record.clientUntil as Date).getTime()).toBeGreaterThanOrEqual(before);
      expect(record.deletedBy).toBe("admin-1");
    });

    it("writes one extra tombstone per project the account drags along", async () => {
      // The projects are destroyed by the database cascade, so their identity
      // has to be captured from inside the transaction BEFORE the delete — after
      // it there is nothing left to read.
      prisma.project.findMany.mockResolvedValue(PROJECT_ROWS);
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      await repo.hardDelete(id, CONTEXT);

      const args = prisma.deletionRecord.createMany.mock.calls[0]?.[0] as {
        data: Array<Record<string, unknown>>;
      };
      expect(args.data.length).toBe(3); // 1 account + 2 projects
      const projectRecords = args.data.filter((r) => r.entityType === "PROJECT");
      expect(projectRecords.length).toBe(2);
      expect(projectRecords.map((r) => r.entityId)).toEqual([
        "b0000000-0000-4000-8000-000000000001",
        "b0000000-0000-4000-8000-000000000002",
      ]);
      expect(projectRecords.map((r) => r.name)).toEqual(["Alpha", "Beta"]);
      expect(projectRecords.map((r) => r.clientSince)).toEqual([
        new Date("2026-02-01"),
        new Date("2026-03-01"),
      ]);
      // A project tombstone still names the account it belonged to.
      for (const record of projectRecords) {
        expect(record.accountId).toBe("a0000000-0000-4000-8000-000000000001");
        expect(record.deletedBy).toBe("admin-1");
      }
    });

    it("writes the tombstones inside the same transaction as the delete", async () => {
      prisma.project.findMany.mockResolvedValue(PROJECT_ROWS);
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      let txCallbackRan = false;
      prisma.$transaction.mockImplementation(
        async (fn: (tx: typeof prisma) => Promise<unknown>) => {
          expect(prisma.deletionRecord.createMany.mock.calls.length).toBe(0);
          expect(prisma.account.delete.mock.calls.length).toBe(0);
          const out = await fn(prisma);
          expect(prisma.deletionRecord.createMany.mock.calls.length).toBe(1);
          expect(prisma.account.delete.mock.calls.length).toBe(1);
          txCallbackRan = true;
          return out;
        }
      );

      await repo.hardDelete(id, CONTEXT);
      expect(txCallbackRan).toBe(true);
    });

    it("does not delete the account when the tombstone write fails", async () => {
      // No tombstone, no delete: a destruction with no durable record of what
      // was destroyed is the exact outcome these records exist to prevent.
      // Post-cascade-reduction this is also the only remaining write that can
      // fail before the delete, so it is where a mid-transaction failure is
      // planted (the hand-written FK cascade it replaced is gone — the database
      // performs it now).
      prisma.project.findMany.mockResolvedValue(PROJECT_ROWS);
      prisma.deletionRecord.createMany.mockRejectedValue(new Error("tombstone write failed"));
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");

      await expect(repo.hardDelete(id, CONTEXT)).rejects.toThrow("tombstone write failed");
      expect(prisma.account.delete.mock.calls.length).toBe(0);
    });

    it("aborts the delete when createMany reports fewer rows than the tombstones handed it", async () => {
      // A silent short write — createMany inserting fewer rows than we gave it —
      // would leave a destroyed row that no tombstone describes. The count is
      // ASSERTED, not assumed: a mismatch throws before the delete, so nothing is
      // destroyed without its record. 1 account + 2 projects = 3 expected.
      prisma.project.findMany.mockResolvedValue(PROJECT_ROWS);
      prisma.deletionRecord.createMany.mockResolvedValue({ count: 1 });
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");

      await expect(repo.hardDelete(id, CONTEXT)).rejects.toThrow(
        /Tombstone integrity check failed/
      );
      expect(prisma.account.delete.mock.calls.length).toBe(0);
    });

    it("runs its standalone transaction at Serializable isolation with an explicit timeout", async () => {
      // When no outer Unit of Work is active the repository owns the transaction,
      // so it must set the bounds itself: Serializable (so the tombstone snapshot
      // cannot miss a concurrently inserted project) and a real timeout budget.
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      await repo.hardDelete(id, CONTEXT);

      const options = prisma.$transaction.mock.calls[0]?.[1] as
        { isolationLevel?: unknown; timeout?: unknown } | undefined;
      expect(options?.isolationLevel).toBe("Serializable");
      expect(typeof options?.timeout).toBe("number");
      expect(options?.timeout as number).toBeGreaterThan(0);
    });

    it("countHardDeleteImpact measures BOTH dimensions the transaction budget is spent on", async () => {
      prisma.post.count.mockResolvedValue(4210);
      prisma.task.count.mockResolvedValue(900);
      prisma.webhookEvent.count.mockResolvedValue(100);
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");

      const impact = await repo.countHardDeleteImpact(id);

      expect(impact.posts).toBe(4210);
      // The child dimension is the SUM of the countable child populations, not one of
      // them: the guard bounds the rows the cascade touches, and reporting only tasks
      // would let a webhook-heavy tenant through the exact hole this closes.
      expect(impact.childRows).toBe(1000);
      // Counts across every project of the account (relation filter), soft-deleted
      // included — the cascade takes them too.
      const where = prisma.post.count.mock.calls[0]?.[0] as { where?: Record<string, unknown> };
      expect(where?.where).toEqual({ project: { accountId: id.value } });
      const taskWhere = prisma.task.count.mock.calls[0]?.[0] as { where?: Record<string, unknown> };
      expect(taskWhere?.where).toEqual({ accountId: id.value });
    });

    it("counts webhook events with the SAME predicate the erasure deletes them by", async () => {
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");

      await repo.countHardDeleteImpact(id);

      // `hardDelete` removes webhook events matching `accountId` OR a project of this
      // account. A probe that counted only the `accountId` half would bound a narrower
      // set than the transaction actually destroys — a ceiling measuring something
      // other than the work is not a ceiling.
      const hookWhere = prisma.webhookEvent.count.mock.calls[0]?.[0] as {
        where?: Record<string, unknown>;
      };
      expect(hookWhere?.where).toEqual({
        OR: [{ accountId: id.value }, { project: { accountId: id.value } }],
      });
    });

    it("returns err(EntityNotFoundError) when account is not found at all", async () => {
      prisma.account.findFirst.mockImplementation(async () => null);
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const result = await repo.hardDelete(id, CONTEXT);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Account/);
      expect(prisma.account.delete.mock.calls.length).toBe(0);
      expect(prisma.deletionRecord.createMany.mock.calls.length).toBe(0);
    });
  });

  describe("findAll", () => {
    it("returns all active accounts", async () => {
      const accounts = await repo.findAll();
      expect(accounts.length).toBe(1);
      expect(accounts[0]?.email).toBe("alice@example.com");
      expect(prisma.account.findMany.mock.calls.length).toBe(1);
    });
  });
});
