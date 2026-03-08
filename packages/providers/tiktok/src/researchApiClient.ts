import { createExternalApiCircuitBreaker } from "@adapters/external-apis";
import { CommonFallbackStrategies } from "@adapters/fallback-strategies";
import { ProviderError } from "@providers/shared";
import * as client from "prom-client";
import axios from "axios";
import type { TikTokCredentials } from "./tiktokTypes.js";

export interface TikTokResearchCredentials extends TikTokCredentials {
  researchApiKey: string;
}

export interface TikTokTrendingHashtag {
  hashtag: string;
  volume: number;
  growth: number;
  difficulty: number;
  engagement: number;
  category: string;
  relatedHashtags: string[];
  trendingScore: number;
}

export interface TikTokTrendingVideo {
  videoId: string;
  authorId: string;
  authorName: string;
  description: string;
  hashtags: string[];
  musicId?: string;
  musicTitle?: string;
  duration: number;
  viewCount: number;
  likeCount: number;
  shareCount: number;
  commentCount: number;
  createTime: string;
  viralScore: number;
  trendingReason: string[];
}

export interface TikTokTrendingSound {
  soundId: string;
  title: string;
  author: string;
  duration: number;
  usageCount: number;
  growth: number;
  category: string;
  mood: string;
  tempo: string;
  isOriginal: boolean;
  isCopyrightFree: boolean;
  previewUrl?: string;
}

export interface TikTokKeywordTrend {
  keyword: string;
  volume: number;
  competition: number;
  trend: "rising" | "stable" | "declining";
  relatedKeywords: string[];
  categoryScores: Record<string, number>;
  demographicBreakdown: {
    age: Record<string, number>;
    gender: Record<string, number>;
    location: Record<string, number>;
  };
}

export interface TikTokContentGap {
  topic: string;
  opportunity: number;
  difficulty: number;
  suggestedHashtags: string[];
  suggestedFormats: string[];
  targetAudience: string[];
  competitorAnalysis: {
    topCreators: string[];
    averageEngagement: number;
    contentFrequency: number;
  };
}

export interface TikTokViralContent {
  contentId: string;
  type: "video" | "sound" | "hashtag" | "effect";
  title: string;
  description?: string;
  creator?: string;
  viralMetrics: {
    viralCoefficient: number;
    growthRate: number;
    peakEngagement: number;
    sustainabilityScore: number;
  };
  characteristics: {
    hooks: string[];
    format: string;
    duration?: number;
    musicGenre?: string;
    visualStyle: string[];
  };
  replicationGuide: {
    keyElements: string[];
    timing: string;
    hashtags: string[];
    suggestedVariations: string[];
  };
}

// Global registry for circuit breaker metrics
const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);

const TIKTOK_RESEARCH_BASE_URL = "https://research-api.tiktok.com/v1";

export class TikTokResearchApiClient {
  private credentials: TikTokResearchCredentials;

  constructor(credentials: TikTokResearchCredentials) {
    this.credentials = credentials;
  }

