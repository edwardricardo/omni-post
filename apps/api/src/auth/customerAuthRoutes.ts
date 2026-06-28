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
import type {
  RegisterCustomerUseCase,
  LoginCustomerUseCase,
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

/**
 * @class CustomerAuthRouteHandler
 * @description Handles all customer authentication route logic.
 */
class CustomerAuthRouteHandler extends BaseRouteHandler {
  protected routeName = "customer-auth";

  constructor(
    private registerUseCase: RegisterCustomerUseCase,
    private loginUseCase: LoginCustomerUseCase,
    private refreshUseCase: RefreshCustomerTokenUseCase,
    private logoutUseCase: LogoutCustomerUseCase,
    private requestResetUseCase: RequestPasswordResetUseCase,
    private resetPasswordUseCase: ResetPasswordUseCase
  ) {
    super();
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

    const result = await this.registerUseCase.execute({
      accountName: body.accountName,
      accountEmail: body.accountEmail ?? body.email,
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      password: body.password,
      ...(body.plan !== undefined && { plan: body.plan }),
    });

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
        ip: request.ip,
        userAgent: request.headers["user-agent"] ?? "",
      })
    );

    if (!result.ok) {
      const errorMap = {
        INVALID_CREDENTIALS: { code: 401, message: "Invalid email or password" },
        USER_INACTIVE: { code: 403, message: "Account is inactive" },
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

    return this.sendSuccess(ctx, result.value, 200);
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

    const result = await this.refreshUseCase.execute({
      refreshToken: body.refreshToken,
    });

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

    const result = await this.requestResetUseCase.execute({
      email: body.email,
    });

    if (!result.ok) {
      return this.sendError(ctx, 500, "Internal server error");
    }

    return this.sendSuccess(ctx, result.value, 200);
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

    const result = await this.resetPasswordUseCase.execute({
      token: body.token,
      newPassword: body.newPassword,
    });

    if (!result.ok) {
      const errorMap = {
        INVALID_TOKEN: { code: 400, message: "Invalid or expired reset token" },
        TOKEN_EXPIRED: { code: 400, message: "Reset token has expired" },
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
    refreshUC,
    logoutUC,
    requestResetUC,
    resetPasswordUC
  );

  // POST /auth/customer/register — public.
  // Rate limiting is enforced by the canonical HTTP limiter
  // (createHttpRateLimitPreHandler + AUTH_ROUTE_RULES → 5 req / 15 min), NOT by
  // a route-level `config.rateLimit` — the `@fastify/rate-limit` plugin is never
  // registered, so that key was dead (ADR-0019).
  fastify.post(
    "/auth/customer/register",
    {
      schema: { tags: ["Customer Auth"], summary: "Register new customer account" },
    },
    async (request, reply) => {
      await handler.register(request, reply);
    }
  );

  // POST /auth/customer/login — public. Defence-in-depth: the canonical HTTP
  // limiter caps per-IP (AUTH preset) AND LoginCustomerUseCase is gated by the
  // account-based BruteForceProtectionPort (ADR-0015).
  fastify.post(
    "/auth/customer/login",
    {
      schema: { tags: ["Customer Auth"], summary: "Customer login" },
    },
    async (request, reply) => {
      await handler.login(request, reply);
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

  // POST /auth/customer/refresh — public (canonical HTTP limiter, AUTH preset).
  fastify.post(
    "/auth/customer/refresh",
    {
      schema: { tags: ["Customer Auth"], summary: "Refresh customer tokens" },
    },
    async (request, reply) => {
      await handler.refresh(request, reply);
    }
  );

  // POST /auth/customer/request-password-reset — public (canonical limiter, AUTH preset).
  fastify.post(
    "/auth/customer/request-password-reset",
    {
      schema: {
        tags: ["Customer Auth"],
        summary: "Request customer password reset",
      },
    },
    async (request, reply) => {
      await handler.requestPasswordReset(request, reply);
    }
  );

  // POST /auth/customer/reset-password — public (canonical limiter, AUTH preset).
  fastify.post(
    "/auth/customer/reset-password",
    {
      schema: { tags: ["Customer Auth"], summary: "Reset customer password" },
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
