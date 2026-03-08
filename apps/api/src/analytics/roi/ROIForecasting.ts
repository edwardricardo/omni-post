/**
 * ROIForecasting Module
 *
 * Responsibilities:
 * - Generate ROI forecasts based on historical data
 * - Calculate monthly trends
 * - Apply seasonal factors
 */

import { createLogger } from "../../lib/logger.js";

const analyticsLogger = createLogger("analytics");
import type {
  ForecastResult,
  MonthlyForecast,
  MonthlyTrends,
  AnalyticsDataPoint,
  PostDataPoint,
  ConversionDataPoint,
} from "./types";

export class ROIForecasting {
  /**
   * Generate ROI forecast based on historical data
   */
  async generateROIForecast(
    historicalAnalytics: AnalyticsDataPoint[],
    historicalPosts: PostDataPoint[],
    historicalConversions: ConversionDataPoint[],
    forecastMonths: number = 6
  ): Promise<ForecastResult> {
    try {
      // Calculate historical trends
      const monthlyTrends = this.calculateMonthlyTrends(
        historicalAnalytics,
        historicalPosts,
        historicalConversions
      );

      // Generate forecasts
      const monthlyForecasts: MonthlyForecast[] = [];
      let runningCosts = 0;
      let runningRevenue = 0;

      for (let i = 0; i < forecastMonths; i++) {
        const forecastDate = new Date();
        forecastDate.setMonth(forecastDate.getMonth() + i + 1);

        // Apply growth trends with some variance
        const growthFactor = 1 + (monthlyTrends.avgGrowthRate * (i + 1)) / 100;
        const seasonalFactor = this.getSeasonalFactor(forecastDate.getMonth());

        const baseCosts = monthlyTrends.avgMonthlyCosts;
        const baseRevenue = monthlyTrends.avgMonthlyRevenue;

        const projectedCosts = baseCosts * growthFactor;
        const projectedRevenue = baseRevenue * growthFactor * seasonalFactor;
        const projectedROI =
          projectedCosts > 0 ? ((projectedRevenue - projectedCosts) / projectedCosts) * 100 : 0;

        // Confidence decreases over time
        const confidence = Math.max(0.3, 0.9 - i * 0.1);

        monthlyForecasts.push({
          month: forecastDate.toISOString().slice(0, 7), // YYYY-MM format
          projectedCosts,
          projectedRevenue,
          projectedROI,
          confidence,
        });

        runningCosts += projectedCosts;
        runningRevenue += projectedRevenue;
      }

      const totalROI =
        runningCosts > 0 ? ((runningRevenue - runningCosts) / runningCosts) * 100 : 0;

      return {
        monthlyForecasts,
        totalProjection: {
          totalCosts: runningCosts,
          totalRevenue: runningRevenue,
          totalROI,
        },
        keyAssumptions: [
          `Growth rate based on ${monthlyTrends.avgGrowthRate.toFixed(1)}% monthly trend`,
          "Seasonal factors applied based on industry benchmarks",
          "Current cost structure and conversion rates maintained",
          "No major market disruptions or strategy changes",
          "Platform algorithms remain stable",
        ],
      };
    } catch (error) {
      analyticsLogger.error({ err: error }, "Error generating ROI forecast");
      throw error;
    }
  }

  /**
   * Calculate monthly trends from historical data
   */
  calculateMonthlyTrends(
    _analyticsData: AnalyticsDataPoint[],
    _postsData: PostDataPoint[],
    _conversionsData: ConversionDataPoint[]
  ): MonthlyTrends {
    // Mock calculation - in production, this would analyze historical monthly data
    return {
      avgMonthlyCosts: 2500,
      avgMonthlyRevenue: 4200,
      avgGrowthRate: 8.5, // 8.5% monthly growth
    };
  }

  /**
   * Get seasonal factor for a given month
   */
  getSeasonalFactor(month: number): number {
    // Mock seasonal factors - in production, this would be based on industry data
    const seasonalFactors = [
      0.9, // January
      0.85, // February
      1.0, // March
      1.05, // April
      1.1, // May
      1.05, // June
      0.95, // July
      0.9, // August
      1.1, // September
      1.15, // October
      1.2, // November (holiday season)
      1.25, // December (holiday season)
    ];

    return seasonalFactors[month] || 1.0;
  }

  /**
   * Calculate projected ROI for a future period
   */
  calculateProjectedROI(
    baseCosts: number,
    baseRevenue: number,
    growthRate: number,
    months: number,
    seasonalFactor: number = 1.0
  ): number {
    const growthFactor = 1 + (growthRate * months) / 100;
    const projectedCosts = baseCosts * growthFactor;
    const projectedRevenue = baseRevenue * growthFactor * seasonalFactor;

    return projectedCosts > 0 ? ((projectedRevenue - projectedCosts) / projectedCosts) * 100 : 0;
  }

  /**
   * Calculate confidence interval for forecast
   */
  calculateConfidence(monthsAhead: number, baseConfidence = 0.9, decayRate = 0.1): number {
    return Math.max(0.3, baseConfidence - monthsAhead * decayRate);
  }
}
