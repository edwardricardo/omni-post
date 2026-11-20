/**
 * @file adminAuthRoutes.ts
 * @description Fastify routes for admin authentication API following BaseRouteHandler pattern.
 *              Provides endpoints for login, logout, token refresh, MFA, and session management.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { BaseRouteHandler, type RouteContext } from "../../lib/route-handler/index.js";
import type { AdminAuthService } from "./AdminAuthService.js";
import type { PlatformCredentialService } from "@core/security/PlatformCredentialService.js";
import { requireAdminAuth, rateLimit } from "./adminAuthMiddleware.js";
import { requirePermission } from "../../auth/rbacMiddleware.js";
import { Permission } from "@core/domain/auth/Permission.js";
import { TOKENS } from "../../infrastructure/container/types.js";
import type { EmailPort } from "@core/domain/repositories/EmailPort.js";
import { passwordResetEmail } from "../../infrastructure/email/templates/emailTemplates.js";
import {
  loginSchema,
  refreshTokenSchema,
  logoutSchema,
  changePasswordSchema,
  requiredPasswordChangeSchema,
  resetPasswordRequestSchema,
  resetPasswordConfirmSchema,
  mfaVerifySchema,
  mfaDisableSchema,
  revokeSessionSchema,
  validatePasswordSchema,
} from "./adminAuthSchemas.js";
import type { AuthErrorCode, DeviceFingerprint } from "./adminAuthTypes.js";
import { env } from "../../config/env.js";
import { normalizeEmail } from "@core/domain/value-objects/EmailAddress.js";

/**
 * The sign-in's route pattern, which also names the rate-limit bucket that every route running the
 * sign-in's checks spends, the sign-in included, whatever prefix the routes are registered under.
 */
const SIGN_IN_ROUTE = "/admin/auth/login";

/** The statuses of the sign-in's checks, which every route that runs them answers alike. */
const SIGN_IN_CHECK_STATUS: Partial<Record<AuthErrorCode, number>> = {
  INVALID_CREDENTIALS: 401,
  ACCOUNT_LOCKED: 403,
  ACCOUNT_INACTIVE: 403,
  MFA_INVALID: 401,
};

/**
 * The sign-in answers its checks' codes, and a password that must be changed with 403: the
 * credentials verified and the server refuses to open a session. Any other code is a 500.
 */
const SIGN_IN_STATUS: Partial<Record<AuthErrorCode, number>> = {
  ...SIGN_IN_CHECK_STATUS,
  PASSWORD_CHANGE_REQUIRED: 403,
};

/**
 * The required password change runs the sign-in's checks, so it answers their codes alike, and
 * adds two of its own: a missing second factor is an error here, since nothing changed, and the
 * brute-force gate's refusal is a 429.
 */
const REQUIRED_PASSWORD_CHANGE_STATUS: Partial<Record<AuthErrorCode, number>> = {
  ...SIGN_IN_CHECK_STATUS,
  MFA_REQUIRED: 401,
  RATE_LIMIT_EXCEEDED: 429,
  PASSWORD_CHANGE_NOT_REQUIRED: 409,
  PASSWORD_TOO_WEAK: 400,
  PASSWORD_REUSED: 400,
  CONCURRENT_MODIFICATION: 409,
};

// ============================================================================
// Route Handler Class
// ============================================================================

class AdminAuthRouteHandler extends BaseRouteHandler {
  protected routeName = "admin-auth";

