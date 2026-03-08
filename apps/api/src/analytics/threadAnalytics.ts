import { prisma } from "@infra/prisma";
import Redis from "ioredis";
import { createLogger } from "../lib/logger.js";

const analyticsLogger = createLogger("analytics");
import type { ApiMetrics } from "../metrics/apiMetrics.js";
import type { AnalyticsReadRepositoryPort } from "../domain/repositories/AnalyticsReadRepository.js";
import { AnalyticsAggregator } from "./analyticsUtils";

interface ThreadMetrics {
  threadId: string;
  postId: string;
  totalTweets: number;
  publishedTweets: number;
  failedTweets: number;
  pendingTweets: number;
  avgEngagementPerTweet: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  completionRate: number;
  publishDuration: number; // milliseconds from first to last tweet
  strategy: string;
  createdAt: Date;
  lastUpdateAt: Date;
  performance: "excellent" | "good" | "average" | "poor";
}

interface ThreadPerformanceScore {
  engagementScore: number; // 0-100
  completionScore: number; // 0-100
  timingScore: number; // 0-100
  overallScore: number; // 0-100
  recommendations: string[];
}

interface EngagementTrend {
  tweetSequence: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagementRate: number;
  timestamp: Date;
}

interface ThreadAnalyticsSummary {
  totalThreads: number;
  completedThreads: number;
  avgCompletionRate: number;
  avgEngagementRate: number;
  topPerformingThreads: ThreadMetrics[];
  engagementTrends: {
    daily: Array<{ date: string; engagement: number; threads: number }>;
    weekly: Array<{ week: string; engagement: number; threads: number }>;
  };
  strategyComparison: Array<{
    strategy: string;
    count: number;
    avgEngagement: number;
    avgCompletion: number;
  }>;
}

export class ThreadAnalytics {
  private redis: Redis;
  private metrics: ApiMetrics;
  private readonly analyticsRepository: AnalyticsReadRepositoryPort;
  private cachePrefix = "thread_analytics:";
  private cacheTTL = 300; // 5 minutes

  constructor(redis: Redis, metrics: ApiMetrics, analyticsRepository: AnalyticsReadRepositoryPort) {
    this.redis = redis;
    this.metrics = metrics;
    this.analyticsRepository = analyticsRepository;

    // Setup Redis error handling
    this.redis.on("error", (err) => {
      analyticsLogger.error({ err }, "Redis connection error in thread analytics");
    });
  }

