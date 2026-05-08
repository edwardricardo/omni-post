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

function makeMockPrisma() {
  return {
    account: {
      findFirst: vi.fn(async () => baseRow()),
      findMany: vi.fn(async () => [baseRow()]),
      upsert: vi.fn(async () => baseRow()),
      update: vi.fn(async () => baseRow()),
      count: vi.fn(async () => 1),
      delete: vi.fn(async () => baseRow()),
    },
    project: {
      findMany: vi.fn(async () => [] as { id: string }[]),
    },
    post: {
      findMany: vi.fn(async () => [] as { id: string }[]),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    publishLog: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    analytics: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    postMedia: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    postContent: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    contentVersion: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    publishingQueue: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    tweet: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    thread: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    channel: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    contentTemplate: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    instagramStoryProject: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    videoProcessingJob: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    instagramAnalytics: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    schedulingRule: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    webhookEvent: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    webhookSubscription: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    template: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    apiKey: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  };
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
    it("returns ok and calls delete when account exists (even if soft-deleted)", async () => {
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const result = await repo.hardDelete(id);

      expect(result.ok).toBeTruthy();
      // Hard delete: calls the actual DB delete
      expect(prisma.account.delete.mock.calls.length).toBe(1);
    });

    it("returns err(EntityNotFoundError) when account is not found at all", async () => {
      prisma.account.findFirst.mockImplementation(async () => null);
      const id = AccountId.fromStringUnsafe("a0000000-0000-4000-8000-000000000001");
      const result = await repo.hardDelete(id);

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toMatch(/Account/);
      expect(prisma.account.delete.mock.calls.length).toBe(0);
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
