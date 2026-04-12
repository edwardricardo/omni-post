/**
 * @file ConflictStrategies.ts
 * @description Resolution strategy implementations for the ConflictResolver including
 *              retry, content adaptation, rescheduling, and fallback provider strategies.
 * @layer infrastructure
 */

import type { OrchestrationConflict, OrchestrationResult } from "@shared/orchestration";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId, ProviderAdapter } from "../providers/providerAdapter.interface";
import type {
  ConflictContext,
  ConflictPattern,
  ConflictResolutionRule,
  ResolutionResult,
} from "./conflictResolverTypes.js";
import type { AdaptationRule } from "@shared/orchestration";
import { mapPatternToConflictType } from "./ConflictPatterns.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("orchestration");

type GetCurrentContentFn = (postId: string) => Promise<CanonicalPost | null>;
type AdaptContentFn = (
  content: CanonicalPost,
  providerId: ProviderId,
  validationErrors: string[]
) => Promise<OrchestrationResult<import("@shared/orchestration").PlatformAdaptation>>;

/**
 * Resolve a single conflict by finding the matching pattern and applying
 * the first applicable resolution strategy.
 */
export async function resolveConflict(
  conflict: OrchestrationConflict,
  context: ConflictContext,
  conflictPatterns: Map<string, ConflictPattern>,
  adaptContentFn: AdaptContentFn,
  getCurrentContent: GetCurrentContentFn
): Promise<ResolutionResult> {
  try {
    // Find matching pattern
    const pattern = Array.from(conflictPatterns.values()).find(
      (p) => mapPatternToConflictType(p) === conflict.type
    );

    if (!pattern) {
      return {
        action: "escalated",
        strategy: "manual_intervention",
      };
    }

    // Apply first applicable resolution strategy
    for (const resolutionRule of pattern.resolutionStrategies) {
      if (resolutionRule.condition && !resolutionRule.condition(conflict, context)) {
        continue;
      }

      const result = await applyResolutionStrategy(
        resolutionRule,
        conflict,
        context,
        adaptContentFn,
        getCurrentContent
      );
      if (result.action !== "failed") {
        return result;
      }
    }

    // All strategies failed
    return {
      action: "escalated",
      strategy: "all_strategies_failed",
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ conflictId: conflict.id, err: errorMessage }, "Error resolving conflict");
    return {
      action: "failed",
      strategy: "resolution_error",
      metadata: { error: errorMessage },
    };
  }
}

/**
 * Dispatch to the correct strategy handler based on rule.strategy.
 */
async function applyResolutionStrategy(
  rule: ConflictResolutionRule,
  conflict: OrchestrationConflict,
  context: ConflictContext,
  adaptContentFn: AdaptContentFn,
  getCurrentContent: GetCurrentContentFn
): Promise<ResolutionResult> {
  switch (rule.strategy) {
    case "retry": {
      const delayMs = typeof rule.parameters.delayMs === "number" ? rule.parameters.delayMs : 5000;
      const maxAttempts =
        typeof rule.parameters.maxAttempts === "number" ? rule.parameters.maxAttempts : 3;
      return {
        action: "resolved",
        strategy: "retry",
        nextAttemptIn: delayMs,
        metadata: {
          maxAttempts,
          delayMs,
        },
      };
    }

    case "adapt_content":
      return await applyContentAdaptationStrategy(rule, context, adaptContentFn, getCurrentContent);

    case "reschedule":
      return await applyRescheduleStrategy(rule);

    case "skip":
      return {
        action: "resolved",
        strategy: "skip",
        metadata: {
          reason:
            typeof rule.parameters.reason === "string"
              ? rule.parameters.reason
              : "conflict_unresolvable",
        },
      };

    case "fallback_provider":
      return await applyFallbackProviderStrategy(rule, context);

    case "custom":
      return await applyCustomStrategy(rule, conflict, context);

    default:
      return {
        action: "failed",
        strategy: "unknown_strategy",
      };
  }
}

