import { describe, it } from "node:test";
import assert from "node:assert/strict";
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

    assert.strictEqual(message.role, "system");
    assert.strictEqual(message.content, "You are a helpful assistant");
  });

  it("should validate AIMessage with user role", () => {
    const message: AIMessage = {
      role: "user",
      content: "Hello, how are you?",
    };

    assert.strictEqual(message.role, "user");
    assert.strictEqual(message.content, "Hello, how are you?");
  });

  it("should validate AIMessage with assistant role", () => {
    const message: AIMessage = {
      role: "assistant",
      content: "I'm doing well, thank you!",
    };

    assert.strictEqual(message.role, "assistant");
    assert.strictEqual(message.content, "I'm doing well, thank you!");
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

    assert.strictEqual(options.model, "gpt-4");
    assert.strictEqual(options.maxTokens, 1000);
    assert.strictEqual(options.temperature, 0.7);
    assert.strictEqual(options.topP, 0.9);
    assert.strictEqual(options.frequencyPenalty, 0.5);
    assert.strictEqual(options.presencePenalty, 0.3);
    assert.strictEqual(options.stream, false);
    assert.strictEqual(options.timeout, 30000);
  });

  it("should validate GenerationOptions with minimal fields", () => {
    const options: GenerationOptions = {
      temperature: 0.5,
    };

    assert.strictEqual(options.temperature, 0.5);
  });

  it("should allow empty GenerationOptions", () => {
    const options: GenerationOptions = {};
    assert.deepStrictEqual(options, {});
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

    assert.strictEqual(analysis.sentiment.score, 0.8);
    assert.strictEqual(analysis.sentiment.label, "positive");
    assert.strictEqual(analysis.tone.detected, "professional");
    assert.strictEqual(analysis.readability.level, "High School");
    assert.strictEqual(analysis.brandConsistency.voice, "friendly");
    assert.strictEqual(analysis.engagement.factors.length, 2);
  });

  it("should validate sentiment with negative score", () => {
    const sentiment = {
      score: -0.6,
      label: "negative" as const,
      confidence: 0.85,
    };

    assert.strictEqual(sentiment.score, -0.6);
    assert.strictEqual(sentiment.label, "negative");
  });

  it("should validate sentiment with neutral label", () => {
    const sentiment = {
      score: 0.0,
      label: "neutral" as const,
      confidence: 0.9,
    };

    assert.strictEqual(sentiment.label, "neutral");
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

    assert.strictEqual(optimization.optimizedText.includes("🚀"), true);
    assert.strictEqual(optimization.changes.length, 2);
    assert.strictEqual(optimization.hashtags.length, 3);
    assert.strictEqual(optimization.mentions.length, 2);
    assert.strictEqual(optimization.mediasuggestions.length, 2);
    assert.ok(optimization.platformSpecific.twitter);
    assert.ok(optimization.platformSpecific.linkedin);
  });

  it("should validate change types", () => {
    const changes = [
      { type: "added" as const, original: "", optimized: "new text", reason: "Addition" },
      { type: "removed" as const, original: "old text", optimized: "", reason: "Removal" },
      { type: "modified" as const, original: "old", optimized: "new", reason: "Modification" },
    ];

    assert.strictEqual(changes[0].type, "added");
    assert.strictEqual(changes[1].type, "removed");
    assert.strictEqual(changes[2].type, "modified");
  });

  it("should validate media suggestion types", () => {
    const mediaSuggestions = [
      { type: "image" as const, description: "Photo", dimensions: "1080x1080" },
      { type: "video" as const, description: "Clip", dimensions: "1920x1080" },
    ];

    assert.strictEqual(mediaSuggestions[0].type, "image");
    assert.strictEqual(mediaSuggestions[1].type, "video");
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

    assert.strictEqual(prediction.platform, "twitter");
    assert.strictEqual(prediction.metrics.expectedEngagement.value, 150);
    assert.strictEqual(prediction.metrics.expectedEngagement.range.min, 100);
    assert.strictEqual(prediction.optimalTiming.hour, 14);
    assert.strictEqual(prediction.optimalTiming.day, "Tuesday");
    assert.strictEqual(prediction.competitiveAnalysis.opportunities.length, 2);
    assert.strictEqual(prediction.competitiveAnalysis.threats.length, 2);
  });

  it("should validate metric ranges", () => {
    const metric = {
      value: 100,
      confidence: 0.75,
      range: { min: 50, max: 150 },
    };

    assert.ok(metric.value >= metric.range.min);
    assert.ok(metric.value <= metric.range.max);
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

    assert.strictEqual(config.apiKey, "test-api-key");
    assert.strictEqual(config.baseUrl, "https://api.example.com");
    assert.strictEqual(config.model, "gpt-4");
    assert.strictEqual(config.rateLimit.requestsPerMinute, 60);
    assert.strictEqual(config.timeout, 30000);
    assert.strictEqual(config.retries, 3);
  });

  it("should validate RateLimitConfig structure", () => {
    const rateLimit: RateLimitConfig = {
      requestsPerMinute: 60,
      tokensPerMinute: 100000,
      requestsPerDay: 1000,
      tokensPerDay: 1000000,
    };

    assert.strictEqual(rateLimit.requestsPerMinute, 60);
    assert.strictEqual(rateLimit.tokensPerMinute, 100000);
    assert.strictEqual(rateLimit.requestsPerDay, 1000);
    assert.strictEqual(rateLimit.tokensPerDay, 1000000);
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

    assert.strictEqual(config.primaryProvider, "openai");
    assert.strictEqual(config.fallbackProviders.length, 3);
    assert.strictEqual(config.retryAttempts, 3);
    assert.strictEqual(config.cacheResults, true);
  });

  it("should validate provider names", () => {
    const providers: Array<AIProvider["name"]> = ["openai", "anthropic", "perplexity", "gemini"];

    assert.strictEqual(providers.length, 4);
    assert.ok(providers.includes("openai"));
    assert.ok(providers.includes("anthropic"));
    assert.ok(providers.includes("perplexity"));
    assert.ok(providers.includes("gemini"));
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

    assert.strictEqual(metrics.provider, "openai");
    assert.strictEqual(metrics.tokensUsed, 1500);
    assert.strictEqual(metrics.requestCount, 10);
    assert.strictEqual(metrics.successRate, 0.95);
    assert.strictEqual(metrics.averageLatency, 250);
    assert.strictEqual(metrics.cost, 0.05);
    assert.ok(metrics.timestamp instanceof Date);
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

    assert.strictEqual(metrics.successRate, 0.95);
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

    assert.strictEqual(task.type, "generate");
    assert.ok(task.data.messages);
  });

  it("should validate analyze task", () => {
    const task: AITask = {
      type: "analyze",
      data: {
        content: "Test content",
        analysisType: "sentiment",
      },
    };

    assert.strictEqual(task.type, "analyze");
    assert.strictEqual(task.data.analysisType, "sentiment");
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

    assert.strictEqual(task.type, "optimize");
    assert.strictEqual(task.data.platform, "twitter");
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

    assert.strictEqual(task.type, "predict");
    assert.ok(task.data.historicalData);
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

    assert.strictEqual(task.type, "variations");
    assert.strictEqual(task.data.variationType, "tone");
    assert.strictEqual(task.data.count, 5);
  });

  it("should validate all analysis types", () => {
    const analysisTypes: Array<"sentiment" | "tone" | "readability" | "engagement"> = [
      "sentiment",
      "tone",
      "readability",
      "engagement",
    ];

    assert.strictEqual(analysisTypes.length, 4);
  });

  it("should validate all variation types", () => {
    const variationTypes: Array<"tone" | "length" | "audience"> = ["tone", "length", "audience"];

    assert.strictEqual(variationTypes.length, 3);
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

    assert.strictEqual(response.ok, true);
    assert.strictEqual(response.value, "Generated text response");
    assert.strictEqual(response.metadata.provider, "openai");
    assert.strictEqual(response.metadata.cached, false);
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

    assert.strictEqual(response.ok, false);
    assert.strictEqual(response.error?.code, "RATE_LIMIT_EXCEEDED");
    assert.strictEqual(response.error?.retryable, true);
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

    assert.strictEqual(response.ok, true);
    assert.strictEqual(response.metadata.cached, true);
    assert.strictEqual(response.metadata.latency, 5);
  });

  it("should validate non-retryable error", () => {
    const error = {
      code: "INVALID_API_KEY",
      message: "Authentication failed",
      provider: "perplexity",
      retryable: false,
    };

    assert.strictEqual(error.retryable, false);
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

    assert.notStrictEqual(generateTask.type, analyzeTask.type);
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

    assert.strictEqual(typeof textResponse.value, "string");
    assert.strictEqual(typeof analysisResponse.value, "object");
  });
});
