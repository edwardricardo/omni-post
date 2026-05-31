/**
 * @file AIContracts.ts
 * @description Domain-side contracts for the AI subsystem. Promotes the
 *   `AIProvider` port, the `AITask` discriminated union, the `AIResponse<T>`
 *   envelope, and the three content-analysis DTOs (ContentAnalysis,
 *   ContentOptimization, PerformancePrediction) out of apps/api so that
 *   application-layer services (AiRequestService, AIService) can live in
 *   @core/application without referencing infrastructure type modules.
 *
 *   Concrete provider implementations + SDK wiring stay in apps/api/src/ai/
 *   (OpenAI, Anthropic, Gemini, Perplexity) as adapters of the `AIProvider`
 *   port defined here.
 * @layer domain
 */

import type { AIMessage, GenerationOptions, StructuredOutputSpec } from "./AiServiceContract.js";
import type {
  ImageGenerationOptions,
  ImageGenerationResult,
} from "../repositories/ImageGenerationPort.js";

// ─── Provider port ──────────────────────────────────────────────────────────

export type AIProviderName = "openai" | "anthropic" | "perplexity" | "gemini";

export interface AIProvider {
  name: AIProviderName;
  isAvailable(): Promise<boolean>;
  generateText(messages: AIMessage[], options?: GenerationOptions): Promise<string>;
  /**
   * Schema-validated structured generation using the provider's NATIVE
   * structured-output capability (OpenAI json_schema, Anthropic tool-use,
   * Gemini responseSchema, Perplexity JSON mode). Output is always passed
   * through `spec.parse` so callers get a validated `T`, never unparsed text.
   */
  generateStructured<T>(
    messages: AIMessage[],
    spec: StructuredOutputSpec<T>,
    options?: GenerationOptions
  ): Promise<T>;
  analyzeContent(
    content: string,
    analysisType: "sentiment" | "tone" | "readability" | "engagement"
  ): Promise<Partial<ContentAnalysis>>;
  optimizeContent(
    content: string,
    platform: string,
    brandVoice?: string
  ): Promise<ContentOptimization>;
  predictPerformance(
    content: string,
    platform: string,
    historicalData?: unknown[]
  ): Promise<PerformancePrediction>;
  generateVariations(
    content: string,
    variationType: "tone" | "length" | "audience",
    count: number
  ): Promise<string[]>;
  generateImage?(options: ImageGenerationOptions): Promise<AIResponse<ImageGenerationResult>>;

  /**
   * Whether this provider exposes a native embeddings API.
   * Providers without native embeddings (Anthropic, Perplexity) declare
   * `false` and omit `generateEmbeddings`; the orchestrator falls back to
   * the next configured provider that supports them.
   */
  readonly supportsEmbeddings: boolean;
  /**
   * Optional embeddings generation. Implementations target a uniform
   * dimension (default 768) so vectors are comparable across providers
   * without re-embedding.
   */
  generateEmbeddings?(
    texts: string[],
    options?: { model?: string; dimensions?: number }
  ): Promise<number[][]>;
}

// ─── Task + response envelope ───────────────────────────────────────────────

export type AITask =
  | { type: "generate"; data: { messages: AIMessage[]; options?: GenerationOptions } }
  | {
      type: "analyze";
      data: { content: string; analysisType: "sentiment" | "tone" | "readability" | "engagement" };
    }
  | { type: "optimize"; data: { content: string; platform: string; brandVoice?: string } }
  | { type: "predict"; data: { content: string; platform: string; historicalData?: unknown[] } }
  | {
      type: "variations";
      data: { content: string; variationType: "tone" | "length" | "audience"; count: number };
    };

/** Classification of an AI provider failure used to drive retry / surface
 *  decisions.
 *  - `transient`     → 5xx, 429, network → retry with backoff
 *  - `recoverable`   → malformed response, schema parse fail → reformulate
 *  - `user-fixable`  → 4xx auth / validation → surface to user, no retry
 *  - `unexpected`    → panic / OOM → crash loudly, no retry */
export type AIErrorCategory = "transient" | "recoverable" | "user-fixable" | "unexpected";

export interface AIResponse<T = unknown> {
  ok: boolean;
  value?: T;
  error?: {
    code: string;
    message: string;
    provider: string;
    retryable: boolean;
    category: AIErrorCategory;
    /** Provider-supplied wait hint recovered from the `Retry-After` header
     *  (RFC 9110 §10.2.3). When present, the orchestrator pauses at least
     *  this long before retrying. */
    retryAfterMs?: number;
  };
  metadata: {
    provider: string;
    model: string;
    tokensUsed: number;
    latency: number;
    cached: boolean;
  };
}

// ─── Content-analysis DTOs ──────────────────────────────────────────────────

export interface ContentAnalysis {
  sentiment: {
    score: number; // -1 to 1
    label: "positive" | "negative" | "neutral";
    confidence: number;
  };
  tone: {
    detected: string;
    confidence: number;
    suggestions: string[];
  };
  readability: {
    score: number;
    level: string;
    suggestions: string[];
  };
  brandConsistency: {
    score: number;
    voice: string;
    suggestions: string[];
  };
  engagement: {
    score: number;
    factors: Array<{
      factor: string;
      impact: number;
      suggestion: string;
    }>;
  };
}

export interface ContentOptimization {
  optimizedText: string;
  changes: Array<{
    type: "added" | "removed" | "modified";
    original: string;
    optimized: string;
    reason: string;
  }>;
  hashtags: string[];
  mentions: string[];
  mediasuggestions: Array<{
    type: "image" | "video";
    description: string;
    dimensions: string;
  }>;
  platformSpecific: Record<
    string,
    {
      text: string;
      characterCount: number;
      optimizations: string[];
    }
  >;
}

export interface PerformancePrediction {
  platform: string;
  metrics: {
    expectedEngagement: {
      value: number;
      confidence: number;
      range: { min: number; max: number };
    };
    expectedReach: {
      value: number;
      confidence: number;
      range: { min: number; max: number };
    };
    viralPotential: number;
    conversionPotential: number;
  };
  optimalTiming: {
    hour: number;
    day: string;
    timezone: string;
    confidence: number;
  };
  competitiveAnalysis: {
    benchmarkScore: number;
    opportunities: string[];
    threats: string[];
  };
}
