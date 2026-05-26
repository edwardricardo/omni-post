/**
 * @file subscriptionManagementService.test.ts
 * @description Unit tests for SubscriptionManagementService with its repository
 *              ports mocked: provider-subscription reads, subscription-limit
 *              validation (project / team / media), and suspension (cancel +
 *              billing event). Replaces the retired facade+prisma-store test.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryAuditEmitter } from "./helpers/InMemoryAuditEmitter.js";

vi.mock("@infra/prisma", () => ({ prisma: { auditLog: { create: vi.fn() } }, Prisma: {} }));

const { SubscriptionManagementService } =
  await import("../../src/billing/subscription/SubscriptionManagementService.js");

function makeDeps() {
  return {
    accountQueryRepo: {
      findById: vi.fn().mockResolvedValue({ ok: true, value: { email: "a@e.com" } }),
    },
    subscriptionQueryRepo: {
      getDetailByAccountId: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue({ subscriptions: [], total: 0 }),
      getMaxProjects: vi.fn().mockResolvedValue(5),
    },
    subscriptionPort: { cancelByAccountId: vi.fn().mockResolvedValue(undefined) },
    projectQueryRepo: {
      countByAccountId: vi.fn().mockResolvedValue(2),
      getMediaCountsByAccount: vi.fn().mockResolvedValue([{ type: "image", count: 10 }]),
    },
    billingService: { logBillingEvent: vi.fn().mockResolvedValue(undefined) },
  };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new SubscriptionManagementService(
    deps.accountQueryRepo as never,
    deps.subscriptionQueryRepo as never,
    deps.subscriptionPort as never,
    deps.projectQueryRepo as never,
    deps.billingService as never,
    new InMemoryAuditEmitter()
  );
}

describe("SubscriptionManagementService", () => {
  let deps: ReturnType<typeof makeDeps>;
  let service: InstanceType<typeof SubscriptionManagementService>;

  beforeEach(() => {
    deps = makeDeps();
    service = makeService(deps);
  });

  it("getProviderSubscription reads via the subscription query repo", async () => {
    await service.getProviderSubscription("acc-1");
    expect(deps.subscriptionQueryRepo.getDetailByAccountId).toHaveBeenCalledWith("acc-1");
  });

  it("validateSubscriptionLimits CREATE_PROJECT allows within the limit", async () => {
    deps.subscriptionQueryRepo.getMaxProjects.mockResolvedValue(5);
    deps.projectQueryRepo.countByAccountId.mockResolvedValue(2);
    const result = await service.validateSubscriptionLimits("acc-1", "CREATE_PROJECT");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.allowed).toBe(true);
      expect(result.value.limit).toBe(5);
      expect(result.value.remaining).toBe(3);
    }
  });

  it("validateSubscriptionLimits returns NOT_FOUND when no subscription exists", async () => {
    deps.subscriptionQueryRepo.getMaxProjects.mockResolvedValue(null);
    const result = await service.validateSubscriptionLimits("acc-x", "CREATE_PROJECT");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("validateSubscriptionLimits UPLOAD_MEDIA estimates storage from media counts", async () => {
    deps.subscriptionQueryRepo.getMaxProjects.mockResolvedValue(5);
    deps.projectQueryRepo.getMediaCountsByAccount.mockResolvedValue([
      { type: "video", count: 100 },
    ]);
    const result = await service.validateSubscriptionLimits("acc-1", "UPLOAD_MEDIA");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(deps.projectQueryRepo.getMediaCountsByAccount).toHaveBeenCalledWith("acc-1");
      expect(result.value.limit).toBe(50); // maxProjects(5) * 10
    }
  });

  it("suspendSubscription cancels the subscription and logs a billing event", async () => {
    const result = await service.suspendSubscription("acc-1", "fraud", "admin-1");
    expect(result.ok).toBe(true);
    expect(deps.subscriptionPort.cancelByAccountId).toHaveBeenCalledWith("acc-1");
    expect(deps.billingService.logBillingEvent).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "acc-1", type: "SUSPENSION", reason: "fraud" })
    );
  });

  it("suspendSubscription returns NOT_FOUND for an unknown account", async () => {
    deps.accountQueryRepo.findById.mockResolvedValue({ ok: false, error: "NOT_FOUND" });
    const result = await service.suspendSubscription("acc-x", "fraud");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    expect(deps.subscriptionPort.cancelByAccountId).not.toHaveBeenCalled();
  });
});
