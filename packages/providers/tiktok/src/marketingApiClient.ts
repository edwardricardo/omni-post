import { createExternalApiCircuitBreaker } from "@adapters/external-apis";
import { CommonFallbackStrategies } from "@adapters/fallback-strategies";
import { ProviderError } from "@providers/shared";
import * as client from "prom-client";
import axios from "axios";
import type { TikTokCredentials } from "./tiktokTypes.js";

export interface TikTokMarketingCredentials extends TikTokCredentials {
  advertiserAccountId: string;
}

export interface TikTokAdAccount {
  advertiserId: string;
  advertiserName: string;
  status: string;
  balance: number;
  currency: string;
  timezone: string;
  industry: string;
  language: string;
  createdTime: string;
}

export interface TikTokCampaign {
  campaignId: string;
  campaignName: string;
  objective: string;
  budget: number;
  status: string;
  startTime: string;
  endTime?: string;
  createdTime: string;
  modifiedTime: string;
}

export interface TikTokAdInsights {
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  conversionRate: number;
  cpc: number;
  cpm: number;
  ctr: number;
  reach: number;
  frequency: number;
  videoViews: number;
  videoViewRate: number;
  videoWatchTime: number;
  profileVisits: number;
  follows: number;
  likes: number;
  shares: number;
  comments: number;
}

export interface TikTokAudienceInsight {
  gender: { male: number; female: number; unknown: number };
  age: Record<string, number>;
  location: Array<{ country: string; percentage: number }>;
  interests: Array<{ category: string; affinity: number }>;
  devices: Array<{ deviceType: string; percentage: number }>;
  platforms: Array<{ platform: string; percentage: number }>;
}

export interface TikTokCreativeInsight {
  creativeId: string;
  creativeName: string;
  format: string;
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number;
  engagementRate: number;
  videoCompletionRate: number;
  thumbnailUrl?: string;
  videoUrl?: string;
}

// Global registry for circuit breaker metrics
const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);

const TIKTOK_MARKETING_BASE_URL = "https://business-api.tiktok.com/open_api/v1.3";

export class TikTokMarketingApiClient {
  private credentials: TikTokMarketingCredentials;

  constructor(credentials: TikTokMarketingCredentials) {
    this.credentials = credentials;
  }

  /**
   * Get advertiser account information
   */
  async getAdAccount(): Promise<TikTokAdAccount> {
    const apiCall = async (): Promise<TikTokAdAccount> => {
      const response = await axios.get(`${TIKTOK_MARKETING_BASE_URL}/advertiser/info/`, {
        params: {
          advertiser_ids: JSON.stringify([this.credentials.advertiserAccountId]),
          fields: JSON.stringify([
            "advertiser_id",
            "advertiser_name",
            "status",
            "balance",
            "currency",
            "timezone",
            "industry",
            "language",
            "create_time",
          ]),
        },
        headers: {
          "Access-Token": this.credentials.accessToken,
          "Content-Type": "application/json",
        },
      });

      if (response.data.code !== 0) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok Marketing API error: ${response.data.code} - ${response.data.message}`
        );
      }

      const advertiser = response.data.data.list[0];
      return {
        advertiserId: advertiser.advertiser_id,
        advertiserName: advertiser.advertiser_name,
        status: advertiser.status,
        balance: advertiser.balance || 0,
        currency: advertiser.currency || "USD",
        timezone: advertiser.timezone,
        industry: advertiser.industry,
        language: advertiser.language,
        createdTime: advertiser.create_time,
      };
    };

    return circuitBreaker.call("tiktok-marketing-api", "get-ad-account", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 300000, // 5 minutes cache
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.METADATA_FALLBACK,
    });
  }

  /**
   * Get campaigns for the advertiser
   */
  async getCampaigns(filtering?: {
    status?: string;
    objective?: string;
  }): Promise<TikTokCampaign[]> {
    const apiCall = async (): Promise<TikTokCampaign[]> => {
      const params: any = {
        advertiser_id: this.credentials.advertiserAccountId,
        fields: JSON.stringify([
          "campaign_id",
          "campaign_name",
          "objective_type",
          "budget",
          "status",
          "operation_status",
          "start_time",
          "end_time",
          "create_time",
          "modify_time",
        ]),
        page_size: 100,
      };

      if (filtering?.status) {
        params.primary_status = filtering.status;
      }

      if (filtering?.objective) {
        params.objective_type = filtering.objective;
      }

      const response = await axios.get(`${TIKTOK_MARKETING_BASE_URL}/campaign/get/`, {
        params,
        headers: {
          "Access-Token": this.credentials.accessToken,
          "Content-Type": "application/json",
        },
      });

      if (response.data.code !== 0) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok Marketing API error: ${response.data.code} - ${response.data.message}`
        );
      }

