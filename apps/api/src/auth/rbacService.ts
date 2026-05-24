/**
 * @file rbacService.ts
 * @description Role-based access control service. Permission checks are now
 *              backed by the Role / RolePermission tables instead of a
 *              hardcoded map. SUPER_ADMIN always receives all permissions
 *              regardless of the DB contents.
 * @layer application
 */

import { ok, err, type Result } from "@shared/types";
import type { CachePort } from "@ports/core";
import { AuditableService } from "../services/AuditableService";
import type { AdminUserRepositoryPort } from "../domain/repositories/AdminUserRepository.js";
import type { AuditLogRepository } from "../domain/repositories/AuditLogRepository.js";
import type { RoleRepository } from "../domain/repositories/RoleRepository.js";
import { authLogger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// Permission enum — master list of all permissions in the system
// ---------------------------------------------------------------------------

export enum Permission {
  // Admin user management
  USER_READ = "user:read",
  USER_MANAGE = "user:manage",
  USER_MANAGE_ROLES = "user:manage_roles",

  // Dashboard
  DASHBOARD_VIEW = "dashboard:view",

  // Customer account management
  ACCOUNT_READ = "account:read",
  ACCOUNT_MANAGE = "account:manage",

  // Billing & subscriptions
  BILLING_READ = "billing:read",
  BILLING_MANAGE = "billing:manage",

  // Post management
  POST_MANAGE = "post:manage",

  // Pricing configuration
  PRICING_MANAGE = "pricing:manage",

  // Analytics & monitoring
  ANALYTICS_READ = "analytics:read",
  ANALYTICS_EXPORT = "analytics:export",

  // System administration
  SYSTEM_CONFIGURE = "system:configure",
  SYSTEM_MONITOR = "system:monitor",

  // Audit & compliance
  AUDIT_READ = "audit:read",
  AUDIT_EXPORT = "audit:export",

  // Webhooks
  WEBHOOK_MANAGE = "webhook:manage",

  // Secrets rotation status
  SECRETS_VIEW = "secrets:view",

  // Channel admin actions (force re-auth)
  CHANNELS_FORCE_REAUTH = "channels:force_reauth",

  // Webhook subscription admin (rotate signing secret)
  WEBHOOKS_ROTATE_SECRET = "webhooks:rotate_secret",

  // OIDC admin (replace client secret with handshake test)
  OIDC_REPLACE_SECRET = "oidc:replace_secret",

  // ApiKey admin (cross-tenant rotation)
  APIKEYS_ADMIN_ROTATE = "apikeys:admin_rotate",

  // Provider admin — cross-tenant mass force-reauth (post platform-secret rotation)
  PROVIDERS_MASS_FORCE_REAUTH = "providers:mass_force_reauth",
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
// Service
// ---------------------------------------------------------------------------

export class RbacService extends AuditableService {
  private cache: CachePort | undefined;
  private static readonly CACHE_TTL_SECONDS = 60;
  private static readonly CACHE_KEY_PREFIX = "rbac:role:";
  private static readonly CACHE_TAG = "rbac:role";

  constructor(
    private readonly userRepo: AdminUserRepositoryPort,
    private readonly roleRepo: RoleRepository,
    auditLog: AuditLogRepository,
    cache?: CachePort
  ) {
    super("RbacService", auditLog);
    this.cache = cache;
  }

  // -------------------------------------------------------------------------
  // Permission cache
  // -------------------------------------------------------------------------

  /**
   * Load permissions for a role from the DB (or cache).
   * SUPER_ADMIN always gets every permission regardless of DB contents.
   *
   * The cache is now backed by `CachePort` so revocations propagate cross-pod
   * via Redis (closes the OWASP A07 window where a stale local Map kept a
   * revoked permission valid until the local TTL expired). All entries share
   * the `rbac:role` tag so `invalidateCache()` (no arg) wipes the whole pool
   * without enumerating role names.
   */
  private async loadRolePermissions(roleName: string): Promise<Permission[]> {
    if (roleName === "SUPER_ADMIN") return Object.values(Permission);

    const cacheKey = `${RbacService.CACHE_KEY_PREFIX}${roleName}`;
    const factory = async (): Promise<Permission[]> => {
      const permissionNames = await this.roleRepo.findPermissionNamesByName(roleName);
      return permissionNames
        .filter((p) => Object.values(Permission).includes(p as Permission))
        .map((p) => p as Permission);
    };

    if (!this.cache) return factory();
    return this.cache.getOrSet<Permission[]>(cacheKey, factory, {
      ttlSeconds: RbacService.CACHE_TTL_SECONDS,
      tags: [RbacService.CACHE_TAG],
    });
  }

  /**
   * Invalidate the permission cache for a specific role or all roles.
   * Now propagates cross-pod via the shared cache backend.
   */
  async invalidateCache(roleName?: string): Promise<void> {
    if (!this.cache) return;
    if (roleName) {
      await this.cache.delete(`${RbacService.CACHE_KEY_PREFIX}${roleName}`);
    } else {
      await this.cache.invalidateByTag(RbacService.CACHE_TAG);
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
      const role = await this.roleRepo.findInfoByName(roleName);

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
                .filter((p) => Object.values(Permission).includes(p as Permission))
                .map((p) => p as Permission),
        userCount: role.userCount,
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
      const roles = await this.roleRepo.findAllActiveInfo();

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
                  .filter((p) => Object.values(Permission).includes(p as Permission))
                  .map((p) => p as Permission),
          userCount: r.userCount,
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
      const role = await this.roleRepo.findByName(newRoleName);
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
      await this.userRepo.update(targetUserId, { roleId: role.id });

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
      const role = await this.roleRepo.findByName(roleName);
      if (!role) return err("INVALID_ROLE");

      const users = await this.userRepo.findByRoleId(role.id);

      return ok(
        users.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          isActive: u.isActive,
          lastLoginAt: u.lastLoginAt,
          createdAt: u.createdAt,
        }))
      );
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
        Permission.USER_READ,
        Permission.USER_MANAGE,
        Permission.USER_MANAGE_ROLES,
      ],
      "Account Management": [Permission.ACCOUNT_READ, Permission.ACCOUNT_MANAGE],
      "Billing & Subscriptions": [Permission.BILLING_READ, Permission.BILLING_MANAGE],
      Pricing: [Permission.PRICING_MANAGE],
      Analytics: [Permission.ANALYTICS_READ, Permission.ANALYTICS_EXPORT],
      "System Administration": [Permission.SYSTEM_CONFIGURE, Permission.SYSTEM_MONITOR],
      "Audit & Compliance": [Permission.AUDIT_READ, Permission.AUDIT_EXPORT],
      Webhooks: [Permission.WEBHOOK_MANAGE],
      Dashboard: [Permission.DASHBOARD_VIEW],
      Posts: [Permission.POST_MANAGE],
      Secrets: [Permission.SECRETS_VIEW],
      "Channel Admin": [Permission.CHANNELS_FORCE_REAUTH],
      "Webhook Admin": [Permission.WEBHOOKS_ROTATE_SECRET],
      "OIDC Admin": [Permission.OIDC_REPLACE_SECRET],
      "API Keys Admin": [Permission.APIKEYS_ADMIN_ROTATE],
      "Provider Admin (Mass)": [Permission.PROVIDERS_MASS_FORCE_REAUTH],
    };
  }

  /**
   * Validate role hierarchy (prevent privilege escalation).
   * Now queries the DB for role levels.
   */
  async canModifyRole(adminRole: string, targetRole: string): Promise<boolean> {
    const [adminRoleRecord, targetRoleRecord] = await Promise.all([
      this.roleRepo.findByName(adminRole),
      this.roleRepo.findByName(targetRole),
    ]);

    const adminLevel = adminRoleRecord?.level ?? 0;
    const targetLevel = targetRoleRecord?.level ?? 0;

    return adminLevel >= targetLevel;
  }
}
