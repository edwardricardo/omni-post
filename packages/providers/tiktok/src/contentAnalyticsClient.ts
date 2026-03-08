import { createExternalApiCircuitBreaker } from "@adapters/external-apis";
import { CommonFallbackStrategies } from "@adapters/fallback-strategies";
import { ProviderError } from "@providers/shared";
import * as client from "prom-client";
import axios from "axios";
import type { TikTokCredentials } from "./tiktokTypes.js";

export interface TikTokContentAnalyticsCredentials extends TikTokCredentials {
  analyticsApiKey: string;
}

export interface TikTokVideoAnalytics {
  videoId: string;
  title: string;
  publishedAt: string;
  duration: number;
  metrics: {
    views: number;
    uniqueViews: number;
    likes: number;
    shares: number;
    comments: number;
    saves: number;
    profileVisits: number;
    follows: number;
    engagementRate: number;
    completionRate: number;
    dropOffPoints: Array<{ timestamp: number; percentage: number }>;
    replayRate: number;
    forwardJumps: number;
    backwardJumps: number;
  };
  audience: {
    demographics: {
      age: Record<string, number>;
      gender: Record<string, number>;
      location: Record<string, number>;
    };
    behavior: {
      deviceType: Record<string, number>;
      watchTime: Record<string, number>;
      engagementTime: Record<string, number>;
    };
    interests: Array<{ category: string; affinity: number }>;
  };
  traffic: {
    sources: Record<string, number>;
    hashtags: Array<{ hashtag: string; views: number }>;
    sounds: Array<{ soundId: string; views: number }>;
  };
  performance: {
    viralityScore: number;
    trendingPotential: number;
    algorithmScore: number;
    qualityScore: number;
    contentScore: number;
  };
}

export interface TikTokProfileAnalytics {
  profileId: string;
  username: string;
  displayName: string;
  period: { startDate: string; endDate: string };
  metrics: {
    followers: {
      total: number;
      gained: number;
      lost: number;
      netGrowth: number;
      growthRate: number;
    };
    engagement: {
      totalLikes: number;
      totalShares: number;
      totalComments: number;
      averageEngagementRate: number;
      engagementGrowth: number;
    };
    content: {
      videosPosted: number;
      totalViews: number;
      averageViews: number;
      bestPerformingVideoId: string;
      worstPerformingVideoId: string;
    };
    reach: {
      impressions: number;
      reach: number;
      profileViews: number;
      uniqueProfileViews: number;
    };
  };
  audience: {
    demographics: {
      age: Record<string, number>;
      gender: Record<string, number>;
      topCountries: Array<{ country: string; percentage: number }>;
      topCities: Array<{ city: string; percentage: number }>;
    };
    activity: {
      activeHours: Record<string, number>;
      activeDays: Record<string, number>;
      peakActivityTime: string;
    };
    interests: Array<{ category: string; affinity: number }>;
    followingBehavior: {
      averageFollowing: number;
      engagementFrequency: number;
      contentConsumption: Record<string, number>;
    };
  };
  trends: {
    popularHashtags: Array<{ hashtag: string; usage: number; performance: number }>;
    popularSounds: Array<{ soundId: string; title: string; usage: number }>;
    contentCategories: Record<string, number>;
    bestPostingTimes: Array<{ hour: number; day: string; performance: number }>;
  };
}

export interface TikTokCompetitorAnalysis {
  competitorId: string;
  username: string;
  metrics: {
    followers: number;
    averageViews: number;
    averageLikes: number;
    averageShares: number;
    averageComments: number;
    engagementRate: number;
    postingFrequency: number;
  };
  content: {
    topPerformingVideos: Array<{
      videoId: string;
      views: number;
      engagement: number;
      hashtags: string[];
    }>;
    contentCategories: Record<string, number>;
    averageVideoDuration: number;
    commonHashtags: string[];
    commonSounds: string[];
  };
  strategy: {
    postingPattern: {
      frequency: string;
      bestTimes: string[];
      consistency: number;
    };
    engagement: {
      responseRate: number;
      responseTime: number;
      communityEngagement: number;
    };
    growth: {
      followerGrowthRate: number;
      contentGrowthRate: number;
      trendAdoption: number;
    };
  };
}

