/**
 * Hashtag & Timing Analyzer Module
 *
 * Analyzes hashtag performance and optimal posting timing.
 * Provides insights into trending hashtags and best times to post.
 *
 * @module HashtagTimingAnalyzer
 */

import type { DomainAnalytics } from "@shared/types";
import { createLogger } from "../../lib/logger.js";

const analyticsLogger = createLogger("analytics");

import type { PostDataItem } from "./types";
import type { HashtagAnalytics, OptimalTiming, ProviderType } from "@shared/analytics";

/**
 * Internal interface for hashtag performance tracking
 */
interface HashtagPerformanceData {
  usageCount: number;
  totalImpressions: number;
  totalEngagements: number;
  totalReach: number;
  postIds: Set<string>;
}

/**
 * Hashtag & Timing Analyzer
 *
 * Provides methods for analyzing trending hashtags and optimal timing
 * to maximize content reach and engagement.
 */
export class HashtagTimingAnalyzer {
  /**
   * Analyze hashtag performance
   *
   * @param postsData - Post data with content and tags
   * @param analyticsData - Raw analytics data from database
   * @returns Array of hashtag analytics sorted by engagement rate
   */
  async analyzeHashtagPerformance(
    postsData: PostDataItem[],
    analyticsData: DomainAnalytics[]
  ): Promise<HashtagAnalytics[]> {
    try {
      const hashtagMap = new Map<string, HashtagPerformanceData>();

      // Extract hashtags from posts and track their performance
      postsData.forEach((post) => {
        const firstContent = post.contents?.[0];
        const content = firstContent?.content || "";
        const hashtags = content.match(/#\w+/g) || [];

        // Get analytics for this post
        const postAnalytics = analyticsData.filter((a) => a.postId && a.postId === post.id);
        const totalImpressions = postAnalytics.reduce((sum, a) => sum + (a.views ?? 0), 0);
        const totalEngagements = postAnalytics.reduce(
          (sum, a) => sum + (a.likes ?? 0) + (a.comments ?? 0) + (a.shares ?? 0),
          0
        );
        const totalReach = Math.floor(totalImpressions * 0.7);

        hashtags.forEach((hashtag: string) => {
          const normalizedHashtag = hashtag.toLowerCase();

          if (!hashtagMap.has(normalizedHashtag)) {
            hashtagMap.set(normalizedHashtag, {
              usageCount: 0,
              totalImpressions: 0,
              totalEngagements: 0,
              totalReach: 0,
              postIds: new Set(),
            });
          }

          const hashtagData = hashtagMap.get(normalizedHashtag);
          if (hashtagData) {
            // Only count each post once per hashtag
            if (!hashtagData.postIds.has(post.id)) {
              hashtagData.usageCount++;
              hashtagData.totalImpressions += totalImpressions;
              hashtagData.totalEngagements += totalEngagements;
              hashtagData.totalReach += totalReach;
              hashtagData.postIds.add(post.id);
            }
          }
        });
      });

      const results: HashtagAnalytics[] = [];

      // Calculate performance metrics for each hashtag
      for (const [hashtag, data] of Array.from(hashtagMap.entries())) {
        // Skip hashtags used less than 2 times
        if (data.usageCount < 2) continue;

        const avgImpressions = data.totalImpressions / data.usageCount;
        const avgEngagements = data.totalEngagements / data.usageCount;
        const avgEngagementRate =
          data.totalImpressions > 0 ? (data.totalEngagements / data.totalImpressions) * 100 : 0;
        const reach = data.totalReach / data.usageCount;

        // Calculate trending score based on recent usage and performance
        const trendingScore = Math.min(100, (avgEngagementRate * data.usageCount) / 10);

        // Determine competition level based on usage frequency
        const competitionLevel = this.getCompetitionLevel(data.usageCount);

        // Recommend usage based on performance
        const recommendedUsage = avgEngagementRate > 3 && competitionLevel !== "high";

        results.push({
          hashtag,
          usageCount: data.usageCount,
          avgImpressions,
          avgEngagements,
          avgEngagementRate,
          reach,
          trendingScore,
          competitionLevel,
          recommendedUsage,
        });
      }

      return results.sort((a, b) => b.avgEngagementRate - a.avgEngagementRate).slice(0, 20);
    } catch (error) {
      analyticsLogger.error({ err: error }, "Error analyzing hashtag performance");
      return [];
    }
  }

  /**
   * Calculate optimal timing for posting
   *
   * @param analyticsData - Raw analytics data from database
   * @param provider - Optional specific provider to analyze
   * @returns Optimal timing information with best day, hour, and confidence
   */
  async calculateOptimalTiming(
    analyticsData: DomainAnalytics[],
    provider?: ProviderType
  ): Promise<OptimalTiming> {
    try {
      // Filter by provider if specified
      const relevantAnalytics = provider
        ? analyticsData.filter((a) => (a.provider as ProviderType) === provider)
        : analyticsData;

      if (relevantAnalytics.length === 0) {
        return this.getDefaultTiming();
      }

      // Group by day of week and hour
      const timingMap = new Map<
        string,
        {
          totalEngagement: number;
          totalImpressions: number;
          count: number;
        }
      >();

      relevantAnalytics.forEach((analytics) => {
        const capturedAt = new Date(analytics.capturedAt);
        const dayOfWeek = capturedAt.getDay(); // 0-6, 0 = Sunday
        const hour = capturedAt.getHours();
        const key = `${dayOfWeek}_${hour}`;

        if (!timingMap.has(key)) {
          timingMap.set(key, {
            totalEngagement: 0,
            totalImpressions: 0,
            count: 0,
          });
        }

        const data = timingMap.get(key);
        if (data) {
          const engagement =
            (analytics.likes ?? 0) + (analytics.comments ?? 0) + (analytics.shares ?? 0);
          const impressions = analytics.views ?? 0;

          data.totalEngagement += engagement;
          data.totalImpressions += impressions;
          data.count++;
        }
      });

      // Find best performing time slot
      let bestKey = "";
      let bestEngagementRate = 0;

      for (const [key, data] of timingMap.entries()) {
        const engagementRate =
          data.totalImpressions > 0 ? (data.totalEngagement / data.totalImpressions) * 100 : 0;

        if (engagementRate > bestEngagementRate) {
          bestEngagementRate = engagementRate;
          bestKey = key;
        }
      }

      // Parse best timing
      const [dayStr, hourStr] = bestKey.split("_");
      const dayIndex = parseInt(dayStr || "2", 10);
      const hour = parseInt(hourStr || "10", 10);

      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const bestDayOfWeek = days[dayIndex] || "Tuesday";

      // Calculate confidence based on sample size
      const confidence: "high" | "medium" | "low" =
        relevantAnalytics.length > 50 ? "high" : relevantAnalytics.length > 20 ? "medium" : "low";

      // Calculate engagement multiplier (compared to average)
      const avgEngagementRate =
        relevantAnalytics.reduce(
          (sum, a) =>
            sum +
            ((a.likes ?? 0) + (a.comments ?? 0) + (a.shares ?? 0)) / Math.max(1, a.views ?? 1),
          0
        ) / Math.max(1, relevantAnalytics.length);

      const engagementMultiplier =
        avgEngagementRate > 0 ? bestEngagementRate / (avgEngagementRate * 100) : 1.0;

      return {
        bestDayOfWeek,
        bestHour: hour,
        bestTimeZone: "UTC",
        engagementMultiplier: Math.max(1.0, engagementMultiplier),
        confidence,
      };
    } catch (error) {
      analyticsLogger.error({ err: error }, "Error calculating optimal timing");
      return this.getDefaultTiming();
    }
  }

  /**
   * Get top hashtags for a specific provider
   *
   * @param posts - Post data with content and tags
   * @param analytics - Analytics data for the posts
   * @returns Array of top 5 hashtags by average engagement
   */
  async getTopHashtagsForProvider(
    posts: PostDataItem[],
    analytics: DomainAnalytics[]
  ): Promise<string[]> {
    try {
      // Extract hashtags from posts and calculate their performance
      const hashtagPerformance: Record<string, { count: number; totalEngagement: number }> = {};

      posts.forEach((post) => {
        const firstContent = post.contents?.[0];
        if (firstContent?.tags) {
          const postAnalytics = analytics.filter((a) => a.postId && a.postId === post.id);
          const totalEngagement = postAnalytics.reduce(
            (sum, a) => sum + (a.likes ?? 0) + (a.comments ?? 0) + (a.shares ?? 0),
            0
          );

          firstContent.tags.forEach((tag: string) => {
            if (!hashtagPerformance[tag]) {
              hashtagPerformance[tag] = { count: 0, totalEngagement: 0 };
            }
            const tagData = hashtagPerformance[tag];
            if (tagData) {
              tagData.count++;
              tagData.totalEngagement += totalEngagement;
            }
          });
        }
      });

      // Sort by average engagement
      const sortedHashtags = Object.entries(hashtagPerformance)
        .map(([hashtag, data]) => ({
          hashtag,
          avgEngagement: data.count > 0 ? data.totalEngagement / data.count : 0,
        }))
        .sort((a, b) => b.avgEngagement - a.avgEngagement)
        .slice(0, 5)
        .map((item) => item.hashtag);

      return sortedHashtags;
    } catch (error) {
      analyticsLogger.error({ err: error }, "Error getting top hashtags for provider");
      return [];
    }
  }

  /**
   * Determine competition level based on usage count
   *
   * @param usageCount - Number of times hashtag was used
   * @returns Competition level classification
   * @private
   */
  private getCompetitionLevel(usageCount: number): "low" | "medium" | "high" {
    if (usageCount > 10) return "high";
    else if (usageCount > 5) return "medium";
    return "low";
  }

  /**
   * Get default optimal timing when insufficient data
   *
   * @returns Default optimal timing
   * @private
   */
  private getDefaultTiming(): OptimalTiming {
    return {
      bestDayOfWeek: "Tuesday",
      bestHour: 10,
      bestTimeZone: "UTC",
      engagementMultiplier: 1.0,
      confidence: "low",
    };
  }
}
