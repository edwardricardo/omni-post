/**
 * @file oauthFlowStore.test.ts
 * @description Unit tests for the CachePort-backed OAuth flow store:
 *              single-use consume, TTL expiry, and cross-instance
 *              visibility (the property the former in-memory Map lacked).
 * @layer infrastructure
 */
import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { InMemoryCacheAdapter } from "@adapters/cache-redis";
import type { OAuthFlowRecord } from "@ports/core";
import { OAuthFlowStore } from "../../../src/auth/oauth/OAuthFlowStore.js";

const makeRecord = (overrides?: Partial<OAuthFlowRecord>): OAuthFlowRecord => ({
  providerId: "x",
  accountId: "acc-1",
  projectId: "proj-1",
  codeVerifier: "verifier-abc",
  createdAt: "2026-05-19T00:00:00.000Z",
  ...overrides,
});

describe("OAuthFlowStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the stored record on first consume", async () => {
    const store = new OAuthFlowStore(new InMemoryCacheAdapter());
    await store.put("state-1", makeRecord(), 600);

    const got = await store.consume("state-1");

    assert.ok(got);
    assert.strictEqual(got.providerId, "x");
    assert.strictEqual(got.codeVerifier, "verifier-abc");
  });

  it("is single-use: a replayed state resolves to null", async () => {
    const store = new OAuthFlowStore(new InMemoryCacheAdapter());
    await store.put("state-1", makeRecord(), 600);

    const first = await store.consume("state-1");
    const second = await store.consume("state-1");

    assert.ok(first);
    assert.strictEqual(second, null);
  });

  it("returns null after the TTL elapses", async () => {
    const store = new OAuthFlowStore(new InMemoryCacheAdapter());
    await store.put("state-ttl", makeRecord(), 600);

    vi.advanceTimersByTime(601 * 1000);

    assert.strictEqual(await store.consume("state-ttl"), null);
  });

  it("returns null for an unknown state", async () => {
    const store = new OAuthFlowStore(new InMemoryCacheAdapter());
    assert.strictEqual(await store.consume("never-set"), null);
  });

  it("is visible across store instances sharing the same cache (cross-pod)", async () => {
    const cache = new InMemoryCacheAdapter();
    const writer = new OAuthFlowStore(cache);
    const reader = new OAuthFlowStore(cache);

    await writer.put("state-x", makeRecord({ accountId: "acc-9" }), 600);
    const got = await reader.consume("state-x");

    assert.ok(got);
    assert.strictEqual(got.accountId, "acc-9");
  });
});
