/**
 * @file mfaRoutes.test.ts
 * @description Unit tests for mfaRoutes. Uses in-memory mocked Prisma stores
 *              and a real Fastify instance to test MFA HTTP endpoint behavior.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule } from "./helpers/mockPrisma.js";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const { mockPrisma, stores } = createMockPrismaModule();

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
});

vi.mock("../../src/admin/auth/adminAuthMiddleware.js", async () => {
  const { createAdminAuthMock } = await import("./helpers/mockAuthMiddleware.js");
  return createAdminAuthMock();
});

vi.mock("../../src/auth/customerAuthMiddleware.js", async () => {
  const { createCustomerAuthMock } = await import("./helpers/mockAuthMiddleware.js");
  return createCustomerAuthMock();
});

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

// ---------------------------------------------------------------------------
// Import SUT after mocks are in place
// ---------------------------------------------------------------------------

const Fastify = (await import("fastify")).default;
const { serializerCompiler, validatorCompiler } = await import("fastify-type-provider-zod");
const { mfaRoutes } = await import("../../src/auth/mfaRoutes.js");
const { AuthService, setRedisInstance } = await import("../../src/auth/authService.js");
const { MfaService } = await import("../../src/auth/mfaService.js");
const { auditService } = await import("../../src/audit/auditService.js");
const { PrismaAdminUserRepository } =
  await import("../../src/infrastructure/repositories/PrismaAdminUserRepository.js");
const { Container } = await import("../../src/infrastructure/container/Container.js");
const { TOKENS } = await import("../../src/infrastructure/container/types.js");
const { RbacService } = await import("../../src/auth/rbacService.js");

// ---------------------------------------------------------------------------
// Shared service instances
// ---------------------------------------------------------------------------

setRedisInstance(null as unknown as import("ioredis").default);

const adminUserRepo = new PrismaAdminUserRepository(mockPrisma.prisma as never);
const mfaService = new MfaService(adminUserRepo);
const authService = new AuthService(mockPrisma.prisma, adminUserRepo, mfaService);

async function createTestApp() {
  const app = Fastify({ logger: false });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const container = new Container();
  container.registerInstance(TOKENS.AuthService, authService);
  container.registerInstance(TOKENS.MfaService, mfaService);
  container.registerInstance(TOKENS.AuditService, auditService);
  container.registerInstance(TOKENS.RbacService, new RbacService(adminUserRepo));
  app.decorate("container", container);

  await app.register(mfaRoutes);

  return app;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const timestamp = Date.now();
const userEmail = `user-mfa-${timestamp}@example.com`;
const adminEmail = `admin-mfa-${timestamp}@example.com`;
const testPassword = "TestPassword123!";

let app: ReturnType<typeof Fastify>;
let userToken: string;
let adminToken: string;
let userId: string;
let _adminUserId: string;
let _mfaSecret: string;
let _backupCodes: string[];

describe("mfaRoutes Unit Tests", () => {
  beforeAll(async () => {
    stores.adminUser.clear();
    stores.adminSession.clear();
    stores.auditLog.clear();

    app = await createTestApp();

    // Create regular user
    const userResult = await authService.registerAdmin(
      userEmail,
      testPassword,
      "MFA User",
      "ADMIN"
    );
    if (userResult.ok) {
      userId = userResult.value.id;
    }

    // Create admin user
    const adminResult = await authService.registerAdmin(
      adminEmail,
      testPassword,
      "MFA Admin",
      "ADMIN"
    );
    if (adminResult.ok) {
      _adminUserId = adminResult.value.id;
    }

    // Login to get tokens
    const userLogin = await authService.login(
      { email: userEmail, password: testPassword },
      "127.0.0.1",
      "test-agent"
    );
    if (userLogin.ok && "tokens" in userLogin.value) {
      userToken = userLogin.value.tokens.accessToken;
    }

    const adminLogin = await authService.login(
      { email: adminEmail, password: testPassword },
      "127.0.0.1",
      "test-agent"
    );
    if (adminLogin.ok && "tokens" in adminLogin.value) {
      adminToken = adminLogin.value.tokens.accessToken;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /auth/mfa/status", () => {
    it("should get MFA status for authenticated user", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/mfa/status",
        headers: { authorization: `Bearer ${userToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.mfa).toBeTruthy();
      expect(typeof body.data?.mfa?.enabled).toBe("boolean");
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/mfa/status",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /auth/mfa/setup", () => {
    it("should setup MFA for authenticated user", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/setup",
        headers: { authorization: `Bearer ${userToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.setup?.qrCodeUrl).toBeTruthy();
      expect(body.data?.setup?.manualEntryKey).toBeTruthy();
      expect(Array.isArray(body.data?.setup?.backupCodes)).toBeTruthy();
      expect(body.data?.setup?.backupCodes?.length).toBe(8);

      _mfaSecret = body.data?.setup?.manualEntryKey || "";
      _backupCodes = body.data?.setup?.backupCodes || [];
    });

    it("should reject duplicate setup", async () => {
      // First, enable MFA by verifying setup
      const setupResult = await mfaService.setupMfa(userId, userEmail);
      if (setupResult.ok) {
        const { authenticator } = await import("otplib");
        const token = authenticator.generate(setupResult.value.secret);
        await mfaService.verifyMfaSetup(userId, token);
      }

      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/setup",
        headers: { authorization: `Bearer ${userToken}` },
      });

      expect(response.statusCode).toBe(409);

      const body = JSON.parse(response.body);
      expect(body.error).toBe("MFA is already enabled for this user");

      // Cleanup - disable MFA for subsequent tests
      const user = stores.adminUser.all().find((u) => u.id === userId);
      if (user) {
        stores.adminUser.update(userId, { mfaEnabled: false, mfaSecret: null });
      }
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/setup",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /auth/mfa/verify-setup", () => {
    it("should reject invalid token format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/verify-setup",
        headers: { authorization: `Bearer ${userToken}` },
        payload: {
          token: "12345",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject without token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/verify-setup",
        headers: { authorization: `Bearer ${userToken}` },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/verify-setup",
        payload: {
          token: "123456",
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /auth/mfa/verify", () => {
    it("should reject invalid request body", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/verify",
        payload: {
          userId: "invalid-id",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject missing userId", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/verify",
        payload: {
          token: "123456",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject missing token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/verify",
        payload: {
          userId: userId,
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("POST /auth/mfa/disable", () => {
    it("should reject when MFA not enabled", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/disable",
        headers: { authorization: `Bearer ${userToken}` },
        payload: {
          token: "123456",
        },
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toBe("MFA is not enabled for this user");
    });

    it("should reject invalid token format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/disable",
        headers: { authorization: `Bearer ${userToken}` },
        payload: {
          token: "12",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/disable",
        payload: {
          token: "123456",
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /auth/mfa/regenerate-backup-codes", () => {
    it("should reject when MFA not enabled", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/regenerate-backup-codes",
        headers: { authorization: `Bearer ${userToken}` },
        payload: {
          token: "123456",
        },
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toBe("MFA is not enabled for this user");
    });

    it("should reject invalid token format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/regenerate-backup-codes",
        headers: { authorization: `Bearer ${userToken}` },
        payload: {
          token: "12",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/regenerate-backup-codes",
        payload: {
          token: "123456",
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /admin/users/:userId/mfa/status", () => {
    it("should get MFA status for any user as admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/users/${userId}/mfa/status`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.userId).toBeTruthy();
      expect(body.data?.mfa).toBeTruthy();
    });

    it("should reject invalid userId format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/users/invalid-id/mfa/status",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject non-existent user", async () => {
      const fakeId = "123e4567-e89b-12d3-a456-426614174000";
      const response = await app.inject({
        method: "GET",
        url: `/admin/users/${fakeId}/mfa/status`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/users/${userId}/mfa/status`,
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /admin/users/:userId/mfa/force-disable", () => {
    it("should reject without reason", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/users/${userId}/mfa/force-disable`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject reason too short", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/users/${userId}/mfa/force-disable`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reason: "short",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should force disable MFA with valid reason", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/users/${userId}/mfa/force-disable`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reason: "User requested MFA reset due to lost authenticator device",
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.message).toBeTruthy();
    });

    it("should reject invalid userId format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/users/invalid-id/mfa/force-disable",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reason: "Valid reason for MFA reset",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/users/${userId}/mfa/force-disable`,
        payload: {
          reason: "Valid reason for MFA reset",
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
