/**
 * @file subscriptionPlanService.test.ts
 * @description Unit tests for SubscriptionPlanService — trial info calculations.
 *   Tests for removed methods (getSubscriptionPlan, getAllPlans, validateUpgrade,
 *   validateDowngrade) and the SUBSCRIPTION_PLANS constant were deleted because
 *   those were removed in the billing modernization sprint.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { AccountSubscriptionQueryRepository } from "@core/domain/repositories/AccountSubscriptionQueryRepository.js";
import { SubscriptionPlanService } from "@core/billing/SubscriptionPlanService.js";

describe("SubscriptionPlanService", () => {
  let service: SubscriptionPlanService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SubscriptionPlanService({} as unknown as AccountSubscriptionQueryRepository);
  });

  // =========================================================================
  // calculateTrialInfo
  // =========================================================================

  describe("calculateTrialInfo", () => {
    it("returns isOnTrial=true when trial is active and not expired", () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days ahead
      const account = {
        isOnTrial: true,
        trialStartDate: new Date(),
        trialEndDate: futureDate,
      } as any;

      const result = service.calculateTrialInfo(account);
      assert.equal(result.isOnTrial, true);
      assert.equal(result.trialExpired, false);
      assert.ok(result.trialDaysRemaining > 0);
      assert.ok(result.trialDaysRemaining <= 7);
    });

    it("returns isOnTrial=false when trial has expired", () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
      const account = {
        isOnTrial: true,
        trialStartDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
        trialEndDate: pastDate,
      } as any;

      const result = service.calculateTrialInfo(account);
      assert.equal(result.isOnTrial, false);
      assert.equal(result.trialExpired, true);
      assert.equal(result.trialDaysRemaining, 0);
    });

    it("returns isOnTrial=false when not on trial", () => {
      const account = {
        isOnTrial: false,
        trialStartDate: null,
        trialEndDate: null,
      } as any;

      const result = service.calculateTrialInfo(account);
      assert.equal(result.isOnTrial, false);
      assert.equal(result.trialExpired, false);
      assert.equal(result.trialDaysRemaining, 0);
    });

    it("returns correct days remaining for trial ending in 3 days", () => {
      const endDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      const account = {
        isOnTrial: true,
        trialStartDate: new Date(),
        trialEndDate: endDate,
      } as any;

      const result = service.calculateTrialInfo(account);
      assert.ok(result.trialDaysRemaining >= 2 && result.trialDaysRemaining <= 3);
    });

    it("returns trialDaysRemaining=0 when trial expired", () => {
      const pastDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const account = {
        isOnTrial: true,
        trialStartDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        trialEndDate: pastDate,
      } as any;

      const result = service.calculateTrialInfo(account);
      assert.equal(result.trialDaysRemaining, 0);
    });

    it("includes trialStartDate and trialEndDate in result", () => {
      const start = new Date("2025-01-01");
      const end = new Date("2026-01-01");
      const account = {
        isOnTrial: true,
        trialStartDate: start,
        trialEndDate: end,
      } as any;

      const result = service.calculateTrialInfo(account);
      assert.equal(result.trialStartDate, start);
      assert.equal(result.trialEndDate, end);
    });
  });
});
