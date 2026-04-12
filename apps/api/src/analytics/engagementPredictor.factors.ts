/**
 * @file engagementPredictor.factors.ts
 * @description Factor extraction and scoring calculation helpers for the engagement predictor
 *              including content features, timing factors, and optimization suggestions.
 * @layer infrastructure
 * NOTE: All calculations here are rule-based heuristics using hand-tuned
 * weights and static lookup tables. No machine learning or statistical
 * training is involved despite the "prediction" naming.
 *
 * Extracted from engagementPredictor.ts to keep each file ≤ 800 lines.
 */

import type {
  PerformancePrediction,
  PredictionFactor,
  OptimizationSuggestion,
} from "@shared/analytics";
import type { PredictionRequest, HistoricalContext } from "./types.js";
import { MODEL_WEIGHTS, PLATFORM_MULTIPLIERS } from "./engagementPredictor.config.js";
import {
  calculateContentLengthScore,
  calculateHashtagScore,
  calculateHourScore,
  calculateDayScore,
  getSeasonalScore,
  analyzeSentiment,
  checkTrendingTopics,
  calculateAudienceAlignment,
  calculateViralPotential,
  calculatePredictionConfidence,
  getDayName,
  getMonthName,
} from "./engagementPredictor.scoring.js";

// ---------------------------------------------------------------------------
// Content feature extraction
// ---------------------------------------------------------------------------

export function extractContentFeatures(request: PredictionRequest): PredictionFactor[] {
  const features: PredictionFactor[] = [];

  const platformConfig = PLATFORM_MULTIPLIERS[request.provider];

  // Content length factor
  const contentLength = request.contentText.length;
  const lengthOptimal = platformConfig.textOptimal;
  const lengthScore = calculateContentLengthScore(contentLength, lengthOptimal);

  features.push({
    factor: "Content Length",
    impact: lengthScore * MODEL_WEIGHTS.contentLength,
    confidence: 0.8,
    description: `Content length of ${contentLength} characters vs optimal ${lengthOptimal}`,
  });

  // Hashtag factor
  const hashtagCount = request.hashtags?.length ?? 0;
  const hashtagOptimal = platformConfig.hashtagOptimal;
  const hashtagScore = calculateHashtagScore(hashtagCount, hashtagOptimal);

  features.push({
    factor: "Hashtag Usage",
    impact: hashtagScore * MODEL_WEIGHTS.hashtagCount,
    confidence: 0.75,
    description: `${hashtagCount} hashtags vs optimal ${hashtagOptimal} for ${request.provider}`,
  });

  // Media presence factor
  const hasMedia = (request.mediaCount ?? 0) > 0;
  const mediaScore = hasMedia ? platformConfig.mediaBoost : 1.0;

  features.push({
    factor: "Media Presence",
    impact: (mediaScore - 1) * MODEL_WEIGHTS.mediaPresence,
    confidence: 0.9,
    description: hasMedia ? "Content includes media" : "Text-only content",
  });

  // Content type factor
  const contentTypeMultiplier = platformConfig.contentTypeMultipliers[request.contentType];
  features.push({
    factor: "Content Type",
    impact: (contentTypeMultiplier - 1) * 0.3,
    confidence: 0.85,
    description: `${request.contentType} content on ${request.provider} (${contentTypeMultiplier}x multiplier)`,
  });

  // Keyword-based sentiment scoring (rule-based, not NLP)
  const sentiment = analyzeSentiment(request.contentText);
  features.push({
    factor: "Content Sentiment",
    impact: sentiment * MODEL_WEIGHTS.contentSentiment,
    confidence: 0.6,
    description: `Content sentiment: ${sentiment > 0.5 ? "positive" : sentiment < -0.5 ? "negative" : "neutral"}`,
  });

  return features;
}

// ---------------------------------------------------------------------------
// Timing factor calculation
// ---------------------------------------------------------------------------

