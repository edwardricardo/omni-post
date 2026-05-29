/**
 * @file GetTopPerformersContextUseCase.ts
 * @description Queries the account's top-performing posts by engagement rate
 *              and builds a context object for injection into AI prompts.
 *              Caches results for 6 hours per (accountId + platform).
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { CachePort } from "@ports/core";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";

export interface TopPerformersInput {
  accountId: string;
  platform?: string;
  lookbackDays?: number;
  limit?: number;
}

export interface TopPerformerPost {
  content: string;
  platform: string;
  engagementRate: number;
  impressions: number;
  publishedAt: Date;
}

export interface TopPerformersContext {
  posts: TopPerformerPost[];
  accountAvgEngagement: number;
  topPerformingPlatform: string | null;
  insights: string[];
}

export interface TopPerformersQueryPort {
  findTopPerformers(params: {
    accountId: string;
    platform?: string;
    since: Date;
    limit: number;
  }): Promise<
    Array<{
      postBody: string;
      platform: string;
      views: number;
      likes: number;
      comments: number;
      shares: number;
      publishedAt: Date;
    }>
  >;
}

const CACHE_TTL_SECONDS = 6 * 60 * 60;

export class GetTopPerformersContextUseCase implements UseCase<
  TopPerformersInput,
  TopPerformersContext,
  UseCaseError
> {
  constructor(
    private readonly queryPort: TopPerformersQueryPort,
    private readonly cache: CachePort
  ) {}

  async execute(input: TopPerformersInput): Promise<Result<TopPerformersContext, UseCaseError>> {
    try {
      const cacheKey = `top-performers:${input.accountId}:${input.platform ?? "all"}`;
      const result = await this.cache.getOrSet<TopPerformersContext>(
        cacheKey,
        () => this.computeContext(input),
        { ttlSeconds: CACHE_TTL_SECONDS }
      );
      return ok(result);
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to get top performers context",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  private async computeContext(input: TopPerformersInput): Promise<TopPerformersContext> {
    const lookbackDays = input.lookbackDays ?? 90;
    const limit = input.limit ?? 5;
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    const rows = await this.queryPort.findTopPerformers({
      accountId: input.accountId,
      ...(input.platform ? { platform: input.platform } : {}),
      since,
      limit: limit * 3,
    });

    if (rows.length === 0) {
      return {
        posts: [],
        accountAvgEngagement: 0,
        topPerformingPlatform: null,
        insights: [],
      };
    }

    const withEngagement = rows
      .map((r) => {
        const totalEngagement = r.likes + r.comments + r.shares;
        const engagementRate = r.views > 0 ? (totalEngagement / r.views) * 100 : 0;
        return { ...r, engagementRate, totalEngagement };
      })
      .sort((a, b) => b.engagementRate - a.engagementRate);

    const topPosts = withEngagement.slice(0, limit).map((r) => ({
      content: r.postBody,
      platform: r.platform,
      engagementRate: Math.round(r.engagementRate * 100) / 100,
      impressions: r.views,
      publishedAt: r.publishedAt,
    }));

    const avgEngagement =
      withEngagement.reduce((sum, r) => sum + r.engagementRate, 0) / withEngagement.length;

    const platformCounts = new Map<string, { total: number; count: number }>();
    for (const r of withEngagement) {
      const current = platformCounts.get(r.platform) ?? { total: 0, count: 0 };
      current.total += r.engagementRate;
      current.count += 1;
      platformCounts.set(r.platform, current);
    }

    let topPlatform: string | null = null;
    let topPlatformAvg = 0;
    for (const [platform, stats] of platformCounts) {
      const avg = stats.total / stats.count;
      if (avg > topPlatformAvg) {
        topPlatformAvg = avg;
        topPlatform = platform;
      }
    }

    const insights = this.generateInsights(withEngagement, avgEngagement, topPlatform);

    return {
      posts: topPosts,
      accountAvgEngagement: Math.round(avgEngagement * 100) / 100,
      topPerformingPlatform: topPlatform,
      insights,
    };
  }

  private generateInsights(
    posts: Array<{ platform: string; engagementRate: number; publishedAt: Date }>,
    avgEngagement: number,
    topPlatform: string | null
  ): string[] {
    const insights: string[] = [];

    if (topPlatform) {
      insights.push(`${topPlatform} consistently outperforms other platforms for this account.`);
    }

    if (posts.length >= 3) {
      const top = posts[0];
      if (top && top.engagementRate > avgEngagement * 2) {
        insights.push(
          `Top post achieved ${top.engagementRate.toFixed(1)}% engagement — ${Math.round(top.engagementRate / avgEngagement)}x the account average.`
        );
      }
    }

    const dayMap = new Map<number, number>();
    for (const p of posts) {
      const day = p.publishedAt.getDay();
      dayMap.set(day, (dayMap.get(day) ?? 0) + p.engagementRate);
    }
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    let bestDay = 0;
    let bestDayScore = 0;
    for (const [day, score] of dayMap) {
      if (score > bestDayScore) {
        bestDayScore = score;
        bestDay = day;
      }
    }
    const bestDayName = dayNames[bestDay];
    if (bestDayName && posts.length >= 5) {
      insights.push(`Posts published on ${bestDayName} tend to perform better for this account.`);
    }

    return insights;
  }
}
