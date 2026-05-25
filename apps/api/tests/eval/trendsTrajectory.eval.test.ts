/**
 * @file trendsTrajectory.eval.test.ts
 * @description Trajectory eval for the trend-radar slice. The pipeline
 *              is fetch → score → persist, orchestrated by
 *              `DetectTrendsUseCase`. The eval asserts the exact stage
 *              order, the number of `AIServicePort.generateStructured`
 *              invocations as a cost proxy, and the relevance-threshold
 *              filter policy (only scored items with score ≥ 6 survive).
 *
 *              Failure of any assertion below blocks merge: a drift in
 *              pipeline order, an extra LLM call, or a regression in
 *              the relevance gate are all release-blocking.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok } from "@shared/types";
import { DetectTrendsUseCase } from "@core/application/trends/DetectTrendsUseCase.js";
import { FetchTrendingTopicsUseCase } from "@core/application/trends/FetchTrendingTopicsUseCase.js";
import { ScoreTrendRelevanceUseCase } from "@core/application/trends/ScoreTrendRelevanceUseCase.js";
import type {
  TrendingTopic,
  TrendingDataPort,
} from "@core/application/trends/FetchTrendingTopicsUseCase.js";
import type { ScoreTrendContextPort } from "@core/application/trends/ScoreTrendRelevanceUseCase.js";
import type { AIServicePort } from "../../src/domain/repositories/AIServicePort.js";
import { trendScoringSpec } from "../../src/ai/structuredSchemas.js";
import type {
  TrendRadarResultPort,
  TrendRadarUpsertInput,
  TrendRadarUpsertOutput,
} from "@core/application/trends/TrendRadarResultPort.js";
import { InMemoryCacheAdapter } from "../../../../packages/adapters/cache-redis/src/in-memory-cache-adapter.js";

/**
 * Per-detection ceiling on AI invocations. The current pipeline calls
 * `generateStructured` exactly once per detection (a single scoring
 * pass over the fetched topics). A regression that adds additional
 * passes must surface here.
 */
const MAX_TRENDS_AI_CALLS = 1;

/** Canonical pipeline stage order. */
const EXPECTED_PIPELINE: readonly string[] = ["fetch", "score", "persist"];

function fixedDate(): Date {
  return new Date("2026-05-20T00:00:00.000Z");
}

function topic(overrides: Partial<TrendingTopic> = {}): TrendingTopic {
  return {
    topic: "#AIArt",
    source: "perplexity-web",
    sourceUrl: null,
    platform: "TIKTOK",
    volume: 1000,
    category: null,
    trend: "rising",
    fetchedAt: fixedDate(),
    ...overrides,
  };
}

interface ScoreFixture {
  index: number;
  score: number;
  postIdea?: string | null;
  bestPlatform?: string | null;
  urgency?: "NOW" | "TODAY" | "THIS_WEEK";
}

function makeAI(scores: ScoreFixture[]): {
  ai: AIServicePort;
  generateStructured: ReturnType<typeof vi.fn>;
} {
  const generateStructured = vi.fn().mockResolvedValue(
    ok({
      scores: scores.map((s) => ({
        index: s.index,
        score: s.score,
        postIdea: s.postIdea ?? null,
        bestPlatform: s.bestPlatform ?? null,
        urgency: s.urgency ?? "THIS_WEEK",
      })),
    })
  );
  const ai: AIServicePort = {
    generateStructured,
    generateText: vi.fn(),
    generateContent: vi.fn(),
    analyzeContent: vi.fn(),
    optimizeContent: vi.fn(),
    predictPerformance: vi.fn(),
    generateVariations: vi.fn(),
  } as unknown as AIServicePort;
  return { ai, generateStructured };
}

function makeFetch(topics: TrendingTopic[]): {
  port: TrendingDataPort;
  fetchTrends: ReturnType<typeof vi.fn>;
} {
  const fetchTrends = vi.fn().mockResolvedValue(topics);
  return { port: { fetchTrends }, fetchTrends };
}

const contextPort: ScoreTrendContextPort = {
  getBrandVoice: vi.fn().mockResolvedValue("Friendly brand voice"),
  getPerformanceInsights: vi.fn().mockResolvedValue([]),
};

function makeResultPort(): {
  port: TrendRadarResultPort;
  upsert: ReturnType<typeof vi.fn>;
  captured: TrendRadarUpsertInput[];
} {
  const captured: TrendRadarUpsertInput[] = [];
  const upsert = vi.fn(async (input: TrendRadarUpsertInput): Promise<TrendRadarUpsertOutput> => {
    captured.push(input);
    return { persisted: input.trends.length, updated: 0 };
  });
  return { port: { upsert }, upsert, captured };
}

