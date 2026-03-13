import { describe, it, beforeEach, vi, expect } from "vitest";
import { OpenAIProvider } from "../../../src/ai/providers/openai.js";
import type { AIProviderConfig } from "../../../src/ai/types.js";
import { mockConfig } from "./openai.test-helpers.js";

describe("OpenAIProvider - Initialization and Configuration", () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("should initialize with correct provider name", () => {
    expect(provider.name).toBe("openai");
  });

  it("should initialize with API key from config", () => {
    expect(provider).toBeTruthy();
    expect(typeof provider.isAvailable).toBe("function");
  });

  it("should initialize with custom base URL", () => {
    const customConfig = { ...mockConfig, baseUrl: "https://api.custom.openai.com" };
    const customProvider = new OpenAIProvider(customConfig);
    expect(customProvider).toBeTruthy();
  });

  it("should initialize with custom timeout", () => {
    const customConfig = { ...mockConfig, timeout: 60000 };
    const customProvider = new OpenAIProvider(customConfig);
    expect(customProvider).toBeTruthy();
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
    expect(minimalProvider).toBeTruthy();
  });
});

describe("OpenAIProvider - Availability Checks", () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("should return true when OpenAI API is available", async (t) => {
    const listFn = vi.fn(async () => ({ data: [] }));
    const mockClient = { models: { list: listFn } };
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.isAvailable();
    expect(result).toBe(true);
    expect(listFn.mock.calls.length).toBe(1);
  });

  it("should return false when OpenAI API fails", async (t) => {
    const listFn = vi.fn(async () => {
      throw new Error("API Error");
    });
    const mockClient = { models: { list: listFn } };
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.isAvailable();
    expect(result).toBe(false);
  });

  it("should handle network timeouts gracefully", async (t) => {
    const listFn = vi.fn(async () => {
      throw new Error("ETIMEDOUT");
    });
    const mockClient = { models: { list: listFn } };
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.isAvailable();
    expect(result).toBe(false);
  });

  it("should handle authentication errors", async (t) => {
    const listFn = vi.fn(async () => {
      const error: any = new Error("Invalid API key");
      error.status = 401;
      throw error;
    });
    const mockClient = { models: { list: listFn } };
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.isAvailable();
    expect(result).toBe(false);
  });
});
