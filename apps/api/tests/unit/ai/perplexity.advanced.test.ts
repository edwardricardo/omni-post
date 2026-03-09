import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PerplexityProvider } from "../../../src/ai/providers/perplexity.js";
import { mockConfig } from "./perplexity.test-helpers.js";

describe("PerplexityProvider - Content Analysis", { concurrency: 1 }, () => {
  let provider: PerplexityProvider;

  beforeEach(() => {
    provider = new PerplexityProvider(mockConfig);
  });

  it("should analyze sentiment with research context", async (t) => {
    const mockResponse = JSON.stringify({
      score: 0.8,
      label: "positive",
      confidence: 0.95,
    });

    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.ok(body.messages[1].content.includes("Search for the latest research"));
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.analyzeContent("I love this product!", "sentiment");
    assert.strictEqual(result.score, 0.8);
    assert.strictEqual(result.label, "positive");
  });

  it("should analyze tone with research context", async (t) => {
    const mockResponse = JSON.stringify({
      detected: "professional",
      confidence: 0.9,
      suggestions: ["Add personal touches"],
    });

    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.ok(body.messages[1].content.includes("Research current best practices"));
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.analyzeContent("Dear Sir/Madam", "tone");
    assert.strictEqual(result.detected, "professional");
  });

  it("should analyze readability with current standards", async (t) => {
    const mockResponse = JSON.stringify({
      score: 75,
      level: "High School",
      suggestions: ["Simplify sentences"],
    });

    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.ok(body.messages[1].content.includes("current readability assessment standards"));
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.analyzeContent("Complex content", "readability");
    assert.strictEqual(result.score, 75);
  });

  it("should analyze engagement with latest factors", async (t) => {
    const mockResponse = JSON.stringify({
      score: 85,
      factors: [{ factor: "emotional appeal", impact: 80, suggestion: "Add storytelling" }],
    });

    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.ok(body.messages[1].content.includes("latest social media engagement factors"));
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.analyzeContent("Join us!", "engagement");
    assert.strictEqual(result.score, 85);
  });

  it("should include system message for JSON response", async (t) => {
    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.strictEqual(body.messages.length, 2);
      assert.strictEqual(body.messages[0].role, "system");
      assert.ok(body.messages[0].content.includes("JSON"));
      return {
        ok: true,
        json: async () => ({
          choices: [
            { message: { content: '{"score": 0.5, "label": "neutral", "confidence": 0.8}' } },
          ],
        }),
      };
    });

    await provider.analyzeContent("Neutral content", "sentiment");
  });

  it("should throw error on malformed JSON response", async (t) => {
    t.mock.method(globalThis, "fetch", async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Not JSON" } }] }),
    }));

    await assert.rejects(async () => {
      await provider.analyzeContent("Test", "sentiment");
    }, /Perplexity analysis failed/);
  });
});

describe("PerplexityProvider - Content Optimization", { concurrency: 1 }, () => {
  let provider: PerplexityProvider;

  beforeEach(() => {
    provider = new PerplexityProvider(mockConfig);
  });

  it("should optimize content with latest platform research", async (t) => {
    const mockResponse = JSON.stringify({
      optimizedText: "Optimized tweet! 🚀",
      changes: [{ type: "added", original: ".", optimized: "! 🚀", reason: "Engagement" }],
      hashtags: ["socialmedia"],
      mentions: [],
      mediasuggestions: [],
      platformSpecific: {},
    });

    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.ok(body.messages[1].content.includes("Research the latest twitter algorithm"));
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.optimizeContent("Original tweet", "twitter");
    assert.strictEqual(result.optimizedText, "Optimized tweet! 🚀");
  });

  it("should include brand voice in optimization prompt", async (t) => {
    const mockResponse = JSON.stringify({
      optimizedText: "Professional content",
      changes: [],
      hashtags: [],
      mentions: [],
      mediasuggestions: [],
      platformSpecific: {},
    });

    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.ok(body.messages[1].content.includes("maintaining a professional brand voice"));
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    await provider.optimizeContent("Test", "linkedin", "professional");
  });

  it("should reference 2024 best practices", async (t) => {
    const mockResponse = JSON.stringify({
      optimizedText: "Test",
      changes: [],
      hashtags: [],
      mentions: [],
      mediasuggestions: [],
      platformSpecific: {},
    });

    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.ok(body.messages[1].content.includes("2024"));
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    await provider.optimizeContent("Test", "instagram");
  });

  it("should throw error on optimization failure", async (t) => {
    t.mock.method(globalThis, "fetch", async () => {
      throw new Error("API Error");
    });

    await assert.rejects(async () => {
      await provider.optimizeContent("Test", "twitter");
    }, /Perplexity optimization failed/);
  });
});

