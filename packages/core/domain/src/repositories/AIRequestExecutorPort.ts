/**
 * @file AIRequestExecutorPort.ts
 * @description Port that hides the provider-factory + orchestrator complexity
 *   from `AiRequestService`. Two methods cover the only two execution paths
 *   the routing layer needs: a single-provider BYOK execution and a
 *   multi-provider pool execution with fallback chain. The concrete adapter
 *   (`AIRequestExecutorAdapter`) lives in apps/api and composes
 *   `AIProviderFactory` + `AIOrchestrator` + the BackgroundTaskScheduler +
 *   CachePort behind this boundary.
 *
 *   The token-usage callback is passed in by the application service so
 *   tracking remains where the business logic lives (not in the adapter).
 * @layer domain
 */

import type { AIProviderName, AIResponse, AITask } from "../ai/AIContracts.js";

/**
 * Callback fired once per successful execution with the provider that
 * actually served the request and its token count.
 */
export type AIUsageCallback = (provider: string, tokensUsed: number) => Promise<void>;

export interface AIRequestExecutorPort {
  /**
   * Execute a task using a client-supplied API key for a single provider.
   * The adapter wraps the provider in a fresh orchestrator (no fallback
   * chain — BYOK is a single-provider call).
   */
  executeWithApiKey(
    provider: AIProviderName,
    apiKey: string,
    task: AITask,
    onUsage: AIUsageCallback
  ): Promise<AIResponse<unknown>>;

  /**
   * Execute using the platform pool credentials. The adapter builds a
   * multi-provider chain (preferred first, then the rest) and lets the
   * orchestrator's fallback policy pick a working one.
   *
   * @param poolCredentials - The "AI_POOL" credential bundle (per-provider
   *   api keys + optional models, keyed by `<provider>ApiKey` and
   *   `<provider>Model`).
   * @param preferredProvider - Optional first-choice provider; when omitted
   *   the adapter uses its default ordering.
   */
  executeWithPool(
    poolCredentials: Record<string, string>,
    preferredProvider: AIProviderName | undefined,
    task: AITask,
    onUsage: AIUsageCallback
  ): Promise<AIResponse<unknown>>;
}
