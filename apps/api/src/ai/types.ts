/**
 * @file types.ts
 * @description Local barrel for the AI subsystem. The technology-free
 *   contracts (`AIProvider`, `AITask`, `AIResponse`, content-analysis DTOs)
 *   live in `@core/domain/ai/AIContracts.ts`; this module re-exports them
 *   alongside the message/options primitives from `@core/domain/ai/
 *   AiServiceContract.ts` and the image-generation port. Infrastructure-
 *   only types (provider config, rate-limit config, task config, usage
 *   metrics) remain defined locally.
 * @layer infrastructure
 */

import type {
  AIMessage,
  GenerationOptions,
  StructuredOutputSpec,
} from "@core/domain/ai/AiServiceContract.js";
import type {
  ImageGenerationOptions,
  ImageGenerationResult,
} from "@core/domain/repositories/ImageGenerationPort.js";
import type {
  AIProvider,
  AIProviderName,
  AITask,
  AIResponse,
  ContentAnalysis,
  ContentOptimization,
  PerformancePrediction,
} from "@core/domain/ai/AIContracts.js";

export type { AIMessage, GenerationOptions, StructuredOutputSpec };
export type { ImageGenerationOptions, ImageGenerationResult };
export type {
  AIProvider,
  AIProviderName,
  AITask,
  AIResponse,
  ContentAnalysis,
  ContentOptimization,
  PerformancePrediction,
};

export interface AITaskConfig {
  primaryProvider: AIProviderName;
  fallbackProviders: AIProviderName[];
  retryAttempts: number;
  timeout: number;
  cacheResults: boolean;
  cacheTTL: number;
}

export interface AIUsageMetrics {
  provider: string;
  tokensUsed: number;
  requestCount: number;
  successRate: number;
  averageLatency: number;
  cost: number;
  timestamp: Date;
}

export interface RateLimitConfig {
  requestsPerMinute: number;
  tokensPerMinute: number;
  requestsPerDay: number;
  tokensPerDay: number;
}

export interface AIProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  rateLimit: RateLimitConfig;
  timeout: number;
  retries: number;
}
