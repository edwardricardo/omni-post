import { describe, it, beforeEach, vi, expect } from "vitest";
import { GeminiProvider } from "../../../src/ai/providers/gemini.js";
import { mockConfig, makeMockClient } from "./gemini.test-helpers.js";

describe("GeminiProvider - Content Analysis", () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider(mockConfig);
  });

  it("should analyze sentiment correctly", async (t) => {
    const mockResponse = JSON.stringify({
      score: 0.8,
      label: "positive",
      confidence: 0.95,
    });

    const generateContentFn = vi.fn(async () => ({ text: mockResponse }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.analyzeContent("I love this product!", "sentiment");
    expect(result.score).toBe(0.8);
    expect(result.label).toBe("positive");
    expect(result.confidence).toBe(0.95);
  });

  it("should analyze tone correctly", async (t) => {
    const mockResponse = JSON.stringify({
      detected: "professional",
      confidence: 0.9,
      suggestions: ["Consider adding more personal touches", "Use contractions for friendliness"],
    });

    const generateContentFn = vi.fn(async () => ({ text: mockResponse }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.analyzeContent("Dear Sir/Madam, I am writing to...", "tone");
    expect(result.detected).toBe("professional");
    expect(result.confidence).toBe(0.9);
    expect(Array.isArray(result.suggestions)).toBeTruthy();
    expect(result.suggestions?.length).toBe(2);
  });

  it("should analyze readability correctly", async (t) => {
    const mockResponse = JSON.stringify({
      score: 75,
      level: "High School",
      suggestions: ["Simplify complex sentences", "Use more common vocabulary"],
    });

    const generateContentFn = vi.fn(async () => ({ text: mockResponse }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.analyzeContent("Complex technical content here", "readability");
    expect(result.score).toBe(75);
    expect(result.level).toBe("High School");
    expect(Array.isArray(result.suggestions)).toBeTruthy();
  });

  it("should analyze engagement correctly", async (t) => {
    const mockResponse = JSON.stringify({
      score: 85,
      factors: [
        { factor: "emotional appeal", impact: 80, suggestion: "Add more storytelling" },
        { factor: "call-to-action", impact: 90, suggestion: "Strong CTA present" },
      ],
    });

    const generateContentFn = vi.fn(async () => ({ text: mockResponse }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.analyzeContent("Join us today!", "engagement");
    expect(result.score).toBe(85);
    expect(Array.isArray(result.factors)).toBeTruthy();
    expect(result.factors?.length).toBe(2);
  });

  it("should extract JSON from markdown-wrapped response", async (t) => {
    const mockResponse = '```json\n{"score": 0.7, "label": "positive", "confidence": 0.85}\n```';

    const generateContentFn = vi.fn(async () => ({ text: mockResponse }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.analyzeContent("Good content", "sentiment");
    expect(result.score).toBe(0.7);
    expect(result.label).toBe("positive");
  });

  it("should throw error on malformed JSON response", async (t) => {
    const generateContentFn = vi.fn(async () => ({ text: "Not JSON at all" }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await expect(provider.analyzeContent("Test content", "sentiment")).rejects.toThrow(
      /Gemini analysis failed/
    );
  });
});

describe("GeminiProvider - Content Optimization", () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider(mockConfig);
  });

  it("should optimize content for platform", async (t) => {
    const mockResponse = JSON.stringify({
      optimizedText: "Optimized tweet with emojis! 🚀",
      changes: [
        {
          type: "added",
          original: ".",
          optimized: "! 🚀",
          reason: "Added excitement and emoji for Twitter engagement",
        },
      ],
      hashtags: ["socialmedia", "marketing"],
      mentions: ["influencer"],
      mediasuggestions: [{ type: "image", description: "Brand logo", dimensions: "1200x628" }],
      platformSpecific: {
        twitter: {
          text: "Optimized for Twitter",
          characterCount: 250,
          optimizations: ["Added hashtags"],
        },
      },
    });

    const generateContentFn = vi.fn(async () => ({ text: mockResponse }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.optimizeContent("Original tweet", "twitter");
    expect(result.optimizedText).toBe("Optimized tweet with emojis! 🚀");
    expect(Array.isArray(result.changes)).toBeTruthy();
    expect(Array.isArray(result.hashtags)).toBeTruthy();
    expect(result.hashtags.length).toBe(2);
  });

  it("should include brand voice in optimization", async (t) => {
    const mockResponse = JSON.stringify({
      optimizedText: "Professional content here",
      changes: [],
      hashtags: [],
      mentions: [],
      mediasuggestions: [],
      platformSpecific: {},
    });

    const generateContentFn = vi.fn(async (params: any) => {
      expect(params.contents.includes("professional")).toBeTruthy();
      return { text: mockResponse };
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.optimizeContent("Test content", "linkedin", "professional");
    expect(generateContentFn.mock.calls.length).toBe(1);
  });

  it("should throw error on optimization failure", async (t) => {
    const generateContentFn = vi.fn(async () => {
      throw new Error("API Error");
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await expect(provider.optimizeContent("Test content", "twitter")).rejects.toThrow(
      /Gemini optimization failed/
    );
  });
});