  constructor(
    private readonly adminAuthService: AdminAuthService,
    private readonly credentialService: PlatformCredentialService,
    private readonly emailPort: EmailPort
  ) {
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
   * @method login
   * @description POST /admin/auth/login. Signs an administrator in with the e-mail and the
   *   password; a missing second factor is answered as a success that asks for it, and a password
   *   that must be changed with 403 and no session.
   * @param request - The request, whose body carries the credentials
   * @param reply - The reply the outcome is sent on
   */
  async login(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = loginSchema.safeParse(request.body);

    if (!validation.success) {
      return this.sendValidationError(ctx, validation.error);
    }

    const device = this.getDeviceFingerprint(request);
    const result = await this.adminAuthService.login(
      validation.data as import("./adminAuthTypes.js").LoginRequest,
      device
    );

    if (!result.ok) {
      // MFA_REQUIRED is a negotiation step, not an authentication failure
      // — the credentials were valid, the second factor is just missing.
      // Returning success-shape (`{ ok: true, data: { requiresMfa: true } }`)
      // matches the frontend `authenticateAdmin` contract (it checks
      // `data.data?.requiresMfa`); returning error-shape would route the
      // flow into the generic error path and break MFA login entirely.
      // Ref: F.7 Auth audit, finding #4.
      if (result.error === "MFA_REQUIRED") {
        return this.sendSuccess(ctx, { requiresMfa: true });
      }
      const status = SIGN_IN_STATUS[result.error] || 500;
      return this.sendError(ctx, status, result.error);
    }

    return this.sendSuccess(ctx, result.value);
  }

  /**
   * @method changeRequiredPassword
   * @description POST /admin/auth/password/change-required. Replaces a password that must be
   *   changed, for a caller without a session: the e-mail, the current password and the new one
   *   go through the sign-in's checks, and no session is opened, so the administrator then signs
   *   in with the new password. Every refusal, a missing second factor included, is an error.
   * @param request - The request, whose body carries the credentials and the new password
   * @param reply - The reply the outcome is sent on
   */
  async changeRequiredPassword(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = requiredPasswordChangeSchema.safeParse(request.body);

    if (!validation.success) {
      return this.sendValidationError(ctx, validation.error);
    }

    const { email, currentPassword, newPassword, mfaToken } = validation.data;
    const result = await this.adminAuthService.changeRequiredPassword(
      { email, currentPassword, newPassword, ...(mfaToken !== undefined && { mfaToken }) },
      this.getDeviceFingerprint(request)
    );

    if (!result.ok) {
      const status = REQUIRED_PASSWORD_CHANGE_STATUS[result.error] || 500;
      return this.sendError(ctx, status, result.error);
    }

    return this.sendSuccess(ctx, { message: "Password changed. Sign in with the new password." });
  }

  /**
   * @method refreshToken
   * @description POST /admin/auth/refresh. Issues a new access token for the session the refresh
   *   token and the CSRF token name.
   * @param request - The request, whose body carries the refresh token and the CSRF token
   * @param reply - The reply the outcome is sent on
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
   * @method logout
   * @description POST /admin/auth/logout. Revokes the current session, or every session when
   *   the body asks for it.
   * @param request - The authenticated request
   * @param reply - The reply the outcome is sent on
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
   * @method getCurrentUser
   * @description GET /admin/auth/me. Answers the signed-in administrator's profile.
   * @param request - The authenticated request
   * @param reply - The reply the profile is sent on
   */
  async getCurrentUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    if (!request.auth) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    return this.sendSuccess(ctx, { user: request.auth.user });
  }

  /**
   * @method changePassword
   * @description POST /admin/auth/password/change. Changes the signed-in administrator's
   *   password, given the current one.
   * @param request - The authenticated request, whose body carries both passwords
   * @param reply - The reply the outcome is sent on
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
   * @method resetPasswordRequest
   * @description POST /admin/auth/password/reset. Starts the forgotten-password flow and e-mails
   *   the reset link; the answer is the same whether or not the address exists.
   * @param request - The request, whose body carries the e-mail
   * @param reply - The reply the outcome is sent on
   */
  async resetPasswordRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = resetPasswordRequestSchema.safeParse(request.body);

    if (!validation.success) {
      return this.sendValidationError(ctx, validation.error);
    }

    const { email } = validation.data;
    const result = await this.adminAuthService.initiatePasswordReset(email);

