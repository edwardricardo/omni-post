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
  /** List every channel id owned by an account (used to scope a custom-report run). */
  findChannelIdsByAccount(accountId: string): Promise<string[]>;
  /**
   * Aggregate daily summaries over the given channels and date range,
   * optionally narrowed to a provider via `platformFilter`. One row per
   * (date, provider, channel, post).
   */
  findSummaries(params: {
    channelIds: string[];
    startDate: Date;
    endDate: Date;
    platformFilter?: string;
  }): Promise<AnalyticsSummaryRow[]>;
}
