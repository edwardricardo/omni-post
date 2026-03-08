/**
 * Application Layer - Predict Audience Response Use Case
 *
 * Part of Sprint 9: TDD Implementation
 * Predicts how the audience will respond to content based on
 * content description, topic, tone, and target segments.
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type {
  PredictAudienceInput,
  PredictAudienceOutput,
  SegmentPrediction,
  RiskFactor,
  OptimizationSuggestion,
  MLProvider,
} from "./types.js";

/**
 * Valid providers for validation
 */
const VALID_PROVIDERS: MLProvider[] = [
  "X",
  "FACEBOOK",
  "INSTAGRAM",
  "TIKTOK",
  "YOUTUBE",
  "LINKEDIN",
];

/**
 * Content type engagement scores (base values)
 */
const CONTENT_TYPE_SCORES: Record<string, number> = {
  promotional: 55,
  educational: 70,
  entertaining: 75,
  inspirational: 72,
  informative: 65,
  controversial: 60,
  news: 58,
  personal: 68,
};

/**
 * Tone modifiers
 */
const TONE_MODIFIERS: Record<string, number> = {
  exciting: 8,
  professional: 5,
  friendly: 7,
  urgent: 3,
  casual: 6,
  formal: 2,
  humorous: 10,
  aggressive: -5,
  neutral: 0,
};

/**
 * Topic risk factors
 */
const RISKY_TOPICS = ["political", "religious", "controversial", "sensitive", "adult"];

/**
 * Risky tones
 */
const RISKY_TONES = ["aggressive", "confrontational", "divisive", "mocking"];

/**
 * Default audience segments
 */
const DEFAULT_SEGMENTS = ["general_audience", "engaged_followers", "new_visitors"];

/**
 * Predict Audience Response Use Case
 *
 * Analyzes content descriptions to predict audience engagement,
 * identify risk factors, and suggest optimizations.
 */
