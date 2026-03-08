import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { OpenAIProvider } from "../../../src/ai/providers/openai.js";
import type { AIProviderConfig } from "../../../src/ai/types.js";
import { mockConfig } from "./openai.test-helpers.js";

describe("OpenAIProvider - Initialization and Configuration", { concurrency: 1 }, () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("should initialize with correct provider name", () => {
    assert.strictEqual(provider.name, "openai");
  });

  it("should initialize with API key from config", () => {
    assert.ok(provider);
    assert.strictEqual(typeof provider.isAvailable, "function");
  });

  it("should initialize with custom base URL", () => {
    const customConfig = { ...mockConfig, baseUrl: "https://api.custom.openai.com" };
    const customProvider = new OpenAIProvider(customConfig);
    assert.ok(customProvider);
  });

  it("should initialize with custom timeout", () => {
    const customConfig = { ...mockConfig, timeout: 60000 };
    const customProvider = new OpenAIProvider(customConfig);
    assert.ok(customProvider);
  });

  it("should handle minimal configuration", () => {
    const minimalConfig: AIProviderConfig = {
      apiKey: "test-key",
      model: "gpt-4",
      timeout: 30000,
      retries: 3,
      rateLimit: {
        requestsPerMinute: 60,
        tokensPerMinute: 100000,
        requestsPerDay: 1000,
        tokensPerDay: 1000000,
      },
    };
    const minimalProvider = new OpenAIProvider(minimalConfig);
    assert.ok(minimalProvider);
  });
});

describe("OpenAIProvider - Availability Checks", { concurrency: 1 }, () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("should return true when OpenAI API is available", async (t) => {
    const listFn = t.mock.fn(async () => ({ data: [] }));
    const mockClient = { models: { list: listFn } };
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.isAvailable();
    assert.strictEqual(result, true);
    assert.strictEqual(listFn.mock.calls.length, 1);
  });

  it("should return false when OpenAI API fails", async (t) => {
    const listFn = t.mock.fn(async () => {
      throw new Error("API Error");
    });
    const mockClient = { models: { list: listFn } };
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.isAvailable();
    assert.strictEqual(result, false);
  });

  it("should handle network timeouts gracefully", async (t) => {
    const listFn = t.mock.fn(async () => {
      throw new Error("ETIMEDOUT");
    });
    const mockClient = { models: { list: listFn } };
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.isAvailable();
    assert.strictEqual(result, false);
  });

  it("should handle authentication errors", async (t) => {
    const listFn = t.mock.fn(async () => {
      const error: any = new Error("Invalid API key");
      error.status = 401;
      throw error;
    });
    const mockClient = { models: { list: listFn } };
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.isAvailable();
    assert.strictEqual(result, false);
  });
});
