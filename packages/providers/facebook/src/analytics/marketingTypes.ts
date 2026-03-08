/**
 * @file marketingTypes.ts
 * @description Facebook Marketing API type definitions — ad accounts, campaigns, ad sets,
 * ads, insights, recommendations, audience insights, and conversion events.
 * Extracted from marketing.ts to keep file sizes under 800 lines.
 */

export interface FacebookAdAccount {
  id: string;
  name: string;
  accountId: string;
  currency: string;
  timezone: string;
  status: "ACTIVE" | "DISABLED" | "UNSETTLED";
  balance: number;
  amountSpent: number;
  spendCap: number;
  accountStatus: number;
  businessName?: string;
  businessCity?: string;
  businessCountryCode?: string;
}

export interface FacebookCampaign {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  objective:
    | "BRAND_AWARENESS"
    | "REACH"
    | "TRAFFIC"
    | "ENGAGEMENT"
    | "APP_INSTALLS"
    | "VIDEO_VIEWS"
    | "LEAD_GENERATION"
    | "MESSAGES"
    | "CONVERSIONS"
    | "CATALOG_SALES"
    | "STORE_VISITS";
  createdTime: string;
  startTime?: string;
  stopTime?: string;
  updatedTime: string;
  budgetRemainingAmount?: number;
  dailyBudget?: number;
  lifetimeBudget?: number;
  bidStrategy?: string;
  specialAdCategories?: string[];
}

export interface FacebookAdSet {
  id: string;
  name: string;
  campaignId: string;
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  createdTime: string;
  startTime?: string;
  endTime?: string;
  updatedTime: string;
  dailyBudget?: number;
  lifetimeBudget?: number;
  budgetRemaining?: number;
  bidAmount?: number;
  targeting?: {
    geoLocations?: {
      countries?: string[];
      regions?: string[];
      cities?: string[];
    };
    ageMin?: number;
    ageMax?: number;
    genders?: number[];
    interests?: Array<{
      id: string;
      name: string;
    }>;
    behaviors?: Array<{
      id: string;
      name: string;
    }>;
    customAudiences?: string[];
    lookalikAudiences?: string[];
  };
  optimization?: {
    optimizationGoal: string;
    billingEvent: string;
    bidStrategy: string;
  };
}

export interface FacebookAd {
  id: string;
  name: string;
  adSetId: string;
  campaignId: string;
  status:
    | "ACTIVE"
    | "PAUSED"
    | "DELETED"
    | "ARCHIVED"
    | "PENDING_REVIEW"
    | "DISAPPROVED"
    | "PREAPPROVED"
    | "PENDING_BILLING_INFO"
    | "CAMPAIGN_PAUSED"
    | "ADSET_PAUSED";
  createdTime: string;
  updatedTime: string;
  creative?: {
    id: string;
    title?: string;
    body?: string;
    imageUrl?: string;
    videoId?: string;
    linkUrl?: string;
    callToActionType?: string;
  };
  tracking?: {
    urlTags?: string;
    pixelId?: string;
    conversionEvents?: string[];
  };
}

export interface FacebookAdInsights {
  adId?: string;
  adSetId?: string;
  campaignId?: string;
  accountId: string;
  dateStart: string;
  dateStop: string;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  uniqueClicks: number;
  ctr: number; // Click-through rate
  uniqueCtr: number;
  spend: number;
  cpm: number; // Cost per mille (thousand impressions)
  cpc: number; // Cost per click
  cpp: number; // Cost per point
  costPerUniqueClick: number;
  conversions: number;
  conversionValue: number;
  costPerConversion: number;
  roas: number; // Return on ad spend
  videoViews?: number;
  videoWatches?: number;
  video25PercentWatches?: number;
  video50PercentWatches?: number;
  video75PercentWatches?: number;
  video100PercentWatches?: number;
  videoAvgTimeWatched?: number;
  linkClicks?: number;
  landingPageViews?: number;
  leadGeneration?: number;
  messaging?: number;
  appInstalls?: number;
  appEngagement?: number;
  postEngagement?: number;
  postReactions?: number;
  postComments?: number;
  postShares?: number;
  pageLikes?: number;
  eventResponses?: number;
  checkinsTotal?: number;
  offlineConversions?: number;
  demographics?: {
    ageGroups: Record<
      string,
      {
        impressions: number;
        clicks: number;
        spend: number;
        conversions: number;
      }
    >;
    genders: Record<
      string,
      {
        impressions: number;
        clicks: number;
        spend: number;
        conversions: number;
      }
    >;
    countries: Record<
      string,
      {
        impressions: number;
        clicks: number;
        spend: number;
        conversions: number;
      }
    >;
    devices: Record<
      string,
      {
        impressions: number;
        clicks: number;
        spend: number;
        conversions: number;
      }
    >;
    placements: Record<
      string,
      {
        impressions: number;
        clicks: number;
        spend: number;
        conversions: number;
      }
    >;
  };
}

export interface FacebookAdRecommendation {
  type:
    | "BUDGET_OPTIMIZATION"
    | "AUDIENCE_EXPANSION"
    | "CREATIVE_REFRESH"
    | "PLACEMENT_OPTIMIZATION"
    | "BID_STRATEGY"
    | "TARGETING_REFINEMENT";
  priority: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  description: string;
  estimatedImpact: {
    metric: "ROAS" | "CPC" | "CTR" | "CONVERSIONS" | "REACH";
    currentValue: number;
    projectedValue: number;
    improvementPercentage: number;
  };
  actionItems: Array<{
    action: string;
    description: string;
    estimatedEffort: "LOW" | "MEDIUM" | "HIGH";
  }>;
  adId?: string;
  adSetId?: string;
  campaignId?: string;
}

export interface FacebookAudienceInsight {
  audienceId?: string;
  audienceName?: string;
  size: number;
  reach: number;
  demographics: {
    ageGroups: Record<string, number>;
    genders: Record<string, number>;
    countries: Record<string, number>;
    cities: Record<string, number>;
    education: Record<string, number>;
    relationshipStatus: Record<string, number>;
    interests: Array<{
      name: string;
      audience: number;
      affinityScore: number;
    }>;
    behaviors: Array<{
      name: string;
      audience: number;
      indexScore: number;
    }>;
    lifeEvents: Array<{
      name: string;
      audience: number;
      timeWindow: string;
    }>;
  };
  engagement: {
    facebookEngagement: number;
    instagramEngagement: number;
    totalEngagement: number;
    engagementRate: number;
  };
  purchasing: {
    onlineBuyers: number;
    frequentBuyers: number;
    averageSpend: number;
    preferredCategories: string[];
  };
  overlap: {
    similarAudiences: Array<{
      audienceId: string;
      audienceName: string;
      overlapPercentage: number;
      overlapSize: number;
    }>;
  };
}

export interface FacebookConversionEvent {
  eventName: string;
  eventDescription?: string;
  eventType: "STANDARD" | "CUSTOM";
  pixelId: string;
  dataSourceId: string;
  conversionValue: number;
  conversionCount: number;
  costPerConversion: number;
  conversionRate: number;
  attributionWindow: "1_day_view" | "7_day_view" | "1_day_click" | "7_day_click" | "28_day_click";
  breakdown?: {
    byDevice: Record<string, number>;
    byAge: Record<string, number>;
    byGender: Record<string, number>;
    byCountry: Record<string, number>;
    byPlacement: Record<string, number>;
  };
}
