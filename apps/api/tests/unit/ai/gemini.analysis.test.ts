import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { GeminiProvider } from "../../../src/ai/providers/gemini.js";
import { mockConfig, makeMockClient } from "./gemini.test-helpers.js";

describe("GeminiProvider - Content Analysis", { concurrency: 1 }, () => {
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

    const generateContentFn = t.mock.fn(async () => ({ text: mockResponse }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.analyzeContent("I love this product!", "sentiment");
    assert.strictEqual(result.score, 0.8);
    assert.strictEqual(result.label, "positive");
    assert.strictEqual(result.confidence, 0.95);
  });

  it("should analyze tone correctly", async (t) => {
    const mockResponse = JSON.stringify({
      detected: "professional",
      confidence: 0.9,
      suggestions: ["Consider adding more personal touches", "Use contractions for friendliness"],
    });

    const generateContentFn = t.mock.fn(async () => ({ text: mockResponse }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.analyzeContent("Dear Sir/Madam, I am writing to...", "tone");
    assert.strictEqual(result.detected, "professional");
    assert.strictEqual(result.confidence, 0.9);
    assert.ok(Array.isArray(result.suggestions));
    assert.strictEqual(result.suggestions?.length, 2);
  });

  it("should analyze readability correctly", async (t) => {
    const mockResponse = JSON.stringify({
      score: 75,
      level: "High School",
      suggestions: ["Simplify complex sentences", "Use more common vocabulary"],
    });

    const generateContentFn = t.mock.fn(async () => ({ text: mockResponse }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.analyzeContent("Complex technical content here", "readability");
    assert.strictEqual(result.score, 75);
    assert.strictEqual(result.level, "High School");
    assert.ok(Array.isArray(result.suggestions));
  });

  it("should analyze engagement correctly", async (t) => {
    const mockResponse = JSON.stringify({
      score: 85,
      factors: [
        { factor: "emotional appeal", impact: 80, suggestion: "Add more storytelling" },
        { factor: "call-to-action", impact: 90, suggestion: "Strong CTA present" },
      ],
    });

    const generateContentFn = t.mock.fn(async () => ({ text: mockResponse }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.analyzeContent("Join us today!", "engagement");
    assert.strictEqual(result.score, 85);
    assert.ok(Array.isArray(result.factors));
    assert.strictEqual(result.factors?.length, 2);
  });

  it("should extract JSON from markdown-wrapped response", async (t) => {
    const mockResponse = '```json\n{"score": 0.7, "label": "positive", "confidence": 0.85}\n```';

    const generateContentFn = t.mock.fn(async () => ({ text: mockResponse }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.analyzeContent("Good content", "sentiment");
    assert.strictEqual(result.score, 0.7);
    assert.strictEqual(result.label, "positive");
  });

  it("should throw error on malformed JSON response", async (t) => {
    const generateContentFn = t.mock.fn(async () => ({ text: "Not JSON at all" }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await assert.rejects(async () => {
      await provider.analyzeContent("Test content", "sentiment");
    }, /Gemini analysis failed/);
  });
});

describe("GeminiProvider - Content Optimization", { concurrency: 1 }, () => {
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

    const generateContentFn = t.mock.fn(async () => ({ text: mockResponse }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.optimizeContent("Original tweet", "twitter");
    assert.strictEqual(result.optimizedText, "Optimized tweet with emojis! 🚀");
    assert.ok(Array.isArray(result.changes));
    assert.ok(Array.isArray(result.hashtags));
    assert.strictEqual(result.hashtags.length, 2);
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

    const generateContentFn = t.mock.fn(async (params: any) => {
      assert.ok(params.contents.includes("professional"));
      return { text: mockResponse };
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.optimizeContent("Test content", "linkedin", "professional");
    assert.strictEqual(generateContentFn.mock.calls.length, 1);
  });

  it("should throw error on optimization failure", async (t) => {
    const generateContentFn = t.mock.fn(async () => {
      throw new Error("API Error");
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await assert.rejects(async () => {
      await provider.optimizeContent("Test content", "twitter");
    }, /Gemini optimization failed/);
  });
});
