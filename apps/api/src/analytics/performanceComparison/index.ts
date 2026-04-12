/**
 * @file index.ts
 * @description Orchestrates cross-platform performance analysis by coordinating snapshot
 *              generation, benchmarking, provider comparison, and trend detection.
 * @layer infrastructure
 */
import { prisma } from "@infra/prisma";
import { createLogger } from "../../lib/logger.js";

const analyticsLogger = createLogger("analytics");
import { createRedisConnection } from "../../lib/redis.js";
import type { Redis } from "ioredis";
import type {
  TimeRange,
  MetricType,
  CompetitorComparison,
  TrendDataPoint,
} from "@shared/analytics";
import type { ProjectQueryRepositoryPort } from "../../domain/repositories/ProjectQueryRepository.js";
import type {
  PerformanceComparisonOptions,
  PerformanceComparison,
  AnalyticsDataPoint,
  PostData,
  MetricComparison,
  CompetitivePositioning,
} from "./types.js";
import { SnapshotGenerator } from "./snapshotGenerator.js";
import { BenchmarkGenerator } from "./benchmarkGenerator.js";
// Future: ProviderComparator — deleted (100% fake data, Math.random > 0.5 bug)
// Future: ContentComparator — deleted (100% fake industry/competitor averages)
import { TrendAnalyzer } from "./trendAnalyzer.js";

/**
 * Main PerformanceComparator class that orchestrates performance analysis
 */
export class PerformanceComparator {
  private redis: Redis;
  private cachePrefix = "perf_comparison:";
  private cacheTTL = 900; // 15 minutes

  constructor(private readonly projectRepository: ProjectQueryRepositoryPort) {
    this.redis = createRedisConnection();
  }

  /**
   * Generate comprehensive performance comparison
   */
  async generatePerformanceComparison(
    options: PerformanceComparisonOptions
  ): Promise<PerformanceComparison> {
    const cacheKey = this.generateCacheKey(options);
    const cached = await this.getCachedResult(cacheKey);
    if (cached) return cached;

    try {
      const { startDate, endDate } = this.calculateDateRange(
        options.timeRange,
        options.startDate,
        options.endDate
      );

      // Get current performance data
      const [analyticsData, postsData, historicalData] = await Promise.all([
        this.getAnalyticsData(options, startDate, endDate),
        this.getPostsData(options, startDate, endDate),
        options.includeHistoricalComparison
          ? this.getHistoricalData(options, startDate, endDate)
          : null,
      ]);

      // Generate current performance snapshot
      const currentPerformance = SnapshotGenerator.generatePerformanceSnapshot(
        analyticsData,
        postsData,
        "Current Period"
      );

      // Generate industry benchmarks
      const industryBenchmarks = options.includeIndustryBenchmarks
        ? BenchmarkGenerator.generateIndustryBenchmarks(currentPerformance, analyticsData)
        : [];

      // Generate competitor comparisons
      const competitorComparisons = options.includeCompetitorData
        ? await this.generateCompetitorComparisons(currentPerformance, options)
        : [];

      // Generate historical comparison
      const historicalComparison = historicalData
        ? TrendAnalyzer.generateHistoricalComparison(currentPerformance, historicalData)
        : TrendAnalyzer.getEmptyHistoricalComparison();

      // Future: Provider comparisons — requires real benchmark data source
      const providerComparison: never[] = [];

      // Future: Content type comparisons — requires content type classification and real benchmarks
      const contentTypeComparison: never[] = [];

      // Generate insights
      const keyInsights = TrendAnalyzer.generateKeyInsights({
        currentPerformance,
        industryBenchmarks,
        competitorComparisons,
        historicalComparison,
        providerComparison,
        contentTypeComparison,
      });

      // Generate recommendations
      const recommendations = TrendAnalyzer.generateRecommendations({
        currentPerformance,
        industryBenchmarks,
        competitorComparisons,
        historicalComparison,
        providerComparison,
        contentTypeComparison,
        keyInsights,
      });

      const result: PerformanceComparison = {
        currentPerformance,
        industryBenchmarks,
        competitorComparisons,
        historicalComparison,
        providerComparison,
        contentTypeComparison,
        keyInsights,
        recommendations,
      };

      await this.cacheResult(cacheKey, result);
      return result;
    } catch (error) {
      analyticsLogger.error({ err: error }, "Error generating performance comparison");
      throw error;
    }
  }

