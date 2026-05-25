/**
 * @file trendRadar.test.ts
 * @description Unit tests for the trend-radar use cases against the canon
 *              multi-source `TrendingDataPort` + `AIServicePort.generateStructured`
 *              path. Covers fetching with provenance tagging, scoring above the
 *              relevance threshold, and graceful handling of AI failure.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import {
  FetchTrendingTopicsUseCase,
  type TrendingDataPort,
  type TrendingTopic,
} from "@core/application/trends/FetchTrendingTopicsUseCase.js";
import {
  ScoreTrendRelevanceUseCase,
  type ScoreTrendContextPort,
} from "@core/application/trends/ScoreTrendRelevanceUseCase.js";
import type { AIServicePort } from "../../../src/domain/repositories/AIServicePort.js";
import { trendScoringSpec } from "../../../src/ai/structuredSchemas.js";
import { InMemoryCacheAdapter } from "../../../../../packages/adapters/cache-redis/src/in-memory-cache-adapter.js";

const fixedDate = new Date("2026-05-20T00:00:00.000Z");

function topic(overrides: Partial<TrendingTopic> = {}): TrendingTopic {
  return {
    topic: "#AIArt",
    source: "perplexity-web",
    sourceUrl: null,
    platform: "TIKTOK",
    volume: 1000,
    category: null,
    trend: "rising",
    fetchedAt: fixedDate,
    ...overrides,
  };
}

function makePort(topics: TrendingTopic[]): TrendingDataPort {
  return {
    fetchTrends: vi.fn().mockResolvedValue(topics),
  };
}

function makeAI(
  scores: Array<{
    index: number;
    score: number;
    postIdea?: string | null;
    bestPlatform?: string | null;
    urgency?: "NOW" | "TODAY" | "THIS_WEEK";
  }> | null
): AIServicePort {
  return {
    generateStructured: vi.fn().mockResolvedValue(
      scores === null
        ? err("AI_ERROR")
        : ok({
            scores: scores.map((s) => ({
              index: s.index,
              score: s.score,
              postIdea: s.postIdea ?? null,
              bestPlatform: s.bestPlatform ?? null,
              urgency: s.urgency ?? "THIS_WEEK",
            })),
          })
    ),
    generateText: vi.fn(),
    generateContent: vi.fn(),
    analyzeContent: vi.fn(),
    optimizeContent: vi.fn(),
    predictPerformance: vi.fn(),
    generateVariations: vi.fn(),
  } as unknown as AIServicePort;
}

describe("FetchTrendingTopicsUseCase", () => {
  let cache: InMemoryCacheAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new InMemoryCacheAdapter();
  });

  it("fetches trends from the multi-source port and tags each with provenance", async () => {
    const topics = [
      topic({ topic: "#AIArt", source: "perplexity-web" }),
      topic({ topic: "#OwnTag", source: "account-analytics" }),
      topic({ topic: "@inboundMention", source: "inbox-mentions" }),
    ];
    const port = makePort(topics);
    const useCase = new FetchTrendingTopicsUseCase(port, cache);

    const result = await useCase.execute({ accountId: "acc-1" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.topics.length, 3);
    const sources = result.value.topics.map((t) => t.source).sort();
    assert.deepStrictEqual(sources, ["account-analytics", "inbox-mentions", "perplexity-web"]);
    expect(port.fetchTrends).toHaveBeenCalledWith({ accountId: "acc-1" });
  });

  it("deduplicates topics by case-insensitive name", async () => {
    const port = makePort([
      topic({ topic: "#AI" }),
      topic({ topic: "#ai" }),
      topic({ topic: "#Cooking" }),
    ]);
    const useCase = new FetchTrendingTopicsUseCase(port, cache);

    const result = await useCase.execute({ accountId: "acc-2" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.topics.length, 2);
  });

  it("returns an empty page when the port returns no topics", async () => {
    const port = makePort([]);
    const useCase = new FetchTrendingTopicsUseCase(port, cache);

    const result = await useCase.execute({ accountId: "acc-3" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.topics.length, 0);
  });

  it("caches results so a second call within the TTL does not re-query the port", async () => {
    const port = makePort([topic()]);
    const useCase = new FetchTrendingTopicsUseCase(port, cache);

    await useCase.execute({ accountId: "acc-cache" });
    await useCase.execute({ accountId: "acc-cache" });

    expect(port.fetchTrends).toHaveBeenCalledTimes(1);
  });
});

describe("ScoreTrendRelevanceUseCase", () => {
  const contextPort: ScoreTrendContextPort = {
    getBrandVoice: vi.fn().mockResolvedValue("Friendly tech-forward brand"),
    getPerformanceInsights: vi.fn().mockResolvedValue(["High engagement on AI content"]),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns scored topics in descending relevance order", async () => {
    const ai = makeAI([
      { index: 1, score: 8, postIdea: "Lean into AI", bestPlatform: "INSTAGRAM", urgency: "NOW" },
      { index: 2, score: 9, postIdea: "Fashion AI", bestPlatform: "TIKTOK", urgency: "TODAY" },
    ]);
    const useCase = new ScoreTrendRelevanceUseCase(ai, trendScoringSpec, contextPort);

    const result = await useCase.execute({
      accountId: "acc-1",
      topics: [
        topic({ topic: "#AIArt" }),
        topic({ topic: "#SpringFashion", source: "account-analytics" }),
      ],
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.scored.length, 2);
    assert.strictEqual(result.value.scored[0]?.topic, "#SpringFashion");
    assert.strictEqual(result.value.scored[0]?.source, "account-analytics");
    assert.strictEqual(result.value.scored[1]?.topic, "#AIArt");
  });

  it("filters topics below the relevance threshold (score < 6)", async () => {
    const ai = makeAI([
      { index: 1, score: 4 },
      { index: 2, score: 7 },
    ]);
    const useCase = new ScoreTrendRelevanceUseCase(ai, trendScoringSpec, contextPort);

    const result = await useCase.execute({
      accountId: "acc-1",
      topics: [topic({ topic: "#Low" }), topic({ topic: "#High" })],
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.scored.length, 1);
    assert.strictEqual(result.value.scored[0]?.topic, "#High");
  });

  it("returns an empty list on AI failure (graceful default)", async () => {
    const ai = makeAI(null);
    const useCase = new ScoreTrendRelevanceUseCase(ai, trendScoringSpec, contextPort);

    const result = await useCase.execute({
      accountId: "acc-1",
      topics: [topic()],
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.scored.length, 0);
  });

  it("returns an empty list when there are no topics to score", async () => {
    const ai = makeAI([]);
    const useCase = new ScoreTrendRelevanceUseCase(ai, trendScoringSpec, contextPort);

    const result = await useCase.execute({ accountId: "acc-1", topics: [] });

    assert.ok(result.ok);
    assert.strictEqual(result.value.scored.length, 0);
  });
});
