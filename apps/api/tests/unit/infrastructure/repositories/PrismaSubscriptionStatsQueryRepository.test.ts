/**
 * @file PrismaSubscriptionStatsQueryRepository.test.ts
 * @description Unit tests for the Prisma adapter of the SubscriptionStatsQueryRepository
 *              port. Stubs the Prisma client to assert the status groupBy mapping
 *              (Decimal sum→number), the account/bundle counts, the churn activity
 *              windows, and the cancellation count.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@infra/prisma", () => ({ Prisma: {} }));

const { PrismaSubscriptionStatsQueryRepository } =
  await import("../../../../src/infrastructure/repositories/PrismaSubscriptionStatsQueryRepository.js");

interface MockPrisma {
  accountSubscription: {
    groupBy: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  account: { count: ReturnType<typeof vi.fn> };
  post: { findMany: ReturnType<typeof vi.fn> };
  auditLog: { count: ReturnType<typeof vi.fn> };
}

function makePrisma(): MockPrisma {
  return {
    accountSubscription: { groupBy: vi.fn(), count: vi.fn() },
    account: { count: vi.fn() },
    post: { findMany: vi.fn() },
    auditLog: { count: vi.fn() },
  };
}

describe("PrismaSubscriptionStatsQueryRepository", () => {
  let prisma: MockPrisma;
  let repo: InstanceType<typeof PrismaSubscriptionStatsQueryRepository>;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new PrismaSubscriptionStatsQueryRepository(prisma as never);
  });

  it("groupByStatus maps count and coerces the summed Decimal price", async () => {
    prisma.accountSubscription.groupBy.mockResolvedValue([
      { status: "ACTIVE", _count: { id: 3 }, _sum: { pricePerMonth: 59.97 } },
      { status: "CANCELED", _count: { id: 1 }, _sum: { pricePerMonth: null } },
    ]);
    const groups = await repo.groupByStatus();
    expect(groups[0]).toEqual({ status: "ACTIVE", count: 3, pricePerMonthSum: 59.97 });
    expect(groups[1]).toEqual({ status: "CANCELED", count: 1, pricePerMonthSum: 0 });
  });

  it("countAccounts / countAccountsCreatedSince / countBundleSubscriptions return counts", async () => {
    prisma.account.count.mockResolvedValue(42);
    expect(await repo.countAccounts()).toBe(42);
    prisma.account.count.mockResolvedValue(5);
    expect(await repo.countAccountsCreatedSince(new Date("2026-01-01"))).toBe(5);
    prisma.accountSubscription.count.mockResolvedValue(8);
    expect(await repo.countBundleSubscriptions()).toBe(8);
    expect(prisma.accountSubscription.count).toHaveBeenCalledWith({
      where: { bundleId: { not: null } },
    });
  });

  it("getChurnActivityWindows returns distinct account ids per window", async () => {
    prisma.post.findMany
      .mockResolvedValueOnce([{ project: { accountId: "a1" } }, { project: { accountId: "a2" } }])
      .mockResolvedValueOnce([{ project: { accountId: "a3" } }]);
    const windows = await repo.getChurnActivityWindows(
      new Date("2026-05-01"),
      new Date("2026-04-15")
    );
    expect(windows.activeAccountIds).toEqual(["a1", "a2"]);
    expect(windows.moderateAccountIds).toEqual(["a3"]);
  });

  it("countCancellationsSince filters audit logs by CANCEL action", async () => {
    prisma.auditLog.count.mockResolvedValue(2);
    const count = await repo.countCancellationsSince(new Date("2026-04-01"));
    expect(count).toBe(2);
    const where = prisma.auditLog.count.mock.calls[0]?.[0]?.where;
    expect(where.action).toEqual({ contains: "CANCEL" });
  });
});
