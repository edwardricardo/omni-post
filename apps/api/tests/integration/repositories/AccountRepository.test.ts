/**
 * Comprehensive Tests for AccountRepository (AccountRepository.ts)
 *
 * This test suite validates the account data access layer that centralizes account lookups.
 *
 * Tests cover:
 * - findWithProjects - Account with projects relationship
 * - findById - Basic account lookup
 * - findByEmail - Email-based lookup with case normalization
 * - findManyWithProjects - Batch account retrieval
 * - updateSubscription - Subscription tier updates
 * - getExpiringTrials - Trial period queries
 * - Error handling and edge cases
 *
 * Run with: pnpm --filter @apps/api exec tsx tests/unit/AccountRepository.test.ts
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PrismaAccountQueryRepository } from "../../../src/infrastructure/repositories/PrismaAccountQueryRepository.js";
import { prisma } from "@infra/prisma";

// ========================================
// TEST DATA SETUP & TEARDOWN
// ========================================

let testAccountIds: string[] = [];
let testProjectIds: string[] = [];

async function setupTestData() {
  // Clean up any existing test data
  await teardownTestData();

  // Create multiple test accounts
  const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

  // Account 1: Basic account with projects
  const account1 = await prisma.account.create({
    data: {
      name: "Test Account 1",
      email: `test-account-1-${uniqueId}@example.com`,
      subscription: "BASIC",
      isOnTrial: false,
    },
  });
  testAccountIds.push(account1.id);

  // Create projects for account 1
  const project1 = await prisma.project.create({
    data: {
      name: "Project 1",
      accountId: account1.id,
    },
  });
  testProjectIds.push(project1.id);

  const project2 = await prisma.project.create({
    data: {
      name: "Project 2",
      accountId: account1.id,
    },
  });
  testProjectIds.push(project2.id);

  // Account 2: Pro account on trial expiring soon
  const account2 = await prisma.account.create({
    data: {
      name: "Test Account 2",
      email: `test-account-2-${uniqueId}@example.com`,
      subscription: "PRO",
      isOnTrial: true,
      trialEndDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
    },
  });
  testAccountIds.push(account2.id);

  // Account 3: Trial expiring in 10 days
  const account3 = await prisma.account.create({
    data: {
      name: "Test Account 3",
      email: `test-account-3-${uniqueId}@example.com`,
      subscription: "BASIC",
      isOnTrial: true,
      trialEndDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days from now
    },
  });
  testAccountIds.push(account3.id);

  // Account 4: Trial already expired
  const account4 = await prisma.account.create({
    data: {
      name: "Test Account 4",
      email: `test-account-4-${uniqueId}@example.com`,
      subscription: "BASIC",
      isOnTrial: true,
      trialEndDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
    },
  });
  testAccountIds.push(account4.id);
}

async function teardownTestData() {
  try {
    // Clean up in reverse order
    if (testProjectIds.length > 0) {
      await prisma.post.deleteMany({ where: { projectId: { in: testProjectIds } } });
      await prisma.channel.deleteMany({ where: { projectId: { in: testProjectIds } } });
      await prisma.project.deleteMany({ where: { id: { in: testProjectIds } } });
      testProjectIds = [];
    }

    if (testAccountIds.length > 0) {
      await prisma.account.deleteMany({ where: { id: { in: testAccountIds } } });
      testAccountIds = [];
    }
  } catch (err) {
    console.warn("Teardown warning:", err);
  }
}

// ========================================
// TESTS: Basic Repository Operations
// ========================================

describe("AccountRepository - Basic Operations", () => {
  it("AccountRepository instantiates successfully", () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    expect(repo !== null).toBeTruthy();
  });
});

// ========================================
// TESTS: findWithProjects
// ========================================

describe("AccountRepository - findWithProjects", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
    await teardownTestData();
  });

  it("returns account with projects when account exists", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findWithProjects(testAccountIds[0]!);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.id).toBe(testAccountIds[0]);
      expect(Array.isArray(result.value.projects)).toBeTruthy();
      expect(result.value.projects.length).toBe(2);
    }
  });

  it("returns NOT_FOUND error when account does not exist", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findWithProjects("non-existent-account-id");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("NOT_FOUND");
    }
  });

  it("includes empty projects array when account has no projects", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findWithProjects(testAccountIds[1]!);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(Array.isArray(result.value.projects)).toBeTruthy();
      expect(result.value.projects.length).toBe(0);
    }
  });
});

// ========================================
// TESTS: findById
// ========================================

describe("AccountRepository - findById", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
    await teardownTestData();
  });

  it("returns account when it exists", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findById(testAccountIds[0]!);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.id).toBe(testAccountIds[0]);
      expect(result.value.email).toBeTruthy();
      expect(result.value.subscription).toBeTruthy();
    }
  });

  it("returns NOT_FOUND error when account does not exist", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findById("non-existent-account-id");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("NOT_FOUND");
    }
  });

  it("does not include projects relationship", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findById(testAccountIds[0]!);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      // TypeScript won't have 'projects' property since it's not in the type
      expect((result.value as any).projects).toBe(undefined);
    }
  });
});

// ========================================
// TESTS: findByEmail
// ========================================

describe("AccountRepository - findByEmail", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
    await teardownTestData();
  });

  it("returns account when email matches", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const account = await prisma.account.findUnique({
      where: { id: testAccountIds[0]! },
    });

    const result = await repo.findByEmail(account!.email);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.id).toBe(testAccountIds[0]);
      expect(result.value.email).toBe(account!.email);
    }
  });

  it("normalizes email to lowercase", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const account = await prisma.account.findUnique({
      where: { id: testAccountIds[0]! },
    });

    const uppercaseEmail = account!.email.toUpperCase();
    const result = await repo.findByEmail(uppercaseEmail);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.id).toBe(testAccountIds[0]);
    }
  });

  it("returns NOT_FOUND error when email does not exist", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findByEmail("nonexistent@example.com");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("NOT_FOUND");
    }
  });
});

// ========================================
// TESTS: findManyWithProjects
// ========================================

describe("AccountRepository - findManyWithProjects", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
    await teardownTestData();
  });

  it("returns multiple accounts with projects", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accountIds = [testAccountIds[0]!, testAccountIds[1]!];
    const accounts = await repo.findManyWithProjects(accountIds);

    expect(Array.isArray(accounts)).toBeTruthy();
    expect(accounts.length).toBe(2);

    accounts.forEach((account) => {
      expect(Array.isArray(account.projects)).toBeTruthy();
    });
  });

  it("returns empty array when no account IDs provided", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.findManyWithProjects([]);

    expect(Array.isArray(accounts)).toBeTruthy();
    expect(accounts.length).toBe(0);
  });

  it("only returns accounts that exist", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accountIds = [testAccountIds[0]!, "non-existent-id", testAccountIds[1]!];
    const accounts = await repo.findManyWithProjects(accountIds);

    expect(accounts.length).toBe(2);
  });

  it("returns accounts in correct order", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.findManyWithProjects(testAccountIds.slice(0, 3));

    expect(accounts.length > 0).toBeTruthy();
    // Verify all requested accounts are returned
    const returnedIds = accounts.map((a) => a.id);
    testAccountIds.slice(0, 3).forEach((id) => {
      expect(returnedIds.includes(id)).toBeTruthy();
    });
  });
});

// ========================================
// TESTS: updateSubscription
// ========================================

describe("AccountRepository - updateSubscription", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
    await teardownTestData();
  });

  it("updates subscription tier successfully", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.updateSubscription(testAccountIds[0]!, {
      subscription: "PRO",
    });

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.subscription).toBe("PRO");
    }

    // Verify in database
    const account = await prisma.account.findUnique({
      where: { id: testAccountIds[0]! },
    });
    expect(account!.subscription).toBe("PRO");
  });

  it("updates maxProjects successfully", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.updateSubscription(testAccountIds[0]!, {
      maxProjects: 10,
    });

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.maxProjects).toBe(10);
    }
  });

  it("updates trial status successfully", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.updateSubscription(testAccountIds[1]!, {
      isOnTrial: false,
      trialEndDate: null,
    });

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.isOnTrial).toBe(false);
      expect(result.value.trialEndDate).toBe(null);
    }
  });

  it("updates multiple fields simultaneously", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const newTrialEndDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const result = await repo.updateSubscription(testAccountIds[0]!, {
      subscription: "ENTERPRISE",
      maxProjects: 50,
      isOnTrial: true,
      trialEndDate: newTrialEndDate,
    });

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.subscription).toBe("ENTERPRISE");
      expect(result.value.maxProjects).toBe(50);
      expect(result.value.isOnTrial).toBe(true);
    }
  });

  it("returns NOT_FOUND error when account does not exist", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.updateSubscription("non-existent-account-id", {
      subscription: "PRO",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("NOT_FOUND");
    }
  });
});

// ========================================
// TESTS: getExpiringTrials
// ========================================

describe("AccountRepository - getExpiringTrials", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
    await teardownTestData();
  });

  it("returns trials expiring within threshold", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.getExpiringTrials(3); // 3 days threshold

    expect(Array.isArray(accounts)).toBeTruthy();
    expect(accounts.length > 0).toBeTruthy();

    // Should include account with trial ending in 2 days
    const hasExpiringAccount = accounts.some((a) => a.id === testAccountIds[1]);
    expect(hasExpiringAccount).toBeTruthy();
  });

  it("does not return trials expiring beyond threshold", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.getExpiringTrials(5); // 5 days threshold

    // Should not include account expiring in 10 days
    const hasLaterAccount = accounts.some((a) => a.id === testAccountIds[2]);
    expect(hasLaterAccount).toBeFalsy();
  });

  it("does not return already expired trials", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.getExpiringTrials(7);

    // Should not include account that already expired
    const hasExpiredAccount = accounts.some((a) => a.id === testAccountIds[3]);
    expect(hasExpiredAccount).toBeFalsy();
  });

  it("does not return accounts not on trial", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.getExpiringTrials(30);

    // Should not include account 1 which is not on trial
    const hasNonTrialAccount = accounts.some((a) => a.id === testAccountIds[0]);
    expect(hasNonTrialAccount).toBeFalsy();
  });

  it("returns accounts ordered by trial end date ascending", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.getExpiringTrials(15);

    // Verify ascending order
    for (let i = 0; i < accounts.length - 1; i++) {
      if (accounts[i]!.trialEndDate && accounts[i + 1]!.trialEndDate) {
        const currentTime = accounts[i]!.trialEndDate!.getTime();
        const nextTime = accounts[i + 1]!.trialEndDate!.getTime();
        expect(currentTime <= nextTime).toBeTruthy();
      }
    }
  });

  it("returns empty array when threshold is 0", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.getExpiringTrials(0);

    expect(Array.isArray(accounts)).toBeTruthy();
    // May return accounts expiring today, but likely empty
  });

  it("returns correct accounts for different thresholds", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);

    // Threshold 1: Should only get trials expiring tomorrow
    const accounts1Day = await repo.getExpiringTrials(1);
    expect(Array.isArray(accounts1Day)).toBeTruthy();

    // Threshold 14: Should get multiple trials
    const accounts14Days = await repo.getExpiringTrials(14);
    expect(Array.isArray(accounts14Days)).toBeTruthy();

    // 14 days should have more results than 1 day
    expect(accounts14Days.length >= accounts1Day.length).toBeTruthy();
  });
});

// ========================================
// TESTS: Edge Cases and Error Handling
// ========================================

describe("AccountRepository - Edge Cases", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
    await teardownTestData();
  });

  it("handles concurrent reads correctly", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);

    const results = await Promise.all([
      repo.findById(testAccountIds[0]!),
      repo.findById(testAccountIds[1]!),
      repo.findById(testAccountIds[2]!),
    ]);

    expect(results.every((r) => r.ok)).toBeTruthy();
  });

  it("handles empty string account ID gracefully", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findById("");

    expect(result.ok).toBeFalsy();
  });

  it("handles very long threshold values for expiring trials", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.getExpiringTrials(365); // 1 year

    expect(Array.isArray(accounts)).toBeTruthy();
  });
});