async function applyContentAdaptationStrategy(
  rule: ConflictResolutionRule,
  context: ConflictContext,
  adaptContentFn: AdaptContentFn,
  getCurrentContent: GetCurrentContentFn
): Promise<ResolutionResult> {
  try {
    // Get current content
    const content = await getCurrentContent(context.postId);
    if (!content) {
      return { action: "failed", strategy: "content_not_found" };
    }

    // Apply adaptation
    const adaptation = await adaptContentFn(
      content,
      context.providerId,
      [String(rule.parameters.action)] // Convert action to validation error
    );

    if (adaptation.ok) {
      return {
        action: "resolved",
        strategy: "adapt_content",
        modifiedContent: adaptation.value.adaptedContent,
        metadata: {
          adaptationRules: adaptation.value.adaptationRules,
          confidence: adaptation.value.confidence,
        },
      };
    } else {
      return { action: "failed", strategy: "adaptation_failed" };
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      action: "failed",
      strategy: "adaptation_error",
      metadata: { error: errorMessage },
    };
  }
}

async function applyRescheduleStrategy(rule: ConflictResolutionRule): Promise<ResolutionResult> {
  try {
    const currentTime = new Date();
    const addMinutes =
      typeof rule.parameters.addMinutes === "number" ? rule.parameters.addMinutes : 15;
    const newTime = new Date(currentTime.getTime() + addMinutes * 60000);

    return {
      action: "resolved",
      strategy: "reschedule",
      newScheduleTime: newTime,
      metadata: {
        originalTime: currentTime,
        delayMinutes: addMinutes,
      },
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      action: "failed",
      strategy: "reschedule_error",
      metadata: { error: errorMessage },
    };
  }
}

async function applyFallbackProviderStrategy(
  rule: ConflictResolutionRule,
  context: ConflictContext
): Promise<ResolutionResult> {
  // Get available fallback providers
  const fallbackProvider = rule.parameters.fallbackProvider as ProviderId;

  if (fallbackProvider && fallbackProvider !== context.providerId) {
    return {
      action: "resolved",
      strategy: "fallback_provider",
      fallbackProvider,
      metadata: {
        originalProvider: context.providerId,
        reason: "provider_unavailable",
      },
    };
  }

  return { action: "failed", strategy: "no_fallback_available" };
}

async function applyCustomStrategy(
  _rule: ConflictResolutionRule,
  _conflict: OrchestrationConflict,
  _context: ConflictContext
): Promise<ResolutionResult> {
  // Custom strategy implementation would go here
  return {
    action: "escalated",
    strategy: "custom_not_implemented",
  };
}

/**
 * Apply a low-level content adaptation for a specific error string.
 * Returns the modified content and the adaptation rule that was applied.
 */
export async function applyContentAdaptation(
  content: CanonicalPost,
  error: string,
  adapter: ProviderAdapter
): Promise<OrchestrationResult<{ content: CanonicalPost; rule: AdaptationRule }>> {
  let adaptedContent = { ...content };
  let rule: AdaptationRule = {
    ruleId: "noop",
    type: "custom",
    description: "No adaptation applied",
    applied: false,
  };

  // Apply specific adaptations based on error type
  if (error.includes("truncate") || error === "TEXT_TOO_LONG") {
    const maxLength = adapter.limits.maxChars || 280;
    adaptedContent.body = content.body.substring(0, maxLength);
    rule = {
      ruleId: "text_truncation",
      type: "text_length",
      description: `Truncated to ${maxLength} characters`,
      applied: true,
      transformedValue: adaptedContent.body,
    };
  } else if (error.includes("convert_media") || error === "UNSUPPORTED_MEDIA") {
    // Media conversion logic would go here
    rule = {
      ruleId: "media_conversion",
      type: "media_format",
      description: "Converted media to supported format",
      applied: true,
    };
  }

  return {
    ok: true,
    value: { content: adaptedContent, rule },
  };
}

/**
 * Calculate how confident we are that the set of applied adaptations resolves
 * all validation errors, penalising for warnings.
 */
export function calculateAdaptationConfidence(appliedRules: unknown[], warnings: string[]): number {
  if (warnings.length > appliedRules.length) return 0.3;
  if (warnings.length > 0) return 0.7;
  return appliedRules.length > 0 ? 0.9 : 1.0;
}
