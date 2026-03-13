import { describe, it, beforeEach, vi, expect } from "vitest";
import { GeminiProvider } from "../../../src/ai/providers/gemini.js";
import { mockConfig, makeMockClient } from "./gemini.test-helpers.js";

describe("GeminiProvider - Performance Prediction", () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider(mockConfig);
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
        opportunities: ["Trending topic alignment"],
        threats: ["High competition"],
      },
    });

    const generateContentFn = vi.fn(async () => ({ text: mockResponse }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.predictPerformance("Great content!", "twitter");
    expect(result.platform).toBe("twitter");
    expect(result.metrics.expectedEngagement.value).toBe(150);
    expect(result.optimalTiming.hour).toBe(14);
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

    const generateContentFn = vi.fn(async (params: any) => {
      expect(params.contents.includes("Historical performance context")).toBeTruthy();
      return { text: mockResponse };
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.predictPerformance("Test content", "twitter", historicalData);
    expect(generateContentFn.mock.calls.length).toBe(1);
  });

  it("should throw error on prediction failure", async (t) => {
    const generateContentFn = vi.fn(async () => {
      throw new Error("API Error");
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await expect(provider.predictPerformance("Test content", "twitter")).rejects.toThrow(
      /Gemini prediction failed/
    );
  });
});

describe("GeminiProvider - Content Variations", () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider(mockConfig);
  });

  it("should generate tone variations", async (t) => {
    const mockResponse = JSON.stringify([
      "Professional tone variation",
      "Casual tone variation",
      "Humorous tone variation",
    ]);

    const generateContentFn = vi.fn(async () => ({ text: mockResponse }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.generateVariations("Original content", "tone", 3);
    expect(Array.isArray(result)).toBeTruthy();
    expect(result.length).toBe(3);
  });

  it("should generate length variations", async (t) => {
    const mockResponse = JSON.stringify([
      "Short version",
      "Medium length version here",
      "Long detailed version with more context",
    ]);

    const generateContentFn = vi.fn(async () => ({ text: mockResponse }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.generateVariations("Original content", "length", 3);
    expect(Array.isArray(result)).toBeTruthy();
    expect(result.length).toBe(3);
  });

  it("should generate audience variations", async (t) => {
    const mockResponse = JSON.stringify(["For executives", "For marketers", "For consumers"]);

    const generateContentFn = vi.fn(async () => ({ text: mockResponse }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.generateVariations("Original content", "audience", 3);
    expect(Array.isArray(result)).toBeTruthy();
    expect(result.length).toBe(3);
  });

  it("should extract JSON array from markdown-wrapped response", async (t) => {
    const mockResponse = '```json\n["Variation 1", "Variation 2"]\n```';

    const generateContentFn = vi.fn(async () => ({ text: mockResponse }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.generateVariations("Original", "tone", 2);
    expect(Array.isArray(result)).toBeTruthy();
    expect(result.length).toBe(2);
  });

  it("should throw error on variation generation failure", async (t) => {
    const generateContentFn = vi.fn(async () => {
      throw new Error("API Error");
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await expect(provider.generateVariations("Test", "tone", 3)).rejects.toThrow(
      /Gemini variation generation failed/
    );
  });
});

describe("GeminiProvider - Error Handling", () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider(mockConfig);
  });

  it("should handle rate limit errors", async (t) => {
    const generateContentFn = vi.fn(async () => {
      const error: any = new Error("Rate limit exceeded");
      error.status = 429;
      throw error;
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await expect(provider.generateText([{ role: "user", content: "Test" }])).rejects.toThrow(
      /Gemini generation failed/
    );
  });

  it("should handle authentication errors", async (t) => {
    const generateContentFn = vi.fn(async () => {
      const error: any = new Error("Invalid API key");
      error.status = 401;
      throw error;
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await expect(provider.generateText([{ role: "user", content: "Test" }])).rejects.toThrow(
      /Gemini generation failed/
    );
  });

  it("should handle server errors", async (t) => {
    const generateContentFn = vi.fn(async () => {
      const error: any = new Error("Internal server error");
      error.status = 500;
      throw error;
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await expect(provider.generateText([{ role: "user", content: "Test" }])).rejects.toThrow(
      /Gemini generation failed/
    );
  });

  it("should handle malformed API responses", async (t) => {
    const generateContentFn = vi.fn(async () => ({}));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.generateText([{ role: "user", content: "Test" }]);
    expect(result).toBe("");
  });
});
