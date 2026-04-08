/**
 * @file rbacService.ts
 * @description Role-based access control service. Permission checks are now
 *              backed by the Role / RolePermission tables instead of a
 *              hardcoded map. SUPER_ADMIN always receives all permissions
 *              regardless of the DB contents.
 * @layer application
 */

import { prisma } from "@infra/prisma";
import { ok, err, type Result } from "@shared/types";
import { AuditableService } from "../services/AuditableService";
import type { AdminUserRepositoryPort } from "../domain/repositories/AdminUserRepository.js";
import { authLogger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// Permission enum — master list of all permissions in the system
// ---------------------------------------------------------------------------

export enum Permission {
  // User management
  USER_CREATE = "user:create",
  USER_READ = "user:read",
  USER_UPDATE = "user:update",
  USER_DELETE = "user:delete",
  USER_MANAGE_ROLES = "user:manage_roles",

  // Project management
  PROJECT_CREATE = "project:create",
  PROJECT_READ = "project:read",
  PROJECT_UPDATE = "project:update",
  PROJECT_DELETE = "project:delete",

  // Content management
  CONTENT_CREATE = "content:create",
  CONTENT_READ = "content:read",
  CONTENT_UPDATE = "content:update",
  CONTENT_DELETE = "content:delete",
  CONTENT_PUBLISH = "content:publish",

  // Analytics access
  ANALYTICS_READ = "analytics:read",
  ANALYTICS_EXPORT = "analytics:export",

  // System administration
  SYSTEM_CONFIGURE = "system:configure",
  SYSTEM_MONITOR = "system:monitor",
  SYSTEM_BACKUP = "system:backup",

  // Audit and compliance
  AUDIT_READ = "audit:read",
  AUDIT_EXPORT = "audit:export",

  // Billing and subscriptions
  BILLING_READ = "billing:read",
  BILLING_MANAGE = "billing:manage",

  // AI features
  AI_USE = "ai:use",
  AI_CONFIGURE = "ai:configure",

  // Support operations
  SUPPORT_READ = "support:read",
  SUPPORT_RESPOND = "support:respond",
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoleInfo {
  id: string;
  role: string;
  permissions: Permission[];
  description: string;
  level: number;
  isSystem: boolean;
  userCount: number;
}

export interface UserPermissions {
  userId: string;
  role: string;
  permissions: Permission[];
  canAccess: (permission: Permission) => boolean;
}

// ---------------------------------------------------------------------------
// Cache entry
// ---------------------------------------------------------------------------

interface CacheEntry {
  permissions: Permission[];
  expiry: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class RbacService extends AuditableService {
  private permissionCache = new Map<string, CacheEntry>();
  private static CACHE_TTL = 60_000; // 60 seconds

  constructor(private readonly userRepo: AdminUserRepositoryPort) {
    super("RbacService");
  }

  // -------------------------------------------------------------------------
  // Permission cache
  // -------------------------------------------------------------------------

  /**
   * Load permissions for a role from the DB (or cache).
   * SUPER_ADMIN always gets every permission regardless of DB contents.
   */
  private async loadRolePermissions(roleName: string): Promise<Permission[]> {
    if (roleName === "SUPER_ADMIN") return Object.values(Permission);

    const cached = this.permissionCache.get(roleName);
    if (cached && cached.expiry > Date.now()) return cached.permissions;

    const role = await prisma.role.findUnique({
      where: { name: roleName },
      include: { permissions: true },
    });
    if (!role) return [];

    const perms = role.permissions
      .map((rp) => rp.permission as Permission)
      .filter((p) => Object.values(Permission).includes(p));

    this.permissionCache.set(roleName, {
      permissions: perms,
      expiry: Date.now() + RbacService.CACHE_TTL,
    });
    return perms;
  }

  /**
   * Invalidate the permission cache for a specific role or all roles.
   */
  invalidateCache(roleName?: string): void {
    if (roleName) {
      this.permissionCache.delete(roleName);
    } else {
      this.permissionCache.clear();
    }
  }

  // -------------------------------------------------------------------------
  // Permission checks (async — hit cache / DB)
  // -------------------------------------------------------------------------

  /**
   * Check if a role has a specific permission.
   */
  async hasPermission(userRole: string, permission: Permission): Promise<boolean> {
    if (userRole === "SUPER_ADMIN") return true;
    const perms = await this.loadRolePermissions(userRole);
    return perms.includes(permission);
  }

  /**
   * Check if a role has any of the specified permissions.
   */
  async hasAnyPermission(userRole: string, permissions: Permission[]): Promise<boolean> {
    if (userRole === "SUPER_ADMIN") return true;
    const perms = await this.loadRolePermissions(userRole);
    return permissions.some((p) => perms.includes(p));
  }

  /**
   * Check if a role has all of the specified permissions.
   */
  async hasAllPermissions(userRole: string, permissions: Permission[]): Promise<boolean> {
    if (userRole === "SUPER_ADMIN") return true;
    const perms = await this.loadRolePermissions(userRole);
    return permissions.every((p) => perms.includes(p));
  }

  /**
   * Get all permissions for a user role.
   */
  async getUserPermissions(userId: string, userRole: string): Promise<UserPermissions> {
    const permissions = await this.loadRolePermissions(userRole);

    return {
      userId,
      role: userRole,
      permissions,
      canAccess: (permission: Permission) => permissions.includes(permission),
    };
  }

  // -------------------------------------------------------------------------
  // Role queries (DB-backed)
  // -------------------------------------------------------------------------

  /**
   * Get role information including user count.
   */
  async getRoleInfo(
    roleName: string
  ): Promise<Result<RoleInfo, "ROLE_NOT_FOUND" | "DATABASE_ERROR">> {
    try {
      const role = await prisma.role.findUnique({
        where: { name: roleName },
        include: { permissions: true, _count: { select: { users: true } } },
      });

      if (!role) return err("ROLE_NOT_FOUND");

      return ok({
        id: role.id,
        role: role.name,
        description: role.description,
        level: role.level,
        isSystem: role.isSystem,
        permissions:
          role.name === "SUPER_ADMIN"
            ? Object.values(Permission)
            : role.permissions
                .map((rp) => rp.permission as Permission)
                .filter((p) => Object.values(Permission).includes(p)),
        userCount: role._count.users,
      });
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Get role info error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Get all available roles and their information.
   */
  async getAllRoles(): Promise<Result<RoleInfo[], "DATABASE_ERROR">> {
    try {
      const roles = await prisma.role.findMany({
        where: { isActive: true },
        include: { permissions: true, _count: { select: { users: true } } },
        orderBy: { level: "desc" },
      });

      return ok(
        roles.map((r) => ({
          id: r.id,
          role: r.name,
          description: r.description,
          level: r.level,
          isSystem: r.isSystem,
          permissions:
            r.name === "SUPER_ADMIN"
              ? Object.values(Permission)
              : r.permissions
                  .map((rp) => rp.permission as Permission)
                  .filter((p) => Object.values(Permission).includes(p)),
          userCount: r._count.users,
        }))
      );
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Get all roles error");
      return err("DATABASE_ERROR");
    }
  }

  // -------------------------------------------------------------------------
  // Role mutations
  // -------------------------------------------------------------------------

  /**
   * Update user role (admin operation).
   */
  async updateUserRole(
    adminUserId: string,
    targetUserId: string,
    newRoleName: string,
    reason: string
  ): Promise<
    Result<
      void,
      | "USER_NOT_FOUND"
      | "INVALID_ROLE"
      | "INSUFFICIENT_PERMISSIONS"
      | "CANNOT_MODIFY_SELF"
      | "DATABASE_ERROR"
    >
  > {
    try {
      // Validate role exists
      const role = await prisma.role.findUnique({ where: { name: newRoleName } });
      if (!role) return err("INVALID_ROLE");

      // Prevent self-modification
      if (adminUserId === targetUserId) return err("CANNOT_MODIFY_SELF");

      // Get admin user to check permissions
      const adminUserResult = await this.userRepo.findById(adminUserId);
      if (!adminUserResult.ok) return err("USER_NOT_FOUND");

      const adminUser = adminUserResult.value;

      // Only SUPER_ADMIN can modify roles
      if (adminUser.role !== "SUPER_ADMIN") return err("INSUFFICIENT_PERMISSIONS");

      // Get target user
      const targetUserResult = await this.userRepo.findById(targetUserId);
      if (!targetUserResult.ok) return err("USER_NOT_FOUND");

      const targetUser = targetUserResult.value;
      const oldRole = targetUser.role;

      // Update user role
      await prisma.adminUser.update({
        where: { id: targetUserId },
        data: { roleId: role.id },
      });

      // Log the role change
      await this.logResourceAction(adminUserId, {
        accountId: adminUser.id,
        action: "USER_ROLE_UPDATED",
        category: "SECURITY",
        severity: "CRITICAL",
        resourceType: "AdminUser",
        resourceId: targetUserId,
        details: {
          targetUserId,
          oldRole,
          newRole: newRoleName,
          reason,
          targetUserEmail: targetUser.email,
        },
      });

      return ok(undefined);
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Update user role error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Get users by role.
   */
  async getUsersByRole(roleName: string): Promise<
    Result<
      Array<{
        id: string;
        email: string;
        name: string;
        role: string;
        isActive: boolean;
        lastLoginAt: Date | null;
        createdAt: Date;
      }>,
      "INVALID_ROLE" | "DATABASE_ERROR"
    >
  > {
    try {
      const role = await prisma.role.findUnique({ where: { name: roleName } });
      if (!role) return err("INVALID_ROLE");

      const users = await prisma.adminUser.findMany({
        where: { roleId: role.id },
        select: {
          id: true,
          email: true,
          name: true,
          role: { select: { name: true } },
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      });

      return ok(users.map((u) => ({ ...u, role: u.role.name })));
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Get users by role error");
      return err("DATABASE_ERROR");
    }
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  /**
   * Get permission categories for UI organization.
   */
  getPermissionCategories(): Record<string, Permission[]> {
    return {
      "User Management": [
        Permission.USER_CREATE,
        Permission.USER_READ,
        Permission.USER_UPDATE,
        Permission.USER_DELETE,
        Permission.USER_MANAGE_ROLES,
      ],
      "Project Management": [
        Permission.PROJECT_CREATE,
        Permission.PROJECT_READ,
        Permission.PROJECT_UPDATE,
        Permission.PROJECT_DELETE,
      ],
      "Content Management": [
        Permission.CONTENT_CREATE,
        Permission.CONTENT_READ,
        Permission.CONTENT_UPDATE,
        Permission.CONTENT_DELETE,
        Permission.CONTENT_PUBLISH,
      ],
      Analytics: [Permission.ANALYTICS_READ, Permission.ANALYTICS_EXPORT],
      "System Administration": [
        Permission.SYSTEM_CONFIGURE,
        Permission.SYSTEM_MONITOR,
        Permission.SYSTEM_BACKUP,
      ],
      "Audit & Compliance": [Permission.AUDIT_READ, Permission.AUDIT_EXPORT],
      Billing: [Permission.BILLING_READ, Permission.BILLING_MANAGE],
      "AI Features": [Permission.AI_USE, Permission.AI_CONFIGURE],
      Support: [Permission.SUPPORT_READ, Permission.SUPPORT_RESPOND],
    };
  }

  /**
   * Validate role hierarchy (prevent privilege escalation).
   * Now queries the DB for role levels.
   */
  async canModifyRole(adminRole: string, targetRole: string): Promise<boolean> {
    const [adminRoleRecord, targetRoleRecord] = await Promise.all([
      prisma.role.findUnique({ where: { name: adminRole } }),
      prisma.role.findUnique({ where: { name: targetRole } }),
    ]);

    const adminLevel = adminRoleRecord?.level ?? 0;
    const targetLevel = targetRoleRecord?.level ?? 0;

    return adminLevel >= targetLevel;
  }
}

// NOTE: No module-level singleton. RbacService is registered in the DI
// container (TOKENS.RbacService) and receives AdminUserRepositoryPort via
// constructor injection. See setup.ts for registration.
