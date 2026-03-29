/**
 * Platform Content Adapter — Type Definitions
 *
 * Shared interfaces and types for the PlatformContentAdapter system.
 */

import type { AdaptationRule, OrchestrationError, PlatformAdaptation } from "@shared/orchestration";
import type { CanonicalPost } from "@shared/types";
import type {
  ProviderId,
  ProviderLimits,
  ProviderCapabilities,
} from "../providers/providerAdapter.interface";

export interface AdaptationStrategy {
  id: string;
  name: string;
  description: string;
  providerId: ProviderId;
  rules: AdaptationRule[];
  priority: number;
  enabled: boolean;
  conditions: AdaptationCondition[];
}

export interface AdaptationCondition {
  field: string;
  operator: "gt" | "lt" | "eq" | "contains" | "matches" | "exists";
  value: unknown;
  weight: number;
}

export interface ContentTransformer {
  id: string;
  name: string;
  type: "text" | "media" | "metadata" | "structure";
  transform: (content: unknown, parameters: Record<string, unknown>) => Promise<unknown>;
  validate: (input: unknown) => boolean;
  reversible: boolean;
}

export interface AdaptationContext {
  originalContent: CanonicalPost;
  targetProvider: ProviderId;
  adaptationGoals: AdaptationGoal[];
  constraints: ProviderLimits;
  capabilities: ProviderCapabilities;
  userPreferences?: UserAdaptationPreferences;
}

export interface AdaptationGoal {
  type:
    | "maximize_engagement"
    | "preserve_meaning"
    | "meet_limits"
    | "optimize_media"
    | "enhance_accessibility";
  priority: number;
  parameters?: Record<string, unknown>;
}

export interface UserAdaptationPreferences {
  preserveFormatting: boolean;
  allowContentTruncation: boolean;
  preferredHashtagStyle: "inline" | "grouped" | "minimal";
  mediaQualityPreference: "original" | "optimized" | "compressed";
  audienceTargeting?: string[];
}

export interface AdaptationMetrics {
  executionTime: number;
  confidenceScore: number;
  qualityScore: number;
  engagementPrediction: number;
  complianceScore: number;
  reversibilityScore: number;
}

export interface AdaptationSession {
  id: string;
  postId: string;
  targetProviders: ProviderId[];
  startedAt: Date;
  completedAt?: Date;
  status: "planning" | "executing" | "completed" | "failed";
  adaptations: Map<ProviderId, PlatformAdaptation>;
  metrics: AdaptationMetrics;
  warnings: string[];
  errors: OrchestrationError[];
}
