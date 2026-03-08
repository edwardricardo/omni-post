/**
 * Unit Tests for AIService
 *
 * Tests content generation, analysis, optimization, prediction and cache management.
 * Stubs the aiOrchestrator module via mock.method() so that no real AI API calls are made.
 * Each test restores its own stubs via the returned MockFunctionContext.
 */

import { describe, it, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { AIService } from "../../src/ai/aiService.js";
import * as orchestratorModule from "../../src/ai/orchestrator.js";

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

/** Stubs a method on aiOrchestrator using test context for automatic cleanup. */
function stubOrchestrator<K extends keyof typeof orchestratorModule.aiOrchestrator>(
  t: TestContext,
  method: K,
  impl: (...args: any[]) => any
) {
  return t.mock.method(orchestratorModule.aiOrchestrator, method, impl);
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

// ============================================================================
// Suite setup — verify the orchestrator module is importable
// ============================================================================

before(async () => {
  assert.ok(orchestratorModule.aiOrchestrator, "aiOrchestrator singleton must be accessible");
});

// ============================================================================
// Content Generation
// ============================================================================

describe("AIService - Content Generation", () => {
  it("should generate content with default options", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "generateContent", async () => ({
      ok: true,
      value: "AI is transforming content creation.",
      metadata: METADATA,
    }));

    const result = await aiService.generateContent([
      { role: "user", content: "Write a tweet about AI" },
    ]);

    assert.ok(result.success, "Generation should succeed");
    assert.ok(result.content, "Should return generated content");
    assert.ok(result.metadata, "Should include metadata");
    assert.strictEqual(result.metadata.provider, "openai");
    assert.ok(result.metadata.tokensUsed > 0);
  });

  it("should generate content with custom model options", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "generateContent", async () => ({
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

    assert.ok(result.success);
    assert.ok(result.content);
  });

  it("should throw when orchestrator returns rate-limit error", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "generateContent", async () => ({
      ok: false,
      error: { message: "API rate limit exceeded", code: "RATE_LIMIT" },
      metadata: METADATA,
    }));

    await assert.rejects(
      async () => {
        await aiService.generateContent([{ role: "user", content: "Write something" }]);
      },
      (err: Error) => {
        assert.ok(
          err.message.includes("rate limit") || err.message.includes("failed"),
          `Unexpected error message: ${err.message}`
        );
        return true;
      }
    );
  });

  it("should handle string error from orchestrator", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "generateContent", async () => ({
      ok: false,
      error: "Simple error message",
      metadata: METADATA,
    }));

    await assert.rejects(
      async () => {
        await aiService.generateContent([{ role: "user", content: "Write something" }]);
      },
      (err: Error) => {
        assert.strictEqual(err.message, "Simple error message");
        return true;
      }
    );
  });
});

// ============================================================================
// Content Analysis
// ============================================================================

describe("AIService - Content Analysis", () => {
  it("should analyze sentiment successfully", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "analyzeContent", async () => ({
      ok: true,
      value: SENTIMENT_ANALYSIS,
      metadata: METADATA,
    }));

    const result = await aiService.analyzeContent("Great product!", "sentiment");

    assert.ok(result.success);
    assert.ok(result.analysis.sentiment);
    assert.strictEqual(result.analysis.sentiment.label, "positive");
    assert.ok(result.analysis.sentiment.confidence > 0.5);
  });

  it("should analyze tone successfully", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "analyzeContent", async () => ({
      ok: true,
      value: TONE_ANALYSIS,
      metadata: METADATA,
    }));

    const result = await aiService.analyzeContent("Professional business update", "tone");

    assert.ok(result.success);
    assert.ok(result.analysis.tone);
    assert.ok(result.analysis.tone.detected);
    assert.ok(Array.isArray(result.analysis.tone.suggestions));
  });

  it("should analyze readability successfully", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "analyzeContent", async () => ({
      ok: true,
      value: READABILITY_ANALYSIS,
      metadata: METADATA,
    }));

    const result = await aiService.analyzeContent("Clear and concise content.", "readability");

    assert.ok(result.success);
    assert.ok(result.analysis.readability.score > 0);
    assert.ok(result.analysis.readability.level);
  });

  it("should analyze engagement potential", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "analyzeContent", async () => ({
      ok: true,
      value: ENGAGEMENT_ANALYSIS,
      metadata: METADATA,
    }));

    const result = await aiService.analyzeContent("Engaging content with CTA!", "engagement");

    assert.ok(result.success);
    assert.ok(result.analysis.engagement.score > 0);
    assert.ok(Array.isArray(result.analysis.engagement.factors));
  });

  it("should throw when analysis fails", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "analyzeContent", async () => ({
      ok: false,
      error: { message: "Analysis failed", code: "ANALYSIS_ERROR" },
      metadata: METADATA,
    }));

    await assert.rejects(
      async () => {
        await aiService.analyzeContent("Content", "sentiment");
      },
      (err: Error) => {
        assert.ok(err.message.includes("failed"));
        return true;
      }
    );
  });
});

