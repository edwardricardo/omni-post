/**
 * Performance Analyzer Module
 *
 * Analyzes content length and media performance to identify optimal strategies.
 * Provides insights into content length optimization and media type effectiveness.
 *
 * @module PerformanceAnalyzer
 */

import type { DomainAnalytics } from "@shared/types";
import { createLogger } from "../../lib/logger.js";

const analyticsLogger = createLogger("analytics");

import type { PostDataItem, NormalizedAnalytics } from "./types";
import type {
  ContentLengthAnalysis,
  MediaPerformanceComparison,
  ProviderType,
} from "@shared/analytics";

/**
 * Internal interface for content length category
 */
interface ContentLengthCategory {
  posts: Array<{
    post: PostDataItem;
    analytics: NormalizedAnalytics[];
    length: number;
  }>;
  totalEngagement: number;
  totalLength: number;
}

/**
 * Internal interface for media category data
 */
interface MediaCategoryData {
  posts: Array<{
    post: PostDataItem;
    analytics: NormalizedAnalytics[];
  }>;
  totalEngagement: number;
  totalReach: number;
}

/**
 * Performance Analyzer
 *
 * Provides methods for analyzing content length and media performance
 * to optimize content strategy across platforms.
 */
export class PerformanceAnalyzer {
  /**
   * Analyze content length performance
   *
   * @param postsData - Post data with content
   * @param analyticsData - Raw analytics data from database
   * @returns Content length analysis by provider
   */
  async analyzeContentLength(
    postsData: PostDataItem[],
    analyticsData: DomainAnalytics[]
  ): Promise<ContentLengthAnalysis> {
    try {
      const analysis: ContentLengthAnalysis = {
        byProvider: {} as Record<
          ProviderType,
          {
            shortContent: { avgLength: number; avgEngagement: number };
            mediumContent: { avgLength: number; avgEngagement: number };
            longContent: { avgLength: number; avgEngagement: number };
            optimal: { length: number; engagementRate: number };
          }
        >,
        generalRecommendation: "",
      };

      // Group by provider and analyze content length
      const providerMap = new Map<
        ProviderType,
        {
          posts: Array<{ post: PostDataItem; analytics: NormalizedAnalytics[]; length: number }>;
        }
      >();

      // Collect posts with their analytics and content length
      postsData.forEach((post) => {
        const firstContent = post.contents?.[0];
        const content = firstContent?.content || "";
        const contentLength = content.length;
        const postAnalytics = analyticsData.filter((a) => a.postId && a.postId === post.id);

        postAnalytics.forEach((analytics) => {
          const provider = analytics.provider as ProviderType;

          if (!providerMap.has(provider)) {
            providerMap.set(provider, { posts: [] });
          }

          const providerData = providerMap.get(provider);
          if (providerData) {
            providerData.posts.push({
              post,
              analytics: [
                {
                  id: analytics.id,
                  postId: analytics.postId,
                  provider: analytics.provider,
                  capturedAt: analytics.capturedAt,
                  views: analytics.views ?? 0,
                  likes: analytics.likes ?? 0,
                  comments: analytics.comments ?? 0,
                  shares: analytics.shares ?? 0,
                },
              ],
              length: contentLength,
            });
          }
        });
      });

      // Analyze each provider
      for (const [provider, data] of Array.from(providerMap.entries())) {
        const categories: Record<"short" | "medium" | "long", ContentLengthCategory> = {
          short: { posts: [], totalEngagement: 0, totalLength: 0 },
          medium: { posts: [], totalEngagement: 0, totalLength: 0 },
          long: { posts: [], totalEngagement: 0, totalLength: 0 },
        };

        // Categorize posts and calculate metrics
        data.posts.forEach(({ post, analytics, length }) => {
          const category = this.getLengthCategory(length, provider);
          const engagement = analytics.reduce((sum, a) => sum + a.likes + a.comments + a.shares, 0);

          categories[category].posts.push({ post, analytics, length });
          categories[category].totalEngagement += engagement;
          categories[category].totalLength += length;
        });

        // Calculate averages for each category
        const shortAvg =
          categories.short.posts.length > 0
            ? {
                avgLength: categories.short.totalLength / categories.short.posts.length,
                avgEngagement: categories.short.totalEngagement / categories.short.posts.length,
              }
            : { avgLength: 0, avgEngagement: 0 };

        const mediumAvg =
          categories.medium.posts.length > 0
            ? {
                avgLength: categories.medium.totalLength / categories.medium.posts.length,
                avgEngagement: categories.medium.totalEngagement / categories.medium.posts.length,
              }
            : { avgLength: 0, avgEngagement: 0 };

        const longAvg =
          categories.long.posts.length > 0
            ? {
                avgLength: categories.long.totalLength / categories.long.posts.length,
                avgEngagement: categories.long.totalEngagement / categories.long.posts.length,
              }
            : { avgLength: 0, avgEngagement: 0 };

        // Find optimal length
        const allCategories = [
          { type: "short" as const, ...shortAvg },
          { type: "medium" as const, ...mediumAvg },
          { type: "long" as const, ...longAvg },
        ].filter((cat) => cat.avgEngagement > 0);

        const optimal =
          allCategories.length > 0
            ? allCategories.reduce((best, current) =>
                current.avgEngagement > best.avgEngagement ? current : best
              )
            : { type: "medium" as const, avgLength: 150, avgEngagement: 0 };

        // Calculate engagement rate for optimal category
        const optimalPosts = categories[optimal.type]?.posts || [];
        const totalImpressions = optimalPosts.reduce(
          (sum, { analytics }) => sum + analytics.reduce((aSum, a) => aSum + a.views, 0),
          0
        );
        const engagementRate =
          totalImpressions > 0
            ? ((optimal.avgEngagement * optimalPosts.length) / totalImpressions) * 100
            : 0;

        analysis.byProvider[provider] = {
          shortContent: shortAvg,
          mediumContent: mediumAvg,
          longContent: longAvg,
          optimal: {
            length: Math.round(optimal.avgLength),
            engagementRate,
          },
        };
      }

      // Generate general recommendation
      analysis.generalRecommendation = this.generateLengthRecommendation(analysis.byProvider);

      return analysis;
    } catch (error) {
      analyticsLogger.error({ err: error }, "Error analyzing content length");
      return {
        byProvider: {} as Record<
          ProviderType,
          {
            shortContent: { avgLength: number; avgEngagement: number };
            mediumContent: { avgLength: number; avgEngagement: number };
            longContent: { avgLength: number; avgEngagement: number };
            optimal: { length: number; engagementRate: number };
          }
        >,
        generalRecommendation: "Unable to analyze content length due to insufficient data.",
      };
    }
  }

