/**
 * @file auditRoutes.test.ts
 * @description Unit tests for auditRoutes. Uses in-memory mocked Prisma stores
 *              and a real Fastify instance with full DI container.
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
const { auditRoutes } = await import("../../src/audit/auditRoutes.js");
const { AuditService } = await import("../../src/audit/auditService.js");
const { setRedisInstance } = await import("../../src/auth/authService.js");

// AuditService is resolved from the container by the routes; this direct instance
// (same mock prisma store) is used by the test to seed audit rows.
const auditService = new AuditService(mockPrisma.prisma as never);
const { setupContainer } = await import("../../src/infrastructure/container/setup.js");
const { TOKENS } = await import("../../src/infrastructure/container/types.js");

type AuthServiceType = Awaited<
  ReturnType<typeof import("../../src/auth/authService.js")>
>["AuthService"];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

setRedisInstance(null as unknown as import("ioredis").default);

// Populated by createTestApp()
let containerAuthService: InstanceType<AuthServiceType>;

async function createTestApp() {
  const app = Fastify({ logger: false });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const container = setupContainer({ prisma: mockPrisma.prisma as never });
  containerAuthService = container.resolve(TOKENS.AuthService) as InstanceType<AuthServiceType>;

  app.decorate("container", container);

  await app.register(auditRoutes);

  return app;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const timestamp = Date.now();
const adminEmail = `admin-audit-${timestamp}@example.com`;
const superAdminEmail = `superadmin-audit-${timestamp}@example.com`;
const testPassword = "TestPassword123!";

let app: ReturnType<typeof Fastify>;
let adminToken: string;
let superAdminToken: string;
let adminUserId: string;
let _testLogId: string;

const CUSTOMER_USER_ID = "customer-audit-actor-001";
const CUSTOMER_EMAIL = "customer-audit@example.com";

describe("auditRoutes Unit Tests", () => {
  beforeAll(async () => {
    stores.adminUser.clear();
    stores.adminSession.clear();
    stores.auditLog.clear();
    stores.customerUser.clear();

    stores.customerUser.add({
      id: CUSTOMER_USER_ID,
      email: CUSTOMER_EMAIL,
      firstName: "Customer",
      lastName: "Actor",
    });

    app = await createTestApp();

    // Create admin user
    const adminResult = await containerAuthService.registerAdmin(
      adminEmail,
      testPassword,
      "Admin User",
      "ADMIN"
    );
    if (adminResult.ok) {
      adminUserId = adminResult.value.id;
    }

    // Create super admin user
    await containerAuthService.registerAdmin(
      superAdminEmail,
      testPassword,
      "Super Admin User",
      "SUPER_ADMIN"
    );

    // Login to get tokens
    const adminLogin = await containerAuthService.login(
      { email: adminEmail, password: testPassword },
      "127.0.0.1",
      "test-agent"
    );
    if (adminLogin.ok && "tokens" in adminLogin.value) {
      adminToken = adminLogin.value.tokens.accessToken;
    }

    const superAdminLogin = await containerAuthService.login(
      { email: superAdminEmail, password: testPassword },
      "127.0.0.1",
      "test-agent"
    );
    if (superAdminLogin.ok && "tokens" in superAdminLogin.value) {
      superAdminToken = superAdminLogin.value.tokens.accessToken;
    }

    // Create test audit logs
    await auditService.log({
      userId: adminUserId,
      action: "TEST_ACTION",
      resource: "TestResource",
      resourceId: "test-123",
      ipAddress: "127.0.0.1",
      userAgent: "test-agent",
      success: true,
    });

    // Customer-actor row — written by the customer-facing flows.
    await auditService.log({
      customerUserId: CUSTOMER_USER_ID,
      action: "CUSTOMER_MFA_ENABLED",
      resource: "CustomerUser",
      resourceId: CUSTOMER_USER_ID,
      ipAddress: "10.0.0.9",
      userAgent: "test-agent",
      success: true,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /admin/audit/logs", () => {
    it("should get audit logs with admin token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/logs",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data?.logs)).toBeTruthy();
    });

    it("should filter by userId", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/audit/logs?userId=${adminUserId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.filters?.userId).toBeTruthy();
    });

    it("should filter by action", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/logs?action=TEST_ACTION",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should filter by date range", async () => {
      const startDate = new Date(Date.now() - 86400000).toISOString();
      const endDate = new Date().toISOString();

      const response = await app.inject({
        method: "GET",
        url: `/admin/audit/logs?startDate=${startDate}&endDate=${endDate}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should paginate results", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/logs?limit=10&offset=0",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/logs",
      });

      expect(response.statusCode).toBe(401);
    });

    it("should reject invalid limit", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/logs?limit=2000",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /admin/audit/stats", () => {
    it("should get audit statistics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.stats).toBeTruthy();
    });

    it("should filter stats by userId", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/audit/stats?userId=${adminUserId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should filter stats by date range", async () => {
      const startDate = new Date(Date.now() - 86400000).toISOString();
      const endDate = new Date().toISOString();

      const response = await app.inject({
        method: "GET",
        url: `/admin/audit/stats?startDate=${startDate}&endDate=${endDate}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/stats",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /admin/audit/users/:userId/logs", () => {
    it("should get user audit logs", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/audit/users/${adminUserId}/logs`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data?.logs)).toBeTruthy();
    });

    it("should paginate user logs", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/audit/users/${adminUserId}/logs?limit=5&offset=0`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/audit/users/${adminUserId}/logs`,
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /admin/audit/resources/:resource/logs", () => {
    it("should get resource audit logs", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/resources/TestResource/logs",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data?.logs)).toBeTruthy();
    });

    it("should filter by resourceId", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/resources/TestResource/logs?resourceId=test-123",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/resources/TestResource/logs",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /admin/audit/logs", () => {
    it("should create manual audit log with super admin", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/audit/logs",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          action: "MANUAL_LOG",
          resource: "ManualResource",
          resourceId: "manual-123",
          success: true,
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(201);
      expect(body.ok).toBe(true);
      expect(body.data?.log).toBeTruthy();

      _testLogId = body.data?.log?.id;
    });

    it("should reject without super admin role", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/audit/logs",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          action: "MANUAL_LOG",
          success: true,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it("should create log with error details", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/audit/logs",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          action: "FAILED_ACTION",
          success: false,
          error: "Test error message",
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(201);
      expect(body.ok).toBe(true);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/audit/logs",
        payload: {
          action: "TEST",
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /admin/audit/cleanup", () => {
    it("should cleanup old audit logs with super admin", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/audit/cleanup",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          retentionDays: 90,
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(typeof body.data?.deletedCount === "number").toBeTruthy();
    });

    it("should reject without super admin role", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/audit/cleanup",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          retentionDays: 90,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it("should reject invalid retention days", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/audit/cleanup",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          retentionDays: 5000,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/audit/cleanup",
        payload: {
          retentionDays: 90,
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /admin/audit/my-logs", () => {
    it("should get current user logs", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/my-logs",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data?.logs)).toBeTruthy();
    });

    it("should paginate my logs", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/my-logs?limit=10&offset=0",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/my-logs",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /admin/audit/export", () => {
    it("should export audit logs as JSON with super admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/export?format=json",
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.export_date).toBeTruthy();
      expect(Array.isArray(body.logs)).toBeTruthy();
    });

    it("should export audit logs as CSV with super admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/export?format=csv",
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]?.toString().includes("text/csv")).toBeTruthy();
      expect(
        response.headers["content-disposition"]?.toString().includes("attachment")
      ).toBeTruthy();
      expect(response.body.includes("Timestamp")).toBeTruthy();
    });

    it("should export the customer actor identity in the CSV", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/export?format=csv",
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      expect(response.statusCode).toBe(200);

      const [header, ...rows] = response.body.split("\r\n");
      expect(header).toContain("Actor Type");
      expect(header).toContain("Customer Email");

      const customerRow = rows.find((row) => row.includes("CUSTOMER_MFA_ENABLED"));
      expect(customerRow).toBeTruthy();
      expect(customerRow).toContain("CUSTOMER");
      expect(customerRow).toContain(CUSTOMER_EMAIL);

      const adminRow = rows.find((row) => row.includes("TEST_ACTION"));
      expect(adminRow).toBeTruthy();
      expect(adminRow).toContain(adminEmail);
      expect(adminRow).toContain("ADMIN");
    });

    it("should report the customer actor in audit stats", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/stats",
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data.stats.topCustomerUsers).toEqual([
        { user: "Customer Actor", email: CUSTOMER_EMAIL, count: 1 },
      ]);
      expect(body.data.stats.byActorType.CUSTOMER).toBe(1);
    });

    it("should filter export by date range", async () => {
      const startDate = new Date(Date.now() - 86400000).toISOString();
      const endDate = new Date().toISOString();

      const response = await app.inject({
        method: "GET",
        url: `/admin/audit/export?format=json&startDate=${startDate}&endDate=${endDate}`,
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.filters).toBeTruthy();
    });

    it("should reject without super admin role", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/export",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/export",
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
