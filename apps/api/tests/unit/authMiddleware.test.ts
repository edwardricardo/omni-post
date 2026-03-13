/**
 * @file authMiddleware.test.ts
 * @description Unit tests for authMiddleware — authentication and authorization
 *              middleware functions. Uses in-memory mocks for Prisma and Redis,
 *              with real AuthService, JWT generation, and argon2 hashing.
 * @layer test
 */

import { describe, it, beforeAll, expect, vi } from "vitest";
import { createMockPrismaModule } from "./helpers/mockPrisma.js";
import { InMemoryAdminUserRepository } from "./helpers/InMemoryAdminUserRepository.js";
import { makeAdminUser } from "./helpers/factories.js";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { AuthenticatedUser } from "../../src/auth/authService.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";

// ---------------------------------------------------------------------------
// Mock setup — must happen before any SUT imports
// ---------------------------------------------------------------------------

const { mockPrisma, stores } = createMockPrismaModule();

// Patch adminUser.create to set DB-level defaults (isActive, mfaEnabled, etc.)
const originalUserCreate = mockPrisma.prisma.adminUser.create;
mockPrisma.prisma.adminUser.create = vi.fn(async (args: { data: Record<string, unknown> }) => {
  const dataWithDefaults = {
    isActive: true,
    mfaEnabled: false,
    mfaSecret: null,
    lastLoginAt: null,
    ...args.data,
  };
  return originalUserCreate({ data: dataWithDefaults });
});

// Patch adminSession.create to set DB-level defaults (isActive, revokedAt)
const originalSessionCreate = mockPrisma.prisma.adminSession.create;
mockPrisma.prisma.adminSession.create = vi.fn(async (args: { data: Record<string, unknown> }) => {
  const dataWithDefaults = {
    isActive: true,
    revokedAt: null,
    ...args.data,
  };
  return originalSessionCreate({ data: dataWithDefaults });
});

// Extend adminSession mock with updateMany (used by revokeAllSessions)
(mockPrisma.prisma.adminSession as Record<string, unknown>).updateMany = vi.fn(
  async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    const sessions = stores.adminSession.all().filter((s) => {
      return Object.entries(where).every(([k, v]) => s[k] === v);
    });
    let count = 0;
    for (const session of sessions) {
      const id = session.id as string;
      stores.adminSession.update(id, data);
      count++;
    }
    return { count };
  }
);

// Patch adminSession.findUnique to support `include: { user: true }`
// by joining the user from the adminUser store
const originalSessionFindUnique = mockPrisma.prisma.adminSession.findUnique;
mockPrisma.prisma.adminSession.findUnique = vi.fn(
  async (args: { where: Record<string, unknown>; include?: Record<string, boolean> }) => {
    const session = await originalSessionFindUnique(args);
    if (session && args.include?.user) {
      const userId = session.userId as string;
      const user = stores.adminUser.get(userId) ?? null;
      return { ...session, user };
    }
    return session;
  }
);

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
});

// Mock loggers to prevent real log output
vi.mock("../../src/lib/logger.js", () => {
  const noop = vi.fn();
  const noopLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => noopLogger,
  };
  return {
    logger: noopLogger,
    authLogger: noopLogger,
    createLogger: () => noopLogger,
  };
});

