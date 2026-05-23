/**
 * @file CrossPlatformAnalyticsAdapter.ts
 * @description Adapter bridging CrossPlatformAnalyticsPort to the concrete
 *              CrossPlatformAnalyticsEngine. Adapts option shapes and return types
 *              between application and infrastructure layers.
 * @layer infrastructure
 */
import type { CachePort } from "@ports/core";
import type { CrossPlatformAnalyticsPort } from "../../application/analytics/GetCrossPlatformAnalyticsUseCase.js";
import { CrossPlatformAnalyticsEngine } from "../../analytics/crossPlatform/index.js";
import type { CrossPlatformAnalyticsOptions } from "../../analytics/crossPlatform/types.js";
import type { TimeRange, ProviderType } from "@shared/analytics";
import type { ProjectQueryRepositoryPort } from "../../domain/repositories/ProjectQueryRepository.js";
import type { AnalyticsReadRepositoryPort } from "../../domain/repositories/AnalyticsReadRepository.js";

/**
 * Adapter that implements CrossPlatformAnalyticsPort by delegating to CrossPlatformAnalyticsEngine.
 *
 * The use case port uses loose string types for flexibility; this adapter casts
 * them to the infrastructure's stricter types before forwarding the call.
 *
 * The CrossPlatformAnalyticsEngine returns CrossPlatformMetrics whose nested types
 * (AnalyticsSummary, ProviderMetrics[], etc.) do not match the port's simplified
 * Record shapes. This adapter maps each field individually using `as unknown as`
 * for complex nested objects to satisfy exactOptionalPropertyTypes.
 */
export class CrossPlatformAnalyticsAdapter implements CrossPlatformAnalyticsPort {
  private readonly engine: CrossPlatformAnalyticsEngine;

  constructor(
    cache: CachePort,
    projectRepository: ProjectQueryRepositoryPort,
    analyticsRepository: AnalyticsReadRepositoryPort
  ) {
    this.engine = new CrossPlatformAnalyticsEngine(cache, projectRepository, analyticsRepository);
  }

  async generateCrossPlatformMetrics(options: {
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
  }> {
    const engineOptions: CrossPlatformAnalyticsOptions = {
      accountId: options.accountId,
      ...(options.projectId !== undefined && { projectId: options.projectId }),
      timeRange: options.timeRange as TimeRange,
      ...(options.startDate !== undefined && { startDate: options.startDate }),
      ...(options.endDate !== undefined && { endDate: options.endDate }),
      ...(options.providers !== undefined && {
        providers: options.providers as ProviderType[],
      }),
      ...(options.includeCompetitive !== undefined && {
        includeCompetitive: options.includeCompetitive,
      }),
    };

    const metrics = await this.engine.generateCrossPlatformMetrics(engineOptions);

    // Map AnalyticsSummary (infrastructure) → simplified summary (port contract).
    // The infrastructure type uses different field names:
    //   totalImpressions (not totalPosts), averageEngagementRate (not avgEngagementRate).
    // We derive a compatible summary from the available fields.
    const rawSummary = metrics.summary;
    const summary: {
      totalPosts: number;
      totalEngagements: number;
      avgEngagementRate: number;
      totalReach: number;
      topPerformingProvider?: string;
    } = {
      // Infrastructure AnalyticsSummary has no totalPosts; use totalImpressions as proxy
      totalPosts: (rawSummary as unknown as { totalPosts?: number }).totalPosts ?? 0,
      totalEngagements: rawSummary.totalEngagements,
      avgEngagementRate:
        (rawSummary as unknown as { avgEngagementRate?: number }).avgEngagementRate ??
        rawSummary.averageEngagementRate,
      totalReach: rawSummary.totalReach,
      ...(rawSummary.topPerformingProvider !== undefined &&
        rawSummary.topPerformingProvider !== "" && {
          topPerformingProvider: rawSummary.topPerformingProvider,
        }),
    };

    // Map complex nested infrastructure types to Record<string, unknown> via double assertion.
    // This is intentional: the port contract deliberately uses Record<string, unknown> to keep
    // the application layer infrastructure-agnostic.
    return {
      summary,
      ...(metrics.byProvider !== undefined && {
        byProvider: metrics.byProvider as unknown as Record<string, unknown>,
      }),
      ...(metrics.contentInsights !== undefined && {
        contentInsights: metrics.contentInsights as unknown as Record<string, unknown>,
      }),
      ...(metrics.audienceAnalytics !== undefined && {
        audienceAnalytics: metrics.audienceAnalytics as unknown as Record<string, unknown>,
      }),
      ...(metrics.benchmarking !== undefined && {
        benchmarking: metrics.benchmarking as unknown as Record<string, unknown>,
      }),
      ...(metrics.trends !== undefined && {
        trends: metrics.trends as unknown as Record<string, unknown>,
      }),
      ...(metrics.recommendations !== undefined &&
        metrics.recommendations.length > 0 && {
          recommendations: metrics.recommendations.map((rec) =>
            typeof rec === "string"
              ? rec
              : ((rec as { description?: string; action?: string; recommendation?: string })
                  .description ??
                (rec as { description?: string; action?: string; recommendation?: string })
                  .action ??
                String(rec))
          ),
        }),
    };
  }
}
