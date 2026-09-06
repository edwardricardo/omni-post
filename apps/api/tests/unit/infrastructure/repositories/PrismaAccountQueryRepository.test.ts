/**
 * @file PrismaAccountQueryRepository.test.ts
 * @description Unit tests pinning the soft-delete contract of the account read
 *              side. A soft-deleted account (deletedAt set) is deleted, not merely
 *              suspended: every read here must exclude it so billing (trial
 *              reminders, auto-renewal, quota, stats) and auth (login / SSO / email
 *              lookup) treat it as gone, and its email frees for re-registration
 *              (B-READS / R3-2). ID/email lookups use findFirst because deletedAt
 *              is not a unique column and cannot go in a findUnique where.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@infra/prisma", () => ({ Prisma: {} }));

const { PrismaAccountQueryRepository } =
  await import("../../../../src/infrastructure/repositories/PrismaAccountQueryRepository.js");

interface MockPrisma {
  account: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
}

function makePrisma(): MockPrisma {
  return {
    account: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  };
}

describe("PrismaAccountQueryRepository soft-delete contract", () => {
  let prisma: MockPrisma;
  let repo: InstanceType<typeof PrismaAccountQueryRepository>;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new PrismaAccountQueryRepository(prisma as never);
  });

  it("findWithProjects reads a non-deleted account via findFirst", async () => {
    prisma.account.findFirst.mockResolvedValue(null);
    const result = await repo.findWithProjects("acc-1");
    expect(result.ok).toBe(false);
    expect(prisma.account.findFirst).toHaveBeenCalledWith({
      where: { id: "acc-1", deletedAt: null },
      include: { projects: true },
    });
  });

  it("findById reads a non-deleted account via findFirst", async () => {
    prisma.account.findFirst.mockResolvedValue(null);
    await repo.findById("acc-1");
    expect(prisma.account.findFirst).toHaveBeenCalledWith({
      where: { id: "acc-1", deletedAt: null },
    });
  });

  it("findByEmail excludes soft-deleted accounts (email frees for re-registration)", async () => {
    prisma.account.findFirst.mockResolvedValue(null);
    await repo.findByEmail("USER@Example.com");
    expect(prisma.account.findFirst).toHaveBeenCalledWith({
      where: { email: "user@example.com", deletedAt: null },
    });
  });

  it("findManyWithProjects excludes soft-deleted accounts", async () => {
    prisma.account.findMany.mockResolvedValue([]);
    await repo.findManyWithProjects(["a", "b"]);
    expect(prisma.account.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b"] }, deletedAt: null },
      include: { projects: true },
    });
  });

  it("getExpiringTrials never reminds a deleted account", async () => {
    prisma.account.findMany.mockResolvedValue([]);
    await repo.getExpiringTrials(3);
    const call = prisma.account.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call.where.deletedAt).toBeNull();
    expect(call.where.isOnTrial).toBe(true);
  });

  it("findExpiringTrials excludes deleted accounts", async () => {
    prisma.account.findMany.mockResolvedValue([]);
    await repo.findExpiringTrials(new Date(), new Date());
    const call = prisma.account.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call.where.deletedAt).toBeNull();
  });

  it("findAutoRenewableExpired never auto-renews a deleted account", async () => {
    prisma.account.findMany.mockResolvedValue([]);
    await repo.findAutoRenewableExpired(new Date());
    const call = prisma.account.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call.where.deletedAt).toBeNull();
  });

  it("getTrialStatsCounts excludes deleted accounts from every count", async () => {
    prisma.account.count.mockResolvedValue(0);
    await repo.getTrialStatsCounts();
    expect(prisma.account.count.mock.calls.length).toBeGreaterThan(0);
    for (const call of prisma.account.count.mock.calls) {
      const arg = call[0] as { where: Record<string, unknown> };
      expect(arg.where.deletedAt).toBeNull();
    }
  });
});
