/**
 * @file mfaRoutes.ts
 * @description Fastify route plugin for multi-factor authentication endpoints including
 *              MFA setup, verification, backup codes, and admin MFA management.
 * @layer infrastructure
 */
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext, IdSchema } from "@packages/api-common";
import type { MfaService } from "./mfaService.js";
import { requireAdminAuth } from "../admin/auth/adminAuthMiddleware.js";
import { requirePermission } from "./rbacMiddleware.js";
import { Permission } from "./rbacService.js";
import { requireClientAuth } from "./customerAuthMiddleware.js";
import type { AuditService } from "../audit/auditService.js";
import type { AuthenticatedUser } from "./authService.js";
import { TOKENS } from "../infrastructure/container/types.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

// ✅ Zod schemas for validation
const MfaTokenSchema = z.object({
  body: z.object({
    token: z.string().regex(/^[0-9]{6}$/, { message: "Token must be 6 digits" }),
  }),
});

const MfaTokenFlexibleSchema = z.object({
  body: z.object({
    token: z.string().min(6).max(8), // TOTP or backup code
  }),
});

const MfaVerifySchema = z.object({
  body: z.object({
    userId: IdSchema,
    token: z.string().min(6).max(8),
  }),
});

const AdminUserIdSchema = z.object({
  params: z.object({
    userId: IdSchema,
  }),
});

const AdminForceDisableMfaSchema = z.object({
  params: z.object({
    userId: IdSchema,
  }),
  body: z.object({
    reason: z.string().min(10).max(500),
  }),
});

// ✅ BaseRouteHandler implementation
class MfaRouteHandler extends BaseRouteHandler {
  protected routeName = "mfa";

  constructor(
    private mfaService: MfaService,
    private auditService: AuditService
  ) {
    super();
  }

