/**
 * Phase 3A Week 5: Conflict Resolver — Local Types
 *
 * Internal interfaces used by ConflictResolver and its sub-modules.
 */

import type {
  OrchestrationConflict,
  ConflictResolutionStrategy,
  PublishResult,
} from "@shared/orchestration";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../providers/providerAdapter.interface";

export interface ConflictContext {
  planId: string;
  postId: string;
  providerId: ProviderId;
  attemptNumber: number;
  globalStrategy: ConflictResolutionStrategy;
  previousResults: Record<ProviderId, PublishResult>;
}

export interface ConflictDetectionRule {
  type: "error_code" | "content_validation" | "rate_limit" | "timing" | "dependency" | "custom";
  pattern: string | RegExp;
  condition?: (context: ConflictContext, data: any) => boolean;
  weight: number; // 0-1, confidence score
}

export interface ConflictResolutionRule {
  strategy: "retry" | "adapt_content" | "reschedule" | "skip" | "fallback_provider" | "custom";
  parameters: Record<string, any>;
  condition?: (conflict: OrchestrationConflict, context: ConflictContext) => boolean;
  maxAttempts?: number;
  cooldownMs?: number;
}

export interface ConflictPattern {
  id: string;
  name: string;
  description: string;
  detectionRules: ConflictDetectionRule[];
  resolutionStrategies: ConflictResolutionRule[];
  priority: number;
  enabled: boolean;
}

export interface ResolutionResult {
  action: "resolved" | "escalated" | "failed";
  strategy: string;
  modifiedContent?: CanonicalPost;
  newScheduleTime?: Date;
  fallbackProvider?: ProviderId;
  nextAttemptIn?: number; // milliseconds
  metadata?: Record<string, any>;
}
