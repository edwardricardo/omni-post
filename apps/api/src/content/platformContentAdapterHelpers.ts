/**
 * @file platformContentAdapterHelpers.ts
 * @description Stateless utility functions for platform content adaptation including
 *              rule matching, content transformation, and metric calculations.
 * @layer infrastructure
 */

import type { AdaptationRule, PlatformAdaptation } from "@shared/types/orchestration.js";
import type { CanonicalPost, Media } from "@shared/types";
import type { ProviderId } from "../providers/providerAdapter.interface.js";
import type {
  AdaptationCondition,
  AdaptationMetrics,
  ContentTransformer,
} from "./platformContentAdapterTypes.js";

// ---------------------------------------------------------------------------
// Confidence & Scoring
// ---------------------------------------------------------------------------

/**
 * @function calculateConfidence
 * @description Computes adaptation confidence based on warning count vs applied rules.
 * @param appliedRules - Rules that were applied during adaptation
 * @param warnings - Warnings collected during adaptation
 * @returns Confidence in [0.3, 1.0]
 */
export function calculateConfidence(appliedRules: AdaptationRule[], warnings: string[]): number {
  if (warnings.length > appliedRules.length) return 0.3;
  if (warnings.length > 0) return 0.7;
  if (appliedRules.length === 0) return 1.0;
  return 0.9;
}

/**
 * @function calculateReversibilityScore
 * @description Ratio of applied rules that are reversible.
 * @param rules - Rules applied during adaptation
 * @returns Reversibility ratio in [0, 1]
 */
export function calculateReversibilityScore(rules: AdaptationRule[]): number {
  if (rules.length === 0) return 1.0;
  const reversibleRules = rules.filter((rule) => isRuleReversible(rule));
  return reversibleRules.length / rules.length;
}

/**
 * @function isRuleReversible
 * @description Returns true if applying this rule type can be undone.
 * @param rule - Adaptation rule to check
 * @returns True if reversible
 */
export function isRuleReversible(rule: AdaptationRule): boolean {
  const reversibleTypes = ["hashtag_limit", "custom"];
  return reversibleTypes.includes(rule.type);
}

/**
 * @function initializeMetrics
 * @description Returns a zero-initialised adaptation metrics object.
 * @returns Default AdaptationMetrics with all scores at 0
 */
export function initializeMetrics(): AdaptationMetrics {
  return {
    executionTime: 0,
    confidenceScore: 0,
    qualityScore: 0,
    engagementPrediction: 0,
    complianceScore: 0,
    reversibilityScore: 0,
  };
}

// ---------------------------------------------------------------------------
// Content Similarity & Completeness
// ---------------------------------------------------------------------------

/**
 * @function calculateContentSimilarity
 * @description Character-by-character similarity ratio between two posts' bodies.
 * @param content1 - First post
 * @param content2 - Second post
 * @returns Similarity in [0, 1]
 */
export function calculateContentSimilarity(
  content1: CanonicalPost,
  content2: CanonicalPost
): number {
  const text1 = content1.body || "";
  const text2 = content2.body || "";

  if (text1 === text2) return 1.0;
  if (text1.length === 0 && text2.length === 0) return 1.0;

  const maxLength = Math.max(text1.length, text2.length);
  const commonLength = calculateCommonLength(text1, text2);

  return commonLength / maxLength;
}

function calculateCommonLength(str1: string, str2: string): number {
  let common = 0;
  const minLength = Math.min(str1.length, str2.length);

  for (let i = 0; i < minLength; i++) {
    if (str1[i] === str2[i]) {
      common++;
    }
  }

  return common;
}

function calculateContentCompleteness(original: CanonicalPost, adapted: CanonicalPost): number {
  let completeness = 0;
  let factors = 0;

  if (original.body) {
    completeness += adapted.body && adapted.body.length > 0 ? 1 : 0;
    factors++;
  }

  if (original.media && original.media.length > 0) {
    completeness += adapted.media && adapted.media.length > 0 ? 1 : 0;
    factors++;
  }

  if (original.tags && original.tags.length > 0) {
    completeness += adapted.tags && adapted.tags.length > 0 ? 1 : 0;
    factors++;
  }

  return factors > 0 ? completeness / factors : 1;
}

/**
 * @function calculateQualityScore
 * @description Aggregate quality score combining similarity and completeness.
 * @param original - Original canonical post
 * @param adapted - Adapted post
 * @returns Quality score in [0, 1]
 */
