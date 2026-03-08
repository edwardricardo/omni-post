#!/usr/bin/env tsx
/**
 * Unit Tests for RbacService
 * Testing role-based access control, permissions, and role management
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { RbacService, Permission } from "../../src/auth/rbacService.js";
import { prisma } from "@infra/prisma";
import { PrismaAdminUserRepository } from "../../src/infrastructure/repositories/PrismaAdminUserRepository.js";

// Instantiate service with injected Prisma repository (proper DI pattern)
const rbacService = new RbacService(new PrismaAdminUserRepository(prisma));

const timestamp = Date.now();

const superAdminEmail = `super-admin-${timestamp}@example.com`;
const adminEmail = `admin-${timestamp}@example.com`;
const supportEmail = `support-${timestamp}@example.com`;

let superAdminUserId: string;
let adminUserId: string;
let supportUserId: string;

describe("RbacService Tests", { concurrency: 1 }, () => {
  before(async () => {
    // Setup: Create test users with different roles
    const superAdminUser = await prisma.adminUser.create({
      data: {
        email: superAdminEmail,
        passwordHash: "test-hash",
        name: "Test Super Admin",
        role: "SUPER_ADMIN",
        emailVerified: true,
        mfaEnabled: false,
      },
    });

    const adminUser = await prisma.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash: "test-hash",
        name: "Test Admin",
        role: "ADMIN",
        emailVerified: true,
        mfaEnabled: false,
      },
    });

    const supportUser = await prisma.adminUser.create({
      data: {
        email: supportEmail,
        passwordHash: "test-hash",
        name: "Test Support",
        role: "SUPPORT",
        emailVerified: true,
        mfaEnabled: false,
      },
    });

    superAdminUserId = superAdminUser.id;
    adminUserId = adminUser.id;
    supportUserId = supportUser.id;
  });

  after(async () => {
    // Cleanup: Delete test users and audit logs
    await prisma.auditLog.deleteMany({
      where: {
        userId: { in: [superAdminUserId, adminUserId, supportUserId] },
      },
    });

    await prisma.adminUser.deleteMany({
      where: {
        id: { in: [superAdminUserId, adminUserId, supportUserId] },
      },
    });
  });

  describe("hasPermission", () => {
    it("should grant SUPER_ADMIN all permissions", () => {
      const hasUserCreate = rbacService.hasPermission("SUPER_ADMIN", Permission.USER_CREATE);
      const hasSystemBackup = rbacService.hasPermission("SUPER_ADMIN", Permission.SYSTEM_BACKUP);

      assert.strictEqual(hasUserCreate, true);
      assert.strictEqual(hasSystemBackup, true);
    });

    it("should grant ADMIN limited permissions", () => {
      const hasUserCreate = rbacService.hasPermission("ADMIN", Permission.USER_CREATE);
      const hasSystemBackup = rbacService.hasPermission("ADMIN", Permission.SYSTEM_BACKUP);
      const hasSystemConfigure = rbacService.hasPermission("ADMIN", Permission.SYSTEM_CONFIGURE);

      assert.strictEqual(hasUserCreate, true);
      assert.strictEqual(hasSystemBackup, false);
      assert.strictEqual(hasSystemConfigure, false);
    });

    it("should grant SUPPORT read-only permissions", () => {
      const hasUserRead = rbacService.hasPermission("SUPPORT", Permission.USER_READ);
      const hasUserCreate = rbacService.hasPermission("SUPPORT", Permission.USER_CREATE);
      const hasUserDelete = rbacService.hasPermission("SUPPORT", Permission.USER_DELETE);

      assert.strictEqual(hasUserRead, true);
      assert.strictEqual(hasUserCreate, false);
      assert.strictEqual(hasUserDelete, false);
    });
  });

  describe("hasAnyPermission", () => {
    it("should check multiple permissions correctly for ADMIN", () => {
      const adminHasAnyUserPermission = rbacService.hasAnyPermission("ADMIN", [
        Permission.USER_CREATE,
        Permission.USER_UPDATE,
      ]);

      const supportHasAnyUserPermission = rbacService.hasAnyPermission("SUPPORT", [
        Permission.USER_CREATE,
        Permission.USER_DELETE,
      ]);

      assert.strictEqual(adminHasAnyUserPermission, true);
      assert.strictEqual(supportHasAnyUserPermission, false);
    });
  });

  describe("hasAllPermissions", () => {
    it("should check all permissions correctly", () => {
      const adminHasAllContentPermissions = rbacService.hasAllPermissions("ADMIN", [
        Permission.CONTENT_CREATE,
        Permission.CONTENT_READ,
        Permission.CONTENT_UPDATE,
      ]);

      const supportHasAllContentPermissions = rbacService.hasAllPermissions("SUPPORT", [
        Permission.CONTENT_CREATE,
        Permission.CONTENT_READ,
        Permission.CONTENT_UPDATE,
      ]);

      assert.strictEqual(adminHasAllContentPermissions, true);
      assert.strictEqual(supportHasAllContentPermissions, false);
    });
  });

  describe("getUserPermissions", () => {
    it("should return correct permissions object for ADMIN", () => {
      const adminPermissions = rbacService.getUserPermissions(adminUserId, "ADMIN");

      assert.strictEqual(adminPermissions.userId, adminUserId);
      assert.strictEqual(adminPermissions.role, "ADMIN");
      assert.ok(adminPermissions.permissions.length > 0);
      assert.strictEqual(adminPermissions.canAccess(Permission.USER_CREATE), true);
      assert.strictEqual(adminPermissions.canAccess(Permission.SYSTEM_BACKUP), false);
    });
  });

  describe("getRoleInfo", () => {
    it("should return correct information for SUPER_ADMIN", async () => {
      const superAdminRoleInfo = await rbacService.getRoleInfo("SUPER_ADMIN");

      assert.strictEqual(superAdminRoleInfo.ok, true);
      assert.ok(superAdminRoleInfo.ok && superAdminRoleInfo.value.role === "SUPER_ADMIN");
      assert.ok(superAdminRoleInfo.ok && superAdminRoleInfo.value.permissions.length > 0);
      assert.ok(superAdminRoleInfo.ok && superAdminRoleInfo.value.userCount >= 1);
      assert.ok(
        superAdminRoleInfo.ok && superAdminRoleInfo.value.description.includes("Full system access")
      );
    });

    it("should reject invalid role", async () => {
      const invalidRoleInfo = await rbacService.getRoleInfo("INVALID_ROLE");

      assert.strictEqual(invalidRoleInfo.ok, false);
      assert.strictEqual(invalidRoleInfo.ok || invalidRoleInfo.error, "ROLE_NOT_FOUND");
    });
  });

  describe("getAllRoles", () => {
    it("should return all roles", async () => {
      const allRoles = await rbacService.getAllRoles();

      assert.strictEqual(allRoles.ok, true);
      assert.strictEqual(allRoles.ok && allRoles.value.length, 3);

      if (allRoles.ok) {
        const roleNames = allRoles.value.map((role) => role.role);
        assert.ok(roleNames.includes("SUPER_ADMIN"));
        assert.ok(roleNames.includes("ADMIN"));
        assert.ok(roleNames.includes("SUPPORT"));
      }
    });
  });

  describe("updateUserRole", () => {
    it("should allow SUPER_ADMIN to modify SUPPORT role", async () => {
      const updateRoleResult = await rbacService.updateUserRole(
        superAdminUserId,
        supportUserId,
        "ADMIN",
        "Promotion to ADMIN role"
      );

      assert.strictEqual(updateRoleResult.ok, true);

      const updatedUser = await prisma.adminUser.findUnique({
        where: { id: supportUserId },
      });

      assert.ok(updatedUser);
      assert.strictEqual(updatedUser?.role, "ADMIN");
    });

    it("should reject ADMIN attempting to modify roles", async () => {
      const insufficientPermsResult = await rbacService.updateUserRole(
        adminUserId,
        supportUserId,
        "SUPPORT",
        "Demotion attempt"
      );

      assert.strictEqual(insufficientPermsResult.ok, false);
      assert.strictEqual(
        insufficientPermsResult.ok || insufficientPermsResult.error,
        "INSUFFICIENT_PERMISSIONS"
      );
    });

    it("should reject self modification", async () => {
      const selfModifyResult = await rbacService.updateUserRole(
        superAdminUserId,
        superAdminUserId,
        "ADMIN",
        "Self demotion attempt"
      );

      assert.strictEqual(selfModifyResult.ok, false);
      assert.strictEqual(selfModifyResult.ok || selfModifyResult.error, "CANNOT_MODIFY_SELF");
    });

    it("should reject invalid role", async () => {
      const invalidRoleUpdate = await rbacService.updateUserRole(
        superAdminUserId,
        supportUserId,
        "INVALID_ROLE",
        "Invalid role test"
      );

      assert.strictEqual(invalidRoleUpdate.ok, false);
      assert.strictEqual(invalidRoleUpdate.ok || invalidRoleUpdate.error, "INVALID_ROLE");
    });
  });

  describe("getUsersByRole", () => {
    it("should return users by role", async () => {
      const adminUsers = await rbacService.getUsersByRole("ADMIN");

      assert.strictEqual(adminUsers.ok, true);
      assert.ok(adminUsers.ok && adminUsers.value.length >= 2);

      if (adminUsers.ok) {
        const emails = adminUsers.value.map((u) => u.email);
        assert.ok(emails.includes(adminEmail));
        assert.ok(emails.includes(supportEmail)); // Now ADMIN after promotion
      }
    });

    it("should reject invalid role", async () => {
      const invalidRoleUsers = await rbacService.getUsersByRole("INVALID_ROLE");

      assert.strictEqual(invalidRoleUsers.ok, false);
      assert.strictEqual(invalidRoleUsers.ok || invalidRoleUsers.error, "INVALID_ROLE");
    });
  });

  describe("getPermissionCategories", () => {
    it("should return organized permissions", () => {
      const permissionCategories = rbacService.getPermissionCategories();

      assert.ok(Object.keys(permissionCategories).length > 0);
      assert.ok(permissionCategories["User Management"]);
      assert.ok(permissionCategories["User Management"].includes(Permission.USER_CREATE));
      assert.ok(permissionCategories["Content Management"]);
      assert.ok(permissionCategories["Content Management"].includes(Permission.CONTENT_PUBLISH));
    });
  });

  describe("canModifyRole", () => {
    it("should validate role hierarchy correctly", () => {
      const superAdminCanModifyAdmin = rbacService.canModifyRole("SUPER_ADMIN", "ADMIN");
      const superAdminCanModifySupport = rbacService.canModifyRole("SUPER_ADMIN", "SUPPORT");
      const adminCanModifySupport = rbacService.canModifyRole("ADMIN", "SUPPORT");
      const adminCanModifyAdmin = rbacService.canModifyRole("ADMIN", "ADMIN");
      const supportCanModifyAdmin = rbacService.canModifyRole("SUPPORT", "ADMIN");

      assert.strictEqual(superAdminCanModifyAdmin, true);
      assert.strictEqual(superAdminCanModifySupport, true);
      assert.strictEqual(adminCanModifySupport, true);
      assert.strictEqual(adminCanModifyAdmin, true);
      assert.strictEqual(supportCanModifyAdmin, false);
    });
  });
});
