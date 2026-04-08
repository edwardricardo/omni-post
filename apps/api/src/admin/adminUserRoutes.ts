/**
 * @file adminUserRoutes.ts
 * @description Admin CRUD endpoints for managing AdminUser records.
 *              Protected by admin authentication with role-based access control.
 * @layer infrastructure (routes)
 */
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import { requireAdminAuth, requireAdmin, requireSuperAdmin } from "./auth/adminAuthMiddleware.js";
import { prisma } from "@infra/prisma";

// --- Zod Schemas ---

const IdParamsSchema = z.object({
  id: z.string().min(1),
});

const CreateAdminUserSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(200),
  role: z.enum(["ADMIN", "SUPPORT"]),
  password: z.string().min(8).max(128).optional(),
});

const UpdateAdminUserSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().max(255).optional(),
  role: z.enum(["ADMIN", "SUPPORT"]).optional(),
  department: z.string().max(200).nullable().optional(),
  team: z.string().max(200).nullable().optional(),
});

// --- Helper ---

/**
 * @description Generates a cryptographically secure random password of 16 characters.
 */
function generateRandomPassword(): string {
  return randomBytes(12).toString("base64url").slice(0, 16);
}

/**
 * @description Hashes a password using argon2id with the same settings as seed.ts.
 */
async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

// --- Handler ---

class AdminUserHandler extends BaseRouteHandler {
  protected routeName = "admin-users";

  /**
   * @method listUsers
   * @description Returns all AdminUser records with safe fields (no password hashes).
   * @param request - Fastify request
   * @param reply - Fastify reply
   */
  async listUsers(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    try {
      const users = await prisma.adminUser.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          mfaEnabled: true,
          lastLoginAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      });

      return this.sendSuccess(ctx, { users });
    } catch (error: unknown) {
      this.logError(ctx, "Failed to list admin users", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }

  /**
   * @method createUser
   * @description Creates a new AdminUser. Generates random password if none provided.
   * @param request - Fastify request with CreateAdminUserSchema body
   * @param reply - Fastify reply
   */
  async createUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const bodyResult = CreateAdminUserSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { email, name, role } = bodyResult.data;
    const temporaryPassword = bodyResult.data.password ?? generateRandomPassword();

    try {
      // Check uniqueness
      const existing = await prisma.adminUser.findUnique({ where: { email } });
      if (existing) {
        return this.sendError(ctx, 409, "An admin user with this email already exists");
      }

      const passwordHash = await hashPassword(temporaryPassword);

      // Resolve role name to roleId
      const roleRecord = await prisma.role.findUnique({ where: { name: role || "ADMIN" } });
      const roleId = roleRecord?.id ?? "role-admin";

      const user = await prisma.adminUser.create({
        data: {
          email,
          name,
          roleId,
          passwordHash,
          mustChangePassword: true,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: { select: { name: true } },
        },
      });

      return this.sendSuccess(
        ctx,
        { user: { ...user, role: user.role.name }, temporaryPassword },
        201
      );
    } catch (error: unknown) {
      this.logError(ctx, "Failed to create admin user", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }

  /**
   * @method getUserDetail
   * @description Returns detailed info for a single AdminUser including sessions count.
   * @param request - Fastify request with id param
   * @param reply - Fastify reply
   */
  async getUserDetail(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsResult = IdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const { id } = paramsResult.data;

    try {
      const user = await prisma.adminUser.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          mfaEnabled: true,
          lastLoginAt: true,
          department: true,
          team: true,
          timezone: true,
          locale: true,
          mustChangePassword: true,
          failedLoginAttempts: true,
          lockedUntil: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { sessions: true },
          },
        },
      });

      if (!user) {
        return this.sendError(ctx, 404, "Admin user not found");
      }

      const { _count, ...userData } = user;
      return this.sendSuccess(ctx, {
        user: {
          ...userData,
          sessionsCount: _count.sessions,
        },
      });
    } catch (error: unknown) {
      this.logError(ctx, "Failed to fetch admin user detail", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }

  /**
   * @method updateUser
   * @description Updates an AdminUser. Role changes require SUPER_ADMIN and cannot target self.
   * @param request - Fastify request with id param and UpdateAdminUserSchema body
   * @param reply - Fastify reply
   */
  async updateUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsResult = IdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const bodyResult = UpdateAdminUserSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { id } = paramsResult.data;
    const updates = bodyResult.data;
    const currentUserId = request.auth?.user.id;
    const currentUserRole = request.auth?.user.role;

    // Role change requires SUPER_ADMIN
    if (updates.role !== undefined) {
      if (currentUserRole !== "SUPER_ADMIN") {
        return this.sendError(ctx, 403, "Only SUPER_ADMIN can change user roles");
      }
      if (id === currentUserId) {
        return this.sendError(ctx, 400, "Cannot change your own role");
      }
    }

    try {
      // Check email uniqueness if changing email
      if (updates.email !== undefined) {
        const existing = await prisma.adminUser.findFirst({
          where: { email: updates.email, id: { not: id } },
        });
        if (existing) {
          return this.sendError(ctx, 409, "An admin user with this email already exists");
        }
      }

      const data: Record<string, unknown> = {};
      if (updates.name !== undefined) data.name = updates.name;
      if (updates.email !== undefined) data.email = updates.email;
      if (updates.role !== undefined) data.role = updates.role;
      if (updates.department !== undefined) data.department = updates.department;
      if (updates.team !== undefined) data.team = updates.team;

      const updated = await prisma.adminUser.update({
        where: { id },
        data,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          department: true,
          team: true,
          updatedAt: true,
        },
      });

      return this.sendSuccess(ctx, { user: updated });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Record to update not found")) {
        return this.sendError(ctx, 404, "Admin user not found");
      }
      this.logError(ctx, "Failed to update admin user", { error: msg });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }

  /**
   * @method deactivateUser
   * @description Soft-deletes an AdminUser by setting isActive=false.
   *              Cannot deactivate self or the last active SUPER_ADMIN.
   * @param request - Fastify request with id param
   * @param reply - Fastify reply
   */
  async deactivateUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsResult = IdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const { id } = paramsResult.data;
    const currentUserId = request.auth?.user.id;

    if (id === currentUserId) {
      return this.sendError(ctx, 400, "Cannot deactivate yourself");
    }

    try {
      const target = await prisma.adminUser.findUnique({
        where: { id },
        select: { id: true, role: { select: { name: true } }, isActive: true },
      });

      if (!target) {
        return this.sendError(ctx, 404, "Admin user not found");
      }

      if (!target.isActive) {
        return this.sendError(ctx, 400, "User is already inactive");
      }

      // Safety: cannot deactivate the last active SUPER_ADMIN
      if (target.role.name === "SUPER_ADMIN") {
        const superAdminRole = await prisma.role.findUnique({
          where: { name: "SUPER_ADMIN" },
        });
        const activeSuperAdminCount = superAdminRole
          ? await prisma.adminUser.count({
              where: { roleId: superAdminRole.id, isActive: true },
            })
          : 0;
        if (activeSuperAdminCount <= 1) {
          return this.sendError(ctx, 400, "Cannot deactivate the last active SUPER_ADMIN");
        }
      }

      const updated = await prisma.adminUser.update({
        where: { id },
        data: { isActive: false },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
        },
      });

      return this.sendSuccess(ctx, { user: updated });
    } catch (error: unknown) {
      this.logError(ctx, "Failed to deactivate admin user", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }

  /**
   * @method activateUser
   * @description Reactivates an AdminUser by setting isActive=true.
   * @param request - Fastify request with id param
   * @param reply - Fastify reply
   */
  async activateUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsResult = IdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const { id } = paramsResult.data;

    try {
      const target = await prisma.adminUser.findUnique({
        where: { id },
        select: { id: true, isActive: true },
      });

      if (!target) {
        return this.sendError(ctx, 404, "Admin user not found");
      }

      if (target.isActive) {
        return this.sendError(ctx, 400, "User is already active");
      }

      const updated = await prisma.adminUser.update({
        where: { id },
        data: { isActive: true },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
        },
      });

      return this.sendSuccess(ctx, { user: updated });
    } catch (error: unknown) {
      this.logError(ctx, "Failed to activate admin user", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }
}

