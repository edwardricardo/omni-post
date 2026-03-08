#!/usr/bin/env tsx
/**
 * Unit Tests for optimizedPostsRoutes
 * Testing Phase 2 React 19 Server Components optimized API endpoints
 *
 * Coverage Target: 95%+
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import Fastify, { FastifyInstance } from "fastify";
import { registerOptimizedPostsRoutes } from "../../src/posts/optimizedPostsRoutes.js";
import { Container } from "../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import type { PostsService } from "../../src/posts/postsService.js";

const testAccountId = "123e4567-e89b-12d3-a456-426614174000";

// ─── Mock Types ─────────────────────────────────────────────────────
type MockPostsService = Pick<PostsService, "getOptimizedPosts" | "getDashboardStats" | "warmCache">;

function createMockPostsService(t: TestContext): MockPostsService {
  return {
    getOptimizedPosts: t.mock.fn(
      async (params: { accountId: string; page: number; limit: number; offset: number }) => {
        const total = 2;
        const totalPages = Math.ceil(total / params.limit);
        return {
          data: [
            {
              id: "post-1",
              title: "Test Post 1",
              body: null,
              status: "PUBLISHED" as const,
              createdAt: new Date("2025-01-01").toISOString(),
              scheduledAt: null,
              tags: [],
              channelCount: 2,
              totalViews: 150,
            },
            {
              id: "post-2",
              title: "Test Post 2",
              body: null,
              status: "DRAFT" as const,
              createdAt: new Date("2025-01-02").toISOString(),
              scheduledAt: new Date("2025-01-10").toISOString(),
              tags: [],
              channelCount: 1,
              totalViews: 0,
            },
          ],
          total,
          page: params.page,
          limit: params.limit,
          totalPages,
          cached: false,
          cacheLevel: "database",
        };
      }
    ),
    getDashboardStats: t.mock.fn(async (_accountId: string) => ({
      totalPosts: 10,
      publishedPosts: 5,
      scheduledPosts: 3,
      failedPosts: 2,
      totalChannels: 4,
      lastActivity: new Date("2025-01-01").toISOString(),
      avgPostViews: 125.5,
      cached: false,
      cacheLevel: "materialized-view",
    })),
    warmCache: t.mock.fn(async (_accountId: string) => ({
      success: true,
      message: "Cache warming completed",
      accountId: _accountId,
    })),
  };
}

let app: FastifyInstance;

describe("optimizedPostsRoutes Unit Tests", { concurrency: 1 }, () => {
  beforeEach(async (t) => {
    const mockPostsService = createMockPostsService(t);

    app = Fastify({ logger: false });

    // Wire DI container with mock PostsService BEFORE registering routes
    const container = new Container();
    container.registerInstance(TOKENS.PostsService, mockPostsService as unknown as PostsService);
    app.decorate("container", container);

    registerOptimizedPostsRoutes(app);

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/posts/optimized", () => {
    it("should return paginated posts with default parameters", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/posts/optimized?accountId=${testAccountId}`,
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data);
      assert.ok(Array.isArray(body.data.data));
      assert.strictEqual(body.data.page, 1);
      assert.strictEqual(body.data.limit, 20);
      assert.ok(typeof body.data.total === "number");
      assert.ok(typeof body.data.totalPages === "number");
      assert.ok(typeof body.data.cached === "boolean");
      assert.ok(body.data.cacheLevel);
    });

    it("should return paginated posts with custom page and limit", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/posts/optimized?accountId=${testAccountId}&page=2&limit=10`,
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.data.page, 2);
      assert.strictEqual(body.data.limit, 10);
    });

    it("should validate page parameter as positive integer", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/posts/optimized?accountId=${testAccountId}&page=0`,
      });

      assert.strictEqual(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, false);
    });

    it("should validate limit parameter as positive integer", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/posts/optimized?accountId=${testAccountId}&limit=-5`,
      });

      assert.strictEqual(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, false);
    });

    it("should enforce maximum limit (100)", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/posts/optimized?accountId=${testAccountId}&limit=150`,
      });

      assert.strictEqual(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, false);
    });

    it("should require accountId parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/posts/optimized",
      });

      assert.strictEqual(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, false);
    });

    it("should validate accountId as valid UUID", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/posts/optimized?accountId=invalid-uuid",
      });

      assert.strictEqual(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, false);
    });

    it("should return posts with correct structure", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/posts/optimized?accountId=${testAccountId}`,
      });

      const body = JSON.parse(response.body);
      const posts = body.data.data;

      assert.ok(posts.length > 0);
      const post = posts[0];
      assert.ok(post.id);
      assert.ok(typeof post.status === "string");
      assert.ok(post.createdAt);
      assert.ok(Array.isArray(post.tags));
      assert.ok(typeof post.channelCount === "number");
      assert.ok(typeof post.totalViews === "number");
    });

    it("should calculate correct totalPages", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/posts/optimized?accountId=${testAccountId}&limit=5`,
      });

      const body = JSON.parse(response.body);

      assert.ok(body.data.totalPages >= 1);
      assert.strictEqual(body.data.totalPages, Math.ceil(body.data.total / body.data.limit));
    });
  });

  describe("GET /api/dashboard/stats", () => {
    it("should return dashboard statistics", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/dashboard/stats?accountId=${testAccountId}`,
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data);
      assert.ok(typeof body.data.totalPosts === "number");
      assert.ok(typeof body.data.publishedPosts === "number");
      assert.ok(typeof body.data.scheduledPosts === "number");
      assert.ok(typeof body.data.failedPosts === "number");
      assert.ok(typeof body.data.totalChannels === "number");
      assert.ok(typeof body.data.avgPostViews === "number");
    });

    it("should require accountId parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/dashboard/stats",
      });

      assert.strictEqual(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, false);
    });

    it("should validate accountId as valid UUID", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/dashboard/stats?accountId=not-a-uuid",
      });

      assert.strictEqual(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, false);
    });

    it("should return stats with correct structure", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/dashboard/stats?accountId=${testAccountId}`,
      });

      const body = JSON.parse(response.body);
      const stats = body.data;

      assert.strictEqual(stats.totalPosts, 10);
      assert.strictEqual(stats.publishedPosts, 5);
      assert.strictEqual(stats.scheduledPosts, 3);
      assert.strictEqual(stats.failedPosts, 2);
      assert.strictEqual(stats.totalChannels, 4);
      assert.strictEqual(stats.avgPostViews, 125.5);
      assert.ok(typeof stats.cached === "boolean");
      assert.ok(stats.cacheLevel);
    });

    it("should include lastActivity timestamp", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/dashboard/stats?accountId=${testAccountId}`,
      });

      const body = JSON.parse(response.body);

      if (body.data.lastActivity !== null) {
        assert.ok(new Date(body.data.lastActivity).toISOString());
      }
    });
  });

  describe("POST /api/cache/warm/:accountId", () => {
    it("should warm cache for valid accountId", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/api/cache/warm/${testAccountId}`,
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.data.success, true);
      assert.strictEqual(body.data.message, "Cache warming completed");
      assert.strictEqual(body.data.accountId, testAccountId);
    });

    it("should validate accountId parameter", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/cache/warm/invalid-uuid",
      });

      assert.strictEqual(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, false);
    });
  });

  describe("Response Format", () => {
    it("should return consistent success response format", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/posts/optimized?accountId=${testAccountId}`,
      });

      const body = JSON.parse(response.body);

      assert.ok(body.ok);
      assert.ok(body.data);
      assert.strictEqual(typeof body.ok, "boolean");
    });

    it("should return consistent error response format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/posts/optimized?accountId=invalid",
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(body.ok, false);
      assert.ok(body.error);
      assert.strictEqual(typeof body.error, "string");
    });

    it("should include correct HTTP status codes", async () => {
      // Success case
      const successResponse = await app.inject({
        method: "GET",
        url: `/api/posts/optimized?accountId=${testAccountId}`,
      });
      assert.strictEqual(successResponse.statusCode, 200);

      // Validation error
      const validationResponse = await app.inject({
        method: "GET",
        url: "/api/posts/optimized",
      });
      assert.strictEqual(validationResponse.statusCode, 400);
    });
  });
});
