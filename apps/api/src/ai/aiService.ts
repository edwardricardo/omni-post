/**
 * @file aiService.ts
 * @description High-level AI service providing content generation, analysis,
 *              optimization, and smart analysis using the AI orchestrator.
 * @layer infrastructure
 */
import { BaseService } from "../services/BaseService.js";
import { AppError } from "../lib/errors/AppError.js";
import { aiOrchestrator } from "./orchestrator.js";
import type { ImageGenerationOptions, ImageGenerationResult, AIResponse } from "./types.js";

import type { AIMessage, GenerationOptions as AIGenerateOptions } from "./types.js";

type Message = AIMessage;
type GenerateOptions = AIGenerateOptions;

type AnalysisType = "sentiment" | "tone" | "readability" | "engagement";
type VariationType = "tone" | "length" | "audience";

interface SmartAnalysisParams {
  content: string;
  platform?: string | undefined;
  brandVoice?: string | undefined;
  includeOptimization?: boolean | undefined;
  includePrediction?: boolean | undefined;
  includeVariations?: boolean | undefined;
  variationCount?: number | undefined;
}

interface SmartAnalysisResult {
  content: string;
  platform: string;
  analysis: {
    sentiment?: unknown;
    tone?: unknown;
    readability?: unknown;
    engagement?: unknown;
  };
  optimization?: unknown;
  prediction?: unknown;
  variations?: unknown;
  metadata: {
    providersUsed: string[];
    totalLatency: number;
    timestamp: string;
  };
}

/**
 * AI Service — orchestrates content analysis via external AI providers.
 *
 * This service delegates to third-party LLM APIs (OpenAI, Gemini, Perplexity)
 * for content generation, analysis, and optimization. It does NOT implement
 * any proprietary ML models; the "AI" in the name refers to the external
 * provider integrations.
 */
export class AIService extends BaseService {
  constructor() {
    super("AIService");
  }

  async healthCheck() {
    return this.execute({ operation: "healthCheck" }, async () => {
      const health = await aiOrchestrator.healthCheck();
      const availableProviders = aiOrchestrator.getAvailableProviders();
      const usageMetrics = aiOrchestrator.getUsageMetrics();
      const cacheStats = aiOrchestrator.getCacheStats();

      return {
        status: "healthy",
        providers: health,
        availableProviders,
        metrics: Object.fromEntries(usageMetrics),
        cache: cacheStats,
        timestamp: new Date().toISOString(),
      };
    });
  }

  async generateContent(messages: Message[], options?: GenerateOptions) {
    return this.execute(
      { operation: "generateContent", metadata: { messageCount: messages.length } },
      async () => {
        const result = await aiOrchestrator.generateContent(messages, options);

        if (!result.ok) {
          const errorMsg =
            typeof result.error === "string"
              ? result.error
              : result.error?.message || "Content generation failed";
          throw AppError.externalService("AI", errorMsg);
        }

        return {
          success: true,
          content: result.value,
          metadata: result.metadata,
        };
      }
    );
  }

  async analyzeContent(content: string, analysisType: AnalysisType) {
    return this.execute({ operation: "analyzeContent", metadata: { analysisType } }, async () => {
      const result = await aiOrchestrator.analyzeContent(content, analysisType);

      if (!result.ok) {
        const errorMsg =
          typeof result.error === "string"
            ? result.error
            : result.error?.message || "Content analysis failed";
        throw AppError.externalService("AI", errorMsg);
      }

      return {
        success: true,
        analysis: result.value,
        metadata: result.metadata,
      };
    });
  }

  async optimizeContent(content: string, platform: string, brandVoice?: string) {
    return this.execute({ operation: "optimizeContent", metadata: { platform } }, async () => {
      const result = await aiOrchestrator.optimizeContent(content, platform, brandVoice);

      if (!result.ok) {
        const errorMsg =
          typeof result.error === "string"
            ? result.error
            : result.error?.message || "Content optimization failed";
        throw AppError.externalService("AI", errorMsg);
      }

      return {
        success: true,
        optimization: result.value,
        metadata: result.metadata,
      };
    });
  }

  async predictPerformance(content: string, platform: string, historicalData?: unknown[]) {
    return this.execute({ operation: "predictPerformance", metadata: { platform } }, async () => {
      const result = await aiOrchestrator.predictPerformance(
        content,
        platform,
        historicalData as Record<string, unknown>[] | undefined
      );

      if (!result.ok) {
        const errorMsg =
          typeof result.error === "string"
            ? result.error
            : result.error?.message || "Performance prediction failed";
        throw AppError.externalService("AI", errorMsg);
      }

      return {
        success: true,
        prediction: result.value,
        metadata: result.metadata,
      };
    });
  }

