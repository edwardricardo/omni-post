/**
 * @file PredictOptimalTimingUseCase.ts
 * @description Predicts optimal posting times using AI analysis of historical engagement data.
 *              Falls back to industry-standard peak hours when data or AI is unavailable.
 * @layer application
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
import type { AIService } from "../../ai/aiService.js";
import type { AnalyticsReadRepositoryPort } from "../../domain/repositories/AnalyticsReadRepository.js";

const VALID_PROVIDERS: MLProvider[] = [
  "X",
  "FACEBOOK",
  "INSTAGRAM",
  "TIKTOK",
  "YOUTUBE",
  "LINKEDIN",
];

/**
 * Industry-standard peak hours (fallback when no historical data available)
 */
const INDUSTRY_DEFAULT_PEAK_HOURS: Record<MLProvider, number[]> = {
  X: [8, 9, 12, 17, 18, 21],
  FACEBOOK: [9, 13, 16, 19, 20],
  INSTAGRAM: [8, 11, 14, 17, 19, 21],
  TIKTOK: [7, 12, 15, 19, 21, 22],
  YOUTUBE: [12, 14, 16, 20, 21],
  LINKEDIN: [7, 8, 10, 12, 17, 18],
};

const INDUSTRY_DEFAULT_BEST_DAYS: Record<MLProvider, number[]> = {
  X: [1, 2, 3, 4],
  FACEBOOK: [3, 4, 5],
  INSTAGRAM: [1, 2, 3],
  TIKTOK: [2, 4, 5, 6],
  YOUTUBE: [4, 5, 6],
  LINKEDIN: [1, 2, 3, 4],
};

const CONTENT_TYPE_MODIFIERS: Record<ContentType, { hourOffset: number; scoreBonus: number }> = {
  text: { hourOffset: 0, scoreBonus: 0 },
  image: { hourOffset: 0, scoreBonus: 5 },
  video: { hourOffset: 1, scoreBonus: 10 },
  carousel: { hourOffset: 0, scoreBonus: 8 },
  story: { hourOffset: -2, scoreBonus: 3 },
  reel: { hourOffset: 1, scoreBonus: 15 },
};

/** Maps MLProvider to platform name for AI prompts */
const PROVIDER_TO_PLATFORM: Record<MLProvider, string> = {
  X: "Twitter/X",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  LINKEDIN: "LinkedIn",
};

/** Minimum number of analytics records to consider data sufficient */
const MIN_ANALYTICS_RECORDS = 10;

/**
 * @class PredictOptimalTimingUseCase
 * @description Analyzes historical engagement data and uses AI to recommend optimal posting times.
 *              Falls back to industry defaults when no historical data or AI is unavailable.
 */
