/**
 * @file SubscriptionPlanService.calculateTrialInfo.test.ts
 * @description Unit tests for the pure synchronous calculateTrialInfo method in
 *   SubscriptionPlanService — trial active/expired status, days remaining calculation,
 *   and edge cases (null trial dates, same-day expiry).
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { SubscriptionPlanService } from "../../src/SubscriptionPlanService.js";
import type { AccountSubscriptionQueryRepository } from "@core/domain/repositories/AccountSubscriptionQueryRepository.js";

/**
 * A stub repo — calculateTrialInfo is synchronous and does not call the repo,
 * but the constructor requires it so we provide a minimal no-op stub.
 */
function makeStubRepo(): AccountSubscriptionQueryRepository {
  return {
    getDetailByAccountId: vi.fn(),
    listBundles: vi.fn(),
  } as unknown as AccountSubscriptionQueryRepository;
}

describe("SubscriptionPlanService.calculateTrialInfo", () => {
  let service: SubscriptionPlanService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SubscriptionPlanService(makeStubRepo());
  });

  describe("active trial", () => {
    it("returns isOnTrial true when account is on trial and end date is in the future", () => {
      const trialEndDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days ahead
      const result = service.calculateTrialInfo({
        isOnTrial: true,
        trialStartDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        trialEndDate,
      });
      assert.ok(result.isOnTrial);
      assert.ok(!result.trialExpired);
      assert.ok(result.trialDaysRemaining > 0);
    });

    it("returns trialDaysRemaining close to the number of days left", () => {
      const trialEndDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // ~10 days
      const result = service.calculateTrialInfo({
        isOnTrial: true,
        trialStartDate: null,
        trialEndDate,
      });
      // Allow ±1 day for clock skew during test execution
      assert.ok(result.trialDaysRemaining >= 9 && result.trialDaysRemaining <= 11);
    });
  });

  describe("expired trial", () => {
    it("returns isOnTrial false and trialExpired true when trial end date has passed", () => {
      const trialEndDate = new Date(Date.now() - 1000); // 1 second ago
      const result = service.calculateTrialInfo({
        isOnTrial: true,
        trialStartDate: null,
        trialEndDate,
      });
      assert.ok(!result.isOnTrial);
      assert.ok(result.trialExpired);
      assert.strictEqual(result.trialDaysRemaining, 0);
    });

    it("returns trialDaysRemaining 0 (not negative) when trial is expired", () => {
      const trialEndDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
      const result = service.calculateTrialInfo({
        isOnTrial: true,
        trialStartDate: null,
        trialEndDate,
      });
      assert.strictEqual(result.trialDaysRemaining, 0);
    });
  });

  describe("no trial dates", () => {
    it("returns isOnTrial false when isOnTrial flag is false regardless of dates", () => {
      const result = service.calculateTrialInfo({
        isOnTrial: false,
        trialStartDate: null,
        trialEndDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      });
      assert.ok(!result.isOnTrial);
    });

    it("returns trialDaysRemaining 0 and trialExpired false when trialEndDate is null", () => {
      const result = service.calculateTrialInfo({
        isOnTrial: false,
        trialStartDate: null,
        trialEndDate: null,
      });
      assert.strictEqual(result.trialDaysRemaining, 0);
      assert.ok(!result.trialExpired);
    });

    it("preserves the original trialStartDate in the output", () => {
      const start = new Date("2024-01-01T00:00:00Z");
      const end = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const result = service.calculateTrialInfo({
        isOnTrial: true,
        trialStartDate: start,
        trialEndDate: end,
      });
      assert.deepStrictEqual(result.trialStartDate, start);
    });
  });
});
