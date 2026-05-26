/**
 * @file SubscriptionService.test.ts
 * @description Unit tests for the SubscriptionService facade. Verifies it delegates
 *              each operation to the injected collaborator service with the right
 *              arguments (including the auto-renewal actor and the trial stats).
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubscriptionService } from "../../../../src/billing/subscription/SubscriptionService.js";

function makeDeps() {
  return {
    plans: { getAllPlansFromDB: vi.fn().mockResolvedValue([]) },
    management: {
      getProviderSubscription: vi.fn().mockResolvedValue(null),
      listProviderSubscriptions: vi.fn().mockResolvedValue({ subscriptions: [], total: 0 }),
      validateSubscriptionLimits: vi.fn(),
      suspendSubscription: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    },
    trials: {
      startTrial: vi.fn(),
      endTrial: vi.fn(),
      processAutoRenewals: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { processed: 0, failed: 0, details: [] } }),
      getExpiringTrials: vi.fn(),
      convertTrialToPaid: vi.fn(),
      getTrialStats: vi.fn().mockResolvedValue({ totalTrials: 1 }),
    },
    stats: { getSubscriptionStats: vi.fn() },
    billing: { logBillingEvent: vi.fn().mockResolvedValue(undefined) },
  };
}

describe("SubscriptionService facade", () => {
  let deps: ReturnType<typeof makeDeps>;
  let service: SubscriptionService;

  beforeEach(() => {
    deps = makeDeps();
    service = new SubscriptionService(
      deps.plans as never,
      deps.management as never,
      deps.trials as never,
      deps.stats as never,
      deps.billing as never
    );
  });

  it("delegates getProviderSubscription to the management service", async () => {
    await service.getProviderSubscription("acc-1");
    expect(deps.management.getProviderSubscription).toHaveBeenCalledWith("acc-1");
  });

  it("delegates suspendSubscription with the actor id", async () => {
    await service.suspendSubscription("acc-1", "fraud", "admin-1");
    expect(deps.management.suspendSubscription).toHaveBeenCalledWith("acc-1", "fraud", "admin-1");
  });

  it("forwards the auto-renewal actor to the trial service", async () => {
    await service.processAutoRenewals("admin-9");
    expect(deps.trials.processAutoRenewals).toHaveBeenCalledWith("admin-9");
  });

  it("delegates getTrialStats to the trial service", async () => {
    const stats = await service.getTrialStats();
    expect(deps.trials.getTrialStats).toHaveBeenCalled();
    expect(stats.totalTrials).toBe(1);
  });

  it("delegates logBillingEvent to the billing service", async () => {
    const event = { accountId: "acc-1", type: "SUSPENSION", currency: "USD", reason: "x" } as never;
    await service.logBillingEvent(event);
    expect(deps.billing.logBillingEvent).toHaveBeenCalledWith(event);
  });
});