describe("PerplexityProvider - Performance Prediction", { concurrency: 1 }, () => {
  let provider: PerplexityProvider;

  beforeEach(() => {
    provider = new PerplexityProvider(mockConfig);
  });

  it("should predict performance with current trends", async (t) => {
    const mockResponse = JSON.stringify({
      platform: "twitter",
      metrics: {
        expectedEngagement: { value: 150, confidence: 0.8, range: { min: 100, max: 200 } },
        expectedReach: { value: 5000, confidence: 0.75, range: { min: 3000, max: 7000 } },
        viralPotential: 65,
        conversionPotential: 45,
      },
      optimalTiming: { hour: 14, day: "Tuesday", timezone: "UTC", confidence: 0.85 },
      competitiveAnalysis: { benchmarkScore: 78, opportunities: [], threats: [] },
    });

    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.ok(body.messages[1].content.includes("Research current twitter performance trends"));
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.predictPerformance("Great content!", "twitter");
    assert.strictEqual(result.platform, "twitter");
    assert.strictEqual(result.metrics.expectedEngagement.value, 150);
  });

  it("should include historical data in prediction", async (t) => {
    const historicalData = [
      { engagement: 200, reach: 5000 },
      { engagement: 150, reach: 4500 },
    ];

    const mockResponse = JSON.stringify({
      platform: "twitter",
      metrics: {
        expectedEngagement: { value: 175, confidence: 0.9, range: { min: 150, max: 200 } },
        expectedReach: { value: 4750, confidence: 0.85, range: { min: 4000, max: 5500 } },
        viralPotential: 70,
        conversionPotential: 50,
      },
      optimalTiming: { hour: 15, day: "Wednesday", timezone: "UTC", confidence: 0.9 },
      competitiveAnalysis: { benchmarkScore: 80, opportunities: [], threats: [] },
    });

    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.ok(body.messages[1].content.includes("Historical context"));
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    await provider.predictPerformance("Test", "twitter", historicalData);
  });

  it("should limit historical data to 3 entries", async (t) => {
    const historicalData = [{ data: 1 }, { data: 2 }, { data: 3 }, { data: 4 }, { data: 5 }];

    const mockResponse = JSON.stringify({
      platform: "twitter",
      metrics: {
        expectedEngagement: { value: 100, confidence: 0.8, range: { min: 50, max: 150 } },
        expectedReach: { value: 3000, confidence: 0.7, range: { min: 2000, max: 4000 } },
        viralPotential: 50,
        conversionPotential: 40,
      },
      optimalTiming: { hour: 12, day: "Monday", timezone: "UTC", confidence: 0.8 },
      competitiveAnalysis: { benchmarkScore: 70, opportunities: [], threats: [] },
    });

    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      const historicalContext = body.messages[1].content;
      const parsedData = JSON.parse(historicalContext.match(/\[[\s\S]*\]/)[0]);
      assert.strictEqual(parsedData.length, 3);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    await provider.predictPerformance("Test", "twitter", historicalData);
  });

  it("should throw error on prediction failure", async (t) => {
    t.mock.method(globalThis, "fetch", async () => {
      throw new Error("API Error");
    });

    await assert.rejects(async () => {
      await provider.predictPerformance("Test", "twitter");
    }, /Perplexity prediction failed/);
  });
});

