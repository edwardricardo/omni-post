#!/usr/bin/env tsx
/**
 * Unit Tests for optimizedPostsRoutes
 * Testing Phase 2 React 19 Server Components optimized API endpoints
 *
 * Coverage Target: 95%+
 */

import { describe, it, beforeEach, afterEach, vi, expect } from "vitest";

vi.mock("../../src/auth/authMiddleware.js", () => ({
  authenticateMiddleware: async () => {},
  requireAdmin: async () => {},
  requireSuperAdmin: async () => {},
  requireRole: () => async () => {},
  optionalAuth: async () => {},
}));

import Fastify, { FastifyInstance } from "fastify";
import { registerOptimizedPostsRoutes } from "../../src/posts/optimizedPostsRoutes.js";
import { Container } from "../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import type { PostsService } from "../../src/posts/postsService.js";

const testAccountId = "123e4567-e89b-12d3-a456-426614174000";

// ─── Mock Types ─────────────────────────────────────────────────────
type MockPostsService = Pick<PostsService, "getOptimizedPosts" | "getDashboardStats" | "warmCache">;

function createMockPostsService(): MockPostsService {
  return {
    getOptimizedPosts: vi.fn(
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
    getDashboardStats: vi.fn(async (_accountId: string) => ({
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
    warmCache: vi.fn(async (_accountId: string) => ({
      success: true,
      message: "Cache warming completed",
      accountId: _accountId,
    })),
  };
}

let app: FastifyInstance;

describe("optimizedPostsRoutes Unit Tests", () => {
  beforeEach(async (_t) => {
    const mockPostsService = createMockPostsService();

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

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data).toBeTruthy();
      expect(Array.isArray(body.data.data)).toBeTruthy();
      expect(body.data.page).toBe(1);
      expect(body.data.limit).toBe(20);
      expect(typeof body.data.total === "number").toBeTruthy();
      expect(typeof body.data.totalPages === "number").toBeTruthy();
      expect(typeof body.data.cached === "boolean").toBeTruthy();
      expect(body.data.cacheLevel).toBeTruthy();
    });

    it("should return paginated posts with custom page and limit", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/posts/optimized?accountId=${testAccountId}&page=2&limit=10`,
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.page).toBe(2);
      expect(body.data.limit).toBe(10);
    });

    it("should validate page parameter as positive integer", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/posts/optimized?accountId=${testAccountId}&page=0`,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
    });

    it("should validate limit parameter as positive integer", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/posts/optimized?accountId=${testAccountId}&limit=-5`,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
    });

    it("should enforce maximum limit (100)", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/posts/optimized?accountId=${testAccountId}&limit=150`,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
    });

    it("should require accountId parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/posts/optimized",
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
    });

    it("should validate accountId as valid UUID", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/posts/optimized?accountId=invalid-uuid",
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
    });

    it("should return posts with correct structure", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/posts/optimized?accountId=${testAccountId}`,
      });

      const body = JSON.parse(response.body);
      const posts = body.data.data;

      expect(posts.length > 0).toBeTruthy();
      const post = posts[0];
      expect(post.id).toBeTruthy();
      expect(typeof post.status === "string").toBeTruthy();
      expect(post.createdAt).toBeTruthy();
      expect(Array.isArray(post.tags)).toBeTruthy();
      expect(typeof post.channelCount === "number").toBeTruthy();
      expect(typeof post.totalViews === "number").toBeTruthy();
    });

    it("should calculate correct totalPages", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/posts/optimized?accountId=${testAccountId}&limit=5`,
      });

      const body = JSON.parse(response.body);

      expect(body.data.totalPages >= 1).toBeTruthy();
      expect(body.data.totalPages).toBe(Math.ceil(body.data.total / body.data.limit));
    });
  });

  describe("GET /api/dashboard/stats", () => {
    it("should return dashboard statistics", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/dashboard/stats?accountId=${testAccountId}`,
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data).toBeTruthy();
      expect(typeof body.data.totalPosts === "number").toBeTruthy();
      expect(typeof body.data.publishedPosts === "number").toBeTruthy();
      expect(typeof body.data.scheduledPosts === "number").toBeTruthy();
      expect(typeof body.data.failedPosts === "number").toBeTruthy();
      expect(typeof body.data.totalChannels === "number").toBeTruthy();
      expect(typeof body.data.avgPostViews === "number").toBeTruthy();
    });

    it("should require accountId parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/dashboard/stats",
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
    });

    it("should validate accountId as valid UUID", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/dashboard/stats?accountId=not-a-uuid",
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
    });

    it("should return stats with correct structure", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/dashboard/stats?accountId=${testAccountId}`,
      });

      const body = JSON.parse(response.body);
      const stats = body.data;

      expect(stats.totalPosts).toBe(10);
      expect(stats.publishedPosts).toBe(5);
      expect(stats.scheduledPosts).toBe(3);
      expect(stats.failedPosts).toBe(2);
      expect(stats.totalChannels).toBe(4);
      expect(stats.avgPostViews).toBe(125.5);
      expect(typeof stats.cached === "boolean").toBeTruthy();
      expect(stats.cacheLevel).toBeTruthy();
    });

    it("should include lastActivity timestamp", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/dashboard/stats?accountId=${testAccountId}`,
      });

      const body = JSON.parse(response.body);

      if (body.data.lastActivity !== null) {
        expect(new Date(body.data.lastActivity).toISOString()).toBeTruthy();
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

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.success).toBe(true);
      expect(body.data.message).toBe("Cache warming completed");
      expect(body.data.accountId).toBe(testAccountId);
    });

    it("should validate accountId parameter", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/cache/warm/invalid-uuid",
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
    });
  });

  describe("Response Format", () => {
    it("should return consistent success response format", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/posts/optimized?accountId=${testAccountId}`,
      });

      const body = JSON.parse(response.body);

      expect(body.ok).toBeTruthy();
      expect(body.data).toBeTruthy();
      expect(typeof body.ok).toBe("boolean");
    });

    it("should return consistent error response format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/posts/optimized?accountId=invalid",
      });

      const body = JSON.parse(response.body);

      expect(body.ok).toBe(false);
      expect(body.error).toBeTruthy();
      expect(typeof body.error).toBe("string");
    });

    it("should include correct HTTP status codes", async () => {
      // Success case
      const successResponse = await app.inject({
        method: "GET",
        url: `/api/posts/optimized?accountId=${testAccountId}`,
      });
      expect(successResponse.statusCode).toBe(200);

      // Validation error
      const validationResponse = await app.inject({
        method: "GET",
        url: "/api/posts/optimized",
      });
      expect(validationResponse.statusCode).toBe(400);
    });
  });
});
