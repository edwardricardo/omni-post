/**
 * @file accountLifecycle.integration.test.ts
 * @description Tests for Account Lifecycle Management
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AccountLifecycleService } from "../src/admin/accountLifecycleService.js";
import type { AccountProfile, CreateAccountRequest } from "../src/admin/accountLifecycleTypes.js";
import { AuthService } from "../src/auth/authService.js";
import { MfaService } from "../src/admin/auth/MfaService.js";
import { PrismaAdminMfaUserRepository } from "../src/infrastructure/adapters/PrismaAdminMfaUserRepository.js";
import { PrismaCustomerMfaUserRepository } from "../src/infrastructure/adapters/PrismaCustomerMfaUserRepository.js";
import { PrismaAdminUserRepository } from "../src/infrastructure/repositories/PrismaAdminUserRepository.js";
import { PrismaAdminSessionRepository } from "../src/infrastructure/repositories/PrismaAdminSessionRepository.js";
import { PrismaRoleRepository } from "../src/infrastructure/repositories/PrismaRoleRepository.js";
import { PrismaAuditLogRepository } from "../src/infrastructure/repositories/PrismaAuditLogRepository.js";
import { AccountLifecycleQueryService } from "../src/admin/accountLifecycleQueryService.js";
import { AccountSessionService } from "../src/admin/AccountSessionService.js";
import { PrismaUnitOfWork } from "@adapters/db-prisma";
import { ambientTenantContextProvider } from "../src/security/tenantContext.js";
import { createSeedPrismaClient } from "./integration/helpers/seedPrismaClient.js";

/**
 * Fixture channel. The subject is the lifecycle API over HTTP; this client only plants the
 * accounts it acts on and reads back what it did.
 */
const prisma = createSeedPrismaClient();

const adminUserRepo = new PrismaAdminUserRepository(prisma);
const sessionRepo = new PrismaAdminSessionRepository(prisma);
const roleRepo = new PrismaRoleRepository(prisma);
const auditLogRepo = new PrismaAuditLogRepository(prisma);
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
const accountLifecycleService = new AccountLifecycleService(
  adminUserRepo,
  sessionRepo,
  roleRepo,
  auditLogRepo,
  new AccountLifecycleQueryService(prisma),
  new AccountSessionService(adminUserRepo, sessionRepo, new PrismaAuditLogRepository(prisma)),
  new PrismaUnitOfWork(prisma, ambientTenantContextProvider)
);

/**
 * Every role name the suite assigns. Registration and role changes resolve a role by name,
 * so each must exist before the first account is created, whatever the database holds.
 */
const ROLE_NAMES = ["SUPER_ADMIN", "ADMIN", "SUPPORT"] as const;

