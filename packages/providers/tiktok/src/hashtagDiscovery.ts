/**
 * @file hashtagDiscovery.ts
 * @description Hashtag strategy generation and discovery logic for TikTok.
 * Extracted from TikTokHashtagManager to keep files under 600 lines.
 */

import type { HashtagPerformance, HashtagStrategy } from "./hashtagTypes.js";

/**
 * Build a HashtagStrategy from performance data and user options.
 */
export function createHashtagStrategy(
  performances: HashtagPerformance[],
  options: { brandedHashtags?: string[] }
): HashtagStrategy {
  const primary = performances
    .filter((p) => p.recommendation === "use" && p.difficulty < 50)
    .slice(0, 3)
    .map((p) => p.hashtag);

  const trending = performances
    .filter((p) => p.trend === "rising" && p.recommendation === "use")
    .slice(0, 5)
    .map((p) => p.hashtag);

  const niche = performances
    .filter((p) => p.difficulty < 30 && p.engagement > 50)
    .slice(0, 10)
    .map((p) => p.hashtag);

  const branded = options.brandedHashtags || [];

  const community = performances
    .filter((p) => p.recommendation === "use")
    .slice(0, 4)
    .map((p) => p.hashtag);

  return {
    primary,
    trending,
    niche,
    branded,
    community,
  };
}

/**
 * Simple keyword extraction from content (stop-word filtering).
 */
export function extractKeywords(content: string): string[] {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "are",
    "but",
    "not",
    "you",
    "all",
    "can",
    "had",
    "her",
    "was",
    "one",
    "our",
    "out",
    "day",
    "has",
    "his",
    "how",
    "man",
    "new",
    "now",
    "old",
    "see",
    "two",
    "way",
    "who",
    "boy",
    "did",
    "its",
    "let",
    "put",
    "say",
    "she",
    "too",
    "use",
  ]);

  const words = content.toLowerCase().split(/\s+/);
  return words.filter((word) => word.length > 3 && !stopWords.has(word)).slice(0, 10);
}

/**
 * Get total hashtag count across all strategy categories.
 */
export function getTotalHashtagCount(strategy: HashtagStrategy): number {
  return (
    strategy.primary.length +
    strategy.trending.length +
    strategy.niche.length +
    strategy.branded.length +
    strategy.community.length
  );
}

/**
 * Calculate estimated reach from a strategy.
 */
export function calculateEstimatedReach(strategy: HashtagStrategy): number {
  const allHashtags = [
    ...strategy.primary,
    ...strategy.trending,
    ...strategy.niche,
    ...strategy.branded,
    ...strategy.community,
  ];
  return allHashtags.length * 10000;
}

/**
 * Calculate difficulty score from a strategy.
 */
export function calculateDifficultyScore(strategy: HashtagStrategy): number {
  const primaryScore = strategy.primary.length * 70;
  const trendingScore = strategy.trending.length * 60;
  const nicheScore = strategy.niche.length * 30;
  const brandedScore = strategy.branded.length * 10;
  const communityScore = strategy.community.length * 50;

  const totalHashtags = getTotalHashtagCount(strategy);
  return totalHashtags > 0
    ? (primaryScore + trendingScore + nicheScore + brandedScore + communityScore) / totalHashtags
    : 0;
}

/**
 * Map difficulty score to competition level.
 */
export function assessCompetitionLevel(difficultyScore: number): "low" | "medium" | "high" {
  if (difficultyScore < 40) return "low";
  if (difficultyScore < 70) return "medium";
  return "high";
}

/**
 * Calculate viral potential from a strategy.
 */
export function calculateViralPotential(strategy: HashtagStrategy): number {
  const trendingWeight = strategy.trending.length * 0.4;
  const primaryWeight = strategy.primary.length * 0.3;
  const nicheWeight = strategy.niche.length * 0.2;
  const communityWeight = strategy.community.length * 0.1;

  return Math.min(100, (trendingWeight + primaryWeight + nicheWeight + communityWeight) * 10);
}
