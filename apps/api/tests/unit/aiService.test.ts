/**
 * @file aiService.test.ts
 * @description Unit tests for AIService. Mocks AIOrchestrator.createFromEnv() via
 *   vi.mock() so the admin orchestrator path can be stubbed without real AI calls.
 *   Mocks AiRequestService so BYOK/pool routing can be verified independently.
 * @layer infrastructure
 */

import { describe, it, vi, expect, beforeEach } from "vitest";

// ============================================================================
// Shared mock orchestrator instance — replaced per-test via stubOrchestrator()
// ============================================================================

const mockOrchestrator = {
  healthCheck: vi.fn(),
  getAvailableProviders: vi.fn(),
  getUsageMetrics: vi.fn(),
  getCacheStats: vi.fn(),
  generateContent: vi.fn(),
  analyzeContent: vi.fn(),
  optimizeContent: vi.fn(),
  predictPerformance: vi.fn(),
  generateVariations: vi.fn(),
  generateImage: vi.fn(),
  executeTask: vi.fn(),
  clearCache: vi.fn(),
};

// Intercept AIOrchestrator.createFromEnv() so AIService.getAdminOrchestrator()
// returns our shared mock. The mock class is a minimal stand-in — only the static
// factory is exercised in these tests.
vi.mock("../../src/ai/orchestrator.js", () => ({
  AIOrchestrator: class {
    static createFromEnv() {
      return mockOrchestrator;
    }
  },
}));

import { AIService } from "../../src/ai/aiService.js";
import type { AiRequestService } from "../../src/ai/AiRequestService.js";

// ============================================================================
// Minimal fixtures — shape mirrors what aiOrchestrator actually returns
// ============================================================================

const METADATA = {
  provider: "openai" as const,
  model: "gpt-4",
  tokensUsed: 150,
  latency: 250,
  cached: false,
};

const SENTIMENT_ANALYSIS = {
  sentiment: { score: 0.8, label: "positive" as const, confidence: 0.92 },
};

const TONE_ANALYSIS = {
  tone: {
    detected: "professional",
    confidence: 0.88,
    suggestions: ["Use active voice"],
  },
};

const READABILITY_ANALYSIS = {
  readability: {
    score: 75,
    level: "High School",
    suggestions: ["Simplify sentences"],
  },
};

const ENGAGEMENT_ANALYSIS = {
  engagement: {
    score: 8.5,
    factors: [{ factor: "Call to action", impact: 0.3, suggestion: "Add clear CTA" }],
  },
};

const OPTIMIZATION = {
  optimizedText: "AI innovations are transforming content creation!",
  changes: [
    {
      type: "modified" as const,
      original: "AI is cool",
      optimized: "AI innovations are transforming content creation",
      reason: "More specific language",
    },
  ],
  hashtags: ["#AI", "#Innovation"],
  mentions: [] as string[],
  mediasuggestions: [
    { type: "image" as const, description: "AI visualization", dimensions: "1200x630" },
  ],
  platformSpecific: {
    twitter: {
      text: "AI innovations are transforming content creation! #AI",
      characterCount: 55,
      optimizations: ["Added hashtags"],
    },
  },
};

const PREDICTION = {
  platform: "twitter",
  metrics: {
    expectedEngagement: { value: 150, confidence: 0.85, range: { min: 100, max: 200 } },
    expectedReach: { value: 5000, confidence: 0.78, range: { min: 3000, max: 7000 } },
    viralPotential: 0.65,
    conversionPotential: 0.42,
  },
  optimalTiming: { hour: 14, day: "Tuesday", timezone: "UTC", confidence: 0.82 },
  competitiveAnalysis: {
    benchmarkScore: 7.8,
    opportunities: ["Trending topic alignment"],
    threats: ["High competition"],
  },
};

const VARIATIONS = [
  "Discover how AI is revolutionising content creation!",
  "Content creation meets cutting-edge AI technology",
  "The future of content: AI-powered innovation",
];

// ============================================================================
// Helpers
// ============================================================================

