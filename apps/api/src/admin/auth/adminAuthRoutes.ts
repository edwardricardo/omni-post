/**
 * Admin Authentication Routes
 *
 * Fastify routes for admin authentication API following BaseRouteHandler pattern.
 * Provides endpoints for login, logout, token refresh, MFA, session management, etc.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import type { AdminAuthService } from "./AdminAuthService.js";
import { requireAdminAuth, rateLimit } from "./adminAuthMiddleware";
import { requirePermission } from "../../auth/rbacMiddleware.js";
import { Permission } from "../../auth/rbacService.js";
import { TOKENS } from "../../infrastructure/container/types.js";
import {
  loginSchema,
  refreshTokenSchema,
  logoutSchema,
  changePasswordSchema,
  resetPasswordRequestSchema,
  resetPasswordConfirmSchema,
  mfaSetupSchema,
  mfaVerifySchema,
  mfaDisableSchema,
  revokeSessionSchema,
  validatePasswordSchema,
} from "./adminAuthSchemas";
import type { DeviceFingerprint } from "./adminAuthTypes";

// ============================================================================
// Route Handler Class
// ============================================================================

class AdminAuthRouteHandler extends BaseRouteHandler {
  protected routeName = "admin-auth";

  constructor(private readonly adminAuthService: AdminAuthService) {
    super();
  }

  /**
   * Helper: Send validation error response
   */
  private sendValidationError(ctx: RouteContext, error: ZodError): void {
    this.sendError(ctx, 400, "Validation failed", {
      issues: error.issues.map((e) => ({
        path: e.path.join("."),
        message: e.message,
      })),
    });
  }

  /**
   * Helper: Extract device fingerprint from request
   */
  private getDeviceFingerprint(request: FastifyRequest): DeviceFingerprint {
    const body = request.body as { deviceId?: string; deviceName?: string };
    const fingerprint: DeviceFingerprint = {
      deviceId: body.deviceId || "",
      userAgent: request.headers["user-agent"] || "",
      ipAddress: request.ip,
    };

    if (body.deviceName) {
      fingerprint.deviceName = body.deviceName;
    }

    return fingerprint;
  }

  /**
   * POST /admin/auth/login
   * Login with email and password
   */
  async login(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = loginSchema.safeParse(request.body);

    if (!validation.success) {
      return this.sendValidationError(ctx, validation.error);
    }

    const device = this.getDeviceFingerprint(request);
    const result = await this.adminAuthService.login(
      validation.data as import("./adminAuthTypes").LoginRequest,
      device
    );

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        INVALID_CREDENTIALS: 401,
        ACCOUNT_LOCKED: 403,
        ACCOUNT_INACTIVE: 403,
        MFA_REQUIRED: 200,
        MFA_INVALID: 401,
      };
      const status = statusMap[result.error] || 500;
      return this.sendError(ctx, status, result.error);
    }

    return this.sendSuccess(ctx, result.value);
  }

  /**
   * POST /admin/auth/refresh
   * Refresh access token using refresh token
   */
  async refreshToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = refreshTokenSchema.safeParse(request.body);

    if (!validation.success) {
      return this.sendValidationError(ctx, validation.error);
    }

    const result = await this.adminAuthService.refreshToken(validation.data);

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        SESSION_EXPIRED: 401,
        INVALID_TOKEN: 401,
        TOKEN_EXPIRED: 401,
        CSRF_TOKEN_MISMATCH: 403,
      };
      const status = statusMap[result.error] || 500;
      return this.sendError(ctx, status, result.error);
    }

    return this.sendSuccess(ctx, result.value);
  }

  /**
   * POST /admin/auth/logout
   * Logout (revoke session)
   */
  async logout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    if (!request.auth) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validation = logoutSchema.safeParse(request.body);

    if (!validation.success) {
      return this.sendValidationError(ctx, validation.error);
    }

    const { allSessions } = validation.data;
    const result = await this.adminAuthService.logout(
      request.auth.user.id,
      request.auth.sessionId,
      allSessions
    );

    if (!result.ok) {
      return this.sendError(ctx, 500, result.error);
    }

    return this.sendSuccess(ctx, { message: "Logged out successfully" });
  }

  /**
   * GET /admin/auth/me
   * Get current authenticated user profile
   */
  async getCurrentUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    if (!request.auth) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    return this.sendSuccess(ctx, { user: request.auth.user });
  }

  /**
   * POST /admin/auth/password/change
   * Change password for authenticated user
   */
  async changePassword(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    if (!request.auth) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validation = changePasswordSchema.safeParse(request.body);

    if (!validation.success) {
      return this.sendValidationError(ctx, validation.error);
    }

    const { currentPassword, newPassword } = validation.data;
    const result = await this.adminAuthService.changePassword(
      request.auth.user.id,
      currentPassword,
      newPassword
    );

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        INVALID_CREDENTIALS: 401,
        PASSWORD_TOO_WEAK: 400,
        PASSWORD_REUSED: 400,
        USER_NOT_FOUND: 404,
      };
      const status = statusMap[result.error] || 500;
      return this.sendError(ctx, status, result.error);
    }

    return this.sendSuccess(ctx, { message: "Password changed successfully" });
  }

  /**
   * POST /admin/auth/password/reset
   * Request password reset (forgot password flow)
   */
  async resetPasswordRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = resetPasswordRequestSchema.safeParse(request.body);

    if (!validation.success) {
      return this.sendValidationError(ctx, validation.error);
    }

    const { email } = validation.data;
    const result = await this.adminAuthService.initiatePasswordReset(email);

    // Always return success to prevent email enumeration
    // The service handles the logic internally
    if (!result.ok) {
      // Log error but still return success message
      this.logError(ctx, "Password reset initiation failed", { error: result.error });
    }

    // Future: integrate email service to send reset link with token
    return this.sendSuccess(ctx, {
      message: "If the email exists, a password reset link has been sent.",
    });
  }

  /**
   * POST /admin/auth/password/reset/confirm
   * Confirm password reset with token
   */
  async resetPasswordConfirm(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = resetPasswordConfirmSchema.safeParse(request.body);

    if (!validation.success) {
      return this.sendValidationError(ctx, validation.error);
    }

    const { token, newPassword } = validation.data;
    const result = await this.adminAuthService.confirmPasswordReset(token, newPassword);

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        INVALID_TOKEN: 400,
        PASSWORD_TOO_WEAK: 400,
        PASSWORD_REUSED: 400,
      };
      const status = statusMap[result.error] || 500;
      return this.sendError(ctx, status, result.error);
    }

    return this.sendSuccess(ctx, { message: "Password reset successfully" });
  }

  /**
   * POST /admin/auth/password/validate
   * Validate password strength
   */
  async validatePassword(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = validatePasswordSchema.safeParse(request.body);

    if (!validation.success) {
      return this.sendValidationError(ctx, validation.error);
    }

    const result = this.adminAuthService.validatePassword(validation.data.password);
    return this.sendSuccess(ctx, result);
  }

  // ==========================================================================
  // MFA Endpoints
  // ==========================================================================

  /**
   * POST /admin/auth/mfa/setup
   * Setup MFA (generate QR code and backup codes)
   */
  async mfaSetup(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    if (!request.auth) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.adminAuthService.setupMfa(request.auth.user.id);

    if (!result.ok) {
      return this.sendError(ctx, 400, result.error);
    }

    return this.sendSuccess(ctx, result.value);
  }

  /**
   * POST /admin/auth/mfa/verify
   * Verify MFA token and enable MFA
   */
  async mfaVerify(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    if (!request.auth) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validation = mfaVerifySchema.safeParse(request.body);

    if (!validation.success) {
      return this.sendValidationError(ctx, validation.error);
    }

    const result = await this.adminAuthService.verifyAndEnableMfa(
      request.auth.user.id,
      validation.data.token
    );

    if (!result.ok) {
      return this.sendError(ctx, 400, result.error);
    }

    return this.sendSuccess(ctx, { message: "MFA enabled successfully" });
  }

  /**
   * POST /admin/auth/mfa/disable
   * Disable MFA
   */
  async mfaDisable(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    if (!request.auth) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validation = mfaDisableSchema.safeParse(request.body);

    if (!validation.success) {
      return this.sendValidationError(ctx, validation.error);
    }

    const { password, mfaToken } = validation.data;
    const result = await this.adminAuthService.disableMfa(request.auth.user.id, password, mfaToken);

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        INVALID_CREDENTIALS: 401,
        MFA_INVALID: 400,
        INVALID_REQUEST: 400,
        USER_NOT_FOUND: 404,
      };
      const status = statusMap[result.error] || 500;
      return this.sendError(ctx, status, result.error);
    }

    return this.sendSuccess(ctx, { message: "MFA disabled successfully" });
  }

  /**
   * GET /admin/auth/mfa/status
   * Get MFA status
   */
  async mfaStatus(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    if (!request.auth) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.adminAuthService.getMfaStatus(request.auth.user.id);

    if (!result.ok) {
      return this.sendError(ctx, 500, result.error);
    }

    return this.sendSuccess(ctx, result.value);
  }

  // ==========================================================================
  // Session Management Endpoints
  // ==========================================================================

  /**
   * GET /admin/auth/sessions
   * List active sessions
   */
  async listSessions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    if (!request.auth) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.adminAuthService.listSessions(request.auth.user.id);

    if (!result.ok) {
      return this.sendError(ctx, 500, result.error);
    }

    // Mark current session
    const sessions = result.value.map((session) => ({
      ...session,
      isCurrentSession: session.id === request.auth?.sessionId,
    }));

    return this.sendSuccess(ctx, { sessions });
  }

  /**
   * POST /admin/auth/sessions/revoke
   * Revoke specific session
   */
  async revokeSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    if (!request.auth) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const validation = revokeSessionSchema.safeParse(request.body);

    if (!validation.success) {
      return this.sendValidationError(ctx, validation.error);
    }

    const { sessionId, reason } = validation.data;
    const result = await this.adminAuthService.revokeSession(
      request.auth.user.id,
      sessionId,
      reason
    );

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        INVALID_REQUEST: 400,
      };
      const status = statusMap[result.error] || 500;
      return this.sendError(ctx, status, result.error);
    }

    return this.sendSuccess(ctx, { message: "Session revoked successfully" });
  }
}

