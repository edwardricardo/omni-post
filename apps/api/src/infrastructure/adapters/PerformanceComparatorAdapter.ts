/**
 * @file PerformanceComparatorAdapter.ts
 * @description Adapter bridging PerformanceComparatorPort to the concrete
 *              PerformanceComparator service. Adapts option and return shapes
 *              between application and infrastructure layers.
 * @layer infrastructure
 */
import type { PerformanceComparatorPort } from "../../application/analytics/ComparePerformanceUseCase.js";
import type { PerformanceSnapshot } from "../../application/analytics/types.js";
import { PerformanceComparator } from "../../analytics/performanceComparison/index.js";
import type { PerformanceComparisonOptions } from "../../analytics/performanceComparison/types.js";
import type { TimeRange, ProviderType, MetricType } from "@shared/analytics";
import type { ProjectQueryRepositoryPort } from "../../domain/repositories/ProjectQueryRepository.js";
import { PrismaProjectQueryRepository } from "../repositories/PrismaProjectQueryRepository.js";
import { prisma } from "@infra/prisma";

/**
 * Adapter that implements PerformanceComparatorPort by delegating to PerformanceComparator.
 *
 * Handles the mismatch between the use case's generic string types and the
 * infrastructure's branded enum types, and maps complex nested objects to the
 * simplified shapes expected by the use case.
 */
export class PerformanceComparatorAdapter implements PerformanceComparatorPort {
  private readonly comparator: PerformanceComparator;

  constructor(projectRepository?: ProjectQueryRepositoryPort) {
    // Fallback to Prisma-backed instance when not injected (e.g. DI container setup)
    const repo = projectRepository ?? new PrismaProjectQueryRepository(prisma);
    this.comparator = new PerformanceComparator(repo);
  }

  async generatePerformanceComparison(options: {
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
  }> {
    const comparatorOptions: PerformanceComparisonOptions = {
      accountId: options.accountId,
      ...(options.projectId !== undefined && { projectId: options.projectId }),
      timeRange: options.timeRange as TimeRange,
      ...(options.startDate !== undefined && { startDate: options.startDate }),
      ...(options.endDate !== undefined && { endDate: options.endDate }),
      ...(options.providers !== undefined && {
        providers: options.providers as ProviderType[],
      }),
      ...(options.includeIndustryBenchmarks !== undefined && {
        includeIndustryBenchmarks: options.includeIndustryBenchmarks,
      }),
      ...(options.includeHistoricalComparison !== undefined && {
        includeHistoricalComparison: options.includeHistoricalComparison,
      }),
      ...(options.includeCompetitorData !== undefined && {
        includeCompetitorData: options.includeCompetitorData,
      }),
    };

    const result = await this.comparator.generatePerformanceComparison(comparatorOptions);

    // Map the infrastructure PerformanceSnapshot to the use case PerformanceSnapshot
    // The infrastructure type has more fields; we project to the subset the use case needs
    const currentPerformance: PerformanceSnapshot = {
      totalPosts: result.currentPerformance.totalPosts,
      totalEngagements: result.currentPerformance.totalEngagements,
      avgEngagementRate: result.currentPerformance.avgEngagementRate,
      ...(result.currentPerformance.totalReach !== undefined && {
        totalReach: result.currentPerformance.totalReach,
      }),
      ...(result.currentPerformance.clickThroughRate !== undefined && {
        clickThroughRate: result.currentPerformance.clickThroughRate,
      }),
      ...(result.currentPerformance.followerGrowth !== undefined && {
        followerGrowth: result.currentPerformance.followerGrowth,
      }),
      ...(result.currentPerformance.roi !== undefined && {
        roi: result.currentPerformance.roi,
      }),
    };

    // Build keyInsights — infra returns PerformanceInsight objects; use case expects strings
    const keyInsights = result.keyInsights.map((insight) =>
      typeof insight === "string"
        ? insight
        : ((insight as { description?: string }).description ?? String(insight))
    );

    // Build recommendations — infra returns PerformanceRecommendation objects; use case expects strings
    const recommendations = result.recommendations.map((rec) =>
      typeof rec === "string"
        ? rec
        : ((rec as { recommendation?: string; description?: string; title?: string })
            .recommendation ??
          (rec as { recommendation?: string; description?: string; title?: string }).description ??
          (rec as { recommendation?: string; description?: string; title?: string }).title ??
          String(rec))
    );

    return {
      currentPerformance,
      ...(result.industryBenchmarks &&
        result.industryBenchmarks.length > 0 && {
          industryBenchmarks: result.industryBenchmarks,
        }),
      ...(result.competitorComparisons &&
        result.competitorComparisons.length > 0 && {
          competitorComparisons: result.competitorComparisons,
        }),
      // HistoricalComparison is a rich nested type — double-assert via unknown to satisfy
      // exactOptionalPropertyTypes without adding an index signature to the infrastructure type.
      ...(result.historicalComparison !== undefined && {
        historicalComparison: result.historicalComparison as unknown as Record<string, unknown>,
      }),
      ...(result.providerComparison &&
        result.providerComparison.length > 0 && {
          providerComparison: result.providerComparison as unknown as Record<string, unknown>,
        }),
      ...(result.contentTypeComparison &&
        result.contentTypeComparison.length > 0 && {
          contentTypeComparison: result.contentTypeComparison as unknown as Record<string, unknown>,
        }),
      keyInsights,
      recommendations,
    };
  }

  async compareMetricsOverTime(
    options: Record<string, unknown>,
    metrics: string[],
    periods: string[]
  ): Promise<{
    metrics: string[];
    periods: unknown[];
    trends: Record<string, unknown>;
    insights: string[];
  }> {
    const comparatorOptions: PerformanceComparisonOptions = {
      accountId: String(options["accountId"] ?? ""),
      ...(options["projectId"] !== undefined && { projectId: String(options["projectId"]) }),
      timeRange: "30d" as TimeRange,
      ...(options["providers"] !== undefined && {
        providers: options["providers"] as ProviderType[],
      }),
    };

    const result = await this.comparator.compareMetricsOverTime(
      comparatorOptions,
      metrics as MetricType[],
      periods as TimeRange[]
    );

    return {
      metrics: result.metrics as string[],
      periods: result.periods as unknown[],
      trends: result.trends as unknown as Record<string, unknown>,
      insights: result.insights,
    };
  }
}