  /**
   * Analyze media performance
   *
   * @param postsData - Post data with media information
   * @param analyticsData - Raw analytics data from database
   * @returns Media performance comparison across different media types
   */
  async analyzeMediaPerformance(
    postsData: PostDataItem[],
    analyticsData: DomainAnalytics[]
  ): Promise<MediaPerformanceComparison> {
    try {
      const categories: Record<
        "textOnly" | "withImages" | "withVideos" | "withCarousel" | "mixed",
        MediaCategoryData
      > = {
        textOnly: { posts: [], totalEngagement: 0, totalReach: 0 },
        withImages: { posts: [], totalEngagement: 0, totalReach: 0 },
        withVideos: { posts: [], totalEngagement: 0, totalReach: 0 },
        withCarousel: { posts: [], totalEngagement: 0, totalReach: 0 },
        mixed: { posts: [], totalEngagement: 0, totalReach: 0 },
      };

      // Categorize posts based on media content
      postsData.forEach((post) => {
        const postAnalytics = analyticsData.filter((a) => a.postId && a.postId === post.id);
        const normalizedAnalytics: NormalizedAnalytics[] = postAnalytics.map((a) => ({
          id: a.id,
          postId: a.postId,
          provider: a.provider,
          capturedAt: a.capturedAt,
          views: a.views ?? 0,
          likes: a.likes ?? 0,
          comments: a.comments ?? 0,
          shares: a.shares ?? 0,
        }));

        const totalEngagement = normalizedAnalytics.reduce(
          (sum, a) => sum + a.likes + a.comments + a.shares,
          0
        );
        const totalImpressions = normalizedAnalytics.reduce((sum, a) => sum + a.views, 0);
        const reach = Math.floor(totalImpressions * 0.7);

        const category = this.categorizeMediaType(post);

        categories[category].posts.push({ post, analytics: normalizedAnalytics });
        categories[category].totalEngagement += totalEngagement;
        categories[category].totalReach += reach;
      });

      // Calculate averages for each category
      const result: MediaPerformanceComparison = {
        textOnly: {
          count: categories.textOnly.posts.length,
          avgEngagement:
            categories.textOnly.posts.length > 0
              ? categories.textOnly.totalEngagement / categories.textOnly.posts.length
              : 0,
          avgReach:
            categories.textOnly.posts.length > 0
              ? categories.textOnly.totalReach / categories.textOnly.posts.length
              : 0,
        },
        withImages: {
          count: categories.withImages.posts.length,
          avgEngagement:
            categories.withImages.posts.length > 0
              ? categories.withImages.totalEngagement / categories.withImages.posts.length
              : 0,
          avgReach:
            categories.withImages.posts.length > 0
              ? categories.withImages.totalReach / categories.withImages.posts.length
              : 0,
        },
        withVideos: {
          count: categories.withVideos.posts.length,
          avgEngagement:
            categories.withVideos.posts.length > 0
              ? categories.withVideos.totalEngagement / categories.withVideos.posts.length
              : 0,
          avgReach:
            categories.withVideos.posts.length > 0
              ? categories.withVideos.totalReach / categories.withVideos.posts.length
              : 0,
        },
        withCarousel: {
          count: categories.withCarousel.posts.length,
          avgEngagement:
            categories.withCarousel.posts.length > 0
              ? categories.withCarousel.totalEngagement / categories.withCarousel.posts.length
              : 0,
          avgReach:
            categories.withCarousel.posts.length > 0
              ? categories.withCarousel.totalReach / categories.withCarousel.posts.length
              : 0,
        },
        mixed: {
          count: categories.mixed.posts.length,
          avgEngagement:
            categories.mixed.posts.length > 0
              ? categories.mixed.totalEngagement / categories.mixed.posts.length
              : 0,
          avgReach:
            categories.mixed.posts.length > 0
              ? categories.mixed.totalReach / categories.mixed.posts.length
              : 0,
        },
        recommendation: "",
        performanceMultipliers: {},
      };

      // Calculate performance multipliers (relative to text-only baseline)
      const baseline = Math.max(1, result.textOnly.avgEngagement);
      result.performanceMultipliers = {
        images: result.withImages.avgEngagement / baseline,
        videos: result.withVideos.avgEngagement / baseline,
        carousel: result.withCarousel.avgEngagement / baseline,
        mixed: result.mixed.avgEngagement / baseline,
      };

      // Generate recommendation based on best performing media type
      result.recommendation = this.generateMediaRecommendation(result, baseline);

      return result;
    } catch (error) {
      analyticsLogger.error({ err: error }, "Error analyzing media performance");
      return {
        textOnly: { count: 0, avgEngagement: 0, avgReach: 0 },
        withImages: { count: 0, avgEngagement: 0, avgReach: 0 },
        withVideos: { count: 0, avgEngagement: 0, avgReach: 0 },
        withCarousel: { count: 0, avgEngagement: 0, avgReach: 0 },
        mixed: { count: 0, avgEngagement: 0, avgReach: 0 },
        recommendation: "Unable to analyze media performance due to insufficient data.",
        performanceMultipliers: {},
      };
    }
  }

