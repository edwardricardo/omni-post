/**
 * @file openai.generation.test.ts
 * @description Tests for OpenAIProvider - Text Generation
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi, expect } from "vitest";
import { OpenAIProvider } from "../../../src/ai/providers/openai.js";
import type { AIMessage, GenerationOptions } from "../../../src/ai/types.js";
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

function makeOpenAIMockClient(createFn: (...args: any[]) => any) {
  return { chat: { completions: { create: createFn } } };
}

describe("OpenAIProvider - Text Generation", () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("should generate text with default options", async (_t) => {
    const createFn = vi.fn(async () => ({
      choices: [{ message: { content: "Hello! How can I help you today?" } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const messages: AIMessage[] = [{ role: "user", content: "Generate a greeting" }];
    const result = await provider.generateText(messages);
    expect(result).toBe("Hello! How can I help you today?");
  });

  it("should use custom model from options", async (_t) => {
    const createFn = vi.fn(async (params: any) => {
      expect(params.model).toBe("gpt-4-turbo");
      return { choices: [{ message: { content: "Response" } }] };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { model: "gpt-4-turbo" };
    await provider.generateText(messages, options);
    expect(createFn.mock.calls.length).toBe(1);
  });

  it("should use custom maxTokens from options", async (_t) => {
    const createFn = vi.fn(async (params: any) => {
      expect(params.max_tokens).toBe(500);
      return { choices: [{ message: { content: "Response" } }] };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { maxTokens: 500 };
    await provider.generateText(messages, options);
    expect(createFn.mock.calls.length).toBe(1);
  });

  it("should use custom temperature from options", async (_t) => {
    const createFn = vi.fn(async (params: any) => {
      expect(params.temperature).toBe(0.9);
      return { choices: [{ message: { content: "Response" } }] };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { temperature: 0.9 };
    await provider.generateText(messages, options);
    expect(createFn.mock.calls.length).toBe(1);
  });

  it("should use custom topP from options", async (_t) => {
    const createFn = vi.fn(async (params: any) => {
      expect(params.top_p).toBe(0.95);
      return { choices: [{ message: { content: "Response" } }] };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { topP: 0.95 };
    await provider.generateText(messages, options);
    expect(createFn.mock.calls.length).toBe(1);
  });

  it("should use custom frequency penalty from options", async (_t) => {
    const createFn = vi.fn(async (params: any) => {
      expect(params.frequency_penalty).toBe(0.5);
      return { choices: [{ message: { content: "Response" } }] };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { frequencyPenalty: 0.5 };
    await provider.generateText(messages, options);
    expect(createFn.mock.calls.length).toBe(1);
  });

  it("should use custom presence penalty from options", async (_t) => {
    const createFn = vi.fn(async (params: any) => {
      expect(params.presence_penalty).toBe(0.3);
      return { choices: [{ message: { content: "Response" } }] };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { presencePenalty: 0.3 };
    await provider.generateText(messages, options);
    expect(createFn.mock.calls.length).toBe(1);
  });

  it("should properly map message roles", async (_t) => {
    const createFn = vi.fn(async (params: any) => {
      expect(params.messages.length).toBe(3);
      expect(params.messages[0].role).toBe("system");
      expect(params.messages[1].role).toBe("user");
      expect(params.messages[2].role).toBe("assistant");
      return { choices: [{ message: { content: "Response" } }] };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const messages: AIMessage[] = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];
    await provider.generateText(messages);
    expect(createFn.mock.calls.length).toBe(1);
  });

  it("should return empty string when response has no content", async (_t) => {
    const createFn = vi.fn(async () => ({ choices: [{ message: {} }] }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const result = await provider.generateText(messages);
    expect(result).toBe("");
  });

  it("should throw error on API failure", async (_t) => {
    const createFn = vi.fn(async () => {
      throw new Error("API Error");
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    await expect(provider.generateText(messages)).rejects.toThrow(/OpenAI generation failed/);
  });

  it("should disable streaming by default", async (_t) => {
    const createFn = vi.fn(async (params: any) => {
      expect(params.stream).toBe(false);
      return { choices: [{ message: { content: "Response" } }] };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    await provider.generateText(messages);
    expect(createFn.mock.calls.length).toBe(1);
  });
});

describe("OpenAIProvider - Content Analysis", () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("returns the schema-validated sentiment slice", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.openai, () =>
        openAiChatResponse({ sentiment: { score: 0.8, label: "positive", confidence: 0.95 } })
      )
    );

    const result = await provider.analyzeContent("I love this product!", "sentiment");

    expect(result.sentiment?.score).toBe(0.8);
    expect(result.sentiment?.label).toBe("positive");
    expect(result.sentiment?.confidence).toBe(0.95);
  });

  it("returns the schema-validated tone slice", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.openai, () =>
        openAiChatResponse({
          tone: {
            detected: "professional",
            confidence: 0.9,
            suggestions: ["Add personal touches", "Use contractions"],
          },
        })
      )
    );

    const result = await provider.analyzeContent("Dear Sir/Madam, I am writing...", "tone");

    expect(result.tone?.detected).toBe("professional");
    expect(result.tone?.confidence).toBe(0.9);
    expect(result.tone?.suggestions.length).toBe(2);
  });

  it("returns the schema-validated readability slice", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.openai, () =>
        openAiChatResponse({
          readability: {
            score: 75,
            level: "High School",
            suggestions: ["Simplify complex sentences"],
          },
        })
      )
    );

    const result = await provider.analyzeContent("Complex technical content", "readability");

    expect(result.readability?.score).toBe(75);
    expect(result.readability?.level).toBe("High School");
  });

  it("returns the schema-validated engagement slice", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.openai, () =>
        openAiChatResponse({
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

  it("sends a strict json_schema response_format named for the analysis type", async () => {
    let sentBody: Record<string, unknown> = {};
    aiWireServer.use(
      http.post(AI_ENDPOINTS.openai, async ({ request }) => {
        sentBody = (await request.json()) as Record<string, unknown>;
        return openAiChatResponse({ sentiment: { score: 0.5, label: "neutral", confidence: 0.8 } });
      })
    );

    await provider.analyzeContent("Neutral content", "sentiment");

    const responseFormat = sentBody.response_format as {
      type: string;
      json_schema: { name: string; strict: boolean };
    };
    expect(responseFormat.type).toBe("json_schema");
    expect(responseFormat.json_schema.name).toBe("content_sentiment");
    expect(responseFormat.json_schema.strict).toBe(true);
  });

  it("throws a structured-generation error when the API rejects the request", async () => {
    aiWireServer.use(
      http.post(AI_ENDPOINTS.openai, () =>
        HttpResponse.json({ error: { message: "Bad request" } }, { status: 400 })
      )
    );

    await expect(provider.analyzeContent("Test content", "sentiment")).rejects.toThrow(
      /OpenAI structured generation failed/
    );
  });
});
