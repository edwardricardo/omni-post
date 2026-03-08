/**
 * ROIMetrics Module
 *
 * Responsibilities:
 * - Calculate ROI by provider
 * - Calculate ROI by content type
 * - Calculate ROI trends over time
 */

import type {
  ROIMetric,
  ProviderType,
  ContentType,
  CostModel,
  RevenueModel,
  TrendDataPoint,
  AnalyticsDataPoint,
  PostDataPoint,
  ConversionDataPoint,
} from "./types";
import { RevenueCalculator } from "./RevenueCalculator";
import { CostCalculator } from "./CostCalculator";

export class ROIMetrics {
  private revenueCalculator: RevenueCalculator;
  private costCalculator: CostCalculator;
  private defaultRevenueModel: RevenueModel;

  constructor(revenueCalculator: RevenueCalculator, costCalculator: CostCalculator) {
    this.revenueCalculator = revenueCalculator;
    this.costCalculator = costCalculator;
    this.defaultRevenueModel = revenueCalculator.getDefaultRevenueModel();
  }

  /**
   * Calculate ROI metrics by provider
   */
  async calculateROIByProvider(
    analyticsData: AnalyticsDataPoint[],
    postsData: PostDataPoint[],
    conversionsData: ConversionDataPoint[],
    costModel: CostModel
  ): Promise<Record<ProviderType, ROIMetric>> {
    const providers = [
      ...new Set(analyticsData.map((a) => a.provider.toString())),
    ] as ProviderType[];
    const result: Record<ProviderType, ROIMetric> = {} as Record<ProviderType, ROIMetric>;

    for (const provider of providers) {
      const providerAnalytics = analyticsData.filter((a) => a.provider.toString() === provider);
      const providerPosts = postsData.filter((p) =>
        // Assuming posts have channels that indicate provider
        p.channels?.some((c) => c.provider === provider)
      );
      const providerConversions = conversionsData.filter((c) => c.source === provider);

      // Calculate costs for this provider
      const cost = this.costCalculator.calculateProviderCosts(providerPosts, provider, costModel);

      // Calculate revenue for this provider
      const revenue = this.revenueCalculator.calculateProviderRevenue(
        providerAnalytics,
        providerConversions,
        this.defaultRevenueModel
      );

      // Calculate metrics
      const roi = cost > 0 ? ((revenue - cost) / cost) * 100 : 0;
      const conversions = providerConversions.length;
      const costPerConversion = conversions > 0 ? cost / conversions : 0;

      const impressions = providerAnalytics.reduce((sum, a) => sum + (a.views || 0), 0);
      const estimatedClicks = Math.floor(impressions * 0.02);
      const conversionRate = estimatedClicks > 0 ? (conversions / estimatedClicks) * 100 : 0;

      result[provider] = {
        cost,
        revenue,
        roi,
        conversions,
        costPerConversion,
        conversionRate,
      };
    }

    return result;
  }

  /**
   * Calculate ROI metrics by content type
   */
  async calculateROIByContentType(
    analyticsData: AnalyticsDataPoint[],
    postsData: PostDataPoint[],
    _conversionsData: ConversionDataPoint[]
  ): Promise<Record<ContentType, ROIMetric>> {
    // Mock content type classification - in production, this would analyze actual content
    const contentTypes: ContentType[] = ["text", "image", "video", "carousel"];
    const result: Record<ContentType, ROIMetric> = {} as Record<ContentType, ROIMetric>;

    for (const contentType of contentTypes) {
      // Mock classification: distribute posts across content types
      const typeIndex = contentTypes.indexOf(contentType);
      const typePosts = postsData.filter((_, index) => index % contentTypes.length === typeIndex);
      const typeAnalytics = analyticsData.filter(
        (a) => a.postId && typePosts.some((p) => p.id === a.postId)
      );

      // Calculate costs (simplified)
      const cost = typePosts.length * 30; // $30 average per post

      // Calculate revenue
      const impressions = typeAnalytics.reduce((sum, a) => sum + (a.views || 0), 0);
      const revenue =
        impressions * this.defaultRevenueModel.brandAwarenessValue +
        Math.floor(impressions * 0.02) * this.defaultRevenueModel.organicTrafficValue;

      // Calculate metrics
      const roi = cost > 0 ? ((revenue - cost) / cost) * 100 : 0;
      const conversions = Math.floor(typeAnalytics.length * 0.1); // Mock conversions
      const costPerConversion = conversions > 0 ? cost / conversions : 0;
      const conversionRate = 2.5; // Mock conversion rate

      result[contentType] = {
        cost,
        revenue,
        roi,
        conversions,
        costPerConversion,
        conversionRate,
      };
    }

    return result;
  }

  /**
   * Calculate ROI trends over time
   */
  calculateROITrends(
    analyticsData: AnalyticsDataPoint[],
    conversionsData: ConversionDataPoint[],
    startDate: Date,
    endDate: Date,
    _costModel: CostModel
  ): TrendDataPoint[] {
    const trends: TrendDataPoint[] = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const dayStart = new Date(currentDate);
      const dayEnd = new Date(currentDate);
      dayEnd.setHours(23, 59, 59, 999);

      // Get data for this day
      const dayAnalytics = analyticsData.filter((a) => {
        const capturedAt = new Date(a.capturedAt);
        return capturedAt >= dayStart && capturedAt <= dayEnd;
      });

      const dayConversions = conversionsData.filter((c) => {
        const timestamp = new Date(c.timestamp);
        return timestamp >= dayStart && timestamp <= dayEnd;
      });

      // Calculate daily costs (simplified)
      const dailyCost = dayAnalytics.length * 5; // $5 per analytics entry (rough estimate)

      // Calculate daily revenue
      const dailyRevenue =
        dayConversions.reduce((sum, c) => sum + c.value, 0) +
        dayAnalytics.reduce((sum, a) => sum + (a.views || 0), 0) *
          this.defaultRevenueModel.brandAwarenessValue;

      // Calculate ROI
      const roi = dailyCost > 0 ? ((dailyRevenue - dailyCost) / dailyCost) * 100 : 0;

      const previousTrend = trends.length > 0 ? trends[trends.length - 1] : null;
      trends.push({
        date: new Date(currentDate),
        value: roi,
        change: previousTrend ? roi - previousTrend.value : 0,
        changePercentage:
          previousTrend && previousTrend.value !== 0
            ? ((roi - previousTrend.value) / Math.abs(previousTrend.value)) * 100
            : 0,
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return trends;
  }

  /**
   * Calculate overall ROI from cost and revenue
   */
  calculateOverallROI(totalCost: number, totalRevenue: number): number {
    return totalCost > 0 ? ((totalRevenue - totalCost) / totalCost) * 100 : 0;
  }
}
