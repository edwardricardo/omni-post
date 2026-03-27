import { describe, it, beforeEach, vi, expect } from "vitest";
import { OpenAIProvider } from "../../../src/ai/providers/openai.js";
import type { AIMessage, GenerationOptions } from "../../../src/ai/types.js";
import { mockConfig } from "./openai.test-helpers.js";

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

  it("should analyze sentiment correctly", async (_t) => {
    const mockResponse = JSON.stringify({
      score: 0.8,
      label: "positive",
      confidence: 0.95,
    });

    const createFn = vi.fn(async () => ({
      choices: [{ message: { content: mockResponse } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.analyzeContent("I love this product!", "sentiment");
    expect(result.score).toBe(0.8);
    expect(result.label).toBe("positive");
    expect(result.confidence).toBe(0.95);
  });

  it("should analyze tone correctly", async (_t) => {
    const mockResponse = JSON.stringify({
      detected: "professional",
      confidence: 0.9,
      suggestions: ["Add personal touches", "Use contractions"],
    });

    const createFn = vi.fn(async () => ({
      choices: [{ message: { content: mockResponse } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.analyzeContent("Dear Sir/Madam, I am writing...", "tone");
    expect(result.detected).toBe("professional");
    expect(result.confidence).toBe(0.9);
    expect(Array.isArray(result.suggestions)).toBeTruthy();
  });

  it("should analyze readability correctly", async (_t) => {
    const mockResponse = JSON.stringify({
      score: 75,
      level: "High School",
      suggestions: ["Simplify complex sentences", "Use common vocabulary"],
    });

    const createFn = vi.fn(async () => ({
      choices: [{ message: { content: mockResponse } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.analyzeContent("Complex technical content", "readability");
    expect(result.score).toBe(75);
    expect(result.level).toBe("High School");
  });

  it("should analyze engagement correctly", async (_t) => {
    const mockResponse = JSON.stringify({
      score: 85,
      factors: [
        { factor: "emotional appeal", impact: 80, suggestion: "Add storytelling" },
        { factor: "call-to-action", impact: 90, suggestion: "Strong CTA" },
      ],
    });

    const createFn = vi.fn(async () => ({
      choices: [{ message: { content: mockResponse } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.analyzeContent("Join us today!", "engagement");
    expect(result.score).toBe(85);
    expect(Array.isArray(result.factors)).toBeTruthy();
  });

  it("should include system message for JSON response", async (_t) => {
    const createFn = vi.fn(async (params: any) => {
      expect(params.messages.length).toBe(2);
      expect(params.messages[0].role).toBe("system");
      expect(params.messages[0].content.includes("JSON")).toBeTruthy();
      return {
        choices: [
          { message: { content: '{"score": 0.5, "label": "neutral", "confidence": 0.8}' } },
        ],
      };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.analyzeContent("Neutral content", "sentiment");
    expect(createFn.mock.calls.length).toBe(1);
  });

  it("should throw error on malformed JSON response", async (_t) => {
    const createFn = vi.fn(async () => ({
      choices: [{ message: { content: "Not JSON at all" } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await expect(provider.analyzeContent("Test content", "sentiment")).rejects.toThrow(
      /OpenAI analysis failed/
    );
  });
});
