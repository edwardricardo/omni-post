import {
  AIProvider,
  AITask,
  AIResponse,
  AITaskConfig,
  AIUsageMetrics,
  ContentAnalysis,
  ContentOptimization,
  PerformancePrediction,
} from "./types.js";
import { AppError } from "../lib/errors/AppError.js";
import { logger } from "../lib/logger.js";

const aiLogger = logger.child({ module: "ai" });
import { OpenAIProvider } from "./providers/openai.js";
import { PerplexityProvider } from "./providers/perplexity.js";
import { GeminiProvider } from "./providers/gemini.js";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

interface CacheHitStats {
  hits: number;
  misses: number;
}

/**
 * Orchestrates requests to external AI providers with caching, rate limiting,
 * and automatic fallback. This class does NOT contain any proprietary ML logic;
 * it routes tasks to third-party LLM APIs (OpenAI, Gemini, Perplexity).
 */
export class AIOrchestrator {
  private providers: Map<string, AIProvider> = new Map();
  private cache: Map<string, CacheEntry<any>> = new Map();
  private cacheHitStats: CacheHitStats = { hits: 0, misses: 0 };
  private usageMetrics: Map<string, AIUsageMetrics> = new Map();
  private rateLimits: Map<string, { requests: number; tokens: number; resetTime: number }> =
    new Map();

  constructor() {
    this.initializeProviders();
    this.startMetricsCollection();
  }

  private initializeProviders() {
    // Initialize providers based on environment variables
    if (process.env.OPENAI_API_KEY) {
      this.providers.set(
        "openai",
        new OpenAIProvider({
          apiKey: process.env.OPENAI_API_KEY,
          model: process.env.OPENAI_MODEL || "gpt-4",
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

    if (process.env.PERPLEXITY_API_KEY) {
      this.providers.set(
        "perplexity",
        new PerplexityProvider({
          apiKey: process.env.PERPLEXITY_API_KEY,
          model: process.env.PERPLEXITY_MODEL || "llama-3.1-sonar-small-128k-online",
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

    if (process.env.GEMINI_API_KEY) {
      this.providers.set(
        "gemini",
        new GeminiProvider({
          apiKey: process.env.GEMINI_API_KEY,
          model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
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

    // Reset rate limits every minute
    setInterval(() => {
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
    }, 60000);
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

  private generateCacheKey(task: AITask): string {
    return `${task.type}:${JSON.stringify(task.data)}`;
  }

  private getCachedResult<T>(cacheKey: string): T | null {
    const entry = this.cache.get(cacheKey);
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.timestamp + entry.ttl) {
      this.cache.delete(cacheKey);
      return null;
    }

    return entry.data;
  }

  private setCachedResult<T>(cacheKey: string, data: T, ttl: number = 300000): void {
    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
      ttl,
    });
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
      const cachedResult = this.getCachedResult<T>(cacheKey);
      if (cachedResult) {
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
    }

    if (config?.cacheResults !== false) {
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
              throw AppError.badRequest(`Unknown task type: ${(task as any).type}`);
          }

          const latency = Date.now() - taskStartTime;
          const estimatedTokens = typeof result === "string" ? result.length / 4 : 1000;

          // Update metrics
          this.updateMetrics(providerName, true, latency, estimatedTokens);

          // Cache the result
          if (config?.cacheResults !== false) {
            this.setCachedResult(cacheKey, result, config?.cacheTTL || 300000);
          }

          return {
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
  async generateContent(messages: any[], options?: any): Promise<AIResponse<string>> {
    return this.executeTask<string>({
      type: "generate",
      data: { messages, options },
    });
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
    historicalData?: any[]
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

  // Utility methods
  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  getUsageMetrics(): Map<string, AIUsageMetrics> {
    return new Map(this.usageMetrics);
  }

  getCacheStats(): { size: number; hitRate: number } {
    const total = this.cacheHitStats.hits + this.cacheHitStats.misses;
    return {
      size: this.cache.size,
      hitRate: total > 0 ? this.cacheHitStats.hits / total : 0,
    };
  }

  clearCache(): void {
    this.cache.clear();
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

// Singleton instance
export const aiOrchestrator = new AIOrchestrator();