describe("Account Lifecycle Management", () => {
  let superAdminUserId: string;
  /** Every admin account the suite created, removed once the suite ends. */
  const createdAccountIds: string[] = [];
  /** The roles the suite had to create because the database lacked them. */
  const createdRoleIds: string[] = [];

  /**
   * Creates one admin account through the lifecycle API for the calling test alone, so no
   * test reads an account another test renamed, suspended or deleted, whatever order the
   * tests run in.
   */
  async function createTestAccount(
    overrides: Partial<CreateAccountRequest> = {}
  ): Promise<AccountProfile> {
    const result = await accountLifecycleService.createAccount(
      {
        email: `lifecycle-${randomUUID()}@example.com`,
        password: "password123",
        name: "Test User",
        role: "ADMIN",
        ...overrides,
      },
      superAdminUserId
    );
    assert.ok(result.ok, `Account creation failed: ${result.ok ? "" : result.error}`);
    createdAccountIds.push(result.value.id);
    return result.value;
  }

  before(async () => {
    for (const name of ROLE_NAMES) {
      const existing = await prisma.role.findUnique({ where: { name } });
      if (!existing) {
        const created = await prisma.role.create({ data: { name } });
        createdRoleIds.push(created.id);
      }
    }

    // Create super admin user for testing
    const superAdminResult = await authService.registerAdmin(
      `super-admin-${randomUUID()}@example.com`,
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
    createdAccountIds.push(superAdminUserId);

    // Create regular admin user for testing
    const adminResult = await authService.registerAdmin(
      `admin-${randomUUID()}@example.com`,
      "password123",
      "Admin User",
      "ADMIN"
    );

    assert.ok(
      adminResult.ok,
      `Failed to create admin user: ${adminResult.ok ? "" : adminResult.error}`
    );
    if (!adminResult.ok) return;
    createdAccountIds.push(adminResult.value.id);
  });

  after(async () => {
    // Accounts first: a role cannot be removed while an account still holds it.
    await prisma.adminUser.deleteMany({ where: { id: { in: createdAccountIds } } });
    await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
  });

  describe("Account Creation", () => {
    it("should create a new account with valid data", async () => {
      const result = await accountLifecycleService.createAccount(
        {
          email: `test-user-${randomUUID()}@example.com`,
          password: "password123",
          name: "Test User",
          role: "ADMIN",
        },
        superAdminUserId
      );

      assert.ok(result.ok, `Account creation failed: ${result.ok ? "" : result.error}`);
      if (!result.ok) return;
      createdAccountIds.push(result.value.id);

      assert.ok(result.value.email, "Email should be present");
      assert.ok(result.value.name, "Name should be present");
      assert.strictEqual(result.value.role, "ADMIN", "Role should be ADMIN");
    });

    it("should reject duplicate email addresses", async () => {
      const existingAccount = await createTestAccount();

      const result = await accountLifecycleService.createAccount({
        email: existingAccount.email,
        password: "password123",
        name: "Duplicate User",
      });

      assert.ok(!result.ok, "Should fail with duplicate email");
      if (result.ok) return;
      assert.strictEqual(result.error, "EMAIL_EXISTS", "Should return EMAIL_EXISTS error");
    });

    it("should reject invalid password (too short)", async () => {
      const result = await accountLifecycleService.createAccount({
        email: `validation-test-${randomUUID()}@example.com`,
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
      const account = await createTestAccount();

      const result = await accountLifecycleService.getAccount(account.id);

      assert.ok(result.ok, `Failed to get account: ${result.ok ? "" : result.error}`);
      if (!result.ok) return;
      assert.strictEqual(result.value.id, account.id, "Retrieved wrong account");
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
      const account = await createTestAccount();

      const result = await accountLifecycleService.updateAccount(
        account.id,
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
      const account = await createTestAccount();

      const result = await accountLifecycleService.suspendAccount(
        account.id,
        "Testing suspension functionality",
        superAdminUserId
      );

      assert.ok(result.ok, `Account suspension failed: ${result.ok ? "" : result.error}`);

      // Verify account is suspended
      const getResult = await accountLifecycleService.getAccount(account.id);
      assert.ok(getResult.ok, "Failed to get account after suspension");
      if (!getResult.ok) return;
      assert.strictEqual(getResult.value.isActive, false, "Account should be inactive");
    });

    it("should reactivate suspended account", async () => {
      const account = await createTestAccount();
      const suspension = await accountLifecycleService.suspendAccount(
        account.id,
        "Suspended so the reactivation has an inactive account to act on",
        superAdminUserId
      );
      assert.ok(
        suspension.ok,
        `Arranging the suspension failed: ${suspension.ok ? "" : suspension.error}`
      );

      const result = await accountLifecycleService.reactivateAccount(account.id, superAdminUserId);

      assert.ok(result.ok, `Account reactivation failed: ${result.ok ? "" : result.error}`);

      // Verify account is reactivated
      const getResult = await accountLifecycleService.getAccount(account.id);
      assert.ok(getResult.ok, "Failed to get account after reactivation");
      if (!getResult.ok) return;
      assert.strictEqual(getResult.value.isActive, true, "Account should be active");
    });
  });

  describe("Password Management", () => {
    it("should reset account password", async () => {
      const account = await createTestAccount();

      const result = await accountLifecycleService.resetPassword(
        account.id,
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
      const account = await createTestAccount({ role: "SUPPORT" });

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
      const testAccount = result.value.accounts.find((acc) => acc.id === account.id);
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
      const account = await createTestAccount();

      const result = await accountLifecycleService.getAccountSessions(account.id);

      assert.ok(result.ok, `Failed to get account sessions: ${result.ok ? "" : result.error}`);
      if (!result.ok) return;
      assert.ok(Array.isArray(result.value), "Sessions should be an array");
    });

    it("should revoke all sessions for account", async () => {
      const account = await createTestAccount();

      const result = await accountLifecycleService.revokeAllSessions(account.id, superAdminUserId);

      assert.ok(result.ok, `Failed to revoke sessions: ${result.ok ? "" : result.error}`);
      if (!result.ok) return;
      assert.ok(typeof result.value === "number", "Should return number of revoked sessions");
    });
  });

  describe("Account Deletion", () => {
    it("should delete account", async () => {
      const account = await createTestAccount();

      const result = await accountLifecycleService.deleteAccount(account.id, superAdminUserId);

      assert.ok(result.ok, `Account deletion failed: ${result.ok ? "" : result.error}`);

      // Verify account is deleted
      const getResult = await accountLifecycleService.getAccount(account.id);
      assert.ok(!getResult.ok, "Account should not exist after deletion");
      if (getResult.ok) return;
      assert.strictEqual(getResult.error, "NOT_FOUND", "Should return NOT_FOUND error");
    });
  });
});
