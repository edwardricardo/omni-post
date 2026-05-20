/**
 * @file AccountAnalyticsTrendingAdapter.ts
 * @description Trending-topic source derived from the account's own historical
 *              analytics: identifies hashtags from the last 30 days of posted
 *              content (`PostContent.tags`) and aggregates engagement signal
 *              from `AnalyticsDailySummary` per provider. Output reflects what
 *              is already resonating inside the account's owned signal.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type {
  TrendingDataPort,
  TrendingTopic,
  FetchTrendingInput,
} from "../../application/trends/FetchTrendingTopicsUseCase.js";

const LOOKBACK_DAYS = 30;
const TOPIC_LIMIT = 20;

export class AccountAnalyticsTrendingAdapter implements TrendingDataPort {
  constructor(private readonly prisma: PrismaClient) {}

  async fetchTrends(input: FetchTrendingInput): Promise<TrendingTopic[]> {
    if (input.sources && !input.sources.includes("account-analytics")) {
      return [];
    }

    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const fetchedAt = new Date();

    const posts = await this.prisma.post.findMany({
      where: {
        project: { accountId: input.accountId },
        publishedAt: { gte: since },
      },
      include: {
        contents: { select: { tags: true } },
        analyticsDailySummaries: {
          where: { date: { gte: since } },
          select: { likes: true, comments: true, shares: true, views: true, provider: true },
        },
      },
      take: 500,
    });

    const stats = new Map<
      string,
      { volume: number; engagement: number; platform: string | null }
    >();

    for (const post of posts) {
      const tagSet = new Set<string>();
      for (const c of post.contents) {
        for (const tag of c.tags) {
          const trimmed = tag.trim();
          if (trimmed) tagSet.add(trimmed);
        }
      }

      let engagement = 0;
      let platform: string | null = null;
      for (const s of post.analyticsDailySummaries) {
        engagement += s.likes + s.comments + s.shares;
        if (platform === null) platform = s.provider;
      }

      for (const tag of tagSet) {
        const key = tag.toLowerCase();
        const prior = stats.get(key) ?? { volume: 0, engagement: 0, platform };
        stats.set(key, {
          volume: prior.volume + 1,
          engagement: prior.engagement + engagement,
          platform: prior.platform ?? platform,
        });
      }
    }

    const ranked = Array.from(stats.entries())
      .map(([tag, s]) => ({ tag, ...s }))
      .sort((a, b) => b.engagement - a.engagement || b.volume - a.volume)
      .slice(0, TOPIC_LIMIT);

    return ranked.map((r) => ({
      topic: r.tag,
      source: "account-analytics" as const,
      sourceUrl: null,
      platform: r.platform,
      volume: r.volume,
      category: null,
      trend: r.volume >= 3 ? "rising" : "stable",
      fetchedAt,
    }));
  }
}