describe("PerplexityProvider - Content Variations", { concurrency: 1 }, () => {
  let provider: PerplexityProvider;

  beforeEach(() => {
    provider = new PerplexityProvider(mockConfig);
  });

  it("should generate variations with research context", async (t) => {
    const mockResponse = JSON.stringify([
      "Professional variation",
      "Casual variation",
      "Humorous variation",
    ]);

    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.ok(
        body.messages[1].content.includes("Research current content creation best practices")
      );
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.generateVariations("Original", "tone", 3);
    assert.ok(Array.isArray(result));
    assert.strictEqual(result.length, 3);
  });

  it("should generate tone variations", async (t) => {
    const mockResponse = JSON.stringify(["Tone 1", "Tone 2", "Tone 3"]);

    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.ok(body.messages[1].content.includes("varying the tone"));
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.generateVariations("Original", "tone", 3);
    assert.strictEqual(result.length, 3);
  });

  it("should generate length variations", async (t) => {
    const mockResponse = JSON.stringify(["Short", "Medium", "Long"]);

    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.ok(body.messages[1].content.includes("varying the length"));
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.generateVariations("Original", "length", 3);
    assert.strictEqual(result.length, 3);
  });

  it("should generate audience variations", async (t) => {
    const mockResponse = JSON.stringify(["For execs", "For marketers", "For consumers"]);

    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.ok(body.messages[1].content.includes("varying the audience"));
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.generateVariations("Original", "audience", 3);
    assert.strictEqual(result.length, 3);
  });

  it("should request exact count of variations", async (t) => {
    const mockResponse = JSON.stringify(["V1", "V2", "V3", "V4", "V5"]);

    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.ok(body.messages[1].content.includes("generate 5"));
      assert.ok(body.messages[1].content.includes("exactly 5 strings"));
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.generateVariations("Original", "tone", 5);
    assert.strictEqual(result.length, 5);
  });

  it("should throw error on variation generation failure", async (t) => {
    t.mock.method(globalThis, "fetch", async () => {
      throw new Error("API Error");
    });

    await assert.rejects(async () => {
      await provider.generateVariations("Test", "tone", 3);
    }, /Perplexity variation generation failed/);
  });
});

describe("PerplexityProvider - Error Handling", { concurrency: 1 }, () => {
  let provider: PerplexityProvider;

  beforeEach(() => {
    provider = new PerplexityProvider(mockConfig);
  });

  it("should handle rate limit errors", async (t) => {
    t.mock.method(globalThis, "fetch", async () => ({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    }));

    await assert.rejects(async () => {
      await provider.generateText([{ role: "user", content: "Test" }]);
    }, /Perplexity API error: 429/);
  });

  it("should handle authentication errors", async (t) => {
    t.mock.method(globalThis, "fetch", async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    }));

    await assert.rejects(async () => {
      await provider.generateText([{ role: "user", content: "Test" }]);
    }, /Perplexity API error: 401/);
  });

  it("should handle server errors", async (t) => {
    t.mock.method(globalThis, "fetch", async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    }));

    await assert.rejects(async () => {
      await provider.generateText([{ role: "user", content: "Test" }]);
    }, /Perplexity API error: 500/);
  });

  it("should handle malformed API responses", async (t) => {
    t.mock.method(globalThis, "fetch", async () => ({
      ok: true,
      json: async () => ({ choices: [] }),
    }));

    const result = await provider.generateText([{ role: "user", content: "Test" }]);
    assert.strictEqual(result, "");
  });

  it("should handle JSON parsing errors", async (t) => {
    t.mock.method(globalThis, "fetch", async () => ({
      ok: true,
      json: async () => {
        throw new Error("Invalid JSON");
      },
    }));

    await assert.rejects(async () => {
      await provider.generateText([{ role: "user", content: "Test" }]);
    }, /Perplexity generation failed/);
  });
});
