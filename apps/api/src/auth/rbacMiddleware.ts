/**
 * @file rbacMiddleware.ts
 * @description Fastify middleware for role-based access control, resolving RbacService
 *              from DI and enforcing permission checks on protected routes.
 * @layer infrastructure
 */
import { FastifyRequest, FastifyReply } from "fastify";
import type { RbacService } from "./rbacService.js";
import { Permission } from "./rbacService.js";
import { TOKENS } from "../infrastructure/container/types.js";
import { authLogger } from "../lib/logger.js";

/**
 * Resolve RbacService from the DI container attached to the Fastify instance.
 */
function resolveRbacService(request: FastifyRequest): RbacService | null {
  const server = request.server as unknown as {
    container?: { resolve: (token: symbol) => unknown };
  };
  return (server.container?.resolve(TOKENS.RbacService) as RbacService) ?? null;
}

/**
 * Resolve the authenticated user from either auth pattern:
 * - Admin auth: request.auth.user (set by requireAdminAuth)
 * - Client auth: request.user (set by requireClientAuth)
 */
function resolveUser(request: FastifyRequest) {
  return request.auth?.user ?? request.user ?? null;
}

/**
 * Permission-based authorization middleware factory
 * More granular than role-based middleware
 */
export function requirePermission(...permissions: Permission[]) {
  return async function permissionMiddleware(request: FastifyRequest, reply: FastifyReply) {
    const user = resolveUser(request);
    if (!user) {
      return reply.code(401).send({
        error: "Authentication required",
        requiredPermissions: permissions,
      });
    }

    const rbacSvc = resolveRbacService(request);
    if (!rbacSvc) {
      return reply.code(500).send({ error: "RBAC service unavailable" });
    }

    const userRole = user.role;
    const hasPermission = await rbacSvc.hasAnyPermission(userRole, permissions);

    if (!hasPermission) {
      return reply.code(403).send({
        ok: false,
        error: {
          code: "PERMISSION_DENIED",
          message: `Required permissions: ${permissions.join(", ")}`,
        },
      });
    }
  };
}

/**
 * Require ALL specified permissions (more restrictive)
 */
export function requireAllPermissions(...permissions: Permission[]) {
  return async function allPermissionsMiddleware(request: FastifyRequest, reply: FastifyReply) {
    const user = resolveUser(request);
    if (!user) {
      return reply.code(401).send({
        error: "Authentication required",
        requiredPermissions: permissions,
      });
    }

    const rbacSvc = resolveRbacService(request);
    if (!rbacSvc) {
      return reply.code(500).send({ error: "RBAC service unavailable" });
    }

    const userRole = user.role;
    const hasAllPerms = await rbacSvc.hasAllPermissions(userRole, permissions);

    if (!hasAllPerms) {
      const userPermissions = await rbacSvc.getUserPermissions(user.id, userRole);
      const missingPermissions = permissions.filter(
        (p) => !userPermissions.permissions.includes(p)
      );

      return reply.code(403).send({
        ok: false,
        error: {
          code: "PERMISSION_DENIED",
          message: `Missing permissions: ${missingPermissions.join(", ")}`,
        },
      });
    }
  };
}

/**
 * Resource ownership middleware
 * Allows access if user owns the resource OR has the required permission
 */
export function requireOwnershipOrPermission(
  getResourceOwnerId: (request: FastifyRequest) => string | Promise<string>,
  fallbackPermission: Permission
) {
  return async function ownershipMiddleware(request: FastifyRequest, reply: FastifyReply) {
    const user = resolveUser(request);
    if (!user) {
      return reply.code(401).send({
        error: "Authentication required",
      });
    }

    try {
      const resourceOwnerId = await getResourceOwnerId(request);
      const isOwner = user.id === resourceOwnerId;

      if (isOwner) {
        return; // Owner has access
      }

      // Not owner, check permission
      const rbacSvc = resolveRbacService(request);
      if (!rbacSvc) {
        return reply.code(500).send({ error: "RBAC service unavailable" });
      }

      const hasPerm = await rbacSvc.hasPermission(user.role, fallbackPermission);

      if (!hasPerm) {
        return reply.code(403).send({
          ok: false,
          error: {
            code: "PERMISSION_DENIED",
            message: `Required permission: ${fallbackPermission}`,
          },
        });
      }
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Ownership middleware error");
      return reply.code(500).send({ error: "Failed to verify resource ownership" });
    }
  };
}

