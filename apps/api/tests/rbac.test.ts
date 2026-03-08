import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { AuthService } from "../src/auth/authService.js";
import { MfaService } from "../src/auth/mfaService.js";
import { RbacService, Permission } from "../src/auth/rbacService.js";
import { prisma } from "@infra/prisma";
import { PrismaAdminUserRepository } from "../src/infrastructure/repositories/PrismaAdminUserRepository.js";

const adminUserRepo = new PrismaAdminUserRepository(prisma);
const mfaService = new MfaService(adminUserRepo);
const authService = new AuthService(adminUserRepo, mfaService);
const rbacService = new RbacService(adminUserRepo);

/**
 * RBAC (Role-Based Access Control) System Tests
 * Tests permissions, role hierarchy, role management, and audit logging
 */

describe("RBAC System", () => {
  const testUsers: string[] = [];

  after(async () => {
    if (testUsers.length > 0) {
      await prisma.adminUser.deleteMany({
        where: {
          id: { in: testUsers },
        },
      });
    }
  });

  describe("Permission System", () => {
    let superAdminId: string;
    let adminId: string;
    let supportId: string;

    before(async () => {
      const timestamp = Date.now();

      // Create Super Admin
      const superAdminResult = await authService.registerAdmin(
        `rbac-super-${timestamp}@test.com`,
        "password123",
        "Super Admin Test",
        "SUPER_ADMIN"
      );
      assert.ok(superAdminResult.ok);
      superAdminId = superAdminResult.value.id;
      testUsers.push(superAdminId);

      // Create Admin
      const adminResult = await authService.registerAdmin(
        `rbac-admin-${timestamp}@test.com`,
        "password123",
        "Admin Test",
        "ADMIN"
      );
      assert.ok(adminResult.ok);
      adminId = adminResult.value.id;
      testUsers.push(adminId);

      // Create Support
      const supportResult = await authService.registerAdmin(
        `rbac-support-${timestamp}@test.com`,
        "password123",
        "Support Test",
        "SUPPORT"
      );
      assert.ok(supportResult.ok);
      supportId = supportResult.value.id;
      testUsers.push(supportId);
    });

    it("should grant Super Admin all permissions", async () => {
      const permissions = rbacService.getUserPermissions(superAdminId, "SUPER_ADMIN");

      assert.ok(
        permissions.canAccess(Permission.USER_DELETE),
        "Super Admin should have USER_DELETE"
      );
      assert.ok(
        permissions.canAccess(Permission.SYSTEM_CONFIGURE),
        "Super Admin should have SYSTEM_CONFIGURE"
      );
      assert.ok(
        permissions.canAccess(Permission.BILLING_MANAGE),
        "Super Admin should have BILLING_MANAGE"
      );
    });

    it("should grant Admin appropriate permissions", async () => {
      const permissions = rbacService.getUserPermissions(adminId, "ADMIN");

      assert.ok(permissions.canAccess(Permission.USER_CREATE), "Admin should have USER_CREATE");
      assert.ok(
        permissions.canAccess(Permission.CONTENT_PUBLISH),
        "Admin should have CONTENT_PUBLISH"
      );
      assert.ok(
        !permissions.canAccess(Permission.SYSTEM_CONFIGURE),
        "Admin should NOT have SYSTEM_CONFIGURE"
      );
    });

    it("should grant Support limited permissions", async () => {
      const permissions = rbacService.getUserPermissions(supportId, "SUPPORT");

      assert.ok(
        permissions.canAccess(Permission.SUPPORT_RESPOND),
        "Support should have SUPPORT_RESPOND"
      );
      assert.ok(
        !permissions.canAccess(Permission.USER_DELETE),
        "Support should NOT have USER_DELETE"
      );
      assert.ok(
        !permissions.canAccess(Permission.BILLING_MANAGE),
        "Support should NOT have BILLING_MANAGE"
      );
    });

    it("should have correct permission counts per role", async () => {
      const superAdminPerms = rbacService.getUserPermissions(superAdminId, "SUPER_ADMIN");
      const adminPerms = rbacService.getUserPermissions(adminId, "ADMIN");
      const supportPerms = rbacService.getUserPermissions(supportId, "SUPPORT");

      assert.ok(superAdminPerms.permissions.length > 0, "Super Admin should have permissions");
      assert.ok(adminPerms.permissions.length > 0, "Admin should have permissions");
      assert.ok(supportPerms.permissions.length > 0, "Support should have permissions");

      // Super Admin should have most permissions
      assert.ok(
        superAdminPerms.permissions.length > adminPerms.permissions.length,
        "Super Admin should have more permissions than Admin"
      );
      assert.ok(
        adminPerms.permissions.length > supportPerms.permissions.length,
        "Admin should have more permissions than Support"
      );
    });
  });

  describe("Role Hierarchy", () => {
    it("should enforce hierarchical permission structure", async () => {
      // Super Admin can do everything
      assert.ok(rbacService.hasPermission("SUPER_ADMIN", Permission.SYSTEM_CONFIGURE));
      assert.ok(rbacService.hasPermission("SUPER_ADMIN", Permission.USER_DELETE));
      assert.ok(rbacService.hasPermission("SUPER_ADMIN", Permission.BILLING_MANAGE));

      // Admin has elevated permissions but not system-level
      assert.ok(rbacService.hasPermission("ADMIN", Permission.USER_CREATE));
      assert.ok(!rbacService.hasPermission("ADMIN", Permission.SYSTEM_CONFIGURE));

      // Support has basic permissions
      assert.ok(rbacService.hasPermission("SUPPORT", Permission.SUPPORT_READ));
      assert.ok(!rbacService.hasPermission("SUPPORT", Permission.USER_DELETE));
    });

    it("should enforce role modification hierarchy", async () => {
      // Super Admin can modify everyone
      assert.ok(rbacService.canModifyRole("SUPER_ADMIN", "ADMIN"), "Super Admin can modify Admin");
      assert.ok(
        rbacService.canModifyRole("SUPER_ADMIN", "SUPPORT"),
        "Super Admin can modify Support"
      );

      // Admin can modify lower roles
      assert.ok(rbacService.canModifyRole("ADMIN", "SUPPORT"), "Admin can modify Support");
      assert.ok(
        !rbacService.canModifyRole("ADMIN", "SUPER_ADMIN"),
        "Admin cannot modify Super Admin"
      );

      // Support cannot modify anyone
      assert.ok(!rbacService.canModifyRole("SUPPORT", "ADMIN"), "Support cannot modify Admin");
      assert.ok(
        !rbacService.canModifyRole("SUPPORT", "SUPER_ADMIN"),
        "Support cannot modify Super Admin"
      );
    });
  });

  describe("Role Management", () => {
    it("should retrieve role information", async () => {
      const adminRoleInfo = await rbacService.getRoleInfo("ADMIN");

      assert.ok(adminRoleInfo.ok, "Get role info should succeed");
      assert.equal(adminRoleInfo.value.role, "ADMIN");
      assert.ok(adminRoleInfo.value.userCount >= 0, "Should return user count");
    });

    it("should retrieve all roles", async () => {
      const allRoles = await rbacService.getAllRoles();

      assert.ok(allRoles.ok, "Get all roles should succeed");
      assert.equal(allRoles.value.length, 3, "Should return 3 roles");

      const roleNames = allRoles.value.map((r) => r.role);
      assert.ok(roleNames.includes("SUPER_ADMIN"), "Should include SUPER_ADMIN");
      assert.ok(roleNames.includes("ADMIN"), "Should include ADMIN");
      assert.ok(roleNames.includes("SUPPORT"), "Should include SUPPORT");
    });

    it("should retrieve users by role", async () => {
      const adminUsers = await rbacService.getUsersByRole("ADMIN");

      assert.ok(adminUsers.ok, "Get users by role should succeed");
      assert.ok(adminUsers.value.length > 0, "Should return at least one admin");
      assert.ok(
        adminUsers.value.every((u) => u.role === "ADMIN"),
        "All users should have ADMIN role"
      );
    });
  });

  describe("Role Updates", () => {
    let superAdminId: string;
    let adminId: string;

    before(async () => {
      const timestamp = Date.now();

      const superAdminResult = await authService.registerAdmin(
        `rbac-update-super-${timestamp}@test.com`,
        "password123",
        "Update Super Admin",
        "SUPER_ADMIN"
      );
      assert.ok(superAdminResult.ok);
      superAdminId = superAdminResult.value.id;
      testUsers.push(superAdminId);

      const adminResult = await authService.registerAdmin(
        `rbac-update-admin-${timestamp}@test.com`,
        "password123",
        "Update Admin",
        "ADMIN"
      );
      assert.ok(adminResult.ok);
      adminId = adminResult.value.id;
      testUsers.push(adminId);
    });

    it("should update user role successfully", async () => {
      // Create test user
      const testUserResult = await authService.registerAdmin(
        `rbac-modify-${Date.now()}@test.com`,
        "password123",
        "Modify Test User",
        "SUPPORT"
      );
      assert.ok(testUserResult.ok);
      const testUserId = testUserResult.value.id;
      testUsers.push(testUserId);

      // Update role (Super Admin promoting Support to Admin)
      const updateResult = await rbacService.updateUserRole(
        superAdminId,
        testUserId,
        "ADMIN",
        "Test role promotion"
      );

      assert.ok(updateResult.ok, "Role update should succeed");

      // Verify update in database
      const updatedUser = await prisma.adminUser.findUnique({
        where: { id: testUserId },
      });
      assert.equal(updatedUser?.role, "ADMIN", "Role should be updated to ADMIN");
    });

    it("should reject unauthorized role updates", async () => {
      // Create test user
      const testUserResult = await authService.registerAdmin(
        `rbac-invalid-${Date.now()}@test.com`,
        "password123",
        "Invalid Test User",
        "SUPPORT"
      );
      assert.ok(testUserResult.ok);
      const testUserId = testUserResult.value.id;
      testUsers.push(testUserId);

      // Admin trying to create Super Admin (should fail)
      const updateResult = await rbacService.updateUserRole(
        adminId,
        testUserId,
        "SUPER_ADMIN",
        "Invalid escalation attempt"
      );

      assert.ok(!updateResult.ok, "Unauthorized role update should fail");
      assert.equal(updateResult.error, "INSUFFICIENT_PERMISSIONS");
    });

    it("should prevent self-modification", async () => {
      const updateResult = await rbacService.updateUserRole(
        superAdminId,
        superAdminId,
        "ADMIN",
        "Self-modification attempt"
      );

      assert.ok(!updateResult.ok, "Self-modification should fail");
      assert.equal(updateResult.error, "CANNOT_MODIFY_SELF");
    });

    it("should handle non-existent user", async () => {
      const fakeUserId = "00000000-0000-0000-0000-000000000000";
      const updateResult = await rbacService.updateUserRole(
        superAdminId,
        fakeUserId,
        "ADMIN",
        "Non-existent user test"
      );

      assert.ok(!updateResult.ok, "Update for non-existent user should fail");
    });
  });

  describe("Permission Categories", () => {
    it("should organize permissions into categories", async () => {
      const categories = rbacService.getPermissionCategories();

      assert.ok(categories["User Management"], "Should have User Management category");
      assert.ok(categories["System Administration"], "Should have System Administration category");
      assert.ok(categories["AI Features"], "Should have AI Features category");
      assert.ok(
        categories["User Management"].length > 0,
        "User Management should have permissions"
      );
    });

    it("should categorize all permissions", async () => {
      const categories = rbacService.getPermissionCategories();
      const allCategorized = Object.values(categories).flat();
      const allPermissions = Object.values(Permission);

      assert.equal(
        allCategorized.length,
        allPermissions.length,
        "All permissions should be categorized"
      );
    });

    it("should have correct permissions in User Management category", async () => {
      const categories = rbacService.getPermissionCategories();
      const userMgmt = categories["User Management"];

      assert.ok(userMgmt.includes(Permission.USER_CREATE), "Should include USER_CREATE");
      assert.ok(userMgmt.includes(Permission.USER_DELETE), "Should include USER_DELETE");
    });
  });

  describe("Permission Check Methods", () => {
    it("should check hasPermission correctly", async () => {
      assert.ok(
        rbacService.hasPermission("ADMIN", Permission.USER_CREATE),
        "Admin should have USER_CREATE"
      );
      assert.ok(
        !rbacService.hasPermission("SUPPORT", Permission.USER_DELETE),
        "Support should not have USER_DELETE"
      );
    });

    it("should check hasAnyPermission correctly", async () => {
      const adminPerms = [Permission.USER_CREATE, Permission.SYSTEM_CONFIGURE];

      assert.ok(
        rbacService.hasAnyPermission("ADMIN", adminPerms),
        "Admin should have at least one permission"
      );
      assert.ok(
        !rbacService.hasAnyPermission("SUPPORT", adminPerms),
        "Support should not have any of these permissions"
      );
    });

    it("should check hasAllPermissions correctly", async () => {
      const supportPerms = [Permission.SUPPORT_READ, Permission.AI_USE];
      const adminPerms = [Permission.USER_CREATE, Permission.SYSTEM_CONFIGURE];

      assert.ok(
        rbacService.hasAllPermissions("SUPPORT", supportPerms),
        "Support should have all support permissions"
      );
      assert.ok(
        !rbacService.hasAllPermissions("SUPPORT", adminPerms),
        "Support should not have all admin permissions"
      );
    });
  });

  describe("Audit Logging", () => {
    let superAdminId: string;

    before(async () => {
      const superAdminResult = await authService.registerAdmin(
        `rbac-audit-super-${Date.now()}@test.com`,
        "password123",
        "Audit Super Admin",
        "SUPER_ADMIN"
      );
      assert.ok(superAdminResult.ok);
      superAdminId = superAdminResult.value.id;
      testUsers.push(superAdminId);
    });

    it("should create audit log for role updates", async () => {
      // Create test user
      const testUserResult = await authService.registerAdmin(
        `rbac-audit-test-${Date.now()}@test.com`,
        "password123",
        "Audit Test User",
        "SUPPORT"
      );
      assert.ok(testUserResult.ok);
      const testUserId = testUserResult.value.id;
      testUsers.push(testUserId);

      // Update role
      const updateResult = await rbacService.updateUserRole(
        superAdminId,
        testUserId,
        "ADMIN",
        "Testing audit logging"
      );
      assert.ok(updateResult.ok);

      // Check audit log
      const auditLogs = await prisma.auditLog.findMany({
        where: {
          action: "USER_ROLE_UPDATED",
          resourceId: testUserId,
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      assert.ok(auditLogs.length > 0, "Audit log should be created");

      const auditLog = auditLogs[0];
      assert.equal(auditLog.action, "USER_ROLE_UPDATED");
      assert.ok(auditLog.details, "Should have details");
      assert.equal(
        (auditLog.details as { newRole?: string }).newRole,
        "ADMIN",
        "Should record new role"
      );
    });

    it("should record complete audit trail information", async () => {
      // Create test user
      const testUserResult = await authService.registerAdmin(
        `rbac-audit-complete-${Date.now()}@test.com`,
        "password123",
        "Complete Audit Test",
        "SUPPORT"
      );
      assert.ok(testUserResult.ok);
      const testUserId = testUserResult.value.id;
      testUsers.push(testUserId);

      const reason = "Complete audit trail test";

      // Update role
      await rbacService.updateUserRole(superAdminId, testUserId, "ADMIN", reason);

      // Verify audit log details
      const auditLogs = await prisma.auditLog.findMany({
        where: {
          action: "USER_ROLE_UPDATED",
          resourceId: testUserId,
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      assert.ok(auditLogs.length > 0);
      const auditLog = auditLogs[0];

      assert.equal(auditLog.userId, superAdminId, "Should record admin user ID");
      assert.ok(auditLog.createdAt, "Should have timestamp");

      const details = auditLog.details as {
        oldRole?: string;
        newRole?: string;
        reason?: string;
      };
      assert.equal(details.oldRole, "SUPPORT", "Should record previous role");
      assert.equal(details.newRole, "ADMIN", "Should record new role");
      assert.equal(details.reason, reason, "Should record reason");
    });
  });

  describe("Role-Based Access Scenarios", () => {
    let superAdminId: string;
    let adminId: string;
    let supportId: string;

    before(async () => {
      const timestamp = Date.now();

      const superAdminResult = await authService.registerAdmin(
        `rbac-scenario-super-${timestamp}@test.com`,
        "password123",
        "Scenario Super Admin",
        "SUPER_ADMIN"
      );
      assert.ok(superAdminResult.ok);
      superAdminId = superAdminResult.value.id;
      testUsers.push(superAdminId);

      const adminResult = await authService.registerAdmin(
        `rbac-scenario-admin-${timestamp}@test.com`,
        "password123",
        "Scenario Admin",
        "ADMIN"
      );
      assert.ok(adminResult.ok);
      adminId = adminResult.value.id;
      testUsers.push(adminId);

      const supportResult = await authService.registerAdmin(
        `rbac-scenario-support-${timestamp}@test.com`,
        "password123",
        "Scenario Support",
        "SUPPORT"
      );
      assert.ok(supportResult.ok);
      supportId = supportResult.value.id;
      testUsers.push(supportId);
    });

    it("should handle complete role upgrade workflow", async () => {
      // Create new support user
      const userResult = await authService.registerAdmin(
        `rbac-workflow-${Date.now()}@test.com`,
        "password123",
        "Workflow Test User",
        "SUPPORT"
      );
      assert.ok(userResult.ok);
      const userId = userResult.value.id;
      testUsers.push(userId);

      // Verify initial permissions
      const initialPerms = rbacService.getUserPermissions(userId, "SUPPORT");
      assert.ok(!initialPerms.canAccess(Permission.USER_CREATE));

      // Super Admin upgrades to Admin role (only SUPER_ADMIN can modify roles)
      const upgradeResult = await rbacService.updateUserRole(
        superAdminId,
        userId,
        "ADMIN",
        "Promotion to Admin"
      );
      assert.ok(upgradeResult.ok);

      // Verify new permissions
      const upgradedPerms = rbacService.getUserPermissions(userId, "ADMIN");
      assert.ok(upgradedPerms.canAccess(Permission.USER_CREATE));
    });

    it("should prevent privilege escalation", async () => {
      // Support user trying to escalate to Admin (simulation)
      const escalationResult = await rbacService.updateUserRole(
        supportId,
        supportId,
        "ADMIN",
        "Privilege escalation attempt"
      );

      assert.ok(!escalationResult.ok, "Self-escalation should fail");
    });
  });
});
