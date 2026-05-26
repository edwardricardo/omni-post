/**
 * @file AnalyticsWriteRepository.ts
 * @description Port interface for persisting analytics data from provider ingestion.
 *              Supports upsert of daily summaries and raw analytics records.
 * @layer domain
 */

import type { Result } from "@shared/types";

export interface AnalyticsDailySummaryInput {
  postId: string | null;
  channelId: string;
  provider: string;
  date: Date;
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

export interface AnalyticsWriteRepository {
  upsertDailySummary(input: AnalyticsDailySummaryInput): Promise<Result<void, Error>>;
  upsertDailySummaries(inputs: AnalyticsDailySummaryInput[]): Promise<Result<void, Error>>;
}
