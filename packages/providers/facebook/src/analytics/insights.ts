/**
 * @file insights.ts
 * @description Facebook Insights API client for audience, content, video,
 * real-time, and competitor analytics. Data-processing helpers are
 * delegated to insightsHelpers.ts to keep this file focused on API calls.
 * @layer infrastructure
 */

import { FacebookApiClient, FacebookCredentials } from "../apiClient.js";
import { createLogger } from "@observability/logger";

const logger = createLogger("provider:facebook:insights");

// Re-export all types from insightsTypes so existing importers continue to work
export type {
  FacebookInsightsOptions,
  FacebookAudienceInsights,
  FacebookContentInsights,
  FacebookVideoInsights,
  FacebookRealtimeInsights,
  FacebookCompetitorInsights,
} from "./insightsTypes.js";

import type {
  FacebookInsightsOptions,
  FacebookAudienceInsights,
  FacebookContentInsights,
  FacebookVideoInsights,
  FacebookRealtimeInsights,
  FacebookCompetitorInsights,
} from "./insightsTypes.js";

import {
  getMetricValue,
  processDemographicsData,
  processActivityData,
  processFanAcquisitionData,
  processPostInsights,
  calculateContentSummary,
  categorizeContent,
  processRetentionData,
  calculateDropOffPoints,
  processVideoDemographics,
  calculateAverageEngagement,
  calculatePostFrequency,
  analyzeContentTypes,
  calculateBenchmarks,
  identifyOpportunities,
} from "./insightsHelpers.js";

export class FacebookInsightsApi {
  private apiClient: FacebookApiClient;

  constructor(credentials: FacebookCredentials) {
    this.apiClient = new FacebookApiClient(credentials);
  }

  /**
   * Get comprehensive audience insights
   */
  async getAudienceInsights(options: FacebookInsightsOptions): Promise<FacebookAudienceInsights> {
    const audienceMetrics = [
      "page_fans",
      "page_followers_count",
      "page_impressions",
      "page_reach",
      "page_fans_by_age_gender",
      "page_fans_by_country",
      "page_fans_by_city",
      "page_fans_by_locale",
      "page_views_by_profile_tab_total",
      "page_fan_adds",
      "page_fan_removes",
      "page_fan_adds_by_paid_non_paid",
      "page_fans_online_per_day",
      "page_fans_online",
    ];

    const insights = await this.getPageInsights(audienceMetrics, options);
    const pageInfo = await this.apiClient.getPageInfo();

    const demographics = processDemographicsData(insights);
    const activity = processActivityData(insights);
    const fanAcquisition = processFanAcquisitionData(insights);

    return {
      pageId: this.apiClient.credentials.pageId,
      period: {
        since:
          options.since?.toISOString() ||
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        until: options.until?.toISOString() || new Date().toISOString(),
      },
      totalFans: pageInfo.fan_count || 0,
      totalFollowers: pageInfo.followers_count || 0,
      totalReach: getMetricValue(insights, "page_reach"),
      totalImpressions: getMetricValue(insights, "page_impressions"),
      demographics,
      activity,
      devices: {
        desktop: 0,
        mobile: 0,
        tablet: 0,
      },
      fanAcquisition,
      engagement: {
        totalEngagements: 0,
        engagementRate: 0,
        avgEngagementsPerPost: 0,
        topEngagementTypes: {},
      },
    };
  }

  /**
   * Get content performance insights
   */
  async getContentInsights(options: FacebookInsightsOptions): Promise<FacebookContentInsights> {
    const postsResponse = await this.apiClient.makeApiRequest(
      `/${this.apiClient.credentials.pageId}/posts?fields=id,type,created_time,message,attachments&limit=100`
    );

    const postsData = await postsResponse.json();
    const posts = postsData.data || [];

    const postInsights = [];
    for (const post of posts) {
      try {
        const postMetrics = await this.getPostInsightsById(post.id);
        postInsights.push({
          ...post,
          ...postMetrics,
        });
      } catch (error) {
        logger.warn({ err: error, postId: post.id }, "Failed to get insights for post");
      }
    }

    const summary = calculateContentSummary(postInsights);

    return {
      pageId: this.apiClient.credentials.pageId,
      period: {
        since:
          options.since?.toISOString() ||
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        until: options.until?.toISOString() || new Date().toISOString(),
      },
      posts: postInsights,
      summary,
      contentCategories: categorizeContent(postInsights),
    };
  }