  async getMfaStatus(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const userId = request.customerUser?.id;
    if (!userId) {
      return this.sendError(ctx, 401, "User not authenticated");
    }

    const result = await this.mfaService.getMfaStatus(userId);

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        USER_NOT_FOUND: { status: 404, message: "User not found" },
      };
      const error = errorMap[result.error] || { status: 500, message: "Failed to get MFA status" };
      return this.sendError(ctx, error.status, error.message);
    }

    this.logInfo(ctx, "Retrieved MFA status", { userId, enabled: result.value.enabled });
    return this.sendSuccess(ctx, { mfa: result.value });
  }

  async setupMfa(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const userId = request.customerUser?.id;
    const userEmail = request.customerUser?.id;

    if (!userId || !userEmail) {
      return this.sendError(ctx, 401, "User not authenticated");
    }

    const result = await this.mfaService.setupMfa(userId, userEmail);

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        USER_NOT_FOUND: { status: 404, message: "User not found" },
        MFA_ALREADY_ENABLED: { status: 409, message: "MFA is already enabled for this user" },
        DATABASE_ERROR: { status: 500, message: "Database error occurred" },
      };
      const error = errorMap[result.error] || { status: 500, message: "Failed to setup MFA" };
      return this.sendError(ctx, error.status, error.message);
    }

    const setupData = result.value;

    this.logInfo(ctx, "MFA setup initiated", { userId });
    return this.sendSuccess(ctx, {
      setup: {
        qrCodeUrl: setupData.qrCodeUrl,
        manualEntryKey: setupData.manualEntryKey,
        backupCodes: setupData.backupCodes,
      },
      instructions: {
        step1: "Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)",
        step2: "Or manually enter the key into your authenticator app",
        step3: "Save the backup codes in a secure location",
        step4: "Enter a code from your authenticator app to verify setup",
      },
    });
  }

  async verifyMfaSetup(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const userId = request.customerUser?.id;
    if (!userId) {
      return this.sendError(ctx, 401, "User not authenticated");
    }

    const validated = await this.validateRequest<z.infer<typeof MfaTokenSchema>>(ctx, {
      body: MfaTokenSchema.shape.body,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { token } = validated.value.body;

    const result = await this.mfaService.verifyMfaSetup(userId, token);

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        USER_NOT_FOUND: { status: 404, message: "User not found" },
        INVALID_TOKEN: {
          status: 400,
          message: "Invalid MFA token. Please check your authenticator app.",
        },
        MFA_ALREADY_ENABLED: { status: 409, message: "MFA is already enabled for this user" },
        NO_SETUP_IN_PROGRESS: {
          status: 400,
          message: "No MFA setup in progress. Please start setup first.",
        },
        DATABASE_ERROR: { status: 500, message: "Database error occurred" },
      };
      const error = errorMap[result.error] || {
        status: 400,
        message: "Failed to verify MFA setup",
      };
      return this.sendError(ctx, error.status, error.message);
    }

    this.logInfo(ctx, "MFA setup verified and enabled", { userId });
    return this.sendSuccess(ctx, {
      message: "MFA has been successfully enabled for your account",
      backupCodes: result.value.backupCodes,
      warning:
        "Save these backup codes in a secure location. You will not be able to see them again.",
    });
  }

  async verifyMfaToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof MfaVerifySchema>>(ctx, {
      body: MfaVerifySchema.shape.body,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { userId, token } = validated.value.body;

    const result = await this.mfaService.verifyMfaToken(userId, token);

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        USER_NOT_FOUND: { status: 404, message: "User not found" },
        MFA_NOT_ENABLED: { status: 400, message: "MFA is not enabled for this user" },
        INVALID_TOKEN: { status: 400, message: "Invalid MFA token or backup code" },
        DATABASE_ERROR: { status: 500, message: "Database error occurred" },
      };
      const error = errorMap[result.error] || { status: 400, message: "MFA verification failed" };
      return this.sendError(ctx, error.status, error.message);
    }

    const verification = result.value;

    this.logInfo(ctx, "MFA token verified", {
      userId,
      usedBackupCode: verification.usedBackupCode,
    });
    return this.sendSuccess(ctx, {
      verified: verification.verified,
      usedBackupCode: verification.usedBackupCode,
      message: verification.usedBackupCode
        ? "Verified with backup code. Consider regenerating backup codes."
        : "MFA token verified successfully",
    });
  }

  async disableMfa(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const userId = request.customerUser?.id;
    if (!userId) {
      return this.sendError(ctx, 401, "User not authenticated");
    }

    const validated = await this.validateRequest<z.infer<typeof MfaTokenFlexibleSchema>>(ctx, {
      body: MfaTokenFlexibleSchema.shape.body,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { token } = validated.value.body;

    const result = await this.mfaService.disableMfa(userId, token);

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        USER_NOT_FOUND: { status: 404, message: "User not found" },
        MFA_NOT_ENABLED: { status: 400, message: "MFA is not enabled for this user" },
        INVALID_TOKEN: {
          status: 400,
          message: "Invalid MFA token. Please provide a valid token to disable MFA.",
        },
        DATABASE_ERROR: { status: 500, message: "Database error occurred" },
      };
      const error = errorMap[result.error] || { status: 400, message: "Failed to disable MFA" };
      return this.sendError(ctx, error.status, error.message);
    }

    this.logInfo(ctx, "MFA disabled", { userId });
    return this.sendSuccess(ctx, {
      message: "MFA has been disabled for your account",
      warning: "Your account is now less secure. Consider re-enabling MFA.",
    });
  }

  async regenerateBackupCodes(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const userId = request.customerUser?.id;
    if (!userId) {
      return this.sendError(ctx, 401, "User not authenticated");
    }

    const validated = await this.validateRequest<z.infer<typeof MfaTokenSchema>>(ctx, {
      body: MfaTokenSchema.shape.body,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { token } = validated.value.body;

    const result = await this.mfaService.regenerateBackupCodes(userId, token);

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        USER_NOT_FOUND: { status: 404, message: "User not found" },
        MFA_NOT_ENABLED: { status: 400, message: "MFA is not enabled for this user" },
        INVALID_TOKEN: { status: 400, message: "Invalid MFA token. Please provide a valid token." },
        DATABASE_ERROR: { status: 500, message: "Database error occurred" },
      };
      const error = errorMap[result.error] || {
        status: 400,
        message: "Failed to regenerate backup codes",
      };
      return this.sendError(ctx, error.status, error.message);
    }

    this.logInfo(ctx, "Backup codes regenerated", { userId });
    return this.sendSuccess(ctx, {
      message: "New backup codes have been generated",
      backupCodes: result.value,
      warning:
        "Save these backup codes in a secure location. Old backup codes are no longer valid.",
    });
  }

  async getAdminMfaStatus(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof AdminUserIdSchema>>(ctx, {
      params: AdminUserIdSchema.shape.params,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid parameters");
    }

    const { userId } = validated.value.params;

    const result = await this.mfaService.getMfaStatus(userId);

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        USER_NOT_FOUND: { status: 404, message: "User not found" },
      };
      const error = errorMap[result.error] || {
        status: 500,
        message: "Failed to get user MFA status",
      };
      return this.sendError(ctx, error.status, error.message);
    }

    this.logInfo(ctx, "Admin retrieved MFA status", { targetUserId: userId });
    return this.sendSuccess(ctx, { userId, mfa: result.value });
  }

  async adminForceDisableMfa(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validated = await this.validateRequest<z.infer<typeof AdminForceDisableMfaSchema>>(ctx, {
      params: AdminForceDisableMfaSchema.shape.params,
      body: AdminForceDisableMfaSchema.shape.body,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request");
    }

    const { userId } = validated.value.params;
    const { reason } = validated.value.body;
    const adminUserId = request.auth?.user?.id;

    if (!adminUserId) {
      return this.sendError(ctx, 401, "Admin user ID not found");
    }

    // Delegate to MfaService (no direct Prisma access from routes)
    const result = await this.mfaService.adminForceDisable(userId);

    if (!result.ok) {
      const errorMap: Record<string, { status: number; message: string }> = {
        USER_NOT_FOUND: { status: 404, message: "User not found" },
        DATABASE_ERROR: { status: 500, message: "Failed to disable MFA" },
      };
      const error = errorMap[result.error] || { status: 500, message: "Failed to disable MFA" };
      return this.sendError(ctx, error.status, error.message);
    }

    // Log admin action
    await this.auditService.log({
      userId: adminUserId,
      action: "ADMIN_MFA_FORCE_DISABLED",
      resource: "AdminUser",
      resourceId: userId,
      details: {
        targetUserId: userId,
        reason,
      },
      ipAddress: request.ip,
      ...(request.headers["user-agent"] ? { userAgent: request.headers["user-agent"] } : {}),
      success: true,
    });

    this.logInfo(ctx, "Admin force-disabled MFA", { adminUserId, targetUserId: userId, reason });
    return this.sendSuccess(ctx, {
      message: "MFA has been force-disabled for the user",
      userId,
      disabledBy: adminUserId,
      reason,
    });
  }
}

