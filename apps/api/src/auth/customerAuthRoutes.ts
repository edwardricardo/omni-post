/**
 * @file customerAuthRoutes.ts
 * @description Fastify plugin registering customer-facing authentication routes.
 *   Completely separate from admin auth — different JWT secrets, different middleware.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { TOKENS } from "../infrastructure/container/types.js";
import { requireClientAuth } from "./customerAuthMiddleware.js";
import { withSystemContext } from "../security/tenantContext.js";
import {
  CUSTOMER_REGISTER_SYSTEM_REASON,
  CUSTOMER_REFRESH_SYSTEM_REASON,
  CUSTOMER_REQUEST_PASSWORD_RESET_SYSTEM_REASON,
  CUSTOMER_RESET_PASSWORD_SYSTEM_REASON,
} from "./customerAuthSystemReasons.js";
import { resolveClientIp } from "../security/resolveClientIp.js";
import { authLogger } from "../lib/logger.js";
import type {
  RegisterCustomerUseCase,
  LoginCustomerUseCase,
  CompleteCustomerMfaLoginUseCase,
  CompleteCustomerMfaLoginError,
  RefreshCustomerTokenUseCase,
  LogoutCustomerUseCase,
  RequestPasswordResetUseCase,
  ResetPasswordUseCase,
} from "@core/customer-auth/index.js";

// ---- Zod schemas ----

const RegisterSchema = z.object({
  accountName: z.string().min(1).max(100),
  accountEmail: z.string().email().optional(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  plan: z.enum(["BASIC", "PRO", "ENTERPRISE"]).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  accountSlug: z.string().min(3).max(30).optional(),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const RequestPasswordResetSchema = z.object({
  email: z.string().email(),
});

const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

const MfaLoginSchema = z.object({
  challengeToken: z.string().min(1).max(2048),
  // TOTP (6 digits) or backup code (8 hex chars) — mirrors the flexible token
  // schema on the self-service MFA routes.
  code: z.string().min(6).max(8),
  // Consumed by the Next proxy/action cookie layer; the API ignores it.
  rememberMe: z.boolean().optional(),
});

/**
 * @class CustomerAuthRouteHandler
 * @description Handles all customer authentication route logic.
 */
class CustomerAuthRouteHandler extends BaseRouteHandler {
  protected routeName = "customer-auth";

  constructor(
    private registerUseCase: RegisterCustomerUseCase,
    private loginUseCase: LoginCustomerUseCase,
    private completeMfaUseCase: CompleteCustomerMfaLoginUseCase,
    private refreshUseCase: RefreshCustomerTokenUseCase,
    private logoutUseCase: LogoutCustomerUseCase,
    private requestResetUseCase: RequestPasswordResetUseCase,
    private resetPasswordUseCase: ResetPasswordUseCase
  ) {
    super();
  }

  /**
   * @method resolveIp
   * @description Derive the trusted client IP through the canonical
   *   `resolveClientIp` resolver (configured trusted-proxy model, normalization,
   *   fail-closed to the socket peer). Used for MFA challenge IP-binding and the
   *   brute-force forensic IP on both login steps. The policy argument is left
   *   to the resolver's default so this route cannot drift from the deployment's
   *   configured model.
   */
  private resolveIp(request: FastifyRequest): string {
    return resolveClientIp(request);
  }

  /**
   * @method register
   * @description POST /auth/customer/register - Creates account + user, returns tokens.
   */
  async register(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validationResult = await this.validateRequest(ctx, {
      body: RegisterSchema,
    });
    if (!validationResult.ok) {
      return this.sendError(ctx, 400, "Invalid input data");
    }

    const { body } = validationResult.value as {
      body: z.infer<typeof RegisterSchema>;
    };

    // Register is pre-identity in the strongest sense: the account it will create
    // does not exist yet, and the duplicate-address check that precedes it spans
    // EVERY account. Neither operation can be scoped to a tenant, so the whole
    // handler runs under the declared system context. The extent is the whole
    // handler because every enrolled-model reach in this flow is part of creating
    // the tenant; nothing here reads another tenant's data by a caller-supplied id.
    const result = await withSystemContext(CUSTOMER_REGISTER_SYSTEM_REASON, () =>
      this.registerUseCase.execute({
        accountName: body.accountName,
        accountEmail: body.accountEmail ?? body.email,
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        password: body.password,
        ...(body.plan !== undefined && { plan: body.plan }),
      })
    );

    if (!result.ok) {
      const errorMap = {
        EMAIL_EXISTS: { code: 409, message: "Email already exists" },
        VALIDATION_ERROR: { code: 400, message: "Invalid input data" },
        INTERNAL_ERROR: { code: 500, message: "Internal server error" },
      };
      const mapped = errorMap[result.error];
      return this.sendError(ctx, mapped.code, mapped.message);
    }

    return this.sendSuccess(ctx, result.value, 201);
  }