  // Calculate comprehensive thread metrics
  async getThreadMetrics(threadId: string): Promise<ThreadMetrics | null> {
    try {
      const cacheKey = `${this.cachePrefix}metrics:${threadId}`;

      // Try cache first
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        // this.metrics.metrics.cacheHits.inc({ status: "hit" });
        return JSON.parse(cached);
      }

      // Fetch thread with related data
      const thread = await prisma.thread.findUnique({
        where: { id: threadId },
        include: {
          post: {
            include: {
              project: true,
            },
          },
          tweets: {
            orderBy: { sequenceNumber: "asc" },
          },
        },
      });

      if (!thread) return null;

      // ✅ Phase 1: Fixed N+1 query - use repository method to get analytics
      const tweetIds = thread.tweets
        .filter((tweet) => tweet.tweetId)
        .map((tweet) => tweet.tweetId!);

      const analyticsData = await this.analyticsRepository.getByPostIds(tweetIds, {
        provider: "X",
        orderBy: { capturedAt: "desc" },
      });

      // Calculate metrics
      const totalTweets = thread.tweets.length;
      const publishedTweets = thread.tweets.filter((t) => t.status === "PUBLISHED").length;
      const failedTweets = thread.tweets.filter((t) => t.status === "FAILED").length;
      const pendingTweets = thread.tweets.filter((t) => t.status === "PENDING").length;

      // ✅ Phase 3.3: Use AnalyticsAggregator for engagement metrics
      const metrics = AnalyticsAggregator.calculateEngagementMetrics(analyticsData);
      const { totalViews, totalLikes, totalComments, totalShares } = metrics;

      const avgEngagementPerTweet =
        publishedTweets > 0 ? (totalLikes + totalComments + totalShares) / publishedTweets : 0;

      const completionRate = totalTweets > 0 ? (publishedTweets / totalTweets) * 100 : 0;

      // Calculate publish duration
      const publishedTweetTimes = thread.tweets
        .filter((t) => t.publishedAt)
        .map((t) => t.publishedAt!)
        .sort((a, b) => a.getTime() - b.getTime());

      const publishDuration =
        publishedTweetTimes.length > 1
          ? publishedTweetTimes[publishedTweetTimes.length - 1]!.getTime() -
            publishedTweetTimes[0]!.getTime()
          : 0;

      // Determine performance rating
      const performance = this.calculatePerformanceRating(
        avgEngagementPerTweet,
        completionRate,
        totalTweets
      );

      const threadMetrics: ThreadMetrics = {
        threadId,
        postId: thread.postId,
        totalTweets,
        publishedTweets,
        failedTweets,
        pendingTweets,
        avgEngagementPerTweet,
        totalViews,
        totalLikes,
        totalComments,
        totalShares,
        completionRate,
        publishDuration,
        strategy: thread.strategy,
        createdAt: thread.createdAt,
        lastUpdateAt: thread.updatedAt,
        performance,
      };

      // Cache the result
      await this.redis.setex(cacheKey, this.cacheTTL, JSON.stringify(threadMetrics));
      // this.metrics.metrics.cacheHits.inc({ status: "miss" });

      return threadMetrics;
    } catch (_error: unknown) {
      analyticsLogger.error({ err: _error }, "Failed to get thread metrics");
      return null;
    }
  }

  // Calculate thread performance score with recommendations
  async calculatePerformanceScore(threadId: string): Promise<ThreadPerformanceScore | null> {
    try {
      const metrics = await this.getThreadMetrics(threadId);
      if (!metrics) return null;

      // Engagement Score (0-100)
      // Based on average engagement per tweet compared to benchmarks
      const avgEngagementBenchmark = 50; // tweets with 50+ engagements are considered good
      const engagementScore = Math.min(
        100,
        (metrics.avgEngagementPerTweet / avgEngagementBenchmark) * 100
      );

      // Completion Score (0-100)
      const completionScore = metrics.completionRate;

      // Timing Score (0-100)
      // Optimal thread publishing is 2-6 hours, penalty for too fast or too slow
      const _optimalDurationHours = 4; // 4 hours
      const actualDurationHours = metrics.publishDuration / (1000 * 60 * 60);

      let timingScore = 100;
      if (actualDurationHours < 1) {
        timingScore = 60; // Too fast
      } else if (actualDurationHours > 12) {
        timingScore = 40; // Too slow
      } else if (actualDurationHours < 2 || actualDurationHours > 8) {
        timingScore = 80; // Suboptimal but okay
      }

      const overallScore = engagementScore * 0.5 + completionScore * 0.3 + timingScore * 0.2;

      // Generate recommendations
      const recommendations: string[] = [];

      if (engagementScore < 50) {
        recommendations.push("Consider improving content quality or timing to increase engagement");
      }
      if (completionScore < 90) {
        recommendations.push("Review publishing process to reduce failed tweets");
      }
      if (timingScore < 70) {
        if (actualDurationHours < 1) {
          recommendations.push("Space out tweets more - consider 30-60 minute intervals");
        } else {
          recommendations.push("Publish tweets more consistently to maintain audience attention");
        }
      }
      if (metrics.totalTweets < 3) {
        recommendations.push("Consider longer threads (5-10 tweets) for better storytelling");
      }
      if (metrics.avgEngagementPerTweet > avgEngagementBenchmark) {
        recommendations.push("Great engagement! Consider similar content strategies");
      }

      return {
        engagementScore,
        completionScore,
        timingScore,
        overallScore,
        recommendations,
      };
    } catch (_error: unknown) {
      analyticsLogger.error({ err: _error }, "Failed to calculate performance score");
      return null;
    }
  }

  // Get engagement trends for a thread
  // ✅ Phase 1: Fixed N+1 query - was fetching analytics for each tweet in a loop
  async getEngagementTrends(threadId: string): Promise<EngagementTrend[]> {
    try {
      const thread = await prisma.thread.findUnique({
        where: { id: threadId },
        include: {
          tweets: {
            orderBy: { sequenceNumber: "asc" },
          },
        },
      });

      if (!thread) return [];

      // Get all tweet IDs at once
      const tweetIds = thread.tweets
        .filter((tweet) => tweet.tweetId && tweet.publishedAt)
        .map((tweet) => tweet.tweetId!);

      // Single query to get all analytics (result used for latestAnalyticsMap below)
      await this.analyticsRepository.getByPostIds(tweetIds, {
        provider: "X",
      });

      // Get latest analytics for each tweet
      const latestAnalyticsMap = new Map(
        await this.analyticsRepository
          .getLatestForPosts(tweetIds)
          .then((data) => data.map((a) => [a.postId, a]))
      );

      const trends: EngagementTrend[] = [];

      for (const tweet of thread.tweets) {
        if (!tweet.tweetId || !tweet.publishedAt) continue;

        const analytics = latestAnalyticsMap.get(tweet.tweetId);

        if (analytics) {
          const totalEngagements =
            (analytics.likes || 0) + (analytics.comments || 0) + (analytics.shares || 0);
          const engagementRate = analytics.views ? (totalEngagements / analytics.views) * 100 : 0;

          trends.push({
            tweetSequence: tweet.sequenceNumber,
            views: analytics.views || 0,
            likes: analytics.likes || 0,
            comments: analytics.comments || 0,
            shares: analytics.shares || 0,
            engagementRate,
            timestamp: tweet.publishedAt,
          });
        }
      }

      return trends;
    } catch (_error: unknown) {
      analyticsLogger.error({ err: _error }, "Failed to get engagement trends");
      return [];
    }
  }

  // Get analytics summary for an account/project
  async getAnalyticsSummary(
    projectId?: string,
    accountId?: string,
    days: number = 30
  ): Promise<ThreadAnalyticsSummary> {
    try {
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      // Build where clause
      const whereClause: any = {
        createdAt: { gte: startDate },
      };

      if (projectId) {
        whereClause.post = { projectId };
      } else if (accountId) {
        whereClause.post = {
          project: { accountId },
        };
      }

      // Get all threads in timeframe
      const threads = await prisma.thread.findMany({
        where: whereClause,
        include: {
          post: {
            include: {
              project: true,
            },
          },
          tweets: true,
        },
        orderBy: { createdAt: "desc" },
      });

      const totalThreads = threads.length;
      const completedThreads = threads.filter((t) =>
        t.tweets.every((tweet) => tweet.status === "PUBLISHED")
      ).length;

      // ✅ Phase 1: Calculate metrics for each thread (batch processing instead of individual queries)
      const threadMetrics = await this.getThreadMetricsBatch(threads.map((t) => t.id));
      const validMetrics = threadMetrics.filter(Boolean) as ThreadMetrics[];

      const avgCompletionRate =
        validMetrics.length > 0
          ? validMetrics.reduce((sum, m) => sum + m.completionRate, 0) / validMetrics.length
          : 0;

      const avgEngagementRate =
        validMetrics.length > 0
          ? validMetrics.reduce((sum, m) => sum + m.avgEngagementPerTweet, 0) / validMetrics.length
          : 0;

      // Top performing threads
      const topPerformingThreads = validMetrics
        .sort((a, b) => b.avgEngagementPerTweet - a.avgEngagementPerTweet)
        .slice(0, 5);

      // Strategy comparison
      const strategyStats = new Map<
        string,
        { count: number; engagement: number; completion: number }
      >();

      validMetrics.forEach((metric) => {
        const current = strategyStats.get(metric.strategy) || {
          count: 0,
          engagement: 0,
          completion: 0,
        };
        current.count++;
        current.engagement += metric.avgEngagementPerTweet;
        current.completion += metric.completionRate;
        strategyStats.set(metric.strategy, current);
      });

      const strategyComparison = Array.from(strategyStats.entries()).map(([strategy, stats]) => ({
        strategy,
        count: stats.count,
        avgEngagement: stats.engagement / stats.count,
        avgCompletion: stats.completion / stats.count,
      }));

      // Generate daily and weekly trends (simplified)
      const engagementTrends = {
        daily: await this.generateDailyTrends(validMetrics, days),
        weekly: await this.generateWeeklyTrends(validMetrics, days),
      };

      return {
        totalThreads,
        completedThreads,
        avgCompletionRate,
        avgEngagementRate,
        topPerformingThreads,
        engagementTrends,
        strategyComparison,
      };
    } catch (_error: unknown) {
      analyticsLogger.error({ err: _error }, "Failed to get analytics summary");
      return {
        totalThreads: 0,
        completedThreads: 0,
        avgCompletionRate: 0,
        avgEngagementRate: 0,
        topPerformingThreads: [],
        engagementTrends: { daily: [], weekly: [] },
        strategyComparison: [],
      };
    }
  }

  // Compare thread strategies
  async compareStrategies(
    projectId?: string,
    accountId?: string
  ): Promise<
    Array<{
      strategy: string;
      avgEngagement: number;
      avgCompletion: number;
      threadCount: number;
      successRate: number;
    }>
  > {
    try {
      const whereClause: any = {};

      if (projectId) {
        whereClause.post = { projectId };
      } else if (accountId) {
        whereClause.post = {
          project: { accountId },
        };
      }

      const threads = await prisma.thread.findMany({
        where: whereClause,
        include: {
          tweets: true,
        },
      });

      const strategyStats = new Map<
        string,
        {
          totalEngagement: number;
          totalCompletion: number;
          threadCount: number;
          successfulThreads: number;
        }
      >();

      // ✅ Phase 1: Batch process metrics instead of calling getThreadMetrics for each thread
      const threadIds = threads.map((t) => t.id);
      const allMetrics = await this.getThreadMetricsBatch(threadIds);
      const metricsMap = new Map(allMetrics.filter(Boolean).map((m) => [m!.threadId, m!]));

      for (const thread of threads) {
        const metrics = metricsMap.get(thread.id);
        if (!metrics) continue;

        const current = strategyStats.get(thread.strategy) || {
          totalEngagement: 0,
          totalCompletion: 0,
          threadCount: 0,
          successfulThreads: 0,
        };

        current.totalEngagement += metrics.avgEngagementPerTweet;
        current.totalCompletion += metrics.completionRate;
        current.threadCount++;

        if (metrics.completionRate >= 90 && metrics.avgEngagementPerTweet > 10) {
          current.successfulThreads++;
        }

        strategyStats.set(thread.strategy, current);
      }

      return Array.from(strategyStats.entries())
        .map(([strategy, stats]) => ({
          strategy,
          avgEngagement: stats.totalEngagement / stats.threadCount,
          avgCompletion: stats.totalCompletion / stats.threadCount,
          threadCount: stats.threadCount,
          successRate: (stats.successfulThreads / stats.threadCount) * 100,
        }))
        .sort((a, b) => b.successRate - a.successRate);
    } catch (_error: unknown) {
      analyticsLogger.error({ err: _error }, "Failed to compare strategies");
      return [];
    }
  }

  // Private helper methods
  public calculatePerformanceRating(
    avgEngagement: number,
    completionRate: number,
    totalTweets: number
  ): "excellent" | "good" | "average" | "poor" {
    const score =
      (avgEngagement / 10) * 0.4 +
      (completionRate / 100) * 0.4 +
      (Math.min(totalTweets, 10) / 10) * 0.2;

    if (score >= 0.8) return "excellent";
    if (score >= 0.6) return "good";
    if (score >= 0.4) return "average";
    return "poor";
  }

  private async generateDailyTrends(metrics: ThreadMetrics[], days: number) {
    const trends: Array<{ date: string; engagement: number; threads: number }> = [];

    for (let i = 0; i < days; i++) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split("T")[0];

      const dayMetrics = metrics.filter((m) => m.createdAt.toISOString().split("T")[0] === dateStr);

      const avgEngagement =
        dayMetrics.length > 0
          ? dayMetrics.reduce((sum, m) => sum + m.avgEngagementPerTweet, 0) / dayMetrics.length
          : 0;

      trends.push({
        date: dateStr!,
        engagement: avgEngagement,
        threads: dayMetrics.length,
      });
    }

    return trends.reverse();
  }

  private async generateWeeklyTrends(metrics: ThreadMetrics[], days: number) {
    const weeks = Math.ceil(days / 7);
    const trends: Array<{ week: string; engagement: number; threads: number }> = [];

    for (let i = 0; i < weeks; i++) {
      const weekStart = new Date(Date.now() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
      const weekEnd = new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000);

      const weekMetrics = metrics.filter((m) => m.createdAt >= weekStart && m.createdAt < weekEnd);

      const avgEngagement =
        weekMetrics.length > 0
          ? weekMetrics.reduce((sum, m) => sum + m.avgEngagementPerTweet, 0) / weekMetrics.length
          : 0;

      const weekStartStr = weekStart.toISOString().split("T")[0];
      const weekEndStr = weekEnd.toISOString().split("T")[0];

      trends.push({
        week: weekStartStr && weekEndStr ? `${weekStartStr} - ${weekEndStr}` : "Unknown Week",
        engagement: avgEngagement,
        threads: weekMetrics.length,
      });
    }

    return trends.reverse();
  }

  /**
   * ✅ Phase 1: Batch version of getThreadMetrics to avoid N+1 queries
   * Gets metrics for multiple threads in a single database round-trip
   */
  private async getThreadMetricsBatch(threadIds: string[]): Promise<(ThreadMetrics | null)[]> {
    try {
      // Fetch all threads with related data in one query
      const threads = await prisma.thread.findMany({
        where: { id: { in: threadIds } },
        include: {
          post: {
            include: {
              project: true,
            },
          },
          tweets: {
            orderBy: { sequenceNumber: "asc" },
          },
        },
      });

      // Collect all tweet IDs
      const allTweetIds = threads.flatMap((thread) =>
        thread.tweets.filter((tweet) => tweet.tweetId).map((tweet) => tweet.tweetId!)
      );

      // Single query to get all analytics data
      const analyticsData = await this.analyticsRepository.getByPostIds(allTweetIds, {
        provider: "X",
        orderBy: { capturedAt: "desc" },
      });

      // Group analytics by tweet ID
      const analyticsMap = new Map<string, typeof analyticsData>();
      analyticsData.forEach((a) => {
        if (!a.postId) return;
        if (!analyticsMap.has(a.postId)) {
          analyticsMap.set(a.postId, []);
        }
        analyticsMap.get(a.postId)!.push(a);
      });

      // Process each thread
      return Promise.all(
        threadIds.map(async (threadId) => {
          const thread = threads.find((t) => t.id === threadId);
          if (!thread) return null;

          // Get analytics for this thread's tweets
          const threadAnalytics = thread.tweets
            .filter((tweet) => tweet.tweetId)
            .flatMap((tweet) => analyticsMap.get(tweet.tweetId!) || []);

          // Calculate metrics
          const totalTweets = thread.tweets.length;
          const publishedTweets = thread.tweets.filter((t) => t.status === "PUBLISHED").length;
          const failedTweets = thread.tweets.filter((t) => t.status === "FAILED").length;
          const pendingTweets = thread.tweets.filter((t) => t.status === "PENDING").length;

          // ✅ Phase 3.3: Use AnalyticsAggregator for engagement metrics
          const metrics = AnalyticsAggregator.calculateEngagementMetrics(threadAnalytics);
          const { totalViews, totalLikes, totalComments, totalShares } = metrics;

          const avgEngagementPerTweet =
            publishedTweets > 0 ? (totalLikes + totalComments + totalShares) / publishedTweets : 0;

          const completionRate = totalTweets > 0 ? (publishedTweets / totalTweets) * 100 : 0;

          // Calculate publish duration
          const publishedTweetTimes = thread.tweets
            .filter((t) => t.publishedAt)
            .map((t) => t.publishedAt!)
            .sort((a, b) => a.getTime() - b.getTime());

          const publishDuration =
            publishedTweetTimes.length > 1
              ? publishedTweetTimes[publishedTweetTimes.length - 1]!.getTime() -
                publishedTweetTimes[0]!.getTime()
              : 0;

          // Determine performance rating
          const performance = this.calculatePerformanceRating(
            avgEngagementPerTweet,
            completionRate,
            totalTweets
          );

          return {
            threadId,
            postId: thread.postId,
            totalTweets,
            publishedTweets,
            failedTweets,
            pendingTweets,
            avgEngagementPerTweet,
            totalViews,
            totalLikes,
            totalComments,
            totalShares,
            completionRate,
            publishDuration,
            strategy: thread.strategy,
            createdAt: thread.createdAt,
            lastUpdateAt: thread.updatedAt,
            performance,
          };
        })
      );
    } catch (_error: unknown) {
      analyticsLogger.error({ err: _error }, "Failed to get thread metrics batch");
      return threadIds.map(() => null);
    }
  }

  // Cleanup method
  async cleanup(): Promise<void> {
    // Clean up old cached analytics
    try {
      const keys = await this.redis.keys(`${this.cachePrefix}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (_error: unknown) {
      analyticsLogger.error({ err: _error }, "Failed to cleanup thread analytics cache");
    }
  }
}
