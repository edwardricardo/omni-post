/**
 * Content Metrics Analyzer Module
 *
 * Analyzes post performance, content types, and identifies top-performing content.
 * Provides insights into which content types perform best across platforms.
 *
 * @module ContentMetricsAnalyzer
 */

import type { DomainAnalytics } from "@shared/types";
import { createLogger } from "../../lib/logger.js";

const analyticsLogger = createLogger("analytics");

import type { PostDataItem, NormalizedAnalytics } from "./types";
import type {
  TopPerformingPost,
  ContentTypePerformance,
  ProviderType,
  ContentType,
} from "@shared/analytics";

/**
 * Internal interface for post performance data
 */
interface PostPerformanceEntry {
  analytics: NormalizedAnalytics[];
  post: PostDataItem;
  score: number;
}

/**
 * Internal interface for content type grouping
 */
interface ContentTypeData {
  provider: ProviderType;
  posts: PostDataItem[];
  analytics: NormalizedAnalytics[];
}

/**
 * Content Metrics Analyzer
 *
 * Provides methods for analyzing content performance metrics including
 * top performing posts and content type performance analysis.
 */
export class ContentMetricsAnalyzer {
  /**
   * Get top performing posts based on analytics data
   *
   * @param analyticsData - Raw analytics data from database
   * @param postsData - Post data with content and media information
   * @param limit - Maximum number of posts to return
   * @returns Array of top performing posts sorted by engagement rate
   */
  async getTopPerformingPosts(
    analyticsData: DomainAnalytics[],
    postsData: PostDataItem[],
    limit: number
  ): Promise<TopPerformingPost[]> {
    try {
      // Group analytics by post ID and calculate performance scores
      const postPerformance = new Map<string, PostPerformanceEntry>();

      // Calculate performance score for each post
      analyticsData.forEach((analytics) => {
        const postId = analytics.postId || "";
        if (!postId) return;

        const post = postsData.find((p) => p.id === postId);

        if (!post) return;

        if (!postPerformance.has(postId)) {
          postPerformance.set(postId, {
            analytics: [],
            post,
            score: 0,
          });
        }

        const postData = postPerformance.get(postId);
        if (postData) {
          postData.analytics.push({
            id: analytics.id,
            postId: analytics.postId,
            provider: analytics.provider,
            capturedAt: analytics.capturedAt,
            views: analytics.views ?? 0,
            likes: analytics.likes ?? 0,
            comments: analytics.comments ?? 0,
            shares: analytics.shares ?? 0,
          });
        }
      });

      // Calculate performance scores and create TopPerformingPost objects
      const topPosts: TopPerformingPost[] = [];

      for (const [postId, data] of Array.from(postPerformance.entries())) {
        const totalImpressions = data.analytics.reduce((sum, a) => sum + a.views, 0);
        const totalLikes = data.analytics.reduce((sum, a) => sum + a.likes, 0);
        const totalComments = data.analytics.reduce((sum, a) => sum + a.comments, 0);
        const totalShares = data.analytics.reduce((sum, a) => sum + a.shares, 0);
        const totalEngagements = totalLikes + totalComments + totalShares;

        const engagementRate =
          totalImpressions > 0 ? (totalEngagements / totalImpressions) * 100 : 0;
        const reach = Math.floor(totalImpressions * 0.7);
        const clicks = Math.floor(totalImpressions * 0.025);

        // Calculate viral score based on engagement velocity and reach
        const createdAt = data.post.createdAt;
        if (!createdAt) continue;

        const timePublished = new Date(createdAt).getTime();
        const now = Date.now();
        const hoursPublished = Math.max(1, (now - timePublished) / (1000 * 60 * 60));
        const engagementVelocity = totalEngagements / hoursPublished;
        const viralScore = Math.min(100, (engagementVelocity * engagementRate) / 10);

        // Determine content type based on media
        const contentType = this.determineContentType(data.post);

        // Get primary provider (use first analytics entry's provider)
        const firstAnalytics = data.analytics[0];
        if (!firstAnalytics) continue;

        const provider = firstAnalytics.provider;

        // Extract hashtags from post content
        const firstContent = data.post.contents?.[0];
        const content = firstContent?.content || "";
        const hashtags = content.match(/#\w+/g) || [];

        topPosts.push({
          postId,
          provider: provider as ProviderType,
          contentType,
          title: firstContent?.title || content.substring(0, 50) + "...",
          publishedAt: new Date(createdAt),
          impressions: totalImpressions,
          engagements: totalEngagements,
          engagementRate,
          clicks,
          reach,
          viralScore,
          hashtags: hashtags.slice(0, 5),
          mediaCount: data.post.media?.length || 0,
        });
      }

      // Sort by engagement rate and return top posts
      return topPosts.sort((a, b) => b.engagementRate - a.engagementRate).slice(0, limit);
    } catch (error) {
      analyticsLogger.error({ err: error }, "Error getting top performing posts");
      return [];
    }
  }

  /**
   * Analyze performance by content type
   *
   * @param analyticsData - Raw analytics data from database
   * @param postsData - Post data with media information
   * @returns Array of content type performance metrics
   */
  async analyzeContentTypePerformance(
    analyticsData: DomainAnalytics[],
    postsData: PostDataItem[]
  ): Promise<ContentTypePerformance[]> {
    try {
      const contentTypeMap = new Map<string, ContentTypeData>();

      // Group posts by content type and provider
      postsData.forEach((post) => {
        const contentType = this.determineContentType(post);

        // Get analytics for this post
        const postAnalytics = analyticsData.filter((a) => a.postId && a.postId === post.id);

        postAnalytics.forEach((analytics) => {
          const key = `${contentType}_${analytics.provider}`;

          if (!contentTypeMap.has(key)) {
            contentTypeMap.set(key, {
              provider: analytics.provider as ProviderType,
              posts: [],
              analytics: [],
            });
          }

          const data = contentTypeMap.get(key);
          if (data) {
            if (!data.posts.find((p) => p.id === post.id)) {
              data.posts.push(post);
            }
            data.analytics.push({
              id: analytics.id,
              postId: analytics.postId,
              provider: analytics.provider,
              capturedAt: analytics.capturedAt,
              views: analytics.views ?? 0,
              likes: analytics.likes ?? 0,
              comments: analytics.comments ?? 0,
              shares: analytics.shares ?? 0,
            });
          }
        });
      });

      const results: ContentTypePerformance[] = [];

      // Calculate performance metrics for each content type/provider combination
      for (const [key, data] of Array.from(contentTypeMap.entries())) {
        const [contentType, provider] = key.split("_");
        if (!contentType || !provider) continue;

        const totalImpressions = data.analytics.reduce((sum, a) => sum + a.views, 0);
        const totalEngagements = data.analytics.reduce(
          (sum, a) => sum + a.likes + a.comments + a.shares,
          0
        );
        const totalReach = Math.floor(totalImpressions * 0.7);

        const avgImpressions = data.posts.length > 0 ? totalImpressions / data.posts.length : 0;
        const avgEngagements = data.posts.length > 0 ? totalEngagements / data.posts.length : 0;
        const avgEngagementRate =
          totalImpressions > 0 ? (totalEngagements / totalImpressions) * 100 : 0;
        const avgReach = data.posts.length > 0 ? totalReach / data.posts.length : 0;

        // Calculate performance score (weighted combination of metrics)
        const performanceScore =
          avgEngagementRate * 0.4 + (avgReach / 1000) * 0.3 + (avgEngagements / 100) * 0.3;

        // Determine trend direction (mock calculation based on recent performance)
        const trendDirection = this.calculateTrendDirection(data.analytics, avgEngagements);

        // Generate recommendation based on performance
        const recommendation = this.generateContentTypeRecommendation(
          contentType,
          provider,
          avgEngagementRate
        );

        results.push({
          contentType: contentType as ContentType,
          provider: provider as ProviderType,
          postCount: data.posts.length,
          avgImpressions,
          avgEngagements,
          avgEngagementRate,
          avgReach,
          performanceScore,
          trendDirection,
          recommendation,
        });
      }

      return results.sort((a, b) => b.performanceScore - a.performanceScore);
    } catch (error) {
      analyticsLogger.error({ err: error }, "Error analyzing content type performance");
      return [];
    }
  }

  /**
   * Find top performing content type
   *
   * @param postsData - Post data with media information
   * @param analyticsData - Raw analytics data from database
   * @returns Name of the best performing content type
   */
  async findTopPerformingContentType(
    postsData: PostDataItem[],
    analyticsData: DomainAnalytics[]
  ): Promise<string> {
    try {
      const contentTypes = await this.analyzeContentTypePerformance(analyticsData, postsData);

      if (contentTypes.length === 0) {
        return "image"; // Default fallback
      }

      // Already sorted by performance score in analyzeContentTypePerformance
      const topContentType = contentTypes[0];
      return topContentType ? topContentType.contentType : "image";
    } catch (error) {
      analyticsLogger.error({ err: error }, "Error finding top performing content type");
      return "image";
    }
  }

  /**
   * Determine content type based on post media
   *
   * @param post - Post data with media information
   * @returns Content type classification
   * @private
   */
  private determineContentType(post: PostDataItem): ContentType {
    let contentType: ContentType = "text";

    if (post.media && post.media.length > 0) {
      const hasVideo = post.media.some((m) => m.type === "video");
      const hasMultiple = post.media.length > 1;

      if (hasVideo) contentType = "video";
      else if (hasMultiple) contentType = "carousel";
      else contentType = "image";
    }

    return contentType;
  }

  /**
   * Calculate trend direction based on recent analytics
   *
   * @param analytics - Normalized analytics data
   * @param avgEngagements - Average engagements for comparison
   * @returns Trend direction
   * @private
   */
  private calculateTrendDirection(
    analytics: NormalizedAnalytics[],
    avgEngagements: number
  ): "up" | "down" | "stable" {
    const recentAnalytics = analytics.filter((a) => {
      const capturedAt = new Date(a.capturedAt);
      const daysDiff = (Date.now() - capturedAt.getTime()) / (1000 * 60 * 60 * 24);
      return daysDiff <= 7;
    });

    const recentAvgEngagement =
      recentAnalytics.length > 0
        ? recentAnalytics.reduce((sum, a) => sum + a.likes + a.comments + a.shares, 0) /
          recentAnalytics.length
        : avgEngagements;

    let trendDirection: "up" | "down" | "stable" = "stable";
    if (recentAvgEngagement > avgEngagements * 1.1) trendDirection = "up";
    else if (recentAvgEngagement < avgEngagements * 0.9) trendDirection = "down";

    return trendDirection;
  }

  /**
   * Generate recommendation based on content type performance
   *
   * @param contentType - Content type
   * @param provider - Provider name
   * @param avgEngagementRate - Average engagement rate
   * @returns Recommendation text
   * @private
   */
  private generateContentTypeRecommendation(
    contentType: string,
    provider: string,
    avgEngagementRate: number
  ): string {
    if (avgEngagementRate > 5) {
      return `${contentType} content performs excellently on ${provider}. Increase production by 30%.`;
    } else if (avgEngagementRate > 3) {
      return `${contentType} content shows good performance on ${provider}. Consider A/B testing different variations.`;
    } else {
      return `${contentType} content underperforms on ${provider}. Analyze top performers and adjust strategy.`;
    }
  }
}
