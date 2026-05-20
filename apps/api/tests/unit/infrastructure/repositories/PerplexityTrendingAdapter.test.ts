/**
 * @file PerplexityTrendingAdapter.test.ts
 * @description Unit tests for the Perplexity-Sonar-backed trending source:
 *              honours the per-source filter, calls
 *              `AIServicePort.generateStructured` with `trendDiscoverySpec`,
 *              tags every result with `source: "perplexity-web"`, and
 *              propagates the structured `sourceUrl` field (citation
 *              surface workaround documented in SMELL-17).
 * @layer infrastructure
 */
import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { PerplexityTrendingAdapter } from "../../../../src/infrastructure/repositories/PerplexityTrendingAdapter.js";
import type { AIServicePort } from "../../../../src/domain/repositories/AIServicePort.js";

function makeAI(
  topics: Array<{
    topic: string;
    platform: string | null;
    sourceUrl: string | null;
    volume: number | null;
    trend: "rising" | "stable" | "declining" | null;
  }> | null
): AIServicePort {
  return {
    generateStructured: vi
      .fn()
      .mockResolvedValue(topics === null ? err("AI_ERROR") : ok({ topics })),
    generateText: vi.fn(),
    generateContent: vi.fn(),
    analyzeContent: vi.fn(),
    optimizeContent: vi.fn(),
    predictPerformance: vi.fn(),
    generateVariations: vi.fn(),
  } as unknown as AIServicePort;
}

describe("PerplexityTrendingAdapter", () => {
  it("returns an empty list when sources filter excludes perplexity-web", async () => {
    const ai = makeAI([
      { topic: "#AI", platform: "TIKTOK", sourceUrl: null, volume: null, trend: null },
    ]);
    const adapter = new PerplexityTrendingAdapter(ai);

    const topics = await adapter.fetchTrends({
      accountId: "acc-1",
      sources: ["account-analytics", "inbox-mentions"],
    });

    assert.deepStrictEqual(topics, []);
    assert.strictEqual(vi.mocked(ai.generateStructured).mock.calls.length, 0);
  });

  it("tags every returned topic with source perplexity-web", async () => {
    const ai = makeAI([
      {
        topic: "#AIArt",
        platform: "TIKTOK",
        sourceUrl: "https://ex.example/ai",
        volume: 1200,
        trend: "rising",
      },
      { topic: "#Cooking", platform: "INSTAGRAM", sourceUrl: null, volume: null, trend: "stable" },
    ]);
    const adapter = new PerplexityTrendingAdapter(ai);

    const topics = await adapter.fetchTrends({ accountId: "acc-1" });

    assert.strictEqual(topics.length, 2);
    for (const t of topics) {
      assert.strictEqual(t.source, "perplexity-web");
    }
  });

  it("propagates the structured sourceUrl field for citation provenance", async () => {
    const ai = makeAI([
      { topic: "#A", platform: null, sourceUrl: "https://ex.example/a", volume: null, trend: null },
      { topic: "#B", platform: null, sourceUrl: null, volume: null, trend: null },
    ]);
    const adapter = new PerplexityTrendingAdapter(ai);

    const topics = await adapter.fetchTrends({ accountId: "acc-1" });

    assert.strictEqual(topics[0]?.sourceUrl, "https://ex.example/a");
    assert.strictEqual(topics[1]?.sourceUrl, null);
  });

  it("returns an empty list when the AI service errors (graceful default)", async () => {
    const ai = makeAI(null);
    const adapter = new PerplexityTrendingAdapter(ai);

    const topics = await adapter.fetchTrends({ accountId: "acc-1" });

    assert.deepStrictEqual(topics, []);
  });

  it("passes the accountId through to the AI call for tenant scoping", async () => {
    const ai = makeAI([]);
    const adapter = new PerplexityTrendingAdapter(ai);

    await adapter.fetchTrends({ accountId: "acc-42" });

    const call = vi.mocked(ai.generateStructured).mock.calls[0];
    assert.strictEqual(call?.[3], "acc-42");
  });
});
