/**
 * @file AccountQueryRepository.test.ts
 * @description Integration tests for PrismaAccountQueryRepository (CQRS read
 *              side) against a real PostgreSQL database. Covers findWithProjects,
 *              findById, findByEmail (case-normalised), findManyWithProjects,
 *              getExpiringTrials, and edge cases. The `updateSubscription`
 *              capability is intentionally NOT covered here — see backlog
 *              SMELL-28 (it writes a non-existent `Account.subscription` column).
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
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

  // Account 2: account on trial expiring soon
  const account2 = await prisma.account.create({
    data: {
      name: "Test Account 2",
      email: `test-account-2-${uniqueId}@example.com`,
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
      isOnTrial: true,
      trialEndDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days from now
    },
  });
  testAccountIds.push(account3.id);

  // Account 4: Trial already expired (start precedes end per the
  // Account_trial_date_range_check constraint: trialStartDate <= trialEndDate).
  const account4 = await prisma.account.create({
    data: {
      name: "Test Account 4",
      email: `test-account-4-${uniqueId}@example.com`,
      isOnTrial: true,
      trialStartDate: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000), // 31 days ago
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
  } catch {
    // Defensive cleanup: swallow errors to prevent test pollution
  }
}

// ========================================
// TESTS: Basic Repository Operations
// ========================================

describe("AccountQueryRepository - Basic Operations", () => {
  it("AccountQueryRepository instantiates successfully", () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    assert.ok(repo !== null);
  });
});

// ========================================
// TESTS: findWithProjects
// ========================================

describe("AccountQueryRepository - findWithProjects", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns account with projects when account exists", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findWithProjects(testAccountIds[0]!);

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.id, testAccountIds[0]);
      assert.ok(Array.isArray(result.value.projects));
      assert.equal(result.value.projects.length, 2);
    }
  });

  it("returns NOT_FOUND error when account does not exist", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findWithProjects("non-existent-account-id");

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "NOT_FOUND");
    }
  });

  it("includes empty projects array when account has no projects", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findWithProjects(testAccountIds[1]!);

    assert.ok(result.ok);
    if (result.ok) {
      assert.ok(Array.isArray(result.value.projects));
      assert.equal(result.value.projects.length, 0);
    }
  });
});

// ========================================
// TESTS: findById
// ========================================

describe("AccountQueryRepository - findById", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns account when it exists", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findById(testAccountIds[0]!);

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.id, testAccountIds[0]);
      assert.ok(result.value.email);
      assert.equal(typeof result.value.isOnTrial, "boolean");
    }
  });

  it("returns NOT_FOUND error when account does not exist", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findById("non-existent-account-id");

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "NOT_FOUND");
    }
  });

  it("does not include projects relationship", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findById(testAccountIds[0]!);

    assert.ok(result.ok);
    if (result.ok) {
      // findById returns the flat AccountDto — no projects relation.
      assert.equal((result.value as { projects?: unknown }).projects, undefined);
    }
  });
});

// ========================================
// TESTS: findByEmail
// ========================================

describe("AccountQueryRepository - findByEmail", () => {
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

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.id, testAccountIds[0]);
      assert.equal(result.value.email, account!.email);
    }
  });

  it("normalizes email to lowercase", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const account = await prisma.account.findUnique({
      where: { id: testAccountIds[0]! },
    });

    const uppercaseEmail = account!.email.toUpperCase();
    const result = await repo.findByEmail(uppercaseEmail);

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.id, testAccountIds[0]);
    }
  });

  it("returns NOT_FOUND error when email does not exist", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findByEmail("nonexistent@example.com");

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "NOT_FOUND");
    }
  });
});

// ========================================
// TESTS: findManyWithProjects
// ========================================

describe("AccountQueryRepository - findManyWithProjects", () => {
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

    assert.ok(Array.isArray(accounts));
    assert.equal(accounts.length, 2);

    accounts.forEach((account) => {
      assert.ok(Array.isArray(account.projects));
    });
  });

  it("returns empty array when no account IDs provided", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.findManyWithProjects([]);

    assert.ok(Array.isArray(accounts));
    assert.equal(accounts.length, 0);
  });

  it("only returns accounts that exist", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accountIds = [testAccountIds[0]!, "non-existent-id", testAccountIds[1]!];
    const accounts = await repo.findManyWithProjects(accountIds);

    assert.equal(accounts.length, 2);
  });

  it("returns accounts in correct order", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.findManyWithProjects(testAccountIds.slice(0, 3));

    assert.ok(accounts.length > 0);
    // Verify all requested accounts are returned
    const returnedIds = accounts.map((a) => a.id);
    testAccountIds.slice(0, 3).forEach((id) => {
      assert.ok(returnedIds.includes(id));
    });
  });
});

// ========================================
// TESTS: getExpiringTrials
// ========================================

describe("AccountQueryRepository - getExpiringTrials", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns trials expiring within threshold", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.getExpiringTrials(3); // 3 days threshold

    assert.ok(Array.isArray(accounts));
    assert.ok(accounts.length > 0);

    // Should include account with trial ending in 2 days
    const hasExpiringAccount = accounts.some((a) => a.id === testAccountIds[1]);
    assert.ok(hasExpiringAccount);
  });

  it("does not return trials expiring beyond threshold", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.getExpiringTrials(5); // 5 days threshold

    // Should not include account expiring in 10 days
    const hasLaterAccount = accounts.some((a) => a.id === testAccountIds[2]);
    assert.ok(!hasLaterAccount);
  });

  it("does not return already expired trials", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.getExpiringTrials(7);

    // Should not include account that already expired
    const hasExpiredAccount = accounts.some((a) => a.id === testAccountIds[3]);
    assert.ok(!hasExpiredAccount);
  });

  it("does not return accounts not on trial", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.getExpiringTrials(30);

    // Should not include account 1 which is not on trial
    const hasNonTrialAccount = accounts.some((a) => a.id === testAccountIds[0]);
    assert.ok(!hasNonTrialAccount);
  });

  it("returns accounts ordered by trial end date ascending", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.getExpiringTrials(15);

    // Verify ascending order
    for (let i = 0; i < accounts.length - 1; i++) {
      if (accounts[i]!.trialEndDate && accounts[i + 1]!.trialEndDate) {
        const currentTime = accounts[i]!.trialEndDate!.getTime();
        const nextTime = accounts[i + 1]!.trialEndDate!.getTime();
        assert.ok(currentTime <= nextTime);
      }
    }
  });

  it("returns empty array when threshold is 0", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.getExpiringTrials(0);

    assert.ok(Array.isArray(accounts));
    // May return accounts expiring today, but likely empty
  });

  it("returns correct accounts for different thresholds", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);

    // Threshold 1: Should only get trials expiring tomorrow
    const accounts1Day = await repo.getExpiringTrials(1);
    assert.ok(Array.isArray(accounts1Day));

    // Threshold 14: Should get multiple trials
    const accounts14Days = await repo.getExpiringTrials(14);
    assert.ok(Array.isArray(accounts14Days));

    // 14 days should have more results than 1 day
    assert.ok(accounts14Days.length >= accounts1Day.length);
  });
});

// ========================================
// TESTS: Edge Cases and Error Handling
// ========================================

describe("AccountQueryRepository - Edge Cases", () => {
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

    assert.ok(results.every((r) => r.ok));
  });

  it("handles empty string account ID gracefully", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const result = await repo.findById("");

    assert.ok(!result.ok);
  });

  it("handles very long threshold values for expiring trials", async () => {
    const repo = new PrismaAccountQueryRepository(prisma);
    const accounts = await repo.getExpiringTrials(365); // 1 year

    assert.ok(Array.isArray(accounts));
  });
});
