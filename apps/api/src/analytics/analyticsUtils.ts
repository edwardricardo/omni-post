/**
 * Phase 3.3: Backend Service Consolidation - Analytics Aggregator
 *
 * Provides consistent analytics calculation and aggregation methods
 * across all analytics services. Eliminates 224-336 lines of duplication.
 *
 * Features:
 * - Engagement metrics calculation
 * - Performance statistics
 * - Time-series data grouping
 * - Rate calculations
 * - Comparison metrics
 */

import type { Analytics } from "@infra/prisma";

export interface EngagementMetrics {
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalEngagement: number;
  avgEngagementRate: number;
  avgViewsPerPost: number;
  avgLikesPerPost: number;
  avgCommentsPerPost: number;
  avgSharesPerPost: number;
}

export interface TimeSeriesDataPoint {
  date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagement: number;
  engagementRate: number;
  posts: number;
}

type GroupingPeriod = "hour" | "day" | "week" | "month";

/**
 * Analytics Aggregator - Centralized analytics calculations
 * Eliminates duplicate aggregation logic across multiple services
 */
export class AnalyticsAggregator {
  /**
   * Calculate engagement metrics from analytics array
   *
   * @example
   * const metrics = AnalyticsAggregator.calculateEngagementMetrics(analytics);
   * console.log(`Total engagement: ${metrics.totalEngagement}`);
   */
  static calculateEngagementMetrics(analytics: Analytics[]): EngagementMetrics {
    if (analytics.length === 0) {
      return {
        totalViews: 0,
        totalLikes: 0,
        totalComments: 0,
        totalShares: 0,
        totalEngagement: 0,
        avgEngagementRate: 0,
        avgViewsPerPost: 0,
        avgLikesPerPost: 0,
        avgCommentsPerPost: 0,
        avgSharesPerPost: 0,
      };
    }

    const totalViews = analytics.reduce((sum, a) => sum + (a.views || 0), 0);
    const totalLikes = analytics.reduce((sum, a) => sum + (a.likes || 0), 0);
    const totalComments = analytics.reduce((sum, a) => sum + (a.comments || 0), 0);
    const totalShares = analytics.reduce((sum, a) => sum + (a.shares || 0), 0);

    const totalEngagement = totalLikes + totalComments + totalShares;
    const avgEngagementRate = totalViews > 0 ? (totalEngagement / totalViews) * 100 : 0;

    const postCount = analytics.length;

    return {
      totalViews,
      totalLikes,
      totalComments,
      totalShares,
      totalEngagement,
      avgEngagementRate,
      avgViewsPerPost: totalViews / postCount,
      avgLikesPerPost: totalLikes / postCount,
      avgCommentsPerPost: totalComments / postCount,
      avgSharesPerPost: totalShares / postCount,
    };
  }

  /**
   * Calculate engagement rate for a single analytics entry
   */
  static calculateEngagementRate(analytics: Analytics): number {
    const views = analytics.views || 0;
    if (views === 0) return 0;

    const engagement = (analytics.likes || 0) + (analytics.comments || 0) + (analytics.shares || 0);

    return (engagement / views) * 100;
  }

