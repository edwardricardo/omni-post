/**
 * @file roiCalculator.ts
 * @description Orchestrates the ROI calculation pipeline by delegating to CostCalculator,
 *              RevenueCalculator, ROIMetrics, ROIForecasting, and ROIRecommendations.
 * @layer infrastructure
 * All types are defined in ./roi/types.ts and re-exported from here for
 * backwards compatibility with existing consumers.
 */
import type Redis from "ioredis";
import type { CachePort } from "@ports/core";
import { createLogger } from "../lib/logger.js";

const analyticsLogger = createLogger("analytics");
import type { ProjectQueryRepositoryPort } from "@core/domain/repositories/ProjectQueryRepository.js";
import type { AnalyticsReadRepositoryPort } from "@core/domain/repositories/AnalyticsReadRepository.js";
import type { ConversionRepositoryPort } from "@core/domain/repositories/ConversionRepository.js";
import type {
  ConversionTypeKind,
  ConversionAttributionKind,
} from "@core/domain/repositories/ReadModelDtos.js";
import { CostCalculator } from "./roi/CostCalculator.js";
import { RevenueCalculator } from "./roi/RevenueCalculator.js";
import { ROIMetrics } from "./roi/ROIMetrics.js";
import { ROIForecasting } from "./roi/ROIForecasting.js";
import { ROIRecommendations } from "./roi/ROIRecommendations.js";
import type {
  ROICalculationOptions,
  CostModel,
  RevenueModel,
  ConversionTracking,
  AnalyticsDataPoint,
  PostDataPoint,
  ConversionDataPoint,
} from "./roi/types.js";
import type { ROICalculation, TimeRange } from "../../../../packages/shared/src/analytics";

// Re-export types consumed by external modules (e.g. ROICalculatorAdapter)
export type {
  ROICalculationOptions,
  CostModel,
  RevenueModel,
  ConversionTracking,
} from "./roi/types.js";

export class ROICalculator {
  // Redis used for `updateRealTimeROI` hgetall/hmset pattern (distributed
  // counters — distinct from cache-aside, which uses CachePort). Injected by the
  // composition root (TOKENS.AnalyticsRedisConnection); never self-constructed.
  private readonly redis: Redis;
  private readonly cachePrefix = "roi:";
  private readonly cacheTTL = 600; // 10 minutes

  private readonly costCalculator: CostCalculator;
  private readonly revenueCalculator: RevenueCalculator;
  private readonly roiMetrics: ROIMetrics;
  private readonly roiForecasting: ROIForecasting;
  private readonly roiRecommendations: ROIRecommendations;

  private readonly defaultCostModel: CostModel;
  private readonly defaultRevenueModel: RevenueModel;

