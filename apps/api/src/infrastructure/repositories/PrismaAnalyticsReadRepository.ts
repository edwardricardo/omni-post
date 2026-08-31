/**
 * @file PrismaAnalyticsReadRepository.ts
 * @description Prisma adapter implementing AnalyticsReadRepositoryPort. Serves analytics
 *              consumers with flat domain DTOs. Receives PrismaClient via constructor injection.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type {
  AnalyticsReadRepositoryPort,
  AnalyticsQueryOptions,
  AnalyticsWithPost,
  AnalyticsWithRelations,
  EngagementMetrics,
  TimeSeriesRow,
  PostWithAnalyticsAndContent,
  DailySummaryDto,
  MonthlySummaryDto,
  HistoricalTrendDto,
} from "@core/domain/repositories/AnalyticsReadRepository.js";
import type { AnalyticsDto } from "@core/domain/repositories/ReadModelDtos.js";

/**
 * PrismaAnalyticsReadRepository
 *
 * Read-only Prisma adapter that returns flat domain DTOs.
 * Receives PrismaClient via constructor injection (DI-friendly).
 *
 * The aggregateEngagement method is a pure sync computation bundled here for
 * backwards compatibility — callers previously relied on it via the same
 * repository instance.
 *
 * @example
 * const repo = new PrismaAnalyticsReadRepository(prisma);
 * const analytics = await repo.getByPostIds(["post-1", "post-2"]);
 */
