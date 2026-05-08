/**
 * @file types.test.ts
 * @description Tests for AITypes - Message Structure
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import type {
  AIMessage,
  GenerationOptions,
  ContentAnalysis,
  ContentOptimization,
  PerformancePrediction,
  AIProvider,
  AIProviderConfig,
  AITaskConfig,
  AIUsageMetrics,
  RateLimitConfig,
  AITask,
  AIResponse,
} from "../../../src/ai/types.js";

describe("AITypes - Message Structure", () => {
  it("should validate AIMessage with system role", () => {
    const message: AIMessage = {
      role: "system",
      content: "You are a helpful assistant",
    };

    expect(message.role).toBe("system");
    expect(message.content).toBe("You are a helpful assistant");
  });

  it("should validate AIMessage with user role", () => {
    const message: AIMessage = {
      role: "user",
      content: "Hello, how are you?",
    };

    expect(message.role).toBe("user");
    expect(message.content).toBe("Hello, how are you?");
  });

  it("should validate AIMessage with assistant role", () => {
    const message: AIMessage = {
      role: "assistant",
      content: "I'm doing well, thank you!",
    };

    expect(message.role).toBe("assistant");
    expect(message.content).toBe("I'm doing well, thank you!");
  });
});

describe("AITypes - Generation Options", () => {
  it("should validate GenerationOptions with all fields", () => {
    const options: GenerationOptions = {
      model: "gpt-4",
      maxTokens: 1000,
      temperature: 0.7,
      topP: 0.9,
      frequencyPenalty: 0.5,
      presencePenalty: 0.3,
      stream: false,
      timeout: 30000,
    };

    expect(options.model).toBe("gpt-4");
    expect(options.maxTokens).toBe(1000);
    expect(options.temperature).toBe(0.7);
    expect(options.topP).toBe(0.9);
    expect(options.frequencyPenalty).toBe(0.5);
    expect(options.presencePenalty).toBe(0.3);
    expect(options.stream).toBe(false);
    expect(options.timeout).toBe(30000);
  });

  it("should validate GenerationOptions with minimal fields", () => {
    const options: GenerationOptions = {
      temperature: 0.5,
    };

    expect(options.temperature).toBe(0.5);
  });

  it("should allow empty GenerationOptions", () => {
    const options: GenerationOptions = {};
    expect(options).toStrictEqual({});
  });
});

describe("AITypes - Content Analysis Structure", () => {
  it("should validate complete ContentAnalysis structure", () => {
    const analysis: ContentAnalysis = {
      sentiment: {
        score: 0.8,
        label: "positive",
        confidence: 0.95,
      },
      tone: {
        detected: "professional",
        confidence: 0.9,
        suggestions: ["Add more personal touches", "Use contractions"],
      },
      readability: {
        score: 75,
        level: "High School",
        suggestions: ["Simplify complex sentences", "Use common vocabulary"],
      },
      brandConsistency: {
        score: 85,
        voice: "friendly",
        suggestions: ["Maintain tone consistency", "Use brand keywords"],
      },
      engagement: {
        score: 90,
        factors: [
          { factor: "emotional appeal", impact: 80, suggestion: "Add storytelling" },
          { factor: "call-to-action", impact: 95, suggestion: "Strong CTA present" },
        ],
      },
    };

    expect(analysis.sentiment.score).toBe(0.8);
    expect(analysis.sentiment.label).toBe("positive");
    expect(analysis.tone.detected).toBe("professional");
    expect(analysis.readability.level).toBe("High School");
    expect(analysis.brandConsistency.voice).toBe("friendly");
    expect(analysis.engagement.factors.length).toBe(2);
  });

  it("should validate sentiment with negative score", () => {
    const sentiment = {
      score: -0.6,
      label: "negative" as const,
      confidence: 0.85,
    };

    expect(sentiment.score).toBe(-0.6);
    expect(sentiment.label).toBe("negative");
  });

  it("should validate sentiment with neutral label", () => {
    const sentiment = {
      score: 0.0,
      label: "neutral" as const,
      confidence: 0.9,
    };

    expect(sentiment.label).toBe("neutral");
  });
});

describe("AITypes - Content Optimization Structure", () => {
  it("should validate complete ContentOptimization structure", () => {
    const optimization: ContentOptimization = {
      optimizedText: "Check out our new product! 🚀 #innovation",
      changes: [
        {
          type: "added",
          original: "Check out our new product",
          optimized: "Check out our new product! 🚀",
          reason: "Added excitement and emoji",
        },
        {
          type: "modified",
          original: ".",
          optimized: "! #innovation",
          reason: "Changed punctuation and added hashtag",
        },
      ],
      hashtags: ["innovation", "product", "launch"],
      mentions: ["techinfluencer", "industry_leader"],
      mediasuggestions: [
        { type: "image", description: "Product showcase", dimensions: "1200x628" },
        { type: "video", description: "Product demo", dimensions: "1920x1080" },
      ],
      platformSpecific: {
        twitter: {
          text: "Optimized for Twitter with 280 char limit",
          characterCount: 250,
          optimizations: ["Added hashtags", "Included emoji", "Call to action"],
        },
        linkedin: {
          text: "Professional version for LinkedIn",
          characterCount: 500,
          optimizations: ["Professional tone", "Industry keywords"],
        },
      },
    };

    expect(optimization.optimizedText.includes("🚀")).toBe(true);
    expect(optimization.changes.length).toBe(2);
    expect(optimization.hashtags.length).toBe(3);
    expect(optimization.mentions.length).toBe(2);
    expect(optimization.mediasuggestions.length).toBe(2);
    expect(optimization.platformSpecific.twitter).toBeTruthy();
    expect(optimization.platformSpecific.linkedin).toBeTruthy();
  });

  it("should validate change types", () => {
    const changes = [
      { type: "added" as const, original: "", optimized: "new text", reason: "Addition" },
      { type: "removed" as const, original: "old text", optimized: "", reason: "Removal" },
      { type: "modified" as const, original: "old", optimized: "new", reason: "Modification" },
    ];

    expect(changes[0].type).toBe("added");
    expect(changes[1].type).toBe("removed");
    expect(changes[2].type).toBe("modified");
  });

  it("should validate media suggestion types", () => {
    const mediaSuggestions = [
      { type: "image" as const, description: "Photo", dimensions: "1080x1080" },
      { type: "video" as const, description: "Clip", dimensions: "1920x1080" },
    ];

    expect(mediaSuggestions[0].type).toBe("image");
    expect(mediaSuggestions[1].type).toBe("video");
  });
});

describe("AITypes - Performance Prediction Structure", () => {
  it("should validate complete PerformancePrediction structure", () => {
    const prediction: PerformancePrediction = {
      platform: "twitter",
      metrics: {
        expectedEngagement: {
          value: 150,
          confidence: 0.85,
          range: { min: 100, max: 200 },
        },
        expectedReach: {
          value: 5000,
          confidence: 0.8,
          range: { min: 3000, max: 7000 },
        },
        viralPotential: 65,
        conversionPotential: 45,
      },
      optimalTiming: {
        hour: 14,
        day: "Tuesday",
        timezone: "UTC",
        confidence: 0.9,
      },
      competitiveAnalysis: {
        benchmarkScore: 78,
        opportunities: ["Trending topic alignment", "Audience engagement peak"],
        threats: ["High competition", "Algorithm changes"],
      },
    };

    expect(prediction.platform).toBe("twitter");
    expect(prediction.metrics.expectedEngagement.value).toBe(150);
    expect(prediction.metrics.expectedEngagement.range.min).toBe(100);
    expect(prediction.optimalTiming.hour).toBe(14);
    expect(prediction.optimalTiming.day).toBe("Tuesday");
    expect(prediction.competitiveAnalysis.opportunities.length).toBe(2);
    expect(prediction.competitiveAnalysis.threats.length).toBe(2);
  });

  it("should validate metric ranges", () => {
    const metric = {
      value: 100,
      confidence: 0.75,
      range: { min: 50, max: 150 },
    };

    expect(metric.value >= metric.range.min).toBeTruthy();
    expect(metric.value <= metric.range.max).toBeTruthy();
  });
});

describe("AITypes - Provider Config Structure", () => {
  it("should validate complete AIProviderConfig", () => {
    const config: AIProviderConfig = {
      apiKey: "test-api-key",
      baseUrl: "https://api.example.com",
      model: "gpt-4",
      rateLimit: {
        requestsPerMinute: 60,
        tokensPerMinute: 100000,
        requestsPerDay: 1000,
        tokensPerDay: 1000000,
      },
      timeout: 30000,
      retries: 3,
    };

    expect(config.apiKey).toBe("test-api-key");
    expect(config.baseUrl).toBe("https://api.example.com");
    expect(config.model).toBe("gpt-4");
    expect(config.rateLimit.requestsPerMinute).toBe(60);
    expect(config.timeout).toBe(30000);
    expect(config.retries).toBe(3);
  });

  it("should validate RateLimitConfig structure", () => {
    const rateLimit: RateLimitConfig = {
      requestsPerMinute: 60,
      tokensPerMinute: 100000,
      requestsPerDay: 1000,
      tokensPerDay: 1000000,
    };

    expect(rateLimit.requestsPerMinute).toBe(60);
    expect(rateLimit.tokensPerMinute).toBe(100000);
    expect(rateLimit.requestsPerDay).toBe(1000);
    expect(rateLimit.tokensPerDay).toBe(1000000);
  });
});

describe("AITypes - Task Configuration", () => {
  it("should validate AITaskConfig with all providers", () => {
    const config: AITaskConfig = {
      primaryProvider: "openai",
      fallbackProviders: ["anthropic", "perplexity", "gemini"],
      retryAttempts: 3,
      timeout: 30000,
      cacheResults: true,
      cacheTTL: 3600,
    };

    expect(config.primaryProvider).toBe("openai");
    expect(config.fallbackProviders.length).toBe(3);
    expect(config.retryAttempts).toBe(3);
    expect(config.cacheResults).toBe(true);
  });

  it("should validate provider names", () => {
    const providers: Array<AIProvider["name"]> = ["openai", "anthropic", "perplexity", "gemini"];

    expect(providers.length).toBe(4);
    expect(providers.includes("openai")).toBeTruthy();
    expect(providers.includes("anthropic")).toBeTruthy();
    expect(providers.includes("perplexity")).toBeTruthy();
    expect(providers.includes("gemini")).toBeTruthy();
  });
});

describe("AITypes - Usage Metrics", () => {
  it("should validate AIUsageMetrics structure", () => {
    const metrics: AIUsageMetrics = {
      provider: "openai",
      tokensUsed: 1500,
      requestCount: 10,
      successRate: 0.95,
      averageLatency: 250,
      cost: 0.05,
      timestamp: new Date("2024-10-05T12:00:00Z"),
    };

    expect(metrics.provider).toBe("openai");
    expect(metrics.tokensUsed).toBe(1500);
    expect(metrics.requestCount).toBe(10);
    expect(metrics.successRate).toBe(0.95);
    expect(metrics.averageLatency).toBe(250);
    expect(metrics.cost).toBe(0.05);
    expect(metrics.timestamp instanceof Date).toBeTruthy();
  });

  it("should calculate success rate correctly", () => {
    const successCount = 19;
    const totalCount = 20;
    const successRate = successCount / totalCount;

    const metrics: AIUsageMetrics = {
      provider: "gemini",
      tokensUsed: 2000,
      requestCount: totalCount,
      successRate: successRate,
      averageLatency: 300,
      cost: 0.02,
      timestamp: new Date(),
    };

    expect(metrics.successRate).toBe(0.95);
  });
});

describe("AITypes - AI Tasks", () => {
  it("should validate generate task", () => {
    const task: AITask = {
      type: "generate",
      data: {
        messages: [{ role: "user", content: "Test" }],
        options: { temperature: 0.7 },
      },
    };

    expect(task.type).toBe("generate");
    expect(task.data.messages).toBeTruthy();
  });

  it("should validate analyze task", () => {
    const task: AITask = {
      type: "analyze",
      data: {
        content: "Test content",
        analysisType: "sentiment",
      },
    };

    expect(task.type).toBe("analyze");
    expect(task.data.analysisType).toBe("sentiment");
  });

  it("should validate optimize task", () => {
    const task: AITask = {
      type: "optimize",
      data: {
        content: "Test content",
        platform: "twitter",
        brandVoice: "professional",
      },
    };

    expect(task.type).toBe("optimize");
    expect(task.data.platform).toBe("twitter");
  });

  it("should validate predict task", () => {
    const task: AITask = {
      type: "predict",
      data: {
        content: "Test content",
        platform: "linkedin",
        historicalData: [{ engagement: 100 }],
      },
    };

    expect(task.type).toBe("predict");
    expect(task.data.historicalData).toBeTruthy();
  });

  it("should validate variations task", () => {
    const task: AITask = {
      type: "variations",
      data: {
        content: "Test content",
        variationType: "tone",
        count: 5,
      },
    };

    expect(task.type).toBe("variations");
    expect(task.data.variationType).toBe("tone");
    expect(task.data.count).toBe(5);
  });

  it("should validate all analysis types", () => {
    const analysisTypes: Array<"sentiment" | "tone" | "readability" | "engagement"> = [
      "sentiment",
      "tone",
      "readability",
      "engagement",
    ];

    expect(analysisTypes.length).toBe(4);
  });

  it("should validate all variation types", () => {
    const variationTypes: Array<"tone" | "length" | "audience"> = ["tone", "length", "audience"];

    expect(variationTypes.length).toBe(3);
  });
});

describe("AITypes - AI Response", () => {
  it("should validate successful AIResponse", () => {
    const response: AIResponse<string> = {
      ok: true,
      value: "Generated text response",
      metadata: {
        provider: "openai",
        model: "gpt-4",
        tokensUsed: 150,
        latency: 250,
        cached: false,
      },
    };

    expect(response.ok).toBe(true);
    expect(response.value).toBe("Generated text response");
    expect(response.metadata.provider).toBe("openai");
    expect(response.metadata.cached).toBe(false);
  });

  it("should validate failed AIResponse with error", () => {
    const response: AIResponse = {
      ok: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Rate limit exceeded, please try again later",
        provider: "openai",
        retryable: true,
      },
      metadata: {
        provider: "openai",
        model: "gpt-4",
        tokensUsed: 0,
        latency: 100,
        cached: false,
      },
    };

    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(response.error?.retryable).toBe(true);
  });

  it("should validate cached response", () => {
    const response: AIResponse<ContentAnalysis> = {
      ok: true,
      value: {
        sentiment: { score: 0.8, label: "positive", confidence: 0.9 },
        tone: { detected: "friendly", confidence: 0.85, suggestions: [] },
        readability: { score: 80, level: "8th Grade", suggestions: [] },
        brandConsistency: { score: 90, voice: "casual", suggestions: [] },
        engagement: { score: 85, factors: [] },
      },
      metadata: {
        provider: "gemini",
        model: "gemini-1.5-flash",
        tokensUsed: 0,
        latency: 5,
        cached: true,
      },
    };

    expect(response.ok).toBe(true);
    expect(response.metadata.cached).toBe(true);
    expect(response.metadata.latency).toBe(5);
  });

  it("should validate non-retryable error", () => {
    const error = {
      code: "INVALID_API_KEY",
      message: "Authentication failed",
      provider: "perplexity",
      retryable: false,
    };

    expect(error.retryable).toBe(false);
  });
});

describe("AITypes - Type Guards and Utilities", () => {
  it("should differentiate between task types", () => {
    const generateTask: AITask = {
      type: "generate",
      data: { messages: [{ role: "user", content: "Test" }] },
    };

    const analyzeTask: AITask = {
      type: "analyze",
      data: { content: "Test", analysisType: "sentiment" },
    };

    expect(generateTask.type).not.toBe(analyzeTask.type);
  });

  it("should validate response with generic type", () => {
    const textResponse: AIResponse<string> = {
      ok: true,
      value: "Text",
      metadata: {
        provider: "openai",
        model: "gpt-4",
        tokensUsed: 50,
        latency: 200,
        cached: false,
      },
    };

    const analysisResponse: AIResponse<Partial<ContentAnalysis>> = {
      ok: true,
      value: { sentiment: { score: 0.5, label: "neutral", confidence: 0.8 } },
      metadata: {
        provider: "gemini",
        model: "gemini-1.5-flash",
        tokensUsed: 100,
        latency: 300,
        cached: false,
      },
    };

    expect(typeof textResponse.value).toBe("string");
    expect(typeof analysisResponse.value).toBe("object");
  });
});
