/**
 * @file authRoutes.ts
 * @description Fastify route plugin for user authentication endpoints including
 *              registration, login, token refresh, logout, and session management.
 * @layer infrastructure
 */
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { SecureSchemas } from "../security/inputValidation.js";
import type { AuthService } from "./authService.js";
import { requireClientAuth } from "./customerAuthMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";
import { env } from "../config/env.js";

// Zod schemas for validation with security enhancement
const LoginSchema = z.object({
  email: SecureSchemas.userEmail,
  password: z.string().min(1),
  mfaToken: z
    .string()
    .regex(/^[0-9A-F]{6,8}$/)
    .optional(),
});

const RefreshSchema = z.object({
  refreshToken: z.string(),
});

const LogoutSchema = z.object({
  refreshToken: z.string(),
});

/**
 * AuthRouteHandler - Handles all authentication-related routes
 */
class AuthRouteHandler extends BaseRouteHandler {
  protected routeName = "auth";

  constructor(private authService: AuthService) {
    super();
  }

  /**
   * @method login
   * @description POST /auth/login - Verifies the credentials, and the MFA token when one is
   *   sent, then sets the refresh token as an HTTP-only cookie and returns the user and its
   *   access token; an account that needs a second factor gets the MFA challenge instead.
   * @param request - The login body: e-mail, password and an optional MFA token.
   * @param reply - The reply the session, the MFA challenge or the refusal is sent on.
   */
  async login(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    // Validate request body
    const validationResult = await this.validateRequest(ctx, {
      body: LoginSchema,
    });

    if (!validationResult.ok) {
      return this.sendError(ctx, 400, "Invalid input data");
    }

    const { body } = validationResult.value as { body: z.infer<typeof LoginSchema> };
    const { email, password, mfaToken } = body;
    const ipAddress = request.ip;
    const userAgent = request.headers["user-agent"];

    // Login through auth service
    const result = await this.authService.login(
      { email, password, ...(mfaToken && { mfaToken }) },
      ipAddress,
      userAgent
    );

    // Handle errors
    if (!result.ok) {
      const errorMap = {
        INVALID_CREDENTIALS: { code: 401, message: "Invalid email or password" },
        USER_INACTIVE: { code: 403, message: "Account is inactive" },
        INVALID_MFA_TOKEN: { code: 401, message: "Invalid MFA token or backup code" },
        DATABASE_ERROR: { code: 500, message: "Internal server error" },
      };

      const errorConfig = errorMap[result.error as keyof typeof errorMap] || {
        code: 500,
        message: "Internal server error",
      };

      return this.sendError(ctx, errorConfig.code, errorConfig.message);
    }

    // Type assertion after all error cases have been handled
    const responseData = result.value;

    // Check if MFA is required
    if ("mfaRequired" in responseData) {
      return this.sendSuccess(
        ctx,
        {
          mfaRequired: true,
          userId: responseData.userId,
          message: "MFA token required to complete login",
        },
        200
      );
    }

    // Normal login flow (with or without MFA completed)
    const loginData = responseData;

    // Set refresh token as HTTP-only cookie for security
    reply.setCookie("refreshToken", loginData.tokens.refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: "/auth",
    });

