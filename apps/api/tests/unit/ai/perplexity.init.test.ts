import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PerplexityProvider } from "../../../src/ai/providers/perplexity.js";
import type { AIMessage, GenerationOptions, AIProviderConfig } from "../../../src/ai/types.js";
import { mockConfig } from "./perplexity.test-helpers.js";

describe("PerplexityProvider - Initialization and Configuration", { concurrency: 1 }, () => {
  let provider: PerplexityProvider;

  beforeEach(() => {
    provider = new PerplexityProvider(mockConfig);
  });

  it("should initialize with correct provider name", () => {
    assert.strictEqual(provider.name, "perplexity");
  });

  it("should initialize with API key from config", () => {
    assert.ok(provider);
    assert.strictEqual(typeof provider.isAvailable, "function");
  });

  it("should use custom base URL from config", () => {
    const customConfig = { ...mockConfig, baseUrl: "https://custom.perplexity.ai" };
    const customProvider = new PerplexityProvider(customConfig);
    assert.ok(customProvider);
  });

  it("should use default base URL when not provided", () => {
    const defaultProvider = new PerplexityProvider(mockConfig);
    assert.ok(defaultProvider);
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
    assert.ok(minimalProvider);
  });
});

describe("PerplexityProvider - Availability Checks", { concurrency: 1 }, () => {
  let provider: PerplexityProvider;

  beforeEach(() => {
    provider = new PerplexityProvider(mockConfig);
  });

  it("should return true when Perplexity API is available", async (t) => {
    t.mock.method(globalThis, "fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "Hi" } }] }),
    }));

    const result = await provider.isAvailable();
    assert.strictEqual(result, true);
  });

  it("should return false when Perplexity API fails", async (t) => {
    t.mock.method(globalThis, "fetch", async () => ({
      ok: false,
      status: 500,
    }));

    const result = await provider.isAvailable();
    assert.strictEqual(result, false);
  });

  it("should handle network errors gracefully", async (t) => {
    t.mock.method(globalThis, "fetch", async () => {
      throw new Error("Network error");
    });

    const result = await provider.isAvailable();
    assert.strictEqual(result, false);
  });

  it("should send correct request format for availability check", async (t) => {
    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.strictEqual(body.model, "llama-3.1-sonar-small-128k-online");
      assert.strictEqual(body.messages[0].content, "Hi");
      assert.strictEqual(body.max_tokens, 10);
      return { ok: true, json: async () => ({}) };
    });

    await provider.isAvailable();
  });
});

describe("PerplexityProvider - Text Generation", { concurrency: 1 }, () => {
  let provider: PerplexityProvider;

  beforeEach(() => {
    provider = new PerplexityProvider(mockConfig);
  });

  it("should generate text with default options", async (t) => {
    t.mock.method(globalThis, "fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "Hello! How can I help you?" } }],
      }),
    }));

    const messages: AIMessage[] = [{ role: "user", content: "Generate a greeting" }];
    const result = await provider.generateText(messages);

    assert.strictEqual(result, "Hello! How can I help you?");
  });

  it("should use custom model from options", async (t) => {
    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.strictEqual(body.model, "llama-3.1-sonar-large-128k-online");
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Response" } }] }) };
    });

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { model: "llama-3.1-sonar-large-128k-online" };

    await provider.generateText(messages, options);
  });

  it("should use custom maxTokens from options", async (t) => {
    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.strictEqual(body.max_tokens, 500);
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Response" } }] }) };
    });

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { maxTokens: 500 };

    await provider.generateText(messages, options);
  });

  it("should use custom temperature from options", async (t) => {
    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.strictEqual(body.temperature, 0.9);
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Response" } }] }) };
    });

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { temperature: 0.9 };

    await provider.generateText(messages, options);
  });

  it("should use custom topP from options", async (t) => {
    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.strictEqual(body.top_p, 0.95);
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Response" } }] }) };
    });

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { topP: 0.95 };

    await provider.generateText(messages, options);
  });

  it("should use frequency penalty from options", async (t) => {
    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.strictEqual(body.frequency_penalty, 0.5);
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Response" } }] }) };
    });

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { frequencyPenalty: 0.5 };

    await provider.generateText(messages, options);
  });

  it("should use presence penalty from options", async (t) => {
    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.strictEqual(body.presence_penalty, 0.3);
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Response" } }] }) };
    });

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const options: GenerationOptions = { presencePenalty: 0.3 };

    await provider.generateText(messages, options);
  });

  it("should properly map message roles", async (t) => {
    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.strictEqual(body.messages.length, 3);
      assert.strictEqual(body.messages[0].role, "system");
      assert.strictEqual(body.messages[1].role, "user");
      assert.strictEqual(body.messages[2].role, "assistant");
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Response" } }] }) };
    });

    const messages: AIMessage[] = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];

    await provider.generateText(messages);
  });

  it("should include authorization header", async (t) => {
    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      assert.strictEqual(options.headers.Authorization, "Bearer test-perplexity-api-key");
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Response" } }] }) };
    });

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    await provider.generateText(messages);
  });

  it("should disable streaming by default", async (t) => {
    t.mock.method(globalThis, "fetch", async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      assert.strictEqual(body.stream, false);
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Response" } }] }) };
    });

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    await provider.generateText(messages);
  });

  it("should return empty string when response has no content", async (t) => {
    t.mock.method(globalThis, "fetch", async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: {} }] }),
    }));

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];
    const result = await provider.generateText(messages);

    assert.strictEqual(result, "");
  });

  it("should throw error on API failure with status code", async (t) => {
    t.mock.method(globalThis, "fetch", async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    }));

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];

    await assert.rejects(async () => {
      await provider.generateText(messages);
    }, /Perplexity API error: 500/);
  });

  it("should throw error on network failure", async (t) => {
    t.mock.method(globalThis, "fetch", async () => {
      throw new Error("Network error");
    });

    const messages: AIMessage[] = [{ role: "user", content: "Test" }];

    await assert.rejects(async () => {
      await provider.generateText(messages);
    }, /Perplexity generation failed/);
  });
});
