#!/usr/bin/env tsx
/**
 * Unit Tests for SubscriptionService
 * Testing subscription management, upgrades, downgrades, and trials
 *
 * Uses node:test and node:assert for standard Node.js testing
 * Handles Prisma NULL vs undefined properly
 * Ensures proper database cleanup
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { subscriptionService } from "../../src/billing/subscriptionService.js";
import { prisma } from "@infra/prisma";

const timestamp = Date.now();

// Test account data
const testAccountEmail = `test-subscription-${timestamp}@example.com`;
const trialAccountEmail = `test-trial-${timestamp}@example.com`;

let testAccountId: string;
let trialAccountId: string;

// ========== SETUP ==========

before(async () => {
  // Create test account for subscription tests
  const testAccount = await prisma.account.create({
    data: {
      name: "Test Subscription Account",
      email: testAccountEmail,
      subscription: "BASIC",
      maxProjects: 1,
      isOnTrial: false,
      autoRenewal: false,
      billingCycle: "monthly",
    },
  });

  testAccountId = testAccount.id;
});

// ========== CLEANUP ==========

after(async () => {
  try {
    // Delete all projects for test accounts
    await prisma.project.deleteMany({
      where: {
        accountId: {
          in: [testAccountId, trialAccountId].filter(Boolean),
        },
      },
    });

    // Delete test accounts
    await prisma.account.deleteMany({
      where: {
        id: {
          in: [testAccountId, trialAccountId].filter(Boolean),
        },
      },
    });
  } catch (error) {
    console.warn("Cleanup warning:", error);
  }
});

// ========== SUBSCRIPTION PLAN TESTS ==========

describe("Subscription Plan Management", { concurrency: 1 }, () => {
  it("should get plan details for BASIC tier", () => {
    const basicPlan = subscriptionService.getSubscriptionPlan("BASIC");

    assert.equal(basicPlan.tier, "BASIC", "Plan tier should be BASIC");
    assert.equal(basicPlan.name, "Basic Plan", "Plan name should be correct");
    assert.equal(basicPlan.maxProjects, 1, "Max projects should be 1");
    assert.ok(basicPlan.monthlyPrice > 0, "Monthly price should be positive");
    assert.ok(basicPlan.yearlyPrice > 0, "Yearly price should be positive");
  });

  it("should get all available plans", () => {
    const allPlans = subscriptionService.getAllPlans();

    assert.equal(allPlans.length, 3, "Should have 3 plans");
    assert.ok(
      allPlans.find((p) => p.tier === "BASIC"),
      "Should include BASIC plan"
    );
    assert.ok(
      allPlans.find((p) => p.tier === "PRO"),
      "Should include PRO plan"
    );
    assert.ok(
      allPlans.find((p) => p.tier === "ENTERPRISE"),
      "Should include ENTERPRISE plan"
    );
  });
});

// ========== ACCOUNT SUBSCRIPTION TESTS ==========

describe("Account Subscription Retrieval", { concurrency: 1 }, () => {
  it("should get account subscription info", async () => {
    const result = await subscriptionService.getAccountSubscription(testAccountId);

    assert.ok(result.ok, "Result should be successful");
    assert.equal(result.value.subscription, "BASIC", "Subscription tier should be BASIC");
    assert.equal(result.value.plan.tier, "BASIC", "Plan tier should be BASIC");
    assert.equal(result.value.email, testAccountEmail, "Email should match");
    assert.equal(result.value.isActive, true, "Account should be active");
  });

  it("should return NOT_FOUND for non-existent account", async () => {
    const result = await subscriptionService.getAccountSubscription("non-existent-id");

    assert.ok(!result.ok, "Result should be error");
    assert.equal(result.error, "NOT_FOUND", "Error should be NOT_FOUND");
  });
});

// ========== SUBSCRIPTION UPDATE TESTS ==========

describe("Subscription Updates", { concurrency: 1 }, () => {
  it("should upgrade from BASIC to PRO", async () => {
    const result = await subscriptionService.updateSubscription(testAccountId, {
      newTier: "PRO",
      billingCycle: "monthly",
      reason: "User upgrade request",
    });

    assert.ok(result.ok, "Result should be successful");
    assert.equal(result.value.subscription, "PRO", "Subscription should be PRO");
    assert.equal(result.value.maxProjects, 5, "Max projects should be 5");
  });

  it("should return NO_CHANGE when updating to same tier", async () => {
    const result = await subscriptionService.updateSubscription(testAccountId, {
      newTier: "PRO",
      billingCycle: "monthly",
    });

    assert.ok(!result.ok, "Result should be error");
    assert.equal(result.error, "NO_CHANGE", "Error should be NO_CHANGE");
  });

  it("should downgrade from PRO to BASIC", async () => {
    const result = await subscriptionService.updateSubscription(testAccountId, {
      newTier: "BASIC",
      billingCycle: "monthly",
      reason: "User downgrade request",
    });

    assert.ok(result.ok, "Result should be successful");
    assert.equal(result.value.subscription, "BASIC", "Subscription should be BASIC");
    assert.equal(result.value.maxProjects, 1, "Max projects should be 1");
  });

  it("should return NOT_FOUND for non-existent account", async () => {
    const result = await subscriptionService.updateSubscription("non-existent-id", {
      newTier: "PRO",
      billingCycle: "monthly",
    });

    assert.ok(!result.ok, "Result should be error");
    assert.equal(result.error, "NOT_FOUND", "Error should be NOT_FOUND");
  });
});

// ========== TRIAL MANAGEMENT TESTS ==========

describe("Trial Period Management", { concurrency: 1 }, () => {
  it("should start trial period successfully", async () => {
    // Create new account for trial test
    const trialAccount = await prisma.account.create({
      data: {
        name: "Test Trial Account",
        email: trialAccountEmail,
        subscription: "BASIC",
        maxProjects: 1,
        isOnTrial: false,
        autoRenewal: false,
        billingCycle: "monthly",
      },
    });

    trialAccountId = trialAccount.id;

    const result = await subscriptionService.startTrial({
      accountId: trialAccountId,
      tier: "PRO",
      trialDurationDays: 14,
      autoRenewal: false,
      billingCycle: "monthly",
    });

    assert.ok(result.ok, "Result should be successful");
    assert.equal(result.value.trial.isOnTrial, true, "Should be on trial");
    assert.ok(result.value.trial.trialDaysRemaining > 0, "Should have trial days remaining");
    assert.equal(result.value.subscription, "PRO", "Subscription should be PRO");
  });

  it("should reject starting trial when already on trial", async () => {
    const result = await subscriptionService.startTrial({
      accountId: trialAccountId,
      tier: "PRO",
      trialDurationDays: 14,
    });

    assert.ok(!result.ok, "Result should be error");
    assert.equal(result.error, "ALREADY_ON_TRIAL", "Error should be ALREADY_ON_TRIAL");
  });

  it("should end trial period successfully", async () => {
    const result = await subscriptionService.endTrial(trialAccountId, "User cancelled trial");

    assert.ok(result.ok, "Result should be successful");
    assert.equal(result.value.trial.isOnTrial, false, "Should not be on trial");
    assert.equal(result.value.subscription, "BASIC", "Should downgrade to BASIC");
  });

  it("should reject ending trial when not on trial", async () => {
    const result = await subscriptionService.endTrial(trialAccountId, "Already ended");

    assert.ok(!result.ok, "Result should be error");
    assert.equal(result.error, "NOT_ON_TRIAL", "Error should be NOT_ON_TRIAL");
  });

  it("should return NOT_FOUND for non-existent account", async () => {
    const result = await subscriptionService.startTrial({
      accountId: "non-existent-id",
      tier: "PRO",
      trialDurationDays: 14,
    });

    assert.ok(!result.ok, "Result should be error");
    assert.equal(result.error, "NOT_FOUND", "Error should be NOT_FOUND");
  });
});

// ========== SUBSCRIPTION SUSPENSION TESTS ==========

describe("Subscription Suspension", { concurrency: 1 }, () => {
  it("should suspend subscription successfully", async () => {
    const result = await subscriptionService.suspendSubscription(
      testAccountId,
      "Payment failure",
      undefined
    );

    assert.ok(result.ok, "Result should be successful");
  });

  it("should return NOT_FOUND for non-existent account", async () => {
    const result = await subscriptionService.suspendSubscription(
      "non-existent-id",
      "Test",
      undefined
    );

    assert.ok(!result.ok, "Result should be error");
    assert.equal(result.error, "NOT_FOUND", "Error should be NOT_FOUND");
  });
});

// ========== SUBSCRIPTION LIMITS VALIDATION TESTS ==========

describe("Subscription Limits Validation", { concurrency: 1 }, () => {
  it("should validate CREATE_PROJECT operation within limits", async () => {
    const result = await subscriptionService.validateSubscriptionLimits(
      testAccountId,
      "CREATE_PROJECT",
      1
    );

    assert.ok(result.ok, "Result should be successful");
    assert.ok(result.value.allowed, "Operation should be allowed");
    assert.ok(result.value.remaining >= 0, "Should have remaining capacity");
  });

  it("should validate ADD_TEAM_MEMBER operation", async () => {
    const result = await subscriptionService.validateSubscriptionLimits(
      testAccountId,
      "ADD_TEAM_MEMBER",
      1
    );

    assert.ok(result.ok, "Result should be successful");
    assert.ok(typeof result.value.allowed === "boolean", "Should return allowed status");
    assert.ok(result.value.limit >= 0, "Should have limit defined");
  });

  it("should validate UPLOAD_MEDIA operation", async () => {
    const result = await subscriptionService.validateSubscriptionLimits(
      testAccountId,
      "UPLOAD_MEDIA",
      0.5 // 0.5 GB
    );

    assert.ok(result.ok, "Result should be successful");
    assert.ok(typeof result.value.allowed === "boolean", "Should return allowed status");
    assert.ok(result.value.limit > 0, "Should have storage limit");
  });

  it("should return NOT_FOUND for non-existent account", async () => {
    const result = await subscriptionService.validateSubscriptionLimits(
      "non-existent-id",
      "CREATE_PROJECT",
      1
    );

    assert.ok(!result.ok, "Result should be error");
    assert.equal(result.error, "NOT_FOUND", "Error should be NOT_FOUND");
  });
});

// ========== SUBSCRIPTION STATISTICS TESTS ==========

describe("Subscription Statistics", { concurrency: 1 }, () => {
  it("should get subscription statistics", async () => {
    const result = await subscriptionService.getSubscriptionStats();

    assert.ok(result.ok, "Result should be successful");
    assert.ok(result.value.totalSubscriptions > 0, "Should have subscriptions");
    assert.ok(result.value.subscriptionsByTier, "Should have tier breakdown");
    assert.ok(result.value.totalRevenue, "Should have revenue data");
    assert.ok(result.value.conversionRates, "Should have conversion rates");
    assert.ok(result.value.churnRisk, "Should have churn risk data");
    assert.ok(result.value.growthMetrics, "Should have growth metrics");
  });
});

// ========== EXPIRING TRIALS TESTS ==========

describe("Expiring Trials Management", { concurrency: 1 }, () => {
  it("should get expiring trials", async () => {
    const result = await subscriptionService.getExpiringTrials(7);

    assert.ok(result.ok, "Result should be successful");
    assert.ok(Array.isArray(result.value), "Should return array of accounts");
  });
});

// ========== LIST SUBSCRIPTIONS TESTS ==========

describe("List Account Subscriptions", { concurrency: 1 }, () => {
  it("should list all subscriptions with pagination", async () => {
    const result = await subscriptionService.listAccountSubscriptions({}, 1, 10);

    assert.ok(result.ok, "Result should be successful");
    assert.ok(Array.isArray(result.value.subscriptions), "Should return subscriptions array");
    assert.ok(result.value.total >= 0, "Should have total count");
    assert.equal(result.value.page, 1, "Should return correct page");
    assert.equal(result.value.limit, 10, "Should return correct limit");
  });

  it("should filter subscriptions by tier", async () => {
    const result = await subscriptionService.listAccountSubscriptions({ tier: "BASIC" }, 1, 10);

    assert.ok(result.ok, "Result should be successful");
    assert.ok(
      result.value.subscriptions.every((sub) => sub.subscription === "BASIC"),
      "All subscriptions should be BASIC tier"
    );
  });

  it("should search subscriptions by email", async () => {
    const result = await subscriptionService.listAccountSubscriptions(
      { search: testAccountEmail.substring(0, 20) },
      1,
      10
    );

    assert.ok(result.ok, "Result should be successful");
    // Search should return results or empty array
    assert.ok(Array.isArray(result.value.subscriptions), "Should return subscriptions array");
  });

  it("should sort subscriptions by different fields", async () => {
    const result = await subscriptionService.listAccountSubscriptions(
      { sortBy: "createdAt", sortOrder: "desc" },
      1,
      10
    );

    assert.ok(result.ok, "Result should be successful");
    assert.ok(Array.isArray(result.value.subscriptions), "Should return subscriptions array");
  });
});
