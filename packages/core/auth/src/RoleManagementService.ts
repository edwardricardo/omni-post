/**
 * @file RoleManagementService.ts
 * @description CRUD operations for configurable RBAC roles. Framework-free:
 *   depends only on `RoleManagementRepository` + `RbacCacheInvalidatorPort`
 *   + the canonical `Permission` enum.
 * @layer application
 */

import { ok, err, type Result } from "@shared/types";
import { createLogger } from "@observability/logger";
import { Permission } from "@core/domain/auth/Permission.js";
import type { RoleManagementRepository } from "@core/domain/repositories/RoleManagementRepository.js";
import type { RbacCacheInvalidatorPort } from "@core/domain/repositories/RbacCacheInvalidatorPort.js";

const authLogger = createLogger("role-management");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateRoleInput {
  name: string;
  description: string;
  level: number;
  permissions: Permission[];
}

export interface UpdateRoleInput {
  description?: string | undefined;
  level?: number | undefined;
}

export interface RoleDetail {
  id: string;
  name: string;
  description: string;
  level: number;
  isSystem: boolean;
  isActive: boolean;
  permissions: Permission[];
  userCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const ROLE_NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,48}[A-Z0-9]$/;

function validateRoleName(name: string): Result<void, "INVALID_NAME"> {
  if (!ROLE_NAME_PATTERN.test(name)) return err("INVALID_NAME");
  return ok(undefined);
}

function validatePermissions(permissions: string[]): Result<Permission[], "INVALID_PERMISSIONS"> {
  const allPerms = Object.values(Permission) as string[];
  const invalid = permissions.filter((p) => !allPerms.includes(p));
  if (invalid.length > 0) return err("INVALID_PERMISSIONS");
  return ok(permissions as Permission[]);
}

function detailToRoleDetail(detail: {
  id: string;
  name: string;
  description: string;
  level: number;
  isSystem: boolean;
  isActive: boolean;
  permissions: string[];
  userCount: number;
  createdAt: Date;
  updatedAt: Date;
}): RoleDetail {
  return {
    id: detail.id,
    name: detail.name,
    description: detail.description,
    level: detail.level,
    isSystem: detail.isSystem,
    isActive: detail.isActive,
    permissions: detail.permissions as Permission[],
    userCount: detail.userCount,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class RoleManagementService {
  constructor(
    private readonly roleRepo: RoleManagementRepository,
    private readonly rbacCache: RbacCacheInvalidatorPort
  ) {}

  /** Create a new custom role. */
  async createRole(
    input: CreateRoleInput
  ): Promise<
    Result<
      RoleDetail,
      | "INVALID_NAME"
      | "INVALID_PERMISSIONS"
      | "DUPLICATE_NAME"
      | "LEVEL_TOO_HIGH"
      | "DATABASE_ERROR"
    >
  > {
    try {
      const nameCheck = validateRoleName(input.name);
      if (!nameCheck.ok) return err("INVALID_NAME");

      if (input.level >= 100) return err("LEVEL_TOO_HIGH");

      const permsCheck = validatePermissions(input.permissions as string[]);
      if (!permsCheck.ok) return err("INVALID_PERMISSIONS");

      const existing = await this.roleRepo.findByName(input.name);
      if (!existing.ok) return err("DATABASE_ERROR");
      if (existing.value) return err("DUPLICATE_NAME");

      const created = await this.roleRepo.create({
        name: input.name,
        description: input.description,
        level: input.level,
        permissions: permsCheck.value,
      });
      if (!created.ok) return err("DATABASE_ERROR");

      await this.rbacCache.invalidate(input.name);

      return ok(detailToRoleDetail(created.value));
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Create role error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Update a role's metadata (description, level).
   * System role level cannot be changed (except by DB admin).
   */
  async updateRole(
    roleId: string,
    input: UpdateRoleInput
  ): Promise<
    Result<
      RoleDetail,
      "ROLE_NOT_FOUND" | "CANNOT_MODIFY_SUPER_ADMIN" | "LEVEL_TOO_HIGH" | "DATABASE_ERROR"
    >
  > {
    try {
      const existingResult = await this.roleRepo.findDetailById(roleId);
      if (!existingResult.ok) return err("DATABASE_ERROR");
      const existing = existingResult.value;
      if (!existing) return err("ROLE_NOT_FOUND");

      if (existing.name === "SUPER_ADMIN" && input.level !== undefined) {
        return err("CANNOT_MODIFY_SUPER_ADMIN");
      }

      if (input.level !== undefined && input.level >= 100) return err("LEVEL_TOO_HIGH");

      const update: { description?: string; level?: number } = {};
      if (input.description !== undefined) update.description = input.description;
      if (input.level !== undefined) update.level = input.level;

      const updated = await this.roleRepo.update(roleId, update);
      if (!updated.ok) return err("DATABASE_ERROR");

      await this.rbacCache.invalidate(updated.value.name);

      return ok(detailToRoleDetail(updated.value));
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Update role error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Set permissions for a role (bulk replace). Cannot modify SUPER_ADMIN.
   */
  async setRolePermissions(
    roleId: string,
    permissions: string[]
  ): Promise<
    Result<
      RoleDetail,
      "ROLE_NOT_FOUND" | "CANNOT_MODIFY_SUPER_ADMIN" | "INVALID_PERMISSIONS" | "DATABASE_ERROR"
    >
  > {
    try {
      const existingResult = await this.roleRepo.findSummaryById(roleId);
      if (!existingResult.ok) return err("DATABASE_ERROR");
      const existing = existingResult.value;
      if (!existing) return err("ROLE_NOT_FOUND");
      if (existing.name === "SUPER_ADMIN") return err("CANNOT_MODIFY_SUPER_ADMIN");

      const permsCheck = validatePermissions(permissions);
      if (!permsCheck.ok) return err("INVALID_PERMISSIONS");

      const replaced = await this.roleRepo.replacePermissions(roleId, permsCheck.value);
      if (!replaced.ok) return err("DATABASE_ERROR");

      await this.rbacCache.invalidate(existing.name);

      return ok(detailToRoleDetail(replaced.value));
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Set role permissions error");
      return err("DATABASE_ERROR");
    }
  }

  /** Delete a non-system role with no assigned users. */
  async deleteRole(
    roleId: string
  ): Promise<Result<void, "ROLE_NOT_FOUND" | "SYSTEM_ROLE" | "ROLE_IN_USE" | "DATABASE_ERROR">> {
    try {
      const existingResult = await this.roleRepo.findSummaryById(roleId);
      if (!existingResult.ok) return err("DATABASE_ERROR");
      const existing = existingResult.value;
      if (!existing) return err("ROLE_NOT_FOUND");
      if (existing.isSystem) return err("SYSTEM_ROLE");
      if (existing.userCount > 0) return err("ROLE_IN_USE");

      const deleted = await this.roleRepo.delete(roleId);
      if (!deleted.ok) return err("DATABASE_ERROR");

      await this.rbacCache.invalidate(existing.name);

      return ok(undefined);
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Delete role error");
      return err("DATABASE_ERROR");
    }
  }
}