      return response.data.data.list.map((campaign: any) => ({
        campaignId: campaign.campaign_id,
        campaignName: campaign.campaign_name,
        objective: campaign.objective_type,
        budget: campaign.budget || 0,
        status: campaign.status,
        startTime: campaign.start_time,
        endTime: campaign.end_time,
        createdTime: campaign.create_time,
        modifiedTime: campaign.modify_time,
      }));
    };

    return circuitBreaker.call("tiktok-marketing-api", "get-campaigns", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 300000, // 5 minutes cache
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.ANALYTICS_FALLBACK,
    });
  }

  /**
   * Get advertising insights and performance metrics
   */
  async getAdInsights(options: {
    startDate: string;
    endDate: string;
    campaignIds?: string[];
    groupBy?: string[];
    metrics?: string[];
  }): Promise<TikTokAdInsights[]> {
    const apiCall = async (): Promise<TikTokAdInsights[]> => {
      const defaultMetrics = [
        "impressions",
        "clicks",
        "spend",
        "conversions",
        "conversion_rate",
        "cpc",
        "cpm",
        "ctr",
        "reach",
        "frequency",
        "video_play_actions",
        "video_views_p25",
        "video_views_p50",
        "video_views_p75",
        "video_views_p100",
        "video_watched_2s",
        "video_watched_6s",
        "profile_visits",
        "follows",
        "likes",
        "shares",
        "comments",
      ];

      const params: any = {
        advertiser_id: this.credentials.advertiserAccountId,
        start_date: options.startDate,
        end_date: options.endDate,
        dimensions: JSON.stringify(options.groupBy || ["campaign_id"]),
        metrics: JSON.stringify(options.metrics || defaultMetrics),
        page_size: 1000,
      };

      if (options.campaignIds?.length) {
        params.filters = JSON.stringify([
          {
            field_name: "campaign_ids",
            filter_type: "IN",
            filter_value: options.campaignIds,
          },
        ]);
      }

      const response = await axios.get(`${TIKTOK_MARKETING_BASE_URL}/report/integrated/get/`, {
        params,
        headers: {
          "Access-Token": this.credentials.accessToken,
          "Content-Type": "application/json",
        },
      });

      if (response.data.code !== 0) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok Marketing API error: ${response.data.code} - ${response.data.message}`
        );
      }

      return response.data.data.list.map((insight: any) => {
        const metrics = insight.metrics;
        return {
          impressions: parseInt(metrics.impressions) || 0,
          clicks: parseInt(metrics.clicks) || 0,
          spend: parseFloat(metrics.spend) || 0,
          conversions: parseInt(metrics.conversions) || 0,
          conversionRate: parseFloat(metrics.conversion_rate) || 0,
          cpc: parseFloat(metrics.cpc) || 0,
          cpm: parseFloat(metrics.cpm) || 0,
          ctr: parseFloat(metrics.ctr) || 0,
          reach: parseInt(metrics.reach) || 0,
          frequency: parseFloat(metrics.frequency) || 0,
          videoViews: parseInt(metrics.video_play_actions) || 0,
          videoViewRate: parseFloat(metrics.video_views_p100) || 0,
          videoWatchTime: parseInt(metrics.video_watched_6s) || 0,
          profileVisits: parseInt(metrics.profile_visits) || 0,
          follows: parseInt(metrics.follows) || 0,
          likes: parseInt(metrics.likes) || 0,
          shares: parseInt(metrics.shares) || 0,
          comments: parseInt(metrics.comments) || 0,
        };
      });
    };

    return circuitBreaker.call("tiktok-marketing-api", "get-ad-insights", apiCall, [], {
      timeout: 30000,
      errorThresholdPercentage: 70,
      resetTimeout: 120000,
      maxRetries: 2,
      baseDelay: 3000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 600000, // 10 minutes cache for insights
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.ANALYTICS_FALLBACK,
    });
  }

  /**
   * Get audience insights for targeting optimization
   */
  async getAudienceInsights(options: {
    startDate: string;
    endDate: string;
    campaignIds?: string[];
  }): Promise<TikTokAudienceInsight> {
    const apiCall = async (): Promise<TikTokAudienceInsight> => {
      const params: any = {
        advertiser_id: this.credentials.advertiserAccountId,
        start_date: options.startDate,
        end_date: options.endDate,
        dimensions: JSON.stringify([
          "gender",
          "age",
          "location",
          "interest_category",
          "ac_subtype",
        ]),
        metrics: JSON.stringify(["impressions", "clicks", "spend"]),
        page_size: 1000,
      };

      if (options.campaignIds?.length) {
        params.filters = JSON.stringify([
          {
            field_name: "campaign_ids",
            filter_type: "IN",
            filter_value: options.campaignIds,
          },
        ]);
      }

      const response = await axios.get(`${TIKTOK_MARKETING_BASE_URL}/report/audience/get/`, {
        params,
        headers: {
          "Access-Token": this.credentials.accessToken,
          "Content-Type": "application/json",
        },
      });

      if (response.data.code !== 0) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok Marketing API error: ${response.data.code} - ${response.data.message}`
        );
      }

      // Process audience data into structured format
      const insights = response.data.data.list;

      // Initialize audience insight structure
      const audienceInsight: TikTokAudienceInsight = {
        gender: { male: 0, female: 0, unknown: 0 },
        age: {},
        location: [],
        interests: [],
        devices: [],
        platforms: [],
      };

      // Process insights data
      insights.forEach((insight: any) => {
        const dimension = insight.dimensions;
        const metrics = insight.metrics;
        const impressions = parseInt(metrics.impressions) || 0;

        if (dimension.gender) {
          audienceInsight.gender[dimension.gender as keyof typeof audienceInsight.gender] =
            impressions;
        }

        if (dimension.age) {
          audienceInsight.age[dimension.age] = impressions;
        }

        if (dimension.location && dimension.location.country) {
          audienceInsight.location.push({
            country: dimension.location.country,
            percentage: impressions,
          });
        }

        if (dimension.interest_category) {
          audienceInsight.interests.push({
            category: dimension.interest_category,
            affinity: impressions,
          });
        }

        if (dimension.ac_subtype) {
          audienceInsight.devices.push({
            deviceType: dimension.ac_subtype,
            percentage: impressions,
          });
        }
      });

      return audienceInsight;
    };

    return circuitBreaker.call("tiktok-marketing-api", "get-audience-insights", apiCall, [], {
      timeout: 30000,
      errorThresholdPercentage: 70,
      resetTimeout: 120000,
      maxRetries: 2,
      baseDelay: 3000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 1800000, // 30 minutes cache for audience insights
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.ANALYTICS_FALLBACK,
    });
  }

  /**
   * Get creative performance insights
   */
  async getCreativeInsights(options: {
    startDate: string;
    endDate: string;
    campaignIds?: string[];
  }): Promise<TikTokCreativeInsight[]> {
    const apiCall = async (): Promise<TikTokCreativeInsight[]> => {
      const params: any = {
        advertiser_id: this.credentials.advertiserAccountId,
        start_date: options.startDate,
        end_date: options.endDate,
        dimensions: JSON.stringify(["ad_id"]),
        metrics: JSON.stringify([
          "impressions",
          "clicks",
          "spend",
          "ctr",
          "engagement_rate",
          "video_views_p100",
        ]),
        page_size: 1000,
      };

      if (options.campaignIds?.length) {
        params.filters = JSON.stringify([
          {
            field_name: "campaign_ids",
            filter_type: "IN",
            filter_value: options.campaignIds,
          },
        ]);
      }

      const response = await axios.get(`${TIKTOK_MARKETING_BASE_URL}/report/integrated/get/`, {
        params,
        headers: {
          "Access-Token": this.credentials.accessToken,
          "Content-Type": "application/json",
        },
      });

      if (response.data.code !== 0) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok Marketing API error: ${response.data.code} - ${response.data.message}`
        );
      }

      return response.data.data.list.map((creative: any) => {
        const metrics = creative.metrics;
        const dimensions = creative.dimensions;

        return {
          creativeId: dimensions.ad_id,
          creativeName: dimensions.ad_name || `Creative ${dimensions.ad_id}`,
          format: dimensions.ad_format || "video",
          impressions: parseInt(metrics.impressions) || 0,
          clicks: parseInt(metrics.clicks) || 0,
          spend: parseFloat(metrics.spend) || 0,
          ctr: parseFloat(metrics.ctr) || 0,
          engagementRate: parseFloat(metrics.engagement_rate) || 0,
          videoCompletionRate: parseFloat(metrics.video_views_p100) || 0,
          thumbnailUrl: dimensions.thumbnail_url,
          videoUrl: dimensions.video_url,
        };
      });
    };

    return circuitBreaker.call("tiktok-marketing-api", "get-creative-insights", apiCall, [], {
      timeout: 30000,
      errorThresholdPercentage: 70,
      resetTimeout: 120000,
      maxRetries: 2,
      baseDelay: 3000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 900000, // 15 minutes cache for creative insights
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.ANALYTICS_FALLBACK,
    });
  }

  /**
   * Get circuit breaker status for TikTok Marketing API operations
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
    circuitBreaker.clearCache("tiktok-marketing-api");
  }
}
