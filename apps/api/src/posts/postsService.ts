/**
 * @file postsService.ts
 * @description Posts service providing multi-level cached post listing, dashboard statistics,
 *              and optimized queries via DatabaseOptimizer and RedisCacheManager.
 * @layer infrastructure
 */
import { BaseService } from "../services/BaseService.js";
import { DatabaseOptimizer } from "../database/DatabaseOptimizer.js";
import { RedisCacheManager } from "@adapters/cache-redis";

// Response types
interface PostListItem {
  id: string;
  title: string | null;
  body: string | null;
  status: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED";
  createdAt: string;
  scheduledAt: string | null;
  tags: string[];
  channelCount: number;
  totalViews: number;
}

interface DashboardStats {
  totalPosts: number;
  publishedPosts: number;
  scheduledPosts: number;
  failedPosts: number;
  totalChannels: number;
  lastActivity: string | null;
  avgPostViews: number;
  cached?: boolean;
  cacheLevel?: string;
}

interface PaginatedPostsResponse {
  data: PostListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  cached: boolean;
  cacheLevel: string;
}

interface OptimizedPostsParams {
  accountId: string;
  page: number;
  limit: number;
  offset: number;
}

/**
 * Posts Service - handles optimized posts queries with multi-level caching
 *
 * Features:
 * - Multi-level caching (L1/L2/L3) with cache warming
 * - Database optimization with materialized views and stored functions
 * - Performance monitoring and metrics collection
 */
export class PostsService extends BaseService {
  constructor(
    private readonly dbOptimizer: DatabaseOptimizer,
    private readonly cacheManager: RedisCacheManager
  ) {
    super("PostsService");
  }

  async getOptimizedPosts(params: OptimizedPostsParams): Promise<PaginatedPostsResponse> {
    return this.execute(
      {
        operation: "getOptimizedPosts",
        userId: params.accountId,
        metadata: { page: params.page, limit: params.limit },
      },
      async () => {
        const startTime = Date.now();
        const { accountId, page, limit, offset } = params;

        // Generate cache key for multi-level caching
        const cacheKey = `dashboard:posts:${accountId}:${page}:${limit}`;

        // Try to get from cache first (L1 -> L2 -> L3 fallback)
        const cachedData = await this.cacheManager.get<PaginatedPostsResponse>(cacheKey);

        if (cachedData.ok && cachedData.value) {
          // Record performance metric
          await this.dbOptimizer.recordPerformanceMetric(
            "optimized_posts_response_time",
            Date.now() - startTime,
            "milliseconds",
            { cached: true, accountId, page, limit }
          );

          return {
            ...cachedData.value,
            cached: true,
            cacheLevel: "multi-level",
          };
        }

        // Cache miss - fetch from optimized database function
        const posts = await this.dbOptimizer.getDashboardPosts(accountId, limit, offset);

        // Get total count for pagination (also optimized with caching)
        const totalCacheKey = `dashboard:posts:total:${accountId}`;
        const cachedTotal = await this.cacheManager.get<number>(totalCacheKey);
        let total: number;

        if (cachedTotal.ok && cachedTotal.value !== null) {
          total = cachedTotal.value;
        } else {
          // Use optimized count query via dbOptimizer (keeps service decoupled from prisma)
          total = await this.dbOptimizer.getDashboardPostsCount(accountId);

          // Cache total count for 10 minutes
          await this.cacheManager.set(totalCacheKey, total, {
            ttl: 600,
            tags: ["dashboard", "posts", `account:${accountId}`],
          });
        }

        // Transform database result to match API schema
        const transformedPosts: PostListItem[] = posts.map(
          (
            post: Record<string, unknown> & {
              id: string;
              status: string;
              createdAt: Date;
              scheduledAt?: Date | null;
              channelCount: number;
              totalViews: number;
              title?: string | null;
            }
          ) => ({
            id: post.id,
            title: post.title || null,
            body: null, // We don't need full body content in list view
            status: post.status as "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED",
            createdAt: post.createdAt.toISOString(),
            scheduledAt: post.scheduledAt?.toISOString() || null,
            tags: [], // Post tags not yet in schema; return empty array for API contract
            channelCount: post.channelCount,
            totalViews: post.totalViews,
          })
        );

        const totalPages = Math.ceil(total / limit);

        const responseData: PaginatedPostsResponse = {
          data: transformedPosts,
          total,
          page,
          limit,
          totalPages,
          cached: false,
          cacheLevel: "database",
        };

        // Store in cache for future requests
        await this.cacheManager.set(cacheKey, responseData, {
          ttl: 300, // 5 minutes
          tags: ["dashboard", "posts", `account:${accountId}`],
        });

        // Record performance metric
        await this.dbOptimizer.recordPerformanceMetric(
          "optimized_posts_response_time",
          Date.now() - startTime,
          "milliseconds",
          { cached: false, accountId, page, limit }
        );

        return responseData;
      }
    );
  }

