import { FastifyRequest, FastifyReply } from "fastify";
import type { AuthService, AuthenticatedUser } from "./authService.js";
import { TOKENS } from "../infrastructure/container/types.js";
import { authLogger } from "../lib/logger.js";

// Extend Fastify request type to include user
declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

/**
 * Resolve AuthService from the DI container attached to the Fastify instance.
 * Falls back gracefully when no container is registered (e.g., minimal test apps).
 */
function resolveAuthService(request: FastifyRequest): AuthService | null {
  // request.server.container is decorated in index.ts
  const server = request.server as unknown as {
    container?: { resolve: (token: symbol) => unknown };
  };
  return (server.container?.resolve(TOKENS.AuthService) as AuthService) ?? null;
}

// Authentication middleware
export async function authenticateMiddleware(request: FastifyRequest, reply: FastifyReply) {
  try {
    // Get token from Authorization header
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Authorization token required" });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    if (!token) {
      return reply.code(401).send({ error: "Authorization token required" });
    }

    const authSvc = resolveAuthService(request);
    if (!authSvc) {
      return reply.code(500).send({ error: "Authentication service unavailable" });
    }

    // Verify the access token
    const result = await authSvc.verifyAccessToken(token);

    if (!result.ok) {
      switch (result.error) {
        case "INVALID_TOKEN":
          return reply.code(401).send({ error: "Invalid token" });
        case "TOKEN_BLACKLISTED":
          return reply.code(401).send({ error: "Token has been revoked" });
        case "SESSION_EXPIRED":
          return reply.code(401).send({ error: "Token expired" });
        case "USER_INACTIVE":
          return reply.code(403).send({ error: "Account is inactive" });
        default:
          return reply.code(401).send({ error: "Authentication failed" });
      }
    }

    // Attach user to request
    request.user = result.value;
  } catch (error: unknown) {
    authLogger.error({ err: error }, "Authentication middleware error");
    return reply.code(500).send({ error: "Internal server error" });
  }
}

// Role-based authorization middleware factory
export function requireRole(...allowedRoles: ("SUPER_ADMIN" | "ADMIN" | "SUPPORT")[]) {
  return async function roleMiddleware(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    if (!allowedRoles.includes(request.user.role)) {
      return reply.code(403).send({
        error: "Insufficient permissions",
        required: allowedRoles,
        current: request.user.role,
      });
    }
  };
}

// Admin-only middleware (ADMIN or SUPER_ADMIN)
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    return reply.code(401).send({ error: "Authentication required" });
  }

  if (!["ADMIN", "SUPER_ADMIN"].includes(request.user.role)) {
    return reply.code(403).send({
      error: "Admin access required",
      current: request.user.role,
    });
  }
}

// Super admin only middleware
export async function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    return reply.code(401).send({ error: "Authentication required" });
  }

  if (request.user.role !== "SUPER_ADMIN") {
    return reply.code(403).send({
      error: "Super admin access required",
      current: request.user.role,
    });
  }
}

// Optional authentication middleware (doesn't fail if no token)
export async function optionalAuth(request: FastifyRequest, _reply: FastifyReply) {
  try {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return; // No token provided, continue without authentication
    }

    const token = authHeader.substring(7);

    if (!token) {
      return; // No token provided, continue without authentication
    }

    const authSvc = resolveAuthService(request);
    if (!authSvc) return;

    // Verify the access token
    const result = await authSvc.verifyAccessToken(token);

    if (result.ok) {
      // Attach user to request if token is valid
      request.user = result.value;
    }
    // If token is invalid, continue without authentication (don't throw error)
  } catch (error: unknown) {
    // Log error but don't fail the request
    authLogger.error({ err: error }, "Optional auth middleware error");
  }
}
