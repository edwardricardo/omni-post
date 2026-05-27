/**
 * @file adminUserRoutes.ts
 * @description Admin CRUD endpoints for managing AdminUser records.
 *              Protected by admin authentication with role-based access control.
 *              Persistence goes through AdminUserAdminService (ports), never Prisma.
 * @layer infrastructure
 */
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireAdminAuth } from "./auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "@core/domain/auth/Permission.js";
import type { AdminAuthService } from "./auth/AdminAuthService.js";
import type { AdminUserAdminService } from "./AdminUserAdminService.js";
import type { EmailPort } from "@core/domain/repositories/EmailPort.js";
import type { PlatformCredentialService } from "@core/application/security/PlatformCredentialService.js";
import { TOKENS } from "../infrastructure/container/types.js";
import { passwordResetEmail } from "../infrastructure/email/templates/emailTemplates.js";
import { createLogger } from "../lib/logger.js";
import type { AdminUserDto } from "@core/domain/repositories/ReadModelDtos.js";

const adminUserLogger = createLogger("admin-users");

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
  role: z.string().min(1).max(50).optional(),
  department: z.string().max(200).nullable().optional(),
  team: z.string().max(200).nullable().optional(),
  avatarUrl: z.string().url().max(2048).nullable().optional(),
});

// --- Handler ---

class AdminUserHandler extends BaseRouteHandler {
  protected routeName = "admin-users";

  constructor(
    private readonly adminUserService: AdminUserAdminService,
    private readonly adminAuthService: AdminAuthService,
    private readonly emailPort: EmailPort,
    private readonly credentialService: PlatformCredentialService
  ) {
    super();
  }

