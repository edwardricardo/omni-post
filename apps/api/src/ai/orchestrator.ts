/**
 * @file orchestrator.ts
 * @description AI orchestrator that manages multiple LLM providers with load balancing,
 *   caching, usage tracking, and fallback strategies. Accepts providers via constructor
 *   injection — no module-level singleton.
 * @layer infrastructure
 */
import { createHash } from "node:crypto";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import type { CachePort } from "@ports/core";
import {
  AIProvider,
  AITask,
  AIResponse,
  AITaskConfig,
  AIUsageMetrics,
  AIMessage,
  GenerationOptions,
  ContentAnalysis,
  ContentOptimization,
  PerformancePrediction,
  ImageGenerationOptions,
  ImageGenerationResult,
  StructuredOutputSpec,
} from "./types.js";
import { AppError } from "../lib/errors/AppError.js";
import { logger } from "../lib/logger.js";

const aiLogger = logger.child({ module: "ai" });
import { OpenAIProvider } from "./providers/openai.js";
import { PerplexityProvider } from "./providers/perplexity.js";
import { GeminiProvider } from "./providers/gemini.js";
import { env } from "../config/env.js";

/** Callback invoked after each successful AI request with token usage */
type TokenUsageCallback = (provider: string, tokens: number) => Promise<void>;

interface CacheHitStats {
  hits: number;
  misses: number;
}

/**
 * Prompt template version embedded in cache keys. Bump when prompts change to
 * auto-orphan cached responses. Canon: amitkoth, AWS LLM caching — version
 * tokens prevent serving stale outputs after upgrades.
 */
const PROMPT_TEMPLATE_VERSION = "v1";

/**
 * Stable JSON stringify — sorts object keys recursively so semantically
 * equivalent inputs produce identical cache keys. Avoids the
 * `JSON.stringify({a,b}) !== JSON.stringify({b,a})` cache-miss footgun.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map(
    (k) => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k])
  );
  return "{" + entries.join(",") + "}";
}

/**
 * Orchestrates requests to external AI providers with caching, rate limiting,
 * and automatic fallback. This class does NOT contain any proprietary ML logic;
 * it routes tasks to third-party LLM APIs (OpenAI, Gemini, Perplexity).
 */
export class AIOrchestrator {
  private providers: Map<string, AIProvider> = new Map();
  private cacheHitStats: CacheHitStats = { hits: 0, misses: 0 };
  private usageMetrics: Map<string, AIUsageMetrics> = new Map();
  private rateLimits: Map<string, { requests: number; tokens: number; resetTime: number }> =
    new Map();

  /**
   * @constructor
   * @param providers - Pre-built provider map (use AIProviderFactory to create)
   * @param scheduler - Registers the rate-limit-reset background task. Required.
   * @param cache - Distributed cache port for AI response caching. L1+L2 tier
   *   handled by the underlying RedisCacheAdapter; cross-pod hit rate.
   * @param onTokensUsed - Optional callback invoked after each successful request
   */
  constructor(
    providers: Map<string, AIProvider>,
    private readonly scheduler: BackgroundTaskScheduler,
    private readonly cache: CachePort,
    private readonly onTokensUsed?: TokenUsageCallback
  ) {
    this.providers = providers;
    this.startMetricsCollection();
  }

  /**
   * @method createFromEnv
   * @description Creates an orchestrator from environment variables.
   * @deprecated Use AIProviderFactory + constructor injection instead.
   */
  static createFromEnv(scheduler: BackgroundTaskScheduler, cache: CachePort): AIOrchestrator {
    const providers = new Map<string, AIProvider>();

    if (env.OPENAI_API_KEY) {
      providers.set(
        "openai",
        new OpenAIProvider({
          apiKey: env.OPENAI_API_KEY,
          model: env.OPENAI_MODEL || "gpt-4",
          rateLimit: {
            requestsPerMinute: 500,
            tokensPerMinute: 200000,
            requestsPerDay: 10000,
            tokensPerDay: 2000000,
          },
          timeout: 30000,
          retries: 3,
        })
      );
    }

    if (env.PERPLEXITY_API_KEY) {
      providers.set(
        "perplexity",
        new PerplexityProvider({
          apiKey: env.PERPLEXITY_API_KEY,
          model: env.PERPLEXITY_MODEL || "llama-3.1-sonar-small-128k-online",
          baseUrl: "https://api.perplexity.ai",
          rateLimit: {
            requestsPerMinute: 20,
            tokensPerMinute: 20000,
            requestsPerDay: 500,
            tokensPerDay: 200000,
          },
          timeout: 30000,
          retries: 3,
        })
      );
    }

    if (env.GEMINI_API_KEY) {
      providers.set(
        "gemini",
        new GeminiProvider({
          apiKey: env.GEMINI_API_KEY,
          model: env.GEMINI_MODEL || "gemini-1.5-flash",
          rateLimit: {
            requestsPerMinute: 60,
            tokensPerMinute: 30000,
            requestsPerDay: 1500,
            tokensPerDay: 1000000,
          },
          timeout: 30000,
          retries: 3,
        })
      );
    }

    return new AIOrchestrator(providers, scheduler, cache);
  }

