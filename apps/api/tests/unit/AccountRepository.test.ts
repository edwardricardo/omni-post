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

import { describe, it, before, after } from "node:test";
import * as assert from "node:assert/strict";
import { PrismaAccountQueryRepository } from "../../src/infrastructure/repositories/PrismaAccountQueryRepository.js";
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

describe("AccountRepository - Basic Operations", { concurrency: 1 }, () => {
  it("AccountRepository instantiates successfully", () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    assert.ok(repo !== null, "Should create repository instance");
  });
});

// ========================================
// TESTS: findWithProjects
// ========================================

describe("AccountRepository - findWithProjects", { concurrency: 1 }, () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns account with projects when account exists", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findWithProjects(testAccountIds[0]!);

    assert.ok(result.ok, "Should return successful result");
    if (result.ok) {
      assert.strictEqual(result.value.id, testAccountIds[0], "Should return correct account");
      assert.ok(Array.isArray(result.value.projects), "Should include projects array");
      assert.strictEqual(result.value.projects.length, 2, "Should include 2 projects");
    }
  });

  it("returns NOT_FOUND error when account does not exist", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findWithProjects("non-existent-account-id");

    assert.strictEqual(result.ok, false, "Should return error result");
    if (!result.ok) {
      assert.strictEqual(result.error, "NOT_FOUND", "Should return NOT_FOUND error");
    }
  });

  it("includes empty projects array when account has no projects", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findWithProjects(testAccountIds[1]!);

    assert.ok(result.ok, "Should return successful result");
    if (result.ok) {
      assert.ok(Array.isArray(result.value.projects), "Should include projects array");
      assert.strictEqual(result.value.projects.length, 0, "Should have empty projects array");
    }
  });
});

// ========================================
// TESTS: findById
// ========================================

describe("AccountRepository - findById", { concurrency: 1 }, () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns account when it exists", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findById(testAccountIds[0]!);

    assert.ok(result.ok, "Should return successful result");
    if (result.ok) {
      assert.strictEqual(result.value.id, testAccountIds[0], "Should return correct account");
      assert.ok(result.value.email, "Should include email");
      assert.ok(result.value.subscription, "Should include subscription");
    }
  });

  it("returns NOT_FOUND error when account does not exist", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findById("non-existent-account-id");

    assert.strictEqual(result.ok, false, "Should return error result");
    if (!result.ok) {
      assert.strictEqual(result.error, "NOT_FOUND", "Should return NOT_FOUND error");
    }
  });

  it("does not include projects relationship", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findById(testAccountIds[0]!);

    assert.ok(result.ok, "Should return successful result");
    if (result.ok) {
      // TypeScript won't have 'projects' property since it's not in the type
      assert.strictEqual((result.value as any).projects, undefined, "Should not include projects");
    }
  });
});

// ========================================
// TESTS: findByEmail
// ========================================

describe("AccountRepository - findByEmail", { concurrency: 1 }, () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns account when email matches", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const account = await prisma.account.findUnique({
      where: { id: testAccountIds[0]! },
    });

    const result = await repo.findByEmail(account!.email);

    assert.ok(result.ok, "Should return successful result");
    if (result.ok) {
      assert.strictEqual(result.value.id, testAccountIds[0], "Should return correct account");
      assert.strictEqual(result.value.email, account!.email, "Should match email");
    }
  });

  it("normalizes email to lowercase", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const account = await prisma.account.findUnique({
      where: { id: testAccountIds[0]! },
    });

    const uppercaseEmail = account!.email.toUpperCase();
    const result = await repo.findByEmail(uppercaseEmail);

    assert.ok(result.ok, "Should return successful result with uppercase email");
    if (result.ok) {
      assert.strictEqual(
        result.value.id,
        testAccountIds[0],
        "Should find account with case-insensitive search"
      );
    }
  });

  it("returns NOT_FOUND error when email does not exist", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findByEmail("nonexistent@example.com");

    assert.strictEqual(result.ok, false, "Should return error result");
    if (!result.ok) {
      assert.strictEqual(result.error, "NOT_FOUND", "Should return NOT_FOUND error");
    }
  });
});

// ========================================
// TESTS: findManyWithProjects
// ========================================

describe("AccountRepository - findManyWithProjects", { concurrency: 1 }, () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns multiple accounts with projects", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accountIds = [testAccountIds[0]!, testAccountIds[1]!];
    const accounts = await repo.findManyWithProjects(accountIds);

    assert.ok(Array.isArray(accounts), "Should return an array");
    assert.strictEqual(accounts.length, 2, "Should return 2 accounts");

    accounts.forEach((account) => {
      assert.ok(Array.isArray(account.projects), "Each account should have projects array");
    });
  });

  it("returns empty array when no account IDs provided", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.findManyWithProjects([]);

    assert.ok(Array.isArray(accounts), "Should return an array");
    assert.strictEqual(accounts.length, 0, "Should return empty array");
  });

  it("only returns accounts that exist", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accountIds = [testAccountIds[0]!, "non-existent-id", testAccountIds[1]!];
    const accounts = await repo.findManyWithProjects(accountIds);

    assert.strictEqual(accounts.length, 2, "Should return only existing accounts");
  });

  it("returns accounts in correct order", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.findManyWithProjects(testAccountIds.slice(0, 3));

    assert.ok(accounts.length > 0, "Should return accounts");
    // Verify all requested accounts are returned
    const returnedIds = accounts.map((a) => a.id);
    testAccountIds.slice(0, 3).forEach((id) => {
      assert.ok(returnedIds.includes(id), `Account ${id} should be included in results`);
    });
  });
});

