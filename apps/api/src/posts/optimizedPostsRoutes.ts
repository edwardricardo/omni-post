/**
 * Phase 2: React 19 Server Components - Optimized Posts API Routes
 *
 * This module provides high-performance API endpoints specifically designed for
 * React 19 Server Components with advanced caching and database optimization.
 *
 * Features:
 * - Multi-level caching (L1/L2/L3) with cache warming
 * - Database optimization with materialized views and stored functions
 * - Server-side data fetching optimization
 * - Performance monitoring and metrics collection
 * - Structured error handling with fallbacks
 * - BaseRouteHandler pattern for consistent request/response handling
 *
 * DI: PostsService is resolved from the container (registered in setup.ts as TOKENS.PostsService).
 * No local DatabaseOptimizer or RedisCacheManager instances are created here.
 */

import { FastifyRequest, FastifyReply, FastifyInstance } from "fastify";
import { z } from "zod";
import {
  BaseRouteHandler,
  RouteContext,
  PaginationQuerySchema,
  IdSchema,
} from "@packages/api-common";
import { TOKENS } from "../infrastructure/container/types.js";
import type { PostsService } from "./postsService.js";
import { authenticateMiddleware } from "../auth/authMiddleware.js";

// Validation Schemas
const GetOptimizedPostsQuerySchema = z.object({
  accountId: IdSchema,
  ...PaginationQuerySchema.shape,
});

const GetDashboardStatsQuerySchema = z.object({
  accountId: IdSchema,
});

const WarmCacheParamsSchema = z.object({
  accountId: IdSchema,
});

// TypeScript types for validated data
type GetOptimizedPostsQuery = z.infer<typeof GetOptimizedPostsQuerySchema>;
type GetDashboardStatsQuery = z.infer<typeof GetDashboardStatsQuerySchema>;
type WarmCacheParams = z.infer<typeof WarmCacheParamsSchema>;

/**
 * Route handler for optimized posts endpoints
 * Extends BaseRouteHandler for consistent error handling and response formatting.
 * PostsService is injected via constructor (resolved from DI container).
 */
class OptimizedPostsRouteHandler extends BaseRouteHandler {
  protected routeName = "optimized-posts";

  constructor(private readonly postsService: PostsService) {
    super();
  }

  /**
   * Get optimized posts list for dashboard
   *
   * This endpoint uses multi-level caching and optimized database queries
   * specifically designed for React 19 Server Components performance.
   */
  async getOptimizedPosts(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    // Validate request
    const validated = await this.validateRequest<{ query: GetOptimizedPostsQuery }>(ctx, {
      query: GetOptimizedPostsQuerySchema,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request parameters");
    }

    const { accountId, page, limit } = validated.value.query;
    const { offset } = this.parsePagination({ page, limit });

    const responseData = await this.postsService.getOptimizedPosts({
      accountId,
      page,
      limit,
      offset,
    });

    return this.sendSuccess(ctx, responseData, 200);
  }

  /**
   * Get dashboard statistics with caching optimization
   *
   * Uses materialized views and multi-level caching for maximum performance
   * in React 19 Server Components.
   */
  async getDashboardStats(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    // Validate request
    const validated = await this.validateRequest<{ query: GetDashboardStatsQuery }>(ctx, {
      query: GetDashboardStatsQuerySchema,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid request parameters");
    }

    const { accountId } = validated.value.query;
    const stats = await this.postsService.getDashboardStats(accountId);

    return this.sendSuccess(ctx, stats, 200);
  }

  /**
   * Warm cache for specific account
   *
   * Pre-loads frequently accessed data into all cache levels
   * for improved React 19 Server Component performance.
   */
  async warmCache(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    // Validate request
    const validated = await this.validateRequest<{ params: WarmCacheParams }>(ctx, {
      params: WarmCacheParamsSchema,
    });

    if (!validated.ok) {
      return this.sendError(ctx, 400, "Invalid account ID");
    }

    const { accountId } = validated.value.params;
    const result = await this.postsService.warmCache(accountId);

    return this.sendSuccess(ctx, result, 200);
  }
}

/**
 * Register optimized posts routes with Fastify instance.
 * Resolves PostsService from the DI container (registered in setup.ts as TOKENS.PostsService).
 */
export function registerOptimizedPostsRoutes(fastify: FastifyInstance) {
  const postsService = fastify.container!.resolve<PostsService>(TOKENS.PostsService);
  const handler = new OptimizedPostsRouteHandler(postsService);

  /**
   * GET /api/posts/optimized
   * Get optimized posts list for dashboard with multi-level caching
   */
  fastify.get(
    "/api/posts/optimized",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Posts"], summary: "Get optimized posts list for dashboard" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return handler.getOptimizedPosts(request, reply);
    }
  );

  /**
   * GET /api/dashboard/stats
   * Get dashboard statistics with materialized view optimization
   */
  fastify.get(
    "/api/dashboard/stats",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Posts"], summary: "Get dashboard statistics" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return handler.getDashboardStats(request, reply);
    }
  );

  /**
   * POST /api/cache/warm/:accountId
   * Pre-warm cache for specific account
   */
  fastify.post(
    "/api/cache/warm/:accountId",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Posts"], summary: "Warm cache for a specific account" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return handler.warmCache(request, reply);
    }
  );
}
