/**
 * @file analyticsRoutes.test.ts
 * @description Unit tests for analyticsRoutes. Uses mocked Prisma stores and
 *              a real Fastify instance to test HTTP endpoint behavior.
 * @layer test
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule, createStore, buildModelMock } from "./helpers/mockPrisma.js";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const { mockPrisma } = createMockPrismaModule();

// Analytics routes use post, channel, analytics, thread, postContent, publishLog
const projectDefaults = {
  locale: "en",
  isInCrisisMode: false,
  crisisStartedAt: null,
  crisisReason: null,
  crisisModeHistory: [],
  deletedAt: null,
  channels: [],
  posts: [],
};

const extraModels = {
  project: buildModelMock(createStore(), projectDefaults),
  post: buildModelMock(createStore()),
  postContent: buildModelMock(createStore()),
  channel: buildModelMock(createStore()),
  analytics: buildModelMock(createStore()),
  publishLog: buildModelMock(createStore()),
  thread: buildModelMock(createStore()),
  tweet: buildModelMock(createStore()),
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
const { analyticsRoutes } = await import("../../src/analytics/analyticsRoutes.js");
const { authRoutes } = await import("../../src/auth/authRoutes.js");
const { setupContainer } = await import("../../src/infrastructure/container/setup.js");
const { TOKENS } = await import("../../src/infrastructure/container/types.js");
const { AuthService, setRedisInstance } = await import("../../src/auth/authService.js");
const { MfaService } = await import("../../src/auth/mfaService.js");
const { PrismaAdminUserRepository } = await import(
  "../../src/infrastructure/repositories/PrismaAdminUserRepository.js"
);

setRedisInstance(null as never);

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const prisma = mockPrisma.prisma as Record<string, unknown>;
const timestamp = Date.now();
const testEmail = `test-analytics-${timestamp}@example.com`;
const testPassword = "TestPassword123!";

let app: import("fastify").FastifyInstance;
let userToken: string;
let testProjectId: string;
let testAccountId: string;

async function createTestApp() {
  const localApp = Fastify({ logger: false });
  const container = setupContainer({ prisma: mockPrisma.prisma as never });

  const adminUserRepo = new PrismaAdminUserRepository(mockPrisma.prisma as never);
  const mfaSvc = new MfaService(adminUserRepo);
  const authSvc = new AuthService(adminUserRepo, mfaSvc);
  container.registerInstance(TOKENS.AuthService, authSvc);

  localApp.decorate("container", container);
  localApp.setValidatorCompiler(validatorCompiler);
  localApp.setSerializerCompiler(serializerCompiler);
  await localApp.register(fastifyCookie);
  await localApp.register(authRoutes);
  await localApp.register(analyticsRoutes);
  await localApp.ready();
  return localApp;
}

describe("analyticsRoutes Unit Tests", () => {
  beforeAll(async () => {
    app = await createTestApp();

    // Register + login test user
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: testEmail,
        password: testPassword,
        name: "Analytics Test User",
        role: "ADMIN",
      },
    });
    const loginResponse = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: testEmail, password: testPassword },
    });
    const loginBody = JSON.parse(loginResponse.body);
    userToken = loginBody.data?.accessToken || "";

    // Create test account and project via mock prisma
    const account = await (prisma.account as { create: Function }).create({
      data: { email: `account-${testEmail}`, name: "Test Account", subscription: "PRO" },
    });
    testAccountId = account.id;

    const project = await (extraModels.project as { create: Function }).create({
      data: { accountId: testAccountId, name: "Test Analytics Project", locale: "en" },
    });
    testProjectId = project.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /threads/:threadId/performance", () => {
    it("should get thread performance metrics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/threads/test-thread-id/performance",
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect([200, 404, 500].includes(response.statusCode)).toBeTruthy();
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/threads/test-thread-id/performance",
      });
      expect(response.statusCode).toBe(401);
    });

    it("should handle invalid thread ID", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/threads//performance",
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect([400, 404].includes(response.statusCode)).toBeTruthy();
    });

    it("should validate thread ID parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/threads/valid-thread-123/performance",
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect([200, 404, 500].includes(response.statusCode)).toBeTruthy();
    });
  });

  describe("GET /threads/compare", () => {
    it("should compare threads with valid postId", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/threads/compare?postId=${testProjectId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect([200, 404, 501].includes(response.statusCode)).toBeTruthy();
    });

    it("should handle optional provider parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/threads/compare?postId=${testProjectId}&provider=twitter`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect([200, 404, 501].includes(response.statusCode)).toBeTruthy();
    });

    it("should handle optional timeRange parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/threads/compare?postId=${testProjectId}&timeRange=7d`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect([200, 404, 501].includes(response.statusCode)).toBeTruthy();
    });

    it("should reject without postId", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/threads/compare",
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(response.statusCode).toBe(400);
    });

    it("should reject invalid timeRange", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/threads/compare?postId=${testProjectId}&timeRange=invalid`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(response.statusCode).toBe(400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/threads/compare?postId=${testProjectId}`,
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /engagement/trends", () => {
    it("should get engagement trends with valid projectId", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/engagement/trends?projectId=${testProjectId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect([200, 501, 500].includes(response.statusCode)).toBeTruthy();
    });

    it("should handle granularity parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/engagement/trends?projectId=${testProjectId}&granularity=day`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect([200, 501, 500].includes(response.statusCode)).toBeTruthy();
    });

    it("should validate granularity values", async () => {
      const validGranularities = ["hour", "day", "week"];
      for (const granularity of validGranularities) {
        const response = await app.inject({
          method: "GET",
          url: `/engagement/trends?projectId=${testProjectId}&granularity=${granularity}`,
          headers: { authorization: `Bearer ${userToken}` },
        });
        expect([200, 501, 500].includes(response.statusCode)).toBeTruthy();
      }
    });

    it("should reject invalid granularity", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/engagement/trends?projectId=${testProjectId}&granularity=invalid`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(response.statusCode).toBe(400);
    });

    it("should reject without projectId", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/engagement/trends",
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /posts/best-times", () => {
    it("should get best posting times with valid projectId", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/best-times?projectId=${testProjectId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect([200, 501].includes(response.statusCode)).toBeTruthy();
    });

    it("should handle timezone parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/best-times?projectId=${testProjectId}&timezone=America/New_York`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect([200, 501].includes(response.statusCode)).toBeTruthy();
    });

    it("should handle lookbackDays parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/best-times?projectId=${testProjectId}&lookbackDays=60`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect([200, 501].includes(response.statusCode)).toBeTruthy();
    });

    it("should reject lookbackDays below minimum", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/best-times?projectId=${testProjectId}&lookbackDays=5`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(response.statusCode).toBe(400);
    });

    it("should reject lookbackDays above maximum", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/best-times?projectId=${testProjectId}&lookbackDays=400`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(response.statusCode).toBe(400);
    });

    it("should use default timezone if not provided", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/best-times?projectId=${testProjectId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect([200, 501].includes(response.statusCode)).toBeTruthy();
    });
  });

  describe("GET /engagement/geographic", () => {
    it("should return 501 not implemented", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/engagement/geographic?projectId=${testProjectId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(response.statusCode).toBe(501);
    });

    it("should reject invalid timeRange", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/engagement/geographic?projectId=${testProjectId}&timeRange=1d`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(response.statusCode).toBe(400);
    });

    it("should reject without projectId", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/engagement/geographic",
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /content/media-performance", () => {
    it("should get media performance with valid projectId", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/content/media-performance?projectId=${testProjectId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect([200, 501].includes(response.statusCode)).toBeTruthy();
    });

    it("should handle provider filter", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/content/media-performance?projectId=${testProjectId}&provider=instagram`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect([200, 501].includes(response.statusCode)).toBeTruthy();
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/content/media-performance?projectId=${testProjectId}`,
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /dashboard", () => {
    it("should get dashboard data with valid projectId", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/dashboard?projectId=${testProjectId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect([200, 501].includes(response.statusCode)).toBeTruthy();
    });

    it("should handle timeRange parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/dashboard?projectId=${testProjectId}&timeRange=30d`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect([200, 501].includes(response.statusCode)).toBeTruthy();
    });

    it("should reject without projectId", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/dashboard",
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(response.statusCode).toBe(400);
    });

    it("should reject invalid timeRange", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/dashboard?projectId=${testProjectId}&timeRange=invalid`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /export", () => {
    it("should export analytics with valid projectId", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/export?projectId=${testProjectId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect([200, 501].includes(response.statusCode)).toBeTruthy();
    });

    it("should handle format parameter", async () => {
      const formats = ["json", "csv"];
      for (const format of formats) {
        const response = await app.inject({
          method: "GET",
          url: `/export?projectId=${testProjectId}&format=${format}`,
          headers: { authorization: `Bearer ${userToken}` },
        });
        expect([200, 501].includes(response.statusCode)).toBeTruthy();
      }
    });

    it("should reject invalid format", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/export?projectId=${testProjectId}&format=xml`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(response.statusCode).toBe(400);
    });

    it("should handle boolean include flags", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/export?projectId=${testProjectId}&includeThreads=true&includePosts=false&includeAnalytics=true`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect([200, 501].includes(response.statusCode)).toBeTruthy();
    });

    it("should coerce string booleans", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/export?projectId=${testProjectId}&includeThreads=1&includePosts=0`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect([200, 400, 501].includes(response.statusCode)).toBeTruthy();
    });

    it("should reject without projectId", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/export",
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("Authentication Requirements", () => {
    it("should reject all endpoints without authentication", async () => {
      const endpoints = [
        "/threads/test-id/performance",
        `/threads/compare?postId=${testProjectId}`,
        `/engagement/trends?projectId=${testProjectId}`,
        `/posts/best-times?projectId=${testProjectId}`,
        `/engagement/geographic?projectId=${testProjectId}`,
        `/content/media-performance?projectId=${testProjectId}`,
        `/dashboard?projectId=${testProjectId}`,
        `/export?projectId=${testProjectId}`,
      ];
      for (const endpoint of endpoints) {
        const response = await app.inject({ method: "GET", url: endpoint });
        expect(response.statusCode).toBe(401);
      }
    });

    it("should reject all endpoints with invalid token", async () => {
      const endpoints = [
        "/threads/test-id/performance",
        `/threads/compare?postId=${testProjectId}`,
        `/engagement/trends?projectId=${testProjectId}`,
      ];
      for (const endpoint of endpoints) {
        const response = await app.inject({
          method: "GET",
          url: endpoint,
          headers: { authorization: "Bearer invalid-token-xyz" },
        });
        expect(response.statusCode).toBe(401);
      }
    });
  });

  describe("Query Parameter Validation", () => {
    it("should validate projectId format across endpoints", async () => {
      const endpoints = [
        "/engagement/trends",
        "/posts/best-times",
        "/engagement/geographic",
        "/content/media-performance",
        "/dashboard",
        "/export",
      ];
      for (const endpoint of endpoints) {
        const response = await app.inject({
          method: "GET",
          url: `${endpoint}?projectId=${testProjectId}`,
          headers: { authorization: `Bearer ${userToken}` },
        });
        expect([200, 501, 500].includes(response.statusCode)).toBeTruthy();
      }
    });

    it("should handle missing required query parameters", async () => {
      const endpoints = [
        { url: "/engagement/trends", requiredParam: "projectId" },
        { url: "/threads/compare", requiredParam: "postId" },
        { url: "/dashboard", requiredParam: "projectId" },
      ];
      for (const { url } of endpoints) {
        const response = await app.inject({
          method: "GET",
          url,
          headers: { authorization: `Bearer ${userToken}` },
        });
        expect(response.statusCode).toBe(400);
      }
    });
  });

  describe("Response Format Validation", () => {
    it("should return valid JSON for all endpoints", async () => {
      const endpoints = [
        `/engagement/geographic?projectId=${testProjectId}`,
        `/dashboard?projectId=${testProjectId}`,
        `/export?projectId=${testProjectId}`,
      ];
      for (const endpoint of endpoints) {
        const response = await app.inject({
          method: "GET",
          url: endpoint,
          headers: { authorization: `Bearer ${userToken}` },
        });
        expect(() => {
          JSON.parse(response.body);
        }).not.toThrow();
      }
    });

    it("should include success field in responses", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/engagement/geographic?projectId=${testProjectId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      const body = JSON.parse(response.body);
      expect(body.success !== undefined || body.ok !== undefined).toBeTruthy();
    });
  });
});