export interface TikTokHashtagAnalytics {
  hashtag: string;
  metrics: {
    totalPosts: number;
    totalViews: number;
    averageViews: number;
    engagementRate: number;
    growth: number;
    difficulty: number;
    trendingScore: number;
  };
  performance: {
    topVideos: Array<{
      videoId: string;
      views: number;
      likes: number;
      authorId: string;
    }>;
    averagePerformance: {
      views: number;
      likes: number;
      shares: number;
      comments: number;
    };
  };
  usage: {
    topCreators: Array<{ creatorId: string; postsCount: number; totalViews: number }>;
    relatedHashtags: Array<{ hashtag: string; correlation: number }>;
    seasonality: Record<string, number>;
    demographics: {
      age: Record<string, number>;
      gender: Record<string, number>;
      location: Record<string, number>;
    };
  };
  insights: {
    bestPractices: string[];
    optimalTiming: Array<{ hour: number; day: string; performance: number }>;
    contentRecommendations: string[];
    riskFactors: string[];
  };
}

// Global registry for circuit breaker metrics
const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);

const TIKTOK_ANALYTICS_BASE_URL = "https://analytics-api.tiktok.com/v2";

export class TikTokContentAnalyticsClient {
  private credentials: TikTokContentAnalyticsCredentials;

  constructor(credentials: TikTokContentAnalyticsCredentials) {
    this.credentials = credentials;
  }

