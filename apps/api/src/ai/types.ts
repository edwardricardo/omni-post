/**
 * @file types.ts
 * @description Type definitions for the AI subsystem including provider interfaces,
 *              generation options, content analysis, optimization, and prediction types.
 *              The "AI" prefix refers to external LLM provider integrations (OpenAI,
 *              Gemini, Perplexity), not proprietary ML models.
 * @layer infrastructure
 */

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerationOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stream?: boolean;
  timeout?: number;
}

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
