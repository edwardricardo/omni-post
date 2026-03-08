/**
 * Trend Analyzer
 *
 * Analyzes historical performance data to detect trends and generate actionable
 * insights and recommendations. Provides historical comparisons, industry
 * benchmarking, and content type performance analysis.
 *
 * @module analytics/performanceComparison/trendAnalyzer
 */

import type { MetricType, CompetitorComparison, TrendDataPoint } from "@shared/analytics";
import type {
  PerformanceSnapshot,
  HistoricalComparison,
  PerformanceInsight,
  PerformanceRecommendation,
  IndustryBenchmark,
  ProviderPerformanceComparison,
  ContentTypeComparison,
} from "./types.js";
import { SnapshotGenerator } from "./snapshotGenerator.js";

/**
 * Analyzes trends and generates insights and recommendations
 */
export class TrendAnalyzer {
  /**
   * Generate historical comparison
   */
  public static generateHistoricalComparison(
    currentPerformance: PerformanceSnapshot,
    _historicalData: unknown
  ): HistoricalComparison {
    // Mock historical comparison - in production, this would use actual historical data
    const previousPeriod: PerformanceSnapshot = {
      ...currentPerformance,
      period: "Previous Period",
      totalImpressions: currentPerformance.totalImpressions * 0.9,
      totalEngagements: currentPerformance.totalEngagements * 0.85,
      avgEngagementRate: currentPerformance.avgEngagementRate * 0.95,
      totalReach: currentPerformance.totalReach * 0.88,
      followerGrowth: currentPerformance.followerGrowth * 0.8,
      roi: currentPerformance.roi * 0.92,
    };

    const yearOverYear: PerformanceSnapshot = {
      ...currentPerformance,
      period: "Year Over Year",
      totalImpressions: currentPerformance.totalImpressions * 0.7,
      totalEngagements: currentPerformance.totalEngagements * 0.6,
      avgEngagementRate: currentPerformance.avgEngagementRate * 0.75,
      totalReach: currentPerformance.totalReach * 0.65,
      followerGrowth: currentPerformance.followerGrowth * 0.5,
      roi: currentPerformance.roi * 0.8,
    };

    const vsLastPeriod = SnapshotGenerator.calculatePerformanceChange(
      currentPerformance,
      previousPeriod
    );
    const vsYearAgo = SnapshotGenerator.calculatePerformanceChange(
      currentPerformance,
      yearOverYear
    );

    return {
      comparisonPeriod: "30 days",
      currentPeriod: currentPerformance,
      previousPeriod,
      yearOverYear,
      changes: {
        vsLastPeriod,
        vsYearAgo,
      },
      trends: {
        shortTerm:
          vsLastPeriod.engagementRate.percentage > 5
            ? "improving"
            : vsLastPeriod.engagementRate.percentage < -5
              ? "declining"
              : "stable",
        longTerm:
          vsYearAgo.engagementRate.percentage > 10
            ? "improving"
            : vsYearAgo.engagementRate.percentage < -10
              ? "declining"
              : "stable",
      },
    };
  }

  /**
   * Create empty historical comparison
   */
  public static getEmptyHistoricalComparison(): HistoricalComparison {
    const emptySnapshot = SnapshotGenerator.createEmptySnapshot();
    const emptyChange = SnapshotGenerator.createEmptyChange();

    return {
      comparisonPeriod: "N/A",
      currentPeriod: emptySnapshot,
      previousPeriod: emptySnapshot,
      yearOverYear: emptySnapshot,
      changes: {
        vsLastPeriod: emptyChange,
        vsYearAgo: emptyChange,
      },
      trends: {
        shortTerm: "stable",
        longTerm: "stable",
      },
    };
  }

  /**
   * Generate trend insights from metric trends
   */
  public static generateTrendInsights(
    trends: Record<MetricType, TrendDataPoint[]>,
    metrics: MetricType[]
  ): string[] {
    const insights: string[] = [];

    metrics.forEach((metric) => {
      const trendData = trends[metric];
      if (trendData && trendData.length > 1) {
        const _latest = trendData[trendData.length - 1];
        const first = trendData[0];
        const last = trendData[trendData.length - 1];
        if (!first || !last) return; // Skip if data is missing
        const overall = last.value - first.value;
        const overallPercentage = first.value !== 0 ? (overall / Math.abs(first.value)) * 100 : 0;

        if (overallPercentage > 20) {
          insights.push(
            `${metric} shows strong growth of ${overallPercentage.toFixed(1)}% over the analyzed period`
          );
        } else if (overallPercentage < -20) {
          insights.push(
            `${metric} shows concerning decline of ${Math.abs(overallPercentage).toFixed(1)}% over the analyzed period`
          );
        } else {
          insights.push(
            `${metric} remains relatively stable with ${overallPercentage.toFixed(1)}% change over the period`
          );
        }
      }
    });

    return insights;
  }