// ============================================================================
// Fastify Plugin
// ============================================================================

const adminAuthRoutes: FastifyPluginAsync = async (fastify) => {
  const container = fastify.container;
  if (!container) {
    throw new Error("DI container not available");
  }
  const adminAuthSvc = container.resolve<AdminAuthService>(TOKENS.AdminAuthService);
  const handler = new AdminAuthRouteHandler(adminAuthSvc);

  // ==========================================================================
  // Public Endpoints (No Authentication Required)
  // ==========================================================================

  // Login (with rate limiting — account lockout after 5 failed attempts provides primary brute-force protection)
  const loginRateMax = process.env.NODE_ENV === "test" ? 100 : 15;
  fastify.post(
    "/admin/auth/login",
    {
      preHandler: [rateLimit(loginRateMax, 60000)], // 15 req/min production, 100 in test
      schema: { tags: ["Admin Auth"], summary: "Admin login" },
    },
    async (request, reply) => handler.login(request, reply)
  );

  // Refresh token
  fastify.post(
    "/admin/auth/refresh",
    { schema: { tags: ["Admin Auth"], summary: "Refresh access token" } },
    async (request, reply) => handler.refreshToken(request, reply)
  );

  // Password reset request (with rate limiting)
  fastify.post(
    "/admin/auth/password/reset",
    {
      preHandler: [rateLimit(3, 300000)], // 3 requests per 5 minutes
      schema: { tags: ["Admin Auth"], summary: "Request password reset" },
    },
    async (request, reply) => handler.resetPasswordRequest(request, reply)
  );

  // Password reset confirmation
  fastify.post(
    "/admin/auth/password/reset/confirm",
    { schema: { tags: ["Admin Auth"], summary: "Confirm password reset" } },
    async (request, reply) => handler.resetPasswordConfirm(request, reply)
  );

  // Password strength validation (public helper)
  fastify.post(
    "/admin/auth/password/validate",
    { schema: { tags: ["Admin Auth"], summary: "Validate password strength" } },
    async (request, reply) => handler.validatePassword(request, reply)
  );

  // ==========================================================================
  // Protected Endpoints (Authentication Required)
  // ==========================================================================

  // Get current user
  fastify.get(
    "/admin/auth/me",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Admin Auth"], summary: "Get current admin user" },
    },
    async (request, reply) => handler.getCurrentUser(request, reply)
  );

  // Logout
  fastify.post(
    "/admin/auth/logout",
    { preHandler: [requireAdminAuth], schema: { tags: ["Admin Auth"], summary: "Admin logout" } },
    async (request, reply) => handler.logout(request, reply)
  );

  // Change password
  fastify.post(
    "/admin/auth/password/change",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Admin Auth"], summary: "Change admin password" },
    },
    async (request, reply) => handler.changePassword(request, reply)
  );

  // ==========================================================================
  // MFA Endpoints (Authentication Required)
  // ==========================================================================

  // Setup MFA
  fastify.post(
    "/admin/auth/mfa/setup",
    { preHandler: [requireAdminAuth], schema: { tags: ["Admin Auth"], summary: "Setup MFA" } },
    async (request, reply) => handler.mfaSetup(request, reply)
  );

  // Verify and enable MFA
  fastify.post(
    "/admin/auth/mfa/verify",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Admin Auth"], summary: "Verify and enable MFA" },
    },
    async (request, reply) => handler.mfaVerify(request, reply)
  );

  // Disable MFA
  fastify.post(
    "/admin/auth/mfa/disable",
    { preHandler: [requireAdminAuth], schema: { tags: ["Admin Auth"], summary: "Disable MFA" } },
    async (request, reply) => handler.mfaDisable(request, reply)
  );

  // Get MFA status
  fastify.get(
    "/admin/auth/mfa/status",
    { preHandler: [requireAdminAuth], schema: { tags: ["Admin Auth"], summary: "Get MFA status" } },
    async (request, reply) => handler.mfaStatus(request, reply)
  );

  // ==========================================================================
  // Session Management Endpoints (Authentication Required)
  // ==========================================================================

  // List active sessions
  fastify.get(
    "/admin/auth/sessions",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Admin Auth"], summary: "List active sessions" },
    },
    async (request, reply) => handler.listSessions(request, reply)
  );

  // Revoke session
  fastify.post(
    "/admin/auth/sessions/revoke",
    { preHandler: [requireAdminAuth], schema: { tags: ["Admin Auth"], summary: "Revoke session" } },
    async (request, reply) => handler.revokeSession(request, reply)
  );

  // Revoke all sessions except current (super admin only)
  fastify.post(
    "/admin/auth/sessions/revoke-all",
    {
      preHandler: [requireAdminAuth, requirePermission(Permission.SYSTEM_CONFIGURE)],
      schema: { tags: ["Admin Auth"], summary: "Revoke all sessions" },
    },
    async (request, reply) => handler.revokeSession(request, reply)
  );
};

export { adminAuthRoutes };
