/**
 * Constants tests
 * Pure unit tests for CacheKeys and CacheTTL constants — zero external deps.
 * Tier 0: no DB, no Redis, no network.
 */

import { describe, it, expect } from "vitest";
import { CacheKeys, CacheTTL } from "../src/constants.js";

describe("CacheKeys", { concurrency: 1 }, () => {
  it("user() generates correct key", () => {
    expect(CacheKeys.user("u-123")).toBe("user:u-123");
  });

  it("post() generates correct key", () => {
    expect(CacheKeys.post("p-456")).toBe("post:p-456");
  });

  it("project() generates correct key", () => {
    expect(CacheKeys.project("proj-789")).toBe("project:proj-789");
  });

  it("analytics() generates correct key with period", () => {
    expect(CacheKeys.analytics("p-1", "7d")).toBe("analytics:p-1:7d");
  });

  it("media() generates correct key", () => {
    expect(CacheKeys.media("m-abc")).toBe("media:m-abc");
  });

  it("timeline() generates correct key with page number", () => {
    expect(CacheKeys.timeline("u-1", 3)).toBe("timeline:u-1:3");
    expect(CacheKeys.timeline("u-1", 0)).toBe("timeline:u-1:0");
  });

  it("search() generates base64-encoded key", () => {
    const key = CacheKeys.search("hello world", '{"filter":"active"}');
    expect(key.startsWith("search:")).toBe(true);
    // The base64 portion should be non-empty
    const b64 = key.replace("search:", "");
    expect(b64.length).toBeGreaterThan(0);
    // Decoding should round-trip
    const decoded = Buffer.from(b64, "base64").toString();
    expect(decoded).toBe('hello world{"filter":"active"}');
  });

  it("apiResponse() generates base64-encoded key (params only in the base64 part)", () => {
    // Format: api:<endpoint>:<base64(params)>
    // Only `params` is base64-encoded, not `endpoint + params`.
    const key = CacheKeys.apiResponse("/users", '{"page":1}');
    expect(key.startsWith("api:/users:")).toBe(true);
    const b64 = key.replace("api:/users:", "");
    const decoded = Buffer.from(b64, "base64").toString();
    // The base64 encodes only the `params` argument
    expect(decoded).toBe('{"page":1}');
  });

  it("search() produces different keys for different queries", () => {
    const key1 = CacheKeys.search("foo", "{}");
    const key2 = CacheKeys.search("bar", "{}");
    expect(key1).not.toBe(key2);
  });

  it("search() produces different keys for different filters", () => {
    const key1 = CacheKeys.search("q", '{"a":1}');
    const key2 = CacheKeys.search("q", '{"a":2}');
    expect(key1).not.toBe(key2);
  });

  it("user() key changes with different IDs", () => {
    expect(CacheKeys.user("a")).not.toBe(CacheKeys.user("b"));
  });
});

describe("CacheTTL", { concurrency: 1 }, () => {
  it("SHORT is 300 seconds (5 minutes)", () => {
    expect(CacheTTL.SHORT).toBe(300);
  });

  it("MEDIUM is 1800 seconds (30 minutes)", () => {
    expect(CacheTTL.MEDIUM).toBe(1800);
  });

  it("LONG is 3600 seconds (1 hour)", () => {
    expect(CacheTTL.LONG).toBe(3600);
  });

  it("VERY_LONG is 86400 seconds (24 hours)", () => {
    expect(CacheTTL.VERY_LONG).toBe(86400);
  });

  it("WEEK is 604800 seconds (7 days)", () => {
    expect(CacheTTL.WEEK).toBe(604800);
  });

  it("TTL values are ordered SHORT < MEDIUM < LONG < VERY_LONG < WEEK", () => {
    expect(CacheTTL.SHORT).toBeLessThan(CacheTTL.MEDIUM);
    expect(CacheTTL.MEDIUM).toBeLessThan(CacheTTL.LONG);
    expect(CacheTTL.LONG).toBeLessThan(CacheTTL.VERY_LONG);
    expect(CacheTTL.VERY_LONG).toBeLessThan(CacheTTL.WEEK);
  });
});