/** Builds a minimal AiRequestService stub. Tests without accountId never hit it. */
function createMockAiRequestService(): AiRequestService {
  return {
    executeRequest: vi.fn(),
  } as unknown as AiRequestService;
}

/** Sets a mocked implementation on the shared orchestrator stub. */
function stubOrchestrator<K extends keyof typeof mockOrchestrator>(
  method: K,
  impl: (...args: any[]) => any
) {
  mockOrchestrator[method].mockImplementation(impl);
}

/** Returns a switch-based analyzeContent stub covering all 4 analysis types. */
function makeAnalyzeContentStub() {
  return async (_content: string, type: string) => {
    switch (type) {
      case "sentiment":
        return { ok: true, value: SENTIMENT_ANALYSIS, metadata: METADATA };
      case "tone":
        return { ok: true, value: TONE_ANALYSIS, metadata: METADATA };
      case "readability":
        return { ok: true, value: READABILITY_ANALYSIS, metadata: METADATA };
      case "engagement":
        return { ok: true, value: ENGAGEMENT_ANALYSIS, metadata: METADATA };
      default:
        return { ok: false, error: "Unknown type", metadata: METADATA };
    }
  };
}

beforeEach(() => {
  // Reset every orchestrator method between tests to avoid cross-test leakage.
  for (const fn of Object.values(mockOrchestrator)) {
    fn.mockReset();
  }
});

// ============================================================================
// Content Generation
// ============================================================================

describe("AIService - Content Generation", () => {
  it("should generate content with default options", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("generateContent", async () => ({
      ok: true,
      value: "AI is transforming content creation.",
      metadata: METADATA,
    }));

    const result = await aiService.generateContent([
      { role: "user", content: "Write a tweet about AI" },
    ]);

    expect(result.success).toBeTruthy();
    expect(result.content).toBeTruthy();
    expect(result.metadata).toBeTruthy();
    expect(result.metadata.provider).toBe("openai");
    expect(result.metadata.tokensUsed > 0).toBeTruthy();
  });

  it("should generate content with custom model options", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("generateContent", async () => ({
      ok: true,
      value: "Custom generated content",
      metadata: METADATA,
    }));

    const result = await aiService.generateContent([{ role: "user", content: "Write something" }], {
      model: "gpt-4",
      maxTokens: 150,
      temperature: 0.7,
      topP: 0.9,
    });

    expect(result.success).toBeTruthy();
    expect(result.content).toBeTruthy();
  });

  it("should throw when orchestrator returns rate-limit error", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("generateContent", async () => ({
      ok: false,
      error: { message: "API rate limit exceeded", code: "RATE_LIMIT" },
      metadata: METADATA,
    }));

    await expect(
      aiService.generateContent([{ role: "user", content: "Write something" }])
    ).rejects.toThrow(/rate limit|failed/);
  });

  it("should handle string error from orchestrator", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("generateContent", async () => ({
      ok: false,
      error: "Simple error message",
      metadata: METADATA,
    }));

    await expect(
      aiService.generateContent([{ role: "user", content: "Write something" }])
    ).rejects.toThrow("Simple error message");
  });
});

// ============================================================================
// Content Analysis
// ============================================================================

