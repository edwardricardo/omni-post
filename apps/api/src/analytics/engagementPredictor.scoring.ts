/**
 * @file engagementPredictor.scoring.ts
 * @description Pure stateless scoring and utility functions for the engagement predictor
 *              using rule-based heuristics with static lookup tables and hand-tuned thresholds.
 * @layer infrastructure
 * Extracted from engagementPredictor.ts to keep each file ≤ 800 lines.
 */

import type { ContentType, ProviderType, PredictionFactor } from "@shared/analytics";
import type { HistoricalContext } from "./types.js";

// ---------------------------------------------------------------------------
// Content scoring
// ---------------------------------------------------------------------------

export function calculateContentLengthScore(length: number, optimal: number): number {
  const ratio = length / optimal;
  if (ratio >= 0.8 && ratio <= 1.2) return 1.0; // Optimal range
  if (ratio >= 0.6 && ratio <= 1.5) return 0.9; // Good range
  if (ratio >= 0.4 && ratio <= 2.0) return 0.7; // Acceptable range
  return 0.5; // Poor range
}

export function calculateHashtagScore(count: number, optimal: number): number {
  const diff = Math.abs(count - optimal);
  if (diff === 0) return 1.0;
  if (diff <= 1) return 0.9;
  if (diff <= 2) return 0.8;
  if (diff <= 3) return 0.6;
  return 0.4;
}

// ---------------------------------------------------------------------------
// Timing scoring
// ---------------------------------------------------------------------------

export function calculateHourScore(hour: number, peakHours: number[]): number {
  const distances = peakHours.map((peak) => Math.abs(hour - peak));
  const minDistance = Math.min(...distances);

  if (minDistance === 0) return 1.5;
  if (minDistance <= 1) return 1.2;
  if (minDistance <= 2) return 1.0;
  if (minDistance <= 3) return 0.8;
  return 0.6;
}

export function calculateDayScore(dayOfWeek: number): number {
  // 0 = Sunday, 1 = Monday, etc.
  const weekdayScores = [0.8, 1.0, 1.1, 1.2, 1.1, 0.9, 0.8]; // Sun-Sat
  return weekdayScores[dayOfWeek] ?? 1.0;
}

export function getSeasonalScore(month: number): number {
  // Seasonal multipliers for social media engagement
  const seasonalScores = [
    0.9, // January (post-holiday low)
    0.85, // February
    1.0, // March
    1.05, // April
    1.1, // May
    1.05, // June
    0.95, // July (summer vacation)
    0.9, // August
    1.1, // September (back to routine)
    1.15, // October
    1.2, // November (holiday prep)
    1.25, // December (holiday season)
  ];
  return seasonalScores[month] ?? 1.0;
}

// ---------------------------------------------------------------------------
// Sentiment analysis
// ---------------------------------------------------------------------------

export function analyzeSentiment(text: string): number {
  // Simple keyword-matching sentiment analysis (rule-based, not NLP/ML)
  const positiveWords = [
    "good",
    "great",
    "excellent",
    "amazing",
    "love",
    "awesome",
    "fantastic",
    "wonderful",
  ];
  const negativeWords = ["bad", "terrible", "awful", "hate", "horrible", "disgusting", "worst"];

  const words = text.toLowerCase().split(/\s+/);
  let score = 0;

  words.forEach((word) => {
    if (positiveWords.includes(word)) score += 1;
    if (negativeWords.includes(word)) score -= 1;
  });

  // Normalize to -1 to 1 range
  return Math.max(-1, Math.min(1, score / Math.max(1, words.length / 10)));
}

// ---------------------------------------------------------------------------
// Trending topics detection
// ---------------------------------------------------------------------------

