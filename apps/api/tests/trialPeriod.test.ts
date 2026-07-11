/**
 * @file trialPeriod.test.ts
 * @description Tests for Trial Period Management
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { AuthService } from "../src/auth/authService.js";
import { MfaService } from "../src/admin/auth/MfaService.js";
import { PrismaAdminMfaUserRepository } from "../src/infrastructure/adapters/PrismaAdminMfaUserRepository.js";
import { PrismaCustomerMfaUserRepository } from "../src/infrastructure/adapters/PrismaCustomerMfaUserRepository.js";
import { prisma } from "@infra/prisma";
import { PrismaAdminUserRepository } from "../src/infrastructure/repositories/PrismaAdminUserRepository.js";
import { PrismaRoleRepository } from "../src/infrastructure/repositories/PrismaRoleRepository.js";
import { PrismaAdminSessionRepository } from "../src/infrastructure/repositories/PrismaAdminSessionRepository.js";
import { BillingService } from "@core/billing/BillingService.js";
import { SubscriptionPlanService } from "@core/billing/SubscriptionPlanService.js";
import { SubscriptionStatsService } from "@core/billing/SubscriptionStatsService.js";
import { SubscriptionManagementService } from "@core/billing/SubscriptionManagementService.js";
import { TrialManagementService } from "@core/billing/TrialManagementService.js";
import { SubscriptionService } from "@core/billing/SubscriptionService.js";
import { PrismaAccountQueryRepository } from "../src/infrastructure/repositories/PrismaAccountQueryRepository.js";
import { PrismaAccountRepository } from "../src/infrastructure/repositories/PrismaAccountRepository.js";
import { PrismaAccountSubscriptionAdapter } from "../src/infrastructure/repositories/PrismaAccountSubscriptionAdapter.js";
import { PrismaAccountSubscriptionQueryRepository } from "../src/infrastructure/repositories/PrismaAccountSubscriptionQueryRepository.js";
import { PrismaSubscriptionStatsQueryRepository } from "../src/infrastructure/repositories/PrismaSubscriptionStatsQueryRepository.js";
import { PrismaProjectQueryRepository } from "../src/infrastructure/repositories/PrismaProjectQueryRepository.js";
import { PrismaAuditLogRepository } from "../src/infrastructure/repositories/PrismaAuditLogRepository.js";
import { AuditEmitterAdapter } from "../src/services/AuditEmitterAdapter.js";

const adminUserRepo = new PrismaAdminUserRepository(prisma);
const roleRepo = new PrismaRoleRepository(prisma);
const sessionRepo = new PrismaAdminSessionRepository(prisma);
const mfaService = new MfaService(
  new PrismaAdminMfaUserRepository(prisma),
  new PrismaCustomerMfaUserRepository(prisma),
  new PrismaAuditLogRepository(prisma)
);
const authService = new AuthService(
  prisma,
  adminUserRepo,
  mfaService,
  roleRepo,
  sessionRepo,
  new PrismaAuditLogRepository(prisma)
);

// Build the subscription facade from real Prisma adapters (integration: real DB)
const auditEmitter = new AuditEmitterAdapter(new PrismaAuditLogRepository(prisma));
const billingSvc = new BillingService(auditEmitter);
const subQueryRepo = new PrismaAccountSubscriptionQueryRepository(prisma);
const acctQueryRepo = new PrismaAccountQueryRepository(prisma);
const planSvc = new SubscriptionPlanService(subQueryRepo);
const statsSvc = new SubscriptionStatsService(new PrismaSubscriptionStatsQueryRepository(prisma));
const managementSvc = new SubscriptionManagementService(
  acctQueryRepo,
  subQueryRepo,
  new PrismaAccountSubscriptionAdapter(prisma),
  new PrismaProjectQueryRepository(prisma),
  billingSvc,
  auditEmitter
);
const trialSvc = new TrialManagementService(
  new PrismaAccountRepository(prisma),
  acctQueryRepo,
  subQueryRepo,
  planSvc,
  billingSvc,
  auditEmitter
);
const subscriptionService = new SubscriptionService(
  planSvc,
  managementSvc,
  trialSvc,
  statsSvc,
  billingSvc
);

describe("Trial Period Management", () => {
  let superAdminUserId: string;
  let testAccountId: string;

  before(async () => {
    // Create super admin user for testing
    const superAdminResult = await authService.registerAdmin(
      `super-admin-trial-${Date.now()}@example.com`,
      "password123",
      "Super Admin User",
      "SUPER_ADMIN"
    );

    assert.ok(
      superAdminResult.ok,
      `Failed to create super admin user: ${superAdminResult.ok ? "" : superAdminResult.error}`
    );
    if (!superAdminResult.ok) return;
    superAdminUserId = superAdminResult.value.id;

    // Create test account with trial disabled initially
    const testAccount = await prisma.account.create({
      data: {
        email: `trial-test-account-${Date.now()}@example.com`,
        name: "Trial Test Account",
        isOnTrial: false, // Start with trial disabled so we can test startTrial()
        maxProjects: 1,
      },
    });

    testAccountId = testAccount.id;
  });

  after(async () => {
    // Cleanup test accounts
    try {
      if (superAdminUserId) {
        await prisma.adminUser.delete({ where: { id: superAdminUserId } });
      }
      if (testAccountId) {
        await prisma.account.delete({ where: { id: testAccountId } });
      }
    } catch (error) {
      console.warn("Cleanup warning:", error);
    }
  });

  describe("Trial Start", () => {
    it("should start trial for account", async () => {
      const result = await subscriptionService.startTrial(
        {
          accountId: testAccountId,
          tier: "PRO",
          trialDurationDays: 7,
          autoRenewal: true,
          billingCycle: "monthly",
        },
        superAdminUserId
      );

      assert.ok(result.ok, `Failed to start trial: ${result.ok ? "" : result.error}`);
      if (!result.ok) return;

      const subscription = result.value;
      assert.strictEqual(subscription.trial.isOnTrial, true, "Should be on trial");
      assert.strictEqual(subscription.trial.trialDaysRemaining, 7, "Should have 7 days remaining");
    });

    it("should prevent duplicate trial start", async () => {
      // Create a new test account
      const newAccount = await prisma.account.create({
        data: {
          email: `trial-duplicate-test-${Date.now()}@example.com`,
          name: "Trial Duplicate Test User",
          isOnTrial: false,
          maxProjects: 1,
        },
      });

      // Start trial
      const startResult = await subscriptionService.startTrial(
        {
          accountId: newAccount.id,
          tier: "PRO",
          trialDurationDays: 3,
          autoRenewal: false,
          billingCycle: "monthly",
        },
        superAdminUserId
      );

      assert.ok(startResult.ok, "First trial start should succeed");

      // Try to start trial again (should fail)
      const duplicateResult = await subscriptionService.startTrial(
        {
          accountId: newAccount.id,
          tier: "ENTERPRISE",
          trialDurationDays: 14,
          autoRenewal: true,
          billingCycle: "yearly",
        },
        superAdminUserId
      );

      assert.ok(!duplicateResult.ok, "Duplicate trial start should fail");
      if (duplicateResult.ok) return;
      assert.strictEqual(
        duplicateResult.error.code,
        "CONFLICT",
        "Should return CONFLICT error code (mapped from ALREADY_ON_TRIAL)"
      );

      // Clean up
      await prisma.account.delete({ where: { id: newAccount.id } });
    });

    it("should return NOT_FOUND for non-existent account", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const result = await subscriptionService.startTrial({
        accountId: fakeId,
        tier: "PRO",
        trialDurationDays: 7,
      });

      assert.ok(!result.ok, "Should fail for non-existent account");
      if (result.ok) return;
      assert.strictEqual(result.error.code, "NOT_FOUND", "Should return NOT_FOUND error");
    });
  });

  describe("Trial Conversion", () => {
    it("should convert trial to paid subscription", async () => {
      const result = await subscriptionService.convertTrialToPaid(
        testAccountId,
        "yearly",
        superAdminUserId
      );

      assert.ok(result.ok, `Failed to convert trial to paid: ${result.ok ? "" : result.error}`);
      if (!result.ok) return;

      const subscription = result.value;
      assert.strictEqual(
        subscription.trial.isOnTrial,
        false,
        "Should not be on trial after conversion"
      );
      assert.strictEqual(subscription.billing.autoRenewal, true, "Auto-renewal should be enabled");
      assert.strictEqual(
        subscription.billing.billingCycle,
        "yearly",
        "Billing cycle should be yearly"
      );
    });

    it("should return NOT_ON_TRIAL when converting account not on trial", async () => {
      const result = await subscriptionService.convertTrialToPaid(testAccountId);

      assert.ok(!result.ok, "Should fail for account not on trial");
      if (result.ok) return;
      assert.strictEqual(
        result.error.code,
        "VALIDATION_FAILED",
        "Should return VALIDATION_FAILED error"
      );
    });
  });

  describe("Trial End", () => {
    it("should end trial", async () => {
      // Create a new test account for ending trial
      const newAccount = await prisma.account.create({
        data: {
          email: `trial-end-test-${Date.now()}@example.com`,
          name: "Trial End Test User",
          isOnTrial: false,
          maxProjects: 1,
        },
      });

      // Start trial first
      const startResult = await subscriptionService.startTrial(
        {
          accountId: newAccount.id,
          tier: "PRO",
          trialDurationDays: 7,
          autoRenewal: false,
          billingCycle: "monthly",
        },
        superAdminUserId
      );

      assert.ok(
        startResult.ok,
        `Failed to start trial: ${startResult.ok ? "" : startResult.error}`
      );

      // End trial
      const endResult = await subscriptionService.endTrial(
        newAccount.id,
        "Testing trial end functionality",
        superAdminUserId
      );

      assert.ok(endResult.ok, `Failed to end trial: ${endResult.ok ? "" : endResult.error}`);
      if (!endResult.ok) return;

      const subscription = endResult.value;
      assert.strictEqual(subscription.trial.isOnTrial, false, "Should not be on trial");
      assert.strictEqual(
        subscription.trial.trialExpired,
        true,
        "Trial should be marked as expired"
      );

      // Clean up
      await prisma.account.delete({ where: { id: newAccount.id } });
    });

    it("should return NOT_ON_TRIAL when ending trial on account not on trial", async () => {
      const result = await subscriptionService.endTrial(testAccountId, "Test reason");

      assert.ok(!result.ok, "Should fail for account not on trial");
      if (result.ok) return;
      assert.strictEqual(
        result.error.code,
        "VALIDATION_FAILED",
        "Should return VALIDATION_FAILED error"
      );
    });
  });

  describe("Expiring Trials", () => {
    it("should retrieve expiring trials within specified days", async () => {
      // Create accounts with expiring trials
      const testAccounts = [];
      for (let i = 0; i < 3; i++) {
        const account = await prisma.account.create({
          data: {
            email: `expiring-trial-${i}-${Date.now()}@example.com`,
            name: `Expiring Trial User ${i}`,
            isOnTrial: false,
            maxProjects: 1,
          },
        });

        await subscriptionService.startTrial(
          {
            accountId: account.id,
            tier: "PRO",
            trialDurationDays: 1, // Expires in 1 day
            autoRenewal: false,
            billingCycle: "monthly",
          },
          superAdminUserId
        );

        testAccounts.push(account);
      }

      const result = await subscriptionService.getExpiringTrials(1);

      assert.ok(result.ok, `Failed to get expiring trials: ${result.ok ? "" : result.error}`);
      if (!result.ok) return;
      assert.ok(result.value.length >= 3, "Should find at least 3 expiring trials");

      // Clean up
      for (const account of testAccounts) {
        await prisma.account.delete({ where: { id: account.id } });
      }
    });
  });

  describe("Auto-Renewal Processing", () => {
    it("should process expired trials with auto-renewal", async () => {
      // Create account with expired trial and auto-renewal
      const account = await prisma.account.create({
        data: {
          email: `auto-renewal-test-${Date.now()}@example.com`,
          name: "Auto Renewal Test User",
          isOnTrial: true,
          trialStartDate: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // 8 days ago
          trialEndDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago (expired)
          maxProjects: 5,
          autoRenewal: true,
          billingCycle: "monthly",
        },
      });

      const result = await subscriptionService.processAutoRenewals();

      assert.ok(result.ok, `Failed to process auto-renewals: ${result.ok ? "" : result.error}`);
      if (!result.ok) return;

      const { processed, failed: _failed } = result.value;
      assert.ok(processed >= 1, "Should have processed at least 1 auto-renewal");

      // Check if account was properly renewed
      const updatedAccount = await prisma.account.findUnique({
        where: { id: account.id },
      });

      assert.ok(updatedAccount, "Account should exist");
      assert.strictEqual(
        updatedAccount.isOnTrial,
        false,
        "Should not be on trial after auto-renewal"
      );
      assert.ok(updatedAccount.lastBillingDate, "Should have last billing date");
      assert.ok(updatedAccount.nextBillingDate, "Should have next billing date");

      // Clean up
      await prisma.account.delete({ where: { id: account.id } });
    });
  });
});
