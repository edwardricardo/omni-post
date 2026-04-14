/**
 * @file OptimizeContentUseCase.ts
 * @description Optimizes social media content using AI providers (OpenAI, Gemini, Perplexity)
 *              with deterministic heuristic fallback when AI is unavailable.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type {
  OptimizeContentInput,
  OptimizeContentOutput,
  ContentVariation,
  MLProvider,
} from "./types.js";
import type { AIService } from "../../ai/aiService.js";

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
 * Maps our MLProvider names to the platform names expected by the AI orchestrator
 */
const PROVIDER_TO_PLATFORM: Record<MLProvider, string> = {
  X: "twitter",
  FACEBOOK: "facebook",
  INSTAGRAM: "instagram",
  TIKTOK: "tiktok",
  YOUTUBE: "youtube",
  LINKEDIN: "linkedin",
};

/**
 * Fallback optimization strategies (used when AI is unavailable)
 */
const FALLBACK_STRATEGIES: Record<string, string[]> = {
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
 * @class OptimizeContentUseCase
 * @description Takes content and optimization goals, delegates to AI providers for
 *              real optimization suggestions. Falls back to heuristic strategies if AI fails.
 */
export class OptimizeContentUseCase implements UseCase<
  OptimizeContentInput,
  OptimizeContentOutput,
  UseCaseError
> {
  constructor(private readonly aiService: AIService) {}

  /**
   * @method execute
   * @description Optimizes content for a given platform and goal.
   * @param input - Content, provider, goal, and options
   * @returns Optimized content with recommendations
   */
  async execute(input: OptimizeContentInput): Promise<Result<OptimizeContentOutput, UseCaseError>> {
    if (!input.content || input.content.trim().length === 0) {
      return err(new UseCaseError("Content cannot be empty", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const platformLimit = PLATFORM_LIMITS[input.provider];
    let optimizedContent = input.content.trim();
    const recommendations: string[] = [];

    // Truncate if exceeding platform limit
    if (optimizedContent.length > platformLimit) {
      optimizedContent = this.truncateContent(optimizedContent, platformLimit);
      recommendations.push(
        `Content was truncated to fit ${input.provider} character limit of ${platformLimit}`
      );
    }

    const platform = PROVIDER_TO_PLATFORM[input.provider];

    // Attempt AI-powered optimization
    const aiResult = await this.tryAIOptimization(optimizedContent, platform, input);
    if (aiResult) {
      return ok(aiResult);
    }

    // Fallback to heuristic optimization
    return ok(this.heuristicOptimization(input, optimizedContent, recommendations));
  }

  /**
   * Attempt AI-powered content optimization via external providers
   */
  private async tryAIOptimization(
    content: string,
    platform: string,
    input: OptimizeContentInput
  ): Promise<OptimizeContentOutput | null> {
    try {
      const result = await this.aiService.optimizeContent(content, platform);

      if (!result || !result.optimization) {
        return null;
      }

      const optimization = result.optimization as Record<string, unknown>;
      const recommendations: string[] = [];

      // Extract recommendations from AI changes
      if (Array.isArray(optimization["changes"])) {
        for (const change of optimization["changes"] as Array<Record<string, unknown>>) {
          if (typeof change["reason"] === "string") {
            recommendations.push(change["reason"]);
          }
        }
      }

      // Add hashtag suggestions from AI
      const hashtags = optimization["hashtags"];
      if (Array.isArray(hashtags) && hashtags.length > 0) {
        recommendations.push(`Suggested hashtags: ${(hashtags as string[]).join(", ")}`);
      }

      const rawOptText = optimization["optimizedText"];
      const optimizedText =
        typeof rawOptText === "string" && rawOptText.length > 0 ? rawOptText : content;

      // Generate variations via AI if requested
      let variations: ContentVariation[] | undefined;
      if (input.generateVariations) {
        variations = await this.tryAIVariations(content, input.variationCount ?? 3);
      }

      // Get tone analysis via AI if requested
      let toneAnalysis: { currentTone: string; suggestedTones: string[] } | undefined;
      if (input.includeToneAnalysis) {
        toneAnalysis = await this.tryAIToneAnalysis(content);
      }

      const output: OptimizeContentOutput = {
        originalContent: input.content,
        optimizedContent: optimizedText,
        optimizationGoal: input.optimizationGoal,
        recommendations,
        predictedImprovement: this.estimateImprovement(content, optimizedText),
        ...(variations && { variations }),
        ...(toneAnalysis && { toneAnalysis }),
      };

      return output;
    } catch {
      // AI unavailable — fall through to heuristic
      return null;
    }
  }

  /**
   * Generate content variations via AI
   */
  private async tryAIVariations(
    content: string,
    count: number
  ): Promise<ContentVariation[] | undefined> {
    try {
      const result = await this.aiService.generateVariations(content, "tone", count);
      if (!result || !Array.isArray(result.variations)) {
        return undefined;
      }

      return result.variations.map((text: string) => ({
        content: text,
        changes: ["AI-generated variation"],
        expectedImprovement: 15,
      }));
    } catch {
      return undefined;
    }
  }

  /**
   * Get tone analysis via AI
   */
  private async tryAIToneAnalysis(
    content: string
  ): Promise<{ currentTone: string; suggestedTones: string[] } | undefined> {
    try {
      const result = await this.aiService.analyzeContent(content, "tone");
      if (!result || !result.analysis) {
        return undefined;
      }

      const analysis = result.analysis as Record<string, unknown>;
      const tone = analysis["tone"] as Record<string, unknown> | undefined;
      return {
        currentTone: typeof tone?.["detected"] === "string" ? tone["detected"] : "neutral",
        suggestedTones: Array.isArray(tone?.["suggestions"])
          ? (tone["suggestions"] as string[])
          : [],
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Estimate improvement percentage by comparing original vs optimized content
   */
  private estimateImprovement(original: string, optimized: string): number {
    if (original === optimized) return 0;

    let improvement = 15; // Base improvement for any AI optimization

    const originalHashtags = (original.match(/#/g) ?? []).length;
    const optimizedHashtags = (optimized.match(/#/g) ?? []).length;
    if (optimizedHashtags > originalHashtags) {
      improvement += 5;
    }

    const hasEmoji = /[\u{1F300}-\u{1F9FF}]/u.test(optimized);
    if (hasEmoji) {
      improvement += 3;
    }

    const hasCTA = /\?|click|learn|discover|try|get|join/i.test(optimized);
    if (hasCTA) {
      improvement += 7;
    }

    return Math.min(improvement, 50);
  }

  /**
   * Deterministic heuristic fallback when AI providers are unavailable
   */
  private heuristicOptimization(
    input: OptimizeContentInput,
    optimizedContent: string,
    recommendations: string[]
  ): OptimizeContentOutput {
    const strategies = FALLBACK_STRATEGIES[input.optimizationGoal] ?? [];
    recommendations.push(...strategies.slice(0, 3));

    if (!optimizedContent.includes("#")) {
      recommendations.push("Consider adding relevant hashtags to increase discoverability");
    }

    const predictedImprovement = this.estimateImprovement(input.content, optimizedContent);

    let variations: ContentVariation[] | undefined;
    if (input.generateVariations) {
      const count = input.variationCount ?? 3;
      variations = this.generateHeuristicVariations(
        optimizedContent,
        count,
        input.optimizationGoal
      );
    }

    return {
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
  }

  private truncateContent(content: string, limit: number): string {
    if (content.length <= limit) return content;

    const truncated = content.substring(0, limit - 3);
    const lastSpace = truncated.lastIndexOf(" ");

    if (lastSpace > limit * 0.8) {
      return truncated.substring(0, lastSpace) + "...";
    }

    return truncated + "...";
  }

  private generateHeuristicVariations(
    content: string,
    count: number,
    goal: string
  ): ContentVariation[] {
    const GOAL_BASE_IMPROVEMENT: Record<string, number> = {
      engagement: 15,
      reach: 20,
      clicks: 12,
      conversions: 18,
    };

    const strategies = FALLBACK_STRATEGIES[goal] ?? [];
    const baseImprovement = GOAL_BASE_IMPROVEMENT[goal] ?? 15;
    const variations: ContentVariation[] = [];

    for (let i = 0; i < count; i++) {
      const strategy = strategies[i % strategies.length];
      const offset = i % 2 === 0 ? -(i * 2) : i * 2 - 1;
      const expectedImprovement = Math.max(5, Math.min(50, baseImprovement + offset));
      variations.push({
        content: this.applyStrategy(content, strategy ?? ""),
        changes: [strategy ?? `Variation ${i + 1}`],
        expectedImprovement,
      });
    }

    return variations;
  }

  private applyStrategy(content: string, strategy: string): string {
    if (strategy.includes("question")) return content + " What do you think?";
    if (strategy.includes("hashtags")) return content + " #trending #viral";
    if (strategy.includes("emoji")) return "✨ " + content + " 🚀";
    if (strategy.includes("CTA") || strategy.includes("action")) return content + " Learn more →";
    return content + ` [${strategy}]`;
  }

  private detectTone(content: string): string {
    const lowerContent = content.toLowerCase();
    if (/urgent|now|limited|hurry|fast/i.test(lowerContent)) return "urgent";
    if (/amazing|incredible|awesome|love/i.test(lowerContent)) return "enthusiastic";
    if (/learn|understand|discover|how to/i.test(lowerContent)) return "educational";
    if (/please|thank|appreciate|grateful/i.test(lowerContent)) return "appreciative";
    return "neutral";
  }

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