  /**
   * Get content length category based on provider
   *
   * @param length - Content length
   * @param provider - Provider type
   * @returns Length category
   * @private
   */
  private getLengthCategory(length: number, provider: ProviderType): "short" | "medium" | "long" {
    if (provider === "twitter") {
      if (length <= 100) return "short";
      if (length <= 200) return "medium";
      return "long";
    } else {
      if (length <= 150) return "short";
      if (length <= 500) return "medium";
      return "long";
    }
  }

  /**
   * Generate recommendation based on content length analysis
   *
   * @param byProvider - Provider-specific content length data
   * @returns Recommendation text
   * @private
   */
  private generateLengthRecommendation(
    byProvider: Record<
      ProviderType,
      {
        shortContent: { avgLength: number; avgEngagement: number };
        mediumContent: { avgLength: number; avgEngagement: number };
        longContent: { avgLength: number; avgEngagement: number };
        optimal: { length: number; engagementRate: number };
      }
    >
  ): string {
    const allOptimalLengths = Object.values(byProvider)
      .map((p) => p.optimal.length)
      .filter((l) => l > 0);

    if (allOptimalLengths.length > 0) {
      const avgOptimalLength =
        allOptimalLengths.reduce((sum, l) => sum + l, 0) / allOptimalLengths.length;
      return `Optimal content length averages ${Math.round(avgOptimalLength)} characters across platforms. Platform-specific recommendations: ${Object.keys(
        byProvider
      )
        .map(
          (provider) => `${provider}: ${byProvider[provider as ProviderType]?.optimal.length} chars`
        )
        .join(", ")}.`;
    } else {
      return "Insufficient data to determine optimal content length. Try varying content length and monitoring engagement.";
    }
  }

