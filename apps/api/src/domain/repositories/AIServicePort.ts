/**
 * @file AIServicePort.ts
 * @description Application-layer port for AI text-generation operations
 *              consumed by ml use cases (`OptimizeContentUseCase`,
 *              `PredictOptimalTimingUseCase`). The application depends on
 *              this interface, not on the concrete `AIService` adapter that
 *              lives in infrastructure. Result payloads are intentionally
 *              loose (`unknown`) because the AI providers return free-form
 *              JSON; consumers narrow them at call site.
 * @layer domain
 */

import type { Result } from "@shared/types";
import type { AIMessage, GenerationOptions, StructuredOutputSpec } from "../../ai/types.js";

export type AnalysisType = "sentiment" | "tone" | "readability" | "engagement";

export interface OptimizeContentResult {
  success: boolean;
  optimization?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AnalyzeContentResult {
  success: boolean;
  analysis?: unknown;
  metadata?: Record<string, unknown>;
}

export interface GenerateVariationsResult {
  success: boolean;
  variations?: string[];
  metadata?: Record<string, unknown>;
}

export interface GenerateContentResult {
  success: boolean;
  content?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AIServicePort {
  optimizeContent(
    content: string,
    platform: string,
    brandVoice?: string,
    accountId?: string
  ): Promise<OptimizeContentResult>;

  analyzeContent(
    content: string,
    analysisType: AnalysisType,
    accountId?: string
  ): Promise<AnalyzeContentResult>;

  generateVariations(
    content: string,
    variationType: string,
    count: number,
    accountId?: string
  ): Promise<GenerateVariationsResult>;

  generateContent(
    messages: AIMessage[],
    options?: GenerationOptions,
    accountId?: string
  ): Promise<GenerateContentResult>;

  /**
   * Schema-validated structured generation. Returns a `Result` of the
   * validated `T`: the provider's native structured-output capability plus
   * `spec.parse` guarantee a typed value, never unparsed text. `spec` is
   * technology-free (the domain has no schema-library dependency);
   * infrastructure constructs it.
   *
   * The error is a single `"AI_ERROR"`: any provider, transport, or
   * schema-validation failure resolves to this one outcome, so the contract
   * never advertises an error variant the implementation cannot produce.
   */
  generateStructured<T>(
    messages: AIMessage[],
    spec: StructuredOutputSpec<T>,
    options?: GenerationOptions,
    accountId?: string
  ): Promise<Result<T, "AI_ERROR">>;

  /**
   * Generates dense vector embeddings for the input texts. The orchestrator
   * routes the call to the first configured provider whose
   * `supportsEmbeddings` is `true` (canonical order:
   * `EMBEDDINGS_PROVIDER_PREFERENCE` env). Anthropic and Perplexity declare
   * `supportsEmbeddings = false` and are skipped.
   *
   * Returns one vector per input text. Dimensions default to 768 so the
   * output is comparable across providers without re-embedding (OpenAI
   * truncates Matryoshka-style; Gemini produces 768 natively).
   */
  generateEmbeddings(
    texts: string[],
    options?: { model?: string; dimensions?: number },
    accountId?: string
  ): Promise<Result<number[][], "AI_ERROR">>;
}
