/**
 * @file trialManagementService.test.ts
 * @description Unit tests for TrialManagementService with its ports mocked. Trial
 *              mutations load the Account aggregate, call a domain method, and
 *              persist via AccountRepository; reads use the account + subscription
 *              query repos. Replaces the trial portion of the retired facade test.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@infra/prisma", () => ({ prisma: { auditLog: { create: vi.fn() } }, Prisma: {} }));

const { TrialManagementService } = await import("@core/billing/TrialManagementService.js");

function makeAccountDto(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: "acc-1",
    email: "a@e.com",
    name: "Acme",
    maxProjects: 5,
    isOnTrial: false,
    trialStartDate: now,
    trialEndDate: null,
    autoRenewal: false,
    billingCycle: "monthly",
    nextBillingDate: null,
    lastBillingDate: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    createdAt: now,
    updatedAt: now,
    projects: [],
    ...overrides,
  };
}

function makeAggregate() {
  return {
    startTrial: vi.fn(),
    endTrial: vi.fn(),
    convertTrialToPaid: vi.fn(),
    recordRenewal: vi.fn(),
  };
}

function makeDeps() {
  const aggregate = makeAggregate();
  return {
    aggregate,
    accountRepository: {
      findById: vi.fn().mockResolvedValue({ ok: true, value: aggregate }),
      save: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    },
    accountQueryRepo: {
      findWithProjects: vi.fn().mockResolvedValue({ ok: true, value: makeAccountDto() }),
      findExpiringTrials: vi.fn().mockResolvedValue([]),
      findAutoRenewableExpired: vi.fn().mockResolvedValue([]),
      getTrialStatsCounts: vi.fn().mockResolvedValue({
        totalTrials: 8,
        activeTrials: 5,
        expiredTrials: 3,
        converted: 2,
        startedThisMonth: 4,
      }),
    },
    subscriptionQueryRepo: {
      getDetailByAccountId: vi.fn().mockResolvedValue(null),
      getTrialStatusByAccountId: vi.fn().mockResolvedValue(null),
    },
    subscriptionPlanService: {
      calculateTrialInfo: vi.fn().mockReturnValue({
        isOnTrial: false,
        trialStartDate: new Date(),
        trialEndDate: null,
        trialDaysRemaining: 0,
        trialExpired: false,
      }),
      getAccountPlan: vi.fn().mockResolvedValue({ pricePerMonth: 10 }),
    },
    billingService: {
      calculateNextBillingDate: vi.fn().mockReturnValue(new Date("2026-08-01")),
      logBillingEvent: vi.fn().mockResolvedValue(undefined),
    },
    auditEmitter: { emit: vi.fn().mockResolvedValue(undefined) },
  };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new TrialManagementService(
    deps.accountRepository as never,
    deps.accountQueryRepo as never,
    deps.subscriptionQueryRepo as never,
    deps.subscriptionPlanService as never,
    deps.billingService as never,
    deps.auditEmitter as never
  );
}

describe("TrialManagementService", () => {
  let deps: ReturnType<typeof makeDeps>;
  let service: InstanceType<typeof TrialManagementService>;

  beforeEach(() => {
    deps = makeDeps();
    service = makeService(deps);
  });

  it("startTrial loads the aggregate, applies startTrial, and persists", async () => {
    const result = await service.startTrial({ accountId: "acc-1" });
    expect(result.ok).toBe(true);
    expect(deps.aggregate.startTrial).toHaveBeenCalledOnce();
    expect(deps.accountRepository.save).toHaveBeenCalledWith(deps.aggregate);
    expect(deps.billingService.logBillingEvent).toHaveBeenCalled();
  });

  it("startTrial rejects when already on trial", async () => {
    deps.subscriptionPlanService.calculateTrialInfo.mockReturnValue({
      isOnTrial: true,
      trialStartDate: new Date(),
      trialEndDate: new Date(Date.now() + 86400000),
      trialDaysRemaining: 1,
      trialExpired: false,
    });
    const result = await service.startTrial({ accountId: "acc-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CONFLICT");
    expect(deps.aggregate.startTrial).not.toHaveBeenCalled();
  });

  it("startTrial returns NOT_FOUND when the account is missing", async () => {
    deps.accountQueryRepo.findWithProjects.mockResolvedValue({ ok: false, error: "NOT_FOUND" });
    const result = await service.startTrial({ accountId: "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("endTrial applies endTrial on an account currently on trial", async () => {
    deps.accountQueryRepo.findWithProjects.mockResolvedValue({
      ok: true,
      value: makeAccountDto({ isOnTrial: true }),
    });
    const result = await service.endTrial("acc-1", "manual");
    expect(result.ok).toBe(true);
    expect(deps.aggregate.endTrial).toHaveBeenCalledOnce();
    expect(deps.accountRepository.save).toHaveBeenCalled();
  });

  it("endTrial rejects when the account is not on trial", async () => {
    deps.accountQueryRepo.findWithProjects.mockResolvedValue({
      ok: true,
      value: makeAccountDto({ isOnTrial: false }),
    });
    const result = await service.endTrial("acc-1", "manual");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_FAILED");
    expect(deps.aggregate.endTrial).not.toHaveBeenCalled();
  });

  it("convertTrialToPaid converts an on-trial account", async () => {
    deps.accountQueryRepo.findWithProjects.mockResolvedValue({
      ok: true,
      value: makeAccountDto({ isOnTrial: true }),
    });
    const result = await service.convertTrialToPaid("acc-1", "yearly");
    expect(result.ok).toBe(true);
    expect(deps.aggregate.convertTrialToPaid).toHaveBeenCalledOnce();
  });

  it("processAutoRenewals renews each expired account and writes a batch audit", async () => {
    deps.accountQueryRepo.findAutoRenewableExpired.mockResolvedValue([
      makeAccountDto({ id: "acc-1", isOnTrial: true, autoRenewal: true }),
    ]);
    const result = await service.processAutoRenewals("admin-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.processed).toBe(1);
    expect(deps.aggregate.recordRenewal).toHaveBeenCalledOnce();
    expect(deps.auditEmitter.emit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "AUTO_RENEWAL_BATCH", success: true })
    );
  });

  it("getTrialStats maps the aggregate counts and computes the conversion rate", async () => {
    const stats = await service.getTrialStats();
    expect(stats.totalTrials).toBe(8);
    expect(stats.convertedTrials).toBe(2);
    // converted / (total + converted) = 2 / 10 = 20%
    expect(stats.conversionRate).toBe(20);
  });
});