  /**
   * Categorize post by media type
   *
   * @param post - Post data with media
   * @returns Media category
   * @private
   */
  private categorizeMediaType(
    post: PostDataItem
  ): "textOnly" | "withImages" | "withVideos" | "withCarousel" | "mixed" {
    const media = post.media || [];

    if (media.length === 0) {
      return "textOnly";
    } else if (media.length > 1) {
      const hasVideo = media.some((m) => m.type === "video");
      const hasImage = media.some((m) => m.type === "image");

      if (hasVideo && hasImage) {
        return "mixed";
      } else {
        return "withCarousel";
      }
    } else {
      const mediaType = media[0]?.type;
      if (mediaType === "video") return "withVideos";
      else return "withImages";
    }
  }

  /**
   * Generate recommendation based on media performance
   *
   * @param result - Media performance comparison result
   * @param baseline - Baseline engagement (text-only)
   * @returns Recommendation text
   * @private
   */
  private generateMediaRecommendation(
    result: MediaPerformanceComparison,
    baseline: number
  ): string {
    const mediaTypes = [
      { type: "text-only", engagement: result.textOnly.avgEngagement },
      { type: "images", engagement: result.withImages.avgEngagement },
      { type: "videos", engagement: result.withVideos.avgEngagement },
      { type: "carousel", engagement: result.withCarousel.avgEngagement },
      { type: "mixed media", engagement: result.mixed.avgEngagement },
    ].filter((m) => m.engagement > 0);

    if (mediaTypes.length > 0) {
      const bestPerforming = mediaTypes.reduce((best, current) =>
        current.engagement > best.engagement ? current : best
      );

      const improvement = ((bestPerforming.engagement - baseline) / baseline) * 100;

      if (improvement > 20) {
        return `Posts with ${bestPerforming.type} perform ${improvement.toFixed(0)}% better than text-only posts. Increase ${bestPerforming.type} content by 40%.`;
      } else if (improvement > 0) {
        return `Posts with ${bestPerforming.type} show the best performance. Consider gradual increase in this content type.`;
      } else {
        return "Text-only posts perform well. Consider testing different media types to find optimization opportunities.";
      }
    } else {
      return "Insufficient data to analyze media performance. Try creating posts with different media types.";
    }
  }
}