  /**
   * Generate key insights from performance data
   */
  public static generateKeyInsights(data: {
    currentPerformance: PerformanceSnapshot;
    industryBenchmarks: IndustryBenchmark[];
    competitorComparisons: CompetitorComparison[];
    historicalComparison: HistoricalComparison;
    providerComparison: ProviderPerformanceComparison[];
    contentTypeComparison: ContentTypeComparison[];
  }): PerformanceInsight[] {
    const insights: PerformanceInsight[] = [];

    // Performance trend insight
    if (data.historicalComparison.trends.shortTerm === "improving") {
      insights.push({
        type: "trend",
        title: "Positive Performance Trajectory",
        description:
          "Your engagement metrics show consistent improvement over recent periods, indicating effective strategy execution.",
        impact: "medium",
        confidence: 0.8,
        supportingData: {
          engagementGrowth:
            data.historicalComparison.changes.vsLastPeriod.engagementRate.percentage,
          reachGrowth: data.historicalComparison.changes.vsLastPeriod.reach.percentage,
        },
        actionable: true,
      });
    }

    // Industry benchmark insight
    const topBenchmark = data.industryBenchmarks.find((b) => b.performance === "excellent");
    if (topBenchmark) {
      insights.push({
        type: "strength",
        title: `Excellent ${topBenchmark.metric} Performance`,
        description: `Your ${topBenchmark.metric} is in the top ${(100 - topBenchmark.percentileRank).toFixed(0)}% of the industry.`,
        impact: "high",
        confidence: 0.9,
        supportingData: {
          metric: topBenchmark.metric,
          yourValue: topBenchmark.yourValue,
          industryAverage: topBenchmark.industryAverage,
          percentile: topBenchmark.percentileRank,
        },
        actionable: true,
      });
    }

    // Platform opportunity insight
    const topProvider = data.providerComparison[0];
    if (topProvider && topProvider.ranking.vsIndustry > 75) {
      insights.push({
        type: "opportunity",
        title: `${topProvider.provider} Leadership Opportunity`,
        description: `Your ${topProvider.provider} performance significantly exceeds industry benchmarks. Consider increasing investment in this platform.`,
        impact: "high",
        confidence: 0.85,
        supportingData: {
          provider: topProvider.provider,
          engagementRate: topProvider.currentMetrics.engagementRate,
          industryBenchmark: topProvider.industryBenchmark.avgEngagementRate,
          percentile: topProvider.ranking.vsIndustry,
        },
        actionable: true,
      });
    }

    // Content type insight
    const topContentType = data.contentTypeComparison[0];
    if (topContentType && topContentType.relativePerformance > 1.3) {
      insights.push({
        type: "strength",
        title: `${topContentType.contentType} Content Excellence`,
        description: `Your ${topContentType.contentType} content performs ${((topContentType.relativePerformance - 1) * 100).toFixed(0)}% above industry average.`,
        impact: "medium",
        confidence: 0.75,
        supportingData: {
          contentType: topContentType.contentType,
          relativePerformance: topContentType.relativePerformance,
          yourEngagementRate: topContentType.yourPerformance.avgEngagementRate,
          industryAverage: topContentType.industryAverage.avgEngagementRate,
        },
        actionable: true,
      });
    }

    // Weakness insight
    const poorBenchmark = data.industryBenchmarks.find(
      (b) => b.performance === "below_average" || b.performance === "poor"
    );
    if (poorBenchmark) {
      insights.push({
        type: "weakness",
        title: `${poorBenchmark.metric} Improvement Needed`,
        description: `Your ${poorBenchmark.metric} is ${poorBenchmark.gapToTopQuartile.toFixed(1)} points below top quartile performance.`,
        impact: "high",
        confidence: 0.9,
        supportingData: {
          metric: poorBenchmark.metric,
          yourValue: poorBenchmark.yourValue,
          topQuartile: poorBenchmark.topQuartile,
          gap: poorBenchmark.gapToTopQuartile,
          improvementOpportunity: poorBenchmark.improvementOpportunity,
        },
        actionable: true,
      });
    }

    return insights.sort((a, b) => {
      const impactOrder = { high: 3, medium: 2, low: 1 };
      return impactOrder[b.impact] - impactOrder[a.impact];
    });
  }