    // Always return success to prevent email enumeration. The service
    // returns a placeholder token when the email is unknown — guard against
    // sending email in that case so we don't accidentally leak existence.
    if (!result.ok) {
      this.logError(ctx, "Password reset initiation failed", { error: result.error });
    } else if (result.value !== "reset_token_placeholder") {
      // Real reset token issued — fire the email. Same wire-up as the
      // admin-initiated reset flow in adminUserRoutes.ts (single source of
      // truth: passwordResetEmail template + EmailPort + adminUrl from
      // PlatformCredentialService). Ref: F.7 Auth audit, finding #5.
      const resetToken = result.value;
      const userRow = await this.adminAuthService.findAdminContactByEmail(normalizeEmail(email));

      if (userRow) {
        const adminUrlResult = await this.credentialService.getCredential("PLATFORM", "adminUrl");
        const adminUrl = (adminUrlResult.ok && adminUrlResult.value) || "http://localhost:3100";
        const resetUrl = `${adminUrl}/reset-password?token=${resetToken}`;

        try {
          const emailContent = await passwordResetEmail({
            userName: userRow.name,
            resetUrl,
          });
          const emailResult = await this.emailPort.send({
            to: [userRow.email],
            subject: emailContent.subject,
            body: `Password reset requested. Visit: ${resetUrl}`,
            html: emailContent.html,
          });
          if (!emailResult.ok) {
            this.logError(ctx, "Password reset email delivery failed", {
              err: emailResult.error,
            });
          }
        } catch (err) {
          this.logError(ctx, "Password reset email render/send failed", {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return this.sendSuccess(ctx, {
      message: "If the email exists, a password reset link has been sent.",
    });
  }

  /**
   * @method resetPasswordConfirm
   * @description POST /admin/auth/password/reset/confirm. Completes a password reset with the
   *   reset token, after the Turnstile challenge when one is configured.
   * @param request - The request, whose body carries the token and the new password
   * @param reply - The reply the outcome is sent on
   */
  async resetPasswordConfirm(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = resetPasswordConfirmSchema.safeParse(request.body);

    if (!validation.success) {
      return this.sendValidationError(ctx, validation.error);
    }

    const { token, newPassword, turnstileToken } = validation.data;

    // Verify Turnstile if configured (reads secret key from platform credentials)
    const turnstileResult = await this.credentialService.getCredential(
      "PLATFORM",
      "turnstileSecretKey"
    );
    const turnstileSecret = turnstileResult.ok ? turnstileResult.value : null;
    if (turnstileSecret) {
      if (!turnstileToken) {
        return this.sendError(ctx, 403, "Security verification required");
      }
      try {
        const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ secret: turnstileSecret, response: turnstileToken }),
          // Cloudflare Turnstile docs: typical response < 1s. 5s timeout for safety.
          signal: AbortSignal.timeout(5_000),
        });
        const verifyData = (await verifyRes.json()) as { success: boolean };
        if (!verifyData.success) {
          return this.sendError(ctx, 403, "Security verification failed");
        }
      } catch {
        this.logError(ctx, "Turnstile verification request failed");
        return this.sendError(ctx, 500, "Security verification unavailable");
      }
    }

    const result = await this.adminAuthService.confirmPasswordReset(token, newPassword);

    if (!result.ok) {
      const statusMap: Partial<Record<AuthErrorCode, number>> = {
        INVALID_TOKEN: 400,
        PASSWORD_TOO_WEAK: 400,
        PASSWORD_REUSED: 400,
        CONCURRENT_MODIFICATION: 409,
      };
      const status = statusMap[result.error] || 500;
      return this.sendError(ctx, status, result.error);
    }

    return this.sendSuccess(ctx, { message: "Password reset successfully" });
  }