export class PrismaAnalyticsReadRepository implements AnalyticsReadRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Return analytics records (with post and channel joins) for a set of post IDs.
   * Eliminates N+1 by batching all post IDs in a single WHERE IN query.
   */
  async getByPostIds(
    postIds: string[],
    options: AnalyticsQueryOptions = {}
  ): Promise<AnalyticsWithRelations[]> {
    const rows = await this.prisma.analytics.findMany({
      where: {
        postId: { in: postIds },
        ...((options.startDate || options.endDate) && {
          capturedAt: {
            ...(options.startDate && { gte: options.startDate }),
            ...(options.endDate && { lte: options.endDate }),
          },
        }),
        ...(options.provider && { provider: options.provider as never }),
      },
      include: {
        post: true,
        channel: true,
      },
      ...(options.take !== undefined && { take: options.take }),
      ...(options.skip !== undefined && { skip: options.skip }),
      orderBy: options.orderBy ?? { capturedAt: "desc" },
    });
    // Prisma Provider enum values are identical string literals at runtime — safe cast.
    return rows as unknown as AnalyticsWithRelations[];
  }

  /**
   * Return analytics records for all posts in a project.
   * Uses a two-step query (posts → postIds → analytics) to avoid a nested
   * Prisma relation that would require an extra join on the project side.
   */
  async getByProjectId(
    projectId: string,
    options: AnalyticsQueryOptions = {}
  ): Promise<AnalyticsDto[]> {
    const posts = await this.prisma.post.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true },
    });
    const postIds = posts.map((p) => p.id);

    const rows = await this.prisma.analytics.findMany({
      where: {
        postId: { in: postIds },
        ...((options.startDate || options.endDate) && {
          capturedAt: {
            ...(options.startDate && { gte: options.startDate }),
            ...(options.endDate && { lte: options.endDate }),
          },
        }),
        ...(options.provider && { provider: options.provider as never }),
      },
      ...(options.take !== undefined && { take: options.take }),
      ...(options.skip !== undefined && { skip: options.skip }),
      orderBy: options.orderBy ?? { capturedAt: "desc" },
    });
    return rows as unknown as AnalyticsDto[];
  }

  /**
   * Return analytics records for a channel, with their parent post joined.
   */
  async getByChannelId(
    channelId: string,
    options: AnalyticsQueryOptions = {}
  ): Promise<AnalyticsWithPost[]> {
    const rows = await this.prisma.analytics.findMany({
      where: {
        channelId,
        ...((options.startDate || options.endDate) && {
          capturedAt: {
            ...(options.startDate && { gte: options.startDate }),
            ...(options.endDate && { lte: options.endDate }),
          },
        }),
        ...(options.provider && { provider: options.provider as never }),
      },
      include: {
        post: true,
      },
      ...(options.take !== undefined && { take: options.take }),
      ...(options.skip !== undefined && { skip: options.skip }),
      orderBy: options.orderBy ?? { capturedAt: "desc" },
    });
    return rows as unknown as AnalyticsWithPost[];
  }

  /**
   * Return the most-recent analytics record for each post in the set.
   * Fetches all records ordered by capturedAt desc and deduplicates by postId.
   */
  async getLatestForPosts(postIds: string[]): Promise<AnalyticsDto[]> {
    const analytics = await this.prisma.analytics.findMany({
      where: { postId: { in: postIds } },
      orderBy: { capturedAt: "desc" },
    });

    const latestMap = new Map<string, AnalyticsDto>();
    for (const record of analytics) {
      if (record.postId && !latestMap.has(record.postId)) {
        latestMap.set(record.postId, record as unknown as AnalyticsDto);
      }
    }

    return Array.from(latestMap.values());
  }

  /**
   * Pure-sync aggregation: compute engagement totals from a set of analytics rows.
   * No database calls — purely computational.
   */
  aggregateEngagement(analytics: AnalyticsDto[]): EngagementMetrics {
    const totalViews = analytics.reduce((sum, a) => sum + (a.views ?? 0), 0);
    const totalLikes = analytics.reduce((sum, a) => sum + (a.likes ?? 0), 0);
    const totalComments = analytics.reduce((sum, a) => sum + (a.comments ?? 0), 0);
    const totalShares = analytics.reduce((sum, a) => sum + (a.shares ?? 0), 0);

    const totalEngagement = totalLikes + totalComments + totalShares;
    const avgEngagementRate = totalViews > 0 ? (totalEngagement / totalViews) * 100 : 0;

    return {
      totalViews,
      totalLikes,
      totalComments,
      totalShares,
      totalEngagement,
      avgEngagementRate,
    };
  }

  /**
   * Return analytics grouped into time-series buckets (hour / day / week).
   * Delegates data fetch to getByPostIds then groups in memory.
   */
  async getTimeSeriesData(
    postIds: string[],
    granularity: "hour" | "day" | "week" = "day",
    options: AnalyticsQueryOptions = {}
  ): Promise<TimeSeriesRow[]> {
    const analytics = await this.getByPostIds(postIds, options);

    const grouped = new Map<string, AnalyticsDto[]>();

    for (const record of analytics) {
      const date = new Date(record.capturedAt);
      let key: string;

      if (granularity === "hour") {
        key = date.toISOString().slice(0, 13); // YYYY-MM-DDTHH
      } else if (granularity === "day") {
        key = date.toISOString().slice(0, 10); // YYYY-MM-DD
      } else {
        // week — anchor to Sunday
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = weekStart.toISOString().slice(0, 10);
      }

      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(record);
    }

    return Array.from(grouped.entries()).map(([period, records]) => ({
      period,
      ...this.aggregateEngagement(records),
      recordCount: records.length,
    }));
  }

  /**
   * Return posts with their nested analytics, content and media for a project.
   * Single query — eliminates N+1 for geo-analytics use cases.
   */
  async getPostsWithAnalytics(
    projectId: string,
    options: AnalyticsQueryOptions = {}
  ): Promise<PostWithAnalyticsAndContent[]> {
    const rows = await this.prisma.post.findMany({
      where: { projectId, deletedAt: null },
      include: {
        analytics: {
          where: {
            ...((options.startDate || options.endDate) && {
              capturedAt: {
                ...(options.startDate && { gte: options.startDate }),
                ...(options.endDate && { lte: options.endDate }),
              },
            }),
            ...(options.provider && { provider: options.provider as never }),
          },
          orderBy: { capturedAt: "desc" },
        },
        contents: true,
        media: true,
      },
      ...(options.take !== undefined && { take: options.take }),
      ...(options.skip !== undefined && { skip: options.skip }),
      orderBy: options.orderBy ?? { createdAt: "desc" },
    });
    return rows as unknown as PostWithAnalyticsAndContent[];
  }

  /**
   * Return daily aggregated summaries for a channel within a date range.
   * Queries the AnalyticsDailySummary pre-aggregated table.
   */
  async getDailySummary(
    channelId: string,
    startDate: Date,
    endDate: Date
  ): Promise<DailySummaryDto[]> {
    const rows = await this.prisma.analyticsDailySummary.findMany({
      where: {
        channelId,
        date: { gte: startDate, lte: endDate },
      },
      orderBy: { date: "asc" },
    });
    return rows as unknown as DailySummaryDto[];
  }

  /**
   * Return monthly aggregated summaries for a channel within a date range.
   * Queries the AnalyticsMonthlySummary pre-aggregated table.
   */
  async getMonthlySummary(
    channelId: string,
    startDate: Date,
    endDate: Date
  ): Promise<MonthlySummaryDto[]> {
    const rows = await this.prisma.analyticsMonthlySummary.findMany({
      where: {
        channelId,
        month: { gte: startDate, lte: endDate },
      },
      orderBy: { month: "asc" },
    });
    return rows as unknown as MonthlySummaryDto[];
  }

  /**
   * Return historical trends for all channels in a project over N months.
   * First resolves channel IDs for the project, then aggregates monthly
   * summaries grouped by month period.
   */
  async getHistoricalTrends(projectId: string, months: number): Promise<HistoricalTrendDto[]> {
    // Resolve all channel IDs belonging to this project
    const channels = await this.prisma.channel.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true },
    });
    const channelIds = channels.map((c) => c.id);

    if (channelIds.length === 0) {
      return [];
    }

    // Calculate the start date N months ago (first day of that month)
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
    startDate.setDate(1);
    startDate.setHours(0, 0, 0, 0);

    const rows = await this.prisma.analyticsMonthlySummary.findMany({
      where: {
        channelId: { in: channelIds },
        month: { gte: startDate },
      },
      orderBy: { month: "asc" },
    });

    // Group by month period and aggregate
    const grouped = new Map<string, HistoricalTrendDto>();

    for (const row of rows) {
      const period = new Date(row.month).toISOString().slice(0, 7); // YYYY-MM
      const existing = grouped.get(period);

      if (existing) {
        existing.totalViews += row.views;
        existing.totalLikes += row.likes;
        existing.totalComments += row.comments;
        existing.totalShares += row.shares;
        existing.totalEngagement += row.likes + row.comments + row.shares;
      } else {
        grouped.set(period, {
          period,
          totalViews: row.views,
          totalLikes: row.likes,
          totalComments: row.comments,
          totalShares: row.shares,
          totalEngagement: row.likes + row.comments + row.shares,
        });
      }
    }

    return Array.from(grouped.values());
  }
}
