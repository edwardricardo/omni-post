/**
 * @file AiStructuredOutputs.ts
 * @description Technology-free result shapes for the schema-validated
 *              structured-generation use cases. The application works with
 *              these plain types; infrastructure builds the matching
 *              `StructuredOutputSpec` from zod schemas (the domain has no
 *              schema-library dependency). The spec's generic ties each zod
 *              schema's inferred output to the interface here, so drift is a
 *              compile error at the spec definition.
 * @layer domain
 */

/**
 * Structured classification of an inbound social-inbox message: priority
 * bucket, sentiment score in `[-1, 1]`, and exactly three reply suggestions.
 */
export interface TriageClassification {
  priority: "URGENT" | "HIGH" | "NORMAL" | "LOW";
  sentimentScore: number;
  suggestedReplies: string[];
}

/**
 * Per-topic trend score: a 1-10 relevance score, an optional post idea, the
 * best target platform, and an urgency bucket.
 */
export interface TrendScore {
  index: number;
  score: number;
  postIdea: string | null;
  bestPlatform: string | null;
  urgency: "NOW" | "TODAY" | "THIS_WEEK";
}

/**
 * Structured trend-scoring payload returned for a batch of topics.
 */
export interface TrendScoresClassification {
  scores: TrendScore[];
}

/**
 * Structured payload for locale-native content generation: the generated
 * content plus an optional rationale justifying the chosen angle.
 */
export interface LocalizedContentClassification {
  content: string;
  rationale: string | null;
}
