/**
 * @file AIProviderError.test.ts
 * @description Tests for `AIProviderError` class + helpers (`classifyProviderError`,
 *              `toAIProviderError`, `errorFromFetchResponse`).
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import {
  AIProviderError,
  classifyProviderError,
  toAIProviderError,
  errorFromFetchResponse,
} from "../../../../src/ai/providers/AIProviderError.js";

describe("classifyProviderError", () => {
  it("classifies 401 as AUTH (user-fixable, non-retryable)", () => {
    const result = classifyProviderError({ status: 401 });
    expect(result.code).toBe("AUTH_ERROR");
    expect(result.retryable).toBe(false);
    expect(result.category).toBe("user-fixable");
    expect(result.statusCode).toBe(401);
  });

  it("classifies 403 as AUTH (user-fixable)", () => {
    const r = classifyProviderError({ status: 403 });
    expect(r.code).toBe("AUTH_ERROR");
    expect(r.category).toBe("user-fixable");
  });

  it("classifies 429 as TRANSIENT (retryable)", () => {
    const result = classifyProviderError({ status: 429 });
    expect(result.code).toBe("TRANSIENT_ERROR");
    expect(result.retryable).toBe(true);
    expect(result.category).toBe("transient");
  });

  it("classifies 408 (request timeout) as TRANSIENT", () => {
    expect(classifyProviderError({ status: 408 }).category).toBe("transient");
  });

  it("classifies 503 as TRANSIENT", () => {
    expect(classifyProviderError({ status: 503 }).category).toBe("transient");
  });

  it("classifies 400 as CLIENT (user-fixable)", () => {
    const result = classifyProviderError({ status: 400 });
    expect(result.code).toBe("CLIENT_ERROR");
    expect(result.retryable).toBe(false);
    expect(result.category).toBe("user-fixable");
  });

  it("classifies missing status as UNKNOWN (transient by default)", () => {
    const result = classifyProviderError({ message: "network reset" });
    expect(result.code).toBe("UNKNOWN_ERROR");
    expect(result.retryable).toBe(true);
    expect(result.category).toBe("transient");
    expect(result.statusCode).toBeUndefined();
  });

  it("reads status from `response.status`", () => {
    expect(classifyProviderError({ response: { status: 429 } }).code).toBe("TRANSIENT_ERROR");
  });

  it("reads status from `statusCode`", () => {
    expect(classifyProviderError({ statusCode: 401 }).code).toBe("AUTH_ERROR");
  });
});

describe("toAIProviderError", () => {
  it("returns the same instance if already AIProviderError (pass-through)", () => {
    const original = new AIProviderError("openai", "MALFORMED_RESPONSE", "boom", {
      retryable: false,
      category: "recoverable",
    });
    expect(toAIProviderError("openai", original, "fallback")).toBe(original);
  });

  it("wraps an SDK error with status 429 + retry-after header", () => {
    const sdkError = Object.assign(new Error("rate limited"), {
      status: 429,
      headers: { "retry-after": "5" },
    });
    const wrapped = toAIProviderError("openai", sdkError, "fallback");
    expect(wrapped.provider).toBe("openai");
    expect(wrapped.code).toBe("TRANSIENT_ERROR");
    expect(wrapped.retryable).toBe(true);
    expect(wrapped.category).toBe("transient");
    expect(wrapped.retryAfterMs).toBe(5000);
    expect(wrapped.statusCode).toBe(429);
  });

  it("wraps a plain string with fallback message (UNKNOWN → transient)", () => {
    const wrapped = toAIProviderError("openai", "raw string", "OpenAI generation failed");
    expect(wrapped.code).toBe("UNKNOWN_ERROR");
    expect(wrapped.category).toBe("transient");
    expect(wrapped.message).toBe("OpenAI generation failed");
  });

  it("preserves the original error as `cause`", () => {
    const cause = new Error("inner");
    const wrapped = toAIProviderError("anthropic", cause, "Anthropic failed");
    expect(wrapped.cause).toBe(cause);
  });
});

describe("errorFromFetchResponse", () => {
  it("builds a transient error from a 429 Response with retry-after header", () => {
    const response = new Response(null, {
      status: 429,
      headers: { "retry-after": "10" },
    });
    const err = errorFromFetchResponse("perplexity", response, "Perplexity API error");
    expect(err.provider).toBe("perplexity");
    expect(err.code).toBe("TRANSIENT_ERROR");
    expect(err.retryable).toBe(true);
    expect(err.category).toBe("transient");
    expect(err.retryAfterMs).toBe(10_000);
    expect(err.statusCode).toBe(429);
  });

  it("builds a user-fixable error for 401", () => {
    const response = new Response(null, { status: 401, statusText: "Unauthorized" });
    const err = errorFromFetchResponse("perplexity", response, "Perplexity API error");
    expect(err.code).toBe("AUTH_ERROR");
    expect(err.retryable).toBe(false);
    expect(err.category).toBe("user-fixable");
    expect(err.retryAfterMs).toBeUndefined();
  });
});