/**
 * Context-aware permission middleware
 * Checks permissions based on request context (e.g., project ID)
 */
export function requireContextPermission(
  getContext: (request: FastifyRequest) => Promise<{ projectId?: string; userId?: string }>,
  permission: Permission
) {
  return async function contextPermissionMiddleware(request: FastifyRequest, reply: FastifyReply) {
    const user = resolveUser(request);
    if (!user) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    try {
      await getContext(request);
      const userRole = user.role;

      const rbacSvc = resolveRbacService(request);
      if (!rbacSvc) {
        return reply.code(500).send({ error: "RBAC service unavailable" });
      }

      // Check base permission
      const hasBasePermission = await rbacSvc.hasPermission(userRole, permission);

      if (!hasBasePermission) {
        return reply.code(403).send({
          ok: false,
          error: {
            code: "PERMISSION_DENIED",
            message: `Required permission: ${permission}`,
          },
        });
      }

      // Additional context-based checks could be added here
    } catch (error: unknown) {
      authLogger.error({ err: error }, "Context permission middleware error");
      return reply.code(500).send({ error: "Failed to verify permissions" });
    }
  };
}

/**
 * Rate limiting based on user role
 * Higher roles get higher rate limits
 */
export function roleBasedRateLimit() {
  return async function roleRateLimitMiddleware(request: FastifyRequest, reply: FastifyReply) {
    const user = resolveUser(request);
    if (!user) {
      return; // Skip rate limiting for unauthenticated users (handled by other middleware)
    }

    const rateLimits = {
      SUPER_ADMIN: { requests: 1000, window: 900 }, // 1000 req/15min
      ADMIN: { requests: 500, window: 900 }, // 500 req/15min
      SUPPORT: { requests: 200, window: 900 }, // 200 req/15min
    };

    const userLimit = rateLimits[user.role as keyof typeof rateLimits];

    if (userLimit) {
      reply.header("X-RateLimit-Limit", userLimit.requests.toString());
      reply.header("X-RateLimit-Window", userLimit.window.toString());
      reply.header("X-RateLimit-Role", user.role);
    }
  };
}

/**
 * Audit middleware that logs permission checks
 */
export function auditPermissionAccess(operation: string) {
  return async function auditMiddleware(request: FastifyRequest, reply: FastifyReply) {
    const user = resolveUser(request);
    if (!user) {
      return;
    }

    const auditData = {
      userId: user.id,
      userRole: user.role,
      operation,
      endpoint: request.url,
      method: request.method,
      timestamp: new Date(),
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    };

    authLogger.info({ auditData }, "Permission access audit");

    reply.header("X-Audit-Trail-Id", `audit_${Date.now()}_${user.id}`);
  };
}

/**
 * Development helper: Log user permissions for debugging
 */
export function debugPermissions() {
  return async function debugMiddleware(request: FastifyRequest, _reply: FastifyReply) {
    const user = resolveUser(request);
    if (process.env.NODE_ENV === "development" && user) {
      const rbacSvc = resolveRbacService(request);
      if (rbacSvc) {
        const userPermissions = await rbacSvc.getUserPermissions(user.id, user.role);
        authLogger.debug(
          {
            email: user.email,
            role: user.role,
            permissions: userPermissions.permissions,
          },
          "RBAC DEBUG: User permissions"
        );
      }
    }
  };
}
