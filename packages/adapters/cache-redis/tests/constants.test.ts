/**
 * Constants tests
 * Pure unit tests for CacheKeys and CacheTTL constants — zero external deps.
 * Tier 0: no DB, no Redis, no network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CacheKeys, CacheTTL } from "../src/constants.js";

describe("CacheKeys", { concurrency: 1 }, () => {
  it("user() generates correct key", () => {
    assert.strictEqual(CacheKeys.user("u-123"), "user:u-123");
  });

  it("post() generates correct key", () => {
    assert.strictEqual(CacheKeys.post("p-456"), "post:p-456");
  });

  it("project() generates correct key", () => {
    assert.strictEqual(CacheKeys.project("proj-789"), "project:proj-789");
  });

  it("analytics() generates correct key with period", () => {
    assert.strictEqual(CacheKeys.analytics("p-1", "7d"), "analytics:p-1:7d");
  });

  it("media() generates correct key", () => {
    assert.strictEqual(CacheKeys.media("m-abc"), "media:m-abc");
  });

  it("timeline() generates correct key with page number", () => {
    assert.strictEqual(CacheKeys.timeline("u-1", 3), "timeline:u-1:3");
    assert.strictEqual(CacheKeys.timeline("u-1", 0), "timeline:u-1:0");
  });

  it("search() generates base64-encoded key", () => {
    const key = CacheKeys.search("hello world", '{"filter":"active"}');
    assert.ok(key.startsWith("search:"), "key should start with search:");
    // The base64 portion should be non-empty
    const b64 = key.replace("search:", "");
    assert.ok(b64.length > 0, "base64 portion should be non-empty");
    // Decoding should round-trip
    const decoded = Buffer.from(b64, "base64").toString();
    assert.strictEqual(decoded, 'hello world{"filter":"active"}');
  });

  it("apiResponse() generates base64-encoded key (params only in the base64 part)", () => {
    // Format: api:<endpoint>:<base64(params)>
    // Only `params` is base64-encoded, not `endpoint + params`.
    const key = CacheKeys.apiResponse("/users", '{"page":1}');
    assert.ok(key.startsWith("api:/users:"), "key should start with api:/users:");
    const b64 = key.replace("api:/users:", "");
    const decoded = Buffer.from(b64, "base64").toString();
    // The base64 encodes only the `params` argument
    assert.strictEqual(decoded, '{"page":1}');
  });

  it("search() produces different keys for different queries", () => {
    const key1 = CacheKeys.search("foo", "{}");
    const key2 = CacheKeys.search("bar", "{}");
    assert.notStrictEqual(key1, key2);
  });

  it("search() produces different keys for different filters", () => {
    const key1 = CacheKeys.search("q", '{"a":1}');
    const key2 = CacheKeys.search("q", '{"a":2}');
    assert.notStrictEqual(key1, key2);
  });

  it("user() key changes with different IDs", () => {
    assert.notStrictEqual(CacheKeys.user("a"), CacheKeys.user("b"));
  });
});

describe("CacheTTL", { concurrency: 1 }, () => {
  it("SHORT is 300 seconds (5 minutes)", () => {
    assert.strictEqual(CacheTTL.SHORT, 300);
  });

  it("MEDIUM is 1800 seconds (30 minutes)", () => {
    assert.strictEqual(CacheTTL.MEDIUM, 1800);
  });

  it("LONG is 3600 seconds (1 hour)", () => {
    assert.strictEqual(CacheTTL.LONG, 3600);
  });

  it("VERY_LONG is 86400 seconds (24 hours)", () => {
    assert.strictEqual(CacheTTL.VERY_LONG, 86400);
  });

  it("WEEK is 604800 seconds (7 days)", () => {
    assert.strictEqual(CacheTTL.WEEK, 604800);
  });

  it("TTL values are ordered SHORT < MEDIUM < LONG < VERY_LONG < WEEK", () => {
    assert.ok(CacheTTL.SHORT < CacheTTL.MEDIUM);
    assert.ok(CacheTTL.MEDIUM < CacheTTL.LONG);
    assert.ok(CacheTTL.LONG < CacheTTL.VERY_LONG);
    assert.ok(CacheTTL.VERY_LONG < CacheTTL.WEEK);
  });
});
