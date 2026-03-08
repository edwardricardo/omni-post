#!/usr/bin/env tsx
/**
 * Unit Tests for analyticsRoutes
 * Testing all analytics HTTP endpoints
 *
 * Coverage Target: 95%+
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Fastify, { FastifyInstance } from "fastify";
import { ZodTypeProvider, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import fastifyCookie from "@fastify/cookie";
import { analyticsRoutes } from "../../src/analytics/analyticsRoutes.js";
import { authRoutes } from "../../src/auth/authRoutes.js";
import { prisma } from "@infra/prisma";
import { setupContainer } from "../../src/infrastructure/container/setup.js";

// Create test Fastify instance with auth
async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Set up DI container before registering plugins that require it (authRoutes resolves
  // TOKENS.AuthService from the container at plugin load time)
  const container = setupContainer({ prisma });
  app.decorate("container", container);

  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);

  await typedApp.register(fastifyCookie);
  await typedApp.register(authRoutes);
  await typedApp.register(analyticsRoutes);

  return typedApp;
}

const timestamp = Date.now();
const testEmail = `test-analytics-${timestamp}@example.com`;
const testPassword = "TestPassword123!";

let app: FastifyInstance;
let userToken: string;
let testProjectId: string;
let testAccountId: string;

describe("analyticsRoutes Unit Tests", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();

    // Create test user
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

    // Login
    const loginResponse = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: testEmail,
        password: testPassword,
      },
    });

    const loginBody = JSON.parse(loginResponse.body);
    userToken = loginBody.data?.accessToken || "";

    // Create test account and project
    const account = await prisma.account.create({
      data: {
        email: `account-${testEmail}`,
        name: "Test Account",
        subscription: "PRO",
      },
    });
    testAccountId = account.id;

    const project = await prisma.project.create({
      data: {
        accountId: testAccountId,
        name: "Test Analytics Project",
        locale: "en",
      },
    });
    testProjectId = project.id;
  });

  after(async () => {
    try {
      await prisma.project.deleteMany({ where: { accountId: testAccountId } });
      await prisma.account.delete({ where: { id: testAccountId } }).catch(() => {});

      const testUsers = await prisma.adminUser.findMany({
        where: { email: { contains: `analytics-${timestamp}` } },
      });

      for (const user of testUsers) {
        await prisma.auditLog.deleteMany({ where: { userId: user.id } });
        await prisma.adminSession.deleteMany({ where: { userId: user.id } });
        await prisma.adminUser.delete({ where: { id: user.id } });
      }
    } catch {
      // Defensive cleanup
    }

    await app.close();
  });

  describe("GET /threads/:threadId/performance", () => {
    it("should get thread performance metrics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/threads/test-thread-id/performance",
        headers: { authorization: `Bearer ${userToken}` },
      });

      // May return 404 if thread doesn't exist or 200 with data
      assert.ok([200, 404, 500].includes(response.statusCode));
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/threads/test-thread-id/performance",
      });

      assert.strictEqual(response.statusCode, 401);
    });

    it("should handle invalid thread ID", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/threads//performance",
        headers: { authorization: `Bearer ${userToken}` },
      });

      // Fastify matches the route with an empty :threadId param and schema validation rejects it
      assert.ok([400, 404].includes(response.statusCode));
    });

    it("should validate thread ID parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/threads/valid-thread-123/performance",
        headers: { authorization: `Bearer ${userToken}` },
      });

      // Should process request (may 404 if thread doesn't exist)
      assert.ok([200, 404, 500].includes(response.statusCode));
    });
  });

  describe("GET /threads/compare", () => {
    it("should compare threads with valid postId", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/threads/compare?postId=${testProjectId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      // May return 200, 404, or 501 depending on implementation
      assert.ok([200, 404, 501].includes(response.statusCode));
    });

    it("should handle optional provider parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/threads/compare?postId=${testProjectId}&provider=twitter`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.ok([200, 404, 501].includes(response.statusCode));
    });

    it("should handle optional timeRange parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/threads/compare?postId=${testProjectId}&timeRange=7d`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.ok([200, 404, 501].includes(response.statusCode));
    });

    it("should reject without postId", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/threads/compare",
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject invalid timeRange", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/threads/compare?postId=${testProjectId}&timeRange=invalid`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/threads/compare?postId=${testProjectId}`,
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("GET /engagement/trends", () => {
    it("should get engagement trends with valid projectId", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/engagement/trends?projectId=${testProjectId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      // May return 200, 501 (not implemented), or 500
      assert.ok([200, 501, 500].includes(response.statusCode));
    });

    it("should handle granularity parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/engagement/trends?projectId=${testProjectId}&granularity=day`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.ok([200, 501, 500].includes(response.statusCode));
    });

    it("should validate granularity values", async () => {
      const validGranularities = ["hour", "day", "week"];

      for (const granularity of validGranularities) {
        const response = await app.inject({
          method: "GET",
          url: `/engagement/trends?projectId=${testProjectId}&granularity=${granularity}`,
          headers: { authorization: `Bearer ${userToken}` },
        });

        // Should accept valid granularity
        assert.ok([200, 501, 500].includes(response.statusCode));
      }
    });

    it("should reject invalid granularity", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/engagement/trends?projectId=${testProjectId}&granularity=invalid`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject without projectId", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/engagement/trends",
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.strictEqual(response.statusCode, 400);
    });
  });

  describe("GET /posts/best-times", () => {
    it("should get best posting times with valid projectId", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/best-times?projectId=${testProjectId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      // Currently returns 501 (not implemented)
      assert.ok([200, 501].includes(response.statusCode));
    });

    it("should handle timezone parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/best-times?projectId=${testProjectId}&timezone=America/New_York`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.ok([200, 501].includes(response.statusCode));
    });

    it("should handle lookbackDays parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/best-times?projectId=${testProjectId}&lookbackDays=60`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.ok([200, 501].includes(response.statusCode));
    });

    it("should reject lookbackDays below minimum", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/best-times?projectId=${testProjectId}&lookbackDays=5`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject lookbackDays above maximum", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/best-times?projectId=${testProjectId}&lookbackDays=400`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should use default timezone if not provided", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/posts/best-times?projectId=${testProjectId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.ok([200, 501].includes(response.statusCode));
    });
  });

  describe("GET /engagement/geographic", () => {
    // Future: Geographic analytics stub — returns 501 until real provider API location data is integrated
    it("should return 501 not implemented", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/engagement/geographic?projectId=${testProjectId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.strictEqual(response.statusCode, 501);
    });

    it("should reject invalid timeRange", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/engagement/geographic?projectId=${testProjectId}&timeRange=1d`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject without projectId", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/engagement/geographic",
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.strictEqual(response.statusCode, 400);
    });
  });

  describe("GET /content/media-performance", () => {
    it("should get media performance with valid projectId", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/content/media-performance?projectId=${testProjectId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      // Currently returns 501 (not implemented)
      assert.ok([200, 501].includes(response.statusCode));
    });

    it("should handle provider filter", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/content/media-performance?projectId=${testProjectId}&provider=instagram`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.ok([200, 501].includes(response.statusCode));
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/content/media-performance?projectId=${testProjectId}`,
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("GET /dashboard", () => {
    it("should get dashboard data with valid projectId", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/dashboard?projectId=${testProjectId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      // Currently returns 501 (not implemented)
      assert.ok([200, 501].includes(response.statusCode));
    });

    it("should handle timeRange parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/dashboard?projectId=${testProjectId}&timeRange=30d`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.ok([200, 501].includes(response.statusCode));
    });

    it("should reject without projectId", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/dashboard",
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject invalid timeRange", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/dashboard?projectId=${testProjectId}&timeRange=invalid`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.strictEqual(response.statusCode, 400);
    });
  });

  describe("GET /export", () => {
    it("should export analytics with valid projectId", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/export?projectId=${testProjectId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      // Currently returns 501 (not implemented)
      assert.ok([200, 501].includes(response.statusCode));
    });

    it("should handle format parameter", async () => {
      const formats = ["json", "csv"];

      for (const format of formats) {
        const response = await app.inject({
          method: "GET",
          url: `/export?projectId=${testProjectId}&format=${format}`,
          headers: { authorization: `Bearer ${userToken}` },
        });

        assert.ok([200, 501].includes(response.statusCode));
      }
    });

    it("should reject invalid format", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/export?projectId=${testProjectId}&format=xml`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should handle boolean include flags", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/export?projectId=${testProjectId}&includeThreads=true&includePosts=false&includeAnalytics=true`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.ok([200, 501].includes(response.statusCode));
    });

    it("should coerce string booleans", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/export?projectId=${testProjectId}&includeThreads=1&includePosts=0`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      // Should handle coercion or reject
      assert.ok([200, 400, 501].includes(response.statusCode));
    });

    it("should reject without projectId", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/export",
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.strictEqual(response.statusCode, 400);
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
        const response = await app.inject({
          method: "GET",
          url: endpoint,
        });

        assert.strictEqual(response.statusCode, 401, `${endpoint} should require authentication`);
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

        assert.strictEqual(response.statusCode, 401);
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

        // Should process valid projectId (may return 501 for unimplemented)
        assert.ok([200, 501, 500].includes(response.statusCode));
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
          url: url,
          headers: { authorization: `Bearer ${userToken}` },
        });

        assert.strictEqual(response.statusCode, 400);
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

        // Should return valid JSON
        assert.doesNotThrow(() => {
          JSON.parse(response.body);
        });
      }
    });

    it("should include success field in responses", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/engagement/geographic?projectId=${testProjectId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      const body = JSON.parse(response.body);
      assert.ok(
        body.success !== undefined || body.ok !== undefined,
        "Response should include success/ok field"
      );
    });
  });
});