describe("AIService - Content Analysis", () => {
  it("should analyze sentiment successfully", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("analyzeContent", async () => ({
      ok: true,
      value: SENTIMENT_ANALYSIS,
      metadata: METADATA,
    }));

    const result = await aiService.analyzeContent("Great product!", "sentiment");

    expect(result.success).toBeTruthy();
    expect(result.analysis.sentiment).toBeTruthy();
    expect(result.analysis.sentiment.label).toBe("positive");
    expect(result.analysis.sentiment.confidence > 0.5).toBeTruthy();
  });

  it("should analyze tone successfully", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("analyzeContent", async () => ({
      ok: true,
      value: TONE_ANALYSIS,
      metadata: METADATA,
    }));

    const result = await aiService.analyzeContent("Professional business update", "tone");

    expect(result.success).toBeTruthy();
    expect(result.analysis.tone).toBeTruthy();
    expect(result.analysis.tone.detected).toBeTruthy();
    expect(Array.isArray(result.analysis.tone.suggestions)).toBeTruthy();
  });

  it("should analyze readability successfully", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("analyzeContent", async () => ({
      ok: true,
      value: READABILITY_ANALYSIS,
      metadata: METADATA,
    }));

    const result = await aiService.analyzeContent("Clear and concise content.", "readability");

    expect(result.success).toBeTruthy();
    expect(result.analysis.readability.score > 0).toBeTruthy();
    expect(result.analysis.readability.level).toBeTruthy();
  });

  it("should analyze engagement potential", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("analyzeContent", async () => ({
      ok: true,
      value: ENGAGEMENT_ANALYSIS,
      metadata: METADATA,
    }));

    const result = await aiService.analyzeContent("Engaging content with CTA!", "engagement");

    expect(result.success).toBeTruthy();
    expect(result.analysis.engagement.score > 0).toBeTruthy();
    expect(Array.isArray(result.analysis.engagement.factors)).toBeTruthy();
  });

  it("should throw when analysis fails", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("analyzeContent", async () => ({
      ok: false,
      error: { message: "Analysis failed", code: "ANALYSIS_ERROR" },
      metadata: METADATA,
    }));

    await expect(aiService.analyzeContent("Content", "sentiment")).rejects.toThrow(/failed/);
  });
});

// ============================================================================
// Content Optimization
// ============================================================================

describe("AIService - Content Optimization", () => {
  it("should optimize content for Twitter", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("optimizeContent", async () => ({
      ok: true,
      value: OPTIMIZATION,
      metadata: METADATA,
    }));

    const result = await aiService.optimizeContent("AI is changing things", "twitter");

    expect(result.success).toBeTruthy();
    expect(result.optimization.optimizedText).toBeTruthy();
    expect(Array.isArray(result.optimization.hashtags)).toBeTruthy();
    expect(result.optimization.platformSpecific).toBeTruthy();
  });

  it("should optimize with brand voice", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("optimizeContent", async () => ({
      ok: true,
      value: OPTIMIZATION,
      metadata: METADATA,
    }));

    const result = await aiService.optimizeContent(
      "Product announcement",
      "twitter",
      "Professional and innovative"
    );

    expect(result.success).toBeTruthy();
    expect(result.optimization.optimizedText).toBeTruthy();
  });

  it("should include media suggestions for Instagram", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("optimizeContent", async () => ({
      ok: true,
      value: OPTIMIZATION,
      metadata: METADATA,
    }));

    const result = await aiService.optimizeContent("Visual content", "instagram");

    expect(result.success).toBeTruthy();
    expect(result.optimization.mediasuggestions).toBeTruthy();
  });

  it("should throw when optimization fails", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("optimizeContent", async () => ({
      ok: false,
      error: { message: "Optimization failed", code: "OPTIMIZATION_ERROR" },
      metadata: METADATA,
    }));

    await expect(aiService.optimizeContent("Content", "twitter")).rejects.toThrow(/failed/);
  });
});

// ============================================================================
// Performance Prediction
// ============================================================================

describe("AIService - Performance Prediction", () => {
  it("should predict performance without historical data", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("predictPerformance", async () => ({
      ok: true,
      value: PREDICTION,
      metadata: METADATA,
    }));

    const result = await aiService.predictPerformance("Great content!", "twitter");

    expect(result.success).toBeTruthy();
    expect(result.prediction.metrics.expectedEngagement).toBeTruthy();
    expect(result.prediction.metrics.expectedReach).toBeTruthy();
    expect(result.prediction.optimalTiming).toBeTruthy();
  });

  it("should predict performance with historical data", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("predictPerformance", async () => ({
      ok: true,
      value: PREDICTION,
      metadata: METADATA,
    }));

    const historicalData = [
      { engagement: 100, reach: 5000, timestamp: new Date() },
      { engagement: 150, reach: 7000, timestamp: new Date() },
    ];

    const result = await aiService.predictPerformance("New content", "twitter", historicalData);

    expect(result.success).toBeTruthy();
    expect(result.prediction.metrics.expectedEngagement.confidence > 0).toBeTruthy();
  });

  it("should throw when prediction fails", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("predictPerformance", async () => ({
      ok: false,
      error: { message: "Prediction failed", code: "PREDICTION_ERROR" },
      metadata: METADATA,
    }));

    await expect(aiService.predictPerformance("Content", "twitter")).rejects.toThrow(/failed/);
  });
});

