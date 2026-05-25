/**
 * @file PrismaAnalyticsAggregationQuery.ts
 * @description Prisma adapter for AnalyticsAggregationQueryPort.
 *              Queries AnalyticsDailySummary with account-scoped channel filtering.
 * @layer infrastructure
 */

import type { PrismaClient, Provider as PrismaProvider } from "@infra/prisma";
import type {
  AnalyticsAggregationQueryPort,
  AnalyticsSummaryRow,
} from "@core/domain/repositories/AnalyticsAggregationQueryPort.js";

export class PrismaAnalyticsAggregationQuery implements AnalyticsAggregationQueryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findChannelIdsByAccount(accountId: string): Promise<string[]> {
    const channels = await this.prisma.channel.findMany({
      where: {
        deletedAt: null,
        project: { accountId, deletedAt: null },
      },
      select: { id: true },
    });
    return channels.map((c) => c.id);
  }

  async findSummaries(params: {
    channelIds: string[];
    startDate: Date;
    endDate: Date;
    platformFilter?: string;
  }): Promise<AnalyticsSummaryRow[]> {
    const rows = await this.prisma.analyticsDailySummary.findMany({
      where: {
        channelId: { in: params.channelIds },
        date: { gte: params.startDate, lte: params.endDate },
        ...(params.platformFilter ? { provider: params.platformFilter as PrismaProvider } : {}),
      },
      orderBy: { date: "asc" },
    });

    return rows.map((r) => ({
      date: r.date,
      provider: r.provider,
      channelId: r.channelId,
      postId: r.postId,
      views: r.views,
      likes: r.likes,
      comments: r.comments,
      shares: r.shares,
      records: r.records,
    }));
  }
}
