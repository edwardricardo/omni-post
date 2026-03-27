import { describe, it, beforeEach, vi, expect } from "vitest";
import { GeminiProvider } from "../../../src/ai/providers/gemini.js";
import type { AIProviderConfig } from "../../../src/ai/types.js";
import { mockConfig, makeMockClient } from "./gemini.test-helpers.js";

describe("GeminiProvider - Initialization and Configuration", () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider(mockConfig);
  });

  it("should initialize with correct provider name", () => {
    expect(provider.name).toBe("gemini");
  });

  it("should initialize with API key from config", () => {
    expect(provider).toBeTruthy();
    // Verify provider was created successfully
    expect(typeof provider.isAvailable).toBe("function");
  });

  it("should initialize with custom model from config", () => {
    const customConfig = { ...mockConfig, model: "gemini-1.5-pro" };
    const customProvider = new GeminiProvider(customConfig);
    expect(customProvider).toBeTruthy();
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
    expect(minimalProvider).toBeTruthy();
  });
});

describe("GeminiProvider - Availability Checks", () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider(mockConfig);
  });

  it("should return true when Gemini API is available", async (_t) => {
    const generateContentFn = vi.fn(async () => ({ text: "Hi there!" }));
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore - accessing private property for testing
    provider.client = mockClient;

    const result = await provider.isAvailable();
    expect(result).toBe(true);
    expect(generateContentFn.mock.calls.length).toBe(1);
  });

  it("should return false when Gemini API fails", async (_t) => {
    const generateContentFn = vi.fn(async () => {
      throw new Error("API Error");
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore - accessing private property for testing
    provider.client = mockClient;

    const result = await provider.isAvailable();
    expect(result).toBe(false);
  });

  it("should handle network timeouts gracefully", async (_t) => {
    const generateContentFn = vi.fn(async () => {
      throw new Error("ETIMEDOUT");
    });
    const mockClient = makeMockClient(generateContentFn);
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.isAvailable();
    expect(result).toBe(false);
  });
});
