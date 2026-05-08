/**
 * @file providerMap.ts
 * @description Helpers + tunable constants used by the predictive-analytics
 *              mappers: provider name → MLProvider enum, day-of-week label,
 *              and the heuristic factors applied to backend scores when
 *              extrapolating UI ranges (kept here so callers can audit
 *              every magic number in one place).
 * @layer infrastructure
 */

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function dayName(dow: number): string {
  return DAY_NAMES[dow] ?? "Monday";
}

const PROVIDER_MAP: Record<string, string> = {
  twitter: "X",
  x: "X",
  instagram: "INSTAGRAM",
  facebook: "FACEBOOK",
  tiktok: "TIKTOK",
  youtube: "YOUTUBE",
  linkedin: "LINKEDIN",
};

export function toMLProvider(platform: string): string {
  return PROVIDER_MAP[platform.toLowerCase()] ?? platform.toUpperCase();
}

/**
 * Heuristic multipliers used when the backend returns a single point
 * estimate and the UI needs a `[min, max]` range around it. Centralised
 * so a single tweak adjusts every range render.
 */
export const RANGE_MIN_FACTOR = 0.7;
export const RANGE_MAX_FACTOR = 1.3;
export const REACH_RANGE_MIN_FACTOR = 0.6;
export const REACH_RANGE_MAX_FACTOR = 1.8;

/** Reach confidence offset (+5% over score, capped at 95). */
export const REACH_CONFIDENCE_BOOST = 5;
export const CONFIDENCE_CEILING = 95;

/** Viral-potential heuristic factor when competition is "low". */
export const VIRAL_LOW_COMPETITION_FACTOR = 1.5;
/** Viral-potential heuristic factor when competition is "high". */
export const VIRAL_HIGH_COMPETITION_FACTOR = 0.6;

/** ROI confidence is clamped to [50, 95] when derived from roiPercentage. */
export const ROI_CONFIDENCE_FLOOR = 50;
export const ROI_CONFIDENCE_CEILING = 95;

/**
 * Engagement is reported per 0–100 score by the backend; the UI displays
 * a 0–10 scale, so segment scores are divided by this factor before
 * rendering.
 */
export const SCORE_TO_TEN_DIVISOR = 10;

/** Audience-reach number is reported as a 0–1 ratio; render as 0–100%. */
export const REACH_RATIO_TO_PERCENT = 100;

/** Cap for `topContentTypes` and `recommendations` rendered in cards. */
export const TOP_LIST_CAP = 3;
/** Cap for `channelBreakdown` factor entries in the ROI card. */
export const ROI_FACTORS_CAP = 4;