// ============================================================================
// Content Optimization
// ============================================================================

describe("AIService - Content Optimization", () => {
  it("should optimize content for Twitter", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "optimizeContent", async () => ({
      ok: true,
      value: OPTIMIZATION,
      metadata: METADATA,
    }));

    const result = await aiService.optimizeContent("AI is changing things", "twitter");

    assert.ok(result.success);
    assert.ok(result.optimization.optimizedText);
    assert.ok(Array.isArray(result.optimization.hashtags));
    assert.ok(result.optimization.platformSpecific);
  });

  it("should optimize with brand voice", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "optimizeContent", async () => ({
      ok: true,
      value: OPTIMIZATION,
      metadata: METADATA,
    }));

    const result = await aiService.optimizeContent(
      "Product announcement",
      "twitter",
      "Professional and innovative"
    );

    assert.ok(result.success);
    assert.ok(result.optimization.optimizedText);
  });

  it("should include media suggestions for Instagram", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "optimizeContent", async () => ({
      ok: true,
      value: OPTIMIZATION,
      metadata: METADATA,
    }));

    const result = await aiService.optimizeContent("Visual content", "instagram");

    assert.ok(result.success);
    assert.ok(result.optimization.mediasuggestions);
  });

  it("should throw when optimization fails", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "optimizeContent", async () => ({
      ok: false,
      error: { message: "Optimization failed", code: "OPTIMIZATION_ERROR" },
      metadata: METADATA,
    }));

    await assert.rejects(
      async () => {
        await aiService.optimizeContent("Content", "twitter");
      },
      (err: Error) => {
        assert.ok(err.message.includes("failed"));
        return true;
      }
    );
  });
});

// ============================================================================
// Performance Prediction
// ============================================================================

describe("AIService - Performance Prediction", () => {
  it("should predict performance without historical data", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "predictPerformance", async () => ({
      ok: true,
      value: PREDICTION,
      metadata: METADATA,
    }));

    const result = await aiService.predictPerformance("Great content!", "twitter");

    assert.ok(result.success);
    assert.ok(result.prediction.metrics.expectedEngagement);
    assert.ok(result.prediction.metrics.expectedReach);
    assert.ok(result.prediction.optimalTiming);
  });

  it("should predict performance with historical data", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "predictPerformance", async () => ({
      ok: true,
      value: PREDICTION,
      metadata: METADATA,
    }));

    const historicalData = [
      { engagement: 100, reach: 5000, timestamp: new Date() },
      { engagement: 150, reach: 7000, timestamp: new Date() },
    ];

    const result = await aiService.predictPerformance("New content", "twitter", historicalData);

    assert.ok(result.success);
    assert.ok(result.prediction.metrics.expectedEngagement.confidence > 0);
  });

  it("should throw when prediction fails", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "predictPerformance", async () => ({
      ok: false,
      error: { message: "Prediction failed", code: "PREDICTION_ERROR" },
      metadata: METADATA,
    }));

    await assert.rejects(
      async () => {
        await aiService.predictPerformance("Content", "twitter");
      },
      (err: Error) => {
        assert.ok(err.message.includes("failed"));
        return true;
      }
    );
  });
});

// ============================================================================
// Content Variations
// ============================================================================

describe("AIService - Content Variations", () => {
  it("should generate tone variations", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "generateVariations", async () => ({
      ok: true,
      value: VARIATIONS,
      metadata: METADATA,
    }));

    const result = await aiService.generateVariations("Original content", "tone", 3);

    assert.ok(result.success);
    assert.ok(Array.isArray(result.variations));
    assert.strictEqual(result.variations.length, 3);
  });

  it("should generate length variations", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "generateVariations", async () => ({
      ok: true,
      value: VARIATIONS,
      metadata: METADATA,
    }));

    const result = await aiService.generateVariations("Original content", "length", 3);

    assert.ok(result.success);
    assert.ok(Array.isArray(result.variations));
  });

  it("should generate audience variations", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "generateVariations", async () => ({
      ok: true,
      value: VARIATIONS,
      metadata: METADATA,
    }));

    const result = await aiService.generateVariations("Original content", "audience", 5);

    // Orchestrator returns VARIATIONS (3 items) regardless of requested count;
    // aiService returns whatever the orchestrator provides.
    assert.ok(result.success);
    assert.ok(Array.isArray(result.variations));
  });

  it("should throw when variation generation fails", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "generateVariations", async () => ({
      ok: false,
      error: { message: "Variation generation failed", code: "VARIATION_ERROR" },
      metadata: METADATA,
    }));

    await assert.rejects(
      async () => {
        await aiService.generateVariations("Content", "tone", 3);
      },
      (err: Error) => {
        assert.ok(err.message.includes("failed"));
        return true;
      }
    );
  });
});

