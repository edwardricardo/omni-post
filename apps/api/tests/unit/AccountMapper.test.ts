#!/usr/bin/env tsx
/**
 * Unit Tests for AccountMapper
 * Testing account data transformation and mapping logic
 *
 * Run with: pnpm --filter @apps/api exec tsx tests/unit/AccountMapper.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AccountMapper } from "../../src/mappers/AccountMapper.js";
import type { Account, Project } from "@infra/prisma";

// Helper function to create mock Account
function createAccount(data: Partial<Account>): Account {
  return {
    id: data.id || "test-account-id",
    email: data.email || "test@example.com",
    name: data.name || "Test Account",
    subscription: data.subscription || "BASIC",
    maxProjects: data.maxProjects ?? 1,
    isOnTrial: data.isOnTrial ?? false,
    trialStartDate: data.trialStartDate || new Date(),
    trialEndDate: data.trialEndDate || null,
    autoRenewal: data.autoRenewal ?? false,
    billingCycle: data.billingCycle || "monthly",
    lastBillingDate: data.lastBillingDate || null,
    nextBillingDate: data.nextBillingDate || null,
    stripeCustomerId: data.stripeCustomerId || null,
    stripeSubscriptionId: data.stripeSubscriptionId || null,
    createdAt: data.createdAt || new Date(),
    updatedAt: data.updatedAt || new Date(),
  };
}

// Helper function to create mock Project
function createProject(data: Partial<Project>): Project {
  return {
    id: data.id || "test-project-id",
    accountId: data.accountId || "test-account-id",
    name: data.name || "Test Project",
    locale: data.locale || "en",
    createdAt: data.createdAt || new Date(),
  };
}

describe("AccountMapper - toSubscriptionInfo", () => {
  it("toSubscriptionInfo - Complete mapping", () => {
    const accountWithProjects = {
      ...createAccount({
        subscription: "PRO",
        maxProjects: 10,
        isOnTrial: false,
      }),
      projects: [createProject({}), createProject({ id: "project-2" })],
    };

    const subscriptionInfo = AccountMapper.toSubscriptionInfo(accountWithProjects);

    assert.strictEqual(subscriptionInfo.id, "test-account-id");
    assert.strictEqual(subscriptionInfo.email, "test@example.com");
    assert.strictEqual(subscriptionInfo.subscription, "PRO");
    assert.strictEqual(subscriptionInfo.maxProjects, 10);
    assert.strictEqual(subscriptionInfo.currentProjects, 2);
    assert.strictEqual(subscriptionInfo.plan.name, "PRO");
    assert.strictEqual(subscriptionInfo.plan.displayName, "Professional Plan");
    assert.strictEqual(subscriptionInfo.usage.projectsUsed, 2);
    assert.strictEqual(subscriptionInfo.usage.projectsRemaining, 8);
    assert.strictEqual(subscriptionInfo.usage.utilizationPercent, 20);
  });
});

describe("AccountMapper - calculateTrialInfo", () => {
  it("calculateTrialInfo - Active trial", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7); // 7 days from now

    const activeTrialAccount = createAccount({
      isOnTrial: true,
      trialStartDate: new Date(),
      trialEndDate: futureDate,
    });

    const activeTrialInfo = AccountMapper.calculateTrialInfo(activeTrialAccount);

    assert.strictEqual(activeTrialInfo.isOnTrial, true);
    assert.strictEqual(activeTrialInfo.trialExpired, false);
    assert.strictEqual(activeTrialInfo.trialDaysRemaining, 7);
    assert.strictEqual(activeTrialInfo.trialEndDate?.getTime(), futureDate.getTime());
  });

  it("calculateTrialInfo - Expired trial", () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 7); // 7 days ago

    const expiredTrialAccount = createAccount({
      isOnTrial: true,
      trialStartDate: new Date("2024-01-01"),
      trialEndDate: pastDate,
    });

    const expiredTrialInfo = AccountMapper.calculateTrialInfo(expiredTrialAccount);

    assert.strictEqual(expiredTrialInfo.isOnTrial, false);
    assert.strictEqual(expiredTrialInfo.trialExpired, true);
    assert.strictEqual(expiredTrialInfo.trialDaysRemaining, 0);
  });

  it("calculateTrialInfo - No trial end date", () => {
    const noTrialAccount = createAccount({
      isOnTrial: false,
      trialEndDate: null,
    });

    const noTrialInfo = AccountMapper.calculateTrialInfo(noTrialAccount);

    assert.strictEqual(noTrialInfo.isOnTrial, false);
    assert.strictEqual(noTrialInfo.trialExpired, false);
    assert.strictEqual(noTrialInfo.trialDaysRemaining, 0);
    assert.strictEqual(noTrialInfo.trialEndDate, null);
  });
});

describe("AccountMapper - calculateUsage", () => {
  it("calculateUsage - Basic calculation", () => {
    const usage = AccountMapper.calculateUsage(3, 10);

    assert.strictEqual(usage.projectsUsed, 3);
    assert.strictEqual(usage.projectsRemaining, 7);
    assert.strictEqual(usage.utilizationPercent, 30);
  });

  it("calculateUsage - At limit", () => {
    const fullUsage = AccountMapper.calculateUsage(10, 10);

    assert.strictEqual(fullUsage.projectsUsed, 10);
    assert.strictEqual(fullUsage.projectsRemaining, 0);
    assert.strictEqual(fullUsage.utilizationPercent, 100);
  });
});

describe("AccountMapper - getSubscriptionPlan", () => {
  it("getSubscriptionPlan - BASIC tier", () => {
    const basicPlan = AccountMapper.getSubscriptionPlan("BASIC");

    assert.strictEqual(basicPlan.name, "BASIC");
    assert.strictEqual(basicPlan.displayName, "Basic Plan");
    assert.strictEqual(basicPlan.maxProjects, 1);
    assert.ok(basicPlan.features.length >= 4);
    assert.strictEqual(basicPlan.price, undefined); // BASIC is free
  });

  it("getSubscriptionPlan - PRO tier", () => {
    const proPlan = AccountMapper.getSubscriptionPlan("PRO");

    assert.strictEqual(proPlan.name, "PRO");
    assert.strictEqual(proPlan.displayName, "Professional Plan");
    assert.strictEqual(proPlan.maxProjects, 10);
    assert.strictEqual(proPlan.price?.monthly, 29);
    assert.strictEqual(proPlan.price?.yearly, 290);
  });

  it("getSubscriptionPlan - ENTERPRISE tier", () => {
    const enterprisePlan = AccountMapper.getSubscriptionPlan("ENTERPRISE");

    assert.strictEqual(enterprisePlan.name, "ENTERPRISE");
    assert.strictEqual(enterprisePlan.displayName, "Enterprise Plan");
    assert.strictEqual(enterprisePlan.maxProjects, -1); // Unlimited
    assert.strictEqual(enterprisePlan.price?.monthly, 99);
    assert.strictEqual(enterprisePlan.price?.yearly, 990);
  });
});

describe("AccountMapper - canCreateProject", () => {
  it("canCreateProject - Allowed", () => {
    const allowedAccount = createAccount({
      subscription: "PRO",
      maxProjects: 10,
      isOnTrial: false,
    });

    const canCreate = AccountMapper.canCreateProject(allowedAccount, 5);

    assert.strictEqual(canCreate.allowed, true);
    assert.strictEqual(canCreate.reason, undefined);
  });

  it("canCreateProject - Project limit reached", () => {
    const limitReachedAccount = createAccount({
      subscription: "BASIC",
      maxProjects: 1,
      isOnTrial: false,
    });

    const cannotCreate = AccountMapper.canCreateProject(limitReachedAccount, 1);

    assert.strictEqual(cannotCreate.allowed, false);
    assert.ok(cannotCreate.reason?.includes("Project limit reached"));
  });

  it("canCreateProject - Trial expired", () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 7);

    const expiredAccount = createAccount({
      subscription: "BASIC",
      maxProjects: 1,
      isOnTrial: true,
      trialEndDate: pastDate,
    });

    const cannotCreateExpired = AccountMapper.canCreateProject(expiredAccount, 0);

    assert.strictEqual(cannotCreateExpired.allowed, false);
    assert.ok(cannotCreateExpired.reason?.includes("Trial has expired"));
  });

  it("canCreateProject - ENTERPRISE unlimited", () => {
    const enterpriseAccount = createAccount({
      subscription: "ENTERPRISE",
      maxProjects: -1, // Unlimited
      isOnTrial: false,
    });

    const enterpriseCreate = AccountMapper.canCreateProject(enterpriseAccount, 1000);

    assert.strictEqual(enterpriseCreate.allowed, true);
  });
});

describe("AccountMapper - canUpgradeTo", () => {
  it("canUpgradeTo - Valid upgrade", () => {
    const canUpgrade = AccountMapper.canUpgradeTo("BASIC", "PRO");

    assert.strictEqual(canUpgrade.allowed, true);
  });

  it("canUpgradeTo - Invalid (downgrade attempt)", () => {
    const cannotDowngrade = AccountMapper.canUpgradeTo("PRO", "BASIC");

    assert.strictEqual(cannotDowngrade.allowed, false);
    assert.ok(cannotDowngrade.reason?.includes("higher-tier"));
  });
});

describe("AccountMapper - canDowngradeTo", () => {
  it("canDowngradeTo - Valid downgrade", () => {
    const canDowngrade = AccountMapper.canDowngradeTo("PRO", "BASIC", 1);

    assert.strictEqual(canDowngrade.allowed, true);
  });

  it("canDowngradeTo - Too many projects", () => {
    const cannotDowngradeProjects = AccountMapper.canDowngradeTo("PRO", "BASIC", 5);

    assert.strictEqual(cannotDowngradeProjects.allowed, false);
    assert.ok(cannotDowngradeProjects.reason?.includes("5 projects"));
  });
});
