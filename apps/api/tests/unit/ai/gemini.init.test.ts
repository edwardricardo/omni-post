/**
 * @file gemini.init.test.ts
 * @description Tests for GeminiProvider - its provider name and availability checks
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi, expect } from "vitest";
import { GeminiProvider } from "../../../src/ai/providers/gemini.js";
import { mockConfig, makeMockClient } from "./gemini.test-helpers.js";

describe("GeminiProvider - Initialization", () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider(mockConfig);
  });

  it("should initialize with correct provider name", () => {
    expect(provider.name).toBe("gemini");
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