// ============================================================================
// Content Variations
// ============================================================================

describe("AIService - Content Variations", () => {
  it("should generate tone variations", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("generateVariations", async () => ({
      ok: true,
      value: VARIATIONS,
      metadata: METADATA,
    }));

    const result = await aiService.generateVariations("Original content", "tone", 3);

    expect(result.success).toBeTruthy();
    expect(Array.isArray(result.variations)).toBeTruthy();
    expect(result.variations.length).toBe(3);
  });

  it("should generate length variations", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("generateVariations", async () => ({
      ok: true,
      value: VARIATIONS,
      metadata: METADATA,
    }));

    const result = await aiService.generateVariations("Original content", "length", 3);

    expect(result.success).toBeTruthy();
    expect(Array.isArray(result.variations)).toBeTruthy();
  });

  it("should generate audience variations", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("generateVariations", async () => ({
      ok: true,
      value: VARIATIONS,
      metadata: METADATA,
    }));

    const result = await aiService.generateVariations("Original content", "audience", 5);

    expect(result.success).toBeTruthy();
    expect(Array.isArray(result.variations)).toBeTruthy();
  });

  it("should throw when variation generation fails", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("generateVariations", async () => ({
      ok: false,
      error: { message: "Variation generation failed", code: "VARIATION_ERROR" },
      metadata: METADATA,
    }));

    await expect(aiService.generateVariations("Content", "tone", 3)).rejects.toThrow(/failed/);
  });
});

// ============================================================================
// Smart Analysis
// ============================================================================

describe("AIService - Smart Analysis", () => {
  it("should perform smart analysis with all features enabled", async () => {
    const aiService = new AIService(createMockAiRequestService());

    // smartAnalysis calls orchestrator.executeTask() (not the typed methods) when
    // there is no accountId. Route every task type through executeTask.
    stubOrchestrator("executeTask", async (task: any) => {
      if (task.type === "analyze") {
        const stub = makeAnalyzeContentStub();
        const result = await stub("", task.data.analysisType);
        return result;
      }
      if (task.type === "optimize") {
        return { ok: true, value: OPTIMIZATION, metadata: METADATA };
      }
      if (task.type === "predict") {
        return { ok: true, value: PREDICTION, metadata: METADATA };
      }
      if (task.type === "variations") {
        return { ok: true, value: VARIATIONS, metadata: METADATA };
      }
      return { ok: false, error: "unknown", metadata: METADATA };
    });

    const result = await aiService.smartAnalysis({
      content: "Test content for smart analysis",
      platform: "twitter",
      brandVoice: "Professional",
      includeOptimization: true,
      includePrediction: true,
      includeVariations: true,
      variationCount: 3,
    });

    expect(typeof result).toBe("object");
    expect(result.content).toBe("Test content for smart analysis");
    expect(result.platform).toBe("twitter");
    expect(result.analysis).toBeTruthy();
    expect(result.optimization).toBeTruthy();
    expect(result.prediction).toBeTruthy();
    expect(result.variations).toBeTruthy();
    expect(result.metadata?.timestamp).toBeTruthy();
  });

  it("should omit optional features when disabled", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("executeTask", async (task: any) => {
      if (task.type === "analyze") {
        const stub = makeAnalyzeContentStub();
        return stub("", task.data.analysisType);
      }
      return { ok: false, error: "unknown", metadata: METADATA };
    });

    const result = await aiService.smartAnalysis({
      content: "Simple analysis",
      platform: "twitter",
      includeOptimization: false,
      includePrediction: false,
      includeVariations: false,
    });

    expect(result.analysis).toBeTruthy();
    expect(result.optimization).toBe(undefined);
    expect(result.prediction).toBe(undefined);
    expect(result.variations).toBe(undefined);
  });

  it("should default platform to twitter and enable optimization/prediction", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("executeTask", async (task: any) => {
      if (task.type === "analyze") {
        const stub = makeAnalyzeContentStub();
        return stub("", task.data.analysisType);
      }
      if (task.type === "optimize") {
        return { ok: true, value: OPTIMIZATION, metadata: METADATA };
      }
      if (task.type === "predict") {
        return { ok: true, value: PREDICTION, metadata: METADATA };
      }
      return { ok: false, error: "unknown", metadata: METADATA };
    });

    const result = await aiService.smartAnalysis({ content: "Default settings test" });

    expect(result.platform).toBe("twitter");
    expect(result.optimization).toBeTruthy();
    expect(result.prediction).toBeTruthy();
  });

  it("should handle partial analysis failures gracefully", async () => {
    const aiService = new AIService(createMockAiRequestService());
    stubOrchestrator("executeTask", async (task: any) => {
      if (task.type === "analyze" && task.data.analysisType === "sentiment") {
        return { ok: true, value: SENTIMENT_ANALYSIS, metadata: METADATA };
      }
      return { ok: false, error: "Failed", metadata: METADATA };
    });

    const result = await aiService.smartAnalysis({
      content: "Test partial failure",
      includeOptimization: false,
      includePrediction: false,
      includeVariations: false,
    });

    expect(result.analysis.sentiment).toBeTruthy();
  });
});

