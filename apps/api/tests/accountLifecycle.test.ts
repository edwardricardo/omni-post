/**
 * @file accountLifecycle.test.ts
 * @description Tests for Account Lifecycle Management
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { AccountLifecycleService } from "../src/admin/accountLifecycleService.js";
import { AuthService } from "../src/auth/authService.js";
import { MfaService } from "../src/auth/mfaService.js";
import { prisma } from "@infra/prisma";
import { PrismaAdminUserRepository } from "../src/infrastructure/repositories/PrismaAdminUserRepository.js";
import { PrismaAdminSessionRepository } from "../src/infrastructure/repositories/PrismaAdminSessionRepository.js";
import { PrismaRoleRepository } from "../src/infrastructure/repositories/PrismaRoleRepository.js";
import { PrismaAuditLogRepository } from "../src/infrastructure/repositories/PrismaAuditLogRepository.js";
import { AccountLifecycleQueryService } from "../src/admin/accountLifecycleQueryService.js";
import { AccountSessionService } from "../src/admin/AccountSessionService.js";
import { PrismaUnitOfWork } from "../src/infrastructure/unitofwork/PrismaUnitOfWork.js";

const adminUserRepo = new PrismaAdminUserRepository(prisma);
const sessionRepo = new PrismaAdminSessionRepository(prisma);
const roleRepo = new PrismaRoleRepository(prisma);
const auditLogRepo = new PrismaAuditLogRepository(prisma);
const mfaService = new MfaService(adminUserRepo, new PrismaAuditLogRepository(prisma));
const authService = new AuthService(
  prisma,
  adminUserRepo,
  mfaService,
  roleRepo,
  sessionRepo,
  new PrismaAuditLogRepository(prisma)
);
const accountLifecycleService = new AccountLifecycleService(
  adminUserRepo,
  sessionRepo,
  roleRepo,
  auditLogRepo,
  new AccountLifecycleQueryService(prisma),
  new AccountSessionService(adminUserRepo, sessionRepo, new PrismaAuditLogRepository(prisma)),
  new PrismaUnitOfWork(prisma)
);

describe("Account Lifecycle Management", () => {
  let superAdminUserId: string;
  let adminUserId: string;
  let testAccountId: string;

  before(async () => {
    // Create super admin user for testing
    const superAdminResult = await authService.registerAdmin(
      `super-admin-${Date.now()}@example.com`,
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

    // Create regular admin user for testing
    const adminResult = await authService.registerAdmin(
      `admin-${Date.now()}@example.com`,
      "password123",
      "Admin User",
      "ADMIN"
    );

    assert.ok(
      adminResult.ok,
      `Failed to create admin user: ${adminResult.ok ? "" : adminResult.error}`
    );
    if (!adminResult.ok) return;
    adminUserId = adminResult.value.id;
  });

  after(async () => {
    // Cleanup test accounts
    try {
      if (superAdminUserId) {
        await prisma.adminUser.delete({ where: { id: superAdminUserId } }).catch(() => {});
      }
      if (adminUserId) {
        await prisma.adminUser.delete({ where: { id: adminUserId } }).catch(() => {});
      }
      if (testAccountId) {
        // May already be deleted by the delete test
        await prisma.adminUser.delete({ where: { id: testAccountId } }).catch(() => {});
      }
    } catch (error) {
      console.warn("Cleanup warning:", error);
    }
  });

  describe("Account Creation", () => {
    it("should create a new account with valid data", async () => {
      const result = await accountLifecycleService.createAccount(
        {
          email: `test-user-${Date.now()}@example.com`,
          password: "password123",
          name: "Test User",
          role: "ADMIN",
        },
        superAdminUserId
      );

      assert.ok(result.ok, `Account creation failed: ${result.ok ? "" : result.error}`);
      if (!result.ok) return;
      testAccountId = result.value.id;

      assert.ok(result.value.email, "Email should be present");
      assert.ok(result.value.name, "Name should be present");
      assert.strictEqual(result.value.role, "ADMIN", "Role should be ADMIN");
    });

    it("should reject duplicate email addresses", async () => {
      const existingAccount = await accountLifecycleService.getAccount(testAccountId);
      assert.ok(existingAccount.ok, "Could not get existing account for test");
      if (!existingAccount.ok) return;

      const result = await accountLifecycleService.createAccount({
        email: existingAccount.value.email,
        password: "password123",
        name: "Duplicate User",
      });

      assert.ok(!result.ok, "Should fail with duplicate email");
      if (result.ok) return;
      assert.strictEqual(result.error, "EMAIL_EXISTS", "Should return EMAIL_EXISTS error");
    });

    it("should reject invalid password (too short)", async () => {
      const result = await accountLifecycleService.createAccount({
        email: `validation-test-${Date.now()}@example.com`,
        password: "123", // Too short
        name: "Test User",
      });

      assert.ok(!result.ok, "Should fail with short password");
      if (result.ok) return;
      assert.strictEqual(result.error, "VALIDATION_ERROR", "Should return VALIDATION_ERROR");
    });
  });

  describe("Account Retrieval", () => {
    it("should get account by ID", async () => {
      const result = await accountLifecycleService.getAccount(testAccountId);

      assert.ok(result.ok, `Failed to get account: ${result.ok ? "" : result.error}`);
      if (!result.ok) return;
      assert.strictEqual(result.value.id, testAccountId, "Retrieved wrong account");
    });

    it("should return NOT_FOUND for non-existent account", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const result = await accountLifecycleService.getAccount(fakeId);

      assert.ok(!result.ok, "Should fail for non-existent account");
      if (result.ok) return;
      assert.strictEqual(result.error, "NOT_FOUND", "Should return NOT_FOUND error");
    });
  });

  describe("Account Update", () => {
    it("should update account name and role", async () => {
      const result = await accountLifecycleService.updateAccount(
        testAccountId,
        {
          name: "Updated Test User",
          role: "SUPPORT",
        },
        superAdminUserId
      );

      assert.ok(result.ok, `Account update failed: ${result.ok ? "" : result.error}`);
      if (!result.ok) return;
      assert.strictEqual(result.value.name, "Updated Test User", "Name should be updated");
      assert.strictEqual(result.value.role, "SUPPORT", "Role should be updated");
    });

    it("should return NOT_FOUND when updating non-existent account", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const result = await accountLifecycleService.updateAccount(fakeId, { name: "New Name" });

      assert.ok(!result.ok, "Should fail for non-existent account");
      if (result.ok) return;
      assert.strictEqual(result.error, "NOT_FOUND", "Should return NOT_FOUND error");
    });
  });

  describe("Account Suspension and Reactivation", () => {
    it("should suspend account", async () => {
      const result = await accountLifecycleService.suspendAccount(
        testAccountId,
        "Testing suspension functionality",
        superAdminUserId
      );

      assert.ok(result.ok, `Account suspension failed: ${result.ok ? "" : result.error}`);

      // Verify account is suspended
      const getResult = await accountLifecycleService.getAccount(testAccountId);
      assert.ok(getResult.ok, "Failed to get account after suspension");
      if (!getResult.ok) return;
      assert.strictEqual(getResult.value.isActive, false, "Account should be inactive");
    });

    it("should reactivate suspended account", async () => {
      const result = await accountLifecycleService.reactivateAccount(
        testAccountId,
        superAdminUserId
      );

      assert.ok(result.ok, `Account reactivation failed: ${result.ok ? "" : result.error}`);

      // Verify account is reactivated
      const getResult = await accountLifecycleService.getAccount(testAccountId);
      assert.ok(getResult.ok, "Failed to get account after reactivation");
      if (!getResult.ok) return;
      assert.strictEqual(getResult.value.isActive, true, "Account should be active");
    });
  });

  describe("Password Management", () => {
    it("should reset account password", async () => {
      const result = await accountLifecycleService.resetPassword(
        testAccountId,
        {
          newPassword: "newPassword123",
          requirePasswordChange: true,
        },
        superAdminUserId
      );

      assert.ok(result.ok, `Password reset failed: ${result.ok ? "" : result.error}`);
    });
  });

  describe("Account Listing", () => {
    it("should list accounts with role filter", async () => {
      const result = await accountLifecycleService.listAccounts({
        role: "SUPPORT",
      });

      assert.ok(result.ok, `Failed to list accounts: ${result.ok ? "" : result.error}`);
      if (!result.ok) return;
      assert.ok(
        result.value.accounts.length > 0,
        "Should find at least one account with SUPPORT role"
      );

      // Find our test account
      const testAccount = result.value.accounts.find((acc) => acc.id === testAccountId);
      assert.ok(testAccount, "Test account should be in filtered results");
      assert.strictEqual(testAccount.role, "SUPPORT", "Account role should be SUPPORT");
    });
  });

  describe("Account Statistics", () => {
    it("should retrieve account statistics", async () => {
      const result = await accountLifecycleService.getAccountStats();

      assert.ok(result.ok, `Failed to get account stats: ${result.ok ? "" : result.error}`);
      if (!result.ok) return;

      const stats = result.value;
      assert.ok(stats.totalAccounts >= 1, "Should have at least 1 total account");
      assert.ok(stats.activeAccounts >= 0, "Active accounts should be non-negative");
      assert.ok(stats.accountsByRole, "Should have accountsByRole statistics");
    });
  });

  describe("Session Management", () => {
    it("should retrieve account sessions", async () => {
      const result = await accountLifecycleService.getAccountSessions(testAccountId);

      assert.ok(result.ok, `Failed to get account sessions: ${result.ok ? "" : result.error}`);
      if (!result.ok) return;
      assert.ok(Array.isArray(result.value), "Sessions should be an array");
    });

    it("should revoke all sessions for account", async () => {
      const result = await accountLifecycleService.revokeAllSessions(
        testAccountId,
        superAdminUserId
      );

      assert.ok(result.ok, `Failed to revoke sessions: ${result.ok ? "" : result.error}`);
      if (!result.ok) return;
      assert.ok(typeof result.value === "number", "Should return number of revoked sessions");
    });
  });

  describe("Account Deletion", () => {
    it("should delete account", async () => {
      const result = await accountLifecycleService.deleteAccount(testAccountId, superAdminUserId);

      assert.ok(result.ok, `Account deletion failed: ${result.ok ? "" : result.error}`);

      // Verify account is deleted
      const getResult = await accountLifecycleService.getAccount(testAccountId);
      assert.ok(!getResult.ok, "Account should not exist after deletion");
      if (getResult.ok) return;
      assert.strictEqual(getResult.error, "NOT_FOUND", "Should return NOT_FOUND error");
    });
  });
});
