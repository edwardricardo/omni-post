import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { OpenAIProvider } from "../../../src/ai/providers/openai.js";
import type { AIMessage, GenerationOptions } from "../../../src/ai/types.js";
import { mockConfig } from "./openai.test-helpers.js";

function makeOpenAIMockClient(createFn: (...args: any[]) => any) {
  return { chat: { completions: { create: createFn } } };
}

describe("OpenAIProvider - Text Generation", { concurrency: 1 }, () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("should generate text with default options", async (t) => {
    const createFn = t.mock.fn(async () => ({
      choices: [{ message: { content: "Hello! How can I help you today?" } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const messages: AIMessage[] = [{ role: "user", content: "Generate a greeting" }];
    const result = await provider.generateText(messages);
    assert.strictEqual(result, "Hello! How can I help you today?");
  });

  it("should use custom model from options", async (t) => {
    const createFn = t.mock.fn(async (params: any) => {
      assert.strictEqual(params.model, "gpt-4-turbo");
      return { choices: [{ message: { content: "Response" } }] };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { model: "gpt-4-turbo" };
    await provider.generateText(messages, options);
    assert.strictEqual(createFn.mock.calls.length, 1);
  });

  it("should use custom maxTokens from options", async (t) => {
    const createFn = t.mock.fn(async (params: any) => {
      assert.strictEqual(params.max_tokens, 500);
      return { choices: [{ message: { content: "Response" } }] };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { maxTokens: 500 };
    await provider.generateText(messages, options);
    assert.strictEqual(createFn.mock.calls.length, 1);
  });

  it("should use custom temperature from options", async (t) => {
    const createFn = t.mock.fn(async (params: any) => {
      assert.strictEqual(params.temperature, 0.9);
      return { choices: [{ message: { content: "Response" } }] };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { temperature: 0.9 };
    await provider.generateText(messages, options);
    assert.strictEqual(createFn.mock.calls.length, 1);
  });

  it("should use custom topP from options", async (t) => {
    const createFn = t.mock.fn(async (params: any) => {
      assert.strictEqual(params.top_p, 0.95);
      return { choices: [{ message: { content: "Response" } }] };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { topP: 0.95 };
    await provider.generateText(messages, options);
    assert.strictEqual(createFn.mock.calls.length, 1);
  });

  it("should use custom frequency penalty from options", async (t) => {
    const createFn = t.mock.fn(async (params: any) => {
      assert.strictEqual(params.frequency_penalty, 0.5);
      return { choices: [{ message: { content: "Response" } }] };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { frequencyPenalty: 0.5 };
    await provider.generateText(messages, options);
    assert.strictEqual(createFn.mock.calls.length, 1);
  });

  it("should use custom presence penalty from options", async (t) => {
    const createFn = t.mock.fn(async (params: any) => {
      assert.strictEqual(params.presence_penalty, 0.3);
      return { choices: [{ message: { content: "Response" } }] };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { presencePenalty: 0.3 };
    await provider.generateText(messages, options);
    assert.strictEqual(createFn.mock.calls.length, 1);
  });

  it("should properly map message roles", async (t) => {
    const createFn = t.mock.fn(async (params: any) => {
      assert.strictEqual(params.messages.length, 3);
      assert.strictEqual(params.messages[0].role, "system");
      assert.strictEqual(params.messages[1].role, "user");
      assert.strictEqual(params.messages[2].role, "assistant");
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
    assert.strictEqual(createFn.mock.calls.length, 1);
  });

  it("should return empty string when response has no content", async (t) => {
    const createFn = t.mock.fn(async () => ({ choices: [{ message: {} }] }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const result = await provider.generateText(messages);
    assert.strictEqual(result, "");
  });

  it("should throw error on API failure", async (t) => {
    const createFn = t.mock.fn(async () => {
      throw new Error("API Error");
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    await assert.rejects(async () => {
      await provider.generateText(messages);
    }, /OpenAI generation failed/);
  });

  it("should disable streaming by default", async (t) => {
    const createFn = t.mock.fn(async (params: any) => {
      assert.strictEqual(params.stream, false);
      return { choices: [{ message: { content: "Response" } }] };
    });
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    await provider.generateText(messages);
    assert.strictEqual(createFn.mock.calls.length, 1);
  });
});

describe("OpenAIProvider - Content Analysis", { concurrency: 1 }, () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("should analyze sentiment correctly", async (t) => {
    const mockResponse = JSON.stringify({
      score: 0.8,
      label: "positive",
      confidence: 0.95,
    });

    const createFn = t.mock.fn(async () => ({
      choices: [{ message: { content: mockResponse } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
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
      suggestions: ["Add personal touches", "Use contractions"],
    });

    const createFn = t.mock.fn(async () => ({
      choices: [{ message: { content: mockResponse } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.analyzeContent("Dear Sir/Madam, I am writing...", "tone");
    assert.strictEqual(result.detected, "professional");
    assert.strictEqual(result.confidence, 0.9);
    assert.ok(Array.isArray(result.suggestions));
  });

  it("should analyze readability correctly", async (t) => {
    const mockResponse = JSON.stringify({
      score: 75,
      level: "High School",
      suggestions: ["Simplify complex sentences", "Use common vocabulary"],
    });

    const createFn = t.mock.fn(async () => ({
      choices: [{ message: { content: mockResponse } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.analyzeContent("Complex technical content", "readability");
    assert.strictEqual(result.score, 75);
    assert.strictEqual(result.level, "High School");
  });

  it("should analyze engagement correctly", async (t) => {
    const mockResponse = JSON.stringify({
      score: 85,
      factors: [
        { factor: "emotional appeal", impact: 80, suggestion: "Add storytelling" },
        { factor: "call-to-action", impact: 90, suggestion: "Strong CTA" },
      ],
    });

    const createFn = t.mock.fn(async () => ({
      choices: [{ message: { content: mockResponse } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.analyzeContent("Join us today!", "engagement");
    assert.strictEqual(result.score, 85);
    assert.ok(Array.isArray(result.factors));
  });

  it("should include system message for JSON response", async (t) => {
    const createFn = t.mock.fn(async (params: any) => {
      assert.strictEqual(params.messages.length, 2);
      assert.strictEqual(params.messages[0].role, "system");
      assert.ok(params.messages[0].content.includes("JSON"));
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
    assert.strictEqual(createFn.mock.calls.length, 1);
  });

  it("should throw error on malformed JSON response", async (t) => {
    const createFn = t.mock.fn(async () => ({
      choices: [{ message: { content: "Not JSON at all" } }],
    }));
    const mockClient = makeOpenAIMockClient(createFn);
    // @ts-ignore
    provider.client = mockClient;

    await assert.rejects(async () => {
      await provider.analyzeContent("Test content", "sentiment");
    }, /OpenAI analysis failed/);
  });
});
