import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { OpenAIProvider } from "../../../src/ai/providers/openai.js";
import { mockConfig } from "./openai.test-helpers.js";

function makeOpenAIMockClient(createFn: (...args: any[]) => any) {
  return { chat: { completions: { create: createFn } } };
}

describe("OpenAIProvider - Content Optimization", { concurrency: 1 }, () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("should optimize content for platform", async (t) => {
    const mockResponse = JSON.stringify({
      optimizedText: "Optimized tweet! 🚀",
      changes: [{ type: "added", original: ".", optimized: "! 🚀", reason: "Added excitement" }],
      hashtags: ["socialmedia", "marketing"],
      mentions: ["influencer"],
      mediasuggestions: [{ type: "image", description: "Brand logo", dimensions: "1200x628" }],
      platformSpecific: {
        twitter: {
          text: "Optimized for Twitter",
          characterCount: 250,
          optimizations: ["Hashtags"],
        },
      },
    });

    const createFn = t.mock.fn(async () => ({
      choices: [{ message: { content: mockResponse } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.optimizeContent("Original tweet", "twitter");
    assert.strictEqual(result.optimizedText, "Optimized tweet! 🚀");
    assert.ok(Array.isArray(result.changes));
    assert.strictEqual(result.hashtags.length, 2);
  });

  it("should include brand voice in optimization", async (t) => {
    const mockResponse = JSON.stringify({
      optimizedText: "Professional content",
      changes: [],
      hashtags: [],
      mentions: [],
      mediasuggestions: [],
      platformSpecific: {},
    });

    const createFn = t.mock.fn(async (params: any) => {
      assert.ok(params.messages[1].content.includes("professional"));
      return { choices: [{ message: { content: mockResponse } }] };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.optimizeContent("Test content", "linkedin", "professional");
    assert.strictEqual(createFn.mock.calls.length, 1);
  });

  it("should include system message for JSON response", async (t) => {
    const createFn = t.mock.fn(async (params: any) => {
      assert.strictEqual(params.messages.length, 2);
      assert.strictEqual(params.messages[0].role, "system");
      assert.ok(params.messages[0].content.includes("JSON"));
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                optimizedText: "Test",
                changes: [],
                hashtags: [],
                mentions: [],
                mediasuggestions: [],
                platformSpecific: {},
              }),
            },
          },
        ],
      };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.optimizeContent("Test", "twitter");
    assert.strictEqual(createFn.mock.calls.length, 1);
  });

  it("should throw error on optimization failure", async (t) => {
    const createFn = t.mock.fn(async () => {
      throw new Error("API Error");
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await assert.rejects(async () => {
      await provider.optimizeContent("Test", "twitter");
    }, /OpenAI optimization failed/);
  });
});

describe("OpenAIProvider - Performance Prediction", { concurrency: 1 }, () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("should predict performance metrics", async (t) => {
    const mockResponse = JSON.stringify({
      platform: "twitter",
      metrics: {
        expectedEngagement: { value: 150, confidence: 0.8, range: { min: 100, max: 200 } },
        expectedReach: { value: 5000, confidence: 0.75, range: { min: 3000, max: 7000 } },
        viralPotential: 65,
        conversionPotential: 45,
      },
      optimalTiming: { hour: 14, day: "Tuesday", timezone: "UTC", confidence: 0.85 },
      competitiveAnalysis: {
        benchmarkScore: 78,
        opportunities: ["Trending topic"],
        threats: ["High competition"],
      },
    });

    const createFn = t.mock.fn(async () => ({
      choices: [{ message: { content: mockResponse } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.predictPerformance("Great content!", "twitter");
    assert.strictEqual(result.platform, "twitter");
    assert.strictEqual(result.metrics.expectedEngagement.value, 150);
    assert.strictEqual(result.optimalTiming.hour, 14);
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

    const createFn = t.mock.fn(async (params: any) => {
      assert.ok(params.messages[1].content.includes("Historical data"));
      return { choices: [{ message: { content: mockResponse } }] };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.predictPerformance("Test", "twitter", historicalData);
    assert.strictEqual(createFn.mock.calls.length, 1);
  });

  it("should throw error on prediction failure", async (t) => {
    const createFn = t.mock.fn(async () => {
      throw new Error("API Error");
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await assert.rejects(async () => {
      await provider.predictPerformance("Test", "twitter");
    }, /OpenAI prediction failed/);
  });
});

describe("OpenAIProvider - Content Variations", { concurrency: 1 }, () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("should generate tone variations", async (t) => {
    const mockResponse = JSON.stringify([
      "Professional tone variation",
      "Casual tone variation",
      "Humorous tone variation",
    ]);

    const createFn = t.mock.fn(async () => ({
      choices: [{ message: { content: mockResponse } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.generateVariations("Original content", "tone", 3);
    assert.ok(Array.isArray(result));
    assert.strictEqual(result.length, 3);
  });

  it("should generate length variations", async (t) => {
    const mockResponse = JSON.stringify(["Short", "Medium length", "Long detailed version"]);

    const createFn = t.mock.fn(async () => ({
      choices: [{ message: { content: mockResponse } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.generateVariations("Original", "length", 3);
    assert.ok(Array.isArray(result));
    assert.strictEqual(result.length, 3);
  });

  it("should generate audience variations", async (t) => {
    const mockResponse = JSON.stringify(["For executives", "For marketers", "For consumers"]);

    const createFn = t.mock.fn(async () => ({
      choices: [{ message: { content: mockResponse } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.generateVariations("Original", "audience", 3);
    assert.ok(Array.isArray(result));
    assert.strictEqual(result.length, 3);
  });

  it("should include system message for JSON array response", async (t) => {
    const createFn = t.mock.fn(async (params: any) => {
      assert.strictEqual(params.messages.length, 2);
      assert.strictEqual(params.messages[0].role, "system");
      assert.ok(params.messages[0].content.includes("JSON array"));
      return { choices: [{ message: { content: '["Variation 1", "Variation 2"]' } }] };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.generateVariations("Test", "tone", 2);
    assert.strictEqual(createFn.mock.calls.length, 1);
  });

  it("should throw error on variation generation failure", async (t) => {
    const createFn = t.mock.fn(async () => {
      throw new Error("API Error");
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await assert.rejects(async () => {
      await provider.generateVariations("Test", "tone", 3);
    }, /OpenAI variation generation failed/);
  });
});

describe("OpenAIProvider - Error Handling", { concurrency: 1 }, () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("should handle rate limit errors", async (t) => {
    const createFn = t.mock.fn(async () => {
      const error: any = new Error("Rate limit exceeded");
      error.status = 429;
      throw error;
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await assert.rejects(async () => {
      await provider.generateText([{ role: "user", content: "Test" }]);
    }, /OpenAI generation failed/);
  });

  it("should handle authentication errors", async (t) => {
    const createFn = t.mock.fn(async () => {
      const error: any = new Error("Invalid API key");
      error.status = 401;
      throw error;
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await assert.rejects(async () => {
      await provider.generateText([{ role: "user", content: "Test" }]);
    }, /OpenAI generation failed/);
  });

  it("should handle server errors", async (t) => {
    const createFn = t.mock.fn(async () => {
      const error: any = new Error("Internal server error");
      error.status = 500;
      throw error;
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await assert.rejects(async () => {
      await provider.generateText([{ role: "user", content: "Test" }]);
    }, /OpenAI generation failed/);
  });

  it("should handle content filter errors", async (t) => {
    const createFn = t.mock.fn(async () => {
      const error: any = new Error("Content filtered");
      error.status = 400;
      throw error;
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await assert.rejects(async () => {
      await provider.generateText([{ role: "user", content: "Test" }]);
    }, /OpenAI generation failed/);
  });

  it("should handle malformed API responses", async (t) => {
    const createFn = t.mock.fn(async () => ({ choices: [] }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.generateText([{ role: "user", content: "Test" }]);
    assert.strictEqual(result, "");
  });
});