export function checkTrendingTopics(
  content: string,
  trendingTopics: Array<{ topic: string; popularity: number; expectedLifespan: number }>
): { topic: string; popularity: number } | null {
  const contentLower = content.toLowerCase();

  for (const trend of trendingTopics) {
    if (contentLower.includes(trend.topic.toLowerCase())) {
      return { topic: trend.topic, popularity: trend.popularity };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Audience and confidence
// ---------------------------------------------------------------------------

export function calculateAudienceAlignment(
  contentType: ContentType,
  context: HistoricalContext
): number {
  // Mock audience alignment calculation.
  // In production, this would analyse audience demographics and preferences.
  const topContentTypes = context.accountPerformance.topPerformingContentTypes;
  const isPreferredType = topContentTypes.includes(contentType);
  return isPreferredType ? 1.2 : 0.9;
}

export function calculateViralPotential(
  engagementRate: number,
  contentType: ContentType,
  provider: ProviderType,
  factors: PredictionFactor[]
): number {
  let viralScore = 0;

  // Base viral potential from engagement rate
  if (engagementRate > 10) viralScore += 40;
  else if (engagementRate > 7) viralScore += 25;
  else if (engagementRate > 5) viralScore += 15;
  else if (engagementRate > 3) viralScore += 5;

  // Content type multipliers for viral potential
  const viralMultipliers: Record<ContentType, number> = {
    video: 1.8,
    reel: 2.0,
    image: 1.3,
    carousel: 1.4,
    text: 1.0,
    story: 1.1,
    thread: 1.2,
    poll: 1.5,
    live: 1.6,
  };

  viralScore *= viralMultipliers[contentType] ?? 1.0;

  // Platform multipliers
  const platformViralMultipliers: Partial<Record<ProviderType, number>> = {
    tiktok: 1.8,
    instagram: 1.5,
    twitter: 1.3,
    youtube: 1.4,
    facebook: 1.1,
    linkedin: 0.8,
    pinterest: 1.0,
  };

  viralScore *= platformViralMultipliers[provider] ?? 1.0;

  // Factor bonuses
  const trendingFactor = factors.find((f) => f.factor === "Trending Topics");
  if (trendingFactor && trendingFactor.impact > 0) {
    viralScore *= 1.5;
  }

  const sentimentFactor = factors.find((f) => f.factor === "Content Sentiment");
  if (sentimentFactor && sentimentFactor.impact > 0.1) {
    viralScore *= 1.2;
  }

  return Math.min(100, Math.max(0, viralScore));
}

export function calculatePredictionConfidence(
  factors: PredictionFactor[],
  context: HistoricalContext
): number {
  // Base confidence from factor reliability
  const avgFactorConfidence = factors.reduce((sum, f) => sum + f.confidence, 0) / factors.length;

  // Adjust based on historical data availability
  const historicalDataScore = context.accountPerformance.avgImpressions > 500 ? 1.0 : 0.7;

  // Combine scores
  return Math.min(0.95, avgFactorConfidence * historicalDataScore);
}

// ---------------------------------------------------------------------------
// Date / label helpers
// ---------------------------------------------------------------------------

export function calculateDateRange(timeRange: "7d" | "30d" | "90d" | "1y"): {
  startDate: Date;
  endDate: Date;
} {
  const now = new Date();
  const endDate = now;

  let startDate: Date;
  switch (timeRange) {
    case "7d":
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "30d":
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case "90d":
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case "1y":
      startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  return { startDate, endDate };
}

export function getDayName(dayOfWeek: number): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[dayOfWeek] ?? "Unknown";
}

export function getMonthName(month: number): string {
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return months[month] ?? "Unknown";
}

// ---------------------------------------------------------------------------
// Platform benchmark data
// ---------------------------------------------------------------------------

export function buildPlatformBenchmarks(): HistoricalContext["platformBenchmarks"] {
  return {
    twitter: {
      avgEngagementRate: 1.5,
      peakHours: [9, 12, 17, 19],
      contentTypeMultipliers: {} as Record<ContentType, number>,
    },
    instagram: {
      avgEngagementRate: 3.2,
      peakHours: [11, 13, 17, 19, 21],
      contentTypeMultipliers: {} as Record<ContentType, number>,
    },
    facebook: {
      avgEngagementRate: 1.8,
      peakHours: [10, 14, 15, 20],
      contentTypeMultipliers: {} as Record<ContentType, number>,
    },
    linkedin: {
      avgEngagementRate: 2.1,
      peakHours: [8, 12, 17, 18],
      contentTypeMultipliers: {} as Record<ContentType, number>,
    },
    youtube: {
      avgEngagementRate: 4.5,
      peakHours: [14, 16, 18, 20, 21],
      contentTypeMultipliers: {} as Record<ContentType, number>,
    },
    tiktok: {
      avgEngagementRate: 8.2,
      peakHours: [16, 18, 19, 20, 21, 22],
      contentTypeMultipliers: {} as Record<ContentType, number>,
    },
    pinterest: {
      avgEngagementRate: 0.9,
      peakHours: [10, 14, 20, 21],
      contentTypeMultipliers: {} as Record<ContentType, number>,
    },
  };
}
