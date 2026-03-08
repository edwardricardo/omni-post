/**
 * Application Layer - Predict Optimal Timing Use Case
 *
 * Part of Sprint 9: TDD Implementation
 * Predicts optimal posting times for social media content.
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type {
  PredictTimingInput,
  PredictTimingOutput,
  OptimalTimeSlot,
  ActivityPattern,
  MLProvider,
  ContentType,
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
 * Platform-specific peak hours (simplified model)
 */
const PLATFORM_PEAK_HOURS: Record<MLProvider, number[]> = {
  X: [8, 9, 12, 17, 18, 21],
  FACEBOOK: [9, 13, 16, 19, 20],
  INSTAGRAM: [8, 11, 14, 17, 19, 21],
  TIKTOK: [7, 12, 15, 19, 21, 22],
  YOUTUBE: [12, 14, 16, 20, 21],
  LINKEDIN: [7, 8, 10, 12, 17, 18],
};

/**
 * Best days by platform (0 = Sunday, 6 = Saturday)
 */
const PLATFORM_BEST_DAYS: Record<MLProvider, number[]> = {
  X: [1, 2, 3, 4], // Mon-Thu
  FACEBOOK: [3, 4, 5], // Wed-Fri
  INSTAGRAM: [1, 2, 3], // Mon-Wed
  TIKTOK: [2, 4, 5, 6], // Tue, Thu-Sat
  YOUTUBE: [4, 5, 6], // Thu-Sat
  LINKEDIN: [1, 2, 3, 4], // Mon-Thu
};

/**
 * Content type modifiers
 */
const CONTENT_TYPE_MODIFIERS: Record<ContentType, { hourOffset: number; scoreBonus: number }> = {
  text: { hourOffset: 0, scoreBonus: 0 },
  image: { hourOffset: 0, scoreBonus: 5 },
  video: { hourOffset: 1, scoreBonus: 10 },
  carousel: { hourOffset: 0, scoreBonus: 8 },
  story: { hourOffset: -2, scoreBonus: 3 },
  reel: { hourOffset: 1, scoreBonus: 15 },
};

/**
 * Predict Optimal Timing Use Case
 *
 * Analyzes audience activity patterns and platform-specific data
 * to predict the best times to post content.
 */