// --- Plugin ---

const adminUserRoutes: FastifyPluginAsync = async (fastify) => {
  const handler = new AdminUserHandler();

  fastify.get(
    "/admin/users",
    {
      preHandler: [requireAdminAuth, requireAdmin],
      schema: { tags: ["Admin Users"], summary: "List all admin users" },
    },
    async (request, reply) => handler.listUsers(request, reply)
  );

  fastify.post(
    "/admin/users",
    {
      preHandler: [requireAdminAuth, requireSuperAdmin],
      schema: { tags: ["Admin Users"], summary: "Create admin user" },
    },
    async (request, reply) => handler.createUser(request, reply)
  );

  fastify.get(
    "/admin/users/:id",
    {
      preHandler: [requireAdminAuth, requireAdmin],
      schema: { tags: ["Admin Users"], summary: "Get admin user detail" },
    },
    async (request, reply) => handler.getUserDetail(request, reply)
  );

  fastify.put(
    "/admin/users/:id",
    {
      preHandler: [requireAdminAuth, requireAdmin],
      schema: { tags: ["Admin Users"], summary: "Update admin user" },
    },
    async (request, reply) => handler.updateUser(request, reply)
  );

  fastify.post(
    "/admin/users/:id/deactivate",
    {
      preHandler: [requireAdminAuth, requireSuperAdmin],
      schema: { tags: ["Admin Users"], summary: "Deactivate admin user" },
    },
    async (request, reply) => handler.deactivateUser(request, reply)
  );

  fastify.post(
    "/admin/users/:id/activate",
    {
      preHandler: [requireAdminAuth, requireSuperAdmin],
      schema: { tags: ["Admin Users"], summary: "Activate admin user" },
    },
    async (request, reply) => handler.activateUser(request, reply)
  );
};

export { adminUserRoutes };
