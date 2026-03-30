/**
 * @file AnalyticsAggregationQueryPort.ts
 * @description Port for querying aggregated analytics data for custom reports.
 *              Used by RunCustomReportQuery to fetch real data without importing Prisma.
 * @layer domain
 */

export interface AnalyticsSummaryRow {
  date: Date;
  provider: string;
  channelId: string;
  postId: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  records: number;
}

export interface AnalyticsAggregationQueryPort {
  findChannelIdsByAccount(accountId: string): Promise<string[]>;
  findSummaries(params: {
    channelIds: string[];
    startDate: Date;
    endDate: Date;
    platformFilter?: string;
  }): Promise<AnalyticsSummaryRow[]>;
}