export class PredictOptimalTimingUseCase
  implements UseCase<PredictTimingInput, PredictTimingOutput, UseCaseError>
{
  async execute(input: PredictTimingInput): Promise<Result<PredictTimingOutput, UseCaseError>> {
    // Validate provider
    if (!VALID_PROVIDERS.includes(input.provider as MLProvider)) {
      return err(
        new UseCaseError(
          `Invalid provider: ${input.provider}. Valid providers: ${VALID_PROVIDERS.join(", ")}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    // Get platform peak hours and best days
    const peakHours = PLATFORM_PEAK_HOURS[input.provider];
    const bestDays = PLATFORM_BEST_DAYS[input.provider];
    const contentModifier = CONTENT_TYPE_MODIFIERS[input.contentType] ?? {
      hourOffset: 0,
      scoreBonus: 0,
    };

    // Generate optimal time slots
    const optimalSlots = this.generateOptimalSlots(
      peakHours,
      bestDays,
      contentModifier,
      input.provider
    );

    // Generate activity patterns if requested
    let activityPatterns: ActivityPattern[] | undefined;
    if (input.includeActivityPatterns) {
      activityPatterns = this.generateActivityPatterns(peakHours, bestDays);
    }

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      input.provider,
      input.contentType,
      optimalSlots
    );

    const output: PredictTimingOutput = {
      optimalSlots,
      provider: input.provider,
      timezone: input.timezone,
      recommendations,
      ...(activityPatterns && { activityPatterns }),
    };

    return ok(output);
  }

  /**
   * Generate optimal time slots based on platform data
   */
  private generateOptimalSlots(
    peakHours: number[],
    bestDays: number[],
    contentModifier: { hourOffset: number; scoreBonus: number },
    provider: MLProvider
  ): OptimalTimeSlot[] {
    const slots: OptimalTimeSlot[] = [];
    const peakCount = peakHours.length;

    for (const day of bestDays) {
      for (let peakIdx = 0; peakIdx < peakHours.length; peakIdx++) {
        const hour = peakHours[peakIdx] as number;
        const adjustedHour = Math.max(0, Math.min(23, hour + contentModifier.hourOffset));

        // Deterministic base score: first peak hour scores highest (88), last scores lowest (70).
        // Step size distributes evenly across the peak hours range.
        const scoreStep = peakCount > 1 ? Math.round(18 / (peakCount - 1)) : 0;
        const baseScore = 88 - peakIdx * scoreStep;
        const score = Math.min(100, baseScore + contentModifier.scoreBonus);

        // Deterministic audience reach: first peak = 65%, last peak = 35%.
        // Linear interpolation across the peak slots.
        const reachStep = peakCount > 1 ? Math.round(30 / (peakCount - 1)) : 0;
        const audienceReach = 65 - peakIdx * reachStep;

        slots.push({
          dayOfWeek: day,
          hour: adjustedHour,
          score,
          audienceReach,
          competitionLevel: this.getCompetitionLevel(hour, provider),
        });
      }
    }

    // Sort by score descending and take top 10
    return slots.sort((a, b) => b.score - a.score).slice(0, 10);
  }

  /**
   * Determine competition level for a given hour
   */
  private getCompetitionLevel(hour: number, _provider: MLProvider): "low" | "medium" | "high" {
    // Prime time hours have high competition
    if (hour >= 17 && hour <= 21) {
      return "high";
    }
    // Business hours have medium competition
    if (hour >= 9 && hour <= 17) {
      return "medium";
    }
    // Off-peak hours have low competition
    return "low";
  }

  /**
   * Generate activity patterns for the week
   */
  private generateActivityPatterns(peakHours: number[], bestDays: number[]): ActivityPattern[] {
    const patterns: ActivityPattern[] = [];

    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const isDayBest = bestDays.includes(day);
        const isHourPeak = peakHours.includes(hour);

        let activityLevel = 20; // Base level
        if (isDayBest) activityLevel += 30;
        if (isHourPeak) activityLevel += 40;

        // No random variance — activity level is fully deterministic from day/hour flags.
        activityLevel = Math.min(100, activityLevel);

        patterns.push({
          hour,
          dayOfWeek: day,
          activityLevel,
          audiencePercentage: activityLevel * 0.8,
        });
      }
    }

    return patterns;
  }

  /**
   * Generate timing recommendations
   */
  private generateRecommendations(
    provider: MLProvider,
    contentType: ContentType,
    slots: OptimalTimeSlot[]
  ): string[] {
    const recommendations: string[] = [];

    // Top slot recommendation
    const topSlot = slots[0];
    if (topSlot) {
      const dayName = this.getDayName(topSlot.dayOfWeek);
      recommendations.push(
        `Best posting time for ${provider}: ${dayName} at ${topSlot.hour}:00 (${topSlot.score}% engagement score)`
      );
    }

    // Content-specific recommendation
    if (contentType === "video" || contentType === "reel") {
      recommendations.push(
        "Video content performs better during evening hours when users have more time to watch"
      );
    }

    // Competition recommendation
    const lowCompSlots = slots.filter((s) => s.competitionLevel === "low");
    if (lowCompSlots.length > 0) {
      recommendations.push(
        "Consider posting during low-competition hours for better organic reach"
      );
    }

    // Consistency recommendation
    recommendations.push("Maintain consistent posting schedule to build audience expectations");

    return recommendations;
  }

  /**
   * Get day name from day of week number
   */
  private getDayName(dayOfWeek: number): string {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return days[dayOfWeek] ?? "Unknown";
  }
}
