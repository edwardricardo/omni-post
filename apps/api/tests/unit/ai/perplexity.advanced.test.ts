import { describe, it, beforeEach, vi, expect } from "vitest";
import { PerplexityProvider } from "../../../src/ai/providers/perplexity.js";
import { mockConfig } from "./perplexity.test-helpers.js";

describe("PerplexityProvider - Content Analysis", () => {
  let provider: PerplexityProvider;

  beforeEach(() => {
    provider = new PerplexityProvider(mockConfig);
  });

  it("should analyze sentiment with research context", async (_t) => {
    const mockResponse = JSON.stringify({
      score: 0.8,
      label: "positive",
      confidence: 0.95,
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(body.messages[1].content.includes("Search for the latest research")).toBeTruthy();
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.analyzeContent("I love this product!", "sentiment");
    expect(result.score).toBe(0.8);
    expect(result.label).toBe("positive");
  });

  it("should analyze tone with research context", async (_t) => {
    const mockResponse = JSON.stringify({
      detected: "professional",
      confidence: 0.9,
      suggestions: ["Add personal touches"],
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(body.messages[1].content.includes("Research current best practices")).toBeTruthy();
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.analyzeContent("Dear Sir/Madam", "tone");
    expect(result.detected).toBe("professional");
  });

  it("should analyze readability with current standards", async (_t) => {
    const mockResponse = JSON.stringify({
      score: 75,
      level: "High School",
      suggestions: ["Simplify sentences"],
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(
        body.messages[1].content.includes("current readability assessment standards")
      ).toBeTruthy();
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.analyzeContent("Complex content", "readability");
    expect(result.score).toBe(75);
  });

  it("should analyze engagement with latest factors", async (_t) => {
    const mockResponse = JSON.stringify({
      score: 85,
      factors: [{ factor: "emotional appeal", impact: 80, suggestion: "Add storytelling" }],
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(
        body.messages[1].content.includes("latest social media engagement factors")
      ).toBeTruthy();
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.analyzeContent("Join us!", "engagement");
    expect(result.score).toBe(85);
  });

  it("should include system message for JSON response", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(body.messages.length).toBe(2);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[0].content.includes("JSON")).toBeTruthy();
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

  it("should throw error on malformed JSON response", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Not JSON" } }] }),
    }));

    await expect(provider.analyzeContent("Test", "sentiment")).rejects.toThrow(
      /Perplexity analysis failed/
    );
  });
});

describe("PerplexityProvider - Content Optimization", () => {
  let provider: PerplexityProvider;

  beforeEach(() => {
    provider = new PerplexityProvider(mockConfig);
  });

  it("should optimize content with latest platform research", async (_t) => {
    const mockResponse = JSON.stringify({
      optimizedText: "Optimized tweet! 🚀",
      changes: [{ type: "added", original: ".", optimized: "! 🚀", reason: "Engagement" }],
      hashtags: ["socialmedia"],
      mentions: [],
      mediasuggestions: [],
      platformSpecific: {},
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(
        body.messages[1].content.includes("Research the latest twitter algorithm")
      ).toBeTruthy();
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.optimizeContent("Original tweet", "twitter");
    expect(result.optimizedText).toBe("Optimized tweet! 🚀");
  });

  it("should include brand voice in optimization prompt", async (_t) => {
    const mockResponse = JSON.stringify({
      optimizedText: "Professional content",
      changes: [],
      hashtags: [],
      mentions: [],
      mediasuggestions: [],
      platformSpecific: {},
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(
        body.messages[1].content.includes("maintaining a professional brand voice")
      ).toBeTruthy();
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    await provider.optimizeContent("Test", "linkedin", "professional");
  });

  it("should reference 2024 best practices", async (_t) => {
    const mockResponse = JSON.stringify({
      optimizedText: "Test",
      changes: [],
      hashtags: [],
      mentions: [],
      mediasuggestions: [],
      platformSpecific: {},
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(body.messages[1].content.includes("2024")).toBeTruthy();
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    await provider.optimizeContent("Test", "instagram");
  });

  it("should throw error on optimization failure", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("API Error");
    });

    await expect(provider.optimizeContent("Test", "twitter")).rejects.toThrow(
      /Perplexity optimization failed/
    );
  });
});

describe("PerplexityProvider - Performance Prediction", () => {
  let provider: PerplexityProvider;

  beforeEach(() => {
    provider = new PerplexityProvider(mockConfig);
  });

  it("should predict performance with current trends", async (_t) => {
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

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(
        body.messages[1].content.includes("Research current twitter performance trends")
      ).toBeTruthy();
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.predictPerformance("Great content!", "twitter");
    expect(result.platform).toBe("twitter");
    expect(result.metrics.expectedEngagement.value).toBe(150);
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

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(body.messages[1].content.includes("Historical context")).toBeTruthy();
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    await provider.predictPerformance("Test", "twitter", historicalData);
  });

  it("should limit historical data to 3 entries", async (_t) => {
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

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      const historicalContext = body.messages[1].content;
      const parsedData = JSON.parse(historicalContext.match(/\[[\s\S]*\]/)[0]);
      expect(parsedData.length).toBe(3);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    await provider.predictPerformance("Test", "twitter", historicalData);
  });

  it("should throw error on prediction failure", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("API Error");
    });

    await expect(provider.predictPerformance("Test", "twitter")).rejects.toThrow(
      /Perplexity prediction failed/
    );
  });
});

describe("PerplexityProvider - Content Variations", () => {
  let provider: PerplexityProvider;

  beforeEach(() => {
    provider = new PerplexityProvider(mockConfig);
  });

  it("should generate variations with research context", async (_t) => {
    const mockResponse = JSON.stringify([
      "Professional variation",
      "Casual variation",
      "Humorous variation",
    ]);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(
        body.messages[1].content.includes("Research current content creation best practices")
      ).toBeTruthy();
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.generateVariations("Original", "tone", 3);
    expect(Array.isArray(result)).toBeTruthy();
    expect(result.length).toBe(3);
  });

  it("should generate tone variations", async (_t) => {
    const mockResponse = JSON.stringify(["Tone 1", "Tone 2", "Tone 3"]);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(body.messages[1].content.includes("varying the tone")).toBeTruthy();
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.generateVariations("Original", "tone", 3);
    expect(result.length).toBe(3);
  });

  it("should generate length variations", async (_t) => {
    const mockResponse = JSON.stringify(["Short", "Medium", "Long"]);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(body.messages[1].content.includes("varying the length")).toBeTruthy();
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.generateVariations("Original", "length", 3);
    expect(result.length).toBe(3);
  });

  it("should generate audience variations", async (_t) => {
    const mockResponse = JSON.stringify(["For execs", "For marketers", "For consumers"]);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(body.messages[1].content.includes("varying the audience")).toBeTruthy();
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.generateVariations("Original", "audience", 3);
    expect(result.length).toBe(3);
  });

  it("should request exact count of variations", async (_t) => {
    const mockResponse = JSON.stringify(["V1", "V2", "V3", "V4", "V5"]);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(body.messages[1].content.includes("generate 5")).toBeTruthy();
      expect(body.messages[1].content.includes("exactly 5 strings")).toBeTruthy();
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
      };
    });

    const result = await provider.generateVariations("Original", "tone", 5);
    expect(result.length).toBe(5);
  });

  it("should throw error on variation generation failure", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("API Error");
    });

    await expect(provider.generateVariations("Test", "tone", 3)).rejects.toThrow(
      /Perplexity variation generation failed/
    );
  });
});

describe("PerplexityProvider - Error Handling", () => {
  let provider: PerplexityProvider;

  beforeEach(() => {
    provider = new PerplexityProvider(mockConfig);
  });

  it("should handle rate limit errors", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    }));

    await expect(provider.generateText([{ role: "user", content: "Test" }])).rejects.toThrow(
      /Perplexity API error: 429/
    );
  });

  it("should handle authentication errors", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    }));

    await expect(provider.generateText([{ role: "user", content: "Test" }])).rejects.toThrow(
      /Perplexity API error: 401/
    );
  });

  it("should handle server errors", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    }));

    await expect(provider.generateText([{ role: "user", content: "Test" }])).rejects.toThrow(
      /Perplexity API error: 500/
    );
  });

  it("should handle malformed API responses", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ choices: [] }),
    }));

    const result = await provider.generateText([{ role: "user", content: "Test" }]);
    expect(result).toBe("");
  });

  it("should handle JSON parsing errors", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => {
        throw new Error("Invalid JSON");
      },
    }));

    await expect(provider.generateText([{ role: "user", content: "Test" }])).rejects.toThrow(
      /Perplexity generation failed/
    );
  });
});