  /**
   * Compare specific metrics across time periods
   */
  async compareMetricsOverTime(
    options: PerformanceComparisonOptions,
    metrics: MetricType[],
    periods: TimeRange[]
  ): Promise<MetricComparison> {
    try {
      const results: Array<{
        period: TimeRange;
        startDate: Date;
        endDate: Date;
        data: Record<MetricType, number>;
      }> = [];

      for (const period of periods) {
        const { startDate, endDate } = this.calculateDateRange(
          period,
          options.startDate,
          options.endDate
        );
        const [analyticsData, postsData] = await Promise.all([
          this.getAnalyticsData({ ...options, timeRange: period }, startDate, endDate),
          this.getPostsData({ ...options, timeRange: period }, startDate, endDate),
        ]);

        const snapshot = SnapshotGenerator.generatePerformanceSnapshot(
          analyticsData,
          postsData,
          period
        );
        const data: Record<MetricType, number> = {} as Record<MetricType, number>;

        metrics.forEach((metric) => {
          switch (metric) {
            case "engagement_rate":
              data[metric] = snapshot.avgEngagementRate;
              break;
            case "click_through_rate":
              data[metric] = snapshot.clickThroughRate;
              break;
            case "reach":
              data[metric] = snapshot.totalReach;
              break;
            case "views":
              data[metric] = snapshot.totalImpressions;
              break;
            case "follower_growth":
              data[metric] = snapshot.followerGrowth;
              break;
            case "roi":
              data[metric] = snapshot.roi;
              break;
            default:
              data[metric] = 0;
          }
        });

        results.push({
          period,
          startDate,
          endDate,
          data,
        });
      }

      // Calculate trends
      const trends: Record<MetricType, TrendDataPoint[]> = {} as Record<
        MetricType,
        TrendDataPoint[]
      >;
      metrics.forEach((metric) => {
        trends[metric] = results.map((result, index) => {
          const value = result.data[metric];
          const previousResult = index > 0 ? results[index - 1] : undefined;
          const previousValue = previousResult ? previousResult.data[metric] : value;
          const change = value - previousValue;
          const changePercentage =
            previousValue !== 0 ? (change / Math.abs(previousValue)) * 100 : 0;

          return {
            date: result.endDate,
            value,
            change,
            changePercentage,
          };
        });
      });

      // Generate insights
      const insights = TrendAnalyzer.generateTrendInsights(trends, metrics);

      return {
        metrics,
        periods: results,
        trends,
        insights,
      };
    } catch (error) {
      analyticsLogger.error({ err: error }, "Error comparing metrics over time");
      throw error;
    }
  }