  private startMetricsCollection() {
    // Initialize usage metrics for each provider
    for (const [name] of this.providers) {
      this.usageMetrics.set(name, {
        provider: name,
        tokensUsed: 0,
        requestCount: 0,
        successRate: 100,
        averageLatency: 0,
        cost: 0,
        timestamp: new Date(),
      });
    }

    // Reset rate limits every minute — registered via the scheduler so the
    // interval is unref'd, error-wrapped, and cleared during graceful shutdown.
    this.scheduler.register(
      "ai-orchestrator-rate-limit-reset",
      () => {
        const now = Date.now();
        for (const [provider, limits] of this.rateLimits) {
          if (now >= limits.resetTime) {
            this.rateLimits.set(provider, {
              requests: 0,
              tokens: 0,
              resetTime: now + 60000, // Reset in 1 minute
            });
          }
        }
      },
      60000
    );
  }

  private getOptimalProvider(task: AITask): ("openai" | "perplexity" | "gemini")[] {
    // Define provider strengths for different tasks
    const providerStrengths = {
      generate: ["openai", "gemini", "perplexity"],
      analyze: ["openai", "gemini", "perplexity"],
      optimize: ["openai", "gemini", "perplexity"],
      predict: ["perplexity", "gemini", "openai"],
      variations: ["openai", "gemini", "perplexity"],
    };

    const preferredOrder = providerStrengths[task.type] || ["openai", "gemini", "perplexity"];

    // Filter by availability and rate limits
    return preferredOrder.filter(
      (providerName): providerName is "openai" | "perplexity" | "gemini" => {
        const provider = this.providers.get(providerName);
        if (!provider) return false;

        const limits = this.rateLimits.get(providerName);
        if (limits && limits.requests >= 50) return false; // Basic rate limiting

        return true;
      }
    );
  }

  /**
   * Generate a deterministic cache key for a task. Canon: SHA-256 hash of
   * stable-stringified input + version tokens (prompt template, model). This
   * auto-orphans cached entries on prompt-template upgrade and tolerates
   * property-order/whitespace variations in the input.
   *
   * Refs: amitkoth, AWS LLM caching, Brenndoerfer (canon_research_index.md
   * §Caching · LLM / AI-specific).
   */
  private generateCacheKey(task: AITask): string {
    const normalized = stableStringify({
      type: task.type,
      data: task.data,
      promptTemplate: PROMPT_TEMPLATE_VERSION,
    });
    const hash = createHash("sha256").update(normalized).digest("hex");
    return `ai:${task.type}:${hash}`;
  }

  /**
   * Tags for an AI cache entry. Multi-tag canon (Brenndoerfer, oneuptime):
   * `ai` for nuclear admin clear, `ai:task:<type>` for type-targeted
   * invalidation, `ai:model:<id>` for model-targeted invalidation.
   */
  private cacheTags(task: AITask, modelId?: string): readonly string[] {
    const tags = ["ai", `ai:task:${task.type}`];
    if (modelId) tags.push(`ai:model:${modelId}`);
    return tags;
  }

  private async checkRateLimit(
    providerName: string,
    estimatedTokens: number = 1000
  ): Promise<boolean> {
    const limits = this.rateLimits.get(providerName) || {
      requests: 0,
      tokens: 0,
      resetTime: Date.now() + 60000,
    };

    // Simple rate limiting - in production, you'd want more sophisticated limits
    if (limits.requests >= 50 || limits.tokens + estimatedTokens >= 10000) {
      return false;
    }

    limits.requests++;
    limits.tokens += estimatedTokens;
    this.rateLimits.set(providerName, limits);

    return true;
  }

