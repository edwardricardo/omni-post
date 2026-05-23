/**
 * @file index.ts
 * @description Main orchestrator that coordinates all analytics modules to generate
 *              comprehensive cross-platform metrics.
 * @layer infrastructure
 */

import type { CachePort } from "@ports/core";
import { createLogger } from "../../lib/logger.js";

const analyticsLogger = createLogger("analytics");

import type { CrossPlatformMetrics, TimeRange } from "@shared/analytics";
import type { ProjectQueryRepositoryPort } from "../../domain/repositories/ProjectQueryRepository.js";
import type { AnalyticsReadRepositoryPort } from "../../domain/repositories/AnalyticsReadRepository.js";

import type { CrossPlatformAnalyticsOptions } from "./types";
import { getAnalyticsData, getPostsData, getChannelsData, getCompetitorData } from "./dataFetcher";
import { generateSummary, generateProviderMetrics } from "./summaryGenerator";
import { generateContentInsights } from "./contentAnalyzer";
// Future: audienceAnalyzer — deleted (100% fake demographics data)
import { generateTrendAnalysis } from "./trendAnalyzer";
import { generateCompetitiveAnalysis, generateBasicBenchmarking } from "./competitiveAnalyzer";
import { generateRecommendations } from "./recommendationEngine";

// Re-export types and options for external use
export type { CrossPlatformAnalyticsOptions } from "./types";
export type { CrossPlatformMetrics } from "@shared/analytics";

/**
 * Cross-Platform Analytics Engine
 *
 * Generates comprehensive analytics across all social media platforms.
 * Uses caching to optimize performance for repeated queries.
 */
export class CrossPlatformAnalyticsEngine {
  private cachePrefix = "analytics:cross_platform:";
  private cacheTTL = 300; // 5 minutes

  constructor(
    private readonly cache: CachePort,
    private readonly projectRepository: ProjectQueryRepositoryPort,
    private readonly analyticsRepository: AnalyticsReadRepositoryPort
  ) {}

  /**
   * Generate comprehensive cross-platform analytics
   */
  async generateCrossPlatformMetrics(
    options: CrossPlatformAnalyticsOptions
  ): Promise<CrossPlatformMetrics> {
    const cacheKey = this.generateCacheKey(options);
    return this.cache.getOrSet(cacheKey, () => this.computeCrossPlatformMetrics(options), {
      ttlSeconds: this.cacheTTL,
      tags: ["analytics:cross-platform"],
    });
  }

  private async computeCrossPlatformMetrics(
    options: CrossPlatformAnalyticsOptions
  ): Promise<CrossPlatformMetrics> {
    try {
      // Get date range
      const { startDate, endDate } = this.calculateDateRange(
        options.timeRange,
        options.startDate,
        options.endDate
      );

      // Get all relevant data in parallel
      const [analyticsData, postsData, channelsData, competitorData] = await Promise.all([
        getAnalyticsData(
          options,
          startDate,
          endDate,
          this.analyticsRepository,
          this.projectRepository
        ),
        getPostsData(options, startDate, endDate, this.projectRepository),
        getChannelsData(options, this.projectRepository),
        options.includeCompetitive ? getCompetitorData(options) : null,
      ]);

      // Process core metrics in parallel where possible
      const [summary, byProvider, contentInsights, trends] = await Promise.all([
        generateSummary(analyticsData, postsData),
        generateProviderMetrics(analyticsData, postsData, channelsData),
        generateContentInsights(analyticsData, postsData),
        generateTrendAnalysis(analyticsData, startDate, endDate),
      ]);

      // Future: audienceAnalytics — requires real provider API demographic data
      const audienceAnalytics = undefined;

      // Generate competitive analysis if requested
      const benchmarking =
        options.includeCompetitive && competitorData
          ? await generateCompetitiveAnalysis(analyticsData, competitorData)
          : await generateBasicBenchmarking(analyticsData);

      // Generate rule-based recommendations
      const recommendations = await generateRecommendations({
        summary,
        byProvider,
        contentInsights,
        trends,
      });

      const result: CrossPlatformMetrics = {
        summary,
        byProvider,
        contentInsights,
        ...(audienceAnalytics !== undefined && { audienceAnalytics }),
        benchmarking,
        trends,
        recommendations,
      };

      return result;
    } catch (error) {
      analyticsLogger.error({ err: error }, "Error generating cross-platform metrics");
      throw error;
    }
  }

  /**
   * Generate cache key for analytics options
   */
  public generateCacheKey(options: CrossPlatformAnalyticsOptions): string {
    const key = `${this.cachePrefix}${options.accountId}_${options.projectId || "all"}_${options.timeRange}_${options.providers?.join(",") || "all"}`;
    return key;
  }

  /**
   * Group analytics data by provider
   *
   * Delegates to the summaryGenerator module.
   * Exposed as a public method for testability.
   *
   * @param analyticsData - Array of analytics records with at minimum a `provider` field
   * @returns Analytics records grouped by provider name
   */
  public groupByProvider(
    analyticsData: Array<{ provider: string | { toString(): string } }>
  ): Record<string, Array<{ provider: string | { toString(): string } }>> {
    const groups: Record<string, Array<{ provider: string | { toString(): string } }>> = {};
    analyticsData.forEach((analytics) => {
      const provider = analytics.provider.toString();
      if (!groups[provider]) {
        groups[provider] = [];
      }
      groups[provider]!.push(analytics);
    });
    return groups;
  }

  /**
   * Find the top performing provider by engagement rate
   *
   * Delegates to the summaryGenerator module.
   * Exposed as a public method for testability.
   *
   * @param providerPerformance - Analytics records grouped by provider name
   * @returns Name of the provider with the highest engagement rate
   */
  public findTopPerformingProvider(
    providerPerformance: Record<
      string,
      Array<{
        views?: number | null;
        likes?: number | null;
        comments?: number | null;
        shares?: number | null;
      }>
    >
  ): string {
    let topProvider = "";
    let bestEngagementRate = 0;

    for (const [provider, analytics] of Object.entries(providerPerformance)) {
      const totalImpressions = analytics.reduce((sum, a) => sum + (a.views ?? 0), 0);
      const totalEngagements = analytics.reduce(
        (sum, a) => sum + (a.likes ?? 0) + (a.comments ?? 0) + (a.shares ?? 0),
        0
      );
      const engagementRate = totalImpressions > 0 ? (totalEngagements / totalImpressions) * 100 : 0;

      if (engagementRate > bestEngagementRate) {
        bestEngagementRate = engagementRate;
        topProvider = provider;
      }
    }

    return topProvider || "twitter";
  }

  /**
   * Calculate date range from time range option
   */
  public calculateDateRange(
    timeRange: TimeRange,
    startDate?: Date,
    endDate?: Date
  ): { startDate: Date; endDate: Date } {
    const now = new Date();
    const end = endDate || now;

    let start: Date;
    switch (timeRange) {
      case "7d":
        start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "90d":
        start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case "1y":
        start = new Date(end.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      case "custom":
        start = startDate || new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    return { startDate: start, endDate: end };
  }
}
