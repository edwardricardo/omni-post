/**
 * @file GetCrossPlatformAnalyticsUseCase.ts
 * @description Orchestrates retrieval and aggregation of cross-platform social media analytics using standard metric calculations.
 * @layer application
 */

import { type Result, ok, err, isProviderName } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { GetAnalyticsInput, GetAnalyticsOutput, AnalyticsSummary } from "./types.js";

/**
 * Cross-Platform Analytics Engine interface (port)
 */
export interface CrossPlatformAnalyticsPort {
  generateCrossPlatformMetrics(options: {
    accountId: string;
    projectId?: string;
    timeRange: string;
    startDate?: Date;
    endDate?: Date;
    providers?: string[];
    includeCompetitive?: boolean;
  }): Promise<{
    summary: {
      totalPosts: number;
      totalEngagements: number;
      avgEngagementRate: number;
      totalReach: number;
      topPerformingProvider?: string;
    };
    byProvider?: Record<string, unknown>;
    contentInsights?: Record<string, unknown>;
    audienceAnalytics?: Record<string, unknown>;
    benchmarking?: Record<string, unknown>;
    trends?: Record<string, unknown>;
    recommendations?: string[];
  }>;
}

/**
 * Get Cross-Platform Analytics Use Case
 *
 * Generates comprehensive analytics across all social media platforms
 * for an account or specific project.
 */
export class GetCrossPlatformAnalyticsUseCase implements UseCase<
  GetAnalyticsInput,
  GetAnalyticsOutput,
  UseCaseError
> {
  constructor(private readonly analyticsEngine: CrossPlatformAnalyticsPort) {}

  async execute(input: GetAnalyticsInput): Promise<Result<GetAnalyticsOutput, UseCaseError>> {
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

    // Validate custom date range
    if (input.timeRange === "custom") {
      if (!input.startDate || !input.endDate) {
        return err(
          new UseCaseError(
            "Start date and end date are required for custom time range",
            USE_CASE_ERRORS.VALIDATION_FAILED
          )
        );
      }
    }

    try {
      const metrics = await this.analyticsEngine.generateCrossPlatformMetrics({
        accountId: input.accountId,
        ...(input.projectId !== undefined && { projectId: input.projectId }),
        timeRange: input.timeRange,
        ...(input.startDate && { startDate: new Date(input.startDate) }),
        ...(input.endDate && { endDate: new Date(input.endDate) }),
        ...(input.providers !== undefined && { providers: input.providers }),
        ...(input.includeCompetitive !== undefined && {
          includeCompetitive: input.includeCompetitive,
        }),
      });

      // Build summary with conditional topPerformingProvider
      const summary: AnalyticsSummary = {
        totalPosts: metrics.summary.totalPosts,
        totalEngagements: metrics.summary.totalEngagements,
        avgEngagementRate: metrics.summary.avgEngagementRate,
        totalReach: metrics.summary.totalReach,
        ...(metrics.summary.topPerformingProvider !== undefined &&
          isProviderName(metrics.summary.topPerformingProvider) && {
            topPerformingProvider: metrics.summary.topPerformingProvider,
          }),
      };

      return ok({
        summary,
        ...(metrics.byProvider !== undefined && { byProvider: metrics.byProvider }),
        ...(metrics.contentInsights !== undefined && { contentInsights: metrics.contentInsights }),
        ...(metrics.audienceAnalytics !== undefined && {
          audienceAnalytics: metrics.audienceAnalytics,
        }),
        ...(metrics.benchmarking !== undefined && { benchmarking: metrics.benchmarking }),
        ...(metrics.trends !== undefined && { trends: metrics.trends }),
        ...(metrics.recommendations !== undefined && { recommendations: metrics.recommendations }),
        generatedAt: new Date(),
      });
    } catch (error) {
      return err(
        new UseCaseError(
          `Failed to generate analytics: ${error instanceof Error ? error.message : "Unknown error"}`,
          USE_CASE_ERRORS.INTERNAL_ERROR
        )
      );
    }
  }
}
