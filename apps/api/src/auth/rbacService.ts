import { prisma, AdminRole } from "@infra/prisma";
import { ok, err, type Result } from "@shared/types";
import { AuditableService } from "../services/AuditableService";
import type { AdminUserRepositoryPort } from "../domain/repositories/AdminUserRepository.js";
import { authLogger } from "../lib/logger.js";

// Permission definitions
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

// Role permission mappings
const RolePermissions: Record<string, Permission[]> = {
  SUPER_ADMIN: [
    // All permissions for super admin
    ...Object.values(Permission),
  ],

  ADMIN: [
    // User management
    Permission.USER_CREATE,
    Permission.USER_READ,
    Permission.USER_UPDATE,
    Permission.USER_DELETE,

    // Project management
    Permission.PROJECT_CREATE,
    Permission.PROJECT_READ,
    Permission.PROJECT_UPDATE,
    Permission.PROJECT_DELETE,

    // Content management
    Permission.CONTENT_CREATE,
    Permission.CONTENT_READ,
    Permission.CONTENT_UPDATE,
    Permission.CONTENT_DELETE,
    Permission.CONTENT_PUBLISH,

    // Analytics
    Permission.ANALYTICS_READ,
    Permission.ANALYTICS_EXPORT,

    // System monitoring
    Permission.SYSTEM_MONITOR,

    // Audit read
    Permission.AUDIT_READ,

    // Billing
    Permission.BILLING_READ,
    Permission.BILLING_MANAGE,

    // AI features
    Permission.AI_USE,

    // Support
    Permission.SUPPORT_READ,
    Permission.SUPPORT_RESPOND,
  ],

  SUPPORT: [
    // Limited user read
    Permission.USER_READ,

    // Project read
    Permission.PROJECT_READ,

    // Content read
    Permission.CONTENT_READ,

    // Analytics read
    Permission.ANALYTICS_READ,

    // Support operations
    Permission.SUPPORT_READ,
    Permission.SUPPORT_RESPOND,

    // Basic AI usage
    Permission.AI_USE,
  ],
};

export interface RoleInfo {
  role: string;
  permissions: Permission[];
  description: string;
  userCount: number;
}

export interface UserPermissions {
  userId: string;
  role: string;
  permissions: Permission[];
  canAccess: (permission: Permission) => boolean;
}

export class RbacService extends AuditableService {
  constructor(private readonly userRepo: AdminUserRepositoryPort) {
    super("RbacService");
  }
  /**
   * Check if a user has a specific permission
   */
  hasPermission(userRole: string, permission: Permission): boolean {
    const rolePermissions = RolePermissions[userRole] || [];
    return rolePermissions.includes(permission);
  }

  /**
   * Check if a user has any of the specified permissions
   */
  hasAnyPermission(userRole: string, permissions: Permission[]): boolean {
    return permissions.some((permission) => this.hasPermission(userRole, permission));
  }

  /**
   * Check if a user has all of the specified permissions
   */
  hasAllPermissions(userRole: string, permissions: Permission[]): boolean {
    return permissions.every((permission) => this.hasPermission(userRole, permission));
  }

  /**
   * Get all permissions for a user role
   */
  getUserPermissions(userId: string, userRole: string): UserPermissions {
    const permissions = RolePermissions[userRole] || [];

    return {
      userId,
      role: userRole,
      permissions,
      canAccess: (permission: Permission) => this.hasPermission(userRole, permission),
    };
  }

  /**
   * Get role information including user count
   */
  async getRoleInfo(role: string): Promise<Result<RoleInfo, "ROLE_NOT_FOUND" | "DATABASE_ERROR">> {
    try {
      if (!RolePermissions[role]) {
        return err("ROLE_NOT_FOUND");
      }

      const userCount = await prisma.adminUser.count({
        where: { role: role as AdminRole },
      });

      const roleDescriptions = {
        SUPER_ADMIN: "Full system access with all permissions",
        ADMIN: "Administrative access with content and user management capabilities",
        SUPPORT: "Limited access for customer support operations",
      };

      return ok({
        role,
        permissions: RolePermissions[role],
        description: roleDescriptions[role as keyof typeof roleDescriptions] || "Custom role",
        userCount,
      });
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Get role info error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Get all available roles and their information
   */
  async getAllRoles(): Promise<Result<RoleInfo[], "DATABASE_ERROR">> {
    try {
      const roles = Object.keys(RolePermissions);
      const roleInfoPromises = roles.map((role) => this.getRoleInfo(role));
      const roleResults = await Promise.all(roleInfoPromises);

      const roleInfos: RoleInfo[] = [];
      for (const result of roleResults) {
        if (result.ok) {
          roleInfos.push(result.value);
        }
      }

      return ok(roleInfos);
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Get all roles error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Update user role (admin operation)
   */
  async updateUserRole(
    adminUserId: string,
    targetUserId: string,
    newRole: string,
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
      // Validate role
      if (!RolePermissions[newRole]) {
        return err("INVALID_ROLE");
      }

      // Prevent self-modification
      if (adminUserId === targetUserId) {
        return err("CANNOT_MODIFY_SELF");
      }

      // ✅ Phase 1: Get admin user to check permissions using repository
      const adminUserResult = await this.userRepo.findById(adminUserId);

      if (!adminUserResult.ok) {
        return err("USER_NOT_FOUND");
      }

      const adminUser = adminUserResult.value;

      // Only SUPER_ADMIN can modify roles
      if (adminUser.role !== "SUPER_ADMIN") {
        return err("INSUFFICIENT_PERMISSIONS");
      }

      // ✅ Phase 1: Get target user using repository
      const targetUserResult = await this.userRepo.findById(targetUserId);

      if (!targetUserResult.ok) {
        return err("USER_NOT_FOUND");
      }

      const targetUser = targetUserResult.value;

      const oldRole = targetUser.role;

      // Update user role
      await prisma.adminUser.update({
        where: { id: targetUserId },
        data: { role: newRole as AdminRole },
      });

      // Log the role change with resource tracking for auditability
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
          newRole,
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
   * Get users by role
   */
  async getUsersByRole(role: string): Promise<
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
      if (!RolePermissions[role]) {
        return err("INVALID_ROLE");
      }

      const users = await prisma.adminUser.findMany({
        where: { role: role as AdminRole },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      });

      return ok(users);
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Get users by role error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Get permission categories for UI organization
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
   * Validate role hierarchy (prevent privilege escalation)
   */
  canModifyRole(adminRole: string, targetRole: string): boolean {
    const roleHierarchy = {
      SUPER_ADMIN: 3,
      ADMIN: 2,
      SUPPORT: 1,
    };

    const adminLevel = roleHierarchy[adminRole as keyof typeof roleHierarchy] || 0;
    const targetLevel = roleHierarchy[targetRole as keyof typeof roleHierarchy] || 0;

    // Can only modify roles at or below your level
    return adminLevel >= targetLevel;
  }
}

// NOTE: No module-level singleton. RbacService is registered in the DI
// container (TOKENS.RbacService) and receives AdminUserRepositoryPort via
// constructor injection. See setup.ts for registration.
