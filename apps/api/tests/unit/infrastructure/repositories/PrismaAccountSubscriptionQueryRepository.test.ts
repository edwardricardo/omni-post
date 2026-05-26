/**
 * @file PrismaAccountSubscriptionQueryRepository.test.ts
 * @description Unit tests for the Prisma adapter of the AccountSubscriptionQueryRepository
 *              port. Stubs the Prisma client to assert row → DTO mapping, the
 *              Decimal→number coercion for money fields, and null handling.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@infra/prisma", () => ({ Prisma: {} }));

const { PrismaAccountSubscriptionQueryRepository } =
  await import("../../../../src/infrastructure/repositories/PrismaAccountSubscriptionQueryRepository.js");

function makeSubRow(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-01-01T00:00:00Z");
  return {
    id: "sub-1",
    accountId: "acc-1",
    bundleId: "bundle-1",
    providers: ["X", "INSTAGRAM"],
    maxProjects: 5,
    pricePerMonth: 19.99,
    status: "ACTIVE",
    billingCycle: "MONTHLY",
    trialEndsAt: null,
    currentPeriodEnd: null,
    createdAt: now,
    updatedAt: now,
    bundle: {
      id: "bundle-1",
      name: "Pro",
      slug: "pro",
      description: "Pro bundle",
      providers: ["X"],
      pricePerAccountMonth: 49.99,
      isActive: true,
      sortOrder: 1,
      maxPostsPerMonth: 100,
      maxChannels: 10,
    },
    account: { id: "acc-1", name: "Acme", email: "acme@example.com" },
    ...overrides,
  };
}

interface MockPrisma {
  accountSubscription: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  providerBundle: { findMany: ReturnType<typeof vi.fn> };
}

function makePrisma(): MockPrisma {
  return {
    accountSubscription: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    providerBundle: { findMany: vi.fn() },
  };
}

describe("PrismaAccountSubscriptionQueryRepository", () => {
  let prisma: MockPrisma;
  let repo: InstanceType<typeof PrismaAccountSubscriptionQueryRepository>;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new PrismaAccountSubscriptionQueryRepository(prisma as never);
  });

  it("getDetailByAccountId maps the row, coercing money Decimals to numbers", async () => {
    prisma.accountSubscription.findUnique.mockResolvedValue(makeSubRow());
    const dto = await repo.getDetailByAccountId("acc-1");
    expect(dto?.pricePerMonth).toBe(19.99);
    expect(typeof dto?.pricePerMonth).toBe("number");
    expect(dto?.bundle?.pricePerAccountMonth).toBe(49.99);
    expect(dto?.account.email).toBe("acme@example.com");
    expect(dto?.providers).toEqual(["X", "INSTAGRAM"]);
  });

  it("getDetailByAccountId returns null when no subscription exists", async () => {
    prisma.accountSubscription.findUnique.mockResolvedValue(null);
    expect(await repo.getDetailByAccountId("acc-x")).toBeNull();
  });

  it("getMaxProjects returns the number or null", async () => {
    prisma.accountSubscription.findUnique.mockResolvedValue({ maxProjects: 7 });
    expect(await repo.getMaxProjects("acc-1")).toBe(7);
    prisma.accountSubscription.findUnique.mockResolvedValue(null);
    expect(await repo.getMaxProjects("acc-x")).toBeNull();
  });

  it("getTrialStatusByAccountId derives trialing state and remaining days", async () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    prisma.accountSubscription.findUnique.mockResolvedValue({
      status: "TRIALING",
      trialEndsAt: future,
    });
    const status = await repo.getTrialStatusByAccountId("acc-1");
    expect(status?.isTrialing).toBe(true);
    expect(status?.daysRemaining).toBeGreaterThan(0);
    prisma.accountSubscription.findUnique.mockResolvedValue(null);
    expect(await repo.getTrialStatusByAccountId("acc-x")).toBeNull();
  });

  it("list applies the status filter and returns items + total", async () => {
    prisma.accountSubscription.findMany.mockResolvedValue([makeSubRow()]);
    prisma.accountSubscription.count.mockResolvedValue(1);
    const result = await repo.list({ status: "ACTIVE" }, 1, 50);
    expect(result.total).toBe(1);
    expect(result.subscriptions[0]?.pricePerMonth).toBe(19.99);
    const where = prisma.accountSubscription.findMany.mock.calls[0]?.[0]?.where;
    expect(where.status).toBe("ACTIVE");
  });

  it("listBundles maps active bundles coercing the Decimal price", async () => {
    prisma.providerBundle.findMany.mockResolvedValue([makeSubRow().bundle]);
    const bundles = await repo.listBundles();
    expect(bundles[0]?.pricePerAccountMonth).toBe(49.99);
  });
});
