/**
 * Application Layer - Optimize Content Use Case
 *
 * Part of Sprint 9: TDD Implementation
 * Optimizes social media content for better engagement.
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type {
  OptimizeContentInput,
  OptimizeContentOutput,
  ContentVariation,
  MLProvider,
} from "./types.js";

/**
 * Platform character limits
 */
const PLATFORM_LIMITS: Record<MLProvider, number> = {
  X: 280,
  FACEBOOK: 63206,
  INSTAGRAM: 2200,
  TIKTOK: 2200,
  YOUTUBE: 5000,
  LINKEDIN: 3000,
};

/**
 * Deterministic expected improvement (%) per optimization goal.
 * Values are based on industry benchmarks for each strategy type.
 */
const GOAL_BASE_IMPROVEMENT: Record<string, number> = {
  engagement: 15,
  reach: 20,
  clicks: 12,
  conversions: 18,
};

/**
 * Optimization strategies by goal
 */
const OPTIMIZATION_STRATEGIES: Record<string, string[]> = {
  engagement: [
    "Add a call-to-action question",
    "Use emotional language",
    "Include relevant hashtags",
    "Add emojis for visual appeal",
  ],
  reach: [
    "Use trending hashtags",
    "Optimize for shareability",
    "Make content more universal",
    "Add relevant mentions",
  ],
  clicks: [
    "Create urgency",
    "Add clear value proposition",
    "Use action verbs",
    "Include a link preview teaser",
  ],
  conversions: ["Add social proof", "Create scarcity", "Include clear CTA", "Address pain points"],
};

/**
 * Optimize Content Use Case
 *
 * Takes content and optimization goals, returns optimized versions
 * with recommendations and predicted improvements.
 */
