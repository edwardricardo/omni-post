/**
 * @file rbacService.test.ts
 * @description Unit tests for RbacService — DB-backed role-based access control,
 *              permissions, and role management. Uses in-memory mocks for
 *              both the AdminUserRepositoryPort and the Prisma client.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule } from "./helpers/mockPrisma.js";
import { makeAdminUser, resetFactoryCounter } from "./helpers/factories.js";
import { InMemoryAdminUserRepository } from "./helpers/InMemoryAdminUserRepository.js";
import { InMemoryAuditLogRepository } from "./helpers/InMemoryAuditLogRepository.js";
import { PrismaRoleRepository } from "../../src/infrastructure/repositories/PrismaRoleRepository.js";
import { seedSystemRoles, getRoleId } from "./helpers/seedSystemRoles.js";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const { mockPrisma, stores } = createMockPrismaModule();

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
});

// Mock loggers to prevent real log output and avoid DB/file side effects
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
// Import SUT after mocks are in place
// ---------------------------------------------------------------------------

const { RbacService } = await import("../../src/auth/rbacService.js");
const { Permission } = await import("@core/domain/auth/Permission.js");

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const inMemoryRepo = new InMemoryAdminUserRepository({
  idOf: (name) => getRoleId(name),
  nameOf: (id) => {
    const reverse: Record<string, string> = {
      "role-super-admin": "SUPER_ADMIN",
      "role-admin": "ADMIN",
      "role-support": "SUPPORT",
    };
    return reverse[id] ?? id;
  },
});

const superAdminUser = makeAdminUser({
  id: "sa-001",
  email: "super-admin@example.com",
  name: "Test Super Admin",
  role: "SUPER_ADMIN",
  isActive: true,
  emailVerified: true,
  mfaEnabled: false,
});

const adminUser = makeAdminUser({
  id: "admin-001",
  email: "admin@example.com",
  name: "Test Admin",
  role: "ADMIN",
  isActive: true,
  emailVerified: true,
  mfaEnabled: false,
});

const supportUser = makeAdminUser({
  id: "support-001",
  email: "support@example.com",
  name: "Test Support",
  role: "SUPPORT",
  isActive: true,
  emailVerified: true,
  mfaEnabled: false,
});

// ---------------------------------------------------------------------------
// Service under test
// ---------------------------------------------------------------------------

const roleRepo = new PrismaRoleRepository(mockPrisma.prisma as never);
const rbacService = new RbacService(inMemoryRepo, roleRepo, new InMemoryAuditLogRepository());

// ---------------------------------------------------------------------------
// Helpers to keep both stores in sync
// ---------------------------------------------------------------------------

function seedStores(): void {
  // Seed system roles first
  seedSystemRoles(stores);

  // Seed InMemoryAdminUserRepository (for repo.findById calls)
  inMemoryRepo.seed([superAdminUser, adminUser, supportUser]);

  // Seed mockPrisma adminUser store (for direct prisma.adminUser.* calls)
  stores.adminUser.clear();
  stores.auditLog.clear();

  for (const user of [superAdminUser, adminUser, supportUser]) {
    stores.adminUser.add({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      roleId: getRoleId(user.role),
      passwordHash: user.passwordHash,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RbacService Tests", () => {
  beforeAll(() => {
    resetFactoryCounter();
    seedStores();
  });

  afterAll(() => {
    inMemoryRepo.clear();
    stores.adminUser.clear();
    stores.auditLog.clear();
    stores.role.clear();
    stores.rolePermission.clear();
  });

  describe("hasPermission", () => {
    it("should grant SUPER_ADMIN all permissions", async () => {
      const hasUserManage = await rbacService.hasPermission("SUPER_ADMIN", Permission.USER_MANAGE);
      const hasSystemConfigure = await rbacService.hasPermission(
        "SUPER_ADMIN",
        Permission.SYSTEM_CONFIGURE
      );

      expect(hasUserManage).toBe(true);
      expect(hasSystemConfigure).toBe(true);
    });

    it("should grant ADMIN limited permissions", async () => {
      const hasUserManage = await rbacService.hasPermission("ADMIN", Permission.USER_MANAGE);
      const hasPricingManage = await rbacService.hasPermission("ADMIN", Permission.PRICING_MANAGE);
      const hasSystemConfigure = await rbacService.hasPermission(
        "ADMIN",
        Permission.SYSTEM_CONFIGURE
      );

      expect(hasUserManage).toBe(true);
      expect(hasPricingManage).toBe(false);
      expect(hasSystemConfigure).toBe(false);
    });

    it("should grant SUPPORT read-only permissions", async () => {
      const hasUserRead = await rbacService.hasPermission("SUPPORT", Permission.USER_READ);
      const hasUserManage = await rbacService.hasPermission("SUPPORT", Permission.USER_MANAGE);
      const hasSystemConfigure = await rbacService.hasPermission(
        "SUPPORT",
        Permission.SYSTEM_CONFIGURE
      );

      expect(hasUserRead).toBe(true);
      expect(hasUserManage).toBe(false);
      expect(hasSystemConfigure).toBe(false);
    });
  });

  describe("hasAnyPermission", () => {
    it("should check multiple permissions correctly for ADMIN", async () => {
      const adminHasAnyManagePermission = await rbacService.hasAnyPermission("ADMIN", [
        Permission.USER_MANAGE,
        Permission.ACCOUNT_MANAGE,
      ]);

      const supportHasAnyManagePermission = await rbacService.hasAnyPermission("SUPPORT", [
        Permission.USER_MANAGE,
        Permission.SYSTEM_CONFIGURE,
      ]);

      expect(adminHasAnyManagePermission).toBe(true);
      expect(supportHasAnyManagePermission).toBe(false);
    });
  });

  describe("hasAllPermissions", () => {
    it("should check all permissions correctly", async () => {
      const adminHasAllBillingPermissions = await rbacService.hasAllPermissions("ADMIN", [
        Permission.BILLING_READ,
        Permission.BILLING_MANAGE,
        Permission.ANALYTICS_READ,
      ]);

      const supportHasAllBillingPermissions = await rbacService.hasAllPermissions("SUPPORT", [
        Permission.BILLING_READ,
        Permission.BILLING_MANAGE,
        Permission.ANALYTICS_READ,
      ]);

      expect(adminHasAllBillingPermissions).toBe(true);
      expect(supportHasAllBillingPermissions).toBe(false);
    });
  });

  describe("getUserPermissions", () => {
    it("should return correct permissions object for ADMIN", async () => {
      const adminPermissions = await rbacService.getUserPermissions(adminUser.id, "ADMIN");

      expect(adminPermissions.userId).toBe(adminUser.id);
      expect(adminPermissions.role).toBe("ADMIN");
      expect(adminPermissions.permissions.length > 0).toBeTruthy();
      expect(adminPermissions.canAccess(Permission.USER_MANAGE)).toBe(true);
      expect(adminPermissions.canAccess(Permission.PRICING_MANAGE)).toBe(false);
    });
  });

  describe("getRoleInfo", () => {
    it("should return correct information for SUPER_ADMIN", async () => {
      const superAdminRoleInfo = await rbacService.getRoleInfo("SUPER_ADMIN");

      expect(superAdminRoleInfo.ok).toBe(true);
      expect(superAdminRoleInfo.ok && superAdminRoleInfo.value.role === "SUPER_ADMIN").toBeTruthy();
      expect(superAdminRoleInfo.ok && superAdminRoleInfo.value.permissions.length > 0).toBeTruthy();
      expect(superAdminRoleInfo.ok && superAdminRoleInfo.value.userCount >= 1).toBeTruthy();
      expect(
        superAdminRoleInfo.ok && superAdminRoleInfo.value.description.includes("Full system access")
      ).toBeTruthy();
    });

    it("should reject invalid role", async () => {
      const invalidRoleInfo = await rbacService.getRoleInfo("INVALID_ROLE");

      expect(invalidRoleInfo.ok).toBe(false);
      expect(invalidRoleInfo.ok || invalidRoleInfo.error).toBe("ROLE_NOT_FOUND");
    });
  });

  describe("getAllRoles", () => {
    it("should return all roles", async () => {
      const allRoles = await rbacService.getAllRoles();

      expect(allRoles.ok).toBe(true);
      expect(allRoles.ok && allRoles.value.length).toBe(3);

      if (allRoles.ok) {
        const roleNames = allRoles.value.map((role) => role.role);
        expect(roleNames.includes("SUPER_ADMIN")).toBeTruthy();
        expect(roleNames.includes("ADMIN")).toBeTruthy();
        expect(roleNames.includes("SUPPORT")).toBeTruthy();
      }
    });
  });

  describe("updateUserRole", () => {
    it("should allow SUPER_ADMIN to modify SUPPORT role", async () => {
      const updateRoleResult = await rbacService.updateUserRole(
        superAdminUser.id,
        supportUser.id,
        "ADMIN",
        "Promotion to ADMIN role"
      );

      expect(updateRoleResult.ok).toBe(true);

      // The role change is persisted through the admin user repository; the
      // DTO exposes the new role by name after the roleId is applied.
      const updatedUser = inMemoryRepo.get(supportUser.id);
      expect(updatedUser).toBeTruthy();
      expect(updatedUser?.role).toBe("ADMIN");
    });

    it("should reject ADMIN attempting to modify roles", async () => {
      const insufficientPermsResult = await rbacService.updateUserRole(
        adminUser.id,
        supportUser.id,
        "SUPPORT",
        "Demotion attempt"
      );

      expect(insufficientPermsResult.ok).toBe(false);
      expect(insufficientPermsResult.ok || insufficientPermsResult.error).toBe(
        "INSUFFICIENT_PERMISSIONS"
      );
    });

    it("should reject self modification", async () => {
      const selfModifyResult = await rbacService.updateUserRole(
        superAdminUser.id,
        superAdminUser.id,
        "ADMIN",
        "Self demotion attempt"
      );

      expect(selfModifyResult.ok).toBe(false);
      expect(selfModifyResult.ok || selfModifyResult.error).toBe("CANNOT_MODIFY_SELF");
    });

    it("should reject invalid role", async () => {
      const invalidRoleUpdate = await rbacService.updateUserRole(
        superAdminUser.id,
        supportUser.id,
        "INVALID_ROLE",
        "Invalid role test"
      );

      expect(invalidRoleUpdate.ok).toBe(false);
      expect(invalidRoleUpdate.ok || invalidRoleUpdate.error).toBe("INVALID_ROLE");
    });
  });

  describe("getUsersByRole", () => {
    it("should return users by role", async () => {
      const adminUsers = await rbacService.getUsersByRole("ADMIN");

      expect(adminUsers.ok).toBe(true);
      expect(adminUsers.ok && adminUsers.value.length >= 2).toBeTruthy();

      if (adminUsers.ok) {
        const emails = adminUsers.value.map((u) => u.email);
        expect(emails.includes(adminUser.email)).toBeTruthy();
        expect(emails.includes(supportUser.email)).toBeTruthy(); // Now ADMIN after promotion
      }
    });

    it("should reject invalid role", async () => {
      const invalidRoleUsers = await rbacService.getUsersByRole("INVALID_ROLE");

      expect(invalidRoleUsers.ok).toBe(false);
      expect(invalidRoleUsers.ok || invalidRoleUsers.error).toBe("INVALID_ROLE");
    });
  });

  describe("getPermissionCategories", () => {
    it("should return organized permissions", () => {
      const permissionCategories = rbacService.getPermissionCategories();

      expect(Object.keys(permissionCategories).length > 0).toBeTruthy();
      expect(permissionCategories["User Management"]).toBeTruthy();
      expect(permissionCategories["User Management"].includes(Permission.USER_READ)).toBeTruthy();
      expect(permissionCategories["User Management"].includes(Permission.USER_MANAGE)).toBeTruthy();
      expect(permissionCategories["Account Management"]).toBeTruthy();
      expect(
        permissionCategories["Account Management"].includes(Permission.ACCOUNT_READ)
      ).toBeTruthy();
    });
  });

  describe("canModifyRole", () => {
    it("should validate role hierarchy correctly", async () => {
      const superAdminCanModifyAdmin = await rbacService.canModifyRole("SUPER_ADMIN", "ADMIN");
      const superAdminCanModifySupport = await rbacService.canModifyRole("SUPER_ADMIN", "SUPPORT");
      const adminCanModifySupport = await rbacService.canModifyRole("ADMIN", "SUPPORT");
      const adminCanModifyAdmin = await rbacService.canModifyRole("ADMIN", "ADMIN");
      const supportCanModifyAdmin = await rbacService.canModifyRole("SUPPORT", "ADMIN");

      expect(superAdminCanModifyAdmin).toBe(true);
      expect(superAdminCanModifySupport).toBe(true);
      expect(adminCanModifySupport).toBe(true);
      expect(adminCanModifyAdmin).toBe(true);
      expect(supportCanModifyAdmin).toBe(false);
    });
  });
});
