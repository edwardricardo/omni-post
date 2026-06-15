/**
 * @file RevenueCalculator.ts
 * @description Calculates revenue breakdowns by source, tracks conversion values,
 *              and estimates brand awareness and organic traffic value.
 * @layer infrastructure
 */

import type {
  RevenueBreakdown,
  RevenueModel,
  AnalyticsDataPoint,
  ConversionDataPoint,
} from "./types.js";
import { AnalyticsAggregator } from "../analyticsUtils.js";

export class RevenueCalculator {
  /**
   * Get default revenue model
   */
  getDefaultRevenueModel(): RevenueModel {
    return {
      conversionRate: 2.5, // 2.5% of clicks convert
      averageOrderValue: 85,
      customerLifetimeValue: 450,
      brandAwarenessValue: 0.002, // $0.002 per impression
      leadGenerationValue: 15, // $15 per lead
      organicTrafficValue: 0.5, // $0.50 per organic click
    };
  }

  /**
   * Calculate comprehensive revenue breakdown
   * Uses AnalyticsAggregator for metric calculations
   */
  calculateRevenue(
    analyticsData: AnalyticsDataPoint[],
    conversionsData: ConversionDataPoint[],
    revenueModel: RevenueModel
  ): RevenueBreakdown {
    // Calculate direct revenue from tracked conversions
    const directSales = conversionsData
      .filter((c) => c.conversion_type === "sale")
      .reduce((sum, c) => sum + c.value, 0);

    const leadGeneration =
      conversionsData.filter((c) => c.conversion_type === "lead" || c.conversion_type === "signup")
        .length * revenueModel.leadGenerationValue;

    // Use AnalyticsAggregator for engagement metrics
    const metrics = AnalyticsAggregator.calculateEngagementMetrics(analyticsData);

    // Calculate brand awareness value
    const brandAwareness = metrics.totalViews * revenueModel.brandAwarenessValue;

    // Calculate organic traffic value
    const estimatedClicks = Math.floor(metrics.totalViews * 0.02); // 2% CTR estimate
    const organicTraffic = estimatedClicks * revenueModel.organicTrafficValue;

    // Customer retention value (based on engagement)
    const customerRetention = metrics.totalEngagement * 0.1; // $0.10 per engagement for retention

    // Paid traffic value (if any advertising)
    const paidTraffic = 0; // Would be calculated based on ad performance

    return {
      directSales,
      leadGeneration,
      brandAwareness,
      customerRetention,
      organicTraffic,
      paidTraffic,
    };
  }

  /**
   * Calculate revenue for a specific provider
   */
  calculateProviderRevenue(
    providerAnalytics: AnalyticsDataPoint[],
    providerConversions: ConversionDataPoint[],
    revenueModel: RevenueModel
  ): number {
    // Calculate direct revenue from conversions
    const directRevenue = providerConversions.reduce((sum, c) => sum + c.value, 0);

    // Calculate brand awareness revenue
    const impressions = providerAnalytics.reduce((sum, a) => sum + (a.views || 0), 0);
    const brandAwarenessRevenue = impressions * revenueModel.brandAwarenessValue;

    // Calculate organic traffic revenue
    const estimatedClicks = Math.floor(impressions * 0.02);
    const organicRevenue = estimatedClicks * revenueModel.organicTrafficValue;

    return directRevenue + brandAwarenessRevenue + organicRevenue;
  }

  /**
   * Calculate estimated clicks from analytics data
   */
  calculateEstimatedClicks(analyticsData: AnalyticsDataPoint[], ctrRate = 0.02): number {
    const totalViews = analyticsData.reduce((sum, a) => sum + (a.views || 0), 0);
    return Math.floor(totalViews * ctrRate);
  }

  /**
   * Calculate total revenue from all sources
   */
  calculateTotalRevenue(revenueBreakdown: RevenueBreakdown): number {
    return Object.values(revenueBreakdown).reduce((sum, revenue) => sum + revenue, 0);
  }
}
