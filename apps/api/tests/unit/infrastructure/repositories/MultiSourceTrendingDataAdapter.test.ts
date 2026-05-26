/**
 * @file MultiSourceTrendingDataAdapter.test.ts
 * @description Unit tests for the composite trending-data adapter: fans out
 *              to each per-source adapter in parallel, concatenates
 *              fulfilled results, and swallows individual failures
 *              (Promise.allSettled — one failing source must not break the
 *              pipeline). The downstream use case dedupes by topic, so this
 *              adapter is intentionally order-agnostic.
 * @layer infrastructure
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { MultiSourceTrendingDataAdapter } from "../../../../src/infrastructure/repositories/MultiSourceTrendingDataAdapter.js";
import type {
  TrendingDataPort,
  TrendingTopic,
} from "@core/application/trends/FetchTrendingTopicsUseCase.js";

function topic(overrides: Partial<TrendingTopic>): TrendingTopic {
  return {
    topic: "#default",
    source: "perplexity-web",
    sourceUrl: null,
    platform: null,
    volume: null,
    category: null,
    trend: null,
    fetchedAt: new Date("2026-05-20T00:00:00.000Z"),
    ...overrides,
  };
}

function makePort(result: TrendingTopic[] | Error): TrendingDataPort {
  return {
    fetchTrends: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

describe("MultiSourceTrendingDataAdapter", () => {
  it("concatenates topics from every fulfilled adapter", async () => {
    const adapter = new MultiSourceTrendingDataAdapter([
      makePort([topic({ topic: "#a", source: "perplexity-web" })]),
      makePort([topic({ topic: "#b", source: "account-analytics" })]),
      makePort([topic({ topic: "@c", source: "inbox-mentions" })]),
    ]);

    const topics = await adapter.fetchTrends({ accountId: "acc-1" });

    const sources = topics.map((t) => t.source).sort();
    assert.deepStrictEqual(sources, ["account-analytics", "inbox-mentions", "perplexity-web"]);
    assert.strictEqual(topics.length, 3);
  });

  it("swallows individual adapter failures and returns the remaining results", async () => {
    const adapter = new MultiSourceTrendingDataAdapter([
      makePort([topic({ topic: "#ok", source: "perplexity-web" })]),
      makePort(new Error("boom")),
      makePort([topic({ topic: "@ok", source: "inbox-mentions" })]),
    ]);

    const topics = await adapter.fetchTrends({ accountId: "acc-1" });

    assert.strictEqual(topics.length, 2);
    const sources = topics.map((t) => t.source).sort();
    assert.deepStrictEqual(sources, ["inbox-mentions", "perplexity-web"]);
  });

  it("returns an empty array when every adapter fails", async () => {
    const adapter = new MultiSourceTrendingDataAdapter([
      makePort(new Error("first")),
      makePort(new Error("second")),
    ]);

    const topics = await adapter.fetchTrends({ accountId: "acc-1" });

    assert.deepStrictEqual(topics, []);
  });

  it("returns an empty array when there are no adapters configured", async () => {
    const adapter = new MultiSourceTrendingDataAdapter([]);

    const topics = await adapter.fetchTrends({ accountId: "acc-1" });

    assert.deepStrictEqual(topics, []);
  });

  it("passes the input through to each adapter unchanged", async () => {
    const calls: unknown[] = [];
    const spyPort: TrendingDataPort = {
      fetchTrends: async (input) => {
        calls.push(input);
        return [];
      },
    };
    const adapter = new MultiSourceTrendingDataAdapter([spyPort, spyPort]);

    await adapter.fetchTrends({ accountId: "acc-9", sources: ["perplexity-web"] });

    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(calls[0], { accountId: "acc-9", sources: ["perplexity-web"] });
    assert.deepStrictEqual(calls[1], { accountId: "acc-9", sources: ["perplexity-web"] });
  });
});