  async getDashboardStats(accountId: string): Promise<DashboardStats> {
    return this.execute({ operation: "getDashboardStats", userId: accountId }, async () => {
      const startTime = Date.now();
      const cacheKey = `tenant:stats:${accountId}`;

      // Try cache first (uses materialized views as L3 cache)
      const cachedStats = await this.cacheManager.get<DashboardStats>(cacheKey);

      if (cachedStats.ok && cachedStats.value) {
        await this.dbOptimizer.recordPerformanceMetric(
          "dashboard_stats_response_time",
          Date.now() - startTime,
          "milliseconds",
          { cached: true, accountId }
        );

        return {
          ...cachedStats.value,
          cached: true,
          cacheLevel: "multi-level",
        };
      }

      // Cache miss - fetch from materialized view
      const stats = await this.dbOptimizer.getTenantDashboardStats(accountId);

      if (!stats) {
        // Fallback to basic stats if materialized view has no data
        const fallbackStats: DashboardStats = {
          totalPosts: 0,
          publishedPosts: 0,
          scheduledPosts: 0,
          failedPosts: 0,
          totalChannels: 0,
          lastActivity: null,
          avgPostViews: 0,
          cached: false,
          cacheLevel: "fallback",
        };

        await this.cacheManager.set(cacheKey, fallbackStats, {
          ttl: 300, // 5 minutes for fallback data
          tags: ["dashboard", "stats", `account:${accountId}`],
        });

        return fallbackStats;
      }

      // Transform for API response
      const responseStats: DashboardStats = {
        totalPosts: stats.totalPosts,
        publishedPosts: stats.publishedPosts,
        scheduledPosts: stats.scheduledPosts,
        failedPosts: stats.failedPosts,
        totalChannels: stats.totalChannels,
        lastActivity: stats.lastActivity?.toISOString() || null,
        avgPostViews: stats.avgPostViews,
        cached: false,
        cacheLevel: "materialized-view",
      };

      // Cache the result
      await this.cacheManager.set(cacheKey, responseStats, {
        ttl: 600, // 10 minutes
        tags: ["dashboard", "stats", `account:${accountId}`],
      });

      // Record performance metric
      await this.dbOptimizer.recordPerformanceMetric(
        "dashboard_stats_response_time",
        Date.now() - startTime,
        "milliseconds",
        { cached: false, accountId }
      );

      return responseStats;
    });
  }

  async warmCache(
    accountId: string
  ): Promise<{ success: boolean; message: string; accountId: string }> {
    return this.execute({ operation: "warmCache", userId: accountId }, async () => {
      // Warm cache using the AdvancedCacheManager
      await this.cacheManager.warmCache(Number(accountId));

      return {
        success: true,
        message: "Cache warming completed",
        accountId,
      };
    });
  }
}

/**
 * @function createPostsService
 * @description Factory for PostsService with explicit dependencies (preferred over module-singleton).
 * @param dbOptimizer - DatabaseOptimizer instance
 * @param cacheManager - RedisCacheManager instance
 * @returns Configured PostsService
 */
export function createPostsService(
  dbOptimizer: DatabaseOptimizer,
  cacheManager: RedisCacheManager
): PostsService {
  return new PostsService(dbOptimizer, cacheManager);
}
