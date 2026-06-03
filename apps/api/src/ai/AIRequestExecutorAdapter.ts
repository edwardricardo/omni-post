/**
 * @file AIRequestExecutorAdapter.ts
 * @description Concrete adapter implementing `AIRequestExecutorPort`. Wraps
 *   `AIProviderFactory` + `AIOrchestrator` so `AiRequestService` (now in
 *   @core/ai/) can execute BYOK and pool requests without
 *   depending on either concrete.
 * @layer infrastructure
 */

import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import type { CachePort } from "@ports/core";
import type {
  AIRequestExecutorPort,
  AIUsageCallback,
} from "@core/domain/repositories/AIRequestExecutorPort.js";
import type {
  AIProvider,
  AIProviderName,
  AIResponse,
  AITask,
} from "@core/domain/ai/AIContracts.js";
import { AIOrchestrator } from "./orchestrator.js";
import { AIProviderFactory } from "./AIProviderFactory.js";
import type { AICircuitBreaker } from "./providers/AICircuitBreaker.js";
import type { RateLimiterPort } from "@ports/core";

const POOL_PROVIDER_ORDER: AIProviderName[] = ["openai", "anthropic", "gemini", "perplexity"];

const PROVIDER_KEY_MAP: Record<AIProviderName, string> = {
  openai: "openaiApiKey",
  anthropic: "anthropicApiKey",
  gemini: "geminiApiKey",
  perplexity: "perplexityApiKey",
};

const PROVIDER_MODEL_MAP: Record<AIProviderName, string> = {
  openai: "openaiModel",
  anthropic: "anthropicModel",
  gemini: "geminiModel",
  perplexity: "perplexityModel",
};

export class AIRequestExecutorAdapter implements AIRequestExecutorPort {
  constructor(
    private readonly scheduler: BackgroundTaskScheduler,
    private readonly cache: CachePort,
    private readonly circuitBreaker?: AICircuitBreaker,
    private readonly rateLimiter?: RateLimiterPort
  ) {}

  async executeWithApiKey(
    providerName: AIProviderName,
    apiKey: string,
    task: AITask,
    onUsage: AIUsageCallback
  ): Promise<AIResponse<unknown>> {
    const provider = AIProviderFactory.createProvider(providerName, apiKey);
    const providers = new Map<string, AIProvider>([[providerName, provider]]);

    const orchestrator = new AIOrchestrator(
      providers,
      this.scheduler,
      this.cache,
      onUsage,
      this.circuitBreaker,
      this.rateLimiter
    );

    return orchestrator.executeTask(task);
  }

  async executeWithPool(
    poolCredentials: Record<string, string>,
    preferredProvider: AIProviderName | undefined,
    task: AITask,
    onUsage: AIUsageCallback
  ): Promise<AIResponse<unknown>> {
    const ordered: AIProviderName[] = preferredProvider
      ? [preferredProvider, ...POOL_PROVIDER_ORDER.filter((p) => p !== preferredProvider)]
      : POOL_PROVIDER_ORDER;

    const providers = new Map<string, AIProvider>();
    for (const name of ordered) {
      const apiKey = poolCredentials[PROVIDER_KEY_MAP[name]];
      const model = poolCredentials[PROVIDER_MODEL_MAP[name]];
      if (apiKey) {
        providers.set(name, AIProviderFactory.createProvider(name, apiKey, model));
      }
    }

    if (providers.size === 0) {
      return {
        ok: false,
        error: {
          code: "NO_PROVIDERS_CONFIGURED",
          message: "No pool providers configured",
          provider: "pool",
          retryable: false,
          category: "unexpected",
        },
        metadata: { provider: "pool", model: "n/a", tokensUsed: 0, latency: 0, cached: false },
      };
    }

    const orchestrator = new AIOrchestrator(
      providers,
      this.scheduler,
      this.cache,
      onUsage,
      this.circuitBreaker,
      this.rateLimiter
    );

    return orchestrator.executeTask(task);
  }
}