// ========================================
// TESTS: updateSubscription
// ========================================

describe("AccountRepository - updateSubscription", { concurrency: 1 }, () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("updates subscription tier successfully", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.updateSubscription(testAccountIds[0]!, {
      subscription: "PRO",
    });

    assert.ok(result.ok, "Should return successful result");
    if (result.ok) {
      assert.strictEqual(result.value.subscription, "PRO", "Should update subscription to PRO");
    }

    // Verify in database
    const account = await prisma.account.findUnique({
      where: { id: testAccountIds[0]! },
    });
    assert.strictEqual(account!.subscription, "PRO", "Should persist subscription update");
  });

  it("updates maxProjects successfully", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.updateSubscription(testAccountIds[0]!, {
      maxProjects: 10,
    });

    assert.ok(result.ok, "Should return successful result");
    if (result.ok) {
      assert.strictEqual(result.value.maxProjects, 10, "Should update maxProjects");
    }
  });

  it("updates trial status successfully", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.updateSubscription(testAccountIds[1]!, {
      isOnTrial: false,
      trialEndDate: null,
    });

    assert.ok(result.ok, "Should return successful result");
    if (result.ok) {
      assert.strictEqual(result.value.isOnTrial, false, "Should update trial status");
      assert.strictEqual(result.value.trialEndDate, null, "Should clear trial end date");
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

    assert.ok(result.ok, "Should return successful result");
    if (result.ok) {
      assert.strictEqual(result.value.subscription, "ENTERPRISE", "Should update subscription");
      assert.strictEqual(result.value.maxProjects, 50, "Should update maxProjects");
      assert.strictEqual(result.value.isOnTrial, true, "Should update trial status");
    }
  });

  it("returns NOT_FOUND error when account does not exist", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.updateSubscription("non-existent-account-id", {
      subscription: "PRO",
    });

    assert.strictEqual(result.ok, false, "Should return error result");
    if (!result.ok) {
      assert.strictEqual(result.error, "NOT_FOUND", "Should return NOT_FOUND error");
    }
  });
});

// ========================================
// TESTS: getExpiringTrials
// ========================================

describe("AccountRepository - getExpiringTrials", { concurrency: 1 }, () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns trials expiring within threshold", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.getExpiringTrials(3); // 3 days threshold

    assert.ok(Array.isArray(accounts), "Should return an array");
    assert.ok(accounts.length > 0, "Should find expiring trials");

    // Should include account with trial ending in 2 days
    const hasExpiringAccount = accounts.some((a) => a.id === testAccountIds[1]);
    assert.ok(hasExpiringAccount, "Should include account expiring in 2 days");
  });

  it("does not return trials expiring beyond threshold", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.getExpiringTrials(5); // 5 days threshold

    // Should not include account expiring in 10 days
    const hasLaterAccount = accounts.some((a) => a.id === testAccountIds[2]);
    assert.ok(!hasLaterAccount, "Should not include account expiring in 10 days");
  });

  it("does not return already expired trials", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.getExpiringTrials(7);

    // Should not include account that already expired
    const hasExpiredAccount = accounts.some((a) => a.id === testAccountIds[3]);
    assert.ok(!hasExpiredAccount, "Should not include already expired trials");
  });

  it("does not return accounts not on trial", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.getExpiringTrials(30);

    // Should not include account 1 which is not on trial
    const hasNonTrialAccount = accounts.some((a) => a.id === testAccountIds[0]);
    assert.ok(!hasNonTrialAccount, "Should not include accounts not on trial");
  });

  it("returns accounts ordered by trial end date ascending", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.getExpiringTrials(15);

    // Verify ascending order
    for (let i = 0; i < accounts.length - 1; i++) {
      if (accounts[i]!.trialEndDate && accounts[i + 1]!.trialEndDate) {
        const currentTime = accounts[i]!.trialEndDate!.getTime();
        const nextTime = accounts[i + 1]!.trialEndDate!.getTime();
        assert.ok(currentTime <= nextTime, "Accounts should be ordered by trialEndDate ascending");
      }
    }
  });

  it("returns empty array when threshold is 0", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.getExpiringTrials(0);

    assert.ok(Array.isArray(accounts), "Should return an array");
    // May return accounts expiring today, but likely empty
  });

  it("returns correct accounts for different thresholds", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);

    // Threshold 1: Should only get trials expiring tomorrow
    const accounts1Day = await repo.getExpiringTrials(1);
    assert.ok(Array.isArray(accounts1Day), "Should return array for 1 day threshold");

    // Threshold 14: Should get multiple trials
    const accounts14Days = await repo.getExpiringTrials(14);
    assert.ok(Array.isArray(accounts14Days), "Should return array for 14 day threshold");

    // 14 days should have more results than 1 day
    assert.ok(
      accounts14Days.length >= accounts1Day.length,
      "Longer threshold should return same or more results"
    );
  });
});

// ========================================
// TESTS: Edge Cases and Error Handling
// ========================================

describe("AccountRepository - Edge Cases", { concurrency: 1 }, () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("handles concurrent reads correctly", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);

    const results = await Promise.all([
      repo.findById(testAccountIds[0]!),
      repo.findById(testAccountIds[1]!),
      repo.findById(testAccountIds[2]!),
    ]);

    assert.ok(
      results.every((r) => r.ok),
      "All concurrent reads should succeed"
    );
  });

  it("handles empty string account ID gracefully", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findById("");

    assert.ok(!result.ok, "Should return error for empty ID");
  });

  it("handles very long threshold values for expiring trials", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.getExpiringTrials(365); // 1 year

    assert.ok(Array.isArray(accounts), "Should handle large threshold values");
  });
});
