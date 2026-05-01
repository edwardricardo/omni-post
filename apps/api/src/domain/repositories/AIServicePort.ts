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

import type { AIMessage, GenerationOptions } from "../../ai/types.js";

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
}