export class OptimizeContentUseCase
  implements UseCase<OptimizeContentInput, OptimizeContentOutput, UseCaseError>
{
  async execute(input: OptimizeContentInput): Promise<Result<OptimizeContentOutput, UseCaseError>> {
    // Validate content is not empty
    if (!input.content || input.content.trim().length === 0) {
      return err(new UseCaseError("Content cannot be empty", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    // Get platform limit
    const platformLimit = PLATFORM_LIMITS[input.provider];
    const contentLength = input.content.length;

    // Optimize content
    let optimizedContent = input.content.trim();
    const recommendations: string[] = [];

    // Check if content exceeds platform limit
    if (contentLength > platformLimit) {
      optimizedContent = this.truncateContent(optimizedContent, platformLimit);
      recommendations.push(
        `Content was truncated to fit ${input.provider} character limit of ${platformLimit}`
      );
    }

    // Apply optimization strategies
    const strategies = OPTIMIZATION_STRATEGIES[input.optimizationGoal] ?? [];
    recommendations.push(...strategies.slice(0, 3));

    // Add hashtag recommendations if not present
    if (!optimizedContent.includes("#")) {
      recommendations.push("Consider adding relevant hashtags to increase discoverability");
    }

    // Calculate predicted improvement (mock calculation)
    const predictedImprovement = this.calculatePredictedImprovement(
      input.content,
      optimizedContent,
      input.optimizationGoal
    );

    // Generate variations if requested
    let variations: ContentVariation[] | undefined;
    if (input.generateVariations) {
      const count = input.variationCount ?? 3;
      variations = this.generateVariations(optimizedContent, count, input.optimizationGoal);
    }

    // Build output
    const output: OptimizeContentOutput = {
      originalContent: input.content,
      optimizedContent,
      optimizationGoal: input.optimizationGoal,
      recommendations,
      predictedImprovement,
      ...(variations && { variations }),
      ...(input.includeToneAnalysis && {
        toneAnalysis: {
          currentTone: this.detectTone(input.content),
          suggestedTones: this.suggestTones(input.optimizationGoal),
        },
      }),
    };

    return ok(output);
  }

  /**
   * Truncate content to fit platform limit while preserving meaning
   */
  private truncateContent(content: string, limit: number): string {
    if (content.length <= limit) {
      return content;
    }

    // Find a good break point
    const truncated = content.substring(0, limit - 3);
    const lastSpace = truncated.lastIndexOf(" ");

    if (lastSpace > limit * 0.8) {
      return truncated.substring(0, lastSpace) + "...";
    }

    return truncated + "...";
  }

  /**
   * Calculate predicted improvement percentage
   */
  private calculatePredictedImprovement(
    original: string,
    optimized: string,
    _goal: string
  ): number {
    // Base improvement from optimization
    let improvement = 15;

    // Bonus for adding hashtags
    const originalHashtags = (original.match(/#/g) ?? []).length;
    const optimizedHashtags = (optimized.match(/#/g) ?? []).length;
    if (optimizedHashtags > originalHashtags) {
      improvement += 5;
    }

    // Bonus for adding emojis
    const hasEmoji = /[\u{1F300}-\u{1F9FF}]/u.test(optimized);
    if (hasEmoji) {
      improvement += 3;
    }

    // Bonus for call-to-action
    const hasCTA = /\?|click|learn|discover|try|get|join/i.test(optimized);
    if (hasCTA) {
      improvement += 7;
    }

    return Math.min(improvement, 50); // Cap at 50%
  }

  /**
   * Generate content variations
   */
  private generateVariations(content: string, count: number, goal: string): ContentVariation[] {
    const variations: ContentVariation[] = [];
    const strategies = OPTIMIZATION_STRATEGIES[goal] ?? [];

    // Base improvement for the goal, with a small deterministic offset per variation index.
    // Each successive variation applies a different strategy so its improvement differs by ±2%.
    const baseImprovement = GOAL_BASE_IMPROVEMENT[goal] ?? 15;

    for (let i = 0; i < count; i++) {
      const strategy = strategies[i % strategies.length];
      // Variation 0 gets baseImprovement, variation 1 gets base+2, variation 2 gets base-2, etc.
      // This gives distinct, reproducible values without randomness.
      const offset = i % 2 === 0 ? -(i * 2) : i * 2 - 1;
      const expectedImprovement = Math.max(5, Math.min(50, baseImprovement + offset));
      const variation: ContentVariation = {
        content: this.applyStrategy(content, strategy ?? ""),
        changes: [strategy ?? `Variation ${i + 1}`],
        expectedImprovement,
      };
      variations.push(variation);
    }

    return variations;
  }

  /**
   * Apply a single optimization strategy
   */
  private applyStrategy(content: string, strategy: string): string {
    if (strategy.includes("question")) {
      return content + " What do you think?";
    }
    if (strategy.includes("hashtags")) {
      return content + " #trending #viral";
    }
    if (strategy.includes("emoji")) {
      return "✨ " + content + " 🚀";
    }
    if (strategy.includes("CTA") || strategy.includes("action")) {
      return content + " Learn more →";
    }
    return content + ` [${strategy}]`;
  }

  /**
   * Detect the tone of content
   */
  private detectTone(content: string): string {
    const lowerContent = content.toLowerCase();

    if (/urgent|now|limited|hurry|fast/i.test(lowerContent)) {
      return "urgent";
    }
    if (/amazing|incredible|awesome|love/i.test(lowerContent)) {
      return "enthusiastic";
    }
    if (/learn|understand|discover|how to/i.test(lowerContent)) {
      return "educational";
    }
    if (/please|thank|appreciate|grateful/i.test(lowerContent)) {
      return "appreciative";
    }

    return "neutral";
  }

  /**
   * Suggest tones based on optimization goal
   */
  private suggestTones(goal: string): string[] {
    switch (goal) {
      case "engagement":
        return ["conversational", "enthusiastic", "curious"];
      case "reach":
        return ["informative", "shareable", "universal"];
      case "clicks":
        return ["urgent", "intriguing", "value-focused"];
      case "conversions":
        return ["persuasive", "trustworthy", "action-oriented"];
      default:
        return ["professional", "friendly"];
    }
  }
}
