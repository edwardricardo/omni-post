/**
 * @file openai.optimization.test.ts
 * @description HTTP-faithful tests for OpenAIProvider structured operations
 *              (optimization, prediction, variations) plus plain-text error
 *              handling. Intercepts the real OpenAI chat-completions wire via
 *              MSW and asserts the adapter emits a strict JSON-schema
 *              `response_format` and schema-validates the response.
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
import { OpenAIProvider } from "../../../src/ai/providers/openai.js";
import { mockConfig } from "./openai.test-helpers.js";
import {
  AI_ENDPOINTS,
  aiWireServer,
  http,
  HttpResponse,
  openAiChatResponse,
  useAiWireServer,
} from "./msw/aiWireServer.js";

useAiWireServer();

const optimizationPayload = {
  optimizedText: "Optimized tweet! 🚀",
  changes: [{ type: "added", original: ".", optimized: "! 🚀", reason: "Added excitement" }],
  hashtags: ["socialmedia", "marketing"],
  mentions: ["influencer"],
  mediasuggestions: [{ type: "image", description: "Brand logo", dimensions: "1200x628" }],
  platformSpecific: {
    twitter: { text: "Optimized for Twitter", characterCount: 250, optimizations: ["Hashtags"] },
  },
};

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
    opportunities: ["Trending topic"],
    threats: ["High competition"],
  },
};

describe("OpenAIProvider - Content Optimization", () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("returns the schema-validated optimization when the model responds on-contract", async () => {
    aiWireServer.use(http.post(AI_ENDPOINTS.openai, () => openAiChatResponse(optimizationPayload)));

    const result = await provider.optimizeContent("Original tweet", "twitter");

    expect(result.optimizedText).toBe("Optimized tweet! 🚀");
    expect(Array.isArray(result.changes)).toBeTruthy();
    expect(result.hashtags.length).toBe(2);
  });

  it("sends a strict json_schema response_format with the optimization spec name", async () => {
    let sentBody: Record<string, unknown> = {};
    aiWireServer.use(
      http.post(AI_ENDPOINTS.openai, async ({ request }) => {
        sentBody = (await request.json()) as Record<string, unknown>;
        return openAiChatResponse(optimizationPayload);
      })
    );

    await provider.optimizeContent("Original tweet", "twitter");

    const responseFormat = sentBody.response_format as {
      type: string;
      json_schema: { name: string; strict: boolean };
    };
    expect(responseFormat.type).toBe("json_schema");
    expect(responseFormat.json_schema.name).toBe("content_optimization");
    expect(responseFormat.json_schema.strict).toBe(true);
  });

  it("carries the brand voice into the user prompt on the wire", async () => {
    let sentBody: { messages: Array<{ role: string; content: string }> } = { messages: [] };
    aiWireServer.use(
      http.post(AI_ENDPOINTS.openai, async ({ request }) => {
        sentBody = (await request.json()) as typeof sentBody;
        return openAiChatResponse(optimizationPayload);
      })
    );

    await provider.optimizeContent("Test content", "linkedin", "professional");

    expect(sentBody.messages[1]?.content.includes("professional")).toBeTruthy();
  });

  it("throws a structured-generation error when the API rejects the request", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.openai, () =>
        HttpResponse.json({ error: { message: "Bad request" } }, { status: 400 })
      )
    );

    await expect(provider.optimizeContent("Test", "twitter")).rejects.toThrow(
      /OpenAI structured generation failed/
    );
  });
});

describe("OpenAIProvider - Performance Prediction", () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("returns the schema-validated prediction when the model responds on-contract", async () => {
    aiWireServer.use(http.post(AI_ENDPOINTS.openai, () => openAiChatResponse(predictionPayload)));

    const result = await provider.predictPerformance("Great content!", "twitter");

    expect(result.platform).toBe("twitter");
    expect(result.metrics.expectedEngagement.value).toBe(150);
    expect(result.optimalTiming.hour).toBe(14);
  });

  it("includes the historical data slice in the user prompt", async () => {
    let sentBody: { messages: Array<{ role: string; content: string }> } = { messages: [] };
    aiWireServer.use(
      http.post(AI_ENDPOINTS.openai, async ({ request }) => {
        sentBody = (await request.json()) as typeof sentBody;
        return openAiChatResponse(predictionPayload);
      })
    );

    await provider.predictPerformance("Test", "twitter", [{ engagement: 200, reach: 5000 }]);

    expect(sentBody.messages[1]?.content.includes("Historical data")).toBeTruthy();
  });

  it("throws a structured-generation error when the API rejects the request", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.openai, () =>
        HttpResponse.json({ error: { message: "Bad request" } }, { status: 400 })
      )
    );

    await expect(provider.predictPerformance("Test", "twitter")).rejects.toThrow(
      /OpenAI structured generation failed/
    );
  });
});

describe("OpenAIProvider - Content Variations", () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("unwraps the schema-validated variations object into a string array", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.openai, () =>
        openAiChatResponse({ variations: ["Professional", "Casual", "Humorous"] })
      )
    );

    const result = await provider.generateVariations("Original content", "tone", 3);

    expect(Array.isArray(result)).toBeTruthy();
    expect(result.length).toBe(3);
    expect(result[0]).toBe("Professional");
  });

  it("sends the content_variations spec name in the response_format", async () => {
    let sentBody: Record<string, unknown> = {};
    aiWireServer.use(
      http.post(AI_ENDPOINTS.openai, async ({ request }) => {
        sentBody = (await request.json()) as Record<string, unknown>;
        return openAiChatResponse({ variations: ["A", "B"] });
      })
    );

    await provider.generateVariations("Test", "tone", 2);

    const responseFormat = sentBody.response_format as { json_schema: { name: string } };
    expect(responseFormat.json_schema.name).toBe("content_variations");
  });

  it("throws a structured-generation error when the API rejects the request", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.openai, () =>
        HttpResponse.json({ error: { message: "Bad request" } }, { status: 400 })
      )
    );

    await expect(provider.generateVariations("Test", "tone", 3)).rejects.toThrow(
      /OpenAI structured generation failed/
    );
  });
});

describe("OpenAIProvider - Plain Text Error Handling", () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("wraps an API error into an AppError on plain-text generation", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.openai, () =>
        HttpResponse.json({ error: { message: "Invalid API key" } }, { status: 400 })
      )
    );

    await expect(provider.generateText([{ role: "user", content: "Test" }])).rejects.toThrow(
      /OpenAI generation failed/
    );
  });

  it("returns an empty string when the API yields no choices", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.openai, () =>
        HttpResponse.json({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 0,
          model: "test-model",
          choices: [],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        })
      )
    );

    const result = await provider.generateText([{ role: "user", content: "Test" }]);
    expect(result).toBe("");
  });
});
