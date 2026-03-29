// ✅ Phase 6.3: Migrated to BaseRouteHandler Pattern
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext, IdSchema } from "@packages/api-common";
import { Permission } from "./rbacService.js";
import type { RbacService } from "./rbacService.js";
import { authenticateMiddleware, requireSuperAdmin, requireAdmin } from "./authMiddleware.js";
import { requirePermission } from "./rbacMiddleware.js";
import type { AuthenticatedUser } from "./authService.js";
import { TOKENS } from "../infrastructure/container/types.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

// ✅ Zod schemas for validation
const RoleSchema = z.enum(["SUPER_ADMIN", "ADMIN", "SUPPORT"]);

const RoleParamSchema = z.object({
  params: z.object({
    role: RoleSchema,
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
    role: RoleSchema,
    reason: z.string().min(10).max(500),
  }),
});

const CheckPermissionsSchema = z.object({
  body: z.object({
    permissions: z.array(z.string()).min(1),
    requireAll: z.boolean().default(false).optional(),
  }),
});

// ✅ BaseRouteHandler implementation
class RbacRouteHandler extends BaseRouteHandler {
  protected routeName = "rbac";

  constructor(private rbacService: RbacService) {
    super();
  }

  async getCurrentUserPermissions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const userId = request.user?.id;
    const userRole = request.user?.role;

    if (!userId || !userRole) {
      return this.sendError(ctx, 401, "User not authenticated");
    }

    const userPermissions = this.rbacService.getUserPermissions(userId, userRole);

    this.logInfo(ctx, "Retrieved user permissions", { userId, role: userRole });
    return this.sendSuccess(ctx, {
      user: {
        id: userId,
        role: userRole,
      },
      permissions: userPermissions.permissions,
      permissionCategories: this.rbacService.getPermissionCategories(),
    });
  }

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

  async updateUserRole(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const adminUserId = request.user?.id;

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

  async checkPermissions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const userRole = request.user?.role;

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

    // Validate permissions
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
      hasAccess = this.rbacService.hasAllPermissions(userRole, permissionObjects);
    } else {
      hasAccess = this.rbacService.hasAnyPermission(userRole, permissionObjects);
    }

    const userPermissions = this.rbacService.getUserPermissions(request.user!.id, userRole);
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

  async getHierarchy(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const roles = await this.rbacService.getAllRoles();

    if (!roles.ok) {
      return this.sendError(ctx, 500, "Failed to fetch role hierarchy");
    }

    const hierarchy = {
      SUPER_ADMIN: { level: 3, name: "Super Administrator" },
      ADMIN: { level: 2, name: "Administrator" },
      SUPPORT: { level: 1, name: "Support Agent" },
    };

    const permissionMatrix: Record<string, any> = {};
    for (const role of roles.value) {
      permissionMatrix[role.role] = role.permissions;
    }

    const currentUserRole = request.user?.role;
    const canModifyRoles = currentUserRole === "SUPER_ADMIN";

    this.logInfo(ctx, "Retrieved role hierarchy", { rolesCount: roles.value.length });
    return this.sendSuccess(ctx, {
      hierarchy,
      permissionMatrix,
      roles: roles.value,
      currentUser: {
        role: currentUserRole,
        canModifyRoles,
      },
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

// ✅ PROPER Fastify v5.6.1 Plugin Implementation
const rbacRoutes: FastifyPluginAsync = async (fastify) => {
  const rbacService = fastify.container!.resolve<RbacService>(TOKENS.RbacService);
  const handler = new RbacRouteHandler(rbacService);

  // ✅ Get current user's permissions
  fastify.get(
    "/auth/permissions",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["RBAC"], summary: "Get current user permissions" },
    },
    async (request, reply) => handler.getCurrentUserPermissions(request, reply)
  );

  // ✅ Get all available roles and permissions
  fastify.get(
    "/admin/rbac/roles",
    {
      preHandler: [authenticateMiddleware, requireAdmin],
      schema: { tags: ["RBAC"], summary: "Get all available roles and permissions" },
    },
    async (request, reply) => handler.getAllRoles(request, reply)
  );

  // ✅ Get specific role information
  fastify.get(
    "/admin/rbac/roles/:role",
    {
      preHandler: [authenticateMiddleware, requireAdmin],
      schema: { tags: ["RBAC"], summary: "Get specific role information" },
    },
    async (request, reply) => handler.getRoleInfo(request, reply)
  );

  // ✅ Get users by role
  fastify.get(
    "/admin/rbac/roles/:role/users",
    {
      preHandler: [authenticateMiddleware, requirePermission(Permission.USER_READ)],
      schema: { tags: ["RBAC"], summary: "Get users by role" },
    },
    async (request, reply) => handler.getUsersByRole(request, reply)
  );

  // ✅ Update user role
  fastify.put(
    "/admin/rbac/users/:userId/role",
    {
      preHandler: [authenticateMiddleware, requireSuperAdmin],
      schema: { tags: ["RBAC"], summary: "Update user role" },
    },
    async (request, reply) => handler.updateUserRole(request, reply)
  );

  // ✅ Check specific permission for current user
  fastify.post(
    "/auth/permissions/check",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["RBAC"], summary: "Check specific permissions for current user" },
    },
    async (request, reply) => handler.checkPermissions(request, reply)
  );

  // ✅ Get permission hierarchy and role comparison
  fastify.get(
    "/admin/rbac/hierarchy",
    {
      preHandler: [authenticateMiddleware, requireAdmin],
      schema: { tags: ["RBAC"], summary: "Get permission hierarchy and role comparison" },
    },
    async (request, reply) => handler.getHierarchy(request, reply)
  );

  // ✅ Get RBAC system status and statistics
  fastify.get(
    "/admin/rbac/status",
    {
      preHandler: [authenticateMiddleware, requireAdmin],
      schema: { tags: ["RBAC"], summary: "Get RBAC system status and statistics" },
    },
    async (request, reply) => handler.getStatus(request, reply)
  );
};

export { rbacRoutes };
