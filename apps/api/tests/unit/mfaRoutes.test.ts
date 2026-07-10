/**
 * @file mfaRoutes.test.ts
 * @description Unit tests for mfaRoutes. Uses in-memory mocked Prisma stores
 *              and a real Fastify instance to test MFA HTTP endpoint behavior.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { randomUUID } from "crypto";
import { authenticator } from "otplib";
import { MFA_SUBJECT_TYPE } from "@ports/core";
import { createMockPrismaModule } from "./helpers/mockPrisma.js";
import { InMemoryAuditLogRepository } from "./helpers/InMemoryAuditLogRepository.js";
import { InMemoryMfaUserRepository } from "./helpers/InMemoryMfaUserRepository.js";

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
const { MfaService } = await import("../../src/admin/auth/MfaService.js");
const { PrismaAdminMfaUserRepository } =
  await import("../../src/infrastructure/adapters/PrismaAdminMfaUserRepository.js");
const { AuditService } = await import("../../src/audit/auditService.js");
const { PrismaAdminUserRepository } =
  await import("../../src/infrastructure/repositories/PrismaAdminUserRepository.js");
const { PrismaRoleRepository } =
  await import("../../src/infrastructure/repositories/PrismaRoleRepository.js");
const { PrismaAdminSessionRepository } =
  await import("../../src/infrastructure/repositories/PrismaAdminSessionRepository.js");
const { Container } = await import("../../src/infrastructure/container/Container.js");
const { TOKENS } = await import("../../src/infrastructure/container/types.js");
const { RbacService } = await import("../../src/auth/rbacService.js");
const { signCustomerAccessToken } = await import("../../src/auth/customerJwt.js");

// ---------------------------------------------------------------------------
// Shared service instances
// ---------------------------------------------------------------------------

setRedisInstance(null as unknown as import("ioredis").default);

const auditService = new AuditService(mockPrisma.prisma as never);
const adminUserRepo = new PrismaAdminUserRepository(mockPrisma.prisma as never);
const roleRepo = new PrismaRoleRepository(mockPrisma.prisma as never);
const sessionRepo = new PrismaAdminSessionRepository(mockPrisma.prisma as never);
// Unified MFA service — admin subjects over the Prisma-backed AdminUser adapter
// (mock store); customer subjects over an in-memory port double, since the
// mockPrisma helper carries no `customerUser` store (mfa-consolidation PR2).
const adminMfaRepo = new PrismaAdminMfaUserRepository(mockPrisma.prisma as never);
const customerMfaRepo = new InMemoryMfaUserRepository();
const mfaService = new MfaService(adminMfaRepo, customerMfaRepo, new InMemoryAuditLogRepository());
const authService = new AuthService(
  mockPrisma.prisma,
  adminUserRepo,
  mfaService,
  roleRepo,
  sessionRepo,
  new InMemoryAuditLogRepository()
);

async function createTestApp() {
  const app = Fastify({ logger: false });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const container = new Container();
  container.registerInstance(TOKENS.AuthService, authService);
  container.registerInstance(TOKENS.MfaService, mfaService);
  container.registerInstance(TOKENS.AuditService, auditService);
  container.registerInstance(
    TOKENS.RbacService,
    new RbacService(adminUserRepo, roleRepo, new InMemoryAuditLogRepository())
  );
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
const customerEmail = `customer-mfa-${timestamp}@example.com`;
const testPassword = "TestPassword123!";

let app: ReturnType<typeof Fastify>;
let adminToken: string;
let customerToken: string;
let userId: string;
let _adminUserId: string;
let customerId: string;
const customerAccountId = `account-mfa-${timestamp}`;
let _mfaSecret: string;
let _backupCodes: string[];

/** Reset the seeded customer row to its unenrolled baseline. */
function reseedCustomer(): void {
  customerMfaRepo.seed({ id: customerId, email: customerEmail, accountId: customerAccountId });
}

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

    // Login to get the admin token (the "regular user" registered above is
    // only a target id for the admin-over-AdminUser routes now — the 5
    // self-service routes run under the customer subject instead).
    const adminLogin = await authService.login(
      { email: adminEmail, password: testPassword },
      "127.0.0.1",
      "test-agent"
    );
    if (adminLogin.ok && "tokens" in adminLogin.value) {
      adminToken = adminLogin.value.tokens.accessToken;
    }

    // Seed a customer subject (in-memory port double — mockPrisma has no
    // customerUser store) and sign a real customer access token for it.
    // customerId is a real UUID: the force-disable route validates its
    // `:userId` param through the shared IdSchema (z.string().uuid()).
    customerId = randomUUID();
    reseedCustomer();
    customerToken = signCustomerAccessToken({
      sub: customerId,
      accountId: customerAccountId,
      roleId: "role-owner",
      roleName: "OWNER",
      permissions: [],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /auth/mfa/status", () => {
    it("should get MFA status for authenticated customer", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/mfa/status",
        headers: { authorization: `Bearer ${customerToken}` },
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
    it("should setup MFA for authenticated customer", async () => {
      const keyuriSpy = vi.spyOn(authenticator, "keyuri");

      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/setup",
        headers: { authorization: `Bearer ${customerToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.setup?.qrCodeUrl).toBeTruthy();
      expect(body.data?.setup?.manualEntryKey).toBeTruthy();
      expect(Array.isArray(body.data?.setup?.backupCodes)).toBeTruthy();
      expect(body.data?.setup?.backupCodes?.length).toBe(8);

      // userEmail anchor: the TOTP key URI label is the customer's real email
      // (derived from MfaUserRecord.email inside MfaService.setupMfa), never
      // the customer id (the mfaRoutes.ts:99 bug this fixes).
      expect(keyuriSpy).toHaveBeenCalledWith(customerEmail, expect.any(String), expect.any(String));
      keyuriSpy.mockRestore();

      _mfaSecret = body.data?.setup?.manualEntryKey || "";
      _backupCodes = body.data?.setup?.backupCodes || [];

      reseedCustomer();
    });

    it("should reject duplicate setup", async () => {
      // First, enable MFA by verifying setup
      const setupResult = await mfaService.setupMfa({
        type: MFA_SUBJECT_TYPE.CUSTOMER,
        id: customerId,
      });
      if (setupResult.ok) {
        const token = authenticator.generate(setupResult.value.secret);
        await mfaService.verifyMfaSetup({ type: MFA_SUBJECT_TYPE.CUSTOMER, id: customerId }, token);
      }

      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/setup",
        headers: { authorization: `Bearer ${customerToken}` },
      });

      expect(response.statusCode).toBe(409);

      const body = JSON.parse(response.body);
      expect(body.error).toBe("MFA is already enabled for this user");

      // Cleanup - reset the customer row for subsequent tests
      reseedCustomer();
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
        headers: { authorization: `Bearer ${customerToken}` },
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
        headers: { authorization: `Bearer ${customerToken}` },
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
        headers: { authorization: `Bearer ${customerToken}` },
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
        headers: { authorization: `Bearer ${customerToken}` },
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
        headers: { authorization: `Bearer ${customerToken}` },
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
        headers: { authorization: `Bearer ${customerToken}` },
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

  describe("POST /admin/customers/:userId/mfa/force-disable", () => {
    it("should reject without reason", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/customers/${customerId}/mfa/force-disable`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject reason too short", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/customers/${customerId}/mfa/force-disable`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reason: "short",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should force disable MFA for the customer and never touch AdminUser", async () => {
      // Re-enroll the customer so there is real MFA state to clear.
      const setupResult = await mfaService.setupMfa({
        type: MFA_SUBJECT_TYPE.CUSTOMER,
        id: customerId,
      });
      expect(setupResult.ok).toBe(true);
      if (setupResult.ok) {
        const token = authenticator.generate(setupResult.value.secret);
        await mfaService.verifyMfaSetup({ type: MFA_SUBJECT_TYPE.CUSTOMER, id: customerId }, token);
      }
      const adminRowBefore = stores.adminUser.all().find((u) => u.id === userId);

      const response = await app.inject({
        method: "POST",
        url: `/admin/customers/${customerId}/mfa/force-disable`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reason: "Customer requested MFA reset due to lost authenticator device",
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.message).toBeTruthy();

      // Customer subject cleared, via the customer adapter — never AdminUser.
      const customerRow = customerMfaRepo.raw(customerId);
      expect(customerRow?.mfaEnabled).toBe(false);
      expect(customerRow?.mfaSecret).toBeNull();
      const adminRowAfter = stores.adminUser.all().find((u) => u.id === userId);
      expect(adminRowAfter).toEqual(adminRowBefore);

      reseedCustomer();
    });

    it("should reject invalid userId format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/customers/invalid-id/mfa/force-disable",
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
        url: `/admin/customers/${customerId}/mfa/force-disable`,
        payload: {
          reason: "Valid reason for MFA reset",
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
