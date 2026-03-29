/**
 * @file hashtagAnalytics.ts
 * @description Analytics, recommendation scoring, and warning generation
 * helpers for TikTok hashtag features.
 * Extracted from TikTokHashtagManager to keep files under 600 lines.
 */

import type { TikTokTrendingHashtag } from "./researchApiClient.js";
import type { HashtagPerformance, HashtagStrategy } from "./hashtagTypes.js";

/**
 * Generate strategy-level recommendations based on strategy shape and performance data.
 */
export function generateStrategyRecommendations(
  strategy: HashtagStrategy,
  performances: HashtagPerformance[]
): string[] {
  const recommendations: string[] = [];

  if (strategy.trending.length < 3) {
    recommendations.push("Add more trending hashtags to increase visibility");
  }

  if (strategy.niche.length < 5) {
    recommendations.push("Include more niche hashtags to reach targeted audience");
  }

  if (strategy.branded.length === 0) {
    recommendations.push("Consider adding branded hashtags for brand recognition");
  }

  const highDifficultyCount = performances.filter((p) => p.difficulty > 70).length;
  if (highDifficultyCount > 3) {
    recommendations.push("Too many high-competition hashtags, consider alternatives");
  }

  return recommendations;
}

/**
 * Generate warnings based on strategy and performance data.
 */
export function generateStrategyWarnings(
  strategy: HashtagStrategy,
  performances: HashtagPerformance[],
  totalHashtags: number
): string[] {
  const warnings: string[] = [];

  if (totalHashtags > 20) {
    warnings.push("Too many hashtags may reduce effectiveness");
  }

  const avoidHashtags = performances.filter((p) => p.recommendation === "avoid");
  if (avoidHashtags.length > 0) {
    warnings.push(`Avoid these hashtags: ${avoidHashtags.map((h) => h.hashtag).join(", ")}`);
  }

  return warnings;
}

/**
 * Filter and rank hashtags based on a goal (reach / engagement / viral / niche).
 */
export function generateRecommendationsForGoal(
  goal: string,
  _keywordTrends: unknown[],
  trendingHashtags: TikTokTrendingHashtag[],
  currentHashtags: string[],
  avoidHashtags: string[]
): string[] {
  let recommended: string[] = [];

  switch (goal) {
    case "reach":
      recommended = trendingHashtags.filter((h) => h.volume > 100000).map((h) => h.hashtag);
      break;
    case "engagement":
      recommended = trendingHashtags.filter((h) => h.engagement > 70).map((h) => h.hashtag);
      break;
    case "viral":
      recommended = trendingHashtags.filter((h) => h.growth > 50).map((h) => h.hashtag);
      break;
    case "niche":
      recommended = trendingHashtags.filter((h) => h.difficulty < 40).map((h) => h.hashtag);
      break;
  }

  return recommended.filter((h) => !currentHashtags.includes(h) && !avoidHashtags.includes(h));
}

/**
 * Build an optimal hashtag mix object for a given goal.
 */
export function generateOptimalMix(
  recommended: string[],
  goal: string
): { mix: string[]; reasoning: string; expectedReach: number; competitionLevel: string } {
  return {
    mix: recommended.slice(0, 12),
    reasoning: `Optimized for ${goal} based on current trends and performance data`,
    expectedReach: recommended.length * 15000,
    competitionLevel: "medium",
  };
}

/**
 * Generate alternative hashtag suggestions for each recommended hashtag.
 */
export function generateAlternatives(recommended: string[]): Record<string, string[]> {
  const alternatives: Record<string, string[]> = {};

  recommended.forEach((hashtag) => {
    alternatives[hashtag] = [hashtag + "2024", hashtag + "trend", hashtag + "viral"];
  });

  return alternatives;
}

/**
 * Build an avoid-list from high-difficulty trending hashtags and user overrides.
 */
export function generateAvoidList(
  trendingHashtags: TikTokTrendingHashtag[],
  userAvoidList: string[]
): Array<{ hashtag: string; reason: string; severity: "low" | "medium" | "high" }> {
  const avoid: Array<{ hashtag: string; reason: string; severity: "low" | "medium" | "high" }> = [];

  trendingHashtags
    .filter((h) => h.difficulty > 90)
    .forEach((h) => {
      avoid.push({
        hashtag: h.hashtag,
        reason: "Extremely high competition",
        severity: "high",
      });
    });

  userAvoidList.forEach((h) => {
    avoid.push({
      hashtag: h,
      reason: "User specified",
      severity: "medium",
    });
  });

  return avoid;
}

/**
 * Generate timing recommendations (static mock for now).
 */
export function generateTimingRecommendations(_recommended: string[]): {
  bestTimes: string[];
  avoid: string[];
  seasonal: string[];
} {
  return {
    bestTimes: ["12:00 PM", "6:00 PM", "9:00 PM"],
    avoid: ["3:00 AM", "4:00 AM", "5:00 AM"],
    seasonal: ["Spring content performs better in March-May"],
  };
}

/**
 * Generate reasons for recommending each hashtag.
 */
export function generateReasons(recommended: string[]): Record<string, string[]> {
  const reasons: Record<string, string[]> = {};

  recommended.forEach((hashtag) => {
    reasons[hashtag] = [
      "High engagement rate",
      "Growing trend",
      "Low competition",
      "Relevant to content",
    ];
  });

  return reasons;
}