  constructor(
    private readonly projectRepository: ProjectQueryRepositoryPort,
    private readonly analyticsRepository: AnalyticsReadRepositoryPort,
    private readonly conversionRepository: ConversionRepositoryPort,
    private readonly cache: CachePort,
    redis: Redis
  ) {
    this.redis = redis;
    this.costCalculator = new CostCalculator();
    this.revenueCalculator = new RevenueCalculator();
    this.roiMetrics = new ROIMetrics(this.revenueCalculator, this.costCalculator);
    this.roiForecasting = new ROIForecasting();
    this.roiRecommendations = new ROIRecommendations();

    this.defaultCostModel = this.costCalculator.getDefaultCostModel();
    this.defaultRevenueModel = this.revenueCalculator.getDefaultRevenueModel();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Calculate comprehensive ROI metrics.
   */
  async calculateROI(options: ROICalculationOptions): Promise<ROICalculation> {
    const cacheKey = this.generateCacheKey(options);
    return this.cache.getOrSet(cacheKey, () => this.computeROI(options), {
      ttlSeconds: this.cacheTTL,
      tags: ["analytics:roi"],
    });
  }

  private async computeROI(options: ROICalculationOptions): Promise<ROICalculation> {
    try {
      const { startDate, endDate } = this.calculateDateRange(
        options.timeRange,
        options.startDate,
        options.endDate
      );

      const [analyticsData, postsData, conversionsData] = await Promise.all([
        this.getAnalyticsData(options, startDate, endDate),
        this.getPostsData(options, startDate, endDate),
        this.getConversionsData(options, startDate, endDate),
      ]);

      const costModel = options.customCostModel ?? this.defaultCostModel;

      // Cost breakdown
      const costBreakdown = this.costCalculator.calculateCosts(
        postsData,
        costModel,
        startDate,
        endDate
      );

      // Revenue breakdown
      const revenueBreakdown = this.revenueCalculator.calculateRevenue(
        analyticsData,
        conversionsData,
        this.defaultRevenueModel
      );

      // Totals and overall ROI
      const totalCost = Object.values(costBreakdown).reduce(
        (sum, cost) => sum + (typeof cost === "number" ? cost : 0),
        0
      );
      const totalRevenue = this.revenueCalculator.calculateTotalRevenue(revenueBreakdown);
      const roi = this.roiMetrics.calculateOverallROI(totalCost, totalRevenue);

      // Dimension breakdowns
      const roiByProvider = await this.roiMetrics.calculateROIByProvider(
        analyticsData,
        postsData,
        conversionsData,
        costModel
      );

      const roiByContentType = await this.roiMetrics.calculateROIByContentType(
        analyticsData,
        postsData,
        conversionsData
      );

      const roiByTimeRange = this.roiMetrics.calculateROITrends(
        analyticsData,
        conversionsData,
        startDate,
        endDate,
        costModel
      );

      // Recommendations
      const recommendations = this.roiRecommendations.generateROIRecommendations({
        totalCost,
        totalRevenue,
        roi,
        roiByProvider,
        roiByContentType,
        costBreakdown,
        revenueBreakdown,
      });

      const result: ROICalculation = {
        totalCost,
        totalRevenue,
        roi,
        roiByProvider,
        roiByContentType,
        roiByTimeRange,
        costBreakdown,
        revenueBreakdown,
        recommendations,
      };

      return result;
    } catch (error) {
      analyticsLogger.error({ err: error }, "Error calculating ROI");
      throw error;
    }
  }

  /**
   * Track a conversion event.
   */
  async trackConversion(conversion: ConversionTracking): Promise<void> {
    try {
      await this.conversionRepository.record({
        accountId: conversion.accountId,
        source: conversion.source,
        contentId: conversion.contentId,
        // Domain literals are lowercase ("sale", "first_click"); the port speaks
        // the DB-aligned UPPERCASE kinds ("SALE", "FIRST_CLICK").
        conversionType: conversion.conversionType.toUpperCase() as ConversionTypeKind,
        value: conversion.value,
        attribution: conversion.attribution.toUpperCase() as ConversionAttributionKind,
        occurredAt: conversion.timestamp,
      });
      await this.updateRealTimeROI(conversion);
    } catch (error) {
      analyticsLogger.error({ err: error }, "Error tracking conversion");
      throw error;
    }
  }

  /**
   * Calculate cost attribution for different activities.
   */
  async calculateCostAttribution(
    options: ROICalculationOptions
  ): Promise<Record<string, { cost: number; percentage: number }>> {
    const { startDate, endDate } = this.calculateDateRange(
      options.timeRange,
      options.startDate,
      options.endDate
    );
    const costModel = options.customCostModel ?? this.defaultCostModel;
    const postsData = await this.getPostsData(options, startDate, endDate);
    return this.costCalculator.calculateCostAttribution(postsData, costModel, startDate, endDate);
  }

  /**
   * Generate ROI forecast based on historical data.
   */
  async generateROIForecast(
    options: ROICalculationOptions,
    forecastMonths = 6
  ): Promise<{
    monthlyForecasts: Array<{
      month: string;
      projectedCosts: number;
      projectedRevenue: number;
      projectedROI: number;
      confidence: number;
    }>;
    totalProjection: {
      totalCosts: number;
      totalRevenue: number;
      totalROI: number;
    };
    keyAssumptions: string[];
  }> {
    try {
      const historicalEndDate = options.startDate ?? new Date();
      const historicalStartDate = new Date(historicalEndDate.getTime() - 90 * 24 * 60 * 60 * 1000);

      const [historicalAnalytics, historicalPosts, historicalConversions] = await Promise.all([
        this.getAnalyticsData(
          { ...options, timeRange: "90d" },
          historicalStartDate,
          historicalEndDate
        ),
        this.getPostsData({ ...options, timeRange: "90d" }, historicalStartDate, historicalEndDate),
        this.getConversionsData(
          { ...options, timeRange: "90d" },
          historicalStartDate,
          historicalEndDate
        ),
      ]);

      return this.roiForecasting.generateROIForecast(
        historicalAnalytics,
        historicalPosts,
        historicalConversions,
        forecastMonths
      );
    } catch (error) {
      analyticsLogger.error({ err: error }, "Error generating ROI forecast");
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Public helpers (used by tests and ROICalculatorAdapter)
  // ---------------------------------------------------------------------------

  /** Exposed for backwards compatibility with ROICalculator tests and adapter. */
  public calculateCosts(
    postsData: PostDataPoint[],
    costModel: CostModel,
    startDate: Date,
    endDate: Date
  ) {
    return this.costCalculator.calculateCosts(postsData, costModel, startDate, endDate);
  }

  /** Exposed for backwards compatibility. */
  public calculateRevenue(
    analyticsData: AnalyticsDataPoint[],
    conversionsData: ConversionDataPoint[],
    revenueModel: RevenueModel
  ) {
    return this.revenueCalculator.calculateRevenue(analyticsData, conversionsData, revenueModel);
  }

  /** Generate the Redis cache key for a given set of options. */
  public generateCacheKey(options: ROICalculationOptions): string {
    return `${this.cachePrefix}${options.accountId}_${options.projectId ?? "all"}_${options.timeRange}_${options.providers?.join(",") ?? "all"}`;
  }

  /** Compute date range boundaries from a TimeRange identifier. */
  public calculateDateRange(
    timeRange: TimeRange,
    startDate?: Date,
    endDate?: Date
  ): { startDate: Date; endDate: Date } {
    const now = new Date();
    const end = endDate ?? now;

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
        start = startDate ?? new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    return { startDate: start, endDate: end };
  }

  /** Return the seasonal multiplier for a given month (0 = January). */
  public getSeasonalFactor(month: number): number {
    return this.roiForecasting.getSeasonalFactor(month);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async updateRealTimeROI(conversion: ConversionTracking): Promise<void> {
    try {
      const key = `${this.cachePrefix}realtime:${conversion.source}`;
      const currentData = await this.redis.hgetall(key);

      const newRevenue = (parseFloat(currentData["revenue"] ?? "0") || 0) + conversion.value;
      const newConversions = (parseInt(currentData["conversions"] ?? "0") || 0) + 1;

      await this.redis.hmset(
        key,
        "revenue",
        newRevenue.toString(),
        "conversions",
        newConversions.toString(),
        "lastUpdate",
        Date.now().toString()
      );
      await this.redis.expire(key, 3600);
    } catch (error) {
      analyticsLogger.error({ err: error }, "Error updating real-time ROI");
    }
  }

  /** Resolve the post IDs in scope for an ROI query (a single project, or every project of the account). */
  private async resolvePostIds(options: ROICalculationOptions): Promise<string[]> {
    if (options.projectId) {
      return this.projectRepository.getPostIds(options.projectId);
    }
    const projects = await this.projectRepository.getByAccountId(options.accountId);
    const postIdsArrays = await Promise.all(
      projects.map((p) => this.projectRepository.getPostIds(p.id))
    );
    return postIdsArrays.flat();
  }

  private async getAnalyticsData(
    options: ROICalculationOptions,
    startDate: Date,
    endDate: Date
  ): Promise<AnalyticsDataPoint[]> {
    const postIds = await this.resolvePostIds(options);
    if (postIds.length === 0) return [];

    const records = await this.analyticsRepository.getByPostIds(postIds, {
      startDate,
      endDate,
      orderBy: { capturedAt: "asc" },
    });

    const providerFilter =
      options.providers && options.providers.length > 0 ? new Set(options.providers) : null;
    const filtered = providerFilter
      ? records.filter((r) => providerFilter.has(r.provider))
      : records;

    return filtered as AnalyticsDataPoint[];
  }

  private async getPostsData(
    options: ROICalculationOptions,
    startDate: Date,
    endDate: Date
  ): Promise<PostDataPoint[]> {
    const projectIds = options.projectId
      ? [options.projectId]
      : (await this.projectRepository.getByAccountId(options.accountId)).map((p) => p.id);

    const postsByProject = await Promise.all(
      projectIds.map((id) => this.projectRepository.getPostsWithContent(id))
    );

    return postsByProject
      .flat()
      .filter((p) => p.createdAt >= startDate && p.createdAt <= endDate)
      .map((p) => ({ id: p.id }));
  }

  private async getConversionsData(
    options: ROICalculationOptions,
    startDate: Date,
    endDate: Date
  ): Promise<ConversionDataPoint[]> {
    const conversions = await this.conversionRepository.findByAccount(options.accountId, {
      start: startDate,
      end: endDate,
    });

    const providerFilter =
      options.providers && options.providers.length > 0 ? new Set(options.providers) : null;

    return conversions
      .filter((c) => (providerFilter ? providerFilter.has(c.source) : true))
      .map((c) => ({
        source: c.source,
        content_id: c.contentId,
        // RevenueCalculator / ROIMetrics match lowercase domain literals.
        conversion_type: c.conversionType.toLowerCase(),
        value: c.value,
        timestamp: c.occurredAt,
      }));
  }
}
