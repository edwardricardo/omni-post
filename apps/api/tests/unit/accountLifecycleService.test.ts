/**
 * Unit Tests for AccountLifecycleService (node:test)
 * Testing account creation, suspension, reactivation, and deletion
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { AccountLifecycleService } from "../../src/admin/accountLifecycleService.js";
import { prisma } from "@infra/prisma";
import { PrismaAdminUserRepository } from "../../src/infrastructure/repositories/PrismaAdminUserRepository.js";

// Instantiate service with injected Prisma repository (proper DI pattern)
const accountLifecycleService = new AccountLifecycleService(new PrismaAdminUserRepository(prisma));

const timestamp = Date.now();
let testAccountId: string;

describe("AccountLifecycleService", { concurrency: 1 }, () => {
  before(async () => {
    // Clean up any existing test data from previous runs
    await prisma.adminUser.deleteMany({
      where: {
        email: {
          contains: `test-lifecycle-${timestamp}`,
        },
      },
    });
  });

  after(async () => {
    // Clean up test data
    try {
      if (testAccountId) {
        // Delete sessions first due to foreign key constraint
        await prisma.adminSession.deleteMany({
          where: { userId: testAccountId },
        });

        // Update audit logs to remove user reference
        await prisma.auditLog.updateMany({
          where: { userId: testAccountId },
          data: { userId: null },
        });

        // Delete the user
        await prisma.adminUser
          .delete({
            where: { id: testAccountId },
          })
          .catch(() => {
            // Ignore if already deleted
          });
      }

      // Clean up any other test accounts
      await prisma.adminUser.deleteMany({
        where: {
          email: {
            contains: `test-lifecycle-${timestamp}`,
          },
        },
      });
    } catch (error) {
      console.error("Cleanup error:", error);
    }
  });

  describe("createAccount", () => {
    it("should create account successfully", async () => {
      const testEmail = `test-lifecycle-${timestamp}@example.com`;
      const createResult = await accountLifecycleService.createAccount({
        email: testEmail,
        password: "SecurePassword123!",
        name: "Test Lifecycle User",
        role: "ADMIN",
      });

      assert.strictEqual(createResult.ok, true);
      if (createResult.ok) {
        assert.strictEqual(createResult.value.email, testEmail.toLowerCase());
        assert.strictEqual(createResult.value.role, "ADMIN");
        testAccountId = createResult.value.id;
      }
    });

    it("should reject duplicate email", async () => {
      const testEmail = `test-lifecycle-${timestamp}@example.com`;
      const duplicateResult = await accountLifecycleService.createAccount({
        email: testEmail,
        password: "SecurePassword123!",
        name: "Duplicate User",
      });

      assert.strictEqual(duplicateResult.ok, false);
      if (!duplicateResult.ok) {
        assert.strictEqual(duplicateResult.error, "EMAIL_EXISTS");
      }
    });

    it("should reject weak password", async () => {
      const weakPasswordResult = await accountLifecycleService.createAccount({
        email: `weak-${timestamp}@example.com`,
        password: "weak",
        name: "Weak Password User",
      });

      assert.strictEqual(weakPasswordResult.ok, false);
      if (!weakPasswordResult.ok) {
        assert.strictEqual(weakPasswordResult.error, "VALIDATION_ERROR");
      }
    });
  });

  describe("getAccount", () => {
    it("should retrieve account successfully", async () => {
      const getResult = await accountLifecycleService.getAccount(testAccountId);

      assert.strictEqual(getResult.ok, true);
      if (getResult.ok) {
        assert.strictEqual(getResult.value.id, testAccountId);
        assert.strictEqual(getResult.value.email, `test-lifecycle-${timestamp}@example.com`);
      }
    });

    it("should return NOT_FOUND for non-existent account", async () => {
      const notFoundResult = await accountLifecycleService.getAccount("non-existent-id");

      assert.strictEqual(notFoundResult.ok, false);
      if (!notFoundResult.ok) {
        assert.strictEqual(notFoundResult.error, "NOT_FOUND");
      }
    });
  });

  describe("updateAccount", () => {
    it("should update account successfully", async () => {
      const updateResult = await accountLifecycleService.updateAccount(
        testAccountId,
        {
          name: "Updated Lifecycle User",
          role: "SUPPORT",
        },
        undefined
      );

      assert.strictEqual(updateResult.ok, true);
      if (updateResult.ok) {
        assert.strictEqual(updateResult.value.name, "Updated Lifecycle User");
        assert.strictEqual(updateResult.value.role, "SUPPORT");
      }
    });
  });

  describe("suspendAccount", () => {
    it("should suspend account successfully", async () => {
      const suspendResult = await accountLifecycleService.suspendAccount(
        testAccountId,
        "Test suspension",
        undefined
      );

      assert.strictEqual(suspendResult.ok, true);

      // Verify suspension by checking account
      const suspendedAccount = await accountLifecycleService.getAccount(testAccountId);
      assert.strictEqual(suspendedAccount.ok, true);
      if (suspendedAccount.ok) {
        assert.strictEqual(suspendedAccount.value.isActive, false);
      }
    });

    it("should detect already suspended account", async () => {
      const alreadySuspendedResult = await accountLifecycleService.suspendAccount(
        testAccountId,
        "Already suspended",
        undefined
      );

      assert.strictEqual(alreadySuspendedResult.ok, false);
      if (!alreadySuspendedResult.ok) {
        assert.strictEqual(alreadySuspendedResult.error, "ALREADY_SUSPENDED");
      }
    });
  });

  describe("reactivateAccount", () => {
    it("should reactivate account successfully", async () => {
      const reactivateResult = await accountLifecycleService.reactivateAccount(
        testAccountId,
        undefined
      );

      assert.strictEqual(reactivateResult.ok, true);

      // Verify reactivation by checking account
      const reactivatedAccount = await accountLifecycleService.getAccount(testAccountId);
      assert.strictEqual(reactivatedAccount.ok, true);
      if (reactivatedAccount.ok) {
        assert.strictEqual(reactivatedAccount.value.isActive, true);
      }
    });

    it("should detect already active account", async () => {
      const alreadyActiveResult = await accountLifecycleService.reactivateAccount(
        testAccountId,
        undefined
      );

      assert.strictEqual(alreadyActiveResult.ok, false);
      if (!alreadyActiveResult.ok) {
        assert.strictEqual(alreadyActiveResult.error, "ALREADY_ACTIVE");
      }
    });
  });

  describe("resetPassword", () => {
    it("should reset password successfully", async () => {
      const resetPasswordResult = await accountLifecycleService.resetPassword(
        testAccountId,
        {
          newPassword: "NewSecurePassword123!",
          requirePasswordChange: false,
        },
        undefined
      );

      assert.strictEqual(resetPasswordResult.ok, true);
    });
  });

  describe("getAccountStats", () => {
    it("should retrieve account stats successfully", async () => {
      const statsResult = await accountLifecycleService.getAccountStats();

      assert.strictEqual(statsResult.ok, true);
      if (statsResult.ok) {
        assert.ok(statsResult.value.totalAccounts >= 1);
        assert.strictEqual(typeof statsResult.value.activeAccounts, "number");
        assert.ok(statsResult.value.accountsByRole);
        assert.strictEqual(typeof statsResult.value.accountsByRole.SUPER_ADMIN, "number");
        assert.strictEqual(typeof statsResult.value.accountsByRole.ADMIN, "number");
        assert.strictEqual(typeof statsResult.value.accountsByRole.SUPPORT, "number");
      }
    });
  });

  describe("deleteAccount", () => {
    it("should delete account successfully", async () => {
      const deleteResult = await accountLifecycleService.deleteAccount(testAccountId, undefined);

      assert.strictEqual(deleteResult.ok, true);
    });

    it("should return NOT_FOUND after deletion", async () => {
      const afterDeleteResult = await accountLifecycleService.getAccount(testAccountId);

      assert.strictEqual(afterDeleteResult.ok, false);
      if (!afterDeleteResult.ok) {
        assert.strictEqual(afterDeleteResult.error, "NOT_FOUND");
      }
    });
  });
});
