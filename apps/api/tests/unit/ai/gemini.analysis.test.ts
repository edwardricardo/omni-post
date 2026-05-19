/**
 * @file gemini.analysis.test.ts
 * @description HTTP-faithful tests for GeminiProvider content analysis and
 *              optimization. Intercepts the real Google GenAI generateContent
 *              wire via MSW and asserts the adapter requests native JSON
 *              (`responseMimeType`) and schema-validates the candidate text.
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
import { GeminiProvider } from "../../../src/ai/providers/gemini.js";
import { mockConfig } from "./gemini.test-helpers.js";
import {
  AI_ENDPOINTS,
  aiWireServer,
  geminiResponse,
  http,
  HttpResponse,
  useAiWireServer,
} from "./msw/aiWireServer.js";

useAiWireServer();

describe("GeminiProvider - Content Analysis", () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider(mockConfig);
  });

  it("returns the schema-validated sentiment slice", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.gemini, () =>
        geminiResponse({ sentiment: { score: 0.8, label: "positive", confidence: 0.95 } })
      )
    );

    const result = await provider.analyzeContent("I love this product!", "sentiment");

    expect(result.sentiment?.score).toBe(0.8);
    expect(result.sentiment?.label).toBe("positive");
    expect(result.sentiment?.confidence).toBe(0.95);
  });

  it("returns the schema-validated tone slice", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.gemini, () =>
        geminiResponse({
          tone: { detected: "professional", confidence: 0.9, suggestions: ["Add warmth", "Relax"] },
        })
      )
    );

    const result = await provider.analyzeContent("Dear Sir/Madam", "tone");

    expect(result.tone?.detected).toBe("professional");
    expect(result.tone?.suggestions.length).toBe(2);
  });

  it("returns the schema-validated readability slice", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.gemini, () =>
        geminiResponse({
          readability: { score: 75, level: "High School", suggestions: ["Simplify"] },
        })
      )
    );

    const result = await provider.analyzeContent("Complex content", "readability");

    expect(result.readability?.score).toBe(75);
    expect(result.readability?.level).toBe("High School");
  });

  it("returns the schema-validated engagement slice", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.gemini, () =>
        geminiResponse({
          engagement: {
            score: 85,
            factors: [{ factor: "call-to-action", impact: 90, suggestion: "Strong CTA" }],
          },
        })
      )
    );

    const result = await provider.analyzeContent("Join us today!", "engagement");

    expect(result.engagement?.score).toBe(85);
    expect(result.engagement?.factors.length).toBe(1);
  });

  it("requests native JSON output on the wire", async () => {
    let rawBody = "";
    aiWireServer.use(
      http.post(AI_ENDPOINTS.gemini, async ({ request }) => {
        rawBody = JSON.stringify(await request.json());
        return geminiResponse({ sentiment: { score: 0.7, label: "positive", confidence: 0.85 } });
      })
    );

    await provider.analyzeContent("Good content", "sentiment");

    expect(rawBody.includes("application/json")).toBeTruthy();
  });

  it("throws a structured-generation error when the candidate text is not JSON", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.gemini, () =>
        HttpResponse.json({
          candidates: [
            { content: { parts: [{ text: "Not JSON at all" }], role: "model" }, index: 0 },
          ],
        })
      )
    );

    await expect(provider.analyzeContent("Test content", "sentiment")).rejects.toThrow(
      /Gemini structured generation failed/
    );
  });
});

describe("GeminiProvider - Content Optimization", () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider(mockConfig);
  });

  it("returns the schema-validated optimization", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.gemini, () =>
        geminiResponse({
          optimizedText: "Optimized tweet with emojis! 🚀",
          changes: [{ type: "added", original: ".", optimized: "! 🚀", reason: "Engagement" }],
          hashtags: ["socialmedia", "marketing"],
          mentions: ["influencer"],
          mediasuggestions: [{ type: "image", description: "Logo", dimensions: "1200x628" }],
          platformSpecific: {
            twitter: { text: "Optimized", characterCount: 250, optimizations: ["Hashtags"] },
          },
        })
      )
    );

    const result = await provider.optimizeContent("Original tweet", "twitter");

    expect(result.optimizedText).toBe("Optimized tweet with emojis! 🚀");
    expect(result.hashtags.length).toBe(2);
  });

  it("carries the brand voice into the prompt on the wire", async () => {
    let rawBody = "";
    aiWireServer.use(
      http.post(AI_ENDPOINTS.gemini, async ({ request }) => {
        rawBody = JSON.stringify(await request.json());
        return geminiResponse({
          optimizedText: "Professional content here",
          changes: [],
          hashtags: [],
          mentions: [],
          mediasuggestions: [],
          platformSpecific: {},
        });
      })
    );

    await provider.optimizeContent("Test content", "linkedin", "professional");

    expect(rawBody.includes("professional")).toBeTruthy();
  });

  it("throws a structured-generation error when the API rejects the request", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.gemini, () =>
        HttpResponse.json({ error: { message: "bad request" } }, { status: 400 })
      )
    );

    await expect(provider.optimizeContent("Test content", "twitter")).rejects.toThrow(
      /Gemini structured generation failed/
    );
  });
});
