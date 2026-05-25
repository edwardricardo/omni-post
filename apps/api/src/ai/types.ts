/**
 * @file types.ts
 * @description Type definitions for the AI subsystem including provider interfaces,
 *              generation options, content analysis, optimization, and prediction types.
 *              The "AI" prefix refers to external LLM provider integrations (OpenAI,
 *              Gemini, Perplexity), not proprietary ML models.
 * @layer infrastructure
 */

// The AI service port's technology-free contract types are owned by the domain
// core. Re-exported here so this module's existing consumers and the
// `AIProvider` interface below keep resolving them from the same path.
import {
  AIMessage,
  GenerationOptions,
  StructuredOutputSpec,
} from "@core/domain/ai/AiServiceContract.js";

export type { AIMessage, GenerationOptions, StructuredOutputSpec };

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

export interface ImageGenerationOptions {
  prompt: string;
  size?: "1024x1024" | "1024x1792" | "1792x1024";
  quality?: "standard" | "hd";
  style?: "natural" | "vivid";
  n?: number;
}

export interface ImageGenerationResult {
  imageUrl: string;
  revisedPrompt: string;
}

export interface AIProvider {
  name: "openai" | "anthropic" | "perplexity" | "gemini";
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

export interface AITaskConfig {
  primaryProvider: AIProvider["name"];
  fallbackProviders: AIProvider["name"][];
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

export interface AIResponse<T = any> {
  ok: boolean;
  value?: T;
  error?: {
    code: string;
    message: string;
    provider: string;
    retryable: boolean;
  };
  metadata: {
    provider: string;
    model: string;
    tokensUsed: number;
    latency: number;
    cached: boolean;
  };
}
