/**
 * @file openai.init.test.ts
 * @description Tests for OpenAIProvider - its provider name and availability checks
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi, expect } from "vitest";
import { OpenAIProvider } from "../../../src/ai/providers/openai.js";
import { mockConfig } from "./openai.test-helpers.js";

describe("OpenAIProvider - Initialization", () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("should initialize with correct provider name", () => {
    expect(provider.name).toBe("openai");
  });
});

describe("OpenAIProvider - Availability Checks", () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it("should return true when OpenAI API is available", async (_t) => {
    const listFn = vi.fn(async () => ({ data: [] }));
    const mockClient = { models: { list: listFn } };
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.isAvailable();
    expect(result).toBe(true);
    expect(listFn.mock.calls.length).toBe(1);
  });

  it("should return false when OpenAI API fails", async (_t) => {
    const listFn = vi.fn(async () => {
      throw new Error("API Error");
    });
    const mockClient = { models: { list: listFn } };
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.isAvailable();
    expect(result).toBe(false);
  });

  it("should handle network timeouts gracefully", async (_t) => {
    const listFn = vi.fn(async () => {
      throw new Error("ETIMEDOUT");
    });
    const mockClient = { models: { list: listFn } };
    // @ts-ignore
    provider.client = mockClient;

    const result = await provider.isAvailable();
    expect(result).toBe(false);
  });

  it("should handle authentication errors", async (_t) => {
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
