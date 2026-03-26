/**
 * @file subscriptionPlanService.test.ts
 * @description Mutation-killing tests for SubscriptionPlanService pure logic.
 * Covers plan lookups, tier validation, trial info, and usage calculations.
 * @layer test
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { SubscriptionPlanService } from "../../src/billing/subscription/SubscriptionPlanService.js";
import { SUBSCRIPTION_PLANS } from "../../src/billing/subscription/types.js";

describe("SubscriptionPlanService", () => {
  let service: SubscriptionPlanService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SubscriptionPlanService();
  });

  // =========================================================================
  // getSubscriptionPlan
  // =========================================================================

  describe("getSubscriptionPlan", () => {
    it("returns BASIC plan with correct details", () => {
      const plan = service.getSubscriptionPlan("BASIC");
      assert.equal(plan.tier, "BASIC");
      assert.equal(plan.name, "Basic Plan");
      assert.equal(plan.monthlyPrice, 9.99);
      assert.equal(plan.yearlyPrice, 99.99);
      assert.equal(plan.maxProjects, 1);
    });

    it("returns PRO plan with correct details", () => {
      const plan = service.getSubscriptionPlan("PRO");
      assert.equal(plan.tier, "PRO");
      assert.equal(plan.monthlyPrice, 29.99);
      assert.equal(plan.maxProjects, 5);
      assert.equal(plan.limits.teamMembers, 5);
    });

    it("returns ENTERPRISE plan with correct details", () => {
      const plan = service.getSubscriptionPlan("ENTERPRISE");
      assert.equal(plan.tier, "ENTERPRISE");
      assert.equal(plan.monthlyPrice, 99.99);
      assert.equal(plan.maxProjects, 50);
      assert.equal(plan.limits.postsPerMonth, -1); // Unlimited
    });

    it("BASIC plan has correct limits", () => {
      const plan = service.getSubscriptionPlan("BASIC");
      assert.equal(plan.limits.postsPerMonth, 100);
      assert.equal(plan.limits.mediaStorageGB, 1);
      assert.equal(plan.limits.teamMembers, 1);
      assert.equal(plan.limits.apiRequestsPerDay, 1000);
      assert.equal(plan.limits.analyticsRetentionDays, 30);
    });

    it("PRO plan has correct limits", () => {
      const plan = service.getSubscriptionPlan("PRO");
      assert.equal(plan.limits.postsPerMonth, 1000);
      assert.equal(plan.limits.mediaStorageGB, 10);
      assert.equal(plan.limits.apiRequestsPerDay, 10000);
      assert.equal(plan.limits.analyticsRetentionDays, 90);
    });

    it("ENTERPRISE plan has correct limits", () => {
      const plan = service.getSubscriptionPlan("ENTERPRISE");
      assert.equal(plan.limits.mediaStorageGB, 100);
      assert.equal(plan.limits.teamMembers, 25);
      assert.equal(plan.limits.apiRequestsPerDay, 100000);
      assert.equal(plan.limits.analyticsRetentionDays, 365);
    });
  });

  // =========================================================================
  // getAllPlans
  // =========================================================================

  describe("getAllPlans", () => {
    it("returns all 3 plans", () => {
      const plans = service.getAllPlans();
      assert.equal(plans.length, 3);
    });

    it("includes BASIC, PRO, and ENTERPRISE", () => {
      const plans = service.getAllPlans();
      const tiers = plans.map((p) => p.tier);
      expect(tiers).toContain("BASIC");
      expect(tiers).toContain("PRO");
      expect(tiers).toContain("ENTERPRISE");
    });
  });

  // =========================================================================
  // validateUpgrade
  // =========================================================================

  describe("validateUpgrade", () => {
    it("allows upgrade from FREE to STARTER", () => {
      const result = service.validateUpgrade("FREE", "STARTER");
      assert.equal(result.allowed, true);
    });

    it("allows upgrade from FREE to PRO", () => {
      const result = service.validateUpgrade("FREE", "PRO");
      assert.equal(result.allowed, true);
    });

    it("allows upgrade from FREE to ENTERPRISE", () => {
      const result = service.validateUpgrade("FREE", "ENTERPRISE");
      assert.equal(result.allowed, true);
    });

    it("allows upgrade from STARTER to PRO", () => {
      const result = service.validateUpgrade("STARTER", "PRO");
      assert.equal(result.allowed, true);
    });

    it("allows upgrade from PRO to ENTERPRISE", () => {
      const result = service.validateUpgrade("PRO", "ENTERPRISE");
      assert.equal(result.allowed, true);
    });

    it("rejects downgrade from PRO to FREE", () => {
      const result = service.validateUpgrade("PRO", "FREE");
      assert.equal(result.allowed, false);
      expect(result.reason).toContain("higher-tier");
    });

    it("rejects same tier upgrade", () => {
      const result = service.validateUpgrade("PRO", "PRO");
      assert.equal(result.allowed, false);
    });

    it("rejects downgrade from ENTERPRISE to STARTER", () => {
      const result = service.validateUpgrade("ENTERPRISE", "STARTER");
      assert.equal(result.allowed, false);
    });
  });

  // =========================================================================
  // validateDowngrade
  // =========================================================================

  describe("validateDowngrade", () => {
    it("allows downgrade from ENTERPRISE to PRO when projects fit", () => {
      const result = service.validateDowngrade("ENTERPRISE", "PRO", 3);
      assert.equal(result.allowed, true);
    });

    it("rejects upgrade disguised as downgrade (FREE to PRO)", () => {
      const result = service.validateDowngrade("FREE", "PRO", 0);
      assert.equal(result.allowed, false);
      expect(result.reason).toContain("lower-tier");
    });

    it("rejects same tier downgrade", () => {
      const result = service.validateDowngrade("PRO", "PRO", 0);
      assert.equal(result.allowed, false);
    });

    it("rejects downgrade when too many projects for target plan", () => {
      // BASIC allows 1 project, trying to downgrade with 3 projects
      const result = service.validateDowngrade("PRO", "BASIC" as any, 3);
      assert.equal(result.allowed, false);
      expect(result.reason).toContain("projects");
    });

    it("allows downgrade to BASIC with exactly 1 project", () => {
      const result = service.validateDowngrade("PRO", "BASIC" as any, 1);
      assert.equal(result.allowed, true);
    });
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

  // =========================================================================
  // SUBSCRIPTION_PLANS constant
  // =========================================================================

  describe("SUBSCRIPTION_PLANS constant", () => {
    it("has exactly 3 tiers", () => {
      assert.equal(Object.keys(SUBSCRIPTION_PLANS).length, 3);
    });

    it("BASIC is cheaper than PRO", () => {
      assert.ok(SUBSCRIPTION_PLANS.BASIC.monthlyPrice < SUBSCRIPTION_PLANS.PRO.monthlyPrice);
    });

    it("PRO is cheaper than ENTERPRISE", () => {
      assert.ok(SUBSCRIPTION_PLANS.PRO.monthlyPrice < SUBSCRIPTION_PLANS.ENTERPRISE.monthlyPrice);
    });

    it("yearly price is less than 12x monthly for each plan", () => {
      for (const plan of Object.values(SUBSCRIPTION_PLANS)) {
        assert.ok(plan.yearlyPrice < plan.monthlyPrice * 12);
      }
    });

    it("each plan has at least one feature", () => {
      for (const plan of Object.values(SUBSCRIPTION_PLANS)) {
        assert.ok(plan.features.length > 0);
      }
    });

    it("ENTERPRISE has more features than PRO", () => {
      assert.ok(
        SUBSCRIPTION_PLANS.ENTERPRISE.features.length > SUBSCRIPTION_PLANS.PRO.features.length
      );
    });

    it("maxProjects increases with tier", () => {
      assert.ok(SUBSCRIPTION_PLANS.BASIC.maxProjects < SUBSCRIPTION_PLANS.PRO.maxProjects);
      assert.ok(SUBSCRIPTION_PLANS.PRO.maxProjects < SUBSCRIPTION_PLANS.ENTERPRISE.maxProjects);
    });
  });
});
