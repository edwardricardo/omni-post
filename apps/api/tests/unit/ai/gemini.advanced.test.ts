/**
 * @file gemini.advanced.test.ts
 * @description HTTP-faithful tests for GeminiProvider performance prediction,
 *              content variations, and plain-text error handling. Intercepts
 *              the real Google GenAI generateContent wire via MSW.
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

const predictionPayload = {
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
};

describe("GeminiProvider - Performance Prediction", () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider(mockConfig);
  });

  it("returns the schema-validated prediction", async () => {
    aiWireServer.use(http.post(AI_ENDPOINTS.gemini, () => geminiResponse(predictionPayload)));

    const result = await provider.predictPerformance("Great content!", "twitter");

    expect(result.platform).toBe("twitter");
    expect(result.metrics.expectedEngagement.value).toBe(150);
    expect(result.optimalTiming.hour).toBe(14);
  });

  it("includes the historical performance context in the prompt on the wire", async () => {
    let rawBody = "";
    aiWireServer.use(
      http.post(AI_ENDPOINTS.gemini, async ({ request }) => {
        rawBody = JSON.stringify(await request.json());
        return geminiResponse(predictionPayload);
      })
    );

    await provider.predictPerformance("Test content", "twitter", [
      { engagement: 200, reach: 5000 },
    ]);

    expect(rawBody.includes("Historical performance context")).toBeTruthy();
  });

  it("throws a structured-generation error when the API rejects the request", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.gemini, () =>
        HttpResponse.json({ error: { message: "bad request" } }, { status: 400 })
      )
    );

    await expect(provider.predictPerformance("Test content", "twitter")).rejects.toThrow(
      /Gemini structured generation failed/
    );
  });
});

describe("GeminiProvider - Content Variations", () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider(mockConfig);
  });

  it("unwraps the schema-validated variations object into a string array", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.gemini, () =>
        geminiResponse({ variations: ["Professional", "Casual", "Humorous"] })
      )
    );

    const result = await provider.generateVariations("Original content", "tone", 3);

    expect(Array.isArray(result)).toBeTruthy();
    expect(result.length).toBe(3);
    expect(result[0]).toBe("Professional");
  });

  it("varies by the requested dimension on the wire", async () => {
    let rawBody = "";
    aiWireServer.use(
      http.post(AI_ENDPOINTS.gemini, async ({ request }) => {
        rawBody = JSON.stringify(await request.json());
        return geminiResponse({ variations: ["For execs", "For marketers"] });
      })
    );

    await provider.generateVariations("Original content", "audience", 2);

    expect(rawBody.includes("audience")).toBeTruthy();
  });

  it("throws a structured-generation error when the API rejects the request", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.gemini, () =>
        HttpResponse.json({ error: { message: "bad request" } }, { status: 400 })
      )
    );

    await expect(provider.generateVariations("Test", "tone", 3)).rejects.toThrow(
      /Gemini structured generation failed/
    );
  });
});

describe("GeminiProvider - Plain Text Error Handling", () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider(mockConfig);
  });

  it("wraps an API error into an AppError on plain-text generation", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.gemini, () =>
        HttpResponse.json({ error: { message: "Invalid API key" } }, { status: 400 })
      )
    );

    await expect(provider.generateText([{ role: "user", content: "Test" }])).rejects.toThrow(
      /Gemini generation failed/
    );
  });

  it("returns an empty string when the response has no candidates", async () => {
    aiWireServer.use(http.post(AI_ENDPOINTS.gemini, () => HttpResponse.json({})));

    const result = await provider.generateText([{ role: "user", content: "Test" }]);
    expect(result).toBe("");
  });
});
