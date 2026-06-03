/**
 * @file marketing.ts
 * @description Facebook Marketing API client -- ad accounts, campaigns, ad sets, ads,
 * insights, audience insights, delivery estimates, conversion events, recommendations,
 * attribution analytics, and business insights.
 *
 * Type definitions live in ./marketingTypes.ts; helpers in ./marketingHelpers.ts.
 * @layer infrastructure
 */
import { FacebookApiClient, FacebookCredentials } from "../apiClient.js";
import { createLogger } from "@observability/logger";
import type {
  FacebookAdAccount,
  FacebookCampaign,
  FacebookAdSet,
  FacebookAd,
  FacebookAdInsights,
  FacebookAdRecommendation,
  FacebookAudienceInsight,
  FacebookConversionEvent,
} from "./marketingTypes.js";

import {
  processTargeting,
  processInsights,
  generateAdRecommendations,
} from "./marketingHelpers.js";

// Re-export all types so consumers can import from a single location.
export type {
  FacebookAdAccount,
  FacebookCampaign,
  FacebookAdSet,
  FacebookAd,
  FacebookAdInsights,
  FacebookAdRecommendation,
  FacebookAudienceInsight,
  FacebookConversionEvent,
} from "./marketingTypes.js";

const logger = createLogger("provider:facebook:marketing");

export class FacebookMarketingApi {
  private apiClient: FacebookApiClient;

  constructor(credentials: FacebookCredentials) {
    this.apiClient = new FacebookApiClient(credentials);
  }

  async getAdAccounts(): Promise<FacebookAdAccount[]> {
    const response = await this.apiClient.makeApiRequest(
      `/me/adaccounts?fields=id,name,account_id,currency,timezone_name,account_status,balance,amount_spent,spend_cap,business_name,business_city,business_country_code`
    );

    const data = await response.json();

    return (data.data || []).map((account) => ({
      id: account.id,
      name: account.name,
      accountId: account.account_id,
      currency: account.currency,
      timezone: account.timezone_name,
      status: account.account_status === 1 ? "ACTIVE" : "DISABLED",
      balance: parseFloat(account.balance || "0"),
      amountSpent: parseFloat(account.amount_spent || "0"),
      spendCap: parseFloat(account.spend_cap || "0"),
      accountStatus: account.account_status,
      businessName: account.business_name,
      businessCity: account.business_city,
      businessCountryCode: account.business_country_code,
    }));
  }

