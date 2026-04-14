/**
 * @file aiService.ts
 * @description High-level AI service providing content generation, analysis,
 *   optimization, and smart analysis. Delegates to AiRequestService for
 *   BYOK/pool routing and rate limiting.
 * @layer infrastructure
 */
import { BaseService } from "../services/BaseService.js";
import { AppError } from "../lib/errors/AppError.js";
import { AIOrchestrator } from "./orchestrator.js";
import type { ImageGenerationOptions, ImageGenerationResult, AIResponse, AITask } from "./types.js";
import type { AIMessage, GenerationOptions as AIGenerateOptions } from "./types.js";
import type { AiRequestService } from "./AiRequestService.js";

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
  accountId?: string | undefined;
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
 * @class AIService
 * @description Orchestrates content analysis via external AI providers.
 *   Uses AiRequestService for BYOK/pool routing and rate limiting.
 *   Falls back to env-based orchestrator for admin operations (health, metrics, cache).
 */
export class AIService extends BaseService {
  private adminOrchestrator: AIOrchestrator | null = null;

  constructor(private readonly aiRequestService: AiRequestService) {
    super("AIService");
  }

  /**
   * @method getAdminOrchestrator
   * @description Lazily creates an env-based orchestrator for admin operations
   *   (health checks, metrics, cache) that don't need BYOK routing.
   */
  private getAdminOrchestrator(): AIOrchestrator {
    if (!this.adminOrchestrator) {
      this.adminOrchestrator = AIOrchestrator.createFromEnv();
    }
    return this.adminOrchestrator;
  }

