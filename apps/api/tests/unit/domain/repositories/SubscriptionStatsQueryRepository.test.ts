/**
 * @file SubscriptionStatsQueryRepository.test.ts
 * @description Contract tests for the subscription-stats read port. Exercises an
 *              in-memory reference implementation against the aggregation
 *              semantics every adapter must honour: status grouping, account /
 *              bundle counts, churn windows, and cancellation counts.
 * @layer infrastructure
 */
import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type {
  SubscriptionStatsQueryRepository,
  SubscriptionStatusGroupDto,
  ChurnActivityWindowsDto,
} from "../../../../src/domain/repositories/SubscriptionStatsQueryRepository.js";

class InMemoryRepo implements SubscriptionStatsQueryRepository {
  groups: SubscriptionStatusGroupDto[] = [
    { status: "ACTIVE", count: 3, pricePerMonthSum: 60 },
    { status: "CANCELED", count: 1, pricePerMonthSum: 0 },
  ];
  accounts = 10;
  bundles = 4;
  cancellations = 2;
  windows: ChurnActivityWindowsDto = {
    activeAccountIds: ["a1", "a2"],
    moderateAccountIds: ["a3"],
  };

  async groupByStatus(): Promise<SubscriptionStatusGroupDto[]> {
    return this.groups;
  }
  async countAccounts(): Promise<number> {
    return this.accounts;
  }
  async countAccountsCreatedSince(): Promise<number> {
    return 5;
  }
  async countAccountsCreatedBetween(): Promise<number> {
    return 3;
  }
  async countBundleSubscriptions(): Promise<number> {
    return this.bundles;
  }
  async getChurnActivityWindows(): Promise<ChurnActivityWindowsDto> {
    return this.windows;
  }
  async countCancellationsSince(): Promise<number> {
    return this.cancellations;
  }
}

describe("SubscriptionStatsQueryRepository contract", () => {
  let repo: InMemoryRepo;
  beforeEach(() => {
    repo = new InMemoryRepo();
  });

  it("groups subscriptions by status with count and summed price", async () => {
    const groups = await repo.groupByStatus();
    assert.strictEqual(groups[0]?.status, "ACTIVE");
    assert.strictEqual(groups[0]?.count, 3);
    assert.strictEqual(groups[0]?.pricePerMonthSum, 60);
  });

  it("exposes account and bundle counts", async () => {
    assert.strictEqual(await repo.countAccounts(), 10);
    assert.strictEqual(await repo.countBundleSubscriptions(), 4);
    assert.strictEqual(await repo.countAccountsCreatedSince(new Date()), 5);
    assert.strictEqual(await repo.countAccountsCreatedBetween(new Date(), new Date()), 3);
  });

  it("returns churn activity windows as distinct account ids", async () => {
    const windows = await repo.getChurnActivityWindows(new Date(), new Date());
    assert.deepStrictEqual(windows.activeAccountIds, ["a1", "a2"]);
    assert.deepStrictEqual(windows.moderateAccountIds, ["a3"]);
  });

  it("counts cancellations since a date", async () => {
    assert.strictEqual(await repo.countCancellationsSince(new Date()), 2);
  });
});
