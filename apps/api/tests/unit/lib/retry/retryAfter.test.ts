/**
 * @file retryAfter.test.ts
 * @description Tests for `parseRetryAfterMs` (RFC 9110 §10.2.3 parser) and
 *              `extractRetryAfterMs` (duck-type SDK error walker).
 * @layer infrastructure
 */

import { describe, it, afterEach, vi, expect } from "vitest";
import {
  parseRetryAfterMs,
  extractRetryAfterMs,
  MAX_RETRY_AFTER_MS,
} from "../../../../src/lib/retry/retryAfter.js";

describe("parseRetryAfterMs", () => {
  it("parses delta-seconds string to ms", () => {
    expect(parseRetryAfterMs("30")).toBe(30_000);
  });

  it("parses numeric delta-seconds to ms", () => {
    expect(parseRetryAfterMs(15)).toBe(15_000);
  });

  it("clamps very large delta-seconds to MAX_RETRY_AFTER_MS", () => {
    expect(parseRetryAfterMs("3600")).toBe(MAX_RETRY_AFTER_MS);
  });

  it("returns null for negative numbers", () => {
    expect(parseRetryAfterMs(-5)).toBeNull();
  });

  it("returns null for empty / whitespace string", () => {
    expect(parseRetryAfterMs("")).toBeNull();
    expect(parseRetryAfterMs("   ")).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(parseRetryAfterMs("not-a-number-and-not-a-date")).toBeNull();
  });

  it("parses an HTTP-date in the future", () => {
    const future = new Date(Date.now() + 30_000).toUTCString();
    const parsed = parseRetryAfterMs(future);
    expect(parsed).not.toBeNull();
    expect(parsed).toBeGreaterThan(20_000);
    expect(parsed).toBeLessThanOrEqual(MAX_RETRY_AFTER_MS);
  });

  it("returns 0 for an HTTP-date in the past", () => {
    const past = new Date(Date.now() - 30_000).toUTCString();
    expect(parseRetryAfterMs(past)).toBe(0);
  });

  it("returns null for null/undefined", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs(undefined)).toBeNull();
  });
});

describe("extractRetryAfterMs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads `retryAfterMs: number` directly", () => {
    expect(extractRetryAfterMs({ retryAfterMs: 5000 })).toBe(5000);
  });

  it("reads `retryAfter: number` as seconds", () => {
    expect(extractRetryAfterMs({ retryAfter: 7 })).toBe(7000);
  });

  it("reads `retryAfter: string` as seconds", () => {
    expect(extractRetryAfterMs({ retryAfter: "12" })).toBe(12_000);
  });

  it("reads `headers['retry-after']` from a plain record (OpenAI SDK shape)", () => {
    expect(extractRetryAfterMs({ headers: { "retry-after": "10" } })).toBe(10_000);
  });

  it("reads `headers['Retry-After']` capitalised", () => {
    expect(extractRetryAfterMs({ headers: { "Retry-After": "8" } })).toBe(8000);
  });

  it("reads from a `Headers` instance (fetch Response shape)", () => {
    const headers = new Headers();
    headers.set("retry-after", "20");
    expect(extractRetryAfterMs({ headers })).toBe(20_000);
  });

  it("reads from `response.headers` (Axios shape)", () => {
    expect(extractRetryAfterMs({ response: { headers: { "retry-after": "9" } } })).toBe(9000);
  });

  it("recurses into `cause`", () => {
    const inner = { headers: { "retry-after": "4" } };
    expect(extractRetryAfterMs({ cause: inner })).toBe(4000);
  });

  it("stops recursion at depth 3 to avoid stack overflow on cycles", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.cause = cyclic;
    expect(extractRetryAfterMs(cyclic)).toBeNull();
  });

  it("returns null when no hint is present", () => {
    expect(extractRetryAfterMs({ message: "oops" })).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(extractRetryAfterMs(null)).toBeNull();
    expect(extractRetryAfterMs("string")).toBeNull();
    expect(extractRetryAfterMs(undefined)).toBeNull();
  });
});