  /**
   * @method listUsers
   * @description Returns all AdminUser records with safe fields (no password hashes).
   * @param request - Fastify request
   * @param reply - Fastify reply
   */
  async listUsers(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    try {
      const all = await this.adminUserService.list();
      const users = all.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        isActive: u.isActive,
        mfaEnabled: u.mfaEnabled,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
      }));
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

    const { email, name, role, password } = bodyResult.data;

    try {
      const result = await this.adminUserService.create({
        email,
        name,
        role,
        ...(password !== undefined && { password }),
      });
      if (!result.ok) {
        return this.sendError(ctx, 409, "An admin user with this email already exists");
      }

      const { user, temporaryPassword } = result.value;
      return this.sendSuccess(
        ctx,
        {
          user: { id: user.id, email: user.email, name: user.name, role: user.role },
          temporaryPassword,
        },
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

    try {
      const result = await this.adminUserService.getDetail(paramsResult.data.id);
      if (!result.ok) {
        return this.sendError(ctx, 404, "Admin user not found");
      }

      const { user, sessionsCount } = result.value;
      return this.sendSuccess(ctx, {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          isActive: user.isActive,
          mfaEnabled: user.mfaEnabled,
          lastLoginAt: user.lastLoginAt,
          department: user.department,
          team: user.team,
          timezone: user.timezone,
          locale: user.locale,
          mustChangePassword: user.mustChangePassword,
          failedLoginAttempts: user.failedLoginAttempts,
          lockedUntil: user.lockedUntil,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          sessionsCount,
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

    // Role change requires SUPER_ADMIN and cannot target self.
    if (updates.role !== undefined) {
      if (currentUserRole !== "SUPER_ADMIN") {
        return this.sendError(ctx, 403, "Only SUPER_ADMIN can change user roles");
      }
      if (id === currentUserId) {
        return this.sendError(ctx, 400, "Cannot change your own role");
      }
    }

    try {
      const result = await this.adminUserService.update(id, {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.email !== undefined && { email: updates.email }),
        ...(updates.role !== undefined && { role: updates.role }),
        ...(updates.department !== undefined && { department: updates.department }),
        ...(updates.team !== undefined && { team: updates.team }),
        ...(updates.avatarUrl !== undefined && { avatarUrl: updates.avatarUrl }),
      });
      if (!result.ok) {
        switch (result.error) {
          case "EMAIL_EXISTS":
            return this.sendError(ctx, 409, "An admin user with this email already exists");
          case "INVALID_ROLE":
            return this.sendError(ctx, 400, `Invalid role: ${updates.role}`);
          case "NOT_FOUND":
            return this.sendError(ctx, 404, "Admin user not found");
        }
      }

      const user = result.value;
      return this.sendSuccess(ctx, {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          isActive: user.isActive,
          department: user.department,
          team: user.team,
          avatarUrl: user.avatarUrl,
          updatedAt: user.updatedAt,
        },
      });
    } catch (error: unknown) {
      this.logError(ctx, "Failed to update admin user", {
        error: error instanceof Error ? error.message : String(error),
      });
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
    if (id === request.auth?.user.id) {
      return this.sendError(ctx, 400, "Cannot deactivate yourself");
    }

    try {
      const result = await this.adminUserService.deactivate(id);
      if (!result.ok) {
        switch (result.error) {
          case "NOT_FOUND":
            return this.sendError(ctx, 404, "Admin user not found");
          case "ALREADY_INACTIVE":
            return this.sendError(ctx, 400, "User is already inactive");
          case "LAST_SUPER_ADMIN":
            return this.sendError(ctx, 400, "Cannot deactivate the last active SUPER_ADMIN");
        }
      }

      const user = result.value;
      return this.sendSuccess(ctx, {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          isActive: user.isActive,
        },
      });
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

    try {
      const result = await this.adminUserService.activate(paramsResult.data.id);
      if (!result.ok) {
        switch (result.error) {
          case "NOT_FOUND":
            return this.sendError(ctx, 404, "Admin user not found");
          case "ALREADY_ACTIVE":
            return this.sendError(ctx, 400, "User is already active");
        }
      }

      const user = result.value;
      return this.sendSuccess(ctx, {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          isActive: user.isActive,
        },
      });
    } catch (error: unknown) {
      this.logError(ctx, "Failed to activate admin user", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }

  /**
   * @method resetUserPassword
   * @description Initiates a password reset for another admin user by generating
   *   a reset token and sending an email with a link.
   * @param request - Fastify request with id param
   * @param reply - Fastify reply
   */
  async resetUserPassword(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsResult = IdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const { id } = paramsResult.data;
    const requestingUserId = request.auth?.user?.id;
    if (!requestingUserId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    if (id === requestingUserId) {
      return this.sendError(ctx, 400, "Use the change-password flow for your own account");
    }

    try {
      const targetResult = await this.adminUserService.findById(id);
      if (!targetResult.ok) {
        return this.sendError(ctx, 404, "Admin user not found");
      }

      const target: AdminUserDto = targetResult.value;
      if (!target.isActive) {
        return this.sendError(ctx, 400, "Cannot reset password for an inactive user");
      }

      const result = await this.adminAuthService.initiatePasswordReset(target.email);
      if (!result.ok) {
        return this.sendError(ctx, 500, "Failed to initiate password reset");
      }

      const resetToken = result.value;
      const adminUrlResult = await this.credentialService.getCredential("PLATFORM", "adminUrl");
      const adminUrl = (adminUrlResult.ok && adminUrlResult.value) || "http://localhost:3100";
      const resetUrl = `${adminUrl}/reset-password?token=${resetToken}`;

      const emailContent = await passwordResetEmail({
        userName: target.name,
        resetUrl,
      });

      const emailResult = await this.emailPort.send({
        to: [target.email],
        subject: emailContent.subject,
        body: `Password reset requested. Visit: ${resetUrl}`,
        html: emailContent.html,
      });

      if (!emailResult.ok) {
        adminUserLogger.warn(
          { err: emailResult.error, userId: id },
          "Password reset email delivery failed"
        );
      }

      this.logInfo(ctx, "Password reset initiated", { targetUserId: id });
      return this.sendSuccess(ctx, { message: "Password reset email sent" });
    } catch (error: unknown) {
      this.logError(ctx, "Failed to reset user password", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.sendError(ctx, 500, "Internal server error");
    }
  }
}

// --- Plugin ---

const adminUserRoutes: FastifyPluginAsync = async (fastify) => {
  const container = fastify.container!;
  const handler = new AdminUserHandler(
    container.resolve<AdminUserAdminService>(TOKENS.AdminUserAdminService),
    container.resolve<AdminAuthService>(TOKENS.AdminAuthService),
    container.resolve<EmailPort>(TOKENS.EmailPort),
    container.resolve<PlatformCredentialService>(TOKENS.PlatformCredentialService)
  );

  fastify.get(
    "/admin/users",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.USER_READ)],
      schema: { tags: ["Admin Users"], summary: "List all admin users" },
    },
    async (request, reply) => handler.listUsers(request, reply)
  );

  fastify.post(
    "/admin/users",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.USER_MANAGE)],
      schema: { tags: ["Admin Users"], summary: "Create admin user" },
    },
    async (request, reply) => handler.createUser(request, reply)
  );

  fastify.get(
    "/admin/users/:id",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.USER_READ)],
      schema: { tags: ["Admin Users"], summary: "Get admin user detail" },
    },
    async (request, reply) => handler.getUserDetail(request, reply)
  );

  fastify.put(
    "/admin/users/:id",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.USER_MANAGE)],
      schema: { tags: ["Admin Users"], summary: "Update admin user" },
    },
    async (request, reply) => handler.updateUser(request, reply)
  );

  fastify.post(
    "/admin/users/:id/deactivate",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.USER_MANAGE)],
      schema: { tags: ["Admin Users"], summary: "Deactivate admin user" },
    },
    async (request, reply) => handler.deactivateUser(request, reply)
  );

  fastify.post(
    "/admin/users/:id/activate",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.USER_MANAGE)],
      schema: { tags: ["Admin Users"], summary: "Activate admin user" },
    },
    async (request, reply) => handler.activateUser(request, reply)
  );

  fastify.post(
    "/admin/users/:id/password-reset",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.USER_MANAGE)],
      schema: { tags: ["Admin Users"], summary: "Reset admin user password via email" },
    },
    async (request, reply) => handler.resetUserPassword(request, reply)
  );
};

export { adminUserRoutes };
