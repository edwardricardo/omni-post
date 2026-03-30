/**
 * @file updatePricingConfig.test.ts
 * @description Unit tests for UpdatePricingConfigUseCase (grandfathering).
 * @layer test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { UpdatePricingConfigUseCase } from "../../../src/application/billing/UpdatePricingConfigUseCase.js";

function makeMockRepo(
  affected: Array<{ id: string; pricePerMonth: number }> = [
    { id: "sub-1", pricePerMonth: 30 },
    { id: "sub-2", pricePerMonth: 30 },
  ]
) {
  return {
    updateEntity: vi.fn().mockResolvedValue(undefined),
    findAffectedSubscriptions: vi.fn().mockResolvedValue(affected),
    setSubscriptionStatus: vi.fn().mockResolvedValue(undefined),
    createPriceHistory: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockDispatcher() {
  return {
    dispatch: vi.fn().mockResolvedValue(undefined),
  };
}

const baseInput = {
  adminRole: "SUPER_ADMIN",
  entityType: "provider_tier" as const,
  entityId: "tier-1",
  field: "pricePerProviderMonth",
  newValue: 15,
  notificationWindowDays: 60,
};

describe("UpdatePricingConfigUseCase", () => {
  let repo: ReturnType<typeof makeMockRepo>;
  let dispatcher: ReturnType<typeof makeMockDispatcher>;
  let useCase: UpdatePricingConfigUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockRepo();
    dispatcher = makeMockDispatcher();
    useCase = new UpdatePricingConfigUseCase(repo, dispatcher);
  });

  it("succeeds when caller is SUPER_ADMIN", async () => {
    const result = await useCase.execute(baseInput);
    assert.ok(result.ok);
  });

  it("fails when caller is not SUPER_ADMIN", async () => {
    const result = await useCase.execute({ ...baseInput, adminRole: "ADMIN" });
    assert.ok(!result.ok);
    assert.ok(result.error.message.includes("SUPER_ADMIN"));
  });

  it("creates SubscriptionPriceHistory for each affected subscription", async () => {
    await useCase.execute(baseInput);
    expect(repo.createPriceHistory).toHaveBeenCalledTimes(2);

    const call1 = repo.createPriceHistory.mock.calls[0]?.[0] as Record<string, unknown>;
    assert.strictEqual(call1.subscriptionId, "sub-1");
    assert.strictEqual(call1.previousPrice, 30);
    assert.strictEqual(call1.newPrice, 15);
    assert.strictEqual(call1.reason, "price_update");
  });

  it("sets affected subscriptions to GRANDFATHERED", async () => {
    await useCase.execute(baseInput);
    expect(repo.setSubscriptionStatus).toHaveBeenCalledTimes(2);
    expect(repo.setSubscriptionStatus).toHaveBeenCalledWith("sub-1", "GRANDFATHERED");
    expect(repo.setSubscriptionStatus).toHaveBeenCalledWith("sub-2", "GRANDFATHERED");
  });

  it("does NOT affect subscriptions on other tiers (0 affected)", async () => {
    repo = makeMockRepo([]);
    useCase = new UpdatePricingConfigUseCase(repo, dispatcher);

    const result = await useCase.execute(baseInput);

    assert.ok(result.ok);
    assert.strictEqual(result.value.affectedSubscriptions, 0);
    expect(repo.createPriceHistory).not.toHaveBeenCalled();
    expect(repo.setSubscriptionStatus).not.toHaveBeenCalled();
  });

  it("effectiveAt is now + notificationWindowDays", async () => {
    const before = Date.now();
    const result = await useCase.execute({ ...baseInput, notificationWindowDays: 60 });
    const after = Date.now();

    assert.ok(result.ok);
    const effectiveMs = result.value.effectiveAt.getTime();
    const expectedMin = before + 60 * 24 * 60 * 60 * 1000;
    const expectedMax = after + 60 * 24 * 60 * 60 * 1000;
    assert.ok(effectiveMs >= expectedMin - 1000);
    assert.ok(effectiveMs <= expectedMax + 1000);
  });

  it("dispatches notification job for each affected subscription", async () => {
    await useCase.execute(baseInput);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(2);
  });

  it("updates the pricing entity with new value", async () => {
    await useCase.execute(baseInput);
    expect(repo.updateEntity).toHaveBeenCalledWith(
      "provider_tier",
      "tier-1",
      "pricePerProviderMonth",
      15
    );
  });

  it("returns affectedSubscriptions count", async () => {
    const result = await useCase.execute(baseInput);
    assert.ok(result.ok);
    assert.strictEqual(result.value.affectedSubscriptions, 2);
  });
});
