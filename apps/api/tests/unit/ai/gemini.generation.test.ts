import { describe, it, beforeEach, vi, expect } from "vitest";
import { GeminiProvider } from "../../../src/ai/providers/gemini.js";
import type { AIMessage, GenerationOptions } from "../../../src/ai/types.js";
import { mockConfig, makeMockClient } from "./gemini.test-helpers.js";

describe("GeminiProvider - Message Conversion", () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider(mockConfig);
  });

  it("should convert system messages correctly", async (_t) => {
    const messages: AIMessage[] = [{ role: "system", content: "You are a helpful assistant" }];

    const generateContentFn = vi.fn(async (params: any) => {
      expect(params.contents.includes("System: You are a helpful assistant")).toBeTruthy();
      return { text: "Response" };
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.generateText(messages);
    expect(generateContentFn.mock.calls.length).toBe(1);
  });

  it("should convert user messages correctly", async (_t) => {
    const messages: AIMessage[] = [{ role: "user", content: "Hello world" }];

    const generateContentFn = vi.fn(async (params: any) => {
      expect(params.contents.includes("User: Hello world")).toBeTruthy();
      return { text: "Response" };
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.generateText(messages);
    expect(generateContentFn.mock.calls.length).toBe(1);
  });

  it("should convert assistant messages correctly", async (_t) => {
    const messages: AIMessage[] = [{ role: "assistant", content: "I can help with that" }];

    const generateContentFn = vi.fn(async (params: any) => {
      expect(params.contents.includes("Assistant: I can help with that")).toBeTruthy();
      return { text: "Response" };
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.generateText(messages);
    expect(generateContentFn.mock.calls.length).toBe(1);
  });

  it("should handle multi-message conversations", async (_t) => {
    const messages: AIMessage[] = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "What is AI?" },
      { role: "assistant", content: "AI is artificial intelligence" },
      { role: "user", content: "Tell me more" },
    ];

    const generateContentFn = vi.fn(async (params: any) => {
      expect(params.contents.includes("System: You are helpful")).toBeTruthy();
      expect(params.contents.includes("User: What is AI?")).toBeTruthy();
      expect(params.contents.includes("Assistant: AI is artificial intelligence")).toBeTruthy();
      expect(params.contents.includes("User: Tell me more")).toBeTruthy();
      return { text: "Response" };
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.generateText(messages);
    expect(generateContentFn.mock.calls.length).toBe(1);
  });
});

describe("GeminiProvider - Text Generation", () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider(mockConfig);
  });

  it("should generate text with default options", async (_t) => {
    const messages: AIMessage[] = [{ role: "user", content: "Generate a greeting" }];

    const generateContentFn = vi.fn(async () => ({
      text: "Hello! How can I assist you today?",
    }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.generateText(messages);
    expect(result).toBe("Hello! How can I assist you today?");
  });

  it("should use custom model from options", async (_t) => {
    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { model: "gemini-1.5-pro" };

    const generateContentFn = vi.fn(async (params: any) => {
      expect(params.model).toBe("gemini-1.5-pro");
      return { text: "Response" };
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.generateText(messages, options);
    expect(generateContentFn.mock.calls.length).toBe(1);
  });

  it("should use custom maxTokens from options", async (_t) => {
    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { maxTokens: 500 };

    const generateContentFn = vi.fn(async (params: any) => {
      expect(params.config.maxOutputTokens).toBe(500);
      return { text: "Response" };
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.generateText(messages, options);
    expect(generateContentFn.mock.calls.length).toBe(1);
  });

  it("should use custom temperature from options", async (_t) => {
    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { temperature: 0.9 };

    const generateContentFn = vi.fn(async (params: any) => {
      expect(params.config.temperature).toBe(0.9);
      return { text: "Response" };
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.generateText(messages, options);
    expect(generateContentFn.mock.calls.length).toBe(1);
  });

  it("should use custom topP from options", async (_t) => {
    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { topP: 0.95 };

    const generateContentFn = vi.fn(async (params: any) => {
      expect(params.config.topP).toBe(0.95);
      return { text: "Response" };
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await provider.generateText(messages, options);
    expect(generateContentFn.mock.calls.length).toBe(1);
  });

  it("should return empty string when response has no text", async (_t) => {
    const messages: AIMessage[] = [{ role: "user", content: "Test" }];

    const generateContentFn = vi.fn(async () => ({ text: null }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.generateText(messages);
    expect(result).toBe("");
  });

  it("should throw error on API failure", async (_t) => {
    const messages: AIMessage[] = [{ role: "user", content: "Test" }];

    const generateContentFn = vi.fn(async () => {
      throw new Error("API Error");
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    await expect(provider.generateText(messages)).rejects.toThrow(/Gemini generation failed/);
  });
});