  /**
   * Get video performance insights
   */
  async getVideoInsights(videoId: string): Promise<FacebookVideoInsights> {
    const videoMetrics = [
      "video_views",
      "video_views_unique",
      "video_views_autoplayed",
      "video_views_clicked_to_play",
      "video_view_time",
      "video_avg_time_watched",
      "video_view_time_by_age_bucket_and_gender",
      "video_view_time_by_country_id",
      "video_retention_graph",
      "video_retention_graph_clicked_to_play",
      "video_retention_graph_autoplayed",
    ];

    const insights = await this.getVideoSpecificInsights(videoId, videoMetrics);

    const videoResponse = await this.apiClient.makeApiRequest(
      `/${videoId}?fields=id,title,description,length,thumbnails,created_time,reactions.summary(total_count),comments.summary(total_count),shares`
    );

    const videoData = await videoResponse.json();

    return {
      videoId,
      title: videoData.title,
      description: videoData.description,
      duration: videoData.length || 0,
      thumbnailUrl: videoData.thumbnails?.data?.[0]?.uri,
      createdTime: videoData.created_time,
      views: {
        total: getMetricValue(insights, "video_views"),
        unique: getMetricValue(insights, "video_views_unique"),
        repeat:
          getMetricValue(insights, "video_views") - getMetricValue(insights, "video_views_unique"),
        autoplay: getMetricValue(insights, "video_views_autoplayed"),
        clickToPlay: getMetricValue(insights, "video_views_clicked_to_play"),
      },
      watchTime: {
        total: getMetricValue(insights, "video_view_time"),
        average: getMetricValue(insights, "video_avg_time_watched"),
        averagePercentage: videoData.length
          ? (getMetricValue(insights, "video_avg_time_watched") / videoData.length) * 100
          : 0,
      },
      audience: {
        retention: processRetentionData(insights),
        dropOffPoints: calculateDropOffPoints(insights),
        replaySegments: [],
      },
      engagement: {
        likes: videoData.reactions?.summary?.total_count || 0,
        comments: videoData.comments?.summary?.total_count || 0,
        shares: videoData.shares?.count || 0,
        reactions: {},
        saves: 0,
      },
      demographics: processVideoDemographics(insights),
      devices: {
        desktop: 0,
        mobile: 0,
        tablet: 0,
        connectedTV: 0,
      },
      traffic: {
        facebook: 0,
        instagram: 0,
        external: 0,
        direct: 0,
        suggested: 0,
      },
      subtitles: {
        viewsWithSubtitles: 0,
        viewsWithoutSubtitles: 0,
        subtitleLanguages: {},
      },
    };
  }

  /**
   * Get real-time insights and alerts
   */
  async getRealtimeInsights(): Promise<FacebookRealtimeInsights> {
    const currentMetrics = await this.getCurrentMetrics();
    const recentPosts = await this.getRecentPostPerformance();
    const trending = await this.getTrendingData();
    const competitors = await this.getCompetitorData();
    const alerts = await this.generateAlerts(currentMetrics, recentPosts);

    return {
      pageId: this.apiClient.credentials.pageId,
      timestamp: new Date().toISOString(),
      currentMetrics: {
        onlineFollowers: currentMetrics.onlineFollowers,
        currentReach: currentMetrics.reach,
        currentImpressions: currentMetrics.impressions,
        currentEngagements: currentMetrics.engagements,
        recentPostPerformance: recentPosts,
      },
      trending,
      competitors,
      alerts,
    };
  }

