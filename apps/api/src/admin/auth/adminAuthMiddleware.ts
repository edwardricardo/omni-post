/**
 * @file adminAuthMiddleware.ts
 * @description Fastify middleware for protecting admin routes with JWT authentication,
 *              authorization, and permission checking.
 * @layer infrastructure
 *   fastify.addHook('onRequest', requireAdminAuth);
 *   fastify.get('/protected', handler);
 * });
 * ```
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { RateLimiterPort } from "@ports/core";
import type { AdminAuthService } from "./AdminAuthService.js";
import { TOKENS } from "../../infrastructure/container/types.js";
import { resolveClientIp } from "../../security/resolveClientIp.js";
import type { AuthContext, AuthErrorCode } from "./adminAuthTypes.js";

// ============================================================================
// Augment Fastify Request with auth context
// ============================================================================

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

// ============================================================================
// Authentication Middleware
// ============================================================================

/**
 * Extract bearer token from Authorization header
 */
function extractBearerToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  return authHeader.substring(7); // Remove "Bearer " prefix
}

/**
 * Require admin authentication (JWT access token)
 *
 * Validates JWT access token and attaches auth context to request.
 * Returns 401 if token is missing, invalid, or expired.
 *
 * Usage:
 * ```typescript
 * fastify.addHook('onRequest', requireAdminAuth);
 * ```
 */
export async function requireAdminAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = extractBearerToken(request);

  if (!token) {
    return reply.status(401).send({
      ok: false,
      error: {
        code: "INVALID_TOKEN",
        message: "Authentication required. Please provide a valid access token.",
      },
    });
  }

  // Resolve AdminAuthService from the request's server container — this is a
  // free middleware function, so it receives DI dependencies via request.server
  // rather than constructor injection.
  const adminAuthService = request.server.container?.resolve<AdminAuthService>(
    TOKENS.AdminAuthService
  );
  if (!adminAuthService) {
    return reply.status(401).send({
      ok: false,
      error: { code: "INVALID_TOKEN", message: "Authentication service unavailable." },
    });
  }

  // Verify access token
  const result = adminAuthService.verifyAccessToken(token);

  if (!result.ok) {
    const errorMessages: Record<AuthErrorCode, string> = {
      TOKEN_EXPIRED: "Access token has expired. Please refresh your token.",
      INVALID_TOKEN: "Invalid access token. Please login again.",
      INVALID_CREDENTIALS: "Invalid credentials",
      ACCOUNT_LOCKED: "Account is locked",
      ACCOUNT_INACTIVE: "Account is inactive",
      EMAIL_NOT_VERIFIED: "Email not verified",
      MFA_REQUIRED: "MFA required",
      MFA_INVALID: "Invalid MFA token",
      SESSION_EXPIRED: "Session expired",
      SESSION_REVOKED: "Session revoked",
      CSRF_TOKEN_MISMATCH: "CSRF token mismatch",
      PASSWORD_TOO_WEAK: "Password too weak",
      PASSWORD_REUSED: "Password reused",
      PASSWORD_EXPIRED: "Password expired",
      RATE_LIMIT_EXCEEDED: "Rate limit exceeded",
      SUSPICIOUS_ACTIVITY: "Suspicious activity detected",
      PERMISSION_DENIED: "Permission denied",
      USER_NOT_FOUND: "User not found",
      INVALID_REQUEST: "Invalid request",
      INTERNAL_ERROR: "Internal error",
    };

    const errorCode = result.error as AuthErrorCode;
    return reply.status(401).send({
      ok: false,
      error: {
        code: errorCode,
        message: errorMessages[errorCode] || "Authentication failed",
      },
    });
  }

  const payload = result.value;

  // Attach auth context to request
  request.auth = {
    user: {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      isActive: true,
      emailVerified: true,
      mfaEnabled: false,
      timezone: null,
      locale: null,
      department: null,
      team: null,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    sessionId: "", // Not available from access token
    ...(payload.deviceId && { deviceId: payload.deviceId }),
    ...(request.ip && { ipAddress: request.ip }),
    ...(request.headers["user-agent"] && { userAgent: request.headers["user-agent"] }),
  };
}

// ============================================================================
// Authorization Middleware (Role-Based)
// ============================================================================

/**
 * Require specific admin role(s)
 *
 * Must be used AFTER requireAdminAuth middleware.
 * Returns 403 if user doesn't have required role.
 *
 * Usage:
 * ```typescript
 * fastify.addHook('onRequest', requireAdminAuth);
 * fastify.addHook('onRequest', requireRole(['SUPER_ADMIN']));
 * ```
 */
function requireRole(roles: string | string[]) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.auth) {
      return reply.status(401).send({
        ok: false,
        error: {
          code: "INVALID_TOKEN",
          message: "Authentication required",
        },
      });
    }

    if (!allowedRoles.includes(request.auth.user.role)) {
      return reply.status(403).send({
        ok: false,
        error: {
          code: "PERMISSION_DENIED",
          message: `Access denied. Required role: ${allowedRoles.join(" or ")}`,
        },
      });
    }
  };
}

/**
 * Require SUPER_ADMIN role
 *
 * Convenience wrapper for requireRole(['SUPER_ADMIN'])
 */
export const requireSuperAdmin = requireRole(["SUPER_ADMIN"]);

/**
 * Require SUPER_ADMIN or ADMIN role
 *
 * Convenience wrapper for requireRole(['SUPER_ADMIN', 'ADMIN'])
 */
export const requireAdmin = requireRole(["SUPER_ADMIN", "ADMIN"]);

// ============================================================================
// Rate Limiting Helper
// ============================================================================

/**
 * @function rateLimit
 * @description Builds a rate-limit middleware keyed by request IP + route,
 *              backed by the cross-pod `RateLimiterPort` (token bucket) resolved
 *              from the container. Replies HTTP 429 when the per-window limit is
 *              exceeded. Fail-open when the limiter is unavailable (e.g. tests
 *              without a wired container) so admin auth never hard-blocks on a
 *              limiter outage.
 * @param maxRequests - Maximum requests allowed inside the window.
 * @param windowMs - Window size in milliseconds.
 * @returns Fastify handler middleware.
 */
export function rateLimit(maxRequests: number, windowMs: number) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const limiter = request.server.container?.resolve<RateLimiterPort>(TOKENS.HttpRateLimiter);
    if (!limiter) return;

    const key = `admin:${resolveClientIp(request)}:${request.routeOptions.url}`;
    let decision;
    try {
      decision = await limiter.tryConsume(key, {
        capacity: maxRequests,
        refillWindowMs: windowMs,
      });
    } catch {
      // Fail-open: a limiter outage must not block admin auth.
      return;
    }

    if (!decision.allowed) {
      const retryAfter = Math.ceil((decision.retryAfterMs ?? 0) / 1000);
      reply.header("Retry-After", retryAfter.toString());
      return reply.status(429).send({
        ok: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: `Too many requests. Please try again in ${retryAfter} seconds.`,
        },
      });
    }
  };
}