  async getCampaigns(adAccountId: string): Promise<FacebookCampaign[]> {
    const response = await this.apiClient.makeApiRequest(
      `/${adAccountId}/campaigns?fields=id,name,status,objective,created_time,start_time,stop_time,updated_time,budget_remaining,daily_budget,lifetime_budget,bid_strategy,special_ad_categories`
    );

    const data = await response.json();

    return (data.data || []).map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      objective: campaign.objective,
      createdTime: campaign.created_time,
      startTime: campaign.start_time,
      stopTime: campaign.stop_time,
      updatedTime: campaign.updated_time,
      budgetRemainingAmount: campaign.budget_remaining
        ? parseFloat(campaign.budget_remaining)
        : undefined,
      dailyBudget: campaign.daily_budget ? parseFloat(campaign.daily_budget) : undefined,
      lifetimeBudget: campaign.lifetime_budget ? parseFloat(campaign.lifetime_budget) : undefined,
      bidStrategy: campaign.bid_strategy,
      specialAdCategories: campaign.special_ad_categories || [],
    }));
  }

  async getAdSets(campaignId: string): Promise<FacebookAdSet[]> {
    const response = await this.apiClient.makeApiRequest(
      `/${campaignId}/adsets?fields=id,name,campaign_id,status,created_time,start_time,end_time,updated_time,daily_budget,lifetime_budget,budget_remaining,bid_amount,targeting,optimization_goal,billing_event,bid_strategy`
    );

    const data = await response.json();

    return (data.data || []).map((adSet) => ({
      id: adSet.id,
      name: adSet.name,
      campaignId: adSet.campaign_id,
      status: adSet.status,
      createdTime: adSet.created_time,
      startTime: adSet.start_time,
      endTime: adSet.end_time,
      updatedTime: adSet.updated_time,
      dailyBudget: adSet.daily_budget ? parseFloat(adSet.daily_budget) : undefined,
      lifetimeBudget: adSet.lifetime_budget ? parseFloat(adSet.lifetime_budget) : undefined,
      budgetRemaining: adSet.budget_remaining ? parseFloat(adSet.budget_remaining) : undefined,
      bidAmount: adSet.bid_amount ? parseFloat(adSet.bid_amount) : undefined,
      targeting: processTargeting(adSet.targeting),
      optimization: {
        optimizationGoal: adSet.optimization_goal,
        billingEvent: adSet.billing_event,
        bidStrategy: adSet.bid_strategy,
      },
    }));
  }

  async getAds(adSetId: string): Promise<FacebookAd[]> {
    const response = await this.apiClient.makeApiRequest(
      `/${adSetId}/ads?fields=id,name,adset_id,campaign_id,status,created_time,updated_time,creative,tracking`
    );

    const data = await response.json();

    return (data.data || []).map((ad) => ({
      id: ad.id,
      name: ad.name,
      adSetId: ad.adset_id,
      campaignId: ad.campaign_id,
      status: ad.status,
      createdTime: ad.created_time,
      updatedTime: ad.updated_time,
      creative: ad.creative
        ? {
            id: ad.creative.id,
            title: ad.creative.title,
            body: ad.creative.body,
            imageUrl: ad.creative.image_url,
            videoId: ad.creative.video_id,
            linkUrl: ad.creative.link_url,
            callToActionType: ad.creative.call_to_action_type,
          }
        : undefined,
      tracking: ad.tracking,
    }));
  }

  async getInsights(
    objectId: string,
    level: "ad" | "adset" | "campaign" | "account",
    options: {
      datePreset?:
        | "today"
        | "yesterday"
        | "this_week"
        | "last_week"
        | "this_month"
        | "last_month"
        | "this_quarter"
        | "last_quarter"
        | "this_year"
        | "last_year"
        | "lifetime";
      since?: Date;
      until?: Date;
      breakdowns?: string[];
      fields?: string[];
    } = {}
  ): Promise<FacebookAdInsights[]> {
    const defaultFields = [
      "impressions",
      "reach",
      "frequency",
      "clicks",
      "unique_clicks",
      "ctr",
      "unique_ctr",
      "spend",
      "cpm",
      "cpc",
      "cpp",
      "cost_per_unique_click",
      "conversions",
      "conversion_values",
      "cost_per_conversion",
      "video_views",
      "video_30_sec_watched_actions",
      "video_avg_time_watched_actions",
      "link_clicks",
      "landing_page_views",
      "leads",
      "messaging_conversations_started",
      "mobile_app_install",
      "mobile_app_purchase_roas",
      "post_engagement",
      "post_reactions",
      "post_comments",
      "post_shares",
      "page_likes",
    ];

    const params = new URLSearchParams({
      level,
      fields: (options.fields || defaultFields).join(","),
    });

    if (options.datePreset) {
      params.append("date_preset", options.datePreset);
    } else if (options.since) {
      params.append(
        "time_range",
        JSON.stringify({
          since: options.since.toISOString().split("T")[0],
          until: (options.until || new Date()).toISOString().split("T")[0],
        })
      );
    }

    if (options.breakdowns?.length) {
      params.append("breakdowns", options.breakdowns.join(","));
    }

    const response = await this.apiClient.makeApiRequest(`/${objectId}/insights?${params}`);

    const data = await response.json();
    return (data.data || []).map((insight) => processInsights(insight));
  }

  async getAudienceInsights(_targeting: Record<string, unknown>): Promise<FacebookAudienceInsight> {
    // Future: Facebook deprecated the Audience Insights API in 2021.
    // Replace with the Marketing API "reach_estimate" endpoint when available.
    logger.warn("Audience Insights API is deprecated — returning empty data");
    return {
      size: 0,
      reach: 0,
      demographics: {
        ageGroups: {},
        genders: {},
        countries: {},
        cities: {},
        education: {},
        relationshipStatus: {},
        interests: [],
        behaviors: [],
        lifeEvents: [],
      },
      engagement: {
        facebookEngagement: 0,
        instagramEngagement: 0,
        totalEngagement: 0,
        engagementRate: 0,
      },
      purchasing: {
        onlineBuyers: 0,
        frequentBuyers: 0,
        averageSpend: 0,
        preferredCategories: [],
      },
      overlap: { similarAudiences: [] },
    };
  }

  async getDeliveryEstimate(
    adAccountId: string,
    targeting: Record<string, unknown>,
    optimizationGoal: string
  ): Promise<{
    estimate: {
      dailyOutcomes: { lowerBound: number; upperBound: number };
      reach: { lowerBound: number; upperBound: number };
    };
    targetingSpec: Record<string, unknown>;
    bid: { median: number; min: number; max: number };
  }> {
    const response = await this.apiClient.makeApiRequest(`/${adAccountId}/delivery_estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        optimization_goal: optimizationGoal,
        targeting_spec: targeting,
      }),
    });

    const data = await response.json();
    return data.data[0] || {};
  }

  async getConversionEvents(
    pixelId: string,
    period?: { since?: Date; until?: Date }
  ): Promise<FacebookConversionEvent[]> {
    const params = new URLSearchParams({
      fields: "name,description,event_source_group,custom_conversions",
    });

    if (period?.since) {
      params.append("since", Math.floor(period.since.getTime() / 1000).toString());
    }
    if (period?.until) {
      params.append("until", Math.floor(period.until.getTime() / 1000).toString());
    }

    const response = await this.apiClient.makeApiRequest(`/${pixelId}/stats?${params}`);
    const data = await response.json();

    return (data.data || []).map((event) => ({
      eventName: event.name,
      eventDescription: event.description,
      eventType: event.custom_conversions ? "CUSTOM" : "STANDARD",
      pixelId,
      dataSourceId: event.event_source_group,
      conversionValue: 0,
      conversionCount: 0,
      costPerConversion: 0,
      conversionRate: 0,
      attributionWindow: "7_day_click",
    }));
  }

  async getAdRecommendations(
    objectId: string,
    objectType: "campaign" | "adset" | "ad"
  ): Promise<FacebookAdRecommendation[]> {
    const insights = await this.getInsights(objectId, objectType, {
      datePreset: "last_week",
    });

    if (insights.length === 0) return [];

    const insight = insights[0]!;
    return generateAdRecommendations(objectId, objectType, insight);
  }

  async getAttributionAnalytics(
    _adAccountId: string,
    _options: {
      attributionWindows?: string[];
      conversions?: string[];
      period?: { since?: Date; until?: Date };
    } = {}
  ): Promise<{
    attributionModels: Array<{ window: string; conversions: number; value: number; cpa: number }>;
    conversionPaths: Array<{
      path: string[];
      conversions: number;
      value: number;
      avgTimeToConvert: number;
    }>;
    crossDeviceConversions: {
      total: number;
      percentage: number;
      breakdown: Record<string, number>;
    };
  }> {
    return {
      attributionModels: [
        { window: "1_day_click", conversions: 0, value: 0, cpa: 0 },
        { window: "7_day_click", conversions: 0, value: 0, cpa: 0 },
        { window: "28_day_click", conversions: 0, value: 0, cpa: 0 },
      ],
      conversionPaths: [],
      crossDeviceConversions: { total: 0, percentage: 0, breakdown: {} },
    };
  }

  async getBusinessInsights(_businessId: string): Promise<{
    adAccounts: number;
    totalSpend: number;
    totalConversions: number;
    avgROAS: number;
    topPerformingObjectives: Array<{
      objective: string;
      spend: number;
      conversions: number;
      roas: number;
    }>;
    monthlyTrends: Array<{ month: string; spend: number; conversions: number; roas: number }>;
  }> {
    const adAccounts = await this.getAdAccounts();

    interface ObjectiveEntry {
      objective: string;
      spend: number;
      conversions: number;
      roas: number;
    }

    let totalSpend = 0;
    let totalConversions = 0;
    const objectivePerformance: Record<string, ObjectiveEntry> = {};

    for (const account of adAccounts) {
      try {
        const campaigns = await this.getCampaigns(account.id);

        for (const campaign of campaigns) {
          const insights = await this.getInsights(campaign.id, "campaign", {
            datePreset: "last_month",
          });

          if (insights.length > 0) {
            const insight = insights[0]!;
            totalSpend += insight.spend;
            totalConversions += insight.conversions;

            if (!objectivePerformance[campaign.objective]) {
              objectivePerformance[campaign.objective] = {
                objective: campaign.objective,
                spend: 0,
                conversions: 0,
                roas: 0,
              };
            }

            const entry = objectivePerformance[campaign.objective]!;
            entry.spend += insight.spend;
            entry.conversions += insight.conversions;
            entry.roas = entry.spend > 0 ? insight.conversionValue / entry.spend : 0;
          }
        }
      } catch (error) {
        logger.warn({ err: error, accountId: account.id }, "Failed to get insights for account");
      }
    }

    const avgROAS = totalSpend > 0 ? totalConversions / totalSpend : 0;

    return {
      adAccounts: adAccounts.length,
      totalSpend,
      totalConversions,
      avgROAS,
      topPerformingObjectives: Object.values(objectivePerformance)
        .sort((a, b) => b.roas - a.roas)
        .slice(0, 5),
      monthlyTrends: [],
    };
  }
}