  /**
   * Get competitor analysis
   */
  async getCompetitorInsights(competitorPageIds: string[]): Promise<FacebookCompetitorInsights> {
    const competitors = [];

    for (const pageId of competitorPageIds) {
      try {
        const pageResponse = await this.apiClient.makeApiRequest(
          `/${pageId}?fields=id,name,fan_count,followers_count`
        );
        const pageData = await pageResponse.json();

        const postsResponse = await this.apiClient.makeApiRequest(
          `/${pageId}/posts?fields=id,reactions.summary(total_count),comments.summary(total_count),shares&limit=20`
        );
        const postsData = await postsResponse.json();
        const posts = postsData.data || [];

        const avgEngagement = calculateAverageEngagement(posts);
        const postFrequency = calculatePostFrequency(posts);

        competitors.push({
          pageId,
          pageName: pageData.name,
          followers: pageData.fan_count || pageData.followers_count || 0,
          avgEngagementRate: avgEngagement,
          postFrequency,
          topContentTypes: analyzeContentTypes(posts),
          performanceGap: {
            followers: 0,
            engagement: 0,
            reach: 0,
          },
        });
      } catch (error) {
        logger.warn({ err: error, pageId }, "Failed to analyze competitor");
      }
    }

    const benchmarks = calculateBenchmarks(competitors);
    const opportunities = identifyOpportunities(competitors);

    return {
      targetPageId: this.apiClient.credentials.pageId,
      competitors,
      benchmarks,
      opportunities,
    };
  }

  // ============================================================
  // Private API helpers
  // ============================================================

  private async getPageInsights(
    metrics: string[],
    options: FacebookInsightsOptions
  ): Promise<Array<Record<string, unknown>>> {
    const params = new URLSearchParams({
      metric: metrics.join(","),
      period: options.period,
    });

    if (options.since) {
      params.append("since", Math.floor(options.since.getTime() / 1000).toString());
    }
    if (options.until) {
      params.append("until", Math.floor(options.until.getTime() / 1000).toString());
    }
    if (options.datePreset) {
      params.append("date_preset", options.datePreset);
    }

    const response = await this.apiClient.makeApiRequest(
      `/${this.apiClient.credentials.pageId}/insights?${params}`
    );

    const data = await response.json();
    return data.data || [];
  }

  private async getPostInsightsById(postId: string): Promise<Record<string, unknown>> {
    const postMetrics = [
      "post_impressions",
      "post_reach",
      "post_reactions_by_type_total",
      "post_clicks",
      "post_video_views",
      "post_video_view_time",
    ];

    try {
      const response = await this.apiClient.makeApiRequest(
        `/${postId}/insights?metric=${postMetrics.join(",")}`
      );
      const data = await response.json();
      return processPostInsights(data.data || []);
    } catch (error) {
      logger.warn({ err: error, postId }, "Failed to get post insights");
      return {};
    }
  }

  private async getVideoSpecificInsights(
    videoId: string,
    metrics: string[]
  ): Promise<Array<Record<string, unknown>>> {
    const response = await this.apiClient.makeApiRequest(
      `/${videoId}/video_insights?metric=${metrics.join(",")}`
    );
    const data = await response.json();
    return data.data || [];
  }

  private async getCurrentMetrics(): Promise<{
    onlineFollowers: number;
    reach: number;
    impressions: number;
    engagements: number;
  }> {
    return {
      onlineFollowers: 0,
      reach: 0,
      impressions: 0,
      engagements: 0,
    };
  }

  private async getRecentPostPerformance(): Promise<unknown[]> {
    return [];
  }

  private async getTrendingData(): Promise<{ hashtags: unknown[]; topics: unknown[] }> {
    return {
      hashtags: [],
      topics: [],
    };
  }

  private async getCompetitorData(): Promise<unknown[]> {
    return [];
  }

  private async generateAlerts(
    _currentMetrics: {
      onlineFollowers: number;
      reach: number;
      impressions: number;
      engagements: number;
    },
    _recentPosts: unknown[]
  ): Promise<unknown[]> {
    return [];
  }
}