// Mock redisSessionHelpers — all Redis functions are no-ops
vi.mock("../../src/auth/redisSessionHelpers.js", () => ({
  getRedisInstance: vi.fn(() => undefined),
  setRedisInstance: vi.fn(),
  isTokenBlacklisted: vi.fn(async () => false),
  blacklistToken: vi.fn(async () => undefined),
  recordLoginAttempt: vi.fn(async () => undefined),
  getActiveSessionCount: vi.fn(async () => 0),
  storeSessionFingerprint: vi.fn(async () => undefined),
  getStoredFingerprint: vi.fn(async () => null),
  removeSessionFingerprint: vi.fn(async () => undefined),
  trackActiveSession: vi.fn(async () => undefined),
  deleteActiveSessionsKey: vi.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks are in place
// ---------------------------------------------------------------------------

const { authenticateMiddleware, requireRole, requireAdmin, requireSuperAdmin, optionalAuth } =
  await import("../../src/auth/authMiddleware.js");
const { AuthService } = await import("../../src/auth/authService.js");
const { MfaService } = await import("../../src/auth/mfaService.js");

// ---------------------------------------------------------------------------
// Service setup — uses InMemoryAdminUserRepository + real AuthService
// ---------------------------------------------------------------------------

const adminUserRepo = new InMemoryAdminUserRepository();
const mfaService = new MfaService(adminUserRepo);
const authService = new AuthService(adminUserRepo, mfaService);

// Minimal container mock that resolves AuthService
const mockContainer = {
  resolve: (token: symbol) => {
    if (token === TOKENS.AuthService) return authService;
    return null;
  },
};

// ---------------------------------------------------------------------------
// Sync helper — copies a prisma mock store record into the InMemoryAdminUserRepository
// ---------------------------------------------------------------------------

function syncPrismaUserToRepo(userId: string): void {
  const record = stores.adminUser.get(userId);
  if (!record) return;
  adminUserRepo.add(
    makeAdminUser({
      id: record.id as string,
      email: record.email as string,
      passwordHash: record.passwordHash as string,
      name: record.name as string,
      role: record.role as "SUPER_ADMIN" | "ADMIN" | "SUPPORT",
      isActive: (record.isActive as boolean) ?? true,
      emailVerified: (record.emailVerified as boolean) ?? true,
      lastLoginAt: (record.lastLoginAt as Date | null) ?? null,
      mfaEnabled: (record.mfaEnabled as boolean) ?? false,
      mfaSecret: (record.mfaSecret as string | null) ?? null,
      createdAt: (record.createdAt as Date) ?? new Date(),
      updatedAt: (record.updatedAt as Date) ?? new Date(),
    })
  );
}

/** Build an AuthenticatedUser for role/permission middleware tests */
function makeAuthUser(
  id: string,
  email: string,
  name: string,
  role: "SUPER_ADMIN" | "ADMIN" | "SUPPORT"
): AuthenticatedUser {
  return {
    id,
    email,
    name,
    role,
    isActive: true,
    emailVerified: true,
    mfaEnabled: false,
    lastLoginAt: null,
  };
}

// Mock Fastify Request — includes server.container so authMiddleware can resolve AuthService
function createMockRequest(overrides?: Partial<FastifyRequest>): FastifyRequest {
  return {
    headers: {},
    user: undefined,
    server: { container: mockContainer },
    ...overrides,
  } as unknown as FastifyRequest;
}

// Mock Fastify Reply - Pick<> documents what methods the SUT actually uses
interface MockReplyAccessors {
  getStatusCode: () => number;
  getBody: () => unknown;
  wasSent: () => boolean;
}

function createMockReply(): MockReplyAccessors & FastifyReply {
  let statusCode = 200;
  let responseBody: unknown = null;
  let replySent = false;

  const reply = {
    code(code: number) {
      statusCode = code;
      return reply;
    },
    send(body: unknown) {
      responseBody = body;
      replySent = true;
      return reply;
    },
    getStatusCode: () => statusCode,
    getBody: () => responseBody,
    wasSent: () => replySent,
  };

  return reply as unknown as MockReplyAccessors & FastifyReply;
}

const timestamp = Date.now();
const superAdminEmail = `test-superadmin-${timestamp}@example.com`;
const adminEmail = `test-admin-${timestamp}@example.com`;
const supportEmail = `test-support-${timestamp}@example.com`;
const testPassword = "TestPassword123!";

let superAdminId: string;
let adminId: string;
let supportId: string;
let superAdminToken: string;
let adminToken: string;
let supportToken: string;

describe("authMiddleware Tests", () => {
  beforeAll(async () => {
    // Clear all in-memory stores
    stores.adminUser.clear();
    stores.adminSession.clear();
    stores.auditLog.clear();
    adminUserRepo.clear();

    // Register test users — real AuthService with real argon2 + JWT, mocked prisma
    const superAdminResult = await authService.registerAdmin(
      superAdminEmail,
      testPassword,
      "Test Super Admin",
      "SUPER_ADMIN"
    );

    const adminResult = await authService.registerAdmin(
      adminEmail,
      testPassword,
      "Test Admin",
      "ADMIN"
    );

    const supportResult = await authService.registerAdmin(
      supportEmail,
      testPassword,
      "Test Support",
      "SUPPORT"
    );

    expect(superAdminResult.ok).toBe(true);
    expect(adminResult.ok).toBe(true);
    expect(supportResult.ok).toBe(true);

    superAdminId = superAdminResult.ok ? superAdminResult.value.id : "";
    adminId = adminResult.ok ? adminResult.value.id : "";
    supportId = supportResult.ok ? supportResult.value.id : "";

    // Sync the in-memory repo with the prisma mock store so that
    // both AuthServiceCore (uses repo) and AuthServiceSession (uses prisma)
    // see the same users
    syncPrismaUserToRepo(superAdminId);
    syncPrismaUserToRepo(adminId);
    syncPrismaUserToRepo(supportId);

    // Login to get valid tokens
    const superAdminLogin = await authService.login(
      { email: superAdminEmail, password: testPassword },
      "192.168.1.100",
      "TestAgent-SuperAdmin"
    );

    const adminLogin = await authService.login(
      { email: adminEmail, password: testPassword },
      "192.168.1.101",
      "TestAgent-Admin"
    );

    const supportLogin = await authService.login(
      { email: supportEmail, password: testPassword },
      "192.168.1.102",
      "TestAgent-Support"
    );

    expect(superAdminLogin.ok).toBe(true);
    expect(adminLogin.ok).toBe(true);
    expect(supportLogin.ok).toBe(true);

    superAdminToken =
      superAdminLogin.ok && "tokens" in superAdminLogin.value
        ? superAdminLogin.value.tokens.accessToken
        : "";
    adminToken =
      adminLogin.ok && "tokens" in adminLogin.value ? adminLogin.value.tokens.accessToken : "";
    supportToken =
      supportLogin.ok && "tokens" in supportLogin.value
        ? supportLogin.value.tokens.accessToken
        : "";
  });

  describe("authenticateMiddleware - Success Cases", () => {
    it("should accept valid token with Bearer prefix", async () => {
      const request = createMockRequest({
        headers: { authorization: `Bearer ${superAdminToken}` },
      });
      const reply = createMockReply();

      await authenticateMiddleware(request, reply);

      expect(reply.wasSent()).toBe(false);
      expect(request.user).not.toBe(undefined);
      expect(request.user?.email).toBe(superAdminEmail);
      expect(request.user?.role).toBe("SUPER_ADMIN");
    });

    it("should accept valid admin token", async () => {
      const request = createMockRequest({
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const reply = createMockReply();

      await authenticateMiddleware(request, reply);

      expect(reply.wasSent()).toBe(false);
      expect(request.user?.role).toBe("ADMIN");
    });

    it("should accept valid support token", async () => {
      const request = createMockRequest({
        headers: { authorization: `Bearer ${supportToken}` },
      });
      const reply = createMockReply();

      await authenticateMiddleware(request, reply);

      expect(reply.wasSent()).toBe(false);
      expect(request.user?.role).toBe("SUPPORT");
    });
  });

  describe("authenticateMiddleware - Failure Cases", () => {
    it("should reject when no Authorization header", async () => {
      const request = createMockRequest({ headers: {} });
      const reply = createMockReply();

      await authenticateMiddleware(request, reply);

      expect(reply.wasSent()).toBe(true);
      expect(reply.getStatusCode()).toBe(401);
      expect((reply.getBody() as Record<string, unknown>)?.error).toBe(
        "Authorization token required"
      );
    });

    it("should reject token without Bearer prefix", async () => {
      const request = createMockRequest({
        headers: { authorization: superAdminToken },
      });
      const reply = createMockReply();

      await authenticateMiddleware(request, reply);

      expect(reply.wasSent()).toBe(true);
      expect(reply.getStatusCode()).toBe(401);
    });

    it("should reject empty Bearer token", async () => {
      const request = createMockRequest({
        headers: { authorization: "Bearer " },
      });
      const reply = createMockReply();

      await authenticateMiddleware(request, reply);

      expect(reply.wasSent()).toBe(true);
      expect(reply.getStatusCode()).toBe(401);
    });

    it("should reject invalid token format", async () => {
      const request = createMockRequest({
        headers: { authorization: "Bearer invalid-token-format" },
      });
      const reply = createMockReply();

      await authenticateMiddleware(request, reply);

      expect(reply.wasSent()).toBe(true);
      expect(reply.getStatusCode()).toBe(401);
      expect((reply.getBody() as Record<string, unknown>)?.error).toBe("Invalid token");
    });

    it("should reject token from revoked session", async () => {
      // Create a new user and session, then revoke it
      const revokedUserEmail = `test-revoked-${timestamp}@example.com`;
      const revokedUserResult = await authService.registerAdmin(
        revokedUserEmail,
        testPassword,
        "Test Revoked User",
        "ADMIN"
      );

      expect(revokedUserResult.ok).toBe(true);

      const revokedUserId = revokedUserResult.ok ? revokedUserResult.value.id : "";

      // Sync to in-memory repo for login lookup
      syncPrismaUserToRepo(revokedUserId);

      const revokedLogin = await authService.login(
        { email: revokedUserEmail, password: testPassword },
        "192.168.1.200",
        "TestAgent-Revoked"
      );

      expect(revokedLogin.ok).toBe(true);

      const revokedToken =
        revokedLogin.ok && "tokens" in revokedLogin.value
          ? revokedLogin.value.tokens.accessToken
          : "";

      // Revoke all sessions
      await authService.revokeAllSessions(revokedUserId);

      const request = createMockRequest({
        headers: { authorization: `Bearer ${revokedToken}` },
      });
      const reply = createMockReply();

      await authenticateMiddleware(request, reply);

      expect(reply.wasSent()).toBe(true);
      expect(reply.getStatusCode()).toBe(401);
    });

    it("should reject token from inactive user", async () => {
      // Create a user and mark as inactive
      const inactiveUserEmail = `test-inactive-${timestamp}@example.com`;
      const inactiveUserResult = await authService.registerAdmin(
        inactiveUserEmail,
        testPassword,
        "Test Inactive User",
        "ADMIN"
      );

      expect(inactiveUserResult.ok).toBe(true);

      const inactiveUserId = inactiveUserResult.ok ? inactiveUserResult.value.id : "";

      // Sync to in-memory repo for login lookup
      syncPrismaUserToRepo(inactiveUserId);

      const inactiveLogin = await authService.login(
        { email: inactiveUserEmail, password: testPassword },
        "192.168.1.201",
        "TestAgent-Inactive"
      );

      expect(inactiveLogin.ok).toBe(true);

      const inactiveToken =
        inactiveLogin.ok && "tokens" in inactiveLogin.value
          ? inactiveLogin.value.tokens.accessToken
          : "";

      // Mark user as inactive in both stores
      stores.adminUser.update(inactiveUserId, { isActive: false });
      adminUserRepo.update(inactiveUserId, { isActive: false });

      const request = createMockRequest({
        headers: { authorization: `Bearer ${inactiveToken}` },
      });
      const reply = createMockReply();

      await authenticateMiddleware(request, reply);

      expect(reply.wasSent()).toBe(true);
      expect(reply.getStatusCode()).toBe(403);
      expect((reply.getBody() as Record<string, unknown>)?.error).toBe("Account is inactive");
    });
  });

  describe("requireRole - Success Cases", () => {
    it("should allow SUPER_ADMIN for SUPER_ADMIN role", async () => {
      const request = createMockRequest({
        user: makeAuthUser(superAdminId, superAdminEmail, "Test Super Admin", "SUPER_ADMIN"),
      });
      const reply = createMockReply();

      const middleware = requireRole("SUPER_ADMIN");
      await middleware(request, reply);

      expect(reply.wasSent()).toBe(false);
    });

    it("should allow ADMIN for ADMIN role", async () => {
      const request = createMockRequest({
        user: makeAuthUser(adminId, adminEmail, "Test Admin", "ADMIN"),
      });
      const reply = createMockReply();

      const middleware = requireRole("ADMIN");
      await middleware(request, reply);

      expect(reply.wasSent()).toBe(false);
    });

    it("should allow SUPPORT for SUPPORT role", async () => {
      const request = createMockRequest({
        user: makeAuthUser(supportId, supportEmail, "Test Support", "SUPPORT"),
      });
      const reply = createMockReply();

      const middleware = requireRole("SUPPORT");
      await middleware(request, reply);

      expect(reply.wasSent()).toBe(false);
    });

    it("should allow SUPER_ADMIN when multiple roles specified", async () => {
      const request = createMockRequest({
        user: makeAuthUser(superAdminId, superAdminEmail, "Test Super Admin", "SUPER_ADMIN"),
      });
      const reply = createMockReply();

      const middleware = requireRole("SUPER_ADMIN", "ADMIN");
      await middleware(request, reply);

      expect(reply.wasSent()).toBe(false);
    });

    it("should allow ADMIN when multiple roles specified", async () => {
      const request = createMockRequest({
        user: makeAuthUser(adminId, adminEmail, "Test Admin", "ADMIN"),
      });
      const reply = createMockReply();

      const middleware = requireRole("SUPER_ADMIN", "ADMIN", "SUPPORT");
      await middleware(request, reply);

      expect(reply.wasSent()).toBe(false);
    });
  });

  describe("requireRole - Failure Cases", () => {
    it("should reject when no user attached to request", async () => {
      const request = createMockRequest({ user: undefined });
      const reply = createMockReply();

      const middleware = requireRole("ADMIN");
      await middleware(request, reply);

      expect(reply.wasSent()).toBe(true);
      expect(reply.getStatusCode()).toBe(401);
      expect((reply.getBody() as Record<string, unknown>)?.error).toBe("Authentication required");
    });

    it("should reject user role not in allowed roles", async () => {
      const request = createMockRequest({
        user: makeAuthUser(supportId, supportEmail, "Test Support", "SUPPORT"),
      });
      const reply = createMockReply();

      const middleware = requireRole("SUPER_ADMIN", "ADMIN");
      await middleware(request, reply);

      expect(reply.wasSent()).toBe(true);
      expect(reply.getStatusCode()).toBe(403);
      expect((reply.getBody() as Record<string, unknown>)?.error).toBe("Insufficient permissions");
      expect((reply.getBody() as Record<string, unknown>)?.required).toStrictEqual([
        "SUPER_ADMIN",
        "ADMIN",
      ]);
      expect((reply.getBody() as Record<string, unknown>)?.current).toBe("SUPPORT");
    });

    it("should reject ADMIN for SUPER_ADMIN-only role", async () => {
      const request = createMockRequest({
        user: makeAuthUser(adminId, adminEmail, "Test Admin", "ADMIN"),
      });
      const reply = createMockReply();

      const middleware = requireRole("SUPER_ADMIN");
      await middleware(request, reply);

      expect(reply.wasSent()).toBe(true);
      expect(reply.getStatusCode()).toBe(403);
    });
  });

  describe("requireAdmin - Success Cases", () => {
    it("should allow ADMIN role", async () => {
      const request = createMockRequest({
        user: makeAuthUser(adminId, adminEmail, "Test Admin", "ADMIN"),
      });
      const reply = createMockReply();

      await requireAdmin(request, reply);

      expect(reply.wasSent()).toBe(false);
    });

    it("should allow SUPER_ADMIN role", async () => {
      const request = createMockRequest({
        user: makeAuthUser(superAdminId, superAdminEmail, "Test Super Admin", "SUPER_ADMIN"),
      });
      const reply = createMockReply();

      await requireAdmin(request, reply);

      expect(reply.wasSent()).toBe(false);
    });
  });

  describe("requireAdmin - Failure Cases", () => {
    it("should reject when no user attached", async () => {
      const request = createMockRequest({ user: undefined });
      const reply = createMockReply();

      await requireAdmin(request, reply);

      expect(reply.wasSent()).toBe(true);
      expect(reply.getStatusCode()).toBe(401);
      expect((reply.getBody() as Record<string, unknown>)?.error).toBe("Authentication required");
    });

    it("should reject SUPPORT user", async () => {
      const request = createMockRequest({
        user: makeAuthUser(supportId, supportEmail, "Test Support", "SUPPORT"),
      });
      const reply = createMockReply();

      await requireAdmin(request, reply);

      expect(reply.wasSent()).toBe(true);
      expect(reply.getStatusCode()).toBe(403);
      expect((reply.getBody() as Record<string, unknown>)?.error).toBe("Admin access required");
      expect((reply.getBody() as Record<string, unknown>)?.current).toBe("SUPPORT");
    });
  });

  describe("requireSuperAdmin - Success Cases", () => {
    it("should allow SUPER_ADMIN role", async () => {
      const request = createMockRequest({
        user: makeAuthUser(superAdminId, superAdminEmail, "Test Super Admin", "SUPER_ADMIN"),
      });
      const reply = createMockReply();

      await requireSuperAdmin(request, reply);

      expect(reply.wasSent()).toBe(false);
    });
  });

  describe("requireSuperAdmin - Failure Cases", () => {
    it("should reject when no user attached", async () => {
      const request = createMockRequest({ user: undefined });
      const reply = createMockReply();

      await requireSuperAdmin(request, reply);

      expect(reply.wasSent()).toBe(true);
      expect(reply.getStatusCode()).toBe(401);
      expect((reply.getBody() as Record<string, unknown>)?.error).toBe("Authentication required");
    });

    it("should reject ADMIN role", async () => {
      const request = createMockRequest({
        user: makeAuthUser(adminId, adminEmail, "Test Admin", "ADMIN"),
      });
      const reply = createMockReply();

      await requireSuperAdmin(request, reply);

      expect(reply.wasSent()).toBe(true);
      expect(reply.getStatusCode()).toBe(403);
      expect((reply.getBody() as Record<string, unknown>)?.error).toBe(
        "Super admin access required"
      );
      expect((reply.getBody() as Record<string, unknown>)?.current).toBe("ADMIN");
    });

    it("should reject SUPPORT role", async () => {
      const request = createMockRequest({
        user: makeAuthUser(supportId, supportEmail, "Test Support", "SUPPORT"),
      });
      const reply = createMockReply();

      await requireSuperAdmin(request, reply);

      expect(reply.wasSent()).toBe(true);
      expect(reply.getStatusCode()).toBe(403);
    });
  });

  describe("optionalAuth - Success Cases", () => {
    it("should attach user with valid token", async () => {
      const request = createMockRequest({
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const reply = createMockReply();

      await optionalAuth(request, reply);

      expect(reply.wasSent()).toBe(false);
      expect(request.user).not.toBe(undefined);
      expect(request.user?.email).toBe(adminEmail);
    });

    it("should continue without error when no token", async () => {
      const request = createMockRequest({ headers: {} });
      const reply = createMockReply();

      await optionalAuth(request, reply);

      expect(reply.wasSent()).toBe(false);
      expect(request.user).toBe(undefined);
    });

    it("should continue without error with invalid token", async () => {
      const request = createMockRequest({
        headers: { authorization: "Bearer invalid-token" },
      });
      const reply = createMockReply();

      await optionalAuth(request, reply);

      expect(reply.wasSent()).toBe(false);
      expect(request.user).toBe(undefined);
    });

    it("should continue without error without Bearer prefix", async () => {
      const request = createMockRequest({
        headers: { authorization: adminToken },
      });
      const reply = createMockReply();

      await optionalAuth(request, reply);

      expect(reply.wasSent()).toBe(false);
      expect(request.user).toBe(undefined);
    });

    it("should continue without error with empty Bearer token", async () => {
      const request = createMockRequest({
        headers: { authorization: "Bearer " },
      });
      const reply = createMockReply();

      await optionalAuth(request, reply);

      expect(reply.wasSent()).toBe(false);
      expect(request.user).toBe(undefined);
    });
  });
});