describe("trajectory eval — trends slice", () => {
  let cache: InMemoryCacheAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new InMemoryCacheAdapter();
  });

  it("walks the canonical fetch → score → persist sequence in order", async () => {
    const stageOrder: string[] = [];
    const fetchPort: TrendingDataPort = {
      fetchTrends: vi.fn(async () => {
        stageOrder.push("fetch");
        return [topic({ topic: "#A" })];
      }),
    };
    const { ai } = makeAI([{ index: 1, score: 8 }]);
    (ai.generateStructured as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      stageOrder.push("score");
      return ok({
        scores: [{ index: 1, score: 8, postIdea: null, bestPlatform: null, urgency: "TODAY" }],
      });
    });
    const result = makeResultPort();
    result.upsert.mockImplementationOnce(async (input) => {
      stageOrder.push("persist");
      return { persisted: input.trends.length, updated: 0 };
    });

    const fetchUseCase = new FetchTrendingTopicsUseCase(fetchPort, cache);
    const scoreUseCase = new ScoreTrendRelevanceUseCase(ai, trendScoringSpec, contextPort);
    const detect = new DetectTrendsUseCase(fetchUseCase, scoreUseCase, result.port);

    const out = await detect.execute({ accountId: "acc-1" });
    expect(out.ok).toBe(true);
    expect(stageOrder).toEqual(EXPECTED_PIPELINE);
  });

  it("keeps the number of AI invocations under the canonical budget", async () => {
    const { port: fetchPort } = makeFetch([
      topic({ topic: "#A" }),
      topic({ topic: "#B" }),
      topic({ topic: "#C" }),
    ]);
    const { ai, generateStructured } = makeAI([
      { index: 1, score: 7 },
      { index: 2, score: 8 },
      { index: 3, score: 9 },
    ]);
    const result = makeResultPort();

    const fetchUseCase = new FetchTrendingTopicsUseCase(fetchPort, cache);
    const scoreUseCase = new ScoreTrendRelevanceUseCase(ai, trendScoringSpec, contextPort);
    const detect = new DetectTrendsUseCase(fetchUseCase, scoreUseCase, result.port);

    await detect.execute({ accountId: "acc-1" });

    const invocations = generateStructured.mock.calls.length;
    expect(
      invocations,
      `trends AI-call cost regression: ${invocations} > ${MAX_TRENDS_AI_CALLS}`
    ).toBeLessThanOrEqual(MAX_TRENDS_AI_CALLS);
    expect(invocations).toBe(1);
  });

  it("enforces the relevance ≥ 6 policy at the score stage", async () => {
    const { port: fetchPort } = makeFetch([
      topic({ topic: "#Low" }),
      topic({ topic: "#Mid" }),
      topic({ topic: "#High" }),
    ]);
    const { ai } = makeAI([
      { index: 1, score: 4 }, // below threshold
      { index: 2, score: 6 }, // at threshold
      { index: 3, score: 9 }, // above threshold
    ]);
    const result = makeResultPort();

    const fetchUseCase = new FetchTrendingTopicsUseCase(fetchPort, cache);
    const scoreUseCase = new ScoreTrendRelevanceUseCase(ai, trendScoringSpec, contextPort);
    const detect = new DetectTrendsUseCase(fetchUseCase, scoreUseCase, result.port);

    const out = await detect.execute({ accountId: "acc-1" });

    expect(out.ok).toBe(true);
    if (out.ok) {
      // Two topics survive (6 + 9). The under-threshold one is dropped.
      expect(out.value.scored).toBe(2);
      // Persistence only sees what passed the threshold.
      const persistedTopics = result.captured[0]?.trends.map((t) => t.topic) ?? [];
      expect(persistedTopics).not.toContain("#Low");
      expect(persistedTopics).toContain("#Mid");
      expect(persistedTopics).toContain("#High");
    }
  });

  it("short-circuits the score and persist stages when fetch yields no topics", async () => {
    const { port: fetchPort } = makeFetch([]);
    const { ai, generateStructured } = makeAI([]);
    const result = makeResultPort();

    const fetchUseCase = new FetchTrendingTopicsUseCase(fetchPort, cache);
    const scoreUseCase = new ScoreTrendRelevanceUseCase(ai, trendScoringSpec, contextPort);
    const detect = new DetectTrendsUseCase(fetchUseCase, scoreUseCase, result.port);

    const out = await detect.execute({ accountId: "acc-empty" });

    expect(out.ok).toBe(true);
    expect(generateStructured.mock.calls.length).toBe(0);
    expect(result.upsert.mock.calls.length).toBe(0);
  });

  it("propagates the per-row provenance source through to persistence", async () => {
    const { port: fetchPort } = makeFetch([
      topic({ topic: "#A", source: "perplexity-web" }),
      topic({ topic: "#B", source: "account-analytics" }),
    ]);
    const { ai } = makeAI([
      { index: 1, score: 8 },
      { index: 2, score: 9 },
    ]);
    const result = makeResultPort();

    const fetchUseCase = new FetchTrendingTopicsUseCase(fetchPort, cache);
    const scoreUseCase = new ScoreTrendRelevanceUseCase(ai, trendScoringSpec, contextPort);
    const detect = new DetectTrendsUseCase(fetchUseCase, scoreUseCase, result.port);

    await detect.execute({ accountId: "acc-1" });

    const sources = result.captured[0]?.trends.map((t) => t.source).sort() ?? [];
    expect(sources).toEqual(["ACCOUNT_ANALYTICS", "PERPLEXITY_WEB"]);
  });
});