  /**
   * @method login
   * @description POST /auth/customer/login - Authenticates and returns tokens.
   */
  async login(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validationResult = await this.validateRequest(ctx, {
      body: LoginSchema,
    });
    if (!validationResult.ok) {
      return this.sendError(ctx, 400, "Invalid input data");
    }

    const { body } = validationResult.value as {
      body: z.infer<typeof LoginSchema>;
    };

    // Login is legitimately pre-identity: the request has no JWT yet, so no
    // `TenantContext` is bound. The use case resolves the user across all
    // accounts (`findByEmailAcrossAccounts`) and then operates on the
    // resolved row. Run the whole flow under `withSystemContext()` so the
    // Prisma tenant guard (`tenantGuardExtension`) bypasses enforcement on
    // the cross-tenant lookup and audits the reason instead.
    const result = await withSystemContext("customer-login", () =>
      this.loginUseCase.execute({
        email: body.email,
        password: body.password,
        ...(body.accountSlug !== undefined && { accountSlug: body.accountSlug }),
        ip: this.resolveIp(request),
        userAgent: request.headers["user-agent"] ?? "",
      })
    );

    if (!result.ok) {
      if (result.error === "MFA_UNAVAILABLE") {
        // Fail-closed: the challenge store is down, so an MFA login cannot be
        // safely issued. Distinct from an auth verdict — surface as 503 with a
        // loud, alertable WARN (contrast the rate-limiter's fail-open).
        authLogger.warn(
          { threat_type: "mfa_challenge_store_unavailable", layer: "infrastructure" },
          "MFA challenge store unavailable at login — failing closed"
        );
        return this.sendError(
          ctx,
          503,
          "Unable to complete multi-factor login right now. Please try again."
        );
      }
      const errorMap = {
        INVALID_CREDENTIALS: { code: 401, message: "Invalid email or password" },
        USER_INACTIVE: { code: 403, message: "Account is inactive" },
        // Disclosed only after valid credentials (use-case ordering), so this
        // is actionable for the legitimate user without being an enumeration
        // oracle for outsiders.
        ACCOUNT_DEACTIVATED: { code: 403, message: "This account has been deactivated" },
        MULTIPLE_ACCOUNTS: {
          code: 409,
          message: "Multiple accounts found. Please provide accountSlug.",
        },
        RATE_LIMITED: {
          code: 429,
          message: "Too many login attempts. Please try again later.",
        },
        INTERNAL_ERROR: { code: 500, message: "Internal server error" },
      };
      const mapped = errorMap[result.error];
      return this.sendError(ctx, mapped.code, mapped.message);
    }

    // Success is EITHER a session (non-MFA) OR a challenge (`mfaRequired`).
    // The proxy passes a challenge body through untouched (no `accessToken`, no
    // cookies); a session body has its tokens stripped into httpOnly cookies.
    return this.sendSuccess(ctx, result.value, 200);
  }

  /**
   * @method completeMfaLogin
   * @description POST /auth/customer/login/mfa — customer login step 2. Verifies
   *   the challenge token + a TOTP or backup code and mints the session. Runs
   *   under `withSystemContext` (pre-identity, like login). The error contract is
   *   deliberately NOT the standard `sendError`: a wrong code MUST carry a
   *   top-level `code: "INVALID_MFA_CODE"` so the portal can keep the user on the
   *   challenge step (retry) instead of dropping them back to the password step.
   *   Every challenge-invalid sub-case (and binding mismatch) returns a
   *   BYTE-IDENTICAL 401 — no oracle.
   */
  async completeMfaLogin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validationResult = await this.validateRequest(ctx, {
      body: MfaLoginSchema,
    });
    if (!validationResult.ok) {
      return this.sendError(ctx, 400, "Invalid input data");
    }

    const { body } = validationResult.value as {
      body: z.infer<typeof MfaLoginSchema>;
    };