  /**
   * Generate competitive positioning analysis
   */
  async generateCompetitivePositioning(
    options: PerformanceComparisonOptions
  ): Promise<CompetitivePositioning> {
    try {
      const { startDate, endDate } = this.calculateDateRange(
        options.timeRange,
        options.startDate,
        options.endDate
      );

      const [analyticsData, postsData] = await Promise.all([
        this.getAnalyticsData(options, startDate, endDate),
        this.getPostsData(options, startDate, endDate),
      ]);

      const currentPerformance = SnapshotGenerator.generatePerformanceSnapshot(
        analyticsData,
        postsData,
        "Current"
      );

      // Mock competitive data (in production, this would come from competitive intelligence APIs)
      const competitorData = [
        {
          name: "Competitor A",
          engagementRate: 4.2,
          clickThroughRate: 1.8,
          followerGrowth: 8.5,
          roi: 65,
        },
        {
          name: "Competitor B",
          engagementRate: 3.1,
          clickThroughRate: 2.1,
          followerGrowth: 6.2,
          roi: 58,
        },
        {
          name: "Competitor C",
          engagementRate: 5.8,
          clickThroughRate: 1.4,
          followerGrowth: 12.3,
          roi: 78,
        },
        {
          name: "Competitor D",
          engagementRate: 2.9,
          clickThroughRate: 1.9,
          followerGrowth: 4.1,
          roi: 42,
        },
        {
          name: "Competitor E",
          engagementRate: 3.7,
          clickThroughRate: 2.3,
          followerGrowth: 7.8,
          roi: 61,
        },
      ];

      // Calculate overall ranking
      const yourEngagementRate = currentPerformance.avgEngagementRate;
      const betterCompetitors = competitorData.filter(
        (c) => c.engagementRate > yourEngagementRate
      ).length;
      const yourRank = betterCompetitors + 1;
      const totalCompetitors = competitorData.length + 1;
      const percentile = ((totalCompetitors - yourRank) / totalCompetitors) * 100;

      let category: "leader" | "challenger" | "follower" | "niche";
      if (percentile >= 80) category = "leader";
      else if (percentile >= 60) category = "challenger";
      else if (percentile >= 40) category = "follower";
      else category = "niche";

      // Identify strengths and weaknesses
      const avgCompetitorEngagement =
        competitorData.reduce((sum, c) => sum + c.engagementRate, 0) / competitorData.length;
      const avgCompetitorCTR =
        competitorData.reduce((sum, c) => sum + c.clickThroughRate, 0) / competitorData.length;
      const _avgCompetitorGrowth =
        competitorData.reduce((sum, c) => sum + c.followerGrowth, 0) / competitorData.length;
      const _avgCompetitorROI =
        competitorData.reduce((sum, c) => sum + c.roi, 0) / competitorData.length;

      const strengths = [];
      const weaknesses = [];

      if (yourEngagementRate > avgCompetitorEngagement) {
        strengths.push({
          metric: "engagement_rate" as MetricType,
          advantage:
            ((yourEngagementRate - avgCompetitorEngagement) / avgCompetitorEngagement) * 100,
          description: `Your engagement rate is ${(((yourEngagementRate - avgCompetitorEngagement) / avgCompetitorEngagement) * 100).toFixed(1)}% above competitor average`,
        });
      } else {
        weaknesses.push({
          metric: "engagement_rate" as MetricType,
          gap: ((avgCompetitorEngagement - yourEngagementRate) / avgCompetitorEngagement) * 100,
          description: `Your engagement rate is ${(((avgCompetitorEngagement - yourEngagementRate) / avgCompetitorEngagement) * 100).toFixed(1)}% below competitor average`,
        });
      }

      if (currentPerformance.clickThroughRate > avgCompetitorCTR) {
        strengths.push({
          metric: "click_through_rate" as MetricType,
          advantage:
            ((currentPerformance.clickThroughRate - avgCompetitorCTR) / avgCompetitorCTR) * 100,
          description: `Your click-through rate is ${(((currentPerformance.clickThroughRate - avgCompetitorCTR) / avgCompetitorCTR) * 100).toFixed(1)}% above competitor average`,
        });
      } else {
        weaknesses.push({
          metric: "click_through_rate" as MetricType,
          gap: ((avgCompetitorCTR - currentPerformance.clickThroughRate) / avgCompetitorCTR) * 100,
          description: `Your click-through rate is ${(((avgCompetitorCTR - currentPerformance.clickThroughRate) / avgCompetitorCTR) * 100).toFixed(1)}% below competitor average`,
        });
      }

      // Generate competitive gaps
      const competitiveGaps = competitorData.slice(0, 3).map((competitor) => ({
        competitor: competitor.name,
        gaps: [
          {
            metric: "engagement_rate" as MetricType,
            gap: competitor.engagementRate - yourEngagementRate,
            priority:
              competitor.engagementRate > yourEngagementRate * 1.2
                ? ("high" as const)
                : competitor.engagementRate > yourEngagementRate * 1.1
                  ? ("medium" as const)
                  : ("low" as const),
          },
          {
            metric: "roi" as MetricType,
            gap: competitor.roi - currentPerformance.roi,
            priority:
              competitor.roi > currentPerformance.roi * 1.2
                ? ("high" as const)
                : competitor.roi > currentPerformance.roi * 1.1
                  ? ("medium" as const)
                  : ("low" as const),
          },
        ],
      }));

      // Generate market opportunities
      const marketOpportunities = [
        {
          opportunity: "Video Content Leadership",
          description:
            "Video content shows 40% higher engagement across competitors. Opportunity to lead in this space.",
          requiredImprovement: {
            engagement_rate: 2.5,
            reach: 1.8,
          } as Record<MetricType, number>,
          potentialImpact: "high" as const,
        },
        {
          opportunity: "LinkedIn Professional Networking",
          description:
            "Competitors underutilizing LinkedIn. Opportunity for B2B thought leadership.",
          requiredImprovement: {
            engagement_rate: 1.5,
            follower_growth: 3.2,
          } as Record<MetricType, number>,
          potentialImpact: "medium" as const,
        },
      ];

      return {
        overallRanking: {
          yourRank,
          totalCompetitors,
          percentile,
          category,
        },
        strengthsAndWeaknesses: {
          strengths,
          weaknesses,
        },
        competitiveGaps,
        marketOpportunities,
      };
    } catch (error) {
      analyticsLogger.error({ err: error }, "Error generating competitive positioning");
      throw error;
    }
  }

  // Private helper methods

  private generateCacheKey(options: PerformanceComparisonOptions): string {
    return `${this.cachePrefix}${options.accountId}_${options.projectId || "all"}_${options.timeRange}_${options.providers?.join(",") || "all"}`;
  }

  private async getCachedResult(key: string): Promise<PerformanceComparison | null> {
    try {
      const cached = await this.redis.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      analyticsLogger.error({ err: error }, "Error getting cached performance comparison");
      return null;
    }
  }

