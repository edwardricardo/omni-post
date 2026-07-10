/**
 * @file RedisMfaChallengeStoreAdapter.test.ts
 * @description Unit tests for the Redis-backed MFA challenge store. Asserts the
 *   allowlist contract: SET NX EX on issue, DEL-count on consume (exactly one
 *   winner), and typed fail-closed errors that are never swallowed.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { Redis } from "ioredis";

vi.mock("../../../../src/lib/logger.js", () => {
  const noop = vi.fn();
  const noopLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => noopLogger,
  };
  return { logger: noopLogger, authLogger: noopLogger, createLogger: () => noopLogger };
});

const { RedisMfaChallengeStoreAdapter } =
  await import("../../../../src/infrastructure/adapters/RedisMfaChallengeStoreAdapter.js");

const KEY = "auth:mfa-challenge:abc123";
const JTI = "abc123";

describe("RedisMfaChallengeStoreAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("issue", () => {
    it("registers the jti with SET NX EX and returns ok", async () => {
      const set = vi.fn(async () => "OK");
      const redis = { set, del: vi.fn() } as unknown as Redis;
      const adapter = new RedisMfaChallengeStoreAdapter(redis);

      const result = await adapter.issue(JTI, 180);

      assert.ok(result.ok);
      expect(set).toHaveBeenCalledWith(KEY, "1", "EX", 180, "NX");
    });

    it("returns STORE_ERROR when SET NX returns null (key already present)", async () => {
      const redis = { set: vi.fn(async () => null), del: vi.fn() } as unknown as Redis;
      const result = await new RedisMfaChallengeStoreAdapter(redis).issue(JTI, 180);
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "STORE_ERROR");
    });

    it("returns STORE_ERROR (fail-closed, not swallowed) when Redis throws", async () => {
      const redis = {
        set: vi.fn(async () => {
          throw new Error("redis down");
        }),
        del: vi.fn(),
      } as unknown as Redis;
      const result = await new RedisMfaChallengeStoreAdapter(redis).issue(JTI, 180);
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "STORE_ERROR");
    });
  });

  describe("consume", () => {
    it("returns CONSUMED when DEL removes exactly one key", async () => {
      const del = vi.fn(async () => 1);
      const redis = { set: vi.fn(), del } as unknown as Redis;
      const result = await new RedisMfaChallengeStoreAdapter(redis).consume(JTI);
      assert.ok(result.ok);
      assert.strictEqual(result.value, "CONSUMED");
      expect(del).toHaveBeenCalledWith(KEY);
    });

    it("returns NOT_FOUND when DEL removes nothing (consumed/expired/unknown)", async () => {
      const redis = { set: vi.fn(), del: vi.fn(async () => 0) } as unknown as Redis;
      const result = await new RedisMfaChallengeStoreAdapter(redis).consume(JTI);
      assert.ok(result.ok);
      assert.strictEqual(result.value, "NOT_FOUND");
    });

    it("returns STORE_ERROR when Redis throws", async () => {
      const redis = {
        set: vi.fn(),
        del: vi.fn(async () => {
          throw new Error("redis down");
        }),
      } as unknown as Redis;
      const result = await new RedisMfaChallengeStoreAdapter(redis).consume(JTI);
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "STORE_ERROR");
    });

    it("gives CONSUMED to exactly one of two callers (DEL-count serializes)", async () => {
      // Fake Redis over a Set: first DEL removes it (count 1), second finds
      // nothing (count 0) — the atomic-consume contract the port relies on.
      const store = new Set<string>([KEY]);
      const redis = {
        set: vi.fn(async () => "OK"),
        del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
      } as unknown as Redis;
      const adapter = new RedisMfaChallengeStoreAdapter(redis);

      const [a, b] = await Promise.all([adapter.consume(JTI), adapter.consume(JTI)]);
      const outcomes = [a, b].map((r) => (r.ok ? r.value : r.error)).sort();
      assert.deepStrictEqual(outcomes, ["CONSUMED", "NOT_FOUND"]);
    });
  });
});