    const result = await withSystemContext("customer-mfa-login", () =>
      this.completeMfaUseCase.execute({
        challengeToken: body.challengeToken,
        code: body.code,
        ip: this.resolveIp(request),
        userAgent: request.headers["user-agent"] ?? "",
      })
    );

    if (!result.ok) {
      return this.sendMfaLoginError(ctx, result.error);
    }

    return this.sendSuccess(ctx, result.value, 200);
  }

  /**
   * @method sendMfaLoginError
   * @description Maps a step-2 use-case error to its HTTP response. Emits the
   *   binding-mismatch / store-outage WARNs, and — crucially — collapses every
   *   challenge-invalid sub-case AND the binding mismatch to a BYTE-IDENTICAL
   *   401 body (no oracle). The response carries a top-level `code` so the portal
   *   can discriminate retry (`INVALID_MFA_CODE`) from fallback.
   * @param ctx - The route context.
   * @param error - The step-2 use-case error code.
   */
  private sendMfaLoginError(ctx: RouteContext, error: CompleteCustomerMfaLoginError): void {
    if (error === "CHALLENGE_BINDING_MISMATCH") {
      authLogger.warn(
        { threat_type: "mfa_challenge_binding_mismatch", layer: "infrastructure" },
        "MFA challenge binding mismatch — rejecting"
      );
    } else if (error === "MFA_UNAVAILABLE") {
      authLogger.warn(
        { threat_type: "mfa_challenge_store_unavailable", layer: "infrastructure" },
        "MFA challenge store unavailable at step 2 — failing closed"
      );
    }

    // Byte-identical challenge-invalid body (expired / consumed / foreign /
    // binding mismatch all collapse here).
    const invalidChallenge = {
      status: 401,
      body: {
        ok: false,
        error: "MFA challenge is invalid or expired. Please sign in again.",
        code: "INVALID_CHALLENGE",
      },
    };

    const responseMap: Record<CompleteCustomerMfaLoginError, { status: number; body: object }> = {
      INVALID_CHALLENGE: invalidChallenge,
      CHALLENGE_BINDING_MISMATCH: invalidChallenge,
      INVALID_MFA_CODE: {
        status: 401,
        body: { ok: false, error: "Invalid MFA code.", code: "INVALID_MFA_CODE" },
      },
      USER_INACTIVE: {
        status: 403,
        body: { ok: false, error: "Account is inactive", code: "USER_INACTIVE" },
      },
      ACCOUNT_DEACTIVATED: {
        status: 403,
        body: {
          ok: false,
          error: "This account has been deactivated",
          code: "ACCOUNT_DEACTIVATED",
        },
      },
      RATE_LIMITED: {
        status: 429,
        body: {
          ok: false,
          error: "Too many attempts. Please try again later.",
          code: "RATE_LIMITED",
        },
      },
      MFA_UNAVAILABLE: {
        status: 503,
        body: {
          ok: false,
          error: "Unable to complete multi-factor login right now. Please try again.",
          code: "MFA_UNAVAILABLE",
        },
      },
      INTERNAL_ERROR: {
        status: 500,
        body: { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      },
    };

    const mapped = responseMap[error];
    ctx.reply.code(mapped.status).send(mapped.body);
  }

  /**
   * @method refresh
   * @description POST /auth/customer/refresh - Issues new token pair.
   */
  async refresh(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validationResult = await this.validateRequest(ctx, {
      body: RefreshSchema,
    });
    if (!validationResult.ok) {
      return this.sendError(ctx, 400, "Refresh token required");
    }

    const { body } = validationResult.value as {
      body: z.infer<typeof RefreshSchema>;
    };

    // Refresh is pre-identity: the request carries no access token, so no
    // `TenantContext` is bound, and the subject is named by the refresh token's
    // own signed claims. The extent is the whole handler because the single
    // enrolled-model reach in this flow (`findById` on the token's subject) is
    // keyed by a value the signature already authenticated — the lookup is
    // self-scoping, so re-entering a tenant context would only re-derive a scope
    // the token has already fixed.
    const result = await withSystemContext(CUSTOMER_REFRESH_SYSTEM_REASON, () =>
      this.refreshUseCase.execute({
        refreshToken: body.refreshToken,
      })
    );

    if (!result.ok) {
      const errorMap = {
        INVALID_TOKEN: { code: 401, message: "Invalid or expired refresh token" },
        USER_NOT_FOUND: { code: 401, message: "User not found" },
        USER_INACTIVE: { code: 403, message: "Account is inactive" },
        INTERNAL_ERROR: { code: 500, message: "Internal server error" },
      };
      const mapped = errorMap[result.error];
      return this.sendError(ctx, mapped.code, mapped.message);
    }

    return this.sendSuccess(ctx, result.value, 200);
  }

  /**
   * @method logout
   * @description POST /auth/customer/logout — revokes the active session by
   *   blacklisting its `sessionId` in the cache. The refresh token is read
   *   from the request body (Next.js proxy forwards it from the
   *   `customer-refresh` httpOnly cookie). Missing token still returns 200
   *   so the frontend can always finalize logout client-side.
   */
  async logout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const body = (request.body ?? {}) as { refreshToken?: unknown };
    const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken : null;

    const result = await this.logoutUseCase.execute({ refreshToken });

    if (!result.ok) {
      return this.sendError(ctx, 500, "Internal server error");
    }

    return this.sendSuccess(ctx, result.value, 200);
  }

  /**
   * @method requestPasswordReset
   * @description POST /auth/customer/request-password-reset
   */
  async requestPasswordReset(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validationResult = await this.validateRequest(ctx, {
      body: RequestPasswordResetSchema,
    });
    if (!validationResult.ok) {
      return this.sendError(ctx, 400, "Invalid input data");
    }

    const { body } = validationResult.value as {
      body: z.infer<typeof RequestPasswordResetSchema>;
    };

    // The reset request is pre-identity and genuinely cross-tenant: one address can
    // be registered on several accounts, and the lookup has to find ALL of them
    // before any of them is attributable. The extent is the whole handler because
    // every write that follows is keyed by a row id that the cross-account lookup
    // itself returned — no step takes a caller-supplied identifier.
    const result = await withSystemContext(CUSTOMER_REQUEST_PASSWORD_RESET_SYSTEM_REASON, () =>
      this.requestResetUseCase.execute({
        email: body.email,
      })
    );

    if (!result.ok) {
      return this.sendError(ctx, 500, "Internal server error");
    }

    if (result.value.unpersistedCount > 0) {
      // A row whose token never landed cannot be sent a link, so the recipient
      // silently receives fewer links than they have accounts. Discarding that
      // result is what made the condition invisible.
      authLogger.warn(
        {
          threat_type: "customer_reset_token_unpersisted",
          layer: "infrastructure",
          unpersisted_count: result.value.unpersistedCount,
        },
        "one or more customer reset tokens could not be persisted"
      );
    }

    // A CONSTANT body. This makes the anti-enumeration silhouette a property of the
    // transport rather than a value the use case has to remember to keep identical,
    // so the diagnostic above can never widen it.
    return this.sendSuccess(ctx, { message: result.value.message }, 200);
  }

  /**
   * @method resetPassword
   * @description POST /auth/customer/reset-password
   */
  async resetPassword(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validationResult = await this.validateRequest(ctx, {
      body: ResetPasswordSchema,
    });
    if (!validationResult.ok) {
      return this.sendError(ctx, 400, "Invalid input data");
    }

    const { body } = validationResult.value as {
      body: z.infer<typeof ResetPasswordSchema>;
    };

    // The confirm is pre-identity: the subject is named only by the reset token.
    // The extent is the whole handler, which is defensible because the single write
    // in this flow is one conditional statement whose own predicate names a
    // globally-`@unique` token plus a live owner — the write is self-scoping, so
    // guard injection could not narrow it further. Re-entering a tenant context
    // would require a read issued purely to learn the account, restoring the
    // read-then-write shape the single claim exists to delete.
    const result = await withSystemContext(CUSTOMER_RESET_PASSWORD_SYSTEM_REASON, () =>
      this.resetPasswordUseCase.execute({
        token: body.token,
        newPassword: body.newPassword,
      })
    );

    if (!result.ok) {
      // One code for every unusable token. Unknown, expired, already-claimed and
      // soft-deleted-owner are indistinguishable on purpose: telling them apart is
      // a token-validity oracle.
      const errorMap = {
        INVALID_TOKEN: { code: 400, message: "Invalid or expired reset token" },
        VALIDATION_ERROR: { code: 400, message: "Invalid input data" },
        INTERNAL_ERROR: { code: 500, message: "Internal server error" },
      };
      const mapped = errorMap[result.error];
      return this.sendError(ctx, mapped.code, mapped.message);
    }

    return this.sendSuccess(ctx, result.value, 200);
  }

  /**
   * @method me
   * @description GET /auth/customer/me - Returns the authenticated customer user.
   */
  async me(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    if (!request.customerUser) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    return this.sendSuccess(ctx, { user: request.customerUser }, 200);
  }
}