  private async cacheResult(key: string, result: PerformanceComparison): Promise<void> {
    try {
      await this.redis.setex(key, this.cacheTTL, JSON.stringify(result));
    } catch (error) {
      analyticsLogger.error({ err: error }, "Error caching performance comparison");
    }
  }

  private calculateDateRange(
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

  private async getAnalyticsData(
    options: PerformanceComparisonOptions,
    startDate: Date,
    endDate: Date
  ): Promise<AnalyticsDataPoint[]> {
    const whereClause: Record<string, unknown> = {
      capturedAt: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (options.projectId) {
      const postIds = await this.projectRepository.getPostIds(options.projectId);
      whereClause.postId = { in: postIds };
    } else {
      const projects = await this.projectRepository.getByAccountId(options.accountId);
      const projectIds = projects.map((p) => p.id);

      const postIdsArrays = await Promise.all(
        projectIds.map((projectId) => this.projectRepository.getPostIds(projectId))
      );
      const postIds = postIdsArrays.flat();
      whereClause.postId = { in: postIds };
    }

    if (options.providers && options.providers.length > 0) {
      whereClause.provider = { in: options.providers };
    }

    return (await prisma.analytics.findMany({
      where: whereClause,
      orderBy: { capturedAt: "asc" },
    })) as AnalyticsDataPoint[];
  }

  private async getPostsData(
    options: PerformanceComparisonOptions,
    startDate: Date,
    endDate: Date
  ): Promise<PostData[]> {
    const whereClause: Record<string, unknown> = {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (options.projectId) {
      whereClause.projectId = options.projectId;
    } else {
      const projects = await this.projectRepository.getByAccountId(options.accountId);
      whereClause.projectId = { in: projects.map((p) => p.id) };
    }

    return (await prisma.post.findMany({
      where: whereClause,
      include: {
        contents: true,
        media: true,
      },
    })) as PostData[];
  }

  private async getHistoricalData(
    _options: PerformanceComparisonOptions,
    _startDate: Date,
    _endDate: Date
  ): Promise<Record<string, unknown>> {
    // Mock historical data - in production, this would query historical analytics
    return {
      previousPeriod: {},
      yearOverYear: {},
    };
  }

  private async generateCompetitorComparisons(
    _currentPerformance: unknown,
    _options: PerformanceComparisonOptions
  ): Promise<CompetitorComparison[]> {
    // Mock competitor data - in production, this would come from competitive intelligence APIs
    const competitorData: CompetitorComparison[] = [
      {
        competitorId: "comp_1",
        competitorName: "Competitor A",
        followers: 75000,
        avgEngagementRate: 4.2,
        postFrequency: 8,
        contentTypeDistribution: {
          text: 30,
          image: 45,
          video: 20,
          carousel: 5,
          story: 0,
          reel: 0,
          thread: 0,
          poll: 0,
          live: 0,
        },
        strengthsAndWeaknesses: {
          strengths: [
            "High video engagement",
            "Consistent posting schedule",
            "Strong community interaction",
          ],
          weaknesses: [
            "Limited content variety",
            "Low click-through rates",
            "Poor LinkedIn presence",
          ],
        },
      },
      {
        competitorId: "comp_2",
        competitorName: "Competitor B",
        followers: 120000,
        avgEngagementRate: 3.1,
        postFrequency: 12,
        contentTypeDistribution: {
          text: 20,
          image: 35,
          video: 35,
          carousel: 10,
          story: 0,
          reel: 0,
          thread: 0,
          poll: 0,
          live: 0,
        },
        strengthsAndWeaknesses: {
          strengths: ["Large follower base", "High post frequency", "Good visual content"],
          weaknesses: [
            "Lower engagement quality",
            "Inconsistent brand voice",
            "Limited user-generated content",
          ],
        },
      },
    ];

    return competitorData;
  }

  // Public utility methods for backwards compatibility
  public calculatePercentile(yourValue: number, benchmarkValue: number): number {
    return BenchmarkGenerator.calculatePercentile(yourValue, benchmarkValue);
  }

  public getPerformanceCategory(
    percentile: number
  ): "excellent" | "above_average" | "average" | "below_average" | "poor" {
    return BenchmarkGenerator.getPerformanceCategory(percentile);
  }

  public calculatePerformanceChange(
    current: Parameters<typeof SnapshotGenerator.calculatePerformanceChange>[0],
    previous: Parameters<typeof SnapshotGenerator.calculatePerformanceChange>[1]
  ): ReturnType<typeof SnapshotGenerator.calculatePerformanceChange> {
    return SnapshotGenerator.calculatePerformanceChange(current, previous);
  }
}
