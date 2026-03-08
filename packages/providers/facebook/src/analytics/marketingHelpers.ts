/**
 * @file marketingHelpers.ts
 * @description Helper functions for Facebook Marketing API data processing.
 * Extracted from FacebookMarketingApi to keep files under 600 lines.
 */

import type { FacebookAdInsights, FacebookAdRecommendation } from "./marketingTypes.js";

/**
 * Process raw targeting data from the Facebook API into a normalized structure.
 */
export function processTargeting(targeting: any): any {
  if (!targeting) return undefined;

  return {
    geoLocations: targeting.geo_locations,
    ageMin: targeting.age_min,
    ageMax: targeting.age_max,
    genders: targeting.genders,
    interests: targeting.interests?.map((interest: any) => ({
      id: interest.id,
      name: interest.name,
    })),
    behaviors: targeting.behaviors?.map((behavior: any) => ({
      id: behavior.id,
      name: behavior.name,
    })),
    customAudiences: targeting.custom_audiences?.map((audience: any) => audience.id),
    lookalikAudiences: targeting.lookalike_audiences?.map((audience: any) => audience.id),
  };
}

/**
 * Process raw insights data from the Facebook API into a typed FacebookAdInsights object.
 */
export function processInsights(insight: any): FacebookAdInsights {
  const actions = insight.actions || [];
  const actionValues = insight.action_values || [];

  // Helper function to get action value
  const getActionValue = (actionType: string, isValue = false) => {
    const actionArray = isValue ? actionValues : actions;
    const action = actionArray.find((a: any) => a.action_type === actionType);
    return action ? parseFloat(action.value) : 0;
  };

  return {
    adId: insight.ad_id,
    adSetId: insight.adset_id,
    campaignId: insight.campaign_id,
    accountId: insight.account_id,
    dateStart: insight.date_start,
    dateStop: insight.date_stop,
    impressions: parseInt(insight.impressions || "0"),
    reach: parseInt(insight.reach || "0"),
    frequency: parseFloat(insight.frequency || "0"),
    clicks: parseInt(insight.clicks || "0"),
    uniqueClicks: parseInt(insight.unique_clicks || "0"),
    ctr: parseFloat(insight.ctr || "0"),
    uniqueCtr: parseFloat(insight.unique_ctr || "0"),
    spend: parseFloat(insight.spend || "0"),
    cpm: parseFloat(insight.cpm || "0"),
    cpc: parseFloat(insight.cpc || "0"),
    cpp: parseFloat(insight.cpp || "0"),
    costPerUniqueClick: parseFloat(insight.cost_per_unique_click || "0"),
    conversions: getActionValue("conversions"),
    conversionValue: getActionValue("conversions", true),
    costPerConversion: parseFloat(insight.cost_per_conversion || "0"),
    roas: parseFloat(insight.purchase_roas || "0"),
    videoViews: getActionValue("video_view"),
    videoWatches: getActionValue("video_30_sec_watched_actions"),
    video25PercentWatches: getActionValue("video_p25_watched_actions"),
    video50PercentWatches: getActionValue("video_p50_watched_actions"),
    video75PercentWatches: getActionValue("video_p75_watched_actions"),
    video100PercentWatches: getActionValue("video_p100_watched_actions"),
    videoAvgTimeWatched: parseFloat(insight.video_avg_time_watched_actions?.[0]?.value || "0"),
    linkClicks: getActionValue("link_click"),
    landingPageViews: getActionValue("landing_page_view"),
    leadGeneration: getActionValue("lead"),
    messaging: getActionValue("messaging_conversation_started_7d"),
    appInstalls: getActionValue("mobile_app_install"),
    appEngagement: getActionValue("app_engagement"),
    postEngagement: getActionValue("post_engagement"),
    postReactions: getActionValue("post_reaction"),
    postComments: getActionValue("comment"),
    postShares: getActionValue("post"),
    pageLikes: getActionValue("page_like"),
    eventResponses: getActionValue("rsvp"),
    checkinsTotal: getActionValue("checkin"),
    offlineConversions: getActionValue("offline_conversion"),
    demographics: processDemographicBreakdowns(insight),
  };
}

/**
 * Process demographic breakdowns from raw insight data.
 */
export function processDemographicBreakdowns(_insight: any): any {
  // This would process breakdown data if requested
  // For now, return empty structure
  return {
    ageGroups: {},
    genders: {},
    countries: {},
    devices: {},
    placements: {},
  };
}

/**
 * Generate ad recommendations based on insight performance data.
 */
export function generateAdRecommendations(
  objectId: string,
  objectType: "campaign" | "adset" | "ad",
  insight: FacebookAdInsights
): FacebookAdRecommendation[] {
  const recommendations: FacebookAdRecommendation[] = [];

  // Budget optimization recommendation
  if (insight.spend > 0 && insight.roas < 2) {
    recommendations.push({
      type: "BUDGET_OPTIMIZATION",
      priority: "HIGH",
      title: "Optimize Budget Allocation",
      description:
        "Your ROAS is below 2x. Consider reallocating budget to better-performing ad sets.",
      estimatedImpact: {
        metric: "ROAS",
        currentValue: insight.roas,
        projectedValue: insight.roas * 1.5,
        improvementPercentage: 50,
      },
      actionItems: [
        {
          action: "Pause underperforming ad sets",
          description: "Identify ad sets with ROAS < 1.5x and pause them",
          estimatedEffort: "LOW",
        },
        {
          action: "Increase budget for top performers",
          description: "Scale budget for ad sets with ROAS > 3x",
          estimatedEffort: "LOW",
        },
      ],
      [`${objectType}Id`]: objectId,
    });
  }

  // CTR optimization recommendation
  if (insight.ctr < 1) {
    recommendations.push({
      type: "CREATIVE_REFRESH",
      priority: "MEDIUM",
      title: "Improve Click-Through Rate",
      description: "Your CTR is below industry average. Consider refreshing your ad creative.",
      estimatedImpact: {
        metric: "CTR",
        currentValue: insight.ctr,
        projectedValue: insight.ctr * 2,
        improvementPercentage: 100,
      },
      actionItems: [
        {
          action: "Test new ad images/videos",
          description: "Create new visual content to capture attention",
          estimatedEffort: "HIGH",
        },
        {
          action: "Update ad copy",
          description: "Write more compelling headlines and descriptions",
          estimatedEffort: "MEDIUM",
        },
      ],
      [`${objectType}Id`]: objectId,
    });
  }

  // Frequency optimization
  if (insight.frequency > 3) {
    recommendations.push({
      type: "AUDIENCE_EXPANSION",
      priority: "MEDIUM",
      title: "Expand Audience to Reduce Frequency",
      description:
        "Your frequency is high, indicating audience fatigue. Consider expanding your targeting.",
      estimatedImpact: {
        metric: "REACH",
        currentValue: insight.reach,
        projectedValue: insight.reach * 1.3,
        improvementPercentage: 30,
      },
      actionItems: [
        {
          action: "Broaden interest targeting",
          description: "Add related interests to reach new users",
          estimatedEffort: "LOW",
        },
        {
          action: "Create lookalike audiences",
          description: "Use your best customers to find similar users",
          estimatedEffort: "MEDIUM",
        },
      ],
      [`${objectType}Id`]: objectId,
    });
  }

  return recommendations;
}
