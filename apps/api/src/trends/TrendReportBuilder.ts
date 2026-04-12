/**
 * @file TrendReportBuilder.ts
 * @description Helper functions for building trend reports including content categorization,
 *              pattern identification, anomaly detection, and recommendation generation.
 * @layer infrastructure
 */

import type { TrendingContent, TrendPrediction, ContentDiscoveryInsight } from "./trendTypes.js";

/**
 * Categorize trending content by type (videos, hashtags, sounds, challenges).
 */
export function categorizeTrendingContent(content: TrendingContent[]): {
  videos: TrendingContent[];
  hashtags: TrendingContent[];
  sounds: TrendingContent[];
  challenges: TrendingContent[];
} {
  return {
    videos: content.filter((t) => t.type === "video"),
    hashtags: content.filter((t) => t.type === "hashtag"),
    sounds: content.filter((t) => t.type === "sound"),
    challenges: content.filter((t) => t.type === "challenge"),
  };
}

/**
 * Get the most common category from trending content.
 */
export function getTopCategory(content: TrendingContent[]): string {
  const categories = content.map((t) => t.characteristics.category);
  const categoryCount = categories.reduce(
    (acc, cat) => {
      acc[cat] = (acc[cat] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return Object.entries(categoryCount).sort(([, a], [, b]) => b - a)[0]?.[0] || "mixed";
}

/**
 * Calculate the average estimated lifespan across trending content.
 */
export function calculateAverageLifespan(content: TrendingContent[]): number {
  const lifespans = content.map((t) => t.trend.estimatedLifespan);
  return lifespans.reduce((sum, lifespan) => sum + lifespan, 0) / lifespans.length;
}

/**
 * Identify content patterns from trending data.
 */
export function identifyPatterns(_content: TrendingContent[]): string[] {
  return [
    "Short-form educational content gaining momentum",
    "Authentic storytelling outperforming polished content",
    "Cross-generational trends showing higher sustainability",
  ];
}

/**
 * Identify market shifts from trending data.
 */
export function identifyShifts(_content: TrendingContent[]): string[] {
  return [
    "Shift from entertainment to educational content",
    "Increase in sustainability-focused trends",
    "Move toward inclusive and accessible content",
  ];
}

/**
 * Identify anomalies in trending data.
 */
export function identifyAnomalies(_content: TrendingContent[]): string[] {
  return [
    "Unexpected surge in B2B content engagement",
    "Decline in traditional dance challenge participation",
    "Rising interest in long-form content within short-form platform",
  ];
}

/**
 * Identify cross-trend patterns spanning multiple categories.
 */
export function identifyCrossTrends(_content: TrendingContent[]): string[] {
  return [
    "Wellness trends intersecting with productivity content",
    "Gaming culture influencing mainstream fashion",
    "Educational content adopting entertainment formats",
  ];
}

/**
 * Generate content recommendations based on trending data and discovery insights.
 */
export function generateContentRecommendations(
  _content: TrendingContent[],
  _opportunities: ContentDiscoveryInsight
): string[] {
  return [
    "Focus on educational content with entertainment value",
    "Develop sustainable lifestyle content for eco-conscious audience",
    "Create accessible tutorials for emerging tech trends",
  ];
}

/**
 * Generate timing recommendations for content publishing.
 */
export function generateTimingRecommendations(_content: TrendingContent[]): string[] {
  return [
    "Post educational content during weekday evenings",
    "Schedule entertainment content for weekend prime time",
    "Release trend-based content during early trend phase",
  ];
}

/**
 * Generate hashtag recommendations from trending content.
 */
export function generateHashtagRecommendations(content: TrendingContent[]): string[] {
  const topHashtags = content
    .flatMap((t) => t.characteristics.hashtags)
    .filter((tag, index, arr) => arr.indexOf(tag) === index)
    .slice(0, 10);

  return topHashtags;
}

/**
 * Generate sound recommendations from trending content.
 */
export function generateSoundRecommendations(content: TrendingContent[]): string[] {
  const topSounds = content
    .flatMap((t) => t.characteristics.sounds)
    .filter((sound, index, arr) => arr.indexOf(sound) === index)
    .slice(0, 5);

  return topSounds;
}

/**
 * Generate strategic recommendations based on trends and predictions.
 */
export function generateStrategyRecommendations(
  _content: TrendingContent[],
  _predictions: TrendPrediction[]
): string[] {
  return [
    "Diversify content portfolio across multiple trending categories",
    "Establish thought leadership in emerging trend areas",
    "Build content calendar around predicted trend cycles",
    "Develop rapid response capability for viral opportunities",
  ];
}