export function calculateTimingFactors(
  scheduledTime: Date | undefined,
  provider: PredictionRequest["provider"]
): PredictionFactor[] {
  const factors: PredictionFactor[] = [];

  if (!scheduledTime) {
    return factors;
  }

  const hour = scheduledTime.getHours();
  const dayOfWeek = scheduledTime.getDay();
  const platformConfig = PLATFORM_MULTIPLIERS[provider];

  // Time of day factor
  const isPeakHour = platformConfig.peakHours.includes(hour);
  const timeScore = isPeakHour ? 1.5 : calculateHourScore(hour, platformConfig.peakHours);

  factors.push({
    factor: "Time of Day",
    impact: (timeScore - 1) * MODEL_WEIGHTS.timeOfDay,
    confidence: 0.8,
    description: `Posting at ${hour}:00 ${isPeakHour ? "(peak hour)" : "(off-peak)"}`,
  });

  // Day of week factor
  const dayScore = calculateDayScore(dayOfWeek);
  factors.push({
    factor: "Day of Week",
    impact: (dayScore - 1) * MODEL_WEIGHTS.dayOfWeek,
    confidence: 0.7,
    description: `Posting on ${getDayName(dayOfWeek)} (${dayScore.toFixed(2)}x multiplier)`,
  });

  // Seasonal factor
  const month = scheduledTime.getMonth();
  const seasonalScore = getSeasonalScore(month);
  factors.push({
    factor: "Seasonality",
    impact: (seasonalScore - 1) * MODEL_WEIGHTS.seasonality,
    confidence: 0.6,
    description: `Seasonal effect for ${getMonthName(month)} (${seasonalScore.toFixed(2)}x multiplier)`,
  });

  return factors;
}

// ---------------------------------------------------------------------------
// Platform factor calculation
// ---------------------------------------------------------------------------

export function calculatePlatformFactors(
  request: PredictionRequest,
  context: HistoricalContext
): PredictionFactor[] {
  const factors: PredictionFactor[] = [];

  // Historical performance factor
  const accountAvg = context.accountPerformance.avgEngagementRate;
  const platformBenchmark = context.platformBenchmarks[request.provider]?.avgEngagementRate ?? 3.0;
  const historicalScore = accountAvg / platformBenchmark;

  factors.push({
    factor: "Historical Performance",
    impact: (historicalScore - 1) * MODEL_WEIGHTS.historicalPerformance,
    confidence: 0.9,
    description: `Account avg ${accountAvg.toFixed(2)}% vs platform benchmark ${platformBenchmark.toFixed(2)}%`,
  });

  // Trending topics factor
  const containsTrendingTopic = checkTrendingTopics(request.contentText, context.trendingTopics);
  if (containsTrendingTopic) {
    factors.push({
      factor: "Trending Topics",
      impact: containsTrendingTopic.popularity * MODEL_WEIGHTS.trending,
      confidence: 0.7,
      description: `Content includes trending topic: "${containsTrendingTopic.topic}"`,
    });
  }

  // Audience alignment factor (rule-based content-type matching)
  const audienceAlignment = calculateAudienceAlignment(request.contentType, context);
  factors.push({
    factor: "Audience Alignment",
    impact: (audienceAlignment - 1) * MODEL_WEIGHTS.audienceAlignment,
    confidence: 0.75,
    description: `Content-audience fit score: ${audienceAlignment.toFixed(2)}`,
  });

  return factors;
}

// ---------------------------------------------------------------------------
// Prediction calculation
// ---------------------------------------------------------------------------

export function calculatePrediction(
  contentFeatures: PredictionFactor[],
  timingFactors: PredictionFactor[],
  platformFactors: PredictionFactor[],
  context: HistoricalContext,
  request: PredictionRequest
): PerformancePrediction {
  // Base prediction from historical average
  const baseEngagementRate = context.accountPerformance.avgEngagementRate || 3.0;
  const baseImpressions = context.accountPerformance.avgImpressions || 1000;

  // Calculate total impact from all factors
  const allFactors = [...contentFeatures, ...timingFactors, ...platformFactors];
  const totalImpact = allFactors.reduce((sum, factor) => sum + factor.impact, 0);

  // Apply multiplier to base metrics
  const multiplier = Math.max(0.1, 1 + totalImpact);

  const expectedEngagementRate = Math.max(0.1, baseEngagementRate * multiplier);
  const expectedImpressions = Math.max(100, baseImpressions * Math.pow(multiplier, 0.7));
  const expectedEngagements = Math.round(expectedImpressions * (expectedEngagementRate / 100));
  const expectedReach = Math.round(expectedImpressions * 0.7);
  const expectedClicks = Math.round(expectedImpressions * 0.02);

  // Calculate viral potential
  const viralPotential = calculateViralPotential(
    expectedEngagementRate,
    request.contentType,
    request.provider,
    allFactors
  );

  // Calculate confidence based on factor reliability
  const confidence = calculatePredictionConfidence(allFactors, context);

  return {
    expectedImpressions,
    expectedEngagements,
    expectedEngagementRate,
    expectedReach,
    expectedClicks,
    viralPotential,
    confidence,
    factors: allFactors,
  };
}

