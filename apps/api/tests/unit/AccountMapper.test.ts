#!/usr/bin/env tsx
/**
 * Unit Tests for AccountMapper
 * Testing account data transformation and mapping logic
 *
 * Run with: pnpm --filter @apps/api exec tsx tests/unit/AccountMapper.test.ts
 */

import { describe, it, expect } from "vitest";
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

    expect(subscriptionInfo.id).toBe("test-account-id");
    expect(subscriptionInfo.email).toBe("test@example.com");
    expect(subscriptionInfo.subscription).toBe("PRO");
    expect(subscriptionInfo.maxProjects).toBe(10);
    expect(subscriptionInfo.currentProjects).toBe(2);
    expect(subscriptionInfo.plan.name).toBe("PRO");
    expect(subscriptionInfo.plan.displayName).toBe("Professional Plan");
    expect(subscriptionInfo.usage.projectsUsed).toBe(2);
    expect(subscriptionInfo.usage.projectsRemaining).toBe(8);
    expect(subscriptionInfo.usage.utilizationPercent).toBe(20);
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

    expect(activeTrialInfo.isOnTrial).toBe(true);
    expect(activeTrialInfo.trialExpired).toBe(false);
    expect(activeTrialInfo.trialDaysRemaining).toBe(7);
    expect(activeTrialInfo.trialEndDate?.getTime()).toBe(futureDate.getTime());
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

    expect(expiredTrialInfo.isOnTrial).toBe(false);
    expect(expiredTrialInfo.trialExpired).toBe(true);
    expect(expiredTrialInfo.trialDaysRemaining).toBe(0);
  });

  it("calculateTrialInfo - No trial end date", () => {
    const noTrialAccount = createAccount({
      isOnTrial: false,
      trialEndDate: null,
    });

    const noTrialInfo = AccountMapper.calculateTrialInfo(noTrialAccount);

    expect(noTrialInfo.isOnTrial).toBe(false);
    expect(noTrialInfo.trialExpired).toBe(false);
    expect(noTrialInfo.trialDaysRemaining).toBe(0);
    expect(noTrialInfo.trialEndDate).toBe(null);
  });
});

describe("AccountMapper - calculateUsage", () => {
  it("calculateUsage - Basic calculation", () => {
    const usage = AccountMapper.calculateUsage(3, 10);

    expect(usage.projectsUsed).toBe(3);
    expect(usage.projectsRemaining).toBe(7);
    expect(usage.utilizationPercent).toBe(30);
  });

  it("calculateUsage - At limit", () => {
    const fullUsage = AccountMapper.calculateUsage(10, 10);

    expect(fullUsage.projectsUsed).toBe(10);
    expect(fullUsage.projectsRemaining).toBe(0);
    expect(fullUsage.utilizationPercent).toBe(100);
  });
});

describe("AccountMapper - getSubscriptionPlan", () => {
  it("getSubscriptionPlan - BASIC tier", () => {
    const basicPlan = AccountMapper.getSubscriptionPlan("BASIC");

    expect(basicPlan.name).toBe("BASIC");
    expect(basicPlan.displayName).toBe("Basic Plan");
    expect(basicPlan.maxProjects).toBe(1);
    expect(basicPlan.features.length >= 4).toBeTruthy();
    expect(basicPlan.price).toBe(undefined); // BASIC is free
  });

  it("getSubscriptionPlan - PRO tier", () => {
    const proPlan = AccountMapper.getSubscriptionPlan("PRO");

    expect(proPlan.name).toBe("PRO");
    expect(proPlan.displayName).toBe("Professional Plan");
    expect(proPlan.maxProjects).toBe(10);
    expect(proPlan.price?.monthly).toBe(29);
    expect(proPlan.price?.yearly).toBe(290);
  });

  it("getSubscriptionPlan - ENTERPRISE tier", () => {
    const enterprisePlan = AccountMapper.getSubscriptionPlan("ENTERPRISE");

    expect(enterprisePlan.name).toBe("ENTERPRISE");
    expect(enterprisePlan.displayName).toBe("Enterprise Plan");
    expect(enterprisePlan.maxProjects).toBe(-1); // Unlimited
    expect(enterprisePlan.price?.monthly).toBe(99);
    expect(enterprisePlan.price?.yearly).toBe(990);
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

    expect(canCreate.allowed).toBe(true);
    expect(canCreate.reason).toBe(undefined);
  });

  it("canCreateProject - Project limit reached", () => {
    const limitReachedAccount = createAccount({
      subscription: "BASIC",
      maxProjects: 1,
      isOnTrial: false,
    });

    const cannotCreate = AccountMapper.canCreateProject(limitReachedAccount, 1);

    expect(cannotCreate.allowed).toBe(false);
    expect(cannotCreate.reason?.includes("Project limit reached")).toBeTruthy();
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

    expect(cannotCreateExpired.allowed).toBe(false);
    expect(cannotCreateExpired.reason?.includes("Trial has expired")).toBeTruthy();
  });

  it("canCreateProject - ENTERPRISE unlimited", () => {
    const enterpriseAccount = createAccount({
      subscription: "ENTERPRISE",
      maxProjects: -1, // Unlimited
      isOnTrial: false,
    });

    const enterpriseCreate = AccountMapper.canCreateProject(enterpriseAccount, 1000);

    expect(enterpriseCreate.allowed).toBe(true);
  });
});

describe("AccountMapper - canUpgradeTo", () => {
  it("canUpgradeTo - Valid upgrade", () => {
    const canUpgrade = AccountMapper.canUpgradeTo("BASIC", "PRO");

    expect(canUpgrade.allowed).toBe(true);
  });

  it("canUpgradeTo - Invalid (downgrade attempt)", () => {
    const cannotDowngrade = AccountMapper.canUpgradeTo("PRO", "BASIC");

    expect(cannotDowngrade.allowed).toBe(false);
    expect(cannotDowngrade.reason?.includes("higher-tier")).toBeTruthy();
  });
});

describe("AccountMapper - canDowngradeTo", () => {
  it("canDowngradeTo - Valid downgrade", () => {
    const canDowngrade = AccountMapper.canDowngradeTo("PRO", "BASIC", 1);

    expect(canDowngrade.allowed).toBe(true);
  });

  it("canDowngradeTo - Too many projects", () => {
    const cannotDowngradeProjects = AccountMapper.canDowngradeTo("PRO", "BASIC", 5);

    expect(cannotDowngradeProjects.allowed).toBe(false);
    expect(cannotDowngradeProjects.reason?.includes("5 projects")).toBeTruthy();
  });
});
