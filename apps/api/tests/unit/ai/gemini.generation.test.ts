import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { GeminiProvider } from "../../../src/ai/providers/gemini.js";
import type { AIMessage, GenerationOptions } from "../../../src/ai/types.js";
import { mockConfig, makeMockClient } from "./gemini.test-helpers.js";

describe("GeminiProvider - Message Conversion", { concurrency: 1 }, () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider(mockConfig);
  });

  it("should convert system messages correctly", async (t) => {
    const messages: AIMessage[] = [{ role: "system", content: "You are a helpful assistant" }];

    const generateContentFn = t.mock.fn(async (params: any) => {
      assert.ok(params.contents.includes("System: You are a helpful assistant"));
      return { text: "Response" };
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.generateText(messages);
    assert.strictEqual(generateContentFn.mock.calls.length, 1);
  });

  it("should convert user messages correctly", async (t) => {
    const messages: AIMessage[] = [{ role: "user", content: "Hello world" }];

    const generateContentFn = t.mock.fn(async (params: any) => {
      assert.ok(params.contents.includes("User: Hello world"));
      return { text: "Response" };
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.generateText(messages);
    assert.strictEqual(generateContentFn.mock.calls.length, 1);
  });

  it("should convert assistant messages correctly", async (t) => {
    const messages: AIMessage[] = [{ role: "assistant", content: "I can help with that" }];

    const generateContentFn = t.mock.fn(async (params: any) => {
      assert.ok(params.contents.includes("Assistant: I can help with that"));
      return { text: "Response" };
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.generateText(messages);
    assert.strictEqual(generateContentFn.mock.calls.length, 1);
  });

  it("should handle multi-message conversations", async (t) => {
    const messages: AIMessage[] = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "What is AI?" },
      { role: "assistant", content: "AI is artificial intelligence" },
      { role: "user", content: "Tell me more" },
    ];

    const generateContentFn = t.mock.fn(async (params: any) => {
      assert.ok(params.contents.includes("System: You are helpful"));
      assert.ok(params.contents.includes("User: What is AI?"));
      assert.ok(params.contents.includes("Assistant: AI is artificial intelligence"));
      assert.ok(params.contents.includes("User: Tell me more"));
      return { text: "Response" };
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.generateText(messages);
    assert.strictEqual(generateContentFn.mock.calls.length, 1);
  });
});

describe("GeminiProvider - Text Generation", { concurrency: 1 }, () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider(mockConfig);
  });

  it("should generate text with default options", async (t) => {
    const messages: AIMessage[] = [{ role: "user", content: "Generate a greeting" }];

    const generateContentFn = t.mock.fn(async () => ({
      text: "Hello! How can I assist you today?",
    }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.generateText(messages);
    assert.strictEqual(result, "Hello! How can I assist you today?");
  });

  it("should use custom model from options", async (t) => {
    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { model: "gemini-1.5-pro" };

    const generateContentFn = t.mock.fn(async (params: any) => {
      assert.strictEqual(params.model, "gemini-1.5-pro");
      return { text: "Response" };
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.generateText(messages, options);
    assert.strictEqual(generateContentFn.mock.calls.length, 1);
  });

  it("should use custom maxTokens from options", async (t) => {
    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { maxTokens: 500 };

    const generateContentFn = t.mock.fn(async (params: any) => {
      assert.strictEqual(params.config.maxOutputTokens, 500);
      return { text: "Response" };
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.generateText(messages, options);
    assert.strictEqual(generateContentFn.mock.calls.length, 1);
  });

  it("should use custom temperature from options", async (t) => {
    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { temperature: 0.9 };

    const generateContentFn = t.mock.fn(async (params: any) => {
      assert.strictEqual(params.config.temperature, 0.9);
      return { text: "Response" };
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.generateText(messages, options);
    assert.strictEqual(generateContentFn.mock.calls.length, 1);
  });

  it("should use custom topP from options", async (t) => {
    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { topP: 0.95 };

    const generateContentFn = t.mock.fn(async (params: any) => {
      assert.strictEqual(params.config.topP, 0.95);
      return { text: "Response" };
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.generateText(messages, options);
    assert.strictEqual(generateContentFn.mock.calls.length, 1);
  });

  it("should return empty string when response has no text", async (t) => {
    const messages: AIMessage[] = [{ role: "user", content: "Test" }];

    const generateContentFn = t.mock.fn(async () => ({ text: null }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.generateText(messages);
    assert.strictEqual(result, "");
  });

  it("should throw error on API failure", async (t) => {
    const messages: AIMessage[] = [{ role: "user", content: "Test" }];

    const generateContentFn = t.mock.fn(async () => {
      throw new Error("API Error");
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await assert.rejects(async () => {
      await provider.generateText(messages);
    }, /Gemini generation failed/);
  });
});