  /**
   * @method validatePassword
   * @description POST /admin/auth/password/validate. Scores a password against the policy.
   * @param request - The request, whose body carries the password
   * @param reply - The reply the score is sent on
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
   * @method mfaSetup
   * @description POST /admin/auth/mfa/setup. Starts the second factor's enrolment.
   * @param request - The authenticated request
   * @param reply - The reply the secret, QR code and backup codes are sent on
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
   * @method mfaVerify
   * @description POST /admin/auth/mfa/verify. Enables the second factor once a code verifies.
   * @param request - The authenticated request, whose body carries the code
   * @param reply - The reply the outcome is sent on
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
   * @method mfaDisable
   * @description POST /admin/auth/mfa/disable. Disables the second factor, given the password
   *   and a code.
   * @param request - The authenticated request, whose body carries the password and the code
   * @param reply - The reply the outcome is sent on
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
   * @method mfaStatus
   * @description GET /admin/auth/mfa/status. Answers whether the second factor is enabled and
   *   how many backup codes remain.
   * @param request - The authenticated request
   * @param reply - The reply the status is sent on
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
   * @method listSessions
   * @description GET /admin/auth/sessions. Lists the active sessions, marking the current one.
   * @param request - The authenticated request
   * @param reply - The reply the sessions are sent on
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
   * @method revokeSession
   * @description POST /admin/auth/sessions/revoke. Revokes one session of the signed-in
   *   administrator.
   * @param request - The authenticated request, whose body names the session
   * @param reply - The reply the outcome is sent on
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
  const credSvc = container.resolve<PlatformCredentialService>(TOKENS.PlatformCredentialService);
  const emailPort = container.resolve<EmailPort>(TOKENS.EmailPort);
  const handler = new AdminAuthRouteHandler(adminAuthSvc, credSvc, emailPort);

  // ==========================================================================
  // Public Endpoints (No Authentication Required)
  // ==========================================================================

  // Login (with rate limiting — account lockout after 5 failed attempts provides primary brute-force protection)
  const loginRateMax = env.NODE_ENV === "test" ? 100 : 15;
  fastify.post(
    SIGN_IN_ROUTE,
    {
      preHandler: [rateLimit(loginRateMax, 60000, SIGN_IN_ROUTE)], // 15 req/min production, 100 in test
      schema: { tags: ["Admin Auth"], summary: "Admin login" },
    },
    async (request, reply) => handler.login(request, reply)
  );

  // Required password change: it runs the sign-in's checks without a session, so it spends the
  // sign-in's bucket, and an address gets one allowance for guessing passwords, not two.
  // The body is declared so the published contract types it. A body the schema refuses is
  // attached to the request rather than answered: the handler parses it again and answers in its
  // own shape, the one the portal reads, and the rate limit is still spent on it.
  fastify.post(
    "/admin/auth/password/change-required",
    {
      preHandler: [rateLimit(loginRateMax, 60000, SIGN_IN_ROUTE)],
      attachValidation: true,
      schema: {
        tags: ["Admin Auth"],
        summary: "Change a password that must be changed",
        body: requiredPasswordChangeSchema,
      },
    },
    async (request, reply) => handler.changeRequiredPassword(request, reply)
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

  // Password reset confirmation (rate limited: 5 attempts per 15 min)
  fastify.post(
    "/admin/auth/password/reset/confirm",
    {
      preHandler: [rateLimit(5, 900000)],
      schema: { tags: ["Admin Auth"], summary: "Confirm password reset" },
    },
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

  // Profile update (own profile: timezone, locale, avatarUrl)
  fastify.put(
    "/admin/auth/profile",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Admin Auth"], summary: "Update own profile" },
    },
    async (request, reply) => {
      const userId = request.auth!.user.id;
      const body = request.body as Record<string, unknown>;
      const data: { timezone?: string; locale?: string; avatarUrl?: string } = {};
      if (typeof body.timezone === "string") data.timezone = body.timezone;
      if (typeof body.locale === "string") data.locale = body.locale;
      if (typeof body.avatarUrl === "string") data.avatarUrl = body.avatarUrl;

      if (Object.keys(data).length === 0) {
        return reply.code(400).send({ ok: false, error: "No valid fields to update" });
      }

      const result = await adminAuthSvc.updateProfile(userId, data);
      return reply.send({ ok: true, data: result });
    }
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