  private updateMetrics(
    providerName: string,
    success: boolean,
    latency: number,
    tokensUsed: number
  ): void {
    const metrics = this.usageMetrics.get(providerName);
    if (!metrics) return;

    metrics.requestCount++;
    metrics.tokensUsed += tokensUsed;
    metrics.averageLatency = (metrics.averageLatency + latency) / 2;

    if (success) {
      metrics.successRate = metrics.successRate * 0.9 + 100 * 0.1;
    } else {
      metrics.successRate = metrics.successRate * 0.9 + 0 * 0.1;
    }

    // Rough cost calculation (you'd use actual provider pricing)
    const costPerToken = {
      openai: 0.00003,
      perplexity: 0.00002,
      gemini: 0.000001,
    };

    metrics.cost +=
      tokensUsed * (costPerToken[providerName as keyof typeof costPerToken] || 0.00003);
    metrics.timestamp = new Date();
  }

  async executeTask<T>(task: AITask, config?: Partial<AITaskConfig>): Promise<AIResponse<T>> {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(task);

    // Check cache first
    if (config?.cacheResults !== false) {
      const cachedResult = await this.cache.get<T>(cacheKey);
      if (cachedResult !== null) {
        this.cacheHitStats.hits++;
        return {
          ok: true,
          value: cachedResult,
          metadata: {
            provider: "cache",
            model: "cached",
            tokensUsed: 0,
            latency: Date.now() - startTime,
            cached: true,
          },
        };
      }
      this.cacheHitStats.misses++;
    }

    const providerOrder = this.getOptimalProvider(task);
    const maxRetries = config?.retryAttempts || 3;

    for (const providerName of providerOrder) {
      const provider = this.providers.get(providerName);
      if (!provider) continue;

      // Check rate limits
      if (!(await this.checkRateLimit(providerName))) {
        aiLogger.warn({ provider: providerName }, "Rate limit exceeded, trying next provider");
        continue;
      }

      // Check provider availability
      if (!(await provider.isAvailable())) {
        aiLogger.warn({ provider: providerName }, "Provider not available, trying next provider");
        continue;
      }

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const taskStartTime = Date.now();
          let result: T;

          // Execute the task based on type
          switch (task.type) {
            case "generate":
              result = (await provider.generateText(task.data.messages, task.data.options)) as T;
              break;

            case "analyze":
              result = (await provider.analyzeContent(
                task.data.content,
                task.data.analysisType
              )) as T;
              break;

            case "optimize":
              result = (await provider.optimizeContent(
                task.data.content,
                task.data.platform,
                task.data.brandVoice
              )) as T;
              break;

            case "predict":
              result = (await provider.predictPerformance(
                task.data.content,
                task.data.platform,
                task.data.historicalData
              )) as T;
              break;

            case "variations":
              result = (await provider.generateVariations(
                task.data.content,
                task.data.variationType,
                task.data.count
              )) as T;
              break;

            default:
              throw AppError.badRequest(
                `Unknown task type: ${(task as Record<string, unknown>).type}`
              );
          }

          const latency = Date.now() - taskStartTime;
          const estimatedTokens = typeof result === "string" ? result.length / 4 : 1000;

          // Update metrics
          this.updateMetrics(providerName, true, latency, estimatedTokens);

          // Cache the result. TTL canon: default 1h for stable LLM outputs;
          // override via cacheTTL only for time-sensitive tasks. Tags allow
          // targeted invalidation (admin clearCache → invalidateByTag("ai"),
          // model upgrade → invalidateByTag(`ai:model:${modelId}`)).
          if (config?.cacheResults !== false) {
            const ttlMs = config?.cacheTTL ?? 3_600_000;
            const ttlSeconds = Math.max(1, Math.floor(ttlMs / 1000));
            await this.cache.set(cacheKey, result, {
              ttlSeconds,
              tags: this.cacheTags(task, provider.name),
            });
          }

          const response: AIResponse<T> = {
            ok: true,
            value: result,
            metadata: {
              provider: providerName,
              model: provider.name,
              tokensUsed: estimatedTokens,
              latency,
              cached: false,
            },
          };

          // Track token usage via callback (never throws)
          if (this.onTokensUsed && estimatedTokens > 0) {
            await this.onTokensUsed(providerName, estimatedTokens).catch((err) =>
              aiLogger.warn({ err }, "Failed to track token usage")
            );
          }

          return response;
        } catch (_error: unknown) {
          const latency = Date.now() - startTime;
          this.updateMetrics(providerName, false, latency, 0);

          aiLogger.error(
            { err: _error, attempt: attempt + 1, provider: providerName },
            "AI provider attempt failed"
          );

          if (attempt === maxRetries - 1) {
            // Last attempt for this provider failed, try next provider
            break;
          }

          // Wait before retrying (exponential backoff)
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    // All providers failed
    return {
      ok: false,
      error: {
        code: "ALL_PROVIDERS_FAILED",
        message: "All AI providers failed to complete the task",
        provider: "none",
        retryable: true,
      },
      metadata: {
        provider: "none",
        model: "none",
        tokensUsed: 0,
        latency: Date.now() - startTime,
        cached: false,
      },
    };
  }

  // Convenience methods for specific tasks
  async generateContent(
    messages: AIMessage[],
    options?: GenerationOptions
  ): Promise<AIResponse<string>> {
    return this.executeTask<string>({
      type: "generate",
      data: { messages, ...(options !== undefined && { options }) },
    });
  }

  /**
   * @method generateStructured
   * @description Schema-validated structured generation with the same
   *   provider-selection, rate-limit, availability, retry/backoff, metrics and
   *   cache semantics as `executeTask`, but routed to each provider's NATIVE
   *   structured-output capability via `provider.generateStructured`. The
   *   cache key is derived ONLY from serializable spec fields (name +
   *   jsonSchema) + messages + options — never `spec.parse` (a function).
   * @param messages - Conversation messages.
   * @param spec - Technology-free structured-output spec (name/schema/parse).
   * @param options - Generation options (model, tokens, temperature).
   * @param config - Cache/retry overrides (same shape as `executeTask`).
   * @returns AIResponse with the validated value `T`, or an all-failed error.
   */
  async generateStructured<T>(
    messages: AIMessage[],
    spec: StructuredOutputSpec<T>,
    options?: GenerationOptions,
    config?: Partial<AITaskConfig>
  ): Promise<AIResponse<T>> {
    const startTime = Date.now();
    const normalized = stableStringify({
      kind: "structured",
      name: spec.name,
      jsonSchema: spec.jsonSchema,
      messages,
      ...(options !== undefined && { options }),
      promptTemplate: PROMPT_TEMPLATE_VERSION,
    });
    const cacheKey = `ai:structured:${createHash("sha256").update(normalized).digest("hex")}`;

    if (config?.cacheResults !== false) {
      const cachedResult = await this.cache.get<T>(cacheKey);
      if (cachedResult !== null) {
        this.cacheHitStats.hits++;
        return {
          ok: true,
          value: cachedResult,
          metadata: {
            provider: "cache",
            model: "cached",
            tokensUsed: 0,
            latency: Date.now() - startTime,
            cached: true,
          },
        };
      }
      this.cacheHitStats.misses++;
    }

    const providerOrder = this.getOptimalProvider({
      type: "generate",
      data: { messages, ...(options !== undefined && { options }) },
    });
    const maxRetries = config?.retryAttempts || 3;

    for (const providerName of providerOrder) {
      const provider = this.providers.get(providerName);
      if (!provider) continue;

      if (!(await this.checkRateLimit(providerName))) {
        aiLogger.warn({ provider: providerName }, "Rate limit exceeded, trying next provider");
        continue;
      }

      if (!(await provider.isAvailable())) {
        aiLogger.warn({ provider: providerName }, "Provider not available, trying next provider");
        continue;
      }

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const taskStartTime = Date.now();
          const value = await provider.generateStructured<T>(messages, spec, options);
          const latency = Date.now() - taskStartTime;
          const estimatedTokens = 1000;

          this.updateMetrics(providerName, true, latency, estimatedTokens);

          if (config?.cacheResults !== false) {
            const ttlMs = config?.cacheTTL ?? 3_600_000;
            const ttlSeconds = Math.max(1, Math.floor(ttlMs / 1000));
            await this.cache.set(cacheKey, value, {
              ttlSeconds,
              tags: ["ai", "ai:task:structured", `ai:model:${provider.name}`],
            });
          }

          if (this.onTokensUsed && estimatedTokens > 0) {
            await this.onTokensUsed(providerName, estimatedTokens).catch((err) =>
              aiLogger.warn({ err }, "Failed to track token usage")
            );
          }

          return {
            ok: true,
            value,
            metadata: {
              provider: providerName,
              model: provider.name,
              tokensUsed: estimatedTokens,
              latency,
              cached: false,
            },
          };
        } catch (_error: unknown) {
          const latency = Date.now() - startTime;
          this.updateMetrics(providerName, false, latency, 0);
          aiLogger.error(
            { err: _error, attempt: attempt + 1, provider: providerName },
            "AI structured provider attempt failed"
          );
          if (attempt === maxRetries - 1) break;
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    return {
      ok: false,
      error: {
        code: "ALL_PROVIDERS_FAILED",
        message: "All AI providers failed to complete the structured task",
        provider: "none",
        retryable: true,
      },
      metadata: {
        provider: "none",
        model: "none",
        tokensUsed: 0,
        latency: Date.now() - startTime,
        cached: false,
      },
    };
  }

  async analyzeContent(
    content: string,
    analysisType: "sentiment" | "tone" | "readability" | "engagement"
  ): Promise<AIResponse<Partial<ContentAnalysis>>> {
    return this.executeTask<Partial<ContentAnalysis>>({
      type: "analyze",
      data: { content, analysisType },
    });
  }

  async optimizeContent(
    content: string,
    platform: string,
    brandVoice?: string
  ): Promise<AIResponse<ContentOptimization>> {
    return this.executeTask<ContentOptimization>({
      type: "optimize",
      data: {
        content,
        platform,
        ...(brandVoice && { brandVoice }),
      },
    });
  }

  async predictPerformance(
    content: string,
    platform: string,
    historicalData?: Record<string, unknown>[]
  ): Promise<AIResponse<PerformancePrediction>> {
    return this.executeTask<PerformancePrediction>({
      type: "predict",
      data: {
        content,
        platform,
        ...(historicalData && { historicalData }),
      },
    });
  }

  async generateVariations(
    content: string,
    variationType: "tone" | "length" | "audience",
    count: number
  ): Promise<AIResponse<string[]>> {
    return this.executeTask<string[]>({
      type: "variations",
      data: { content, variationType, count },
    });
  }

  /**
   * @method generateImage
   * @description Generates an image by delegating to the first available provider
   *              that supports OpenAI image generation.
   * @param options - Image generation options
   * @returns AIResponse with the generated image URL and revised prompt
   */
  async generateImage(options: ImageGenerationOptions): Promise<AIResponse<ImageGenerationResult>> {
    const startTime = Date.now();

    // Find a provider that supports image generation
    const providerNames = ["openai"] as const;
    for (const name of providerNames) {
      const provider = this.providers.get(name);
      if (!provider || !provider.generateImage) continue;

      if (!(await this.checkRateLimit(name))) {
        aiLogger.warn({ provider: name }, "Rate limit exceeded for image generation");
        continue;
      }

      const result = await provider.generateImage(options);
      const latency = Date.now() - startTime;
      this.updateMetrics(name, result.ok, latency, 0);
      return result;
    }

    return {
      ok: false,
      error: {
        code: "NO_IMAGE_PROVIDER",
        message: "No AI provider available for image generation",
        provider: "none",
        retryable: false,
      },
      metadata: {
        provider: "none",
        model: "none",
        tokensUsed: 0,
        latency: Date.now() - startTime,
        cached: false,
      },
    };
  }

  // Utility methods
  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  getUsageMetrics(): Map<string, AIUsageMetrics> {
    return new Map(this.usageMetrics);
  }

  /**
   * Hit-rate metric for AI cache. Note: `size` field was dropped post
   * CachePort migration — it represented per-instance Map size, which is
   * misleading info in multi-pod deployments. Cluster-wide cache stats are
   * available via Prometheus metrics emitted by `RedisCacheManager.getStats()`.
   */
  getCacheStats(): { hitRate: number } {
    const total = this.cacheHitStats.hits + this.cacheHitStats.misses;
    return {
      hitRate: total > 0 ? this.cacheHitStats.hits / total : 0,
    };
  }

  async clearCache(): Promise<void> {
    await this.cache.invalidateByTag("ai");
    this.cacheHitStats = { hits: 0, misses: 0 };
  }

  async healthCheck(): Promise<Record<string, boolean>> {
    const health: Record<string, boolean> = {};

    for (const [name, provider] of this.providers) {
      try {
        health[name] = await provider.isAvailable();
      } catch {
        health[name] = false;
      }
    }

    return health;
  }
}

// Legacy singleton removed — use DI container with AIOrchestrator.createFromEnv() or AiRequestService