// ============================================================================
// Metrics
// ============================================================================

describe("AIService - Metrics", () => {
  it("should retrieve usage metrics from orchestrator", async () => {
    const aiService = new AIService(createMockAiRequestService());

    const metricsMap = new Map([
      [
        "openai",
        {
          provider: "openai",
          tokensUsed: 15000,
          requestCount: 50,
          successRate: 98.5,
          averageLatency: 320,
          cost: 0.45,
          timestamp: new Date(),
        },
      ],
    ]);

    stubOrchestrator("getUsageMetrics", () => metricsMap);
    stubOrchestrator("getCacheStats", () => ({ size: 42, hitRate: 0.85 }));

    const result = await aiService.getMetrics();

    expect(result.success).toBeTruthy();
    expect(result.metrics).toBeTruthy();
    expect(result.cache).toBeTruthy();
    expect(result.timestamp).toBeTruthy();
  });

  it("should expose per-provider metrics", async () => {
    const aiService = new AIService(createMockAiRequestService());

    const metricsMap = new Map([
      [
        "openai",
        {
          provider: "openai",
          tokensUsed: 15000,
          requestCount: 50,
          successRate: 98.5,
          averageLatency: 320,
          cost: 0.45,
          timestamp: new Date(),
        },
      ],
      [
        "gemini",
        {
          provider: "gemini",
          tokensUsed: 8000,
          requestCount: 25,
          successRate: 96.2,
          averageLatency: 280,
          cost: 0.008,
          timestamp: new Date(),
        },
      ],
    ]);

    stubOrchestrator("getUsageMetrics", () => metricsMap);
    stubOrchestrator("getCacheStats", () => ({ size: 10, hitRate: 0.7 }));

    const result = await aiService.getMetrics();

    expect(result.metrics.openai).toBeTruthy();
    expect(result.metrics.gemini).toBeTruthy();
    expect(result.metrics.openai.tokensUsed > 0).toBeTruthy();
    expect(result.metrics.openai.requestCount > 0).toBeTruthy();
    expect(result.metrics.openai.cost >= 0).toBeTruthy();
  });
});

// ============================================================================
// Cache Management
// ============================================================================

describe("AIService - Cache Management", () => {
  it("should clear cache via orchestrator", async () => {
    const aiService = new AIService(createMockAiRequestService());
    let clearCalled = false;

    stubOrchestrator("clearCache", () => {
      clearCalled = true;
    });

    const result = await aiService.clearCache();

    expect(result.success).toBeTruthy();
    expect(result.message).toBeTruthy();
    expect(clearCalled).toBeTruthy();
  });
});
