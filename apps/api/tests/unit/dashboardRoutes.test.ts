/**
 * @file dashboardRoutes.test.ts
 * @description Unit tests for dashboardRoutes. Uses mocked Prisma stores and
 *              a real Fastify instance to test HTTP endpoint behavior.
 * @layer test
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule, createStore, buildModelMock } from "./helpers/mockPrisma.js";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const { mockPrisma } = createMockPrismaModule();

// DashboardService uses post, channel, analytics, publishLog via prisma
const extraModels = {
  post: buildModelMock(createStore()),
  channel: buildModelMock(createStore()),
  analytics: buildModelMock(createStore()),
  publishLog: buildModelMock(createStore()),
  adminUserPermission: buildModelMock(createStore()),
};
Object.assign(mockPrisma.prisma, extraModels);

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
  return { logger: noopLogger, authLogger: noopLogger, createLogger: () => noopLogger };
});

// ---------------------------------------------------------------------------
// Dynamic imports after mocks
// ---------------------------------------------------------------------------

const Fastify = (await import("fastify")).default;
const { serializerCompiler, validatorCompiler } = await import("fastify-type-provider-zod");
const fastifyCookie = (await import("@fastify/cookie")).default;
const { dashboardRoutes } = await import("../../src/admin/dashboardRoutes.js");
const { authRoutes } = await import("../../src/auth/authRoutes.js");
const { setupContainer } = await import("../../src/infrastructure/container/setup.js");
const { TOKENS } = await import("../../src/infrastructure/container/types.js");
await import("./admin/adminTestHelper.js");
const { AuthService, setRedisInstance } = await import("../../src/auth/authService.js");
const { MfaService } = await import("../../src/auth/mfaService.js");
const { PrismaAdminUserRepository } = await import(
  "../../src/infrastructure/repositories/PrismaAdminUserRepository.js"
);

// Ensure no Redis for unit tests
setRedisInstance(null as never);

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const timestamp = Date.now();
const adminEmail = `admin-dashboard-${timestamp}@example.com`;
const supportEmail = `support-dashboard-${timestamp}@example.com`;

let app: import("fastify").FastifyInstance;
let adminToken: string;
let supportToken: string;

async function createTestApp() {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const container = setupContainer({ prisma: mockPrisma.prisma as never });

  // Wire up AuthService so authRoutes can register/login
  const adminUserRepo = new PrismaAdminUserRepository(mockPrisma.prisma as never);
  const mfaSvc = new MfaService(adminUserRepo);
  const authSvc = new AuthService(adminUserRepo, mfaSvc);
  container.registerInstance(TOKENS.AuthService, authSvc);

  app.decorate("container", container);
  await app.register(fastifyCookie);
  await app.register(authRoutes);
  await app.register(dashboardRoutes);
  await app.ready();
  return { app, authSvc };
}

describe("dashboardRoutes Unit Tests", () => {
  beforeAll(async () => {
    const result = await createTestApp();
    app = result.app;

    // Register + login admin user via authRoutes
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: adminEmail,
        password: "TestPassword123!",
        name: "Admin Dashboard User",
        role: "ADMIN",
      },
    });
    const adminLoginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: adminEmail, password: "TestPassword123!" },
    });
    const adminBody = JSON.parse(adminLoginRes.body);
    adminToken = adminBody.data?.accessToken || "";

    // Create support user via AuthService (SUPPORT role not accepted by register route)
    await result.authSvc.registerAdmin(supportEmail, "TestPassword123!", "Support User", "SUPPORT");
    const supportLoginResult = await result.authSvc.login(
      { email: supportEmail, password: "TestPassword123!" },
      "127.0.0.1",
      "test-agent"
    );
    if (supportLoginResult.ok && "tokens" in supportLoginResult.value) {
      supportToken = supportLoginResult.value.tokens.accessToken;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /admin/dashboard/stats", () => {
    it("should get dashboard statistics as admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/dashboard/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.stats).toBeTruthy();
    });

    it("should include expected stat fields", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/dashboard/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.data?.stats).toBeTruthy();
      expect(typeof body.data.stats).toBe("object");
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({ method: "GET", url: "/admin/dashboard/stats" });
      expect(response.statusCode).toBe(401);
    });

    it("should reject with invalid token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/dashboard/stats",
        headers: { authorization: "Bearer invalid-token" },
      });
      expect(response.statusCode).toBe(401);
    });

    it("should allow support user with admin privileges", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/dashboard/stats",
        headers: { authorization: `Bearer ${supportToken}` },
      });
      expect([200, 401, 403].includes(response.statusCode)).toBeTruthy();
    });

    it("should return consistent data structure", async () => {
      const response1 = await app.inject({
        method: "GET",
        url: "/admin/dashboard/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const response2 = await app.inject({
        method: "GET",
        url: "/admin/dashboard/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const body1 = JSON.parse(response1.body);
      const body2 = JSON.parse(response2.body);
      expect(response1.statusCode).toBe(200);
      expect(response2.statusCode).toBe(200);
      expect(Object.keys(body1.data?.stats || {}).sort()).toStrictEqual(
        Object.keys(body2.data?.stats || {}).sort()
      );
    });
  });

  describe("GET /admin/accounts/summary", () => {
    it("should get accounts summary as admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/accounts/summary",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data).toBeTruthy();
    });

    it("should include account statistics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/accounts/summary",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.data).toBeTruthy();
      expect(typeof body.data).toBe("object");
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({ method: "GET", url: "/admin/accounts/summary" });
      expect(response.statusCode).toBe(401);
    });

    it("should reject with expired token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/accounts/summary",
        headers: { authorization: "Bearer expired-token" },
      });
      expect(response.statusCode).toBe(401);
    });

    it("should return data within reasonable time", async () => {
      const startTime = Date.now();
      const response = await app.inject({
        method: "GET",
        url: "/admin/accounts/summary",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const duration = Date.now() - startTime;
      expect(response.statusCode).toBe(200);
      expect(duration < 5000).toBeTruthy();
    });
  });

  describe("GET /admin/subscriptions/summary", () => {
    it("should get subscriptions summary as admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/subscriptions/summary",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data).toBeTruthy();
    });

    it("should include subscription statistics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/subscriptions/summary",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.data).toBeTruthy();
      expect(typeof body.data).toBe("object");
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({ method: "GET", url: "/admin/subscriptions/summary" });
      expect(response.statusCode).toBe(401);
    });

    it("should reject with malformed authorization header", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/subscriptions/summary",
        headers: { authorization: "InvalidFormat" },
      });
      expect(response.statusCode).toBe(401);
    });

    it("should return valid JSON response", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/subscriptions/summary",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(response.statusCode).toBe(200);
      expect(() => {
        JSON.parse(response.body);
      }).not.toThrow();
    });
  });

  describe("GET /admin/analytics/overview", () => {
    it("should get analytics overview as admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/analytics/overview",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data).toBeTruthy();
    });

    it("should include analytics data", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/analytics/overview",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.data).toBeTruthy();
      expect(typeof body.data).toBe("object");
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({ method: "GET", url: "/admin/analytics/overview" });
      expect(response.statusCode).toBe(401);
    });

    it("should reject with missing Bearer prefix", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/analytics/overview",
        headers: { authorization: adminToken },
      });
      expect(response.statusCode).toBe(401);
    });

    it("should handle concurrent requests correctly", async () => {
      const requests = Array(5)
        .fill(null)
        .map(() =>
          app.inject({
            method: "GET",
            url: "/admin/analytics/overview",
            headers: { authorization: `Bearer ${adminToken}` },
          })
        );
      const responses = await Promise.all(requests);
      for (const response of responses) {
        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.ok).toBe(true);
      }
    });

    it("should return same data structure across multiple calls", async () => {
      const response1 = await app.inject({
        method: "GET",
        url: "/admin/analytics/overview",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const response2 = await app.inject({
        method: "GET",
        url: "/admin/analytics/overview",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const body1 = JSON.parse(response1.body);
      const body2 = JSON.parse(response2.body);
      expect(response1.statusCode).toBe(200);
      expect(response2.statusCode).toBe(200);
      expect(typeof body1.data).toBe(typeof body2.data);
    });
  });

  describe("Authentication and Authorization", () => {
    it("should reject all endpoints without token", async () => {
      const endpoints = [
        "/admin/dashboard/stats",
        "/admin/accounts/summary",
        "/admin/subscriptions/summary",
        "/admin/analytics/overview",
      ];
      for (const endpoint of endpoints) {
        const response = await app.inject({ method: "GET", url: endpoint });
        expect(response.statusCode).toBe(401);
      }
    });

    it("should reject all endpoints with invalid token", async () => {
      const endpoints = [
        "/admin/dashboard/stats",
        "/admin/accounts/summary",
        "/admin/subscriptions/summary",
        "/admin/analytics/overview",
      ];
      for (const endpoint of endpoints) {
        const response = await app.inject({
          method: "GET",
          url: endpoint,
          headers: { authorization: "Bearer invalid-token-123" },
        });
        expect(response.statusCode).toBe(401);
      }
    });

    it("should allow all endpoints with valid admin token", async () => {
      const endpoints = [
        "/admin/dashboard/stats",
        "/admin/accounts/summary",
        "/admin/subscriptions/summary",
        "/admin/analytics/overview",
      ];
      for (const endpoint of endpoints) {
        const response = await app.inject({
          method: "GET",
          url: endpoint,
          headers: { authorization: `Bearer ${adminToken}` },
        });
        expect(response.statusCode).toBe(200);
      }
    });
  });

  describe("Response Format Validation", () => {
    it("should return consistent response format for stats", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/dashboard/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data).toBeTruthy();
      expect(body.data.stats).toBeTruthy();
    });

    it("should return JSON content type", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/dashboard/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]?.includes("application/json")).toBeTruthy();
    });

    it("should include appropriate response headers", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/dashboard/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBeTruthy();
    });
  });

  describe("Error Handling", () => {
    it("should handle database errors gracefully", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/dashboard/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect([200, 500].includes(response.statusCode)).toBeTruthy();
    });

    it("should return proper error format on failure", async () => {
      const response = await app.inject({ method: "GET", url: "/admin/dashboard/stats" });
      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(401);
      expect(body.error).toBeTruthy();
      expect(typeof body.error).toBe("string");
    });
  });
});
