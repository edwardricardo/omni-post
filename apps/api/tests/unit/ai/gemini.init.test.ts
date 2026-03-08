import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { GeminiProvider } from "../../../src/ai/providers/gemini.js";
import type { AIProviderConfig } from "../../../src/ai/types.js";
import { mockConfig, makeMockClient } from "./gemini.test-helpers.js";

describe("GeminiProvider - Initialization and Configuration", { concurrency: 1 }, () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider(mockConfig);
  });

  it("should initialize with correct provider name", () => {
    assert.strictEqual(provider.name, "gemini");
  });

  it("should initialize with API key from config", () => {
    assert.ok(provider);
    // Verify provider was created successfully
    assert.strictEqual(typeof provider.isAvailable, "function");
  });

  it("should initialize with custom model from config", () => {
    const customConfig = { ...mockConfig, model: "gemini-1.5-pro" };
    const customProvider = new GeminiProvider(customConfig);
    assert.ok(customProvider);
  });

  it("should handle config without optional parameters", () => {
    const minimalConfig: AIProviderConfig = {
      apiKey: "test-key",
      model: "gemini-1.5-flash",
      timeout: 30000,
      retries: 3,
      rateLimit: {
        requestsPerMinute: 60,
        tokensPerMinute: 100000,
        requestsPerDay: 1000,
        tokensPerDay: 1000000,
      },
    };
    const minimalProvider = new GeminiProvider(minimalConfig);
    assert.ok(minimalProvider);
  });
});

describe("GeminiProvider - Availability Checks", { concurrency: 1 }, () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider(mockConfig);
  });

  it("should return true when Gemini API is available", async (t) => {
    const generateContentFn = t.mock.fn(async () => ({ text: "Hi there!" }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore - accessing private property for testing
    provider.client = mockClient;

    const result = await provider.isAvailable();
    assert.strictEqual(result, true);
    assert.strictEqual(generateContentFn.mock.calls.length, 1);
  });

  it("should return false when Gemini API fails", async (t) => {
    const generateContentFn = t.mock.fn(async () => {
      throw new Error("API Error");
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore - accessing private property for testing
    provider.client = mockClient;

    const result = await provider.isAvailable();
    assert.strictEqual(result, false);
  });

  it("should handle network timeouts gracefully", async (t) => {
    const generateContentFn = t.mock.fn(async () => {
      throw new Error("ETIMEDOUT");
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.isAvailable();
    assert.strictEqual(result, false);
  });
});
