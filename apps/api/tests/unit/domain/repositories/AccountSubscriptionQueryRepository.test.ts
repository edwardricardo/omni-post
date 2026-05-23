/**
 * @file AccountSubscriptionQueryRepository.test.ts
 * @description Contract tests for the AccountSubscription read port. Exercises an
 *              in-memory reference implementation against the semantics every
 *              adapter must honour: detail lookup, max-projects, trial status,
 *              and filtered pagination.
 * @layer infrastructure
 */
import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type {
  AccountSubscriptionQueryRepository,
  AccountSubscriptionDetailDto,
  AccountSubscriptionListFilters,
  AccountSubscriptionListResult,
  SubscriptionBundleSummaryDto,
  SubscriptionTrialStatusDto,
} from "../../../../src/domain/repositories/AccountSubscriptionQueryRepository.js";

class InMemoryRepo implements AccountSubscriptionQueryRepository {
  constructor(private readonly subs: AccountSubscriptionDetailDto[]) {}

  async getDetailByAccountId(accountId: string): Promise<AccountSubscriptionDetailDto | null> {
    return this.subs.find((s) => s.accountId === accountId) ?? null;
  }

  async list(
    filters: AccountSubscriptionListFilters,
    page: number,
    limit: number
  ): Promise<AccountSubscriptionListResult> {
    let rows = this.subs;
    if (filters.status) rows = rows.filter((s) => s.status === filters.status);
    if (filters.planType === "bundle") rows = rows.filter((s) => s.bundleId !== null);
    if (filters.planType === "custom") rows = rows.filter((s) => s.bundleId === null);
    const start = (page - 1) * limit;
    return { subscriptions: rows.slice(start, start + limit), total: rows.length };
  }

  async getMaxProjects(accountId: string): Promise<number | null> {
    return this.subs.find((s) => s.accountId === accountId)?.maxProjects ?? null;
  }

  async listBundles(): Promise<SubscriptionBundleSummaryDto[]> {
    return this.subs
      .map((s) => s.bundle)
      .filter((b): b is SubscriptionBundleSummaryDto => b !== null);
  }

  async getTrialStatusByAccountId(accountId: string): Promise<SubscriptionTrialStatusDto | null> {
    const sub = this.subs.find((s) => s.accountId === accountId);
    if (!sub) return null;
    return {
      isTrialing: sub.status === "TRIALING",
      trialEndsAt: sub.trialEndsAt,
      daysRemaining: sub.trialEndsAt
        ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - Date.now()) / 86400000))
        : 0,
      status: sub.status,
    };
  }
}

const detail = (
  overrides?: Partial<AccountSubscriptionDetailDto>
): AccountSubscriptionDetailDto => ({
  id: "sub-1",
  accountId: "acc-1",
  bundleId: "bundle-1",
  providers: ["X"],
  maxProjects: 5,
  pricePerMonth: 19.99,
  status: "ACTIVE",
  billingCycle: "MONTHLY",
  trialEndsAt: null,
  currentPeriodEnd: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  bundle: null,
  account: { id: "acc-1", name: "Acme", email: "a@e.com" },
  ...overrides,
});

describe("AccountSubscriptionQueryRepository contract", () => {
  let repo: InMemoryRepo;
  beforeEach(() => {
    repo = new InMemoryRepo([
      detail(),
      detail({ id: "sub-2", accountId: "acc-2", bundleId: null, status: "CANCELED" }),
    ]);
  });

  it("returns subscription detail by account id, or null", async () => {
    assert.strictEqual((await repo.getDetailByAccountId("acc-1"))?.id, "sub-1");
    assert.strictEqual(await repo.getDetailByAccountId("nope"), null);
  });

  it("returns maxProjects or null", async () => {
    assert.strictEqual(await repo.getMaxProjects("acc-1"), 5);
    assert.strictEqual(await repo.getMaxProjects("nope"), null);
  });

  it("filters list by status and paginates with a total", async () => {
    const result = await repo.list({ status: "ACTIVE" }, 1, 10);
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.subscriptions[0]?.accountId, "acc-1");
  });

  it("filters list by custom plan type (no bundle)", async () => {
    const result = await repo.list({ planType: "custom" }, 1, 10);
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.subscriptions[0]?.accountId, "acc-2");
  });

  it("derives trial status, returning null for unknown accounts", async () => {
    const trial = await repo.getTrialStatusByAccountId("acc-1");
    assert.strictEqual(trial?.isTrialing, false);
    assert.strictEqual(await repo.getTrialStatusByAccountId("nope"), null);
  });
});