// ============================================================================
// Smart Analysis
// ============================================================================

describe("AIService - Smart Analysis", () => {
  it("should perform smart analysis with all features enabled", async (t) => {
    const aiService = new AIService();

    stubOrchestrator(t, "analyzeContent", makeAnalyzeContentStub());
    stubOrchestrator(t, "optimizeContent", async () => ({
      ok: true,
      value: OPTIMIZATION,
      metadata: METADATA,
    }));
    stubOrchestrator(t, "predictPerformance", async () => ({
      ok: true,
      value: PREDICTION,
      metadata: METADATA,
    }));
    stubOrchestrator(t, "generateVariations", async () => ({
      ok: true,
      value: VARIATIONS,
      metadata: METADATA,
    }));

    const result = await aiService.smartAnalysis({
      content: "Test content for smart analysis",
      platform: "twitter",
      brandVoice: "Professional",
      includeOptimization: true,
      includePrediction: true,
      includeVariations: true,
      variationCount: 3,
    });

    assert.strictEqual(typeof result, "object", "smartAnalysis should return a result object");
    assert.strictEqual(result.content, "Test content for smart analysis");
    assert.strictEqual(result.platform, "twitter");
    assert.ok(result.analysis, "result should include analysis");
    assert.ok(result.optimization, "result should include optimization");
    assert.ok(result.prediction, "result should include prediction");
    assert.ok(result.variations, "result should include variations");
    assert.ok(result.metadata?.timestamp, "result metadata should include timestamp");
  });

  it("should omit optional features when disabled", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "analyzeContent", makeAnalyzeContentStub());

    const result = await aiService.smartAnalysis({
      content: "Simple analysis",
      platform: "twitter",
      includeOptimization: false,
      includePrediction: false,
      includeVariations: false,
    });

    assert.ok(result.analysis);
    assert.strictEqual(result.optimization, undefined);
    assert.strictEqual(result.prediction, undefined);
    assert.strictEqual(result.variations, undefined);
  });

  it("should default platform to twitter and enable optimization/prediction", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "analyzeContent", makeAnalyzeContentStub());
    stubOrchestrator(t, "optimizeContent", async () => ({
      ok: true,
      value: OPTIMIZATION,
      metadata: METADATA,
    }));
    stubOrchestrator(t, "predictPerformance", async () => ({
      ok: true,
      value: PREDICTION,
      metadata: METADATA,
    }));

    const result = await aiService.smartAnalysis({ content: "Default settings test" });

    assert.strictEqual(result.platform, "twitter");
    assert.ok(result.optimization);
    assert.ok(result.prediction);
  });

  it("should handle partial analysis failures gracefully", async (t) => {
    const aiService = new AIService();
    stubOrchestrator(t, "analyzeContent", async (_content: string, type: string) => {
      if (type === "sentiment") {
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

    assert.ok(result.analysis.sentiment);
  });
});

// ============================================================================
// Metrics
// ============================================================================

describe("AIService - Metrics", () => {
  it("should retrieve usage metrics from orchestrator", async (t) => {
    const aiService = new AIService();

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

    stubOrchestrator(t, "getUsageMetrics", () => metricsMap);
    stubOrchestrator(t, "getCacheStats", () => ({ size: 42, hitRate: 0.85 }));

    const result = await aiService.getMetrics();

    assert.ok(result.success);
    assert.ok(result.metrics);
    assert.ok(result.cache);
    assert.ok(result.timestamp);
  });

  it("should expose per-provider metrics", async (t) => {
    const aiService = new AIService();

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

    stubOrchestrator(t, "getUsageMetrics", () => metricsMap);
    stubOrchestrator(t, "getCacheStats", () => ({ size: 10, hitRate: 0.7 }));

    const result = await aiService.getMetrics();

    assert.ok(result.metrics.openai);
    assert.ok(result.metrics.gemini);
    assert.ok(result.metrics.openai.tokensUsed > 0);
    assert.ok(result.metrics.openai.requestCount > 0);
    assert.ok(result.metrics.openai.cost >= 0);
  });
});

// ============================================================================
// Cache Management
// ============================================================================

describe("AIService - Cache Management", () => {
  it("should clear cache via orchestrator", async (t) => {
    const aiService = new AIService();
    let clearCalled = false;

    stubOrchestrator(t, "clearCache", () => {
      clearCalled = true;
    });

    const result = await aiService.clearCache();

    assert.ok(result.success);
    assert.ok(result.message);
    assert.ok(clearCalled, "orchestrator.clearCache() must be called");
  });
});
