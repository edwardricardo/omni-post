/**
 * @file rbacRoutes.ts
 * @description RBAC API routes — role queries, permission checks, and
 *              role CRUD endpoints (SUPER_ADMIN only).
 * @layer infrastructure
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext, IdSchema } from "@packages/api-common";
import { Permission } from "./rbacService.js";
import type { RbacService } from "./rbacService.js";
import { RoleManagementService } from "./roleManagementService.js";
import { requireAdminAuth } from "../admin/auth/adminAuthMiddleware.js";
import { requirePermission } from "./rbacMiddleware.js";
import type { AuthenticatedUser } from "./authService.js";
import { TOKENS } from "../infrastructure/container/types.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const RoleParamSchema = z.object({
  params: z.object({
    role: z.string().min(1),
  }),
});

// Role IDs are CUIDs, not UUIDs
const RoleIdSchema = z.string().min(1).max(100);

const RoleIdParamSchema = z.object({
  params: z.object({
    roleId: RoleIdSchema,
  }),
});

const _UserIdParamSchema = z.object({
  params: z.object({
    userId: IdSchema,
  }),
});

const UpdateUserRoleSchema = z.object({
  params: z.object({
    userId: IdSchema,
  }),
  body: z.object({
    role: z.string().min(1),
    reason: z.string().min(10).max(500),
  }),
});

const CheckPermissionsSchema = z.object({
  body: z.object({
    permissions: z.array(z.string()).min(1),
    requireAll: z.boolean().default(false).optional(),
  }),
});

const CreateRoleSchema = z.object({
  body: z.object({
    name: z.string().min(3).max(50),
    description: z.string().min(0).max(500),
    level: z.number().int().min(1).max(99),
    permissions: z.array(z.string()).default([]),
  }),
});

const UpdateRoleSchema = z.object({
  params: z.object({ roleId: RoleIdSchema }),
  body: z.object({
    description: z.string().min(0).max(500).optional(),
    level: z.number().int().min(1).max(99).optional(),
  }),
});

const SetRolePermissionsSchema = z.object({
  params: z.object({ roleId: RoleIdSchema }),
  body: z.object({
    permissions: z.array(z.string()).min(0),
  }),
});

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

class RbacRouteHandler extends BaseRouteHandler {
  protected routeName = "rbac";

  constructor(
    private rbacService: RbacService,
    private roleManagement: RoleManagementService
  ) {
    super();
  }

  // -----------------------------------------------------------------------
  // Permission queries
  // -----------------------------------------------------------------------

  async getCurrentUserPermissions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const userId = request.auth?.user?.id;
    const userRole = request.auth?.user?.role;

    if (!userId || !userRole) {
      return this.sendError(ctx, 401, "User not authenticated");
    }

    const userPermissions = await this.rbacService.getUserPermissions(userId, userRole);

    this.logInfo(ctx, "Retrieved user permissions", { userId, role: userRole });
    return this.sendSuccess(ctx, {
      user: { id: userId, role: userRole },
      permissions: userPermissions.permissions,
      permissionCategories: this.rbacService.getPermissionCategories(),
    });
  }

  async checkPermissions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const userRole = request.auth?.user?.role;
    if (!userRole) {
      return this.sendError(ctx, 401, "User not authenticated");
    }

    const validated = await this.validateRequest<z.infer<typeof CheckPermissionsSchema>>(ctx, {
      body: CheckPermissionsSchema.shape.body,
    });
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { permissions, requireAll = false } = validated.value.body;

    const validPermissions = permissions.filter((p) =>
      Object.values(Permission).includes(p as Permission)
    );
    if (validPermissions.length !== permissions.length) {
      return this.sendError(ctx, 400, "Invalid permissions", {
        invalid: permissions.filter((p) => !Object.values(Permission).includes(p as Permission)),
      });
    }

    const permissionObjects = validPermissions as Permission[];
    let hasAccess: boolean;

    if (requireAll) {
      hasAccess = await this.rbacService.hasAllPermissions(userRole, permissionObjects);
    } else {
      hasAccess = await this.rbacService.hasAnyPermission(userRole, permissionObjects);
    }

    const userPermissions = await this.rbacService.getUserPermissions(
      request.auth?.user?.id ?? "",
      userRole
    );
    const grantedPermissions = permissionObjects.filter((p) =>
      userPermissions.permissions.includes(p)
    );
    const deniedPermissions = permissionObjects.filter(
      (p) => !userPermissions.permissions.includes(p)
    );

    this.logInfo(ctx, "Permissions checked", {
      hasAccess,
      requireAll,
      permissionsCount: permissionObjects.length,
    });
    return this.sendSuccess(ctx, {
      hasAccess,
      requireAll,
      permissions: {
        requested: permissionObjects,
        granted: grantedPermissions,
        denied: deniedPermissions,
      },
      user: {
        role: userRole,
        allPermissions: userPermissions.permissions,
      },
    });
  }

  // -----------------------------------------------------------------------
  // Role queries
  // -----------------------------------------------------------------------

  async getAllRoles(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const result = await this.rbacService.getAllRoles();
    if (!result.ok) {
      return this.sendError(ctx, 500, "Failed to fetch roles");
    }

    this.logInfo(ctx, "Retrieved all roles", { count: result.value.length });
    return this.sendSuccess(ctx, {
      roles: result.value,
      permissionCategories: this.rbacService.getPermissionCategories(),
      allPermissions: Object.values(Permission),
    });
  }

  async getRoleInfo(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof RoleParamSchema>>(ctx, {
      params: RoleParamSchema.shape.params,
    });
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const { role } = validated.value.params;
    const result = await this.rbacService.getRoleInfo(role);

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        ROLE_NOT_FOUND: { status: 404, message: "Role not found" },
      };
      const error = errorMap[result.error] || {
        status: 500,
        message: "Failed to fetch role information",
      };
      return this.sendError(ctx, error.status, error.message);
    }

    this.logInfo(ctx, "Retrieved role information", { role });
    return this.sendSuccess(ctx, { role: result.value });
  }

  async getUsersByRole(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof RoleParamSchema>>(ctx, {
      params: RoleParamSchema.shape.params,
    });
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const { role } = validated.value.params;
    const result = await this.rbacService.getUsersByRole(role);

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        INVALID_ROLE: { status: 400, message: "Invalid role specified" },
      };
      const error = errorMap[result.error] || { status: 500, message: "Failed to fetch users" };
      return this.sendError(ctx, error.status, error.message);
    }

    this.logInfo(ctx, "Retrieved users by role", { role, count: result.value.length });
    return this.sendSuccess(ctx, {
      role,
      users: result.value,
      count: result.value.length,
    });
  }

  // -----------------------------------------------------------------------
  // Role mutations
  // -----------------------------------------------------------------------

  async updateUserRole(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const adminUserId = request.auth?.user?.id;
    if (!adminUserId) {
      return this.sendError(ctx, 401, "Admin user not authenticated");
    }

    const validated = await this.validateRequest<z.infer<typeof UpdateUserRoleSchema>>(ctx, {
      params: UpdateUserRoleSchema.shape.params,
      body: UpdateUserRoleSchema.shape.body,
    });
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request");
    }

    const { userId } = validated.value.params;
    const { role, reason } = validated.value.body;

    const result = await this.rbacService.updateUserRole(adminUserId, userId, role, reason);

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        USER_NOT_FOUND: { status: 404, message: "User not found" },
        INVALID_ROLE: { status: 400, message: "Invalid role specified" },
        INSUFFICIENT_PERMISSIONS: {
          status: 403,
          message: "Insufficient permissions to modify user roles",
        },
        CANNOT_MODIFY_SELF: { status: 400, message: "Cannot modify your own role" },
        DATABASE_ERROR: { status: 500, message: "Database error occurred" },
      };
      const error = errorMap[result.error] || {
        status: 500,
        message: "Failed to update user role",
      };
      return this.sendError(ctx, error.status, error.message);
    }

    this.logInfo(ctx, "User role updated", { userId, newRole: role, updatedBy: adminUserId });
    return this.sendSuccess(ctx, {
      message: "User role updated successfully",
      userId,
      newRole: role,
      reason,
      updatedBy: adminUserId,
    });
  }

  async createRole(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof CreateRoleSchema>>(ctx, {
      body: CreateRoleSchema.shape.body,
    });
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request");
    }

    const result = await this.roleManagement.createRole({
      ...validated.value.body,
      permissions: validated.value.body.permissions as Permission[],
    });

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        INVALID_NAME: {
          status: 400,
          message: "Role name must be UPPER_SNAKE_CASE, 3-50 chars",
        },
        INVALID_PERMISSIONS: { status: 400, message: "One or more invalid permissions" },
        DUPLICATE_NAME: { status: 409, message: "A role with this name already exists" },
        LEVEL_TOO_HIGH: { status: 400, message: "Level must be less than 100" },
        DATABASE_ERROR: { status: 500, message: "Database error occurred" },
      };
      const error = errorMap[result.error] || { status: 500, message: "Failed to create role" };
      return this.sendError(ctx, error.status, error.message);
    }

    this.logInfo(ctx, "Role created", { name: validated.value.body.name });
    return this.sendSuccess(ctx, { role: result.value }, 201);
  }

  async updateRoleMetadata(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof UpdateRoleSchema>>(ctx, {
      params: UpdateRoleSchema.shape.params,
      body: UpdateRoleSchema.shape.body,
    });
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request");
    }

    const result = await this.roleManagement.updateRole(
      validated.value.params.roleId,
      validated.value.body
    );

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        ROLE_NOT_FOUND: { status: 404, message: "Role not found" },
        CANNOT_MODIFY_SUPER_ADMIN: {
          status: 403,
          message: "Cannot modify SUPER_ADMIN role level",
        },
        LEVEL_TOO_HIGH: { status: 400, message: "Level must be less than 100" },
        DATABASE_ERROR: { status: 500, message: "Database error occurred" },
      };
      const error = errorMap[result.error] || { status: 500, message: "Failed to update role" };
      return this.sendError(ctx, error.status, error.message);
    }

    this.logInfo(ctx, "Role updated", { roleId: validated.value.params.roleId });
    return this.sendSuccess(ctx, { role: result.value });
  }

  async setRolePermissions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof SetRolePermissionsSchema>>(ctx, {
      params: SetRolePermissionsSchema.shape.params,
      body: SetRolePermissionsSchema.shape.body,
    });
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request");
    }

    const result = await this.roleManagement.setRolePermissions(
      validated.value.params.roleId,
      validated.value.body.permissions
    );

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        ROLE_NOT_FOUND: { status: 404, message: "Role not found" },
        CANNOT_MODIFY_SUPER_ADMIN: {
          status: 403,
          message: "Cannot modify SUPER_ADMIN permissions",
        },
        INVALID_PERMISSIONS: { status: 400, message: "One or more invalid permissions" },
        DATABASE_ERROR: { status: 500, message: "Database error occurred" },
      };
      const error = errorMap[result.error] || {
        status: 500,
        message: "Failed to set role permissions",
      };
      return this.sendError(ctx, error.status, error.message);
    }

    this.logInfo(ctx, "Role permissions set", { roleId: validated.value.params.roleId });
    return this.sendSuccess(ctx, { role: result.value });
  }

  async deleteRole(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof RoleIdParamSchema>>(ctx, {
      params: RoleIdParamSchema.shape.params,
    });
    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const result = await this.roleManagement.deleteRole(validated.value.params.roleId);

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        ROLE_NOT_FOUND: { status: 404, message: "Role not found" },
        SYSTEM_ROLE: { status: 403, message: "Cannot delete a system role" },
        ROLE_IN_USE: { status: 409, message: "Cannot delete a role with assigned users" },
        DATABASE_ERROR: { status: 500, message: "Database error occurred" },
      };
      const error = errorMap[result.error] || { status: 500, message: "Failed to delete role" };
      return this.sendError(ctx, error.status, error.message);
    }

    this.logInfo(ctx, "Role deleted", { roleId: validated.value.params.roleId });
    return this.sendSuccess(ctx, { message: "Role deleted successfully" });
  }

  // -----------------------------------------------------------------------
  // Hierarchy and status
  // -----------------------------------------------------------------------

  async getHierarchy(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const roles = await this.rbacService.getAllRoles();
    if (!roles.ok) {
      return this.sendError(ctx, 500, "Failed to fetch role hierarchy");
    }

    // Build hierarchy from DB roles
    const hierarchy: Record<string, { level: number; name: string }> = {};
    for (const role of roles.value) {
      hierarchy[role.role] = { level: role.level, name: role.description || role.role };
    }

    const permissionMatrix: Record<string, Permission[]> = {};
    for (const role of roles.value) {
      permissionMatrix[role.role] = role.permissions;
    }

    const currentUserRole = request.auth?.user?.role;
    const canModifyRoles = currentUserRole === "SUPER_ADMIN";

    this.logInfo(ctx, "Retrieved role hierarchy", { rolesCount: roles.value.length });
    return this.sendSuccess(ctx, {
      hierarchy,
      permissionMatrix,
      roles: roles.value,
      currentUser: { role: currentUserRole, canModifyRoles },
      permissionCategories: this.rbacService.getPermissionCategories(),
    });
  }

  async getStatus(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const roles = await this.rbacService.getAllRoles();
    if (!roles.ok) {
      return this.sendError(ctx, 500, "Failed to fetch RBAC status");
    }

    const totalUsers = roles.value.reduce((sum, role) => sum + role.userCount, 0);
    const totalPermissions = Object.keys(Permission).length;
    const totalRoles = roles.value.length;

    const statistics = {
      totalUsers,
      totalRoles,
      totalPermissions,
      roleDistribution: roles.value.map((role) => ({
        role: role.role,
        userCount: role.userCount,
        percentage: totalUsers > 0 ? Math.round((role.userCount / totalUsers) * 100) : 0,
      })),
      permissionCategories: Object.keys(this.rbacService.getPermissionCategories()).length,
    };

    this.logInfo(ctx, "Retrieved RBAC status", { totalUsers, totalRoles });
    return this.sendSuccess(ctx, {
      status: "active",
      statistics,
      roles: roles.value,
      lastUpdated: new Date().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

const rbacRoutes: FastifyPluginAsync = async (fastify) => {
  const rbacService = fastify.container!.resolve<RbacService>(TOKENS.RbacService);
  const roleManagement = new RoleManagementService(rbacService);
  const handler = new RbacRouteHandler(rbacService, roleManagement);

  // Permission queries
  fastify.get(
    "/auth/permissions",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["RBAC"], summary: "Get current user permissions" },
    },
    async (request, reply) => handler.getCurrentUserPermissions(request, reply)
  );

  fastify.post(
    "/auth/permissions/check",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["RBAC"], summary: "Check specific permissions for current user" },
    },
    async (request, reply) => handler.checkPermissions(request, reply)
  );

  // Role queries
  fastify.get(
    "/admin/rbac/roles",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.USER_READ)],
      schema: { tags: ["RBAC"], summary: "Get all available roles and permissions" },
    },
    async (request, reply) => handler.getAllRoles(request, reply)
  );

  fastify.get(
    "/admin/rbac/roles/:role",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.USER_READ)],
      schema: { tags: ["RBAC"], summary: "Get specific role information" },
    },
    async (request, reply) => handler.getRoleInfo(request, reply)
  );

  fastify.get(
    "/admin/rbac/roles/:role/users",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.USER_READ)],
      schema: { tags: ["RBAC"], summary: "Get users by role" },
    },
    async (request, reply) => handler.getUsersByRole(request, reply)
  );

  fastify.get(
    "/admin/rbac/hierarchy",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.USER_READ)],
      schema: { tags: ["RBAC"], summary: "Get permission hierarchy and role comparison" },
    },
    async (request, reply) => handler.getHierarchy(request, reply)
  );

  fastify.get(
    "/admin/rbac/status",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.USER_READ)],
      schema: { tags: ["RBAC"], summary: "Get RBAC system status and statistics" },
    },
    async (request, reply) => handler.getStatus(request, reply)
  );

  // Role mutations (SUPER_ADMIN only)
  fastify.put(
    "/admin/rbac/users/:userId/role",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.USER_MANAGE_ROLES)],
      schema: { tags: ["RBAC"], summary: "Update user role" },
    },
    async (request, reply) => handler.updateUserRole(request, reply)
  );

  fastify.post(
    "/admin/rbac/roles",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.USER_MANAGE_ROLES)],
      schema: { tags: ["RBAC"], summary: "Create a new role" },
    },
    async (request, reply) => handler.createRole(request, reply)
  );

  fastify.put(
    "/admin/rbac/roles/:roleId",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.USER_MANAGE_ROLES)],
      schema: { tags: ["RBAC"], summary: "Update role metadata" },
    },
    async (request, reply) => handler.updateRoleMetadata(request, reply)
  );

  fastify.put(
    "/admin/rbac/roles/:roleId/permissions",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.USER_MANAGE_ROLES)],
      schema: { tags: ["RBAC"], summary: "Set role permissions (bulk replace)" },
    },
    async (request, reply) => handler.setRolePermissions(request, reply)
  );

  fastify.delete(
    "/admin/rbac/roles/:roleId",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.USER_MANAGE_ROLES)],
      schema: { tags: ["RBAC"], summary: "Delete a custom role" },
    },
    async (request, reply) => handler.deleteRole(request, reply)
  );
};

export { rbacRoutes };
