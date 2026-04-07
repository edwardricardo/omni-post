/**
 * @file customerAuthRoutes.ts
 * @description Fastify plugin registering customer-facing authentication routes.
 *   Completely separate from admin auth — different JWT secrets, different middleware.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import { TOKENS } from "../infrastructure/container/types.js";
import { requireClientAuth } from "./customerAuthMiddleware.js";
import type {
  RegisterCustomerUseCase,
  LoginCustomerUseCase,
  RefreshCustomerTokenUseCase,
  LogoutCustomerUseCase,
  RequestPasswordResetUseCase,
  ResetPasswordUseCase,
} from "../application/customer-auth/index.js";

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

    const result = await this.loginUseCase.execute({
      email: body.email,
      password: body.password,
      ...(body.accountSlug !== undefined && { accountSlug: body.accountSlug }),
    });

    if (!result.ok) {
      const errorMap = {
        INVALID_CREDENTIALS: { code: 401, message: "Invalid email or password" },
        USER_INACTIVE: { code: 403, message: "Account is inactive" },
        MULTIPLE_ACCOUNTS: {
          code: 409,
          message: "Multiple accounts found. Please provide accountSlug.",
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
   * @description POST /auth/customer/logout - Acknowledges logout.
   */
  async logout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const result = await this.logoutUseCase.execute();

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

  // POST /auth/customer/login — public
  fastify.post(
    "/auth/customer/login",
    {
      schema: { tags: ["Customer Auth"], summary: "Customer login" },
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
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