// ✅ PROPER Fastify v5.6.1 Plugin Implementation
const mfaRoutes: FastifyPluginAsync = async (fastify) => {
  const mfaService = fastify.container!.resolve<MfaService>(TOKENS.MfaService);
  const auditService = fastify.container!.resolve<AuditService>(TOKENS.AuditService);
  const handler = new MfaRouteHandler(mfaService, auditService);

  // ✅ Get MFA status for current customer user
  fastify.get(
    "/auth/mfa/status",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["MFA"], summary: "Get MFA status for current user" },
    },
    async (request, reply) => handler.getMfaStatus(request, reply)
  );

  // ✅ Setup MFA for current customer user
  fastify.post(
    "/auth/mfa/setup",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["MFA"], summary: "Setup MFA for current user" },
    },
    async (request, reply) => handler.setupMfa(request, reply)
  );

  // ✅ Verify MFA setup
  fastify.post(
    "/auth/mfa/verify-setup",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["MFA"], summary: "Verify MFA setup" },
    },
    async (request, reply) => handler.verifyMfaSetup(request, reply)
  );

  // ✅ Verify MFA token (used during login flow — no auth required)
  fastify.post(
    "/auth/mfa/verify",
    { schema: { tags: ["MFA"], summary: "Verify MFA token during login" } },
    async (request, reply) => handler.verifyMfaToken(request, reply)
  );

  // ✅ Disable MFA for current customer user
  fastify.post(
    "/auth/mfa/disable",
    { preHandler: [requireClientAuth], schema: { tags: ["MFA"], summary: "Disable MFA" } },
    async (request, reply) => handler.disableMfa(request, reply)
  );

  // ✅ Regenerate backup codes for current customer user
  fastify.post(
    "/auth/mfa/regenerate-backup-codes",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["MFA"], summary: "Regenerate backup codes" },
    },
    async (request, reply) => handler.regenerateBackupCodes(request, reply)
  );

  // ✅ Admin: Get MFA status for any user
  fastify.get(
    "/admin/users/:userId/mfa/status",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.USER_MANAGE)],
      schema: { tags: ["MFA"], summary: "Admin: Get MFA status for a user" },
    },
    async (request, reply) => handler.getAdminMfaStatus(request, reply)
  );

  // ✅ Admin: Force disable MFA for a user (emergency use)
  fastify.post(
    "/admin/users/:userId/mfa/force-disable",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.USER_MANAGE)],
      schema: { tags: ["MFA"], summary: "Admin: Force disable MFA for a user" },
    },
    async (request, reply) => handler.adminForceDisableMfa(request, reply)
  );
};

export { mfaRoutes };
