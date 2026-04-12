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
import { adminAuthService } from "./AdminAuthService.js";
import type { AuthContext, AuthErrorCode } from "./adminAuthTypes";
// AdminRole is now a string type (DB-driven via Role table)

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
 * Check rate limit for admin operations
 *
 * Uses IP address and endpoint for rate limiting.
 * Returns 429 if rate limit is exceeded.
 *
 * Note: This is a simple in-memory implementation.
 * For production, use Redis-based rate limiting.
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(maxRequests: number, windowMs: number) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const key = `${request.ip}:${request.routeOptions.url}`;
    const now = Date.now();

    const existing = rateLimitMap.get(key);

    if (existing && existing.resetAt > now) {
      if (existing.count >= maxRequests) {
        const retryAfter = Math.ceil((existing.resetAt - now) / 1000);
        reply.header("Retry-After", retryAfter.toString());
        return reply.status(429).send({
          ok: false,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: `Too many requests. Please try again in ${retryAfter} seconds.`,
          },
        });
      }

      existing.count++;
    } else {
      rateLimitMap.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
    }

    // Cleanup old entries (run periodically)
    if (Math.random() < 0.01) {
      // 1% chance to cleanup
      for (const [k, v] of rateLimitMap.entries()) {
        if (v.resetAt < now) {
          rateLimitMap.delete(k);
        }
      }
    }
  };
}