  /**
   * Generate performance recommendations
   */
  public static generateRecommendations(data: {
    currentPerformance: PerformanceSnapshot;
    industryBenchmarks: IndustryBenchmark[];
    competitorComparisons: CompetitorComparison[];
    historicalComparison: HistoricalComparison;
    providerComparison: ProviderPerformanceComparison[];
    contentTypeComparison: ContentTypeComparison[];
    keyInsights: PerformanceInsight[];
  }): PerformanceRecommendation[] {
    const recommendations: PerformanceRecommendation[] = [];

    // Platform optimization recommendations
    const underperformingProvider = data.providerComparison.find((p) => p.ranking.vsIndustry < 25);
    if (underperformingProvider) {
      recommendations.push({
        category: "platform",
        priority: "high",
        title: `Optimize ${underperformingProvider.provider} Strategy`,
        description: `Your ${underperformingProvider.provider} performance is in the bottom quartile. Focus on platform-specific optimization.`,
        expectedImpact: "Increase platform engagement by 40-60%",
        confidenceLevel: 0.8,
        implementation: {
          difficulty: "medium",
          timeToImplement: "2-3 weeks",
          timeToSeeResults: "4-6 weeks",
          steps: [
            `Analyze top-performing ${underperformingProvider.provider} content in your industry`,
            `Optimize posting times for ${underperformingProvider.provider} audience`,
            `Adapt content format to ${underperformingProvider.provider} best practices`,
            "A/B test different content approaches",
          ],
        },
        metrics: ["engagement_rate", "reach", "click_through_rate"],
      });
    }

    // Content optimization recommendations
    const underperformingContent = data.contentTypeComparison.find(
      (c) => c.relativePerformance < 0.7
    );
    if (underperformingContent) {
      recommendations.push({
        category: "content",
        priority: "medium",
        title: `Improve ${underperformingContent.contentType} Content Performance`,
        description: `Your ${underperformingContent.contentType} content underperforms by ${((1 - underperformingContent.relativePerformance) * 100).toFixed(0)}% vs industry average.`,
        expectedImpact: "Increase content type engagement by 30-50%",
        confidenceLevel: 0.75,
        implementation: {
          difficulty: "medium",
          timeToImplement: "1-2 weeks",
          timeToSeeResults: "3-4 weeks",
          steps: [
            `Study high-performing ${underperformingContent.contentType} content examples`,
            `Create ${underperformingContent.contentType} content templates`,
            "Improve visual design and messaging",
            "Test different formats and styles",
          ],
        },
        metrics: ["engagement_rate", "reach", "views"],
      });
    }

    // Budget optimization recommendations
    if (data.currentPerformance.roi < 50) {
      recommendations.push({
        category: "budget",
        priority: "high",
        title: "Optimize Budget Allocation",
        description: `Current ROI of ${data.currentPerformance.roi.toFixed(1)}% is below optimal levels. Reallocate budget to high-performing platforms and content types.`,
        expectedImpact: "Increase ROI by 25-40%",
        confidenceLevel: 0.85,
        implementation: {
          difficulty: "easy",
          timeToImplement: "1 week",
          timeToSeeResults: "2-3 weeks",
          steps: [
            "Reduce spend on underperforming platforms by 30%",
            "Increase budget for top-performing platforms by 50%",
            "Focus content creation on high-ROI content types",
            "Implement performance-based budget reviews monthly",
          ],
        },
        metrics: ["roi", "cost_per_engagement", "cost_per_engagement"],
      });
    }

    // Timing optimization recommendations
    const timingInsight = data.keyInsights.find(
      (i) => i.type === "opportunity" && i.title.includes("timing")
    );
    if (!timingInsight) {
      recommendations.push({
        category: "timing",
        priority: "medium",
        title: "Optimize Posting Schedule",
        description:
          "Analyze your audience engagement patterns to identify optimal posting times for maximum reach and engagement.",
        expectedImpact: "Increase engagement by 15-25%",
        confidenceLevel: 0.7,
        implementation: {
          difficulty: "easy",
          timeToImplement: "3-5 days",
          timeToSeeResults: "2-3 weeks",
          steps: [
            "Analyze audience activity patterns by platform",
            "Identify peak engagement hours for each platform",
            "Create posting schedule based on optimal times",
            "Use scheduling tools to maintain consistency",
          ],
        },
        metrics: ["engagement_rate", "reach", "views"],
      });
    }

    // Strategy recommendations based on trends
    if (data.historicalComparison.trends.longTerm === "declining") {
      recommendations.push({
        category: "strategy",
        priority: "critical",
        title: "Strategic Content Refresh",
        description:
          "Long-term declining performance indicates need for strategic content and approach refresh.",
        expectedImpact: "Reverse negative trend and increase engagement by 50-80%",
        confidenceLevel: 0.9,
        implementation: {
          difficulty: "hard",
          timeToImplement: "4-6 weeks",
          timeToSeeResults: "6-12 weeks",
          steps: [
            "Conduct comprehensive audience research",
            "Audit current content strategy and identify gaps",
            "Develop new content pillars and themes",
            "Test new content formats and approaches",
            "Refresh brand voice and visual identity",
          ],
        },
        metrics: ["engagement_rate", "reach", "follower_growth", "roi"],
      });
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }
}