  /**
   * Group analytics by time period
   *
   * @example
   * const dailyData = AnalyticsAggregator.groupByPeriod(analytics, 'day');
   * console.log(dailyData); // [{ date: '2024-01-01', views: 1000, ... }]
   */
  static groupByPeriod(
    analytics: Analytics[],
    period: GroupingPeriod = "day"
  ): TimeSeriesDataPoint[] {
    const grouped = new Map<string, Analytics[]>();

    // Group analytics by period
    analytics.forEach((analytic) => {
      const dateKey = this.getDateKey(analytic.capturedAt, period);
      const existing = grouped.get(dateKey) || [];
      existing.push(analytic);
      grouped.set(dateKey, existing);
    });

    // Convert to time series data points
    const dataPoints: TimeSeriesDataPoint[] = [];

    for (const [date, group] of Array.from(grouped.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      const metrics = this.calculateEngagementMetrics(group);

      dataPoints.push({
        date,
        views: metrics.totalViews,
        likes: metrics.totalLikes,
        comments: metrics.totalComments,
        shares: metrics.totalShares,
        engagement: metrics.totalEngagement,
        engagementRate: metrics.avgEngagementRate,
        posts: group.length,
      });
    }

    return dataPoints;
  }

  /**
   * Get date key for grouping based on period
   */
  private static getDateKey(date: Date, period: GroupingPeriod): string {
    const d = new Date(date);

    switch (period) {
      case "hour":
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:00`;

      case "day":
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      case "week": {
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay()); // Start on Sunday
        return `${weekStart.getFullYear()}-W${String(this.getWeekNumber(weekStart)).padStart(2, "0")}`;
      }

      case "month":
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

      default:
        return d.toISOString().split("T")[0]!;
    }
  }

  /**
   * Get ISO week number
   */
  private static getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }

  /**
   * Find top performing posts by engagement rate
   */
  static findTopPerforming(analytics: Analytics[], limit = 10): Analytics[] {
    return [...analytics]
      .sort((a, b) => {
        const rateA = this.calculateEngagementRate(a);
        const rateB = this.calculateEngagementRate(b);
        return rateB - rateA;
      })
      .slice(0, limit);
  }

  /**
   * Find poor performing posts by engagement rate
   */
  static findPoorPerforming(analytics: Analytics[], limit = 10): Analytics[] {
    return [...analytics]
      .filter((a) => (a.views || 0) > 100) // Only include posts with meaningful views
      .sort((a, b) => {
        const rateA = this.calculateEngagementRate(a);
        const rateB = this.calculateEngagementRate(b);
        return rateA - rateB;
      })
      .slice(0, limit);
  }

  /**
   * Calculate growth rate between two periods
   */
  static calculateGrowthRate(
    current: EngagementMetrics,
    previous: EngagementMetrics
  ): {
    viewsGrowth: number;
    likesGrowth: number;
    commentsGrowth: number;
    sharesGrowth: number;
    engagementGrowth: number;
    engagementRateGrowth: number;
  } {
    const calculateGrowth = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous) * 100;
    };

    return {
      viewsGrowth: calculateGrowth(current.totalViews, previous.totalViews),
      likesGrowth: calculateGrowth(current.totalLikes, previous.totalLikes),
      commentsGrowth: calculateGrowth(current.totalComments, previous.totalComments),
      sharesGrowth: calculateGrowth(current.totalShares, previous.totalShares),
      engagementGrowth: calculateGrowth(current.totalEngagement, previous.totalEngagement),
      engagementRateGrowth: calculateGrowth(current.avgEngagementRate, previous.avgEngagementRate),
    };
  }

  /**
   * Calculate percentile for a metric
   */
  static calculatePercentile(
    analytics: Analytics[],
    metric: keyof Analytics,
    value: number
  ): number {
    const values = analytics
      .map((a) => a[metric] as number)
      .filter((v) => typeof v === "number")
      .sort((a, b) => a - b);

    if (values.length === 0) return 0;

    const index = values.findIndex((v) => v >= value);
    if (index === -1) return 100;

    return (index / values.length) * 100;
  }

  /**
   * Calculate average metrics over time windows
   */
  static calculateMovingAverage(
    dataPoints: TimeSeriesDataPoint[],
    windowSize = 7
  ): TimeSeriesDataPoint[] {
    if (dataPoints.length < windowSize) {
      return dataPoints;
    }

    const result: TimeSeriesDataPoint[] = [];

    for (let i = windowSize - 1; i < dataPoints.length; i++) {
      const window = dataPoints.slice(i - windowSize + 1, i + 1);

      const avgViews = window.reduce((sum, d) => sum + d.views, 0) / windowSize;
      const avgLikes = window.reduce((sum, d) => sum + d.likes, 0) / windowSize;
      const avgComments = window.reduce((sum, d) => sum + d.comments, 0) / windowSize;
      const avgShares = window.reduce((sum, d) => sum + d.shares, 0) / windowSize;
      const avgEngagement = window.reduce((sum, d) => sum + d.engagement, 0) / windowSize;
      const avgRate = window.reduce((sum, d) => sum + d.engagementRate, 0) / windowSize;
      const totalPosts = window.reduce((sum, d) => sum + d.posts, 0);

      const currentPoint = dataPoints[i];
      if (!currentPoint) continue;

      result.push({
        date: currentPoint.date,
        views: avgViews,
        likes: avgLikes,
        comments: avgComments,
        shares: avgShares,
        engagement: avgEngagement,
        engagementRate: avgRate,
        posts: totalPosts,
      });
    }

    return result;
  }

  /**
   * Compare analytics between two groups (e.g., two time periods, two providers)
   */
  static compareGroups(
    groupA: Analytics[],
    groupB: Analytics[]
  ): {
    groupA: EngagementMetrics;
    groupB: EngagementMetrics;
    difference: EngagementMetrics;
    percentChange: EngagementMetrics;
  } {
    const metricsA = this.calculateEngagementMetrics(groupA);
    const metricsB = this.calculateEngagementMetrics(groupB);

    const calculateDiff = (a: number, b: number): number => a - b;
    const calculatePercent = (a: number, b: number): number => {
      if (b === 0) return a > 0 ? 100 : 0;
      return ((a - b) / b) * 100;
    };

    return {
      groupA: metricsA,
      groupB: metricsB,
      difference: {
        totalViews: calculateDiff(metricsA.totalViews, metricsB.totalViews),
        totalLikes: calculateDiff(metricsA.totalLikes, metricsB.totalLikes),
        totalComments: calculateDiff(metricsA.totalComments, metricsB.totalComments),
        totalShares: calculateDiff(metricsA.totalShares, metricsB.totalShares),
        totalEngagement: calculateDiff(metricsA.totalEngagement, metricsB.totalEngagement),
        avgEngagementRate: calculateDiff(metricsA.avgEngagementRate, metricsB.avgEngagementRate),
        avgViewsPerPost: calculateDiff(metricsA.avgViewsPerPost, metricsB.avgViewsPerPost),
        avgLikesPerPost: calculateDiff(metricsA.avgLikesPerPost, metricsB.avgLikesPerPost),
        avgCommentsPerPost: calculateDiff(metricsA.avgCommentsPerPost, metricsB.avgCommentsPerPost),
        avgSharesPerPost: calculateDiff(metricsA.avgSharesPerPost, metricsB.avgSharesPerPost),
      },
      percentChange: {
        totalViews: calculatePercent(metricsA.totalViews, metricsB.totalViews),
        totalLikes: calculatePercent(metricsA.totalLikes, metricsB.totalLikes),
        totalComments: calculatePercent(metricsA.totalComments, metricsB.totalComments),
        totalShares: calculatePercent(metricsA.totalShares, metricsB.totalShares),
        totalEngagement: calculatePercent(metricsA.totalEngagement, metricsB.totalEngagement),
        avgEngagementRate: calculatePercent(metricsA.avgEngagementRate, metricsB.avgEngagementRate),
        avgViewsPerPost: calculatePercent(metricsA.avgViewsPerPost, metricsB.avgViewsPerPost),
        avgLikesPerPost: calculatePercent(metricsA.avgLikesPerPost, metricsB.avgLikesPerPost),
        avgCommentsPerPost: calculatePercent(
          metricsA.avgCommentsPerPost,
          metricsB.avgCommentsPerPost
        ),
        avgSharesPerPost: calculatePercent(metricsA.avgSharesPerPost, metricsB.avgSharesPerPost),
      },
    };
  }
}