/**
 * Fastify plugin that registers all customer authentication routes.
 */
const customerAuthRoutes: FastifyPluginAsync = async (fastify) => {
  const registerUC = fastify.container!.resolve<RegisterCustomerUseCase>(
    TOKENS.RegisterCustomerUseCase
  );
  const loginUC = fastify.container!.resolve<LoginCustomerUseCase>(TOKENS.LoginCustomerUseCase);
  const completeMfaUC = fastify.container!.resolve<CompleteCustomerMfaLoginUseCase>(
    TOKENS.CompleteCustomerMfaLoginUseCase
  );
  const refreshUC = fastify.container!.resolve<RefreshCustomerTokenUseCase>(
    TOKENS.RefreshCustomerTokenUseCase
  );
  const logoutUC = fastify.container!.resolve<LogoutCustomerUseCase>(TOKENS.LogoutCustomerUseCase);
  const requestResetUC = fastify.container!.resolve<RequestPasswordResetUseCase>(
    TOKENS.RequestPasswordResetUseCase
  );
  const resetPasswordUC = fastify.container!.resolve<ResetPasswordUseCase>(
    TOKENS.ResetPasswordUseCase
  );

  const handler = new CustomerAuthRouteHandler(
    registerUC,
    loginUC,
    completeMfaUC,
    refreshUC,
    logoutUC,
    requestResetUC,
    resetPasswordUC
  );

  // POST /auth/customer/register — public
  fastify.post(
    "/auth/customer/register",
    {
      schema: { tags: ["Customer Auth"], summary: "Register new customer account" },
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      await handler.register(request, reply);
    }
  );

  // POST /auth/customer/login — public. The real brute-force cap (AUTH preset,
  // 5 / 15 min) is enforced by the global httpRateLimit preHandler via the
  // `/auth/customer/login` rule in STANDARD_ROUTE_RULES. The route-level
  // `config.rateLimit` was inert (@fastify/rate-limit is never registered in
  // apps/api/src), so it is removed here to avoid overstating protection.
  fastify.post(
    "/auth/customer/login",
    {
      schema: { tags: ["Customer Auth"], summary: "Customer login" },
    },
    async (request, reply) => {
      await handler.login(request, reply);
    }
  );

  // POST /auth/customer/login/mfa — public step 2 of the MFA login. Rate-limited
  // by the canonical HTTP limiter (AUTH preset, own ip:path bucket) and gated by
  // the per-account BruteForceProtectionPort inside the use case.
  fastify.post(
    "/auth/customer/login/mfa",
    {
      schema: { tags: ["Customer Auth"], summary: "Complete customer MFA login" },
    },
    async (request, reply) => {
      await handler.completeMfaLogin(request, reply);
    }
  );

  // POST /auth/customer/logout — authenticated
  fastify.post(
    "/auth/customer/logout",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Customer Auth"], summary: "Customer logout" },
    },
    async (request, reply) => {
      await handler.logout(request, reply);
    }
  );

  // POST /auth/customer/refresh — public
  fastify.post(
    "/auth/customer/refresh",
    {
      schema: { tags: ["Customer Auth"], summary: "Refresh customer tokens" },
      config: { rateLimit: { max: 20, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      await handler.refresh(request, reply);
    }
  );

  // POST /auth/customer/request-password-reset — public
  fastify.post(
    "/auth/customer/request-password-reset",
    {
      schema: {
        tags: ["Customer Auth"],
        summary: "Request customer password reset",
      },
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      await handler.requestPasswordReset(request, reply);
    }
  );

  // POST /auth/customer/reset-password — public
  fastify.post(
    "/auth/customer/reset-password",
    {
      schema: { tags: ["Customer Auth"], summary: "Reset customer password" },
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      await handler.resetPassword(request, reply);
    }
  );

  // GET /auth/customer/me — authenticated
  fastify.get(
    "/auth/customer/me",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Customer Auth"], summary: "Get current customer user" },
    },
    async (request, reply) => {
      await handler.me(request, reply);
    }
  );
};

export { customerAuthRoutes };
