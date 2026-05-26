/**
 * @file ComparePerformanceUseCase.ts
 * @description Orchestrates cross-period and cross-provider performance comparison using aggregation queries and threshold-based benchmarks.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type {
  ComparePerformanceInput,
  ComparePerformanceOutput,
  PerformanceSnapshot,
} from "./types.js";

/**
 * Performance Comparator interface (port)
 */
export interface PerformanceComparatorPort {
  generatePerformanceComparison(options: {
    accountId: string;
    projectId?: string;
    timeRange: string;
    startDate?: Date;
    endDate?: Date;
    providers?: string[];
    includeIndustryBenchmarks?: boolean;
    includeHistoricalComparison?: boolean;
    includeCompetitorData?: boolean;
  }): Promise<{
    currentPerformance: PerformanceSnapshot;
    industryBenchmarks?: unknown[];
    competitorComparisons?: unknown[];
    historicalComparison?: Record<string, unknown>;
    providerComparison?: Record<string, unknown>;
    contentTypeComparison?: Record<string, unknown>;
    keyInsights: string[];
    recommendations: string[];
  }>;

  compareMetricsOverTime?(
    options: Record<string, unknown>,
    metrics: string[],
    periods: string[]
  ): Promise<{
    metrics: string[];
    periods: unknown[];
    trends: Record<string, unknown>;
    insights: string[];
  }>;
}

/**
 * Compare Performance Use Case
 *
 * Compares performance across time periods, providers, and against
 * industry benchmarks and competitors.
 */
export class ComparePerformanceUseCase implements UseCase<
  ComparePerformanceInput,
  ComparePerformanceOutput,
  UseCaseError
> {
  constructor(private readonly performanceComparator: PerformanceComparatorPort) {}

  async execute(
    input: ComparePerformanceInput
  ): Promise<Result<ComparePerformanceOutput, UseCaseError>> {
    // Validate account ID
    if (!input.accountId || input.accountId.trim().length === 0) {
      return err(new UseCaseError("Account ID is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    // Validate time range
    const validTimeRanges = ["7d", "30d", "90d", "1y", "custom"];
    if (!validTimeRanges.includes(input.timeRange)) {
      return err(
        new UseCaseError(
          `Invalid time range. Must be one of: ${validTimeRanges.join(", ")}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    try {
      // Generate base performance comparison
      const comparison = await this.performanceComparator.generatePerformanceComparison({
        accountId: input.accountId,
        ...(input.projectId !== undefined && { projectId: input.projectId }),
        timeRange: input.timeRange,
        ...(input.startDate && { startDate: new Date(input.startDate) }),
        ...(input.endDate && { endDate: new Date(input.endDate) }),
        ...(input.providers !== undefined && { providers: input.providers }),
        ...(input.includeIndustryBenchmarks !== undefined && {
          includeIndustryBenchmarks: input.includeIndustryBenchmarks,
        }),
        ...(input.includeHistoricalComparison !== undefined && {
          includeHistoricalComparison: input.includeHistoricalComparison,
        }),
        ...(input.includeCompetitorData !== undefined && {
          includeCompetitorData: input.includeCompetitorData,
        }),
      });

      // If metrics comparison is requested and comparator supports it
      let metricsComparison: Record<string, unknown> | undefined;
      if (
        input.metrics &&
        input.comparePeriods &&
        this.performanceComparator.compareMetricsOverTime
      ) {
        const metricsResult = await this.performanceComparator.compareMetricsOverTime(
          {
            accountId: input.accountId,
            projectId: input.projectId,
            providers: input.providers,
          },
          input.metrics,
          input.comparePeriods
        );
        metricsComparison = {
          metrics: metricsResult.metrics,
          periods: metricsResult.periods,
          trends: metricsResult.trends,
          insights: metricsResult.insights,
        };
      }

      return ok({
        currentPerformance: comparison.currentPerformance,
        ...(comparison.industryBenchmarks !== undefined && {
          industryBenchmarks: comparison.industryBenchmarks,
        }),
        ...(comparison.competitorComparisons !== undefined && {
          competitorComparisons: comparison.competitorComparisons,
        }),
        ...(comparison.historicalComparison !== undefined && {
          historicalComparison: comparison.historicalComparison,
        }),
        ...(comparison.providerComparison !== undefined && {
          providerComparison: comparison.providerComparison,
        }),
        ...(comparison.contentTypeComparison !== undefined && {
          contentTypeComparison: comparison.contentTypeComparison,
        }),
        keyInsights: comparison.keyInsights,
        recommendations: comparison.recommendations,
        ...(metricsComparison !== undefined && { metricsComparison }),
      });
    } catch (error) {
      return err(
        new UseCaseError(
          `Failed to compare performance: ${error instanceof Error ? error.message : "Unknown error"}`,
          USE_CASE_ERRORS.INTERNAL_ERROR
        )
      );
    }
  }
}