  /**
   * Get trending hashtags with detailed metrics
   */
  async getTrendingHashtags(
    options: {
      region?: string;
      category?: string;
      timeframe?: "1d" | "7d" | "30d";
      limit?: number;
    } = {}
  ): Promise<TikTokTrendingHashtag[]> {
    const apiCall = async (): Promise<TikTokTrendingHashtag[]> => {
      const params = {
        region: options.region || "US",
        category: options.category || "all",
        timeframe: options.timeframe || "7d",
        limit: options.limit || 50,
        fields:
          "hashtag,volume,growth,difficulty,engagement,category,related_hashtags,trending_score",
      };

      const response = await axios.get(`${TIKTOK_RESEARCH_BASE_URL}/hashtags/trending`, {
        params,
        headers: {
          Authorization: `Bearer ${this.credentials.researchApiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (response.data.error) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok Research API error: ${response.data.error.code} - ${response.data.error.message}`
        );
      }

      return response.data.data.map((hashtag: any) => ({
        hashtag: hashtag.hashtag,
        volume: hashtag.volume || 0,
        growth: hashtag.growth || 0,
        difficulty: hashtag.difficulty || 0,
        engagement: hashtag.engagement || 0,
        category: hashtag.category || "general",
        relatedHashtags: hashtag.related_hashtags || [],
        trendingScore: hashtag.trending_score || 0,
      }));
    };

    return circuitBreaker.call("tiktok-research-api", "get-trending-hashtags", apiCall, [], {
      timeout: 20000,
      errorThresholdPercentage: 60,
      resetTimeout: 90000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 1800000, // 30 minutes cache for trending data
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.ANALYTICS_FALLBACK,
    });
  }

  /**
   * Get trending videos with viral analysis
   */
  async getTrendingVideos(
    options: {
      region?: string;
      category?: string;
      timeframe?: "1d" | "7d" | "30d";
      minViews?: number;
      limit?: number;
    } = {}
  ): Promise<TikTokTrendingVideo[]> {
    const apiCall = async (): Promise<TikTokTrendingVideo[]> => {
      const params = {
        region: options.region || "US",
        category: options.category || "all",
        timeframe: options.timeframe || "7d",
        min_views: options.minViews || 100000,
        limit: options.limit || 100,
        fields:
          "video_id,author_id,author_name,description,hashtags,music_id,music_title,duration,view_count,like_count,share_count,comment_count,create_time,viral_score,trending_reason",
      };

      const response = await axios.get(`${TIKTOK_RESEARCH_BASE_URL}/videos/trending`, {
        params,
        headers: {
          Authorization: `Bearer ${this.credentials.researchApiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (response.data.error) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok Research API error: ${response.data.error.code} - ${response.data.error.message}`
        );
      }

      return response.data.data.map((video: any) => ({
        videoId: video.video_id,
        authorId: video.author_id,
        authorName: video.author_name,
        description: video.description,
        hashtags: video.hashtags || [],
        musicId: video.music_id,
        musicTitle: video.music_title,
        duration: video.duration || 0,
        viewCount: video.view_count || 0,
        likeCount: video.like_count || 0,
        shareCount: video.share_count || 0,
        commentCount: video.comment_count || 0,
        createTime: video.create_time,
        viralScore: video.viral_score || 0,
        trendingReason: video.trending_reason || [],
      }));
    };

    return circuitBreaker.call("tiktok-research-api", "get-trending-videos", apiCall, [], {
      timeout: 30000,
      errorThresholdPercentage: 70,
      resetTimeout: 120000,
      maxRetries: 2,
      baseDelay: 3000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 900000, // 15 minutes cache for video trends
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.ANALYTICS_FALLBACK,
    });
  }

  /**
   * Get trending sounds and music
   */
  async getTrendingSounds(
    options: {
      region?: string;
      category?: string;
      mood?: string;
      tempo?: string;
      copyrightFree?: boolean;
      limit?: number;
    } = {}
  ): Promise<TikTokTrendingSound[]> {
    const apiCall = async (): Promise<TikTokTrendingSound[]> => {
      const params: any = {
        region: options.region || "US",
        category: options.category || "all",
        limit: options.limit || 50,
        fields:
          "sound_id,title,author,duration,usage_count,growth,category,mood,tempo,is_original,is_copyright_free,preview_url",
      };

      if (options.mood) params.mood = options.mood;
      if (options.tempo) params.tempo = options.tempo;
      if (options.copyrightFree !== undefined) params.copyright_free = options.copyrightFree;

      const response = await axios.get(`${TIKTOK_RESEARCH_BASE_URL}/sounds/trending`, {
        params,
        headers: {
          Authorization: `Bearer ${this.credentials.researchApiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (response.data.error) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok Research API error: ${response.data.error.code} - ${response.data.error.message}`
        );
      }

      return response.data.data.map((sound: any) => ({
        soundId: sound.sound_id,
        title: sound.title,
        author: sound.author,
        duration: sound.duration || 0,
        usageCount: sound.usage_count || 0,
        growth: sound.growth || 0,
        category: sound.category,
        mood: sound.mood,
        tempo: sound.tempo,
        isOriginal: sound.is_original || false,
        isCopyrightFree: sound.is_copyright_free || false,
        previewUrl: sound.preview_url,
      }));
    };

    return circuitBreaker.call("tiktok-research-api", "get-trending-sounds", apiCall, [], {
      timeout: 20000,
      errorThresholdPercentage: 60,
      resetTimeout: 90000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 1800000, // 30 minutes cache for sound trends
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.ANALYTICS_FALLBACK,
    });
  }

  /**
   * Analyze keyword trends and search volume
   */
  async getKeywordTrends(
    keywords: string[],
    options: {
      region?: string;
      timeframe?: "1d" | "7d" | "30d" | "90d";
    } = {}
  ): Promise<TikTokKeywordTrend[]> {
    const apiCall = async (): Promise<TikTokKeywordTrend[]> => {
      const params = {
        keywords: keywords.join(","),
        region: options.region || "US",
        timeframe: options.timeframe || "30d",
        fields:
          "keyword,volume,competition,trend,related_keywords,category_scores,demographic_breakdown",
      };

      const response = await axios.post(`${TIKTOK_RESEARCH_BASE_URL}/keywords/trends`, params, {
        headers: {
          Authorization: `Bearer ${this.credentials.researchApiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (response.data.error) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok Research API error: ${response.data.error.code} - ${response.data.error.message}`
        );
      }

      return response.data.data.map((keyword: any) => ({
        keyword: keyword.keyword,
        volume: keyword.volume || 0,
        competition: keyword.competition || 0,
        trend: keyword.trend || "stable",
        relatedKeywords: keyword.related_keywords || [],
        categoryScores: keyword.category_scores || {},
        demographicBreakdown: {
          age: keyword.demographic_breakdown?.age || {},
          gender: keyword.demographic_breakdown?.gender || {},
          location: keyword.demographic_breakdown?.location || {},
        },
      }));
    };

    return circuitBreaker.call("tiktok-research-api", "get-keyword-trends", apiCall, [], {
      timeout: 25000,
      errorThresholdPercentage: 70,
      resetTimeout: 120000,
      maxRetries: 2,
      baseDelay: 3000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 3600000, // 1 hour cache for keyword trends
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.ANALYTICS_FALLBACK,
    });
  }

  /**
   * Identify content gaps and opportunities
   */
  async getContentGaps(
    options: {
      category?: string;
      competitorIds?: string[];
      region?: string;
      audienceSize?: "small" | "medium" | "large";
    } = {}
  ): Promise<TikTokContentGap[]> {
    const apiCall = async (): Promise<TikTokContentGap[]> => {
      const params = {
        category: options.category || "all",
        competitor_ids: options.competitorIds?.join(","),
        region: options.region || "US",
        audience_size: options.audienceSize || "medium",
        fields:
          "topic,opportunity,difficulty,suggested_hashtags,suggested_formats,target_audience,competitor_analysis",
      };

      const response = await axios.post(`${TIKTOK_RESEARCH_BASE_URL}/content/gaps`, params, {
        headers: {
          Authorization: `Bearer ${this.credentials.researchApiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (response.data.error) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok Research API error: ${response.data.error.code} - ${response.data.error.message}`
        );
      }

      return response.data.data.map((gap: any) => ({
        topic: gap.topic,
        opportunity: gap.opportunity || 0,
        difficulty: gap.difficulty || 0,
        suggestedHashtags: gap.suggested_hashtags || [],
        suggestedFormats: gap.suggested_formats || [],
        targetAudience: gap.target_audience || [],
        competitorAnalysis: {
          topCreators: gap.competitor_analysis?.top_creators || [],
          averageEngagement: gap.competitor_analysis?.average_engagement || 0,
          contentFrequency: gap.competitor_analysis?.content_frequency || 0,
        },
      }));
    };

    return circuitBreaker.call("tiktok-research-api", "get-content-gaps", apiCall, [], {
      timeout: 30000,
      errorThresholdPercentage: 70,
      resetTimeout: 120000,
      maxRetries: 2,
      baseDelay: 3000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 7200000, // 2 hours cache for content gaps
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.ANALYTICS_FALLBACK,
    });
  }

  /**
   * Analyze viral content patterns and replication strategies
   */
  async getViralContentAnalysis(
    options: {
      contentIds?: string[];
      timeframe?: "7d" | "30d" | "90d";
      category?: string;
      minViralScore?: number;
    } = {}
  ): Promise<TikTokViralContent[]> {
    const apiCall = async (): Promise<TikTokViralContent[]> => {
      const params = {
        content_ids: options.contentIds?.join(","),
        timeframe: options.timeframe || "30d",
        category: options.category || "all",
        min_viral_score: options.minViralScore || 70,
        fields:
          "content_id,type,title,description,creator,viral_metrics,characteristics,replication_guide",
      };

      const response = await axios.post(
        `${TIKTOK_RESEARCH_BASE_URL}/content/viral-analysis`,
        params,
        {
          headers: {
            Authorization: `Bearer ${this.credentials.researchApiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.data.error) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok Research API error: ${response.data.error.code} - ${response.data.error.message}`
        );
      }

      return response.data.data.map((content: any) => ({
        contentId: content.content_id,
        type: content.type,
        title: content.title,
        description: content.description,
        creator: content.creator,
        viralMetrics: {
          viralCoefficient: content.viral_metrics?.viral_coefficient || 0,
          growthRate: content.viral_metrics?.growth_rate || 0,
          peakEngagement: content.viral_metrics?.peak_engagement || 0,
          sustainabilityScore: content.viral_metrics?.sustainability_score || 0,
        },
        characteristics: {
          hooks: content.characteristics?.hooks || [],
          format: content.characteristics?.format || "video",
          duration: content.characteristics?.duration,
          musicGenre: content.characteristics?.music_genre,
          visualStyle: content.characteristics?.visual_style || [],
        },
        replicationGuide: {
          keyElements: content.replication_guide?.key_elements || [],
          timing: content.replication_guide?.timing || "anytime",
          hashtags: content.replication_guide?.hashtags || [],
          suggestedVariations: content.replication_guide?.suggested_variations || [],
        },
      }));
    };

    return circuitBreaker.call("tiktok-research-api", "get-viral-content-analysis", apiCall, [], {
      timeout: 35000,
      errorThresholdPercentage: 75,
      resetTimeout: 150000,
      maxRetries: 2,
      baseDelay: 5000,
      maxDelay: 45000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 3600000, // 1 hour cache for viral analysis
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.ANALYTICS_FALLBACK,
    });
  }

  /**
   * Get circuit breaker status for TikTok Research API operations
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
    circuitBreaker.clearCache("tiktok-research-api");
  }
}