  /**
   * Get comprehensive analytics for a specific video
   */
  async getVideoAnalytics(
    videoId: string,
    options: {
      includeDemographics?: boolean;
      includeTraffic?: boolean;
      includePerformance?: boolean;
    } = {}
  ): Promise<TikTokVideoAnalytics> {
    const apiCall = async (): Promise<TikTokVideoAnalytics> => {
      const params = {
        video_id: videoId,
        fields: [
          "video_id",
          "title",
          "published_at",
          "duration",
          "metrics",
          ...(options.includeDemographics ? ["audience"] : []),
          ...(options.includeTraffic ? ["traffic"] : []),
          ...(options.includePerformance ? ["performance"] : []),
        ].join(","),
      };

      const response = await axios.get(`${TIKTOK_ANALYTICS_BASE_URL}/videos/${videoId}/analytics`, {
        params,
        headers: {
          Authorization: `Bearer ${this.credentials.analyticsApiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (response.data.error) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok Analytics API error: ${response.data.error.code} - ${response.data.error.message}`
        );
      }

      const data = response.data.data;

      return {
        videoId: data.video_id,
        title: data.title,
        publishedAt: data.published_at,
        duration: data.duration,
        metrics: {
          views: data.metrics?.views || 0,
          uniqueViews: data.metrics?.unique_views || 0,
          likes: data.metrics?.likes || 0,
          shares: data.metrics?.shares || 0,
          comments: data.metrics?.comments || 0,
          saves: data.metrics?.saves || 0,
          profileVisits: data.metrics?.profile_visits || 0,
          follows: data.metrics?.follows || 0,
          engagementRate: data.metrics?.engagement_rate || 0,
          completionRate: data.metrics?.completion_rate || 0,
          dropOffPoints: data.metrics?.drop_off_points || [],
          replayRate: data.metrics?.replay_rate || 0,
          forwardJumps: data.metrics?.forward_jumps || 0,
          backwardJumps: data.metrics?.backward_jumps || 0,
        },
        audience: {
          demographics: {
            age: data.audience?.demographics?.age || {},
            gender: data.audience?.demographics?.gender || {},
            location: data.audience?.demographics?.location || {},
          },
          behavior: {
            deviceType: data.audience?.behavior?.device_type || {},
            watchTime: data.audience?.behavior?.watch_time || {},
            engagementTime: data.audience?.behavior?.engagement_time || {},
          },
          interests: data.audience?.interests || [],
        },
        traffic: {
          sources: data.traffic?.sources || {},
          hashtags: data.traffic?.hashtags || [],
          sounds: data.traffic?.sounds || [],
        },
        performance: {
          viralityScore: data.performance?.virality_score || 0,
          trendingPotential: data.performance?.trending_potential || 0,
          algorithmScore: data.performance?.algorithm_score || 0,
          qualityScore: data.performance?.quality_score || 0,
          contentScore: data.performance?.content_score || 0,
        },
      };
    };

    return circuitBreaker.call("tiktok-analytics-api", "get-video-analytics", apiCall, [], {
      timeout: 25000,
      errorThresholdPercentage: 70,
      resetTimeout: 120000,
      maxRetries: 2,
      baseDelay: 3000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 1800000, // 30 minutes cache for video analytics
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.ANALYTICS_FALLBACK,
    });
  }

  /**
   * Get comprehensive profile analytics
   */
  async getProfileAnalytics(options: {
    startDate: string;
    endDate: string;
    includeAudience?: boolean;
    includeTrends?: boolean;
  }): Promise<TikTokProfileAnalytics> {
    const apiCall = async (): Promise<TikTokProfileAnalytics> => {
      const params = {
        start_date: options.startDate,
        end_date: options.endDate,
        fields: [
          "profile_id",
          "username",
          "display_name",
          "metrics",
          ...(options.includeAudience ? ["audience"] : []),
          ...(options.includeTrends ? ["trends"] : []),
        ].join(","),
      };

      const response = await axios.get(`${TIKTOK_ANALYTICS_BASE_URL}/profile/analytics`, {
        params,
        headers: {
          Authorization: `Bearer ${this.credentials.analyticsApiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (response.data.error) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok Analytics API error: ${response.data.error.code} - ${response.data.error.message}`
        );
      }

      const data = response.data.data;

      return {
        profileId: data.profile_id,
        username: data.username,
        displayName: data.display_name,
        period: { startDate: options.startDate, endDate: options.endDate },
        metrics: {
          followers: {
            total: data.metrics?.followers?.total || 0,
            gained: data.metrics?.followers?.gained || 0,
            lost: data.metrics?.followers?.lost || 0,
            netGrowth: data.metrics?.followers?.net_growth || 0,
            growthRate: data.metrics?.followers?.growth_rate || 0,
          },
          engagement: {
            totalLikes: data.metrics?.engagement?.total_likes || 0,
            totalShares: data.metrics?.engagement?.total_shares || 0,
            totalComments: data.metrics?.engagement?.total_comments || 0,
            averageEngagementRate: data.metrics?.engagement?.average_engagement_rate || 0,
            engagementGrowth: data.metrics?.engagement?.engagement_growth || 0,
          },
          content: {
            videosPosted: data.metrics?.content?.videos_posted || 0,
            totalViews: data.metrics?.content?.total_views || 0,
            averageViews: data.metrics?.content?.average_views || 0,
            bestPerformingVideoId: data.metrics?.content?.best_performing_video_id || "",
            worstPerformingVideoId: data.metrics?.content?.worst_performing_video_id || "",
          },
          reach: {
            impressions: data.metrics?.reach?.impressions || 0,
            reach: data.metrics?.reach?.reach || 0,
            profileViews: data.metrics?.reach?.profile_views || 0,
            uniqueProfileViews: data.metrics?.reach?.unique_profile_views || 0,
          },
        },
        audience: {
          demographics: {
            age: data.audience?.demographics?.age || {},
            gender: data.audience?.demographics?.gender || {},
            topCountries: data.audience?.demographics?.top_countries || [],
            topCities: data.audience?.demographics?.top_cities || [],
          },
          activity: {
            activeHours: data.audience?.activity?.active_hours || {},
            activeDays: data.audience?.activity?.active_days || {},
            peakActivityTime: data.audience?.activity?.peak_activity_time || "",
          },
          interests: data.audience?.interests || [],
          followingBehavior: {
            averageFollowing: data.audience?.following_behavior?.average_following || 0,
            engagementFrequency: data.audience?.following_behavior?.engagement_frequency || 0,
            contentConsumption: data.audience?.following_behavior?.content_consumption || {},
          },
        },
        trends: {
          popularHashtags: data.trends?.popular_hashtags || [],
          popularSounds: data.trends?.popular_sounds || [],
          contentCategories: data.trends?.content_categories || {},
          bestPostingTimes: data.trends?.best_posting_times || [],
        },
      };
    };

    return circuitBreaker.call("tiktok-analytics-api", "get-profile-analytics", apiCall, [], {
      timeout: 30000,
      errorThresholdPercentage: 70,
      resetTimeout: 120000,
      maxRetries: 2,
      baseDelay: 3000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 3600000, // 1 hour cache for profile analytics
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.ANALYTICS_FALLBACK,
    });
  }

  /**
   * Analyze competitors and their strategies
   */
  async getCompetitorAnalysis(
    competitorUsernames: string[],
    options: {
      period?: string;
      includeStrategy?: boolean;
    } = {}
  ): Promise<TikTokCompetitorAnalysis[]> {
    const apiCall = async (): Promise<TikTokCompetitorAnalysis[]> => {
      const params = {
        usernames: competitorUsernames.join(","),
        period: options.period || "30d",
        fields: [
          "competitor_id",
          "username",
          "metrics",
          "content",
          ...(options.includeStrategy ? ["strategy"] : []),
        ].join(","),
      };

      const response = await axios.post(
        `${TIKTOK_ANALYTICS_BASE_URL}/competitors/analysis`,
        params,
        {
          headers: {
            Authorization: `Bearer ${this.credentials.analyticsApiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.data.error) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok Analytics API error: ${response.data.error.code} - ${response.data.error.message}`
        );
      }

      return response.data.data.map((competitor: any) => ({
        competitorId: competitor.competitor_id,
        username: competitor.username,
        metrics: {
          followers: competitor.metrics?.followers || 0,
          averageViews: competitor.metrics?.average_views || 0,
          averageLikes: competitor.metrics?.average_likes || 0,
          averageShares: competitor.metrics?.average_shares || 0,
          averageComments: competitor.metrics?.average_comments || 0,
          engagementRate: competitor.metrics?.engagement_rate || 0,
          postingFrequency: competitor.metrics?.posting_frequency || 0,
        },
        content: {
          topPerformingVideos: competitor.content?.top_performing_videos || [],
          contentCategories: competitor.content?.content_categories || {},
          averageVideoDuration: competitor.content?.average_video_duration || 0,
          commonHashtags: competitor.content?.common_hashtags || [],
          commonSounds: competitor.content?.common_sounds || [],
        },
        strategy: {
          postingPattern: {
            frequency: competitor.strategy?.posting_pattern?.frequency || "unknown",
            bestTimes: competitor.strategy?.posting_pattern?.best_times || [],
            consistency: competitor.strategy?.posting_pattern?.consistency || 0,
          },
          engagement: {
            responseRate: competitor.strategy?.engagement?.response_rate || 0,
            responseTime: competitor.strategy?.engagement?.response_time || 0,
            communityEngagement: competitor.strategy?.engagement?.community_engagement || 0,
          },
          growth: {
            followerGrowthRate: competitor.strategy?.growth?.follower_growth_rate || 0,
            contentGrowthRate: competitor.strategy?.growth?.content_growth_rate || 0,
            trendAdoption: competitor.strategy?.growth?.trend_adoption || 0,
          },
        },
      }));
    };

    return circuitBreaker.call("tiktok-analytics-api", "get-competitor-analysis", apiCall, [], {
      timeout: 35000,
      errorThresholdPercentage: 75,
      resetTimeout: 150000,
      maxRetries: 2,
      baseDelay: 5000,
      maxDelay: 45000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 7200000, // 2 hours cache for competitor analysis
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.ANALYTICS_FALLBACK,
    });
  }

  /**
   * Get detailed hashtag analytics and insights
   */
  async getHashtagAnalytics(
    hashtags: string[],
    options: {
      period?: string;
      includeInsights?: boolean;
    } = {}
  ): Promise<TikTokHashtagAnalytics[]> {
    const apiCall = async (): Promise<TikTokHashtagAnalytics[]> => {
      const params = {
        hashtags: hashtags.join(","),
        period: options.period || "30d",
        fields: [
          "hashtag",
          "metrics",
          "performance",
          "usage",
          ...(options.includeInsights ? ["insights"] : []),
        ].join(","),
      };

      const response = await axios.post(`${TIKTOK_ANALYTICS_BASE_URL}/hashtags/analytics`, params, {
        headers: {
          Authorization: `Bearer ${this.credentials.analyticsApiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (response.data.error) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok Analytics API error: ${response.data.error.code} - ${response.data.error.message}`
        );
      }

      return response.data.data.map((hashtag: any) => ({
        hashtag: hashtag.hashtag,
        metrics: {
          totalPosts: hashtag.metrics?.total_posts || 0,
          totalViews: hashtag.metrics?.total_views || 0,
          averageViews: hashtag.metrics?.average_views || 0,
          engagementRate: hashtag.metrics?.engagement_rate || 0,
          growth: hashtag.metrics?.growth || 0,
          difficulty: hashtag.metrics?.difficulty || 0,
          trendingScore: hashtag.metrics?.trending_score || 0,
        },
        performance: {
          topVideos: hashtag.performance?.top_videos || [],
          averagePerformance: {
            views: hashtag.performance?.average_performance?.views || 0,
            likes: hashtag.performance?.average_performance?.likes || 0,
            shares: hashtag.performance?.average_performance?.shares || 0,
            comments: hashtag.performance?.average_performance?.comments || 0,
          },
        },
        usage: {
          topCreators: hashtag.usage?.top_creators || [],
          relatedHashtags: hashtag.usage?.related_hashtags || [],
          seasonality: hashtag.usage?.seasonality || {},
          demographics: {
            age: hashtag.usage?.demographics?.age || {},
            gender: hashtag.usage?.demographics?.gender || {},
            location: hashtag.usage?.demographics?.location || {},
          },
        },
        insights: {
          bestPractices: hashtag.insights?.best_practices || [],
          optimalTiming: hashtag.insights?.optimal_timing || [],
          contentRecommendations: hashtag.insights?.content_recommendations || [],
          riskFactors: hashtag.insights?.risk_factors || [],
        },
      }));
    };

    return circuitBreaker.call("tiktok-analytics-api", "get-hashtag-analytics", apiCall, [], {
      timeout: 30000,
      errorThresholdPercentage: 70,
      resetTimeout: 120000,
      maxRetries: 2,
      baseDelay: 3000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 3600000, // 1 hour cache for hashtag analytics
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.ANALYTICS_FALLBACK,
    });
  }

  /**
   * Get circuit breaker status for TikTok Analytics API operations
   */
  getCircuitBreakerStatus(): Record<string, any> {
    return circuitBreaker.getAllStatuses();
  }

  /**
   * Get API metrics registry for monitoring
   */
  static getMetricsRegistry(): client.Registry {
    return registry;
  }

  /**
   * Clear API cache
   */
  clearCache(): void {
    circuitBreaker.clearCache("tiktok-analytics-api");
  }
}
