/**
 * @file GetHistoricalAnalyticsQuery.ts
 * @description Query handler for retrieving historical analytics data from
 *              pre-aggregated daily or monthly summary tables. Selects the
 *              appropriate granularity based on input parameters.
 * @layer application
 */

import type {
  AnalyticsReadRepositoryPort,
  DailySummaryDto,
  MonthlySummaryDto,
} from "@core/domain/repositories/AnalyticsReadRepository.js";

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

/**
 * Input parameters for querying historical analytics.
 */
export interface GetHistoricalAnalyticsInput {
  projectId: string;
  channelId: string;
  startDate: Date;
  endDate: Date;
  granularity: "daily" | "monthly";
}

/**
 * Discriminated union output for historical analytics query results.
 */
export type GetHistoricalAnalyticsOutput =
  | { granularity: "daily"; data: DailySummaryDto[] }
  | { granularity: "monthly"; data: MonthlySummaryDto[] };

// ---------------------------------------------------------------------------
// Query handler
// ---------------------------------------------------------------------------

/**
 * @class GetHistoricalAnalyticsQuery
 * @description Retrieves pre-aggregated analytics data at daily or monthly
 *              granularity for a specific channel within a date range.
 */
export class GetHistoricalAnalyticsQuery {
  constructor(private readonly analyticsReadRepo: AnalyticsReadRepositoryPort) {}

  /**
   * @method execute
   * @description Fetches historical analytics summaries at the requested
   *              granularity level from the pre-aggregated tables.
   * @param input - Query parameters including channel, date range, and granularity
   * @returns Discriminated union with the matching granularity and data array
   */
  async execute(input: GetHistoricalAnalyticsInput): Promise<GetHistoricalAnalyticsOutput> {
    const { channelId, startDate, endDate, granularity } = input;

    if (granularity === "daily") {
      const data = await this.analyticsReadRepo.getDailySummary(channelId, startDate, endDate);
      return { granularity: "daily", data };
    }

    const data = await this.analyticsReadRepo.getMonthlySummary(channelId, startDate, endDate);
    return { granularity: "monthly", data };
  }
}
