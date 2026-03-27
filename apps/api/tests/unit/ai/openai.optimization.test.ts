import { describe, it, beforeEach, vi, expect } from "vitest";
import { OpenAIProvider } from "../../../src/ai/providers/openai.js";
import { mockConfig } from "./openai.test-helpers.js";

function makeOpenAIMockClient(createFn: (...args: any[]) => any) {
  return { chat: { completions: { create: createFn } } };
}

describe("OpenAIProvider - Content Optimization", () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("should optimize content for platform", async (_t) => {
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

    const createFn = vi.fn(async () => ({
      choices: [{ message: { content: mockResponse } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.optimizeContent("Original tweet", "twitter");
    expect(result.optimizedText).toBe("Optimized tweet! 🚀");
    expect(Array.isArray(result.changes)).toBeTruthy();
    expect(result.hashtags.length).toBe(2);
  });

  it("should include brand voice in optimization", async (_t) => {
    const mockResponse = JSON.stringify({
      optimizedText: "Professional content",
      changes: [],
      hashtags: [],
      mentions: [],
      mediasuggestions: [],
      platformSpecific: {},
    });

    const createFn = vi.fn(async (params: any) => {
      expect(params.messages[1].content.includes("professional")).toBeTruthy();
      return { choices: [{ message: { content: mockResponse } }] };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.optimizeContent("Test content", "linkedin", "professional");
    expect(createFn.mock.calls.length).toBe(1);
  });

  it("should include system message for JSON response", async (_t) => {
    const createFn = vi.fn(async (params: any) => {
      expect(params.messages.length).toBe(2);
      expect(params.messages[0].role).toBe("system");
      expect(params.messages[0].content.includes("JSON")).toBeTruthy();
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
    expect(createFn.mock.calls.length).toBe(1);
  });

  it("should throw error on optimization failure", async (_t) => {
    const createFn = vi.fn(async () => {
      throw new Error("API Error");
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await expect(provider.optimizeContent("Test", "twitter")).rejects.toThrow(
      /OpenAI optimization failed/
    );
  });
});

describe("OpenAIProvider - Performance Prediction", () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("should predict performance metrics", async (_t) => {
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

    const createFn = vi.fn(async () => ({
      choices: [{ message: { content: mockResponse } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.predictPerformance("Great content!", "twitter");
    expect(result.platform).toBe("twitter");
    expect(result.metrics.expectedEngagement.value).toBe(150);
    expect(result.optimalTiming.hour).toBe(14);
  });

  it("should include historical data in prediction", async (_t) => {
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

    const createFn = vi.fn(async (params: any) => {
      expect(params.messages[1].content.includes("Historical data")).toBeTruthy();
      return { choices: [{ message: { content: mockResponse } }] };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.predictPerformance("Test", "twitter", historicalData);
    expect(createFn.mock.calls.length).toBe(1);
  });

  it("should throw error on prediction failure", async (_t) => {
    const createFn = vi.fn(async () => {
      throw new Error("API Error");
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await expect(provider.predictPerformance("Test", "twitter")).rejects.toThrow(
      /OpenAI prediction failed/
    );
  });
});

describe("OpenAIProvider - Content Variations", () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("should generate tone variations", async (_t) => {
    const mockResponse = JSON.stringify([
      "Professional tone variation",
      "Casual tone variation",
      "Humorous tone variation",
    ]);

    const createFn = vi.fn(async () => ({
      choices: [{ message: { content: mockResponse } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.generateVariations("Original content", "tone", 3);
    expect(Array.isArray(result)).toBeTruthy();
    expect(result.length).toBe(3);
  });

  it("should generate length variations", async (_t) => {
    const mockResponse = JSON.stringify(["Short", "Medium length", "Long detailed version"]);

    const createFn = vi.fn(async () => ({
      choices: [{ message: { content: mockResponse } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.generateVariations("Original", "length", 3);
    expect(Array.isArray(result)).toBeTruthy();
    expect(result.length).toBe(3);
  });

  it("should generate audience variations", async (_t) => {
    const mockResponse = JSON.stringify(["For executives", "For marketers", "For consumers"]);

    const createFn = vi.fn(async () => ({
      choices: [{ message: { content: mockResponse } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.generateVariations("Original", "audience", 3);
    expect(Array.isArray(result)).toBeTruthy();
    expect(result.length).toBe(3);
  });

  it("should include system message for JSON array response", async (_t) => {
    const createFn = vi.fn(async (params: any) => {
      expect(params.messages.length).toBe(2);
      expect(params.messages[0].role).toBe("system");
      expect(params.messages[0].content.includes("JSON array")).toBeTruthy();
      return { choices: [{ message: { content: '["Variation 1", "Variation 2"]' } }] };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.generateVariations("Test", "tone", 2);
    expect(createFn.mock.calls.length).toBe(1);
  });

  it("should throw error on variation generation failure", async (_t) => {
    const createFn = vi.fn(async () => {
      throw new Error("API Error");
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await expect(provider.generateVariations("Test", "tone", 3)).rejects.toThrow(
      /OpenAI variation generation failed/
    );
  });
});

describe("OpenAIProvider - Error Handling", () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("should handle rate limit errors", async (_t) => {
    const createFn = vi.fn(async () => {
      const error: any = new Error("Rate limit exceeded");
      error.status = 429;
      throw error;
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await expect(provider.generateText([{ role: "user", content: "Test" }])).rejects.toThrow(
      /OpenAI generation failed/
    );
  });

  it("should handle authentication errors", async (_t) => {
    const createFn = vi.fn(async () => {
      const error: any = new Error("Invalid API key");
      error.status = 401;
      throw error;
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await expect(provider.generateText([{ role: "user", content: "Test" }])).rejects.toThrow(
      /OpenAI generation failed/
    );
  });

  it("should handle server errors", async (_t) => {
    const createFn = vi.fn(async () => {
      const error: any = new Error("Internal server error");
      error.status = 500;
      throw error;
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await expect(provider.generateText([{ role: "user", content: "Test" }])).rejects.toThrow(
      /OpenAI generation failed/
    );
  });

  it("should handle content filter errors", async (_t) => {
    const createFn = vi.fn(async () => {
      const error: any = new Error("Content filtered");
      error.status = 400;
      throw error;
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await expect(provider.generateText([{ role: "user", content: "Test" }])).rejects.toThrow(
      /OpenAI generation failed/
    );
  });

  it("should handle malformed API responses", async (_t) => {
    const createFn = vi.fn(async () => ({ choices: [] }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.generateText([{ role: "user", content: "Test" }]);
    expect(result).toBe("");
  });
});
