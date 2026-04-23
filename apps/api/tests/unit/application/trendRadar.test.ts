/**
 * @file trendRadar.test.ts
 * @description Unit tests for FetchTrendingTopicsUseCase and ScoreTrendRelevanceUseCase.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { FetchTrendingTopicsUseCase } from "../../../src/application/trends/FetchTrendingTopicsUseCase.js";
import { ScoreTrendRelevanceUseCase } from "../../../src/application/trends/ScoreTrendRelevanceUseCase.js";

const sampleTopics = [
  {
    topic: "#AIArt",
    platform: "TIKTOK",
    volume: 42000,
    category: "Technology",
    trend: "rising" as const,
    fetchedAt: new Date(),
  },
  {
    topic: "#SpringFashion",
    platform: "TIKTOK",
    volume: 15000,
    category: "Fashion",
    trend: "rising" as const,
    fetchedAt: new Date(),
  },
  {
    topic: "#Cooking",
    platform: "TIKTOK",
    volume: 8000,
    category: "Food",
    trend: "stable" as const,
    fetchedAt: new Date(),
  },
];

function makeMockTrendPort(topics = sampleTopics) {
  return {
    fetchFromPlatform: vi.fn().mockResolvedValue(topics),
    getConnectedPlatformsWithTrending: vi.fn().mockResolvedValue(["TIKTOK"]),
  };
}

describe("FetchTrendingTopicsUseCase", () => {
  let port: ReturnType<typeof makeMockTrendPort>;
  let useCase: FetchTrendingTopicsUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    port = makeMockTrendPort();
    useCase = new FetchTrendingTopicsUseCase(port);
  });

  it("fetches trends from connected platforms", async () => {
    const result = await useCase.execute({ accountId: "acc-fetch-1" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.topics.length, 3);
    expect(port.fetchFromPlatform).toHaveBeenCalledWith("TIKTOK", "acc-fetch-1");
  });

  it("returns empty array when no platforms connected", async () => {
    port.getConnectedPlatformsWithTrending.mockResolvedValue([]);
    const result = await useCase.execute({ accountId: "acc-no-plat" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.topics.length, 0);
  });

  it("deduplicates topics by name", async () => {
    const dupes = [
      {
        topic: "#AI",
        platform: "TIKTOK",
        volume: 100,
        category: null,
        trend: "rising" as const,
        fetchedAt: new Date(),
      },
      {
        topic: "#ai",
        platform: "TIKTOK",
        volume: 200,
        category: null,
        trend: "rising" as const,
        fetchedAt: new Date(),
      },
    ];
    port = makeMockTrendPort(dupes);
    useCase = new FetchTrendingTopicsUseCase(port);

    const result = await useCase.execute({ accountId: "acc-dedup" });
    assert.ok(result.ok);
    assert.strictEqual(result.value.topics.length, 1);
  });

  it("returns gracefully when adapter fails", async () => {
    port.fetchFromPlatform.mockRejectedValue(new Error("API down"));

    const result = await useCase.execute({ accountId: "acc-fail" });
    assert.ok(result.ok);
    assert.strictEqual(result.value.topics.length, 0);
  });

  it("caches result for 30 minutes", async () => {
    await useCase.execute({ accountId: "acc-cache-trend" });
    await useCase.execute({ accountId: "acc-cache-trend" });

    expect(port.fetchFromPlatform).toHaveBeenCalledOnce();
  });
});

describe("ScoreTrendRelevanceUseCase", () => {
  const mockScoreResponse = JSON.stringify({
    scores: [
      {
        index: 1,
        score: 9,
        postIdea: "Create an AI art showcase",
        bestPlatform: "INSTAGRAM",
        urgency: "NOW",
      },
      {
        index: 2,
        score: 7,
        postIdea: "Spring fashion tips",
        bestPlatform: "TIKTOK",
        urgency: "TODAY",
      },
    ],
  });

  function makeMockAI(response = mockScoreResponse) {
    return { generateContent: vi.fn().mockResolvedValue({ success: true, value: response }) };
  }

  it("returns topics sorted by relevance score descending", async () => {
    const ai = makeMockAI();
    const useCase = new ScoreTrendRelevanceUseCase(ai);

    const result = await useCase.execute({ accountId: "acc-1", topics: sampleTopics });
    assert.ok(result.ok);
    assert.strictEqual(result.value.scored[0]?.relevanceScore, 9);
    assert.strictEqual(result.value.scored[1]?.relevanceScore, 7);
  });

  it("includes post idea for relevant topics", async () => {
    const ai = makeMockAI();
    const useCase = new ScoreTrendRelevanceUseCase(ai);

    const result = await useCase.execute({ accountId: "acc-1", topics: sampleTopics });
    assert.ok(result.ok);
    assert.ok(result.value.scored[0]?.postIdea?.includes("AI art"));
  });

  it("excludes topics with score < 6", async () => {
    const ai = makeMockAI(
      JSON.stringify({ scores: [{ index: 1, score: 3, postIdea: null, urgency: "THIS_WEEK" }] })
    );
    const useCase = new ScoreTrendRelevanceUseCase(ai);

    const result = await useCase.execute({ accountId: "acc-1", topics: sampleTopics });
    assert.ok(result.ok);
    assert.strictEqual(result.value.scored.length, 0);
  });

  it("returns empty when AI fails", async () => {
    const ai = makeMockAI();
    ai.generateContent.mockResolvedValue({ success: false });
    const useCase = new ScoreTrendRelevanceUseCase(ai);

    const result = await useCase.execute({ accountId: "acc-1", topics: sampleTopics });
    assert.ok(result.ok);
    assert.strictEqual(result.value.scored.length, 0);
  });

  it("returns empty for empty topics input", async () => {
    const ai = makeMockAI();
    const useCase = new ScoreTrendRelevanceUseCase(ai);

    const result = await useCase.execute({ accountId: "acc-1", topics: [] });
    assert.ok(result.ok);
    assert.strictEqual(result.value.scored.length, 0);
  });
});
