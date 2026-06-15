/**
 * @file mapTimingPredictions.ts
 * @description Adapter from `PredictTimingApiValue[]` (one entry per
 *              platform) to the UI-friendly `PerformancePrediction[]`
 *              consumed by the Performance tab. Falls back to a
 *              zero-confidence stub per-platform when an individual call
 *              returned no data so the UI still aligns 1:1 with
 *              `platforms`.
 * @layer infrastructure
 */

import type { PerformancePrediction } from "../../types.js";
import type { PredictTimingApiValue } from "./apiTypes.js";
import {
  CONFIDENCE_CEILING,
  RANGE_MAX_FACTOR,
  RANGE_MIN_FACTOR,
  REACH_CONFIDENCE_BOOST,
  REACH_RANGE_MAX_FACTOR,
  REACH_RANGE_MIN_FACTOR,
  REACH_RATIO_TO_PERCENT,
  VIRAL_HIGH_COMPETITION_FACTOR,
  VIRAL_LOW_COMPETITION_FACTOR,
  dayName,
} from "./providerMap.js";

function buildFallbackPrediction(platform: string): PerformancePrediction {
  return {
    platform,
    expectedEngagement: { value: 0, confidence: 0, range: { min: 0, max: 0 } },
    expectedReach: { value: 0, confidence: 0, range: { min: 0, max: 0 } },
    viralPotential: 0,
    optimalPostingTime: { hour: 12, day: "Monday", timezone: "UTC", confidence: 0 },
    audienceActivity: { peak: "N/A", low: "N/A", pattern: "variable" },
  };
}

export function mapToPerformancePredictions(
  timingResults: PredictTimingApiValue[] | undefined,
  platforms: string[]
): PerformancePrediction[] {
  if (!timingResults || timingResults.length === 0) return [];

  return platforms.map((platform, idx) => {
    const result = timingResults[idx];
    if (!result || !result.optimalSlots || result.optimalSlots.length === 0) {
      return buildFallbackPrediction(platform);
    }

    const topSlot = result.optimalSlots[0];
    if (!topSlot) return buildFallbackPrediction(platform);

    const engagementValue = topSlot.score;
    const reachValue = topSlot.audienceReach * REACH_RATIO_TO_PERCENT;

    const peakHour = result.activityPatterns
      ? result.activityPatterns.reduce((best, cur) =>
          cur.activityLevel > best.activityLevel ? cur : best
        ).hour
      : topSlot.hour;

    const peakLabel = `${peakHour}:00 - ${(peakHour + 2) % 24}:00`;
    const lowHour = (peakHour + 12) % 24;
    const lowLabel = `${lowHour}:00 - ${(lowHour + 2) % 24}:00`;

    const viralPotential =
      topSlot.competitionLevel === "low"
        ? Math.min(CONFIDENCE_CEILING, topSlot.audienceReach * VIRAL_LOW_COMPETITION_FACTOR)
        : topSlot.competitionLevel === "medium"
          ? topSlot.audienceReach
          : topSlot.audienceReach * VIRAL_HIGH_COMPETITION_FACTOR;

    return {
      platform,
      expectedEngagement: {
        value: engagementValue,
        confidence: topSlot.score,
        range: {
          min: engagementValue * RANGE_MIN_FACTOR,
          max: engagementValue * RANGE_MAX_FACTOR,
        },
      },
      expectedReach: {
        value: reachValue,
        confidence: Math.min(CONFIDENCE_CEILING, topSlot.score + REACH_CONFIDENCE_BOOST),
        range: {
          min: reachValue * REACH_RANGE_MIN_FACTOR,
          max: reachValue * REACH_RANGE_MAX_FACTOR,
        },
      },
      viralPotential,
      optimalPostingTime: {
        hour: topSlot.hour,
        day: dayName(topSlot.dayOfWeek),
        timezone: result.timezone,
        confidence: topSlot.score,
      },
      audienceActivity: {
        peak: peakLabel,
        low: lowLabel,
        pattern: "variable",
      },
    };
  });
}
