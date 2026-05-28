/**
 * @file types.ts
 * @description Type definitions for ML use cases including MLProvider, OptimizationGoal, and input/output DTOs for content optimization and timing prediction.
 * @layer application
 */

/**
 * Supported social media providers
 */
export type MLProvider = "X" | "FACEBOOK" | "INSTAGRAM" | "TIKTOK" | "YOUTUBE" | "LINKEDIN";

/**
 * Content types
 */
export type ContentType = "text" | "image" | "video" | "carousel" | "story" | "reel";

/**
 * Optimization goals
 */
export type OptimizationGoal = "engagement" | "reach" | "clicks" | "conversions";

// ============ OptimizeContent Types ============

export interface OptimizeContentInput {
  content: string;
  provider: MLProvider;
  optimizationGoal: OptimizationGoal;
  generateVariations?: boolean;
  variationCount?: number;
  includeToneAnalysis?: boolean;
}

export interface ContentVariation {
  content: string;
  changes: string[];
  expectedImprovement: number;
}

export interface OptimizeContentOutput {
  originalContent: string;
  optimizedContent: string;
  optimizationGoal: OptimizationGoal;
  recommendations: string[];
  predictedImprovement: number;
  variations?: ContentVariation[];
  toneAnalysis?: {
    currentTone: string;
    suggestedTones: string[];
  };
}

// ============ PredictTiming Types ============

export interface PredictTimingInput {
  accountId: string;
  provider: MLProvider;
  contentType: ContentType;
  timezone: string;
  includeActivityPatterns?: boolean;
  targetAudience?: string;
}

export interface OptimalTimeSlot {
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  hour: number; // 0-23
  score: number; // 0-100
  audienceReach: number; // percentage
  competitionLevel: "low" | "medium" | "high";
}

export interface ActivityPattern {
  hour: number;
  dayOfWeek: number;
  activityLevel: number;
  audiencePercentage: number;
}

export interface PredictTimingOutput {
  optimalSlots: OptimalTimeSlot[];
  provider: MLProvider;
  timezone: string;
  activityPatterns?: ActivityPattern[];
  recommendations: string[];
  /**
   * true when output is based on industry heuristics (< 14 days of account data).
   * false when derived from real historical analytics.
   */
  isEstimated: boolean;
  /** Number of analytics data points used to generate these recommendations */
  sampleSize: number;
}
