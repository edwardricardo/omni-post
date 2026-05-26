/**
 * @file anthropic.structured.test.ts
 * @description HTTP-faithful tests for AnthropicProvider structured operations
 *              (analysis, optimization, prediction, variations). Intercepts
 *              the real Anthropic messages wire via MSW and asserts the
 *              adapter forces single-tool use and schema-validates the
 *              returned tool input.
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
import { AnthropicProvider } from "../../../src/ai/providers/anthropic.js";
import type { AIProviderConfig } from "../../../src/ai/types.js";
import {
  AI_ENDPOINTS,
  aiWireServer,
  anthropicToolResponse,
  http,
  HttpResponse,
  useAiWireServer,
} from "./msw/aiWireServer.js";

useAiWireServer();

const mockConfig: AIProviderConfig = {
  apiKey: "test-anthropic-api-key",
  model: "claude-sonnet-4-6",
  timeout: 30000,
  retries: 3,
  rateLimit: {
    requestsPerMinute: 60,
    tokensPerMinute: 100000,
    requestsPerDay: 1000,
    tokensPerDay: 1000000,
  },
};

const optimizationPayload = {
  optimizedText: "Optimized!",
  changes: [{ type: "modified", original: "x", optimized: "y", reason: "Clarity" }],
  hashtags: ["growth"],
  mentions: [],
  mediasuggestions: [],
  platformSpecific: {},
};

const predictionPayload = {
  platform: "linkedin",
  metrics: {
    expectedEngagement: { value: 90, confidence: 0.7, range: { min: 60, max: 120 } },
    expectedReach: { value: 3000, confidence: 0.7, range: { min: 2000, max: 4000 } },
    viralPotential: 40,
    conversionPotential: 55,
  },
  optimalTiming: { hour: 9, day: "Monday", timezone: "UTC", confidence: 0.8 },
  competitiveAnalysis: { benchmarkScore: 70, opportunities: [], threats: [] },
};

describe("AnthropicProvider - Content Analysis", () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider(mockConfig);
  });

  it("returns the schema-validated sentiment slice from the tool_use input", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.anthropic, () =>
        anthropicToolResponse("content_sentiment", {
          sentiment: { score: -0.4, label: "negative", confidence: 0.88 },
        })
      )
    );

    const result = await provider.analyzeContent("This is disappointing", "sentiment");

    expect(result.sentiment?.score).toBe(-0.4);
    expect(result.sentiment?.label).toBe("negative");
  });

  it("returns the schema-validated engagement slice", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.anthropic, () =>
        anthropicToolResponse("content_engagement", {
          engagement: {
            score: 72,
            factors: [{ factor: "hook", impact: 65, suggestion: "Stronger opener" }],
          },
        })
      )
    );

    const result = await provider.analyzeContent("Read this", "engagement");

    expect(result.engagement?.score).toBe(72);
    expect(result.engagement?.factors[0]?.factor).toBe("hook");
  });

  it("forces single-tool use named for the analysis type on the wire", async () => {
    let sentBody: {
      tools: Array<{ name: string }>;
      tool_choice: { type: string; name: string };
    } = { tools: [], tool_choice: { type: "", name: "" } };
    aiWireServer.use(
      http.post(AI_ENDPOINTS.anthropic, async ({ request }) => {
        sentBody = (await request.json()) as typeof sentBody;
        return anthropicToolResponse("content_tone", {
          tone: { detected: "casual", confidence: 0.6, suggestions: [] },
        });
      })
    );

    await provider.analyzeContent("hey there", "tone");

    expect(sentBody.tools[0]?.name).toBe("content_tone");
    expect(sentBody.tool_choice.type).toBe("tool");
    expect(sentBody.tool_choice.name).toBe("content_tone");
  });

  it("throws a structured-generation error when the API rejects the request", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.anthropic, () =>
        HttpResponse.json({ type: "error", error: { message: "bad request" } }, { status: 400 })
      )
    );

    await expect(provider.analyzeContent("Test", "sentiment")).rejects.toThrow(
      /Anthropic structured generation failed/
    );
  });
});

describe("AnthropicProvider - Content Optimization", () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider(mockConfig);
  });

  it("returns the schema-validated optimization", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.anthropic, () =>
        anthropicToolResponse("content_optimization", optimizationPayload)
      )
    );

    const result = await provider.optimizeContent("Original", "linkedin");

    expect(result.optimizedText).toBe("Optimized!");
    expect(result.hashtags).toEqual(["growth"]);
  });

  it("carries the brand voice into the user prompt on the wire", async () => {
    let sentBody: { messages: Array<{ content: string }> } = { messages: [] };
    aiWireServer.use(
      http.post(AI_ENDPOINTS.anthropic, async ({ request }) => {
        sentBody = (await request.json()) as typeof sentBody;
        return anthropicToolResponse("content_optimization", optimizationPayload);
      })
    );

    await provider.optimizeContent("Original", "linkedin", "professional");

    expect(sentBody.messages[0]?.content.includes("professional brand voice")).toBeTruthy();
  });
});

describe("AnthropicProvider - Performance Prediction and Variations", () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider(mockConfig);
  });

  it("returns the schema-validated prediction", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.anthropic, () =>
        anthropicToolResponse("performance_prediction", predictionPayload)
      )
    );

    const result = await provider.predictPerformance("Great content!", "linkedin");

    expect(result.platform).toBe("linkedin");
    expect(result.metrics.conversionPotential).toBe(55);
  });

  it("unwraps the schema-validated variations object into a string array", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.anthropic, () =>
        anthropicToolResponse("content_variations", { variations: ["A", "B", "C"] })
      )
    );

    const result = await provider.generateVariations("Original", "length", 3);

    expect(result).toEqual(["A", "B", "C"]);
  });

  it("throws a structured-generation error when no tool_use block is returned", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.anthropic, () =>
        HttpResponse.json({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "test-model",
          content: [{ type: "text", text: "I cannot do that" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 0, output_tokens: 0 },
        })
      )
    );

    await expect(provider.generateVariations("Test", "tone", 3)).rejects.toThrow(
      /Anthropic structured generation failed/
    );
  });
});
