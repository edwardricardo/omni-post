/**
 * @file accountLifecycleRoutes.test.ts
 * @description Unit tests for accountLifecycleRoutes.
 *              Uses in-memory mocked Prisma stores — no real database needed.
 * @layer test
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule } from "./helpers/mockPrisma.js";

// ---------------------------------------------------------------------------
// Mock setup — must come BEFORE any SUT imports
// ---------------------------------------------------------------------------

const { mockPrisma } = createMockPrismaModule();

// Add adminUserPermission model (used by cleanup helper but not in default stores)
(mockPrisma.prisma as Record<string, unknown>).adminUserPermission = {
  deleteMany: vi.fn(async () => ({ count: 0 })),
};

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
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
// Import SUT after mocks
// ---------------------------------------------------------------------------

const Fastify = (await import("fastify")).default;
const { serializerCompiler, validatorCompiler } = await import("fastify-type-provider-zod");
const fastifyCookie = (await import("@fastify/cookie")).default;
const { accountLifecycleRoutes } = await import("../../src/admin/accountLifecycleRoutes.js");
const { setupContainer } = await import("../../src/infrastructure/container/setup.js");
const { createTestAdminUser, cleanupTestAdminUsersByEmail } =
  await import("./admin/adminTestHelper.js");

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);

  const container = setupContainer({ prisma: mockPrisma.prisma as never });
  typedApp.decorate("container", container);

  await typedApp.register(fastifyCookie);
  await typedApp.register(accountLifecycleRoutes);

  return typedApp;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

const timestamp = Date.now();
const superAdminEmail = `superadmin-lifecycle-${timestamp}@example.com`;
const adminEmail = `admin-lifecycle-${timestamp}@example.com`;
const supportEmail = `support-lifecycle-${timestamp}@example.com`;
const testPassword = "TestPassword123!";

let app: FastifyInstance;
let superAdminToken: string;
let adminToken: string;
let supportToken: string;
let testAccountId: string;

describe("accountLifecycleRoutes Unit Tests", () => {
  beforeAll(async () => {
    app = await createTestApp();

    // Create super admin user with valid admin JWT token
    const superAdminResult = await createTestAdminUser({
      email: superAdminEmail,
      name: "Super Admin",
      password: testPassword,
      role: "SUPER_ADMIN",
    });
    superAdminToken = superAdminResult.token;

    // Create admin user with valid admin JWT token
    const adminResult = await createTestAdminUser({
      email: adminEmail,
      name: "Admin User",
      password: testPassword,
      role: "ADMIN",
    });
    adminToken = adminResult.token;

    // Create support user (lacks account:manage permission)
    const supportResult = await createTestAdminUser({
      email: supportEmail,
      name: "Support User",
      password: testPassword,
      role: "SUPPORT",
    });
    supportToken = supportResult.token;
  });

  afterAll(async () => {
    try {
      await cleanupTestAdminUsersByEmail(`lifecycle-${timestamp}`);
      await cleanupTestAdminUsersByEmail(`support-lifecycle-${timestamp}`);
      await cleanupTestAdminUsersByEmail(`bulk1-${timestamp}`);
      await cleanupTestAdminUsersByEmail(`bulk2-${timestamp}`);
      await cleanupTestAdminUsersByEmail(`new-account-${timestamp}`);
      await cleanupTestAdminUsersByEmail(`removal-${timestamp}`);
    } catch (_err) {
      // cleanup best-effort
    }
    await app.close();
  });

  describe("POST /admin/accounts", () => {
    it("should create account as super admin", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/accounts",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          email: `new-account-${timestamp}@example.com`,
          password: testPassword,
          name: "New Admin Account",
          role: "ADMIN",
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(201);
      expect(body.ok).toBe(true);
      expect(body.data?.account?.id).toBeTruthy();
      expect(body.data?.account?.role).toBe("ADMIN");

      testAccountId = body.data?.account?.id || "";
    });

    it("should reject creation without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/accounts",
        payload: {
          email: `unauth-${timestamp}@example.com`,
          password: testPassword,
          name: "Unauthorized",
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should not allow admin role to create account with role assignment", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/accounts",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          email: `admin-create-${timestamp}@example.com`,
          password: testPassword,
          name: "Admin Created",
          role: "ADMIN",
        },
      });

      // Admin passes RBAC (has account:manage) but the handler rejects
      // role assignment for non-SUPER_ADMIN users (400 validation or 403)
      expect([400, 403].includes(response.statusCode)).toBeTruthy();
    });

    it("should reject duplicate email", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/accounts",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          email: `new-account-${timestamp}@example.com`,
          password: testPassword,
          name: "Duplicate",
        },
      });

      expect(response.statusCode).toBe(409);
    });

    it("should reject weak password", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/accounts",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          email: `weak-pw-${timestamp}@example.com`,
          password: "weak",
          name: "Weak Password",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject invalid email format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/accounts",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          email: "invalid-email",
          password: testPassword,
          name: "Invalid Email",
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /admin/accounts/:accountId", () => {
    it("should get account as admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/accounts/${testAccountId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.account?.id).toBe(testAccountId);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/accounts/${testAccountId}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it("should return 404 for non-existent account", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/accounts/a0000000-0000-4000-8000-000000000000",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /admin/accounts", () => {
    it("should list accounts with pagination", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/accounts?page=1&limit=10",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data?.accounts)).toBeTruthy();
      expect(body.data?.pagination).toBeTruthy();
      expect(body.data?.pagination?.page).toBe(1);
      expect(body.data?.pagination?.limit).toBe(10);
    });

    it("should filter accounts by role", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/accounts?role=ADMIN",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(Array.isArray(body.data?.accounts)).toBeTruthy();
    });

    it("should filter accounts by active status", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/accounts?isActive=true",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/accounts",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("PUT /admin/accounts/:accountId", () => {
    it("should update account name as admin", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/accounts/${testAccountId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: "Updated Name",
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data?.account?.name).toBe("Updated Name");
    });

    it("should update account role as super admin", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/accounts/${testAccountId}`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          role: "SUPPORT",
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data?.account?.role).toBe("SUPPORT");
    });

    it("should reject role change by admin (not super admin)", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/accounts/${testAccountId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          role: "ADMIN",
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it("should return 404 for non-existent account", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/admin/accounts/a0000000-0000-4000-8000-000000000000",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: "Updated",
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("POST /admin/accounts/:accountId/suspend", () => {
    it("should suspend account as admin", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/accounts/${testAccountId}/suspend`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reason: "Policy violation",
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should reject suspending already suspended account", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/accounts/${testAccountId}/suspend`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reason: "Already suspended",
        },
      });

      expect(response.statusCode).toBe(409);
    });

    it("should reject without reason", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/accounts/${testAccountId}/suspend`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("POST /admin/accounts/:accountId/reactivate", () => {
    it("should reactivate account as admin", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/accounts/${testAccountId}/reactivate`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should reject reactivating already active account", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/accounts/${testAccountId}/reactivate`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(409);
    });
  });

  describe("POST /admin/accounts/:accountId/reset-password", () => {
    it("should reset password as admin", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/accounts/${testAccountId}/reset-password`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          newPassword: "NewSecurePassword123!",
          requirePasswordChange: true,
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should reject weak new password", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/accounts/${testAccountId}/reset-password`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          newPassword: "weak",
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /admin/accounts/:accountId/sessions", () => {
    it("should get account sessions as admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/accounts/${testAccountId}/sessions`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(Array.isArray(body.data?.sessions)).toBeTruthy();
    });

    it("should return 404 for non-existent account", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/accounts/a0000000-0000-4000-8000-000000000000/sessions",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("POST /admin/accounts/:accountId/revoke-sessions", () => {
    it("should revoke all sessions as admin", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/accounts/${testAccountId}/revoke-sessions`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(typeof body.data?.revokedCount).toBe("number");
    });
  });

  describe("GET /admin/accounts/stats", () => {
    it("should get account statistics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/accounts/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data?.stats).toBeTruthy();
    });
  });

  describe("POST /admin/accounts/bulk/suspend", () => {
    let bulkAccountId1: string;
    let bulkAccountId2: string;

    beforeAll(async () => {
      // Create accounts for bulk operations
      const response1 = await app.inject({
        method: "POST",
        url: "/admin/accounts",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          email: `bulk1-${timestamp}@example.com`,
          password: testPassword,
          name: "Bulk 1",
        },
      });
      bulkAccountId1 = JSON.parse(response1.body).data?.account?.id || "";

      const response2 = await app.inject({
        method: "POST",
        url: "/admin/accounts",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          email: `bulk2-${timestamp}@example.com`,
          password: testPassword,
          name: "Bulk 2",
        },
      });
      bulkAccountId2 = JSON.parse(response2.body).data?.account?.id || "";
    });

    it("should bulk suspend accounts as super admin", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/accounts/bulk/suspend",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          accountIds: [bulkAccountId1, bulkAccountId2],
          reason: "Bulk suspension test",
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data?.successful).toBe(2);
    });

    it("should reject bulk suspend without account:manage permission", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/accounts/bulk/suspend",
        headers: { authorization: `Bearer ${supportToken}` },
        payload: {
          accountIds: [bulkAccountId1],
          reason: "Test",
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe("POST /admin/accounts/bulk/reactivate", () => {
    it("should bulk reactivate accounts as super admin", async () => {
      // Get suspended accounts from previous test
      const listResponse = await app.inject({
        method: "GET",
        url: "/admin/accounts?isActive=false",
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      const listBody = JSON.parse(listResponse.body);
      const suspendedIds = listBody.data?.accounts?.map((a: Record<string, unknown>) => a.id) || [];

      const response = await app.inject({
        method: "POST",
        url: "/admin/accounts/bulk/reactivate",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          accountIds: suspendedIds.slice(0, 2),
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(typeof body.data?.successful === "number").toBeTruthy();
    });
  });

  describe("DELETE /admin/accounts/:accountId", () => {
    let deleteAccountId: string;

    beforeAll(async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/accounts",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          email: `removal-${timestamp}@example.com`,
          password: testPassword,
          name: "To Remove",
        },
      });

      deleteAccountId = JSON.parse(response.body).data?.account?.id || "";
    });

    it("should delete account as super admin", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/admin/accounts/${deleteAccountId}`,
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should reject deletion without account:manage permission", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/admin/accounts/${testAccountId}`,
        headers: { authorization: `Bearer ${supportToken}` },
      });

      expect(response.statusCode).toBe(403);
    });
  });
});