  async generateVariations(content: string, variationType: VariationType, count: number) {
    return this.execute(
      { operation: "generateVariations", metadata: { variationType, count } },
      async () => {
        const result = await aiOrchestrator.generateVariations(content, variationType, count);

        if (!result.ok) {
          const errorMsg =
            typeof result.error === "string"
              ? result.error
              : result.error?.message || "Variation generation failed";
          throw AppError.externalService("AI", errorMsg);
        }

        return {
          success: true,
          variations: result.value,
          metadata: result.metadata,
        };
      }
    );
  }

  /**
   * @method generateImage
   * @description Generates an image via the AI orchestrator (delegates to OpenAI DALL-E 3).
   * @param options - Image generation options including prompt, size, quality, and style
   * @returns AIResponse containing the image URL and revised prompt
   */
  async generateImage(options: ImageGenerationOptions): Promise<AIResponse<ImageGenerationResult>> {
    return this.execute(
      { operation: "generateImage", metadata: { prompt: options.prompt } },
      async () => {
        const result = await aiOrchestrator.generateImage(options);
        return result;
      }
    );
  }

  async smartAnalysis(params: SmartAnalysisParams): Promise<SmartAnalysisResult> {
    return this.execute(
      {
        operation: "smartAnalysis",
        metadata: {
          platform: params.platform,
          includeOptimization: params.includeOptimization,
          includePrediction: params.includePrediction,
          includeVariations: params.includeVariations,
        },
      },
      async () => {
        const {
          content,
          platform = "twitter",
          brandVoice,
          includeOptimization = true,
          includePrediction = true,
          includeVariations = false,
          variationCount = 3,
        } = params;

        // Run multiple analyses in parallel
        const analyses = await Promise.allSettled([
          aiOrchestrator.analyzeContent(content, "sentiment"),
          aiOrchestrator.analyzeContent(content, "tone"),
          aiOrchestrator.analyzeContent(content, "readability"),
          aiOrchestrator.analyzeContent(content, "engagement"),
          ...(includeOptimization
            ? [aiOrchestrator.optimizeContent(content, platform, brandVoice)]
            : []),
          ...(includePrediction ? [aiOrchestrator.predictPerformance(content, platform)] : []),
          ...(includeVariations
            ? [aiOrchestrator.generateVariations(content, "tone", variationCount)]
            : []),
        ]);

        const results: SmartAnalysisResult = {
          content,
          platform,
          analysis: {},
          metadata: {
            providersUsed: [],
            totalLatency: 0,
            timestamp: new Date().toISOString(),
          },
        };

        // Process sentiment analysis
        if (analyses[0].status === "fulfilled" && analyses[0].value.ok) {
          results.analysis.sentiment = analyses[0].value.value;
          results.metadata.providersUsed.push(analyses[0].value.metadata.provider);
        }

        // Process tone analysis
        if (analyses[1].status === "fulfilled" && analyses[1].value.ok) {
          results.analysis.tone = analyses[1].value.value;
        }

        // Process readability analysis
        if (analyses[2].status === "fulfilled" && analyses[2].value.ok) {
          results.analysis.readability = analyses[2].value.value;
        }

        // Process engagement analysis
        if (analyses[3].status === "fulfilled" && analyses[3].value.ok) {
          results.analysis.engagement = analyses[3].value.value;
        }

        let analysisIndex = 4;

        // Process optimization if requested
        if (includeOptimization && analyses[analysisIndex]) {
          const result = analyses[analysisIndex];
          if (result && result.status === "fulfilled" && result.value.ok) {
            results.optimization = result.value.value;
          }
          analysisIndex++;
        }

        // Process prediction if requested
        if (includePrediction && analyses[analysisIndex]) {
          const result = analyses[analysisIndex];
          if (result && result.status === "fulfilled" && result.value.ok) {
            results.prediction = result.value.value;
          }
          analysisIndex++;
        }

        // Process variations if requested
        if (includeVariations && analyses[analysisIndex]) {
          const result = analyses[analysisIndex];
          if (result && result.status === "fulfilled" && result.value.ok) {
            results.variations = result.value.value;
          }
        }

        return results;
      }
    );
  }

  async getMetrics() {
    return this.execute({ operation: "getMetrics" }, async () => {
      const usageMetrics = aiOrchestrator.getUsageMetrics();
      const cacheStats = aiOrchestrator.getCacheStats();

      return {
        success: true,
        metrics: Object.fromEntries(usageMetrics),
        cache: cacheStats,
        timestamp: new Date().toISOString(),
      };
    });
  }

  async clearCache() {
    return this.execute({ operation: "clearCache" }, async () => {
      aiOrchestrator.clearCache();

      return {
        success: true,
        message: "Cache cleared successfully",
      };
    });
  }
}

export const aiService = new AIService();
