/**
 * Application Layer - ML Use Cases Types
 *
 * Part of Sprint 9: TDD Implementation
 * Type definitions for ML use cases.
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
}

// ============ PredictAudience Types ============

export interface ContentDescription {
  type: string;
  topic: string;
  tone: string;
  provider: MLProvider;
}

export interface PredictAudienceInput {
  accountId: string;
  contentDescription: ContentDescription;
  targetSegments?: string[];
  includeOptimizationSuggestions?: boolean;
}

export interface SegmentPrediction {
  segmentName: string;
  engagementScore: number;
  reachPotential: number;
  sentiment: "positive" | "neutral" | "negative";
}

export interface RiskFactor {
  type: string;
  severity: "low" | "medium" | "high";
  description: string;
  mitigation: string;
}

export interface OptimizationSuggestion {
  area: string;
  suggestion: string;
  expectedImpact: number;
}

export interface PredictAudienceOutput {
  overallEngagementScore: number;
  predictions: {
    likes: number;
    comments: number;
    shares: number;
    reach: number;
  };
  segmentPredictions?: SegmentPrediction[];
  riskFactors: RiskFactor[];
  optimizationSuggestions?: OptimizationSuggestion[];
}