    return this.sendSuccess(
      ctx,
      {
        user: loginData.user,
        accessToken: loginData.tokens.accessToken,
        expiresAt: loginData.tokens.expiresAt,
      },
      200
    );
  }

  /**
   * @method refresh
   * @description POST /auth/refresh - Rotates the session's refresh token, read from the
   *   cookie first and the body second, and returns a new access token; a refused token
   *   clears the cookie so the client stops presenting it.
   * @param request - The request carrying the refresh token in its cookie or its body.
   * @param reply - The reply the rotated cookie and access token, or the refusal, are sent on.
   */
  async refresh(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    // Try to get refresh token from cookie first, then from body
    let refreshToken = request.cookies.refreshToken;

    if (
      !refreshToken &&
      request.body &&
      typeof request.body === "object" &&
      "refreshToken" in request.body
    ) {
      const validationResult = await this.validateRequest(ctx, {
        body: RefreshSchema,
      });

      if (validationResult.ok) {
        const { body } = validationResult.value as { body: z.infer<typeof RefreshSchema> };
        refreshToken = body.refreshToken;
      }
    }

    if (!refreshToken) {
      return this.sendError(ctx, 401, "Refresh token required");
    }

    const ipAddress = request.ip;
    const result = await this.authService.refreshTokens(refreshToken, ipAddress);

    // Handle errors and clear invalid cookie
    if (!result.ok) {
      reply.clearCookie("refreshToken", { path: "/auth" });

      const errorMap = {
        INVALID_TOKEN: { code: 401, message: "Invalid or expired refresh token" },
        SESSION_EXPIRED: { code: 401, message: "Invalid or expired refresh token" },
        TOKEN_BLACKLISTED: { code: 401, message: "Token has been revoked" },
        USER_INACTIVE: { code: 403, message: "Account is inactive" },
        DATABASE_ERROR: { code: 500, message: "Internal server error" },
      };

      const errorConfig = errorMap[result.error as keyof typeof errorMap] || {
        code: 500,
        message: "Internal server error",
      };

      return this.sendError(ctx, errorConfig.code, errorConfig.message);
    }

    // Update refresh token cookie
    reply.setCookie("refreshToken", result.value.refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: "/auth",
    });

    return this.sendSuccess(
      ctx,
      {
        accessToken: result.value.accessToken,
        expiresAt: result.value.expiresAt,
      },
      200
    );
  }

  /**
   * @method logout
   * @description POST /auth/logout - Ends the session the refresh token names and clears the
   *   cookie; a session that no longer exists still logs out successfully.
   * @param request - The request carrying the refresh token in its cookie or its body.
   * @param reply - The reply the confirmation or the refusal is sent on.
   */
  async logout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    // Try to get refresh token from cookie first, then from body
    let refreshToken = request.cookies.refreshToken;

    if (
      !refreshToken &&
      request.body &&
      typeof request.body === "object" &&
      "refreshToken" in request.body
    ) {
      const validationResult = await this.validateRequest(ctx, {
        body: LogoutSchema,
      });

      if (validationResult.ok) {
        const { body } = validationResult.value as { body: z.infer<typeof LogoutSchema> };
        refreshToken = body.refreshToken;
      }
    }

    if (!refreshToken) {
      return this.sendError(ctx, 400, "Refresh token required");
    }

    const result = await this.authService.logout(refreshToken);

    // Clear refresh token cookie regardless of result
    reply.clearCookie("refreshToken", { path: "/auth" });

    // Handle errors (SESSION_NOT_FOUND is still considered success)
    if (!result.ok && result.error !== "SESSION_NOT_FOUND") {
      if (result.error === "DATABASE_ERROR") {
        return this.sendError(ctx, 500, "Internal server error");
      }
    }

    return this.sendSuccess(ctx, { message: "Logged out successfully" }, 200);
  }

  /**
   * @method me
   * @description GET /auth/me - Returns the user `requireClientAuth` attached to the request.
   * @param request - The authenticated request.
   * @param reply - The reply the user is sent on.
   */
  async me(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = {
      request,
      reply,
      ...this.getUserContext(request),
    };

    // User info is attached by the authenticate middleware
    return this.sendSuccess(ctx, { user: request.customerUser }, 200);
  }

  /**
   * @method getSessions
   * @description GET /auth/sessions - Lists the caller's sessions, each reduced to its id, IP
   *   address, user agent and dates.
   * @param request - The authenticated request whose user's sessions are listed.
   * @param reply - The reply the sessions or the refusal are sent on.
   */
  async getSessions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = {
      request,
      reply,
      ...this.getUserContext(request),
    };

    const userId = request.customerUser?.id;
    if (!userId) {
      return this.sendError(ctx, 401, "Unauthorized");
    }

    const result = await this.authService.getUserSessions(userId);

    if (!result.ok) {
      return this.sendError(ctx, 500, "Internal server error");
    }

    // Remove sensitive data from sessions
    const sessions = result.value.map((session) => ({
      id: session.id,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    }));

    return this.sendSuccess(ctx, { sessions }, 200);
  }

  /**
   * @method revokeAllSessions
   * @description POST /auth/revoke-all - Revokes every session of the caller and clears the
   *   refresh cookie.
   * @param request - The authenticated request whose user's sessions are revoked.
   * @param reply - The reply the revoked count or the refusal is sent on.
   */
  async revokeAllSessions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = {
      request,
      reply,
      ...this.getUserContext(request),
    };

    const userId = request.customerUser?.id;
    if (!userId) {
      return this.sendError(ctx, 401, "Unauthorized");
    }

    const result = await this.authService.revokeAllSessions(userId);

    if (!result.ok) {
      return this.sendError(ctx, 500, "Internal server error");
    }

    // Clear refresh token cookie
    reply.clearCookie("refreshToken", { path: "/auth" });

    return this.sendSuccess(
      ctx,
      {
        message: "All sessions revoked successfully",
        revokedCount: result.value,
      },
      200
    );
  }
}

// Fastify v5.6.1 Plugin Implementation
const authRoutes: FastifyPluginAsync = async (fastify) => {
  const authService = fastify.container!.resolve<AuthService>(TOKENS.AuthService);
  const authHandler = new AuthRouteHandler(authService);

  // Login
  fastify.post(
    "/auth/login",
    {
      schema: { tags: ["Auth"], summary: "Login user" },
    },
    async (request, reply) => {
      await authHandler.login(request, reply);
    }
  );

  // Refresh tokens
  fastify.post(
    "/auth/refresh",
    {
      schema: { tags: ["Auth"], summary: "Refresh access tokens" },
    },
    async (request, reply) => {
      await authHandler.refresh(request, reply);
    }
  );

  // Logout
  fastify.post(
    "/auth/logout",
    {
      schema: { tags: ["Auth"], summary: "Logout user" },
    },
    async (request, reply) => {
      await authHandler.logout(request, reply);
    }
  );

  // Get current user (protected route)
  fastify.get(
    "/auth/me",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Auth"], summary: "Get current authenticated user" },
    },
    async (request, reply) => {
      await authHandler.me(request, reply);
    }
  );

  // Get user sessions (protected route)
  fastify.get(
    "/auth/sessions",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Auth"], summary: "Get user sessions" },
    },
    async (request, reply) => {
      await authHandler.getSessions(request, reply);
    }
  );

  // Revoke all sessions (protected route)
  fastify.post(
    "/auth/revoke-all",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Auth"], summary: "Revoke all user sessions" },
    },
    async (request, reply) => {
      await authHandler.revokeAllSessions(request, reply);
    }
  );
};

export { authRoutes };
