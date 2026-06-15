/**
 * @file contentAnalyzer.ts
 * @description Coordinator for comprehensive content analysis across multiple platforms,
 *              delegating to specialized analyzers for posts, hashtags, media, and timing.
 * @layer infrastructure
 * @module contentAnalyzer
 */

import type { DomainAnalytics } from "@shared/types";
import { createLogger } from "../../lib/logger.js";

const analyticsLogger = createLogger("analytics");

import type { PostDataItem } from "./types.js";
import type {
  TopPerformingPost,
  ContentTypePerformance,
  HashtagAnalytics,
  ContentLengthAnalysis,
  MediaPerformanceComparison,
  OptimalTiming,
  ProviderType,
  ContentPerformanceInsights,
} from "@shared/types/analytics.js";

// Import specialized analyzers
import { ContentMetricsAnalyzer } from "./ContentMetricsAnalyzer.js";
import { PerformanceAnalyzer } from "./PerformanceAnalyzer.js";
import { HashtagTimingAnalyzer } from "./HashtagTimingAnalyzer.js";

// Initialize analyzer instances
const contentMetricsAnalyzer = new ContentMetricsAnalyzer();
const performanceAnalyzer = new PerformanceAnalyzer();
const hashtagTimingAnalyzer = new HashtagTimingAnalyzer();

/**
 * Get top performing posts based on analytics data
 *
 * @param analyticsData - Raw analytics data from database
 * @param postsData - Post data with content and media information
 * @param limit - Maximum number of posts to return
 * @returns Array of top performing posts sorted by engagement rate
 */
async function getTopPerformingPosts(
  analyticsData: DomainAnalytics[],
  postsData: PostDataItem[],
  limit: number
): Promise<TopPerformingPost[]> {
  return contentMetricsAnalyzer.getTopPerformingPosts(analyticsData, postsData, limit);
}

/**
 * Analyze performance by content type
 *
 * @param analyticsData - Raw analytics data from database
 * @param postsData - Post data with media information
 * @returns Array of content type performance metrics
 */
async function analyzeContentTypePerformance(
  analyticsData: DomainAnalytics[],
  postsData: PostDataItem[]
): Promise<ContentTypePerformance[]> {
  return contentMetricsAnalyzer.analyzeContentTypePerformance(analyticsData, postsData);
}

/**
 * Analyze hashtag performance
 *
 * @param postsData - Post data with content and tags
 * @param analyticsData - Raw analytics data from database
 * @returns Array of hashtag analytics sorted by engagement rate
 */
async function analyzeHashtagPerformance(
  postsData: PostDataItem[],
  analyticsData: DomainAnalytics[]
): Promise<HashtagAnalytics[]> {
  return hashtagTimingAnalyzer.analyzeHashtagPerformance(postsData, analyticsData);
}

/**
 * Analyze content length performance
 *
 * @param postsData - Post data with content
 * @param analyticsData - Raw analytics data from database
 * @returns Content length analysis by provider
 */
async function analyzeContentLength(
  postsData: PostDataItem[],
  analyticsData: DomainAnalytics[]
): Promise<ContentLengthAnalysis> {
  return performanceAnalyzer.analyzeContentLength(postsData, analyticsData);
}

/**
 * Analyze media performance
 *
 * @param postsData - Post data with media information
 * @param analyticsData - Raw analytics data from database
 * @returns Media performance comparison across different media types
 */
async function analyzeMediaPerformance(
  postsData: PostDataItem[],
  analyticsData: DomainAnalytics[]
): Promise<MediaPerformanceComparison> {
  return performanceAnalyzer.analyzeMediaPerformance(postsData, analyticsData);
}

/**
 * Calculate optimal timing for posting
 *
 * @param analyticsData - Raw analytics data from database
 * @param provider - Optional specific provider to analyze
 * @returns Optimal timing information with best day, hour, and confidence
 */
export async function calculateOptimalTiming(
  analyticsData: DomainAnalytics[],
  provider?: ProviderType
): Promise<OptimalTiming> {
  return hashtagTimingAnalyzer.calculateOptimalTiming(analyticsData, provider);
}

/**
 * Generate comprehensive content performance insights
 *
 * @param analyticsData - Raw analytics data from database
 * @param postsData - Post data with content and media information
 * @returns Comprehensive content performance insights
 */
export async function generateContentInsights(
  analyticsData: DomainAnalytics[],
  postsData: PostDataItem[]
): Promise<ContentPerformanceInsights> {
  try {
    const [
      topPerformingPosts,
      performanceByContentType,
      hashtagAnalytics,
      optimalPostTiming,
      contentLengthAnalysis,
      mediaPerformanceComparison,
    ] = await Promise.all([
      getTopPerformingPosts(analyticsData, postsData, 10),
      analyzeContentTypePerformance(analyticsData, postsData),
      analyzeHashtagPerformance(postsData, analyticsData),
      calculateOptimalTiming(analyticsData),
      analyzeContentLength(postsData, analyticsData),
      analyzeMediaPerformance(postsData, analyticsData),
    ]);

    return {
      topPerformingPosts,
      performanceByContentType,
      hashtagAnalytics,
      optimalPostTiming,
      contentLengthAnalysis,
      mediaPerformanceComparison,
      viralContentPatterns: [], // Placeholder for future viral pattern detection
    };
  } catch (error) {
    analyticsLogger.error({ err: error }, "Error generating content insights");
    return {
      topPerformingPosts: [],
      performanceByContentType: [],
      hashtagAnalytics: [],
      optimalPostTiming: {
        bestDayOfWeek: "Tuesday",
        bestHour: 10,
        bestTimeZone: "UTC",
        engagementMultiplier: 1.0,
        confidence: "low",
      },
      contentLengthAnalysis: {
        byProvider: {} as Record<
          ProviderType,
          {
            shortContent: { avgLength: number; avgEngagement: number };
            mediumContent: { avgLength: number; avgEngagement: number };
            longContent: { avgLength: number; avgEngagement: number };
            optimal: { length: number; engagementRate: number };
          }
        >,
        generalRecommendation: "Insufficient data to analyze content length.",
      },
      mediaPerformanceComparison: {
        textOnly: { count: 0, avgEngagement: 0, avgReach: 0 },
        withImages: { count: 0, avgEngagement: 0, avgReach: 0 },
        withVideos: { count: 0, avgEngagement: 0, avgReach: 0 },
        withCarousel: { count: 0, avgEngagement: 0, avgReach: 0 },
        mixed: { count: 0, avgEngagement: 0, avgReach: 0 },
        recommendation: "Insufficient data to analyze media performance.",
        performanceMultipliers: {},
      },
      viralContentPatterns: [],
    };
  }
}
