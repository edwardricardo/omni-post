/**
 * @file PrismaScoreTrendContextAdapter.ts
 * @description Prisma adapter for ScoreTrendContextPort.
 *              Provides brand voice and performance insights for trend scoring.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { ScoreTrendContextPort } from "@core/trends/ScoreTrendRelevanceUseCase.js";

export class PrismaScoreTrendContextAdapter implements ScoreTrendContextPort {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method getBrandVoice
   * @description Returns the brand voice system prompt for the account, or undefined.
   */
  async getBrandVoice(accountId: string): Promise<string | undefined> {
    const bv = await this.prisma.brandVoice.findUnique({
      where: { accountId },
      select: { systemPrompt: true },
    });
    return bv?.systemPrompt ?? undefined;
  }

  /**
   * @method getPerformanceInsights
   * @description Generates performance insight strings from recent analytics.
   *              Queries through Channel -> Project -> Account to filter by account.
   *              Uses views + likes + comments + shares as engagement proxy.
   */
  async getPerformanceInsights(accountId: string): Promise<string[]> {
    const insights: string[] = [];

    // Find channel IDs belonging to this account
    const channels = await this.prisma.channel.findMany({
      where: {
        project: { accountId, deletedAt: null },
        deletedAt: null,
      },
      select: { id: true },
    });

    if (channels.length === 0) return insights;

    const channelIds = channels.map((c) => c.id);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const summaries = await this.prisma.analyticsDailySummary.findMany({
      where: {
        channelId: { in: channelIds },
        date: { gte: thirtyDaysAgo },
      },
      select: {
        provider: true,
        views: true,
        likes: true,
        comments: true,
        shares: true,
      },
    });

    if (summaries.length === 0) return insights;

    const platformStats = new Map<string, { engagement: number; views: number }>();
    for (const s of summaries) {
      const existing = platformStats.get(s.provider) ?? { engagement: 0, views: 0 };
      existing.engagement += s.likes + s.comments + s.shares;
      existing.views += s.views;
      platformStats.set(s.provider, existing);
    }

    const sorted = [...platformStats.entries()].sort((a, b) => b[1].engagement - a[1].engagement);

    const [top] = sorted;
    if (top) {
      insights.push(`Top platform: ${top[0]} (${top[1].engagement} engagements, 30d)`);
    }

    if (sorted.length > 1) {
      const platforms = sorted.map(([p]) => p).join(", ");
      insights.push(`Active platforms: ${platforms}`);
    }

    return insights;
  }
}
