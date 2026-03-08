/**
 * Infrastructure Layer - Prisma Account Repository Unit Tests
 *
 * Part of FASE H4b / H12: Hexagonal Architecture - Prisma Adapters + Soft Delete
 * Tests PrismaAccountRepository in isolation using a mocked PrismaClient.
 * Tier 0: No database required.
 */

import { describe, it, beforeEach } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";

import { PrismaAccountRepository } from "../../../src/infrastructure/repositories/PrismaAccountRepository.js";
import { AccountId } from "../../../src/domain/index.js";

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

function makeMockPrisma(t: TestContext) {
  return {
    account: {
      findFirst: t.mock.fn(async () => baseRow()),
      findMany: t.mock.fn(async () => [baseRow()]),
      upsert: t.mock.fn(async () => baseRow()),
      update: t.mock.fn(async () => baseRow()),
      count: t.mock.fn(async () => 1),
      delete: t.mock.fn(async () => baseRow()),
    },
    project: {
      findMany: t.mock.fn(async () => [] as { id: string }[]),
    },
    post: {
      findMany: t.mock.fn(async () => [] as { id: string }[]),
      deleteMany: t.mock.fn(async () => ({ count: 0 })),
    },
    publishLog: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
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
    apiKey: { deleteMany: t.mock.fn(async () => ({ count: 0 })) },
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PrismaAccountRepository", { concurrency: 1 }, () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let repo: PrismaAccountRepository;

  beforeEach((t) => {
    prisma = makeMockPrisma(t);
    repo = new PrismaAccountRepository(prisma as never);
  });

  describe("findById", () => {
    it("returns ok(account) when row exists", async () => {
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const result = await repo.findById(id);

      assert.ok(result.ok);
      assert.equal(result.value.email, "alice@example.com");
      assert.equal(result.value.name, "Alice");
      // Uses findFirst (not findUnique) to allow deletedAt: null filter
      assert.equal(prisma.account.findFirst.mock.calls.length, 1);
    });

    it("returns err(EntityNotFoundError) when row is null", async () => {
      prisma.account.findFirst.mock.mockImplementation(async () => null);
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const result = await repo.findById(id);

      assert.ok(!result.ok);
      assert.match(result.error.message, /Account/);
    });
  });

  describe("findByEmail", () => {
    it("returns Account when found", async () => {
      const account = await repo.findByEmail("alice@example.com");

      assert.ok(account !== null);
      assert.equal(account?.email, "alice@example.com");
      assert.equal(prisma.account.findFirst.mock.calls.length, 1);
    });

    it("returns null when not found", async () => {
      prisma.account.findFirst.mock.mockImplementation(async () => null);
      const account = await repo.findByEmail("ghost@example.com");

      assert.equal(account, null);
    });

    it("normalizes email to lowercase and trims whitespace before querying", async () => {
      let capturedWhere: { email?: string } | undefined;
      prisma.account.findFirst.mock.mockImplementation(
        async (args: { where: { email?: string } }) => {
          capturedWhere = args.where;
          return baseRow();
        }
      );

      await repo.findByEmail("  ALICE@EXAMPLE.COM  ");

      assert.ok(capturedWhere !== undefined);
      assert.equal(capturedWhere.email, "alice@example.com");
    });

    it("includes deletedAt: null to exclude soft-deleted accounts", async () => {
      let capturedWhere: { deletedAt?: null } | undefined;
      prisma.account.findFirst.mock.mockImplementation(
        async (args: { where: { deletedAt?: null } }) => {
          capturedWhere = args.where;
          return baseRow();
        }
      );

      await repo.findByEmail("alice@example.com");

      assert.deepEqual(capturedWhere?.deletedAt, null);
    });
  });

  describe("save", () => {
    it("calls upsert and returns ok", async () => {
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const findResult = await repo.findById(id);
      assert.ok(findResult.ok);

      const saveResult = await repo.save(findResult.value);
      assert.ok(saveResult.ok);
      assert.equal(prisma.account.upsert.mock.calls.length, 1);
    });

    it("returns err when prisma throws", async () => {
      prisma.account.upsert.mock.mockImplementation(async () => {
        throw new Error("DB connection lost");
      });

      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const findResult = await repo.findById(id);
      assert.ok(findResult.ok);

      const saveResult = await repo.save(findResult.value);
      assert.ok(!saveResult.ok);
      assert.match(saveResult.error.message, /DB connection lost/);
    });
  });

  describe("exists", () => {
    it("returns true when count > 0", async () => {
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const result = await repo.exists(id);
      assert.equal(result, true);
    });

    it("returns false when count is 0", async () => {
      prisma.account.count.mock.mockImplementation(async () => 0);
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const result = await repo.exists(id);
      assert.equal(result, false);
    });
  });

  describe("delete (soft delete)", () => {
    it("calls update with deletedAt and returns ok when account exists", async () => {
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const result = await repo.delete(id);

      assert.ok(result.ok);
      // Soft delete: update, NOT delete
      assert.equal(prisma.account.update.mock.calls.length, 1);
      assert.equal(prisma.account.delete.mock.calls.length, 0);

      const callRecord = prisma.account.update.mock.calls[0];
      const args = callRecord?.arguments[0] as { data: { deletedAt: unknown } } | undefined;
      assert.ok(args?.data.deletedAt instanceof Date);
    });

    it("returns err(EntityNotFoundError) when account does not exist", async () => {
      prisma.account.count.mock.mockImplementation(async () => 0);
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const result = await repo.delete(id);

      assert.ok(!result.ok);
      assert.match(result.error.message, /Account/);
      assert.equal(prisma.account.update.mock.calls.length, 0);
    });
  });

  describe("hardDelete", () => {
    it("returns ok and calls delete when account exists (even if soft-deleted)", async () => {
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const result = await repo.hardDelete(id);

      assert.ok(result.ok);
      // Hard delete: calls the actual DB delete
      assert.equal(prisma.account.delete.mock.calls.length, 1);
    });

    it("returns err(EntityNotFoundError) when account is not found at all", async () => {
      prisma.account.findFirst.mock.mockImplementation(async () => null);
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const result = await repo.hardDelete(id);

      assert.ok(!result.ok);
      assert.match(result.error.message, /Account/);
      assert.equal(prisma.account.delete.mock.calls.length, 0);
    });
  });

  describe("findAll", () => {
    it("returns all active accounts", async () => {
      const accounts = await repo.findAll();
      assert.equal(accounts.length, 1);
      assert.equal(accounts[0]?.email, "alice@example.com");
      assert.equal(prisma.account.findMany.mock.calls.length, 1);
    });
  });
});
