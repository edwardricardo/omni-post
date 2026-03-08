import type { DomainAnalytics } from "@shared/types";
import { AnalyticsAggregator } from "../analyticsUtils.js";
import type { PerformanceSnapshot, AnalyticsDataPoint, PerformanceChange } from "./types.js";

/**
 * Generates performance snapshots from analytics and post data
 */
export class SnapshotGenerator {
  /**
   * Generate a performance snapshot for a given period
   */
  public static generatePerformanceSnapshot(
    analyticsData: AnalyticsDataPoint[],
    postsData: unknown[],
    periodName: string
  ): PerformanceSnapshot {
    const totalPosts = postsData.length;
    const metrics = AnalyticsAggregator.calculateEngagementMetrics(
      analyticsData as DomainAnalytics[]
    );

    const totalImpressions = metrics.totalViews;
    const totalEngagements = metrics.totalEngagement;
    const avgEngagementRate = metrics.avgEngagementRate;
    const totalReach = Math.floor(totalImpressions * 0.7);
    const totalClicks = Math.floor(totalImpressions * 0.02);
    const clickThroughRate = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

    // Mock calculations for costs and ROI
    const followerGrowth = Math.floor(totalEngagements * 0.02);
    const totalCost = totalPosts * 30; // $30 per post
    const costPerEngagement = totalEngagements > 0 ? totalCost / totalEngagements : 0;
    const costPerClick = totalClicks > 0 ? totalCost / totalClicks : 0;
    const revenue = totalClicks * 2.5; // $2.50 per click
    const roi = totalCost > 0 ? ((revenue - totalCost) / totalCost) * 100 : 0;

    return {
      period: periodName,
      totalPosts,
      totalImpressions,
      totalEngagements,
      avgEngagementRate,
      totalReach,
      totalClicks,
      clickThroughRate,
      followerGrowth,
      costPerEngagement,
      costPerClick,
      roi,
    };
  }

  /**
   * Create an empty performance snapshot
   */
  public static createEmptySnapshot(): PerformanceSnapshot {
    return {
      period: "",
      totalPosts: 0,
      totalImpressions: 0,
      totalEngagements: 0,
      avgEngagementRate: 0,
      totalReach: 0,
      totalClicks: 0,
      clickThroughRate: 0,
      followerGrowth: 0,
      costPerEngagement: 0,
      costPerClick: 0,
      roi: 0,
    };
  }

  /**
   * Calculate performance change between two snapshots
   */
  public static calculatePerformanceChange(
    current: PerformanceSnapshot,
    previous: PerformanceSnapshot
  ): PerformanceChange {
    const calculateChange = (currentVal: number, previousVal: number) => ({
      absolute: currentVal - previousVal,
      percentage:
        previousVal !== 0 ? ((currentVal - previousVal) / Math.abs(previousVal)) * 100 : 0,
    });

    return {
      impressions: calculateChange(current.totalImpressions, previous.totalImpressions),
      engagements: calculateChange(current.totalEngagements, previous.totalEngagements),
      engagementRate: calculateChange(current.avgEngagementRate, previous.avgEngagementRate),
      reach: calculateChange(current.totalReach, previous.totalReach),
      clicks: calculateChange(current.totalClicks, previous.totalClicks),
      followerGrowth: calculateChange(current.followerGrowth, previous.followerGrowth),
      roi: calculateChange(current.roi, previous.roi),
    };
  }

  /**
   * Create an empty performance change object
   */
  public static createEmptyChange(): PerformanceChange {
    return {
      impressions: { absolute: 0, percentage: 0 },
      engagements: { absolute: 0, percentage: 0 },
      engagementRate: { absolute: 0, percentage: 0 },
      reach: { absolute: 0, percentage: 0 },
      clicks: { absolute: 0, percentage: 0 },
      followerGrowth: { absolute: 0, percentage: 0 },
      roi: { absolute: 0, percentage: 0 },
    };
  }
}
