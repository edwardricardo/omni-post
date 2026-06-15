/**
 * @file mapAudienceInsights.ts
 * @description Adapter from `PredictAudienceApiValue` to the UI-friendly
 *              `AudienceInsight[]`. Demographics + behaviour fields are
 *              passed through verbatim from the backend; when the
 *              backend doesn't return them, the corresponding strings
 *              render empty rather than fabricating fake values
 *              ("25-44 / Global / 9 AM - 6 PM" had been hardcoded).
 * @layer infrastructure
 */

import type { AudienceInsight } from "../../types.js";
import type { PredictAudienceApiValue } from "./apiTypes.js";
import { SCORE_TO_TEN_DIVISOR, TOP_LIST_CAP } from "./providerMap.js";

const EMPTY_DEMOGRAPHICS = {
  ageGroup: "",
  location: "",
  interests: [] as string[],
};

const EMPTY_BEHAVIOR = {
  activeHours: "",
  preferredContent: [] as string[],
  engagementTriggers: [] as string[],
};

export function mapToAudienceInsights(
  audienceData: PredictAudienceApiValue | undefined
): AudienceInsight[] {
  if (!audienceData) return [];

  const {
    overallEngagementScore,
    predictions,
    segmentPredictions,
    optimizationSuggestions,
    demographics,
    behavior,
  } = audienceData;

  const sharedDemographics = demographics ?? EMPTY_DEMOGRAPHICS;
  const sharedBehavior = behavior ?? EMPTY_BEHAVIOR;

  // Per-segment insights when the backend provides segments.
  if (segmentPredictions && segmentPredictions.length > 0) {
    return segmentPredictions.map((seg) => ({
      segment: seg.segmentName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      size: predictions.reach,
      engagement: seg.engagementScore / SCORE_TO_TEN_DIVISOR,
      growthRate: seg.reachPotential / SCORE_TO_TEN_DIVISOR,
      demographics: sharedDemographics,
      behavior: sharedBehavior,
      predictions: {
        nextWeekActivity: seg.engagementScore,
        seasonalTrends: "",
        contentPreferences: optimizationSuggestions
          ? optimizationSuggestions.slice(0, TOP_LIST_CAP).map((s) => s.area)
          : [],
      },
    }));
  }

  // Fallback: single general insight derived from the overall score.
  return [
    {
      segment: "General Audience",
      size: predictions.reach,
      engagement: overallEngagementScore / SCORE_TO_TEN_DIVISOR,
      growthRate: 0,
      demographics: sharedDemographics,
      behavior: sharedBehavior,
      predictions: {
        nextWeekActivity: overallEngagementScore,
        seasonalTrends: "",
        contentPreferences: optimizationSuggestions
          ? optimizationSuggestions.slice(0, TOP_LIST_CAP).map((s) => s.area)
          : [],
      },
    },
  ];
}
