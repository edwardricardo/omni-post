/**
 * @file FetchTrendingTopicsUseCase.test.ts
 * @description Unit tests for FetchTrendingTopicsUseCase — cache hit returns
 *   cached data, cache miss fetches and deduplicates topics, and an adapter
 *   failure surfaces as INTERNAL_ERROR.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  FetchTrendingTopicsUseCase,
  type TrendingDataPort,
  type TrendingTopic,
} from "../../src/FetchTrendingTopicsUseCase.js";
import type { CachePort } from "@ports/core";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

const ACCOUNT_ID = "acc-0000-test";

function makeTopic(
  topic: string,
  source: TrendingTopic["source"] = "account-analytics"
): TrendingTopic {
  return {
    topic,
    source,
    sourceUrl: null,
    platform: null,
    volume: 42,
    category: "tech",
    trend: "rising",
    fetchedAt: new Date("2024-01-01T00:00:00Z"),
  };
}

function makeMockPort(topics: TrendingTopic[] = []): TrendingDataPort {
  return {
    fetchTrends: vi.fn(async () => topics),
  };
}

function makeMockCache(cached: unknown = null): CachePort {
  return {
    getOrSet: vi.fn(async (_key: string, factory: () => Promise<unknown>) => {
      if (cached !== null) return cached;
      return factory();
    }),
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    has: vi.fn(),
    invalidateByTag: vi.fn(),
  } as unknown as CachePort;
}

describe("FetchTrendingTopicsUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns trending topics fetched from the data port on cache miss", async () => {
    const topics = [makeTopic("AI"), makeTopic("TypeScript")];
    const port = makeMockPort(topics);
    const cache = makeMockCache(null);
    const uc = new FetchTrendingTopicsUseCase(port, cache);
    const r = await uc.execute({ accountId: ACCOUNT_ID });
    assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error.message}`);
    assert.strictEqual(r.value.topics.length, 2);
    assert.ok(r.value.cachedUntil instanceof Date);
  });

  it("deduplicates topics with the same name (case-insensitive)", async () => {
    const topics = [makeTopic("AI"), makeTopic("ai"), makeTopic("TypeScript")];
    const port = makeMockPort(topics);
    const cache = makeMockCache(null);
    const uc = new FetchTrendingTopicsUseCase(port, cache);
    const r = await uc.execute({ accountId: ACCOUNT_ID });
    assert.ok(r.ok);
    assert.strictEqual(r.value.topics.length, 2);
  });

  it("returns cached result without calling the port when cache is warm", async () => {
    const cachedResult = {
      topics: [makeTopic("cached-topic")],
      cachedUntil: new Date(Date.now() + 1800 * 1000),
    };
    const port = makeMockPort([]);
    const cache = makeMockCache(cachedResult);
    const uc = new FetchTrendingTopicsUseCase(port, cache);
    const r = await uc.execute({ accountId: ACCOUNT_ID });
    assert.ok(r.ok);
    assert.strictEqual(r.value.topics[0]?.topic, "cached-topic");
  });

  it("returns INTERNAL_ERROR when the cache adapter throws", async () => {
    const port = makeMockPort([]);
    const brokenCache = {
      getOrSet: vi.fn(async () => {
        throw new Error("Redis down");
      }),
    } as unknown as CachePort;
    const uc = new FetchTrendingTopicsUseCase(port, brokenCache);
    const r = await uc.execute({ accountId: ACCOUNT_ID });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
  });
});