export class PredictOptimalTimingUseCase
  implements UseCase<PredictTimingInput, PredictTimingOutput, UseCaseError>
{
  constructor(
    private readonly aiService?: AIService,
    private readonly analyticsRepo?: AnalyticsReadRepositoryPort
  ) {}

  /**
   * @method execute
   * @description Predicts optimal posting times for the given platform and content type.
   * @param input - Account, provider, content type, timezone, and options
   * @returns Ranked time slots with scores and recommendations
   */
  async execute(input: PredictTimingInput): Promise<Result<PredictTimingOutput, UseCaseError>> {
    if (!VALID_PROVIDERS.includes(input.provider as MLProvider)) {
      return err(
        new UseCaseError(
          `Invalid provider: ${input.provider}. Valid providers: ${VALID_PROVIDERS.join(", ")}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    const contentModifier = CONTENT_TYPE_MODIFIERS[input.contentType] ?? {
      hourOffset: 0,
      scoreBonus: 0,
    };

    // Try AI-powered analysis with historical data
    const aiResult = await this.tryAIPoweredAnalysis(input, contentModifier);
    if (aiResult) {
      return ok(aiResult);
    }

    // Fallback to industry defaults
    return ok(this.heuristicPrediction(input, contentModifier));
  }

  /**
   * Attempt AI-powered timing prediction using historical engagement data
   */
  private async tryAIPoweredAnalysis(
    input: PredictTimingInput,
    contentModifier: { hourOffset: number; scoreBonus: number }
  ): Promise<PredictTimingOutput | null> {
    if (!this.aiService || !this.analyticsRepo) {
      return null;
    }

    try {
      // Fetch historical analytics for the account (last 8 weeks)
      const eightWeeksAgo = new Date();
      eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);

      const analytics = await this.analyticsRepo.getTimeSeriesData(
        [], // empty postIds = all posts
        "hour",
        {
          startDate: eightWeeksAgo,
          provider: input.provider,
        }
      );

      if (!analytics || analytics.length < MIN_ANALYTICS_RECORDS) {
        return null; // Not enough data — fall through to heuristic
      }

      // Build engagement summary by hour and day
      const engagementByHour = this.aggregateEngagementByHour(analytics);
      const platform = PROVIDER_TO_PLATFORM[input.provider];

      // Ask AI to analyze the patterns and recommend slots
      const prompt = this.buildTimingPrompt(engagementByHour, platform, input.contentType);
      const aiResult = await this.aiService.generateContent(
        [
          { role: "system", content: "You are a social media analytics expert." },
          { role: "user", content: prompt },
        ],
        { temperature: 0.3, maxTokens: 500 }
      );

      if (!aiResult || !aiResult.content) {
        return null;
      }

      // Parse AI recommendations and combine with data-driven slots
      const dataSlots = this.generateDataDrivenSlots(engagementByHour, contentModifier);
      const aiRecommendations = this.parseAIRecommendations(aiResult.content);

      const activityPatterns = input.includeActivityPatterns
        ? this.generateDataDrivenPatterns(engagementByHour)
        : undefined;

      return {
        optimalSlots: dataSlots,
        provider: input.provider,
        timezone: input.timezone,
        recommendations: [
          ...aiRecommendations,
          `Based on ${analytics.length} historical data points from the last 8 weeks.`,
        ],
        ...(activityPatterns && { activityPatterns }),
      };
    } catch {
      return null; // AI or data error — fall through to heuristic
    }
  }

  /**
   * Aggregate engagement metrics by hour of day
   */
  private aggregateEngagementByHour(
    timeSeries: Array<{ period: string; totalEngagement: number; recordCount: number }>
  ): Map<number, { totalEngagement: number; count: number }> {
    const byHour = new Map<number, { totalEngagement: number; count: number }>();

    for (const row of timeSeries) {
      const date = new Date(row.period);
      const hour = date.getUTCHours();
      const existing = byHour.get(hour) ?? { totalEngagement: 0, count: 0 };
      existing.totalEngagement += row.totalEngagement;
      existing.count += row.recordCount;
      byHour.set(hour, existing);
    }

    return byHour;
  }

  /**
   * Build a prompt for AI timing analysis
   */
  private buildTimingPrompt(
    engagementByHour: Map<number, { totalEngagement: number; count: number }>,
    platform: string,
    contentType: ContentType
  ): string {
    const hourData: string[] = [];
    for (const [hour, data] of engagementByHour) {
      const avgEngagement = data.count > 0 ? Math.round(data.totalEngagement / data.count) : 0;
      hourData.push(`${hour}:00 — avg engagement: ${avgEngagement} (${data.count} posts)`);
    }

    return [
      `Given this historical engagement data by hour for ${platform} (${contentType} content):`,
      "",
      ...hourData,
      "",
      "Recommend the 3 best time slots with brief justification for each.",
      "Focus on actionable insights, not generic advice.",
    ].join("\n");
  }

  /**
   * Generate time slots ranked by actual historical engagement
   */
  private generateDataDrivenSlots(
    engagementByHour: Map<number, { totalEngagement: number; count: number }>,
    contentModifier: { hourOffset: number; scoreBonus: number }
  ): OptimalTimeSlot[] {
    const slots: OptimalTimeSlot[] = [];
    const maxEngagement = Math.max(
      ...Array.from(engagementByHour.values()).map((v) =>
        v.count > 0 ? v.totalEngagement / v.count : 0
      ),
      1
    );

    for (const [hour, data] of engagementByHour) {
      const avgEngagement = data.count > 0 ? data.totalEngagement / data.count : 0;
      const normalizedScore = Math.round((avgEngagement / maxEngagement) * 80);
      const score = Math.min(100, normalizedScore + contentModifier.scoreBonus);
      const adjustedHour = Math.max(0, Math.min(23, hour + contentModifier.hourOffset));

      // Generate slots for weekdays (most common posting days)
      for (const day of [1, 2, 3, 4, 5]) {
        slots.push({
          dayOfWeek: day,
          hour: adjustedHour,
          score,
          audienceReach: Math.round(normalizedScore * 0.8),
          competitionLevel: this.getCompetitionLevel(hour),
        });
      }
    }

    return slots.sort((a, b) => b.score - a.score).slice(0, 10);
  }

  /**
   * Parse AI response into recommendation strings
   */
  private parseAIRecommendations(aiContent: string): string[] {
    const lines = aiContent.split("\n").filter((line) => line.trim().length > 0);
    return lines.slice(0, 5); // Take up to 5 recommendation lines
  }

  /**
   * Generate activity patterns from historical data
   */
  private generateDataDrivenPatterns(
    engagementByHour: Map<number, { totalEngagement: number; count: number }>
  ): ActivityPattern[] {
    const patterns: ActivityPattern[] = [];
    const maxEngagement = Math.max(
      ...Array.from(engagementByHour.values()).map((v) =>
        v.count > 0 ? v.totalEngagement / v.count : 0
      ),
      1
    );

    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const data = engagementByHour.get(hour);
        const avgEngagement = data && data.count > 0 ? data.totalEngagement / data.count : 0;
        const activityLevel = Math.round((avgEngagement / maxEngagement) * 100);

        patterns.push({
          hour,
          dayOfWeek: day,
          activityLevel: Math.min(100, activityLevel),
          audiencePercentage: activityLevel * 0.8,
        });
      }
    }

    return patterns;
  }

  /**
   * Deterministic heuristic fallback using industry-standard peak hours
   */
  private heuristicPrediction(
    input: PredictTimingInput,
    contentModifier: { hourOffset: number; scoreBonus: number }
  ): PredictTimingOutput {
    const peakHours = INDUSTRY_DEFAULT_PEAK_HOURS[input.provider];
    const bestDays = INDUSTRY_DEFAULT_BEST_DAYS[input.provider];

    const optimalSlots = this.generateHeuristicSlots(
      peakHours,
      bestDays,
      contentModifier,
      input.provider
    );

    const activityPatterns = input.includeActivityPatterns
      ? this.generateHeuristicPatterns(peakHours, bestDays)
      : undefined;

    const recommendations = this.generateHeuristicRecommendations(
      input.provider,
      input.contentType,
      optimalSlots
    );

    return {
      optimalSlots,
      provider: input.provider,
      timezone: input.timezone,
      recommendations,
      ...(activityPatterns && { activityPatterns }),
    };
  }

  private generateHeuristicSlots(
    peakHours: number[],
    bestDays: number[],
    contentModifier: { hourOffset: number; scoreBonus: number },
    _provider: MLProvider
  ): OptimalTimeSlot[] {
    const slots: OptimalTimeSlot[] = [];
    const peakCount = peakHours.length;

    for (const day of bestDays) {
      for (let peakIdx = 0; peakIdx < peakHours.length; peakIdx++) {
        const hour = peakHours[peakIdx] as number;
        const adjustedHour = Math.max(0, Math.min(23, hour + contentModifier.hourOffset));
        const scoreStep = peakCount > 1 ? Math.round(18 / (peakCount - 1)) : 0;
        const baseScore = 88 - peakIdx * scoreStep;
        const score = Math.min(100, baseScore + contentModifier.scoreBonus);
        const reachStep = peakCount > 1 ? Math.round(30 / (peakCount - 1)) : 0;
        const audienceReach = 65 - peakIdx * reachStep;

        slots.push({
          dayOfWeek: day,
          hour: adjustedHour,
          score,
          audienceReach,
          competitionLevel: this.getCompetitionLevel(hour),
        });
      }
    }

    return slots.sort((a, b) => b.score - a.score).slice(0, 10);
  }

  private getCompetitionLevel(hour: number): "low" | "medium" | "high" {
    if (hour >= 17 && hour <= 21) return "high";
    if (hour >= 9 && hour <= 17) return "medium";
    return "low";
  }

  private generateHeuristicPatterns(peakHours: number[], bestDays: number[]): ActivityPattern[] {
    const patterns: ActivityPattern[] = [];

    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const isDayBest = bestDays.includes(day);
        const isHourPeak = peakHours.includes(hour);

        let activityLevel = 20;
        if (isDayBest) activityLevel += 30;
        if (isHourPeak) activityLevel += 40;
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

  private generateHeuristicRecommendations(
    provider: MLProvider,
    contentType: ContentType,
    slots: OptimalTimeSlot[]
  ): string[] {
    const recommendations: string[] = [];
    const topSlot = slots[0];

    if (topSlot) {
      const dayName = this.getDayName(topSlot.dayOfWeek);
      recommendations.push(
        `Best posting time for ${provider}: ${dayName} at ${topSlot.hour}:00 (${topSlot.score}% engagement score)`
      );
    }

    if (contentType === "video" || contentType === "reel") {
      recommendations.push(
        "Video content performs better during evening hours when users have more time to watch"
      );
    }

    const lowCompSlots = slots.filter((s) => s.competitionLevel === "low");
    if (lowCompSlots.length > 0) {
      recommendations.push(
        "Consider posting during low-competition hours for better organic reach"
      );
    }

    recommendations.push("Maintain consistent posting schedule to build audience expectations");

    return recommendations;
  }

  private getDayName(dayOfWeek: number): string {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return days[dayOfWeek] ?? "Unknown";
  }
}
