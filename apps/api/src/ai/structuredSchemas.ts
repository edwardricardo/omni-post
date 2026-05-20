/**
 * @file structuredSchemas.ts
 * @description Single source of truth for the schema-validated AI response
 *              contracts (content analysis, optimization, performance
 *              prediction, variations). Every provider builds its
 *              `StructuredOutputSpec` from these zod schemas instead of
 *              parsing free-form model text, so a malformed model response
 *              fails validation rather than silently corrupting callers.
 * @layer infrastructure
 */

import { z } from "zod";
import type {
  ContentAnalysis,
  ContentOptimization,
  PerformancePrediction,
  StructuredOutputSpec,
} from "./types.js";

const suggestions = z.array(z.string());

const sentimentSchema = z.object({
  score: z.number(),
  label: z.enum(["positive", "negative", "neutral"]),
  confidence: z.number(),
});
const toneSchema = z.object({
  detected: z.string(),
  confidence: z.number(),
  suggestions,
});
const readabilitySchema = z.object({
  score: z.number(),
  level: z.string(),
  suggestions,
});
const engagementSchema = z.object({
  score: z.number(),
  factors: z.array(z.object({ factor: z.string(), impact: z.number(), suggestion: z.string() })),
});

const analysisSchemaByType = {
  sentiment: z.object({ sentiment: sentimentSchema }),
  tone: z.object({ tone: toneSchema }),
  readability: z.object({ readability: readabilitySchema }),
  engagement: z.object({ engagement: engagementSchema }),
} as const;

export type AnalysisType = keyof typeof analysisSchemaByType;

const contentOptimizationSchema = z.object({
  optimizedText: z.string(),
  changes: z.array(
    z.object({
      type: z.enum(["added", "removed", "modified"]),
      original: z.string(),
      optimized: z.string(),
      reason: z.string(),
    })
  ),
  hashtags: z.array(z.string()),
  mentions: z.array(z.string()),
  mediasuggestions: z.array(
    z.object({
      type: z.enum(["image", "video"]),
      description: z.string(),
      dimensions: z.string(),
    })
  ),
  platformSpecific: z.record(
    z.string(),
    z.object({
      text: z.string(),
      characterCount: z.number(),
      optimizations: z.array(z.string()),
    })
  ),
});

const rangedMetric = z.object({
  value: z.number(),
  confidence: z.number(),
  range: z.object({ min: z.number(), max: z.number() }),
});
const performancePredictionSchema = z.object({
  platform: z.string(),
  metrics: z.object({
    expectedEngagement: rangedMetric,
    expectedReach: rangedMetric,
    viralPotential: z.number(),
    conversionPotential: z.number(),
  }),
  optimalTiming: z.object({
    hour: z.number(),
    day: z.string(),
    timezone: z.string(),
    confidence: z.number(),
  }),
  competitiveAnalysis: z.object({
    benchmarkScore: z.number(),
    opportunities: z.array(z.string()),
    threats: z.array(z.string()),
  }),
});

const variationsSchema = z.object({ variations: z.array(z.string()) });

const triageSchema = z.object({
  priority: z.enum(["URGENT", "HIGH", "NORMAL", "LOW"]),
  sentimentScore: z.number().min(-1).max(1),
  suggestedReplies: z.array(z.string()).length(3),
});

/**
 * Structured classification of an inbound social-inbox message: priority bucket,
 * sentiment score in `[-1, 1]`, and exactly three reply suggestions.
 */
export type TriageClassification = z.infer<typeof triageSchema>;

/**
 * @function analysisSpec
 * @description Builds the structured-output spec for a single analysis type.
 *   The model is asked for just `{ [type]: {...} }` and `parse` narrows it to
 *   the matching `Partial<ContentAnalysis>` slice.
 * @param type - Which analysis dimension to request.
 * @returns The technology-free spec consumed by `generateStructured`.
 */
export function analysisSpec(type: AnalysisType): StructuredOutputSpec<Partial<ContentAnalysis>> {
  const schema = analysisSchemaByType[type];
  return {
    name: `content_${type}`,
    jsonSchema: z.toJSONSchema(schema) as Record<string, unknown>,
    parse: (raw: unknown): Partial<ContentAnalysis> =>
      schema.parse(raw) as Partial<ContentAnalysis>,
  };
}

/** Structured-output spec for platform content optimization. */
export const optimizationSpec: StructuredOutputSpec<ContentOptimization> = {
  name: "content_optimization",
  jsonSchema: z.toJSONSchema(contentOptimizationSchema) as Record<string, unknown>,
  parse: (raw: unknown): ContentOptimization => contentOptimizationSchema.parse(raw),
};

/** Structured-output spec for performance prediction. */
export const predictionSpec: StructuredOutputSpec<PerformancePrediction> = {
  name: "performance_prediction",
  jsonSchema: z.toJSONSchema(performancePredictionSchema) as Record<string, unknown>,
  parse: (raw: unknown): PerformancePrediction => performancePredictionSchema.parse(raw),
};

/**
 * @function variationsSpec
 * @description Spec for content variations. The model returns an object
 *   (`json_schema` roots must be objects); `parse` unwraps the string array.
 * @returns The technology-free spec consumed by `generateStructured`.
 */
export function variationsSpec(): StructuredOutputSpec<string[]> {
  return {
    name: "content_variations",
    jsonSchema: z.toJSONSchema(variationsSchema) as Record<string, unknown>,
    parse: (raw: unknown): string[] => variationsSchema.parse(raw).variations,
  };
}

/** Structured-output spec for AI-powered inbox-message triage. */
export const triageSpec: StructuredOutputSpec<TriageClassification> = {
  name: "inbox_triage",
  description:
    "Classify an inbound social-inbox message: priority bucket, sentiment score, and three ready-to-send reply suggestions.",
  jsonSchema: z.toJSONSchema(triageSchema) as Record<string, unknown>,
  parse: (raw: unknown): TriageClassification => triageSchema.parse(raw),
};
