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
  /**
   * Upsert one daily analytics summary. Key is `(postId | channelId, provider, date)` —
   * a duplicate ingestion for the same day overwrites the row.
   */
  upsertDailySummary(input: AnalyticsDailySummaryInput): Promise<Result<void, Error>>;
  /**
   * Batch upsert variant for ingestion workers that pull many days in one
   * call. Implementations SHOULD wrap the batch in a transaction so a partial
   * provider response never leaves the summary table half-updated.
   */
  upsertDailySummaries(inputs: AnalyticsDailySummaryInput[]): Promise<Result<void, Error>>;
}
