/**
 * @file auditMiddleware.ts
 * @description Fastify middleware that automatically logs audit events for
 *              authenticated requests, tracking actions, resources, and outcomes.
 * @layer infrastructure
 */
import { FastifyRequest, FastifyReply } from "fastify";
import { auditService, AuditActions, AuditResources as _AuditResources } from "./auditService.js";
import { createLogger } from "../lib/logger.js";

const auditLogger = createLogger("audit");

export interface AuditableRequest extends FastifyRequest {
  auditLog?: {
    action?: string;
    resource?: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    success?: boolean;
    error?: string;
  };
}

/**
 * Middleware to automatically log audit events for authenticated requests
 */
export async function auditMiddleware(request: AuditableRequest, reply: FastifyReply) {
  // Skip audit logging for certain routes
  const skipRoutes = [
    "/health",
    "/metrics",
    "/auth/me", // Too frequent
  ];

  if (skipRoutes.some((route) => request.url.startsWith(route))) {
    return;
  }

  // Add audit logging function to request
  request.auditLog = {};

  // Store audit info for later processing
  const originalEnd = reply.send;
  reply.send = function (payload) {
    try {
      const user = (request as unknown as Record<string, unknown>).user as
        | { id?: string }
        | undefined;
      const auditInfo = request.auditLog || {};

      // Determine action based on method and route if not explicitly set
      let action = auditInfo.action;
      if (!action) {
        action = getActionFromRequest(request);
      }

      // Skip if no action could be determined
      if (!action) {
        return originalEnd.call(this, payload);
      }

      // Determine if request was successful
      const success = auditInfo.success ?? (reply.statusCode >= 200 && reply.statusCode < 400);

      // Log the audit event asynchronously (non-blocking)
      setImmediate(async () => {
        try {
          await auditService.log({
            ...(user?.id ? { userId: user.id } : {}),
            action,
            ...(auditInfo.resource ? { resource: auditInfo.resource } : {}),
            ...(auditInfo.resourceId ? { resourceId: auditInfo.resourceId } : {}),
            details: {
              method: request.method,
              url: request.url,
              statusCode: reply.statusCode,
              ...auditInfo.details,
            },
            ipAddress: request.ip,
            ...(request.headers["user-agent"] ? { userAgent: request.headers["user-agent"] } : {}),
            success,
            ...(auditInfo.error ? { error: auditInfo.error } : {}),
          });
        } catch (_error: unknown) {
          // Don't fail the request if audit logging fails
          auditLogger.error({ err: _error }, "Audit logging failed");
        }
      });

      // Call the original send function
      return originalEnd.call(this, payload);
    } catch (_error) {
      // If audit logging setup fails, still call original send
      auditLogger.error({ err: _error }, "Audit middleware error");
      return originalEnd.call(this, payload);
    }
  };
}

/**
 * Helper function to determine action from request
 */
function getActionFromRequest(request: FastifyRequest): string | undefined {
  const { method, url } = request;
  const path = url.split("?")[0]; // Remove query parameters
  if (!path) return undefined;

  // Authentication routes
  if (path.startsWith("/auth/")) {
    if (path === "/auth/login") return method === "POST" ? AuditActions.LOGIN : undefined;
    if (path === "/auth/logout") return method === "POST" ? AuditActions.LOGOUT : undefined;
    if (path === "/auth/register") return method === "POST" ? AuditActions.USER_CREATED : undefined;
    if (path === "/auth/refresh") return method === "POST" ? AuditActions.TOKEN_REFRESH : undefined;
    if (path && path.includes("/revoke"))
      return method === "POST" ? AuditActions.SESSION_REVOKED : undefined;
  }

  // Admin routes
  if (path.startsWith("/admin/")) {
    if (path && path.includes("/cache/")) {
      if (method === "POST" && path.includes("flush")) return AuditActions.CACHE_CLEARED;
      if (method === "POST" && path.includes("invalidate")) return AuditActions.CACHE_CLEARED;
    }
    if (path && path.includes("/circuit-breakers/")) {
      if (method === "POST") return AuditActions.SYSTEM_CONFIG_CHANGED;
    }
    if (path && path.includes("/dead-letter-queue/")) {
      if (method === "POST") return AuditActions.SYSTEM_CONFIG_CHANGED;
    }
  }

  // Account management
  if (path.startsWith("/accounts")) {
    if (method === "POST" && !path.includes("/")) return AuditActions.ACCOUNT_CREATED;
    if (method === "PUT") return AuditActions.ACCOUNT_UPDATED;
    if (method === "DELETE") return AuditActions.ACCOUNT_DELETED;
  }

  // Project management
  if (path && path.includes("/projects")) {
    if (method === "POST") return AuditActions.PROJECT_CREATED;
    if (method === "PUT") return AuditActions.PROJECT_UPDATED;
    if (method === "DELETE") return AuditActions.PROJECT_DELETED;
  }

  // Content management
  if (path && path.startsWith("/posts")) {
    if (method === "POST" && !path.includes("/")) return AuditActions.POST_CREATED;
    if (method === "PUT") return AuditActions.POST_UPDATED;
    if (method === "DELETE") return AuditActions.POST_DELETED;
  }

  if (path && path.startsWith("/publish/")) {
    return AuditActions.POST_PUBLISHED;
  }

  // Default for unmatched admin routes
  if (path && path.startsWith("/admin/") && method !== "GET") {
    return AuditActions.SYSTEM_CONFIG_CHANGED;
  }

  return undefined;
}

/**
 * Helper function to set audit information for a request
 */
export function setAuditInfo(
  request: AuditableRequest,
  info: {
    action?: string;
    resource?: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    success?: boolean;
    error?: string;
  }
) {
  if (!request.auditLog) {
    request.auditLog = {};
  }
  Object.assign(request.auditLog, info);
}

/**
 * Helper function to extract resource ID from URL parameters
 */
export function extractResourceId(request: FastifyRequest, paramName = "id"): string | undefined {
  const params = request.params as Record<string, unknown>;
  const value = params?.[paramName];
  return typeof value === "string" ? value : undefined;
}
