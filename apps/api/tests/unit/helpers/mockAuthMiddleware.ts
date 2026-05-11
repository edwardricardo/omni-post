/**
 * @file mockAuthMiddleware.ts
 * @description Shared mock factories for admin and customer auth middleware.
 *   These factories decode JWT tokens without verifying the signature, allowing
 *   tests that generate tokens via AuthService (JWT_SECRET) to pass through
 *   routes protected by requireAdminAuth (ADMIN_JWT_SECRET) or
 *   requireClientAuth (CUSTOMER_JWT_SECRET).
 * @layer infrastructure
 */

import type { FastifyRequest, FastifyReply } from "fastify";

interface DecodedToken {
  sub?: string;
  userId?: string;
  email?: string;
  name?: string;
  role?: string;
  roleId?: string;
  roleName?: string;
  permissions?: readonly string[];
  sessionId?: string;
  accountId?: string;
}

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  emailVerified: boolean;
  mfaEnabled: boolean;
  timezone: null;
  locale: null;
  department: null;
  team: null;
  lastLoginAt: null;
  createdAt: Date;
  updatedAt: Date;
}

interface AuthContext {
  user: AuthUser;
  sessionId: string;
}

function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ ok: false, error: { code, message } });
}

function extractAndDecode(request: FastifyRequest): DecodedToken | null {
  const auth = request.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;

  const token = auth.substring(7);
  if (!token) return null;

  // Decode without verifying signature — base64 decode the payload
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const payloadStr = Buffer.from(parts[1] as string, "base64url").toString("utf8");
    return JSON.parse(payloadStr) as DecodedToken;
  } catch {
    return null;
  }
}

function buildAuthContext(decoded: DecodedToken): AuthContext {
  return {
    user: {
      id: decoded.sub || decoded.userId || "",
      email: decoded.email || "",
      name: decoded.name || "Test",
      role: decoded.role || "ADMIN",
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
    sessionId: decoded.sessionId || "",
  };
}

/**
 * Returns a mock factory for `../../src/admin/auth/adminAuthMiddleware.js`.
 * Use with `vi.mock(path, () => createAdminAuthMock())`.
 */
export function createAdminAuthMock() {
  return {
    requireAdminAuth: async (request: FastifyRequest, reply: FastifyReply) => {
      const decoded = extractAndDecode(request);
      if (!decoded) {
        return sendError(reply, 401, "INVALID_TOKEN", "Authentication required");
      }
      const authContext = buildAuthContext(decoded);
      (request as Record<string, unknown>).auth = authContext;
      // Also set request.user for route handlers that read it via BaseRouteHandler
      (request as Record<string, unknown>).user = authContext.user;
    },
    requireSuperAdmin: async (request: FastifyRequest, reply: FastifyReply) => {
      let auth = (request as Record<string, unknown>).auth as AuthContext | undefined;
      if (!auth) {
        // Attempt to authenticate inline when used without requireAdminAuth
        const decoded = extractAndDecode(request);
        if (!decoded) {
          return sendError(reply, 401, "INVALID_TOKEN", "Authentication required");
        }
        auth = buildAuthContext(decoded);
        (request as Record<string, unknown>).auth = auth;
        (request as Record<string, unknown>).user = auth.user;
      }
      if (auth.user.role !== "SUPER_ADMIN") {
        return sendError(reply, 403, "PERMISSION_DENIED", "Super admin access required");
      }
    },
    requireAdmin: async (request: FastifyRequest, reply: FastifyReply) => {
      let auth = (request as Record<string, unknown>).auth as AuthContext | undefined;
      if (!auth) {
        const decoded = extractAndDecode(request);
        if (!decoded) {
          return sendError(reply, 401, "INVALID_TOKEN", "Authentication required");
        }
        auth = buildAuthContext(decoded);
        (request as Record<string, unknown>).auth = auth;
        (request as Record<string, unknown>).user = auth.user;
      }
      if (!["SUPER_ADMIN", "ADMIN"].includes(auth.user.role)) {
        return sendError(reply, 403, "PERMISSION_DENIED", "Admin access required");
      }
    },
    rateLimit: () => async () => {},
  };
}

/**
 * Returns a mock factory for `../../src/auth/customerAuthMiddleware.js`.
 * Use with `vi.mock(path, () => createCustomerAuthMock())`.
 */
export function createCustomerAuthMock() {
  return {
    requireClientAuth: async (request: FastifyRequest, reply: FastifyReply) => {
      const decoded = extractAndDecode(request);
      if (!decoded) {
        return sendError(reply, 401, "INVALID_TOKEN", "Authorization token required");
      }
      const roleName = decoded.roleName || decoded.role || "OWNER";
      const userPayload = {
        id: decoded.sub || decoded.userId || "",
        accountId: decoded.accountId || "",
        roleId: decoded.roleId || `role-${roleName.toLowerCase()}`,
        roleName,
        permissions: decoded.permissions ?? [],
      };
      (request as Record<string, unknown>).customerUser = userPayload;
      // Also set request.user for routes that read it via BaseRouteHandler.getUserContext
      (request as Record<string, unknown>).user = {
        ...userPayload,
        email: decoded.email || "",
        name: decoded.name || "Test User",
      };
    },
  };
}
