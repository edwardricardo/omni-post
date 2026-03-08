/**
 * Domain Layer - AnalyticsReadRepository Port
 *
 * Part of R1-C: Read-model repositories for analytics consumers.
 * This is a FLAT DTO-based read repository (NOT the DDD entity-based
 * AnalyticsQueryRepository that already exists).
 *
 * Consumers: ThreadAnalytics.
 *
 * @module domain/repositories/AnalyticsReadRepository
 */

import type { AnalyticsDto, PostDto, ChannelDto } from "./ReadModelDtos.js";

// ---------------------------------------------------------------------------
// Composite types (eager-include shapes)
// ---------------------------------------------------------------------------

/**
 * Analytics record joined with its parent post (nullable because the FK is
 * optional in the schema).
 */
export type AnalyticsWithPost = AnalyticsDto & { post: PostDto | null };

/**
 * Analytics record joined with both its parent post and channel.
 */
export type AnalyticsWithRelations = AnalyticsDto & {
  post: PostDto | null;
  channel: ChannelDto;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Filtering / pagination options shared across read methods.
 */
export interface AnalyticsQueryOptions {
  startDate?: Date;
  endDate?: Date;
  provider?: string;
  take?: number;
  skip?: number;
  /** Prisma-compatible orderBy expression */
  orderBy?: Record<string, "asc" | "desc">;
}

// ---------------------------------------------------------------------------
// Aggregation result
// ---------------------------------------------------------------------------

/**
 * Aggregated engagement totals over a set of analytics records.
 */
export interface EngagementMetrics {
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalEngagement: number;
  avgEngagementRate: number;
}

/**
 * A single time-series bucket returned by getTimeSeriesData.
 */
export interface TimeSeriesRow extends EngagementMetrics {
  period: string;
  recordCount: number;
}

/**
 * Post DTO with nested analytics and content/media arrays.
 * Used by getPostsWithAnalytics.
 */
export type PostWithAnalyticsAndContent = PostDto & {
  analytics: AnalyticsDto[];
  contents: unknown[];
  media: unknown[];
};

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

/**
 * AnalyticsReadRepositoryPort — read-only flat-DTO access to analytics data.
 *
 * This port must NOT use domain entities — it returns plain DTOs so
 * that analytics services can use them directly.
 *
 * Note: `aggregateEngagement` is a SYNC pure-computation method included here
 * because the legacy AnalyticsRepository bundled it, and consumers depend on
 * calling it through the same interface object.
 */
export interface AnalyticsReadRepositoryPort {
  /**
   * Return analytics records (with post and channel joins) for a set of post IDs.
   * Replaces the N+1 pattern of fetching analytics per post.
   */
  getByPostIds(
    postIds: string[],
    options?: AnalyticsQueryOptions
  ): Promise<AnalyticsWithRelations[]>;

  /**
   * Return analytics records for all posts in a project.
   */
  getByProjectId(projectId: string, options?: AnalyticsQueryOptions): Promise<AnalyticsDto[]>;

  /**
   * Return analytics records for a channel, with their parent post joined.
   */
  getByChannelId(channelId: string, options?: AnalyticsQueryOptions): Promise<AnalyticsWithPost[]>;

  /**
   * Return the most-recent analytics record for each post in the set.
   */
  getLatestForPosts(postIds: string[]): Promise<AnalyticsDto[]>;

  /**
   * Pure-sync aggregation: compute engagement totals from a set of analytics rows.
   */
  aggregateEngagement(analytics: AnalyticsDto[]): EngagementMetrics;

  /**
   * Return analytics grouped into time-series buckets (hour / day / week).
   */
  getTimeSeriesData(
    postIds: string[],
    granularity?: "hour" | "day" | "week",
    options?: AnalyticsQueryOptions
  ): Promise<TimeSeriesRow[]>;

  /**
   * Return posts with their nested analytics, content and media for a project.
   * This is the key method that eliminates N+1 queries in geo-analytics.
   */
  getPostsWithAnalytics(
    projectId: string,
    options?: AnalyticsQueryOptions
  ): Promise<PostWithAnalyticsAndContent[]>;
}
