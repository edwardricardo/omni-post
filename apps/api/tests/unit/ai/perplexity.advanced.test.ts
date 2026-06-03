/**
 * @file perplexity.advanced.test.ts
 * @description HTTP-faithful tests for PerplexityProvider structured
 *              operations (analysis, optimization, prediction, variations)
 *              and plain-text error handling. Intercepts the real Perplexity
 *              chat-completions wire via MSW and asserts the adapter emits a
 *              `json_schema` response_format and schema-validates the reply.
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
import { PerplexityProvider } from "../../../src/ai/providers/perplexity.js";
import { mockConfig } from "./perplexity.test-helpers.js";
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
  changes: [{ type: "added", original: ".", optimized: "! 🚀", reason: "Engagement" }],
  hashtags: ["socialmedia"],
  mentions: [],
  mediasuggestions: [],
  platformSpecific: {},
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
  competitiveAnalysis: { benchmarkScore: 78, opportunities: [], threats: [] },
};

describe("PerplexityProvider - Content Analysis", () => {
  let provider: PerplexityProvider;

  beforeEach(() => {
    provider = new PerplexityProvider(mockConfig);
  });

  it("returns the schema-validated sentiment slice with research framing", async () => {
    let userPrompt = "";
    aiWireServer.use(
      http.post(AI_ENDPOINTS.perplexity, async ({ request }) => {
        const body = (await request.json()) as { messages: Array<{ content: string }> };
        userPrompt = body.messages[1]?.content ?? "";
        return openAiChatResponse({
          sentiment: { score: 0.8, label: "positive", confidence: 0.95 },
        });
      })
    );

    const result = await provider.analyzeContent("I love this product!", "sentiment");

    expect(result.sentiment?.score).toBe(0.8);
    expect(result.sentiment?.label).toBe("positive");
    expect(userPrompt.includes("Search for the latest research")).toBeTruthy();
  });

  it("returns the schema-validated tone slice", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.perplexity, () =>
        openAiChatResponse({
          tone: { detected: "professional", confidence: 0.9, suggestions: ["Add warmth"] },
        })
      )
    );

    const result = await provider.analyzeContent("Dear Sir/Madam", "tone");

    expect(result.tone?.detected).toBe("professional");
    expect(result.tone?.suggestions.length).toBe(1);
  });

  it("returns the schema-validated readability slice", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.perplexity, () =>
        openAiChatResponse({
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
      http.post(AI_ENDPOINTS.perplexity, () =>
        openAiChatResponse({
          engagement: {
            score: 85,
            factors: [{ factor: "emotional appeal", impact: 80, suggestion: "Add storytelling" }],
          },
        })
      )
    );

    const result = await provider.analyzeContent("Join us!", "engagement");

    expect(result.engagement?.score).toBe(85);
    expect(result.engagement?.factors.length).toBe(1);
  });

  it("sends a json_schema response_format named for the analysis type", async () => {
    let sentBody: Record<string, unknown> = {};
    aiWireServer.use(
      http.post(AI_ENDPOINTS.perplexity, async ({ request }) => {
        sentBody = (await request.json()) as Record<string, unknown>;
        return openAiChatResponse({
          sentiment: { score: 0.5, label: "neutral", confidence: 0.8 },
        });
      })
    );

    await provider.analyzeContent("Neutral content", "sentiment");

    const responseFormat = sentBody.response_format as {
      type: string;
      json_schema: { name: string };
    };
    expect(responseFormat.type).toBe("json_schema");
    expect(responseFormat.json_schema.name).toBe("content_sentiment");
  });

  it("throws a structured-generation error when the API rejects the request", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.perplexity, () =>
        HttpResponse.json({ error: "bad request" }, { status: 400 })
      )
    );

    await expect(provider.analyzeContent("Test", "sentiment")).rejects.toThrow(
      /Perplexity API error: 400/
    );
  });
});

describe("PerplexityProvider - Content Optimization", () => {
  let provider: PerplexityProvider;

  beforeEach(() => {
    provider = new PerplexityProvider(mockConfig);
  });

  it("returns the schema-validated optimization with 2024 platform research framing", async () => {
    let userPrompt = "";
    aiWireServer.use(
      http.post(AI_ENDPOINTS.perplexity, async ({ request }) => {
        const body = (await request.json()) as { messages: Array<{ content: string }> };
        userPrompt = body.messages[1]?.content ?? "";
        return openAiChatResponse(optimizationPayload);
      })
    );

    const result = await provider.optimizeContent("Original tweet", "twitter");

    expect(result.optimizedText).toBe("Optimized tweet! 🚀");
    expect(userPrompt.includes("Research the latest twitter algorithm")).toBeTruthy();
    expect(userPrompt.includes("2024")).toBeTruthy();
  });

  it("carries the brand voice into the user prompt on the wire", async () => {
    let userPrompt = "";
    aiWireServer.use(
      http.post(AI_ENDPOINTS.perplexity, async ({ request }) => {
        const body = (await request.json()) as { messages: Array<{ content: string }> };
        userPrompt = body.messages[1]?.content ?? "";
        return openAiChatResponse(optimizationPayload);
      })
    );

    await provider.optimizeContent("Test", "linkedin", "professional");

    expect(userPrompt.includes("maintaining a professional brand voice")).toBeTruthy();
  });

  it("throws a structured-generation error when the API rejects the request", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.perplexity, () =>
        HttpResponse.json({ error: "bad request" }, { status: 400 })
      )
    );

    await expect(provider.optimizeContent("Test", "twitter")).rejects.toThrow(
      /Perplexity API error: 400/
    );
  });
});

describe("PerplexityProvider - Performance Prediction", () => {
  let provider: PerplexityProvider;

  beforeEach(() => {
    provider = new PerplexityProvider(mockConfig);
  });

  it("returns the schema-validated prediction with current-trends framing", async () => {
    let userPrompt = "";
    aiWireServer.use(
      http.post(AI_ENDPOINTS.perplexity, async ({ request }) => {
        const body = (await request.json()) as { messages: Array<{ content: string }> };
        userPrompt = body.messages[1]?.content ?? "";
        return openAiChatResponse(predictionPayload);
      })
    );

    const result = await provider.predictPerformance("Great content!", "twitter");

    expect(result.platform).toBe("twitter");
    expect(result.metrics.expectedEngagement.value).toBe(150);
    expect(userPrompt.includes("Research current twitter performance trends")).toBeTruthy();
  });

  it("limits historical context to 3 entries on the wire", async () => {
    const historicalData = [{ data: 1 }, { data: 2 }, { data: 3 }, { data: 4 }, { data: 5 }];
    let userPrompt = "";
    aiWireServer.use(
      http.post(AI_ENDPOINTS.perplexity, async ({ request }) => {
        const body = (await request.json()) as { messages: Array<{ content: string }> };
        userPrompt = body.messages[1]?.content ?? "";
        return openAiChatResponse(predictionPayload);
      })
    );

    await provider.predictPerformance("Test", "twitter", historicalData);

    const matched = userPrompt.match(/\[[\s\S]*\]/);
    expect(matched).not.toBeNull();
    expect(JSON.parse(matched?.[0] ?? "[]").length).toBe(3);
  });

  it("throws a structured-generation error when the API rejects the request", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.perplexity, () =>
        HttpResponse.json({ error: "bad request" }, { status: 400 })
      )
    );

    await expect(provider.predictPerformance("Test", "twitter")).rejects.toThrow(
      /Perplexity API error: 400/
    );
  });
});

describe("PerplexityProvider - Content Variations", () => {
  let provider: PerplexityProvider;

  beforeEach(() => {
    provider = new PerplexityProvider(mockConfig);
  });

  it("unwraps the schema-validated variations object into a string array", async () => {
    let userPrompt = "";
    aiWireServer.use(
      http.post(AI_ENDPOINTS.perplexity, async ({ request }) => {
        const body = (await request.json()) as { messages: Array<{ content: string }> };
        userPrompt = body.messages[1]?.content ?? "";
        return openAiChatResponse({ variations: ["Professional", "Casual", "Humorous"] });
      })
    );

    const result = await provider.generateVariations("Original", "tone", 3);

    expect(Array.isArray(result)).toBeTruthy();
    expect(result.length).toBe(3);
    expect(userPrompt.includes("varying the tone")).toBeTruthy();
  });

  it("requests the exact count in the prompt and returns that many variations", async () => {
    let userPrompt = "";
    aiWireServer.use(
      http.post(AI_ENDPOINTS.perplexity, async ({ request }) => {
        const body = (await request.json()) as { messages: Array<{ content: string }> };
        userPrompt = body.messages[1]?.content ?? "";
        return openAiChatResponse({ variations: ["V1", "V2", "V3", "V4", "V5"] });
      })
    );

    const result = await provider.generateVariations("Original", "tone", 5);

    expect(result.length).toBe(5);
    expect(userPrompt.includes("generate 5")).toBeTruthy();
    expect(userPrompt.includes("exactly 5 strings")).toBeTruthy();
  });

  it("throws a structured-generation error when the API rejects the request", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.perplexity, () =>
        HttpResponse.json({ error: "bad request" }, { status: 400 })
      )
    );

    await expect(provider.generateVariations("Test", "tone", 3)).rejects.toThrow(
      /Perplexity API error: 400/
    );
  });
});

describe("PerplexityProvider - Plain Text Error Handling", () => {
  let provider: PerplexityProvider;

  beforeEach(() => {
    provider = new PerplexityProvider(mockConfig);
  });

  it("surfaces the HTTP status when the API returns a rate-limit error", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.perplexity, () => new HttpResponse(null, { status: 429 }))
    );

    await expect(provider.generateText([{ role: "user", content: "Test" }])).rejects.toThrow(
      /Perplexity API error: 429/
    );
  });

  it("surfaces the HTTP status when the API returns a server error", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.perplexity, () => new HttpResponse(null, { status: 500 }))
    );

    await expect(provider.generateText([{ role: "user", content: "Test" }])).rejects.toThrow(
      /Perplexity API error: 500/
    );
  });

  it("returns an empty string when the API yields no choices", async () => {
    aiWireServer.use(http.post(AI_ENDPOINTS.perplexity, () => HttpResponse.json({ choices: [] })));

    const result = await provider.generateText([{ role: "user", content: "Test" }]);
    expect(result).toBe("");
  });

  it("wraps a non-JSON body into a generation error", async () => {
    aiWireServer.use(
      http.post(
        AI_ENDPOINTS.perplexity,
        () => new HttpResponse("not json", { headers: { "content-type": "text/plain" } })
      )
    );

    await expect(provider.generateText([{ role: "user", content: "Test" }])).rejects.toThrow(
      /Perplexity generation failed/
    );
  });
});
