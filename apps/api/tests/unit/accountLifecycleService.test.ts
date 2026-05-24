/**
 * @file accountLifecycleService.test.ts
 * @description Unit tests for AccountLifecycleService.
 *              Uses in-memory mocked Prisma stores — no real database needed.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";
import { createMockPrismaModule } from "./helpers/mockPrisma.js";
import { InMemoryAuditLogRepository } from "./helpers/InMemoryAuditLogRepository.js";

// ---------------------------------------------------------------------------
// Mock setup — must come BEFORE any SUT imports
// ---------------------------------------------------------------------------

const { mockPrisma, stores } = createMockPrismaModule();

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
});

vi.mock("../../src/lib/logger.js", () => {
  const noop = vi.fn();
  const noopLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => noopLogger,
  };
  return {
    logger: noopLogger,
    authLogger: noopLogger,
    createLogger: () => noopLogger,
  };
});

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

const { AccountLifecycleService } = await import("../../src/admin/accountLifecycleService.js");
const { AccountLifecycleQueryService } =
  await import("../../src/admin/accountLifecycleQueryService.js");
const { AccountSessionService } = await import("../../src/admin/AccountSessionService.js");
const { PrismaAdminUserRepository } =
  await import("../../src/infrastructure/repositories/PrismaAdminUserRepository.js");
const { PrismaAdminSessionRepository } =
  await import("../../src/infrastructure/repositories/PrismaAdminSessionRepository.js");
const { PrismaRoleRepository } =
  await import("../../src/infrastructure/repositories/PrismaRoleRepository.js");
const { PrismaAuditLogRepository } =
  await import("../../src/infrastructure/repositories/PrismaAuditLogRepository.js");

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("AccountLifecycleService", () => {
  let accountLifecycleService: InstanceType<typeof AccountLifecycleService>;
  let testAccountId: string;

  beforeEach(() => {
    stores.adminUser.clear();
    stores.adminSession.clear();
    stores.auditLog.clear();

    // Recreate service each run with fresh mock prisma
    const adminUserRepo = new PrismaAdminUserRepository(mockPrisma.prisma as never);
    const sessionRepo = new PrismaAdminSessionRepository(mockPrisma.prisma as never);
    const roleRepo = new PrismaRoleRepository(mockPrisma.prisma as never);
    const auditLogRepo = new PrismaAuditLogRepository(mockPrisma.prisma as never);
    const queryService = new AccountLifecycleQueryService(mockPrisma.prisma as never);
    const sessionService = new AccountSessionService(
      adminUserRepo,
      sessionRepo,
      new InMemoryAuditLogRepository()
    );
    accountLifecycleService = new AccountLifecycleService(
      adminUserRepo,
      sessionRepo,
      roleRepo,
      auditLogRepo,
      queryService,
      sessionService
    );
  });

  describe("createAccount", () => {
    it("should create account successfully", async () => {
      const testEmail = `test-lifecycle-${Date.now()}@example.com`;
      const createResult = await accountLifecycleService.createAccount({
        email: testEmail,
        password: "SecurePassword123!",
        name: "Test Lifecycle User",
        role: "ADMIN",
      });

      expect(createResult.ok).toBe(true);
      if (createResult.ok) {
        expect(createResult.value.email).toBe(testEmail.toLowerCase());
        expect(createResult.value.role).toBe("ADMIN");
        testAccountId = createResult.value.id;
      }
    });

    it("should reject duplicate email", async () => {
      const testEmail = `test-lifecycle-dup@example.com`;
      // Create first
      await accountLifecycleService.createAccount({
        email: testEmail,
        password: "SecurePassword123!",
        name: "First User",
        role: "ADMIN",
      });

      // Attempt duplicate
      const duplicateResult = await accountLifecycleService.createAccount({
        email: testEmail,
        password: "SecurePassword123!",
        name: "Duplicate User",
      });

      expect(duplicateResult.ok).toBe(false);
      if (!duplicateResult.ok) {
        expect(duplicateResult.error).toBe("EMAIL_EXISTS");
      }
    });

    it("should reject weak password", async () => {
      const weakPasswordResult = await accountLifecycleService.createAccount({
        email: `weak-${Date.now()}@example.com`,
        password: "weak",
        name: "Weak Password User",
      });

      expect(weakPasswordResult.ok).toBe(false);
      if (!weakPasswordResult.ok) {
        expect(weakPasswordResult.error).toBe("VALIDATION_ERROR");
      }
    });
  });

  describe("getAccount", () => {
    it("should retrieve account successfully", async () => {
      const testEmail = `test-get-${Date.now()}@example.com`;
      const createResult = await accountLifecycleService.createAccount({
        email: testEmail,
        password: "SecurePassword123!",
        name: "Test Lifecycle User",
        role: "ADMIN",
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      testAccountId = createResult.value.id;

      const getResult = await accountLifecycleService.getAccount(testAccountId);

      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value.id).toBe(testAccountId);
        expect(getResult.value.email).toBe(testEmail.toLowerCase());
      }
    });

    it("should return NOT_FOUND for non-existent account", async () => {
      const notFoundResult = await accountLifecycleService.getAccount("non-existent-id");

      expect(notFoundResult.ok).toBe(false);
      if (!notFoundResult.ok) {
        expect(notFoundResult.error).toBe("NOT_FOUND");
      }
    });
  });

  describe("updateAccount", () => {
    it("should update account successfully", async () => {
      // Create account first
      const createResult = await accountLifecycleService.createAccount({
        email: `test-update-${Date.now()}@example.com`,
        password: "SecurePassword123!",
        name: "Original Name",
        role: "ADMIN",
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      testAccountId = createResult.value.id;

      const updateResult = await accountLifecycleService.updateAccount(
        testAccountId,
        {
          name: "Updated Lifecycle User",
          role: "SUPPORT",
        },
        undefined
      );

      expect(updateResult.ok).toBe(true);
      if (updateResult.ok) {
        expect(updateResult.value.name).toBe("Updated Lifecycle User");
        expect(updateResult.value.role).toBe("SUPPORT");
      }
    });
  });

  describe("suspendAccount", () => {
    it("should suspend account successfully", async () => {
      const createResult = await accountLifecycleService.createAccount({
        email: `test-suspend-${Date.now()}@example.com`,
        password: "SecurePassword123!",
        name: "Suspend Test",
        role: "ADMIN",
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      testAccountId = createResult.value.id;

      const suspendResult = await accountLifecycleService.suspendAccount(
        testAccountId,
        "Test suspension",
        undefined
      );

      expect(suspendResult.ok).toBe(true);

      // Verify suspension by checking account
      const suspendedAccount = await accountLifecycleService.getAccount(testAccountId);
      expect(suspendedAccount.ok).toBe(true);
      if (suspendedAccount.ok) {
        expect(suspendedAccount.value.isActive).toBe(false);
      }
    });

    it("should detect already suspended account", async () => {
      const createResult = await accountLifecycleService.createAccount({
        email: `test-already-suspended-${Date.now()}@example.com`,
        password: "SecurePassword123!",
        name: "Already Suspended",
        role: "ADMIN",
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      testAccountId = createResult.value.id;

      // Suspend first time
      await accountLifecycleService.suspendAccount(testAccountId, "First suspend", undefined);

      // Try again
      const alreadySuspendedResult = await accountLifecycleService.suspendAccount(
        testAccountId,
        "Already suspended",
        undefined
      );

      expect(alreadySuspendedResult.ok).toBe(false);
      if (!alreadySuspendedResult.ok) {
        expect(alreadySuspendedResult.error).toBe("ALREADY_SUSPENDED");
      }
    });
  });

  describe("reactivateAccount", () => {
    it("should reactivate account successfully", async () => {
      const createResult = await accountLifecycleService.createAccount({
        email: `test-reactivate-${Date.now()}@example.com`,
        password: "SecurePassword123!",
        name: "Reactivate Test",
        role: "ADMIN",
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      testAccountId = createResult.value.id;

      // Suspend first
      await accountLifecycleService.suspendAccount(testAccountId, "To reactivate", undefined);

      const reactivateResult = await accountLifecycleService.reactivateAccount(
        testAccountId,
        undefined
      );

      expect(reactivateResult.ok).toBe(true);

      const reactivatedAccount = await accountLifecycleService.getAccount(testAccountId);
      expect(reactivatedAccount.ok).toBe(true);
      if (reactivatedAccount.ok) {
        expect(reactivatedAccount.value.isActive).toBe(true);
      }
    });

    it("should detect already active account", async () => {
      const createResult = await accountLifecycleService.createAccount({
        email: `test-already-active-${Date.now()}@example.com`,
        password: "SecurePassword123!",
        name: "Already Active",
        role: "ADMIN",
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      testAccountId = createResult.value.id;

      const alreadyActiveResult = await accountLifecycleService.reactivateAccount(
        testAccountId,
        undefined
      );

      expect(alreadyActiveResult.ok).toBe(false);
      if (!alreadyActiveResult.ok) {
        expect(alreadyActiveResult.error).toBe("ALREADY_ACTIVE");
      }
    });
  });

  describe("resetPassword", () => {
    it("should reset password successfully", async () => {
      const createResult = await accountLifecycleService.createAccount({
        email: `test-reset-${Date.now()}@example.com`,
        password: "SecurePassword123!",
        name: "Reset Test",
        role: "ADMIN",
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      testAccountId = createResult.value.id;

      const resetPasswordResult = await accountLifecycleService.resetPassword(
        testAccountId,
        {
          newPassword: "NewSecurePassword123!",
          requirePasswordChange: false,
        },
        undefined
      );

      expect(resetPasswordResult.ok).toBe(true);
    });
  });

  describe("getAccountStats", () => {
    it("should retrieve account stats successfully", async () => {
      // Create at least one account so stats are meaningful
      await accountLifecycleService.createAccount({
        email: `test-stats-${Date.now()}@example.com`,
        password: "SecurePassword123!",
        name: "Stats Test",
        role: "ADMIN",
      });

      const statsResult = await accountLifecycleService.getAccountStats();

      expect(statsResult.ok).toBe(true);
      if (statsResult.ok) {
        expect(statsResult.value.totalAccounts >= 1).toBeTruthy();
        expect(typeof statsResult.value.activeAccounts).toBe("number");
        expect(statsResult.value.accountsByRole).toBeTruthy();
        expect(typeof statsResult.value.accountsByRole.SUPER_ADMIN).toBe("number");
        expect(typeof statsResult.value.accountsByRole.ADMIN).toBe("number");
        expect(typeof statsResult.value.accountsByRole.SUPPORT).toBe("number");
      }
    });
  });

  describe("deleteAccount", () => {
    it("should delete account successfully", async () => {
      const createResult = await accountLifecycleService.createAccount({
        email: `test-delete-${Date.now()}@example.com`,
        password: "SecurePassword123!",
        name: "Delete Test",
        role: "ADMIN",
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      testAccountId = createResult.value.id;

      const deleteResult = await accountLifecycleService.deleteAccount(testAccountId, undefined);

      expect(deleteResult.ok).toBe(true);
    });

    it("should return NOT_FOUND after deletion", async () => {
      const createResult = await accountLifecycleService.createAccount({
        email: `test-delete-verify-${Date.now()}@example.com`,
        password: "SecurePassword123!",
        name: "Delete Verify Test",
        role: "ADMIN",
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      testAccountId = createResult.value.id;

      await accountLifecycleService.deleteAccount(testAccountId, undefined);

      const afterDeleteResult = await accountLifecycleService.getAccount(testAccountId);

      expect(afterDeleteResult.ok).toBe(false);
      if (!afterDeleteResult.ok) {
        expect(afterDeleteResult.error).toBe("NOT_FOUND");
      }
    });
  });
});