export class PredictAudienceResponseUseCase
  implements UseCase<PredictAudienceInput, PredictAudienceOutput, UseCaseError>
{
  async execute(input: PredictAudienceInput): Promise<Result<PredictAudienceOutput, UseCaseError>> {
    // Validate provider
    if (!VALID_PROVIDERS.includes(input.contentDescription.provider as MLProvider)) {
      return err(
        new UseCaseError(
          `Invalid provider: ${input.contentDescription.provider}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    // Calculate overall engagement score
    const overallEngagementScore = this.calculateEngagementScore(input.contentDescription);

    // Generate engagement predictions
    const predictions = this.generatePredictions(overallEngagementScore);

    // Identify risk factors
    const riskFactors = this.identifyRiskFactors(input.contentDescription);

    // Generate segment predictions if segments are specified
    const segments = input.targetSegments ?? DEFAULT_SEGMENTS;
    const segmentPredictions = this.generateSegmentPredictions(
      segments,
      overallEngagementScore,
      input.contentDescription
    );

    // Generate optimization suggestions if requested
    let optimizationSuggestions: OptimizationSuggestion[] | undefined;
    if (input.includeOptimizationSuggestions) {
      optimizationSuggestions = this.generateOptimizationSuggestions(
        input.contentDescription,
        overallEngagementScore,
        riskFactors
      );
    }

    const output: PredictAudienceOutput = {
      overallEngagementScore,
      predictions,
      riskFactors,
      ...(segmentPredictions.length > 0 && { segmentPredictions }),
      ...(optimizationSuggestions && { optimizationSuggestions }),
    };

    return ok(output);
  }

  /**
   * Calculate overall engagement score based on content description
   */
  private calculateEngagementScore(description: {
    type: string;
    topic: string;
    tone: string;
    provider: MLProvider;
  }): number {
    // Base score from content type
    let score = CONTENT_TYPE_SCORES[description.type.toLowerCase()] ?? 50;

    // Apply tone modifier
    const toneModifier = TONE_MODIFIERS[description.tone.toLowerCase()] ?? 0;
    score += toneModifier;

    // Penalties for risky content
    if (RISKY_TOPICS.some((t) => description.topic.toLowerCase().includes(t))) {
      score -= 10;
    }
    if (RISKY_TONES.some((t) => description.tone.toLowerCase().includes(t))) {
      score -= 15;
    }

    // Platform-specific adjustments
    score = this.applyPlatformAdjustments(score, description.provider, description.type);

    // Ensure score is within 0-100 range
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Apply platform-specific score adjustments
   */
  private applyPlatformAdjustments(
    score: number,
    provider: MLProvider,
    contentType: string
  ): number {
    let adjusted = score;

    // Platform-content type synergies
    if (provider === "LINKEDIN" && contentType === "educational") {
      adjusted += 10;
    }
    if (provider === "TIKTOK" && contentType === "entertaining") {
      adjusted += 12;
    }
    if (
      provider === "INSTAGRAM" &&
      (contentType === "inspirational" || contentType === "personal")
    ) {
      adjusted += 8;
    }
    if (provider === "X" && contentType === "news") {
      adjusted += 7;
    }

    return adjusted;
  }

  /**
   * Generate engagement predictions (likes, comments, shares, reach)
   */
  private generatePredictions(engagementScore: number): {
    likes: number;
    comments: number;
    shares: number;
    reach: number;
  } {
    // Base multipliers (simplified model)
    const baseAudience = 1000; // Assume 1000 followers

    return {
      likes: Math.round(baseAudience * (engagementScore / 100) * 0.15),
      comments: Math.round(baseAudience * (engagementScore / 100) * 0.03),
      shares: Math.round(baseAudience * (engagementScore / 100) * 0.02),
      reach: Math.round(baseAudience * (engagementScore / 100) * 1.5),
    };
  }

  /**
   * Identify risk factors in content
   */
  private identifyRiskFactors(description: {
    type: string;
    topic: string;
    tone: string;
    provider: MLProvider;
  }): RiskFactor[] {
    const risks: RiskFactor[] = [];
    const topic = description.topic.toLowerCase();
    const tone = description.tone.toLowerCase();
    const type = description.type.toLowerCase();

    // Check for risky topics
    if (RISKY_TOPICS.some((t) => topic.includes(t))) {
      const matchedTopic = RISKY_TOPICS.find((t) => topic.includes(t)) ?? "sensitive";
      risks.push({
        type: "topic_risk",
        severity: matchedTopic === "political" || matchedTopic === "religious" ? "high" : "medium",
        description: `Content topic "${description.topic}" may be divisive or attract negative attention`,
        mitigation: "Consider neutral framing or focusing on facts rather than opinions",
      });
    }

    // Check for risky tones
    if (RISKY_TONES.some((t) => tone.includes(t))) {
      risks.push({
        type: "tone_risk",
        severity: tone === "aggressive" ? "high" : "medium",
        description: `The "${description.tone}" tone may alienate parts of your audience`,
        mitigation: "Consider a more balanced or constructive approach",
      });
    }

    // Check for promotional fatigue risk
    if (type === "promotional") {
      risks.push({
        type: "promotional_fatigue",
        severity: "low",
        description: "Frequent promotional content can lead to audience fatigue",
        mitigation: "Balance promotional content with value-adding posts (80/20 rule)",
      });
    }

    // Controversial content specific risks
    if (type === "controversial" || topic.includes("controversial")) {
      risks.push({
        type: "reputation_risk",
        severity: "high",
        description: "Controversial content may damage brand reputation",
        mitigation: "Ensure content aligns with brand values and consider the long-term impact",
      });
    }

    return risks;
  }

  /**
   * Generate segment-specific predictions
   */
  private generateSegmentPredictions(
    segments: string[],
    overallScore: number,
    description: { type: string; tone: string }
  ): SegmentPrediction[] {
    return segments.map((segment) => {
      let scoreModifier = 0;
      let sentiment: "positive" | "neutral" | "negative" = "neutral";

      // Adjust based on segment characteristics
      switch (segment.toLowerCase()) {
        case "engaged_followers":
          scoreModifier = 15;
          sentiment = "positive";
          break;
        case "industry_professionals":
          scoreModifier = description.type === "educational" ? 20 : -5;
          sentiment = description.type === "educational" ? "positive" : "neutral";
          break;
        case "new_visitors":
          scoreModifier = -10;
          sentiment = "neutral";
          break;
        case "casual_followers":
          scoreModifier = -5;
          sentiment = "neutral";
          break;
        case "brand_advocates":
          scoreModifier = 25;
          sentiment = "positive";
          break;
        default:
          scoreModifier = 0;
          sentiment = "neutral";
      }

      const segmentScore = Math.max(0, Math.min(100, overallScore + scoreModifier));

      return {
        segmentName: segment,
        engagementScore: segmentScore,
        reachPotential: Math.round(segmentScore * 0.8),
        sentiment,
      };
    });
  }

  /**
   * Generate optimization suggestions
   */
  private generateOptimizationSuggestions(
    description: { type: string; topic: string; tone: string },
    currentScore: number,
    riskFactors: RiskFactor[]
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    // Tone optimization
    if (TONE_MODIFIERS[description.tone.toLowerCase()] ?? 0 < 5) {
      suggestions.push({
        area: "tone",
        suggestion:
          "Consider using a more engaging tone (e.g., enthusiastic, friendly, or humorous)",
        expectedImpact: 8,
      });
    }

    // Content type optimization
    if (description.type.toLowerCase() === "promotional") {
      suggestions.push({
        area: "content_type",
        suggestion: "Mix promotional content with educational or entertaining elements",
        expectedImpact: 12,
      });
    }

    // Risk mitigation
    if (riskFactors.some((r) => r.severity === "high")) {
      suggestions.push({
        area: "risk_mitigation",
        suggestion: "Address high-risk factors before publishing to protect brand reputation",
        expectedImpact: 15,
      });
    }

    // Engagement optimization
    if (currentScore < 60) {
      suggestions.push({
        area: "engagement",
        suggestion: "Add a question or call-to-action to encourage audience interaction",
        expectedImpact: 10,
      });
    }

    // Timing optimization
    suggestions.push({
      area: "timing",
      suggestion: "Use optimal posting times for your audience timezone",
      expectedImpact: 5,
    });

    // Hashtag/visibility optimization
    suggestions.push({
      area: "visibility",
      suggestion: "Include relevant trending hashtags to increase discoverability",
      expectedImpact: 7,
    });

    return suggestions;
  }
}
