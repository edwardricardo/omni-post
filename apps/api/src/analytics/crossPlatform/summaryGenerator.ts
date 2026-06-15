/**
 * @file summaryGenerator.ts
 * @description Generates high-level summary metrics and provider-specific metrics
 *              from analytics and post data using real aggregation logic.
 * @layer infrastructure
 */

import type { DomainAnalytics } from "@shared/types";
import type { AnalyticsSummary, ProviderMetrics } from "@shared/types/analytics.js";
import type { PostDataItem, ChannelDataItem } from "./types.js";
import { AnalyticsAggregator } from "../analyticsUtils.js";

/**
 * Generate overall analytics summary
 *
 * Calculates real metrics from analytics data. Cost, ROI, click,
 * and content type fields return zero/empty — they require real
 * provider API data or cost tracking to implement properly.
 */
export async function generateSummary(
  analyticsData: DomainAnalytics[],
  _postsData: PostDataItem[]
): Promise<AnalyticsSummary> {
  const metrics = AnalyticsAggregator.calculateEngagementMetrics(analyticsData);

  const totalImpressions = metrics.totalViews;
  const totalEngagements = metrics.totalEngagement;
  const averageEngagementRate = metrics.avgEngagementRate;

  // Find top performing provider from real data
  const providerPerformance = groupByProvider(analyticsData);
  const topPerformingProvider = findTopPerformingProvider(providerPerformance);

  return {
    totalImpressions,
    totalEngagements,
    averageEngagementRate,
    // Future: These require real data sources
    totalReach: 0,
    totalClicks: 0,
    clickThroughRate: 0,
    totalCost: 0,
    totalRevenue: 0,
    roi: 0,
    followerGrowth: 0,
    topPerformingProvider,
    // Future: Requires content type classification on posts
    topPerformingContentType: "",
  };
}

/**
 * Generate provider-specific metrics
 *
 * Calculates real engagement metrics per provider. Cost, ROI, click,
 * and optimal timing fields return zero/empty — they require real
 * provider API data to implement properly.
 */
export async function generateProviderMetrics(
  analyticsData: DomainAnalytics[],
  postsData: PostDataItem[],
  _channelsData: ChannelDataItem[]
): Promise<ProviderMetrics[]> {
  const providerGroups = groupByProvider(analyticsData);
  const results: ProviderMetrics[] = [];

  for (const [provider, analytics] of Object.entries(providerGroups)) {
    const providerPosts = postsData.filter((p) => p.channels?.some((c) => c.provider === provider));

    const metrics = AnalyticsAggregator.calculateEngagementMetrics(analytics);

    const impressions = metrics.totalViews;
    const likes = metrics.totalLikes;
    const comments = metrics.totalComments;
    const shares = metrics.totalShares;
    const engagements = metrics.totalEngagement;
    const engagementRate = metrics.avgEngagementRate;

    const avgPostPerformance = providerPosts.length > 0 ? engagements / providerPosts.length : 0;

    // Get top hashtags from real post data
    const topHashtags = await getTopHashtagsForProvider(providerPosts, analytics);

    results.push({
      provider: provider as ProviderMetrics["provider"],
      impressions,
      engagements,
      clicks: 0, // Future: Requires provider API click tracking
      shares,
      comments,
      likes,
      saves: 0, // Future: Requires provider API save tracking
      reach: 0, // Future: Requires provider API reach data
      followerGrowth: 0, // Future: Requires provider API follower counts
      engagementRate,
      clickRate: 0, // Future: Requires provider API click data
      cost: 0, // Future: Requires ad spend tracking integration
      revenue: 0, // Future: Requires conversion tracking
      roi: 0, // Future: Requires cost and revenue tracking
      postCount: providerPosts.length,
      avgPostPerformance,
      // Future: Requires real timing analysis from provider APIs
      bestPostingTime: {
        bestDayOfWeek: "Monday",
        bestHour: 0,
        bestTimeZone: "UTC",
        engagementMultiplier: 1,
        confidence: "low",
      },
      topHashtags,
    });
  }

  return results.sort((a, b) => b.engagementRate - a.engagementRate);
}

/**
 * Group analytics data by provider
 *
 * Organizes analytics entries into provider-specific groups for
 * comparative analysis and metrics calculation.
 */
function groupByProvider(analyticsData: DomainAnalytics[]): Record<string, DomainAnalytics[]> {
  const groups: Record<string, DomainAnalytics[]> = {};

  analyticsData.forEach((analytics) => {
    const provider = analytics.provider.toString();
    if (!groups[provider]) {
      groups[provider] = [];
    }
    groups[provider].push(analytics);
  });

  return groups;
}

/**
 * Find the top performing provider by engagement rate
 *
 * Compares engagement rates across all providers and returns
 * the provider with the highest engagement rate.
 */
function findTopPerformingProvider(providerPerformance: Record<string, DomainAnalytics[]>): string {
  let topProvider = "";
  let bestEngagementRate = 0;

  for (const [provider, analytics] of Object.entries(providerPerformance)) {
    const totalImpressions = analytics.reduce((sum, a) => sum + (a.views || 0), 0);
    const totalEngagements = analytics.reduce(
      (sum, a) => sum + (a.likes || 0) + (a.comments || 0) + (a.shares || 0),
      0
    );

    const engagementRate = totalImpressions > 0 ? (totalEngagements / totalImpressions) * 100 : 0;

    if (engagementRate > bestEngagementRate) {
      bestEngagementRate = engagementRate;
      topProvider = provider;
    }
  }

  return topProvider || "twitter";
}

// Future: calculateOptimalTiming
// Determine optimal posting times by analyzing real engagement data grouped by
// hour-of-day and day-of-week from provider analytics APIs, not random selection.
// Requires: Sufficient historical analytics data with timestamp granularity.

// Future: findTopPerformingContentType
// Identify top content types by classifying posts (text, image, video, carousel)
// and aggregating real engagement metrics per type, not random scores.
// Requires: Content type classification on Post model.

/**
 * Get top performing hashtags for a provider
 *
 * Analyzes post tags and their associated analytics to identify
 * the most effective hashtags by average engagement.
 */
async function getTopHashtagsForProvider(
  posts: PostDataItem[],
  analytics: DomainAnalytics[]
): Promise<string[]> {
  const hashtagPerformance: Record<string, { count: number; totalEngagement: number }> = {};

  posts.forEach((post) => {
    const content = post.contents?.[0];
    if (content?.tags) {
      const postAnalytics = analytics.filter((a) => a.postId === post.id);
      const totalEngagement = postAnalytics.reduce(
        (sum, a) => sum + (a.likes || 0) + (a.comments || 0) + (a.shares || 0),
        0
      );

      content.tags.forEach((tag: string) => {
        if (!hashtagPerformance[tag]) {
          hashtagPerformance[tag] = { count: 0, totalEngagement: 0 };
        }
        hashtagPerformance[tag].count++;
        hashtagPerformance[tag].totalEngagement += totalEngagement;
      });
    }
  });

  const sortedHashtags = Object.entries(hashtagPerformance)
    .map(([hashtag, data]) => ({
      hashtag,
      avgEngagement: data.count > 0 ? data.totalEngagement / data.count : 0,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement)
    .slice(0, 5)
    .map((item) => item.hashtag);

  return sortedHashtags;
}