// ---------------------------------------------------------------------------
// Optimisation suggestions
// ---------------------------------------------------------------------------

export function generateOptimizationSuggestions(
  request: PredictionRequest,
  _prediction: PerformancePrediction,
  _context: HistoricalContext
): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];

  const platformConfig = PLATFORM_MULTIPLIERS[request.provider];

  // Content length optimization
  const contentLength = request.contentText.length;
  const optimalLength = platformConfig.textOptimal;

  if (Math.abs(contentLength - optimalLength) > optimalLength * 0.3) {
    const lengthDiff = contentLength - optimalLength;
    suggestions.push({
      type: "content",
      current: `${contentLength} characters`,
      suggested: `~${optimalLength} characters`,
      reason:
        lengthDiff > 0
          ? "Content is too long for optimal engagement"
          : "Content could be expanded for better performance",
      expectedImprovement: (Math.abs(lengthDiff) / optimalLength) * 15,
      implementationNotes: [
        lengthDiff > 0
          ? "Consider breaking into multiple posts or trimming content"
          : "Add more detail, examples, or call-to-action",
        "Focus on maintaining key message while adjusting length",
      ],
    });
  }

  // Hashtag optimization
  const hashtagCount = request.hashtags?.length ?? 0;
  const optimalHashtags = platformConfig.hashtagOptimal;

  if (hashtagCount !== optimalHashtags) {
    const hashtagDiff = hashtagCount - optimalHashtags;
    suggestions.push({
      type: "hashtags",
      current: `${hashtagCount} hashtags`,
      suggested: `${optimalHashtags} hashtags`,
      reason:
        hashtagDiff > 0
          ? "Too many hashtags may appear spammy"
          : "Additional hashtags could improve discoverability",
      expectedImprovement: (Math.abs(hashtagDiff) / optimalHashtags) * 12,
      implementationNotes: [
        hashtagDiff > 0 ? "Remove less relevant hashtags" : "Add relevant trending hashtags",
        "Focus on hashtags specific to your niche and audience",
      ],
    });
  }

  // Media optimization
  if (!request.mediaCount || request.mediaCount === 0) {
    const mediaBoost = platformConfig.mediaBoost;
    if (mediaBoost > 1.2) {
      suggestions.push({
        type: "media",
        current: "Text-only post",
        suggested: "Add visual content",
        reason: `${request.provider} heavily favors posts with media`,
        expectedImprovement: (mediaBoost - 1) * 100,
        implementationNotes: [
          "Add relevant image, video, or graphic",
          "Ensure media quality is high and on-brand",
          "Consider platform-specific media formats",
        ],
      });
    }
  }

  // Timing optimization
  if (request.scheduledTime) {
    const hour = request.scheduledTime.getHours();
    const peakHours = platformConfig.peakHours;
    const isPeak = peakHours.includes(hour);

    if (!isPeak) {
      const bestHour = peakHours[0]; // Simplified - take first peak hour
      suggestions.push({
        type: "timing",
        current: `${hour}:00`,
        suggested: `${bestHour}:00`,
        reason: "Posting during peak hours increases visibility",
        expectedImprovement: 25,
        implementationNotes: [
          `Schedule for ${bestHour}:00 when your audience is most active`,
          "Consider your audience's time zone",
          "Test different times to find your optimal schedule",
        ],
      });
    }
  }

  // Content type optimization
  const currentMultiplier = platformConfig.contentTypeMultipliers[request.contentType];
  const contentTypeEntries = Object.entries(platformConfig.contentTypeMultipliers).sort(
    ([, a], [, b]) => b - a
  );
  const bestContentType = contentTypeEntries[0];

  if (bestContentType && currentMultiplier < bestContentType[1] * 0.8) {
    suggestions.push({
      type: "content",
      current: `${request.contentType} content`,
      suggested: `${bestContentType[0]} content`,
      reason: `${bestContentType[0]} content performs ${((bestContentType[1] / currentMultiplier - 1) * 100).toFixed(0)}% better on ${request.provider}`,
      expectedImprovement: (bestContentType[1] / currentMultiplier - 1) * 100,
      implementationNotes: [
        `Consider adapting content to ${bestContentType[0]} format`,
        "Maintain your core message while changing format",
        "Test different content types to find what works for your audience",
      ],
    });
  }

  return suggestions.sort((a, b) => b.expectedImprovement - a.expectedImprovement);
}