export function calculateQualityScore(original: CanonicalPost, adapted: CanonicalPost): number {
  const similarity = calculateContentSimilarity(original, adapted);
  const completeness = calculateContentCompleteness(original, adapted);
  return (similarity + completeness) / 2;
}

// ---------------------------------------------------------------------------
// Media Utilities
// ---------------------------------------------------------------------------

/**
 * @function findUnsupportedMediaFormats
 * @description Returns the distinct media types in the post that are not in the allowlist.
 * @param media - Media items attached to the post
 * @param allowedFormats - Allowed media type strings
 * @returns Unique unsupported type strings
 */
export function findUnsupportedMediaFormats(
  media: Media[] | undefined,
  allowedFormats: string[]
): string[] {
  if (!media) return [];

  const unsupported: string[] = [];
  for (const item of media) {
    if (!allowedFormats.includes(item.type)) {
      unsupported.push(item.type);
    }
  }

  return [...new Set(unsupported)];
}

function convertMediaUrl(url: string, targetFormat: string): string {
  return url.replace(/\.[^.]+$/, `.${targetFormat}`);
}

function optimizeMediaSize(url: string, maxSize: number): string {
  return url + `?size=${maxSize}`;
}

// ---------------------------------------------------------------------------
// Content Enhancement
// ---------------------------------------------------------------------------

function addEngagementElements(content: string, params: Record<string, unknown>): string {
  if (params.addEmojis && !content.match(/[\u{1F600}-\u{1F64F}]/u)) {
    content = `✨ ${content}`;
  }
  return content;
}

function addAccessibilityFeatures(content: string, _params: Record<string, unknown>): string {
  // Placeholder — production implementation adds alt-text descriptions
  return content;
}

// ---------------------------------------------------------------------------
// Engagement Optimizations
// ---------------------------------------------------------------------------

// Future: Call-to-Action Optimization
// Implement AI-driven CTA selection using engagement prediction models
// that analyze content context, audience behavior patterns, and platform-specific
// best practices to suggest the most effective CTA for each post.
// Requires: AI service integration with trained engagement models.

async function optimizeHashtagsForAudience(
  tags: string[],
  preferredHashtags: string[]
): Promise<string[]> {
  const optimized = [...tags];
  const toAdd = preferredHashtags.filter((tag) => !tags.includes(tag)).slice(0, 3);
  return [...optimized, ...toAdd];
}

/**
 * @function applyEngagementOptimizations
 * @description Applies platform-specific engagement optimisations (hashtag preferences, etc.)
 *              to an existing adaptation.
 * @param adaptation - Base platform adaptation
 * @param _providerId - Target provider id (reserved for future per-provider tuning)
 * @param audienceData - Optional audience-derived hints
 * @returns Adaptation with optimised content
 */
export async function applyEngagementOptimizations(
  adaptation: PlatformAdaptation,
  _providerId: ProviderId,
  audienceData?: Record<string, unknown>
): Promise<PlatformAdaptation> {
  let optimizedContent = { ...adaptation.adaptedContent };

  // Future: AI-driven CTA optimization per platform (see optimizeCallToAction stub above)

  const preferredHashtags = audienceData?.preferredHashtags;
  if (optimizedContent.tags && Array.isArray(preferredHashtags)) {
    optimizedContent.tags = await optimizeHashtagsForAudience(
      optimizedContent.tags,
      preferredHashtags as string[]
    );
  }

  return {
    ...adaptation,
    adaptedContent: optimizedContent,
  };
}

// ---------------------------------------------------------------------------
// Condition Evaluation
// ---------------------------------------------------------------------------

function getFieldValue(content: CanonicalPost, field: string): unknown {
  return (content as Record<string, unknown>)[field];
}

/**
 * @function evaluateCondition
 * @description Evaluates an adaptation condition against a post's field value.
 * @param condition - Condition (field, operator, value)
 * @param content - Canonical post providing the field value
 * @returns True if the condition matches
 */
