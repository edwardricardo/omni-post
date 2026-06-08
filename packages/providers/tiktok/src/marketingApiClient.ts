/**
 * @file marketingApiClient.ts
 * @description TikTok Marketing API client for ad account management, campaign reporting,
 *              and promoted content analytics with circuit breaker protection.
 * @layer infrastructure
 */
import {
  createExternalApiCircuitBreaker,
  ANALYTICS_CB_OPTIONS,
  METADATA_CB_OPTIONS,
} from "@adapters/external-apis";
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

/**
 * Dimensions returned by TikTok reporting APIs. Most fields are plain strings,
 * but `location` is returned as an object `{ country?: string }` from the
 * audience insights endpoint (other endpoints may omit it entirely).
 */
interface TikTokDimensions {
  gender?: string;
  age?: string;
  location?: string | { country?: string };
  interest_category?: string;
  ac_subtype?: string;
  ad_id?: string;
  ad_name?: string;
  ad_format?: string;
  thumbnail_url?: string;
  video_url?: string;
}

/** Raw response item from TikTok reporting APIs with metrics. */
interface TikTokReportItem {
  metrics: Record<string, string>;
  dimensions: TikTokDimensions;
}

/** Raw campaign item from TikTok campaign list API. */
interface TikTokRawCampaign {
  campaign_id: string;
  campaign_name: string;
  objective_type: string;
  budget?: number;
  status: string;
  start_time: string;
  end_time?: string;
  create_time: string;
  modify_time: string;
}

/** Safely parse an integer from a metrics record, defaulting to 0. */
function safeParseInt(metrics: Record<string, string>, key: string): number {
  return parseInt(metrics[key] ?? "0") || 0;
}

/** Safely parse a float from a metrics record, defaulting to 0. */
function safeParseFloat(metrics: Record<string, string>, key: string): number {
  return parseFloat(metrics[key] ?? "0") || 0;
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
      ...METADATA_CB_OPTIONS,
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
      const params: Record<string, string | number> = {
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

      return response.data.data.list.map((campaign: TikTokRawCampaign) => ({
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
      ...ANALYTICS_CB_OPTIONS,
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

      const params: Record<string, string | number> = {
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

      return response.data.data.list.map((insight: TikTokReportItem) => {
        const m = insight.metrics;
        return {
          impressions: safeParseInt(m, "impressions"),
          clicks: safeParseInt(m, "clicks"),
          spend: safeParseFloat(m, "spend"),
          conversions: safeParseInt(m, "conversions"),
          conversionRate: safeParseFloat(m, "conversion_rate"),
          cpc: safeParseFloat(m, "cpc"),
          cpm: safeParseFloat(m, "cpm"),
          ctr: safeParseFloat(m, "ctr"),
          reach: safeParseInt(m, "reach"),
          frequency: safeParseFloat(m, "frequency"),
          videoViews: safeParseInt(m, "video_play_actions"),
          videoViewRate: safeParseFloat(m, "video_views_p100"),
          videoWatchTime: safeParseInt(m, "video_watched_6s"),
          profileVisits: safeParseInt(m, "profile_visits"),
          follows: safeParseInt(m, "follows"),
          likes: safeParseInt(m, "likes"),
          shares: safeParseInt(m, "shares"),
          comments: safeParseInt(m, "comments"),
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
      ...ANALYTICS_CB_OPTIONS,
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
      const params: Record<string, string | number> = {
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
      insights.forEach((insight: TikTokReportItem) => {
        const dimension = insight.dimensions;
        const impressions = safeParseInt(insight.metrics, "impressions");

        const genderValue = dimension.gender;
        if (genderValue) {
          audienceInsight.gender[genderValue as keyof typeof audienceInsight.gender] = impressions;
        }

        const ageValue = dimension.age;
        if (ageValue) {
          audienceInsight.age[ageValue] = impressions;
        }

        const locationValue = dimension.location;
        const country = typeof locationValue === "string" ? locationValue : locationValue?.country;
        if (country) {
          audienceInsight.location.push({
            country,
            percentage: impressions,
          });
        }

        const interestCategory = dimension.interest_category;
        if (interestCategory) {
          audienceInsight.interests.push({
            category: interestCategory,
            affinity: impressions,
          });
        }

        const acSubtype = dimension.ac_subtype;
        if (acSubtype) {
          audienceInsight.devices.push({
            deviceType: acSubtype,
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
      ...ANALYTICS_CB_OPTIONS,
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
      const params: Record<string, string | number> = {
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

      return response.data.data.list.map((creative: TikTokReportItem) => {
        const m = creative.metrics;
        const d = creative.dimensions;
        const adId = d.ad_id ?? "";

        return {
          creativeId: adId,
          creativeName: d.ad_name || `Creative ${adId}`,
          format: d.ad_format || "video",
          impressions: safeParseInt(m, "impressions"),
          clicks: safeParseInt(m, "clicks"),
          spend: safeParseFloat(m, "spend"),
          ctr: safeParseFloat(m, "ctr"),
          engagementRate: safeParseFloat(m, "engagement_rate"),
          videoCompletionRate: safeParseFloat(m, "video_views_p100"),
          thumbnailUrl: d.thumbnail_url,
          videoUrl: d.video_url,
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
      ...ANALYTICS_CB_OPTIONS,
    });
  }

  /**
   * Get circuit breaker status for TikTok Marketing API operations
   */
  getCircuitBreakerStatus(): Record<string, unknown> {
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
