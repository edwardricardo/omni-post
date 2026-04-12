/**
 * @file ConflictPatterns.ts
 * @description Built-in conflict detection patterns and rule evaluation logic
 *              for pattern matching, severity calculation, and conflict type mapping.
 * @layer infrastructure
 */

import type { OrchestrationConflict, PublishResult } from "@shared/orchestration";
import type {
  ConflictContext,
  ConflictDetectionRule,
  ConflictPattern,
} from "./conflictResolverTypes.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("orchestration");

/**
 * Load all built-in conflict detection patterns into the provided Map.
 */
export async function loadBuiltInPatterns(
  conflictPatterns: Map<string, ConflictPattern>
): Promise<void> {
  const builtInPatterns: ConflictPattern[] = [
    {
      id: "rate_limit_exceeded",
      name: "Rate Limit Exceeded",
      description: "Provider API rate limit has been exceeded",
      detectionRules: [
        {
          type: "error_code",
          pattern: "RATE_LIMIT",
          weight: 1.0,
        },
      ],
      resolutionStrategies: [
        {
          strategy: "retry",
          parameters: { delayMs: 60000, maxAttempts: 3 }, // Wait 1 minute
        },
      ],
      priority: 1,
      enabled: true,
    },
    {
      id: "content_too_long",
      name: "Content Exceeds Length Limit",
      description: "Content exceeds provider's character limit",
      detectionRules: [
        {
          type: "content_validation",
          pattern: "TEXT_TOO_LONG",
          weight: 1.0,
        },
      ],
      resolutionStrategies: [
        {
          strategy: "adapt_content",
          parameters: { action: "truncate" },
        },
      ],
      priority: 2,
      enabled: true,
    },
    {
      id: "media_format_unsupported",
      name: "Unsupported Media Format",
      description: "Media format not supported by provider",
      detectionRules: [
        {
          type: "content_validation",
          pattern: "UNSUPPORTED_MEDIA",
          weight: 1.0,
        },
      ],
      resolutionStrategies: [
        {
          strategy: "adapt_content",
          parameters: { action: "convert_media" },
        },
      ],
      priority: 2,
      enabled: true,
    },
    {
      id: "authentication_expired",
      name: "Authentication Token Expired",
      description: "Provider authentication has expired",
      detectionRules: [
        {
          type: "error_code",
          pattern: "AUTH",
          weight: 1.0,
        },
      ],
      resolutionStrategies: [
        {
          strategy: "skip",
          parameters: { reason: "authentication_required" },
        },
      ],
      priority: 3,
      enabled: true,
    },
    {
      id: "network_timeout",
      name: "Network Timeout",
      description: "Network request to provider timed out",
      detectionRules: [
        {
          type: "error_code",
          pattern: "NETWORK",
          weight: 0.8,
        },
      ],
      resolutionStrategies: [
        {
          strategy: "retry",
          parameters: { delayMs: 5000, maxAttempts: 2 },
        },
      ],
      priority: 2,
      enabled: true,
    },
    {
      id: "scheduled_time_past",
      name: "Scheduled Time in Past",
      description: "Scheduled time has already passed",
      detectionRules: [
        {
          type: "timing",
          pattern: "INVALID_TIME",
          weight: 1.0,
        },
      ],
      resolutionStrategies: [
        {
          strategy: "reschedule",
          parameters: { addMinutes: 15 },
        },
      ],
      priority: 1,
      enabled: true,
    },
  ];

  for (const pattern of builtInPatterns) {
    conflictPatterns.set(pattern.id, pattern);
  }
}

/**
 * Load custom patterns from the database (no-op stub, logs placeholder).
 */
export async function loadCustomPatterns(): Promise<void> {
  // Load custom patterns from database
  // This would typically fetch from a configuration table
  log.info("Custom conflict patterns loaded");
}

/**
 * Evaluate whether a given pattern matches the publish result and context.
 */
export async function matchPattern(
  pattern: ConflictPattern,
  context: ConflictContext,
  result: PublishResult
): Promise<{ matches: boolean; confidence: number; matchedRules: ConflictDetectionRule[] }> {
  const matchedRules: ConflictDetectionRule[] = [];
  let totalConfidence = 0;

  for (const rule of pattern.detectionRules) {
    const matches = await evaluateDetectionRule(rule, context, result);
    if (matches) {
      matchedRules.push(rule);
      totalConfidence += rule.weight;
    }
  }

  const avgConfidence =
    matchedRules.length > 0 ? totalConfidence / pattern.detectionRules.length : 0;

  return {
    matches: matchedRules.length > 0,
    confidence: avgConfidence,
    matchedRules,
  };
}

/**
 * Evaluate a single detection rule against the publish result.
 */
async function evaluateDetectionRule(
  rule: ConflictDetectionRule,
  context: ConflictContext,
  result: PublishResult
): Promise<boolean> {
  switch (rule.type) {
    case "error_code":
      return result.error?.includes(rule.pattern as string) || false;

    case "content_validation":
      // Would check validation errors
      return false;

    case "rate_limit":
      return result.error === "RATE_LIMIT";

    case "timing":
      // Would check timing-related issues
      return false;

    case "dependency":
      // Would check dependency failures
      return false;

    case "custom":
      return rule.condition ? rule.condition(context, result) : false;

    default:
      return false;
  }
}

/**
 * Map a ConflictPattern to its corresponding OrchestrationConflict type.
 */
export function mapPatternToConflictType(pattern: ConflictPattern): OrchestrationConflict["type"] {
  if (pattern.id.includes("rate_limit")) return "rate_limit";
  if (pattern.id.includes("content")) return "content_validation";
  if (pattern.id.includes("timing")) return "timing_conflict";
  if (pattern.id.includes("dependency")) return "dependency_failure";
  return "custom";
}

/**
 * Build a human-readable conflict description including confidence score.
 */
export function generateConflictDescription(
  pattern: ConflictPattern,
  matchResult: { confidence: number; matchedRules: ConflictDetectionRule[] }
): string {
  return `${pattern.description} (confidence: ${Math.round(matchResult.confidence * 100)}%)`;
}

/**
 * Calculate the severity of a conflict based on pattern priority and match confidence.
 */
export function calculateSeverity(
  pattern: ConflictPattern,
  matchResult: { confidence: number }
): OrchestrationConflict["severity"] {
  if (pattern.priority === 1 || matchResult.confidence > 0.9) return "critical";
  if (pattern.priority === 2 || matchResult.confidence > 0.7) return "high";
  if (pattern.priority === 3 || matchResult.confidence > 0.5) return "medium";
  return "low";
}
