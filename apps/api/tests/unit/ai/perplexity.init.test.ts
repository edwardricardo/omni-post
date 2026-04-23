/**
 * @file perplexity.init.test.ts
 * @description Tests for PerplexityProvider - Initialization and Configuration
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi, expect } from "vitest";
import { PerplexityProvider } from "../../../src/ai/providers/perplexity.js";
import type { AIMessage, GenerationOptions, AIProviderConfig } from "../../../src/ai/types.js";
import { mockConfig } from "./perplexity.test-helpers.js";

describe("PerplexityProvider - Initialization and Configuration", () => {
  let provider: PerplexityProvider;

  beforeEach(() => {
    provider = new PerplexityProvider(mockConfig);
  });

  it("should initialize with correct provider name", () => {
    expect(provider.name).toBe("perplexity");
  });

  it("should initialize with API key from config", () => {
    expect(provider).toBeTruthy();
    expect(typeof provider.isAvailable).toBe("function");
  });

  it("should use custom base URL from config", () => {
    const customConfig = { ...mockConfig, baseUrl: "https://custom.perplexity.ai" };
    const customProvider = new PerplexityProvider(customConfig);
    expect(customProvider).toBeTruthy();
  });

  it("should use default base URL when not provided", () => {
    const defaultProvider = new PerplexityProvider(mockConfig);
    expect(defaultProvider).toBeTruthy();
  });

  it("should handle minimal configuration", () => {
    const minimalConfig: AIProviderConfig = {
      apiKey: "test-key",
      model: "llama-3.1-sonar-small-128k-online",
      timeout: 30000,
      retries: 3,
      rateLimit: {
        requestsPerMinute: 60,
        tokensPerMinute: 100000,
        requestsPerDay: 1000,
        tokensPerDay: 1000000,
      },
    };
    const minimalProvider = new PerplexityProvider(minimalConfig);
    expect(minimalProvider).toBeTruthy();
  });
});

describe("PerplexityProvider - Availability Checks", () => {
  let provider: PerplexityProvider;

  beforeEach(() => {
    provider = new PerplexityProvider(mockConfig);
  });

  it("should return true when Perplexity API is available", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "Hi" } }] }),
    }));

    const result = await provider.isAvailable();
    expect(result).toBe(true);
  });

  it("should return false when Perplexity API fails", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 500,
    }));

    const result = await provider.isAvailable();
    expect(result).toBe(false);
  });

  it("should handle network errors gracefully", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("Network error");
    });

    const result = await provider.isAvailable();
    expect(result).toBe(false);
  });

  it("should send correct request format for availability check", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(body.model).toBe("llama-3.1-sonar-small-128k-online");
      expect(body.messages[0].content).toBe("Hi");
      expect(body.max_tokens).toBe(10);
      return { ok: true, json: async () => ({}) };
    });

    await provider.isAvailable();
  });
});

describe("PerplexityProvider - Text Generation", () => {
  let provider: PerplexityProvider;

  beforeEach(() => {
    provider = new PerplexityProvider(mockConfig);
  });

  it("should generate text with default options", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "Hello! How can I help you?" } }],
      }),
    }));

    const messages: AIMessage[] = [{ role: "user", content: "Generate a greeting" }];
    const result = await provider.generateText(messages);

    expect(result).toBe("Hello! How can I help you?");
  });

  it("should use custom model from options", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(body.model).toBe("llama-3.1-sonar-large-128k-online");
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Response" } }] }) };
    });

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { model: "llama-3.1-sonar-large-128k-online" };

    await provider.generateText(messages, options);
  });

  it("should use custom maxTokens from options", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(body.max_tokens).toBe(500);
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Response" } }] }) };
    });

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { maxTokens: 500 };

    await provider.generateText(messages, options);
  });

  it("should use custom temperature from options", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(body.temperature).toBe(0.9);
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Response" } }] }) };
    });

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { temperature: 0.9 };

    await provider.generateText(messages, options);
  });

  it("should use custom topP from options", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(body.top_p).toBe(0.95);
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Response" } }] }) };
    });

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { topP: 0.95 };

    await provider.generateText(messages, options);
  });

  it("should use frequency penalty from options", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(body.frequency_penalty).toBe(0.5);
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Response" } }] }) };
    });

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { frequencyPenalty: 0.5 };

    await provider.generateText(messages, options);
  });

  it("should use presence penalty from options", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(body.presence_penalty).toBe(0.3);
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Response" } }] }) };
    });

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { presencePenalty: 0.3 };

    await provider.generateText(messages, options);
  });

  it("should properly map message roles", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(body.messages.length).toBe(3);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[1].role).toBe("user");
      expect(body.messages[2].role).toBe("assistant");
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Response" } }] }) };
    });

    const messages: AIMessage[] = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];

    await provider.generateText(messages);
  });

  it("should include authorization header", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      expect(options.headers.Authorization).toBe("Bearer test-perplexity-api-key");
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Response" } }] }) };
    });

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    await provider.generateText(messages);
  });

  it("should disable streaming by default", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(body.stream).toBe(false);
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Response" } }] }) };
    });

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    await provider.generateText(messages);
  });

  it("should return empty string when response has no content", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: {} }] }),
    }));

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const result = await provider.generateText(messages);

    expect(result).toBe("");
  });

  it("should throw error on API failure with status code", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    }));

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];

    await expect(provider.generateText(messages)).rejects.toThrow(/Perplexity API error: 500/);
  });

  it("should throw error on network failure", async (_t) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("Network error");
    });

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];

    await expect(provider.generateText(messages)).rejects.toThrow(/Perplexity generation failed/);
  });
});