  /**
   * @method healthCheck
   * @description Returns provider health, metrics, and cache stats.
   */
  async healthCheck() {
    return this.execute({ operation: "healthCheck" }, async () => {
      const orchestrator = this.getAdminOrchestrator();
      const health = await orchestrator.healthCheck();
      const availableProviders = orchestrator.getAvailableProviders();
      const usageMetrics = orchestrator.getUsageMetrics();
      const cacheStats = orchestrator.getCacheStats();

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

  /**
   * @method generateContent
   * @description Generates content via BYOK or pool provider.
   * @param messages - Conversation messages
   * @param options - Generation options
   * @param accountId - Account for BYOK/rate-limit resolution
   */
  async generateContent(messages: Message[], options?: GenerateOptions, accountId?: string) {
    return this.execute(
      { operation: "generateContent", metadata: { messageCount: messages.length } },
      async () => {
        if (accountId) {
          const task: AITask = {
            type: "generate",
            data: { messages, ...(options !== undefined && { options }) },
          };
          const result = await this.aiRequestService.executeRequest({ accountId, task });
          if (!result.ok) {
            throw AppError.externalService("AI", `Content generation failed: ${result.error}`);
          }
          return {
            success: true,
            content: result.value.response,
            metadata: {
              provider: result.value.provider,
              model: result.value.model,
              tokensUsed: result.value.tokensUsed,
              isByok: result.value.isByok,
            },
          };
        }

        // Fallback for requests without accountId (legacy)
        const orchestrator = this.getAdminOrchestrator();
        const result = await orchestrator.generateContent(messages, options);
        if (!result.ok) {
          const errorMsg =
            typeof result.error === "string"
              ? result.error
              : result.error?.message || "Content generation failed";
          throw AppError.externalService("AI", errorMsg);
        }
        return { success: true, content: result.value, metadata: result.metadata };
      }
    );
  }

  /**
   * @method analyzeContent
   * @description Analyzes content via BYOK or pool provider.
   */
  async analyzeContent(content: string, analysisType: AnalysisType, accountId?: string) {
    return this.execute({ operation: "analyzeContent", metadata: { analysisType } }, async () => {
      if (accountId) {
        const task: AITask = { type: "analyze", data: { content, analysisType } };
        const result = await this.aiRequestService.executeRequest({ accountId, task });
        if (!result.ok) {
          throw AppError.externalService("AI", `Content analysis failed: ${result.error}`);
        }
        return {
          success: true,
          analysis: result.value.response,
          metadata: {
            provider: result.value.provider,
            model: result.value.model,
            tokensUsed: result.value.tokensUsed,
            isByok: result.value.isByok,
          },
        };
      }

      const orchestrator = this.getAdminOrchestrator();
      const result = await orchestrator.analyzeContent(content, analysisType);
      if (!result.ok) {
        const errorMsg =
          typeof result.error === "string"
            ? result.error
            : result.error?.message || "Content analysis failed";
        throw AppError.externalService("AI", errorMsg);
      }
      return { success: true, analysis: result.value, metadata: result.metadata };
    });
  }

  /**
   * @method optimizeContent
   * @description Optimizes content for a platform via BYOK or pool provider.
   */
  async optimizeContent(
    content: string,
    platform: string,
    brandVoice?: string,
    accountId?: string
  ) {
    return this.execute({ operation: "optimizeContent", metadata: { platform } }, async () => {
      if (accountId) {
        const task: AITask = {
          type: "optimize",
          data: { content, platform, ...(brandVoice && { brandVoice }) },
        };
        const result = await this.aiRequestService.executeRequest({ accountId, task });
        if (!result.ok) {
          throw AppError.externalService("AI", `Content optimization failed: ${result.error}`);
        }
        return {
          success: true,
          optimization: result.value.response,
          metadata: {
            provider: result.value.provider,
            model: result.value.model,
            tokensUsed: result.value.tokensUsed,
            isByok: result.value.isByok,
          },
        };
      }

      const orchestrator = this.getAdminOrchestrator();
      const result = await orchestrator.optimizeContent(content, platform, brandVoice);
      if (!result.ok) {
        const errorMsg =
          typeof result.error === "string"
            ? result.error
            : result.error?.message || "Content optimization failed";
        throw AppError.externalService("AI", errorMsg);
      }
      return { success: true, optimization: result.value, metadata: result.metadata };
    });
  }

  /**
   * @method predictPerformance
   * @description Predicts content performance via BYOK or pool provider.
   */
  async predictPerformance(
    content: string,
    platform: string,
    historicalData?: unknown[],
    accountId?: string
  ) {
    return this.execute({ operation: "predictPerformance", metadata: { platform } }, async () => {
      if (accountId) {
        const task: AITask = {
          type: "predict",
          data: { content, platform, ...(historicalData && { historicalData }) },
        };
        const result = await this.aiRequestService.executeRequest({ accountId, task });
        if (!result.ok) {
          throw AppError.externalService("AI", `Performance prediction failed: ${result.error}`);
        }
        return {
          success: true,
          prediction: result.value.response,
          metadata: {
            provider: result.value.provider,
            model: result.value.model,
            tokensUsed: result.value.tokensUsed,
            isByok: result.value.isByok,
          },
        };
      }

      const orchestrator = this.getAdminOrchestrator();
      const result = await orchestrator.predictPerformance(
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
      return { success: true, prediction: result.value, metadata: result.metadata };
    });
  }

  /**
   * @method generateVariations
   * @description Generates content variations via BYOK or pool provider.
   */
  async generateVariations(
    content: string,
    variationType: VariationType,
    count: number,
    accountId?: string
  ) {
    return this.execute(
      { operation: "generateVariations", metadata: { variationType, count } },
      async () => {
        if (accountId) {
          const task: AITask = { type: "variations", data: { content, variationType, count } };
          const result = await this.aiRequestService.executeRequest({ accountId, task });
          if (!result.ok) {
            throw AppError.externalService("AI", `Variation generation failed: ${result.error}`);
          }
          return {
            success: true,
            variations: result.value.response,
            metadata: {
              provider: result.value.provider,
              model: result.value.model,
              tokensUsed: result.value.tokensUsed,
              isByok: result.value.isByok,
            },
          };
        }

        const orchestrator = this.getAdminOrchestrator();
        const result = await orchestrator.generateVariations(content, variationType, count);
        if (!result.ok) {
          const errorMsg =
            typeof result.error === "string"
              ? result.error
              : result.error?.message || "Variation generation failed";
          throw AppError.externalService("AI", errorMsg);
        }
        return { success: true, variations: result.value, metadata: result.metadata };
      }
    );
  }

  /**
   * @method generateImage
   * @description Generates an image via the admin orchestrator (DALL-E 3).
   *   Image generation always uses pool credentials (no BYOK for images).
   */
  async generateImage(options: ImageGenerationOptions): Promise<AIResponse<ImageGenerationResult>> {
    return this.execute(
      { operation: "generateImage", metadata: { prompt: options.prompt } },
      async () => {
        const orchestrator = this.getAdminOrchestrator();
        return orchestrator.generateImage(options);
      }
    );
  }

  /**
   * @method smartAnalysis
   * @description Runs multiple analyses in parallel for comprehensive content insights.
   */
  async smartAnalysis(params: SmartAnalysisParams): Promise<SmartAnalysisResult> {
    return this.execute(
      {
        operation: "smartAnalysis",
        metadata: { platform: params.platform, includeOptimization: params.includeOptimization },
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
          accountId,
        } = params;

        // For smart analysis, if accountId is available use AiRequestService per sub-task
        // Otherwise fall back to admin orchestrator
        const orchestrator = this.getAdminOrchestrator();

        const makeTask = async <T>(
          task: AITask
        ): Promise<{ ok: boolean; value?: T; metadata: { provider: string } }> => {
          if (accountId) {
            const result = await this.aiRequestService.executeRequest({ accountId, task });
            if (!result.ok) return { ok: false, metadata: { provider: "none" } };
            return {
              ok: true,
              value: result.value.response as T,
              metadata: { provider: result.value.provider },
            };
          }
          return orchestrator.executeTask<T>(task);
        };

        const analyses = await Promise.allSettled([
          makeTask({ type: "analyze", data: { content, analysisType: "sentiment" } }),
          makeTask({ type: "analyze", data: { content, analysisType: "tone" } }),
          makeTask({ type: "analyze", data: { content, analysisType: "readability" } }),
          makeTask({ type: "analyze", data: { content, analysisType: "engagement" } }),
          ...(includeOptimization
            ? [
                makeTask({
                  type: "optimize",
                  data: { content, platform, ...(brandVoice && { brandVoice }) },
                }),
              ]
            : []),
          ...(includePrediction
            ? [makeTask({ type: "predict", data: { content, platform } })]
            : []),
          ...(includeVariations
            ? [
                makeTask({
                  type: "variations",
                  data: { content, variationType: "tone" as const, count: variationCount },
                }),
              ]
            : []),
        ]);

        const results: SmartAnalysisResult = {
          content,
          platform,
          analysis: {},
          metadata: { providersUsed: [], totalLatency: 0, timestamp: new Date().toISOString() },
        };

        if (analyses[0]?.status === "fulfilled" && analyses[0].value.ok) {
          results.analysis.sentiment = analyses[0].value.value;
          results.metadata.providersUsed.push(analyses[0].value.metadata.provider);
        }
        if (analyses[1]?.status === "fulfilled" && analyses[1].value.ok)
          results.analysis.tone = analyses[1].value.value;
        if (analyses[2]?.status === "fulfilled" && analyses[2].value.ok)
          results.analysis.readability = analyses[2].value.value;
        if (analyses[3]?.status === "fulfilled" && analyses[3].value.ok)
          results.analysis.engagement = analyses[3].value.value;

        let idx = 4;
        const optResult = analyses[idx];
        if (includeOptimization && optResult?.status === "fulfilled" && optResult.value.ok) {
          results.optimization = optResult.value.value;
        }
        if (includeOptimization) idx++;
        const predResult = analyses[idx];
        if (includePrediction && predResult?.status === "fulfilled" && predResult.value.ok) {
          results.prediction = predResult.value.value;
        }
        if (includePrediction) idx++;
        const varResult = analyses[idx];
        if (includeVariations && varResult?.status === "fulfilled" && varResult.value.ok) {
          results.variations = varResult.value.value;
        }

        return results;
      }
    );
  }

  /**
   * @method getMetrics
   * @description Returns usage metrics and cache stats from admin orchestrator.
   */
  async getMetrics() {
    return this.execute({ operation: "getMetrics" }, async () => {
      const orchestrator = this.getAdminOrchestrator();
      const usageMetrics = orchestrator.getUsageMetrics();
      const cacheStats = orchestrator.getCacheStats();
      return {
        success: true,
        metrics: Object.fromEntries(usageMetrics),
        cache: cacheStats,
        timestamp: new Date().toISOString(),
      };
    });
  }

  /**
   * @method clearCache
   * @description Clears the admin orchestrator response cache.
   */
  async clearCache() {
    return this.execute({ operation: "clearCache" }, async () => {
      const orchestrator = this.getAdminOrchestrator();
      orchestrator.clearCache();
      return { success: true, message: "Cache cleared successfully" };
    });
  }
}