export async function evaluateCondition(
  condition: AdaptationCondition,
  content: CanonicalPost
): Promise<boolean> {
  const fieldValue = getFieldValue(content, condition.field);

  switch (condition.operator) {
    case "gt":
      return typeof fieldValue === "number" && fieldValue > Number(condition.value);
    case "lt":
      return typeof fieldValue === "number" && fieldValue < Number(condition.value);
    case "eq":
      return fieldValue === condition.value;
    case "contains":
      return (
        typeof fieldValue === "string" &&
        typeof condition.value === "string" &&
        fieldValue.includes(condition.value)
      );
    case "exists":
      return fieldValue !== undefined && fieldValue !== null;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

/**
 * @function predictEngagement
 * @description Placeholder rule-based engagement estimate (no ML).
 * @param _content - Canonical post (reserved for future heuristics)
 * @param _providerId - Target provider id (reserved)
 * @returns Engagement estimate in [0, 1]
 */
export async function predictEngagement(
  _content: CanonicalPost,
  _providerId: ProviderId
): Promise<number> {
  // Placeholder for rule-based engagement estimation (no ML involved)
  return 0.7;
}

// ---------------------------------------------------------------------------
// Built-in Transformer Definitions
// ---------------------------------------------------------------------------

/**
 * Build and return the map of built-in content transformers.
 * Extracted here to keep PlatformContentAdapter within the 800-line limit.
 */
export function buildBuiltInTransformers(): Map<string, ContentTransformer> {
  const transformers = new Map<string, ContentTransformer>();

  transformers.set("text_truncate", {
    id: "text_truncate",
    name: "Text Truncation",
    type: "text",
    transform: async (content: unknown, params: Record<string, unknown>) => {
      const text = typeof content === "string" ? content : String(content);
      const maxLength = typeof params.maxLength === "number" ? params.maxLength : 280;
      if (text.length <= maxLength) return text;
      const truncated = text.substring(0, maxLength - 3);
      const lastSpace = truncated.lastIndexOf(" ");
      return lastSpace > maxLength * 0.8
        ? truncated.substring(0, lastSpace) + "..."
        : truncated + "...";
    },
    validate: (input: unknown) => typeof input === "string",
    reversible: false,
  });

  transformers.set("hashtag_optimize", {
    id: "hashtag_optimize",
    name: "Hashtag Optimization",
    type: "text",
    transform: async (content: unknown, params: Record<string, unknown>) => {
      const tags = Array.isArray(content) ? (content as string[]) : [];
      const maxTags = typeof params.maxTags === "number" ? params.maxTags : 10;
      const style = typeof params.style === "string" ? params.style : "inline";
      const optimizedTags = tags.slice(0, maxTags);
      if (style === "grouped") return optimizedTags;
      if (style === "minimal") return optimizedTags.slice(0, 3);
      return optimizedTags;
    },
    validate: (input: unknown) => Array.isArray(input),
    reversible: true,
  });

  transformers.set("media_optimize", {
    id: "media_optimize",
    name: "Media Optimization",
    type: "media",
    transform: async (content: unknown, params: Record<string, unknown>) => {
      const media = Array.isArray(content) ? (content as Media[]) : [];
      const maxCount = typeof params.maxCount === "number" ? params.maxCount : 4;
      const targetFormat =
        typeof params.targetFormat === "string" ? params.targetFormat : undefined;
      const maxSize = typeof params.maxSize === "number" ? params.maxSize : undefined;
      let optimizedMedia = media.slice(0, maxCount);
      if (targetFormat) {
        optimizedMedia = optimizedMedia.map((m) => ({
          ...m,
          type: targetFormat as Media["type"],
          url: convertMediaUrl(m.url, targetFormat),
        }));
      }
      if (maxSize) {
        optimizedMedia = optimizedMedia.map((m) => ({
          ...m,
          url: optimizeMediaSize(m.url, maxSize),
        }));
      }
      return optimizedMedia;
    },
    validate: (input: unknown) => Array.isArray(input),
    reversible: false,
  });

  transformers.set("content_enhance", {
    id: "content_enhance",
    name: "Content Enhancement",
    type: "text",
    transform: async (content: unknown, params: Record<string, unknown>) => {
      const text = typeof content === "string" ? content : String(content);
      const enhancementType = typeof params.type === "string" ? params.type : "engagement";
      if (enhancementType === "engagement") {
        return addEngagementElements(text, params);
      } else if (enhancementType === "accessibility") {
        return addAccessibilityFeatures(text, params);
      }
      return text;
    },
    validate: (input: unknown) => typeof input === "string",
    reversible: true,
  });

  return transformers;
}
