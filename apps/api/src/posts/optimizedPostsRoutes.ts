/**
 * @file optimizedPostsRoutes.ts
 * @description High-performance post API endpoints with multi-level caching, database
 *              optimization, and server-side data fetching for React Server Components.
 * @layer infrastructure
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
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";

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
    "/posts/optimized",
    {
      preHandler: [requireClientAuth],
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
    "/dashboard/stats",
    {
      preHandler: [requireClientAuth],
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
    "/cache/warm/:accountId",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Posts"], summary: "Warm cache for a specific account" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return handler.warmCache(request, reply);
    }
  );
}
