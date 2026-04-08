/**
 * @file roleManagementService.ts
 * @description CRUD operations for configurable RBAC roles.
 *              Extracted from RbacService to keep files under 800 lines.
 * @layer application
 */

import { prisma } from "@infra/prisma";
import { ok, err, type Result } from "@shared/types";
import { Permission } from "./rbacService.js";
import type { RbacService } from "./rbacService.js";
import { authLogger } from "../lib/logger.js";

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
const _MAX_ROLE_LEVEL = 99; // Level 100 is reserved for SUPER_ADMIN

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

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class RoleManagementService {
  constructor(private readonly rbacService: RbacService) {}

  /**
   * Create a new custom role.
   */
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
      // Validate name format
      const nameCheck = validateRoleName(input.name);
      if (!nameCheck.ok) return err("INVALID_NAME");

      // Validate level
      if (input.level >= 100) return err("LEVEL_TOO_HIGH");

      // Validate permissions
      const permsCheck = validatePermissions(input.permissions as string[]);
      if (!permsCheck.ok) return err("INVALID_PERMISSIONS");

      // Check for duplicate name
      const existing = await prisma.role.findUnique({ where: { name: input.name } });
      if (existing) return err("DUPLICATE_NAME");

      // Create role with permissions in a transaction
      const role = await prisma.role.create({
        data: {
          name: input.name,
          description: input.description,
          level: input.level,
          isSystem: false,
          isActive: true,
          permissions: {
            create: permsCheck.value.map((p) => ({ permission: p })),
          },
        },
        include: { permissions: true, _count: { select: { users: true } } },
      });

      this.rbacService.invalidateCache(input.name);

      return ok({
        id: role.id,
        name: role.name,
        description: role.description,
        level: role.level,
        isSystem: role.isSystem,
        isActive: role.isActive,
        permissions: role.permissions.map((rp) => rp.permission as Permission),
        userCount: role._count.users,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      });
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
      const existing = await prisma.role.findUnique({
        where: { id: roleId },
        include: { permissions: true, _count: { select: { users: true } } },
      });

      if (!existing) return err("ROLE_NOT_FOUND");

      // Cannot modify SUPER_ADMIN level
      if (existing.name === "SUPER_ADMIN" && input.level !== undefined) {
        return err("CANNOT_MODIFY_SUPER_ADMIN");
      }

      // Validate level
      if (input.level !== undefined && input.level >= 100) return err("LEVEL_TOO_HIGH");

      const data: Record<string, unknown> = {};
      if (input.description !== undefined) data.description = input.description;
      if (input.level !== undefined) data.level = input.level;

      const role = await prisma.role.update({
        where: { id: roleId },
        data,
        include: { permissions: true, _count: { select: { users: true } } },
      });

      this.rbacService.invalidateCache(role.name);

      return ok({
        id: role.id,
        name: role.name,
        description: role.description,
        level: role.level,
        isSystem: role.isSystem,
        isActive: role.isActive,
        permissions: role.permissions.map((rp) => rp.permission as Permission),
        userCount: role._count.users,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      });
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Update role error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Set permissions for a role (bulk replace).
   * Cannot modify SUPER_ADMIN permissions.
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
      const existing = await prisma.role.findUnique({ where: { id: roleId } });
      if (!existing) return err("ROLE_NOT_FOUND");
      if (existing.name === "SUPER_ADMIN") return err("CANNOT_MODIFY_SUPER_ADMIN");

      // Validate permissions
      const permsCheck = validatePermissions(permissions);
      if (!permsCheck.ok) return err("INVALID_PERMISSIONS");

      // Delete old and insert new in a batch
      await prisma.rolePermission.deleteMany({ where: { roleId } });
      await prisma.rolePermission.createMany({
        data: permsCheck.value.map((p) => ({ roleId, permission: p })),
      });

      this.rbacService.invalidateCache(existing.name);

      // Reload
      const role = await prisma.role.findUnique({
        where: { id: roleId },
        include: { permissions: true, _count: { select: { users: true } } },
      });

      if (!role) return err("ROLE_NOT_FOUND");

      return ok({
        id: role.id,
        name: role.name,
        description: role.description,
        level: role.level,
        isSystem: role.isSystem,
        isActive: role.isActive,
        permissions: role.permissions.map((rp) => rp.permission as Permission),
        userCount: role._count.users,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      });
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Set role permissions error");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * Delete a non-system role with no assigned users.
   */
  async deleteRole(
    roleId: string
  ): Promise<Result<void, "ROLE_NOT_FOUND" | "SYSTEM_ROLE" | "ROLE_IN_USE" | "DATABASE_ERROR">> {
    try {
      const existing = await prisma.role.findUnique({
        where: { id: roleId },
        include: { _count: { select: { users: true } } },
      });

      if (!existing) return err("ROLE_NOT_FOUND");
      if (existing.isSystem) return err("SYSTEM_ROLE");
      if (existing._count.users > 0) return err("ROLE_IN_USE");

      await prisma.role.delete({ where: { id: roleId } });
      this.rbacService.invalidateCache(existing.name);

      return ok(undefined);
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Delete role error");
      return err("DATABASE_ERROR");
    }
  }
}
