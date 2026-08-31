/**
 * @file customerOrAdminAuth.ts
 * @description Fastify preHandler that authenticates EITHER a customer (owner) token OR an admin
 *   token, so one route can serve the "admin-or-owner" surface (the account/project restore
 *   endpoints). It delegates to the same verification primitives the two dedicated middlewares use
 *   — `verifyCustomerToken` (customer JWT) and `AdminAuthService.verifyAccessToken` (admin JWT) —
 *   rather than re-implementing token parsing. The two kinds use separate secrets and audiences, so
 *   a token can satisfy at most one: a customer token never verifies as admin and vice versa.
 *
 *   On a customer token it populates `request.customerUser` and binds the tenant context (exactly
 *   like `requireClientAuth`), so downstream tenant-guarded queries run scoped to that account. On
 *   an admin token it populates `request.auth` (like `requireAdminAuth`); the handler is then
 *   responsible for running any tenant-guarded work under `withSystemContext`, because admin auth
 *   binds no tenant scope. When neither verifies it replies 401 and the handler never runs.
 * @layer infrastructure
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyCustomerToken } from "./customerJwt.js";
import { enterTenantContext } from "../security/tenantContext.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { AdminAuthService } from "../admin/auth/AdminAuthService.js";
import { authLogger } from "../lib/logger.js";

/** Extract the bearer token from the Authorization header, or null. */
function extractBearerToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.substring(7);
  return token.length > 0 ? token : null;
}

/**
 * @function requireCustomerOrAdminAuth
 * @description Fastify preHandler that accepts a customer OR an admin bearer token. Tries the
 *   customer verifier first (the common self-service case), then the admin verifier. Sets
 *   `request.customerUser` + tenant context for a customer, `request.auth` for an admin, and
 *   replies 401 when neither verifies or the header is absent.
 */
export async function requireCustomerOrAdminAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = extractBearerToken(request);
  if (!token) {
    await reply.code(401).send({
      ok: false,
      error: { code: "INVALID_TOKEN", message: "Authorization token required" },
    });
    return;
  }

  // 1) Customer token (owner self-service). A signature/issuer/audience mismatch
  //    throws — that just means "not a customer token", so fall through to admin.
  try {
    const payload = verifyCustomerToken(token);
    request.customerUser = {
      id: payload.sub,
      accountId: payload.accountId,
      roleId: payload.roleId,
      roleName: payload.roleName,
      permissions: payload.permissions,
    };
    // Bind tenant context so downstream tenant-guarded queries (project restore)
    // run scoped to this account — same as requireClientAuth.
    enterTenantContext({ accountId: payload.accountId });
    return;
  } catch {
    // Not a customer token — try the admin path.
  }

  // 2) Admin token (support recovery). Resolve the same service requireAdminAuth
  //    uses; a failed verification is a real 401.
  const adminAuthService = request.server.container?.resolve<AdminAuthService>(
    TOKENS.AdminAuthService
  );
  if (adminAuthService) {
    const result = adminAuthService.verifyAccessToken(token);
    if (result.ok) {
      const payload = result.value;
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
        sessionId: "",
        ...(payload.deviceId && { deviceId: payload.deviceId }),
        ...(request.ip && { ipAddress: request.ip }),
        ...(request.headers["user-agent"] && { userAgent: request.headers["user-agent"] }),
      };
      return;
    }
  }

  authLogger.warn("customer-or-admin authentication failed for both token kinds");
  await reply.code(401).send({
    ok: false,
    error: { code: "INVALID_TOKEN", message: "Invalid or expired token" },
  });
}
