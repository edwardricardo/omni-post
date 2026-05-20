/**
 * @file detectTrends.test.ts
 * @description Unit tests for the trend-radar orchestrator: full
 *              fetch→score→persist pipeline against deterministic mock
 *              ports. Asserts source-tag → enum mapping, platform
 *              normalisation, idempotent upsert delegation, and graceful
 *              handling of empty fetch / empty score / unknown platforms.
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { ok } from "@shared/types";
import { DetectTrendsUseCase } from "../../../../src/application/trends/DetectTrendsUseCase.js";
import type {
  FetchTrendingTopicsUseCase,
  TrendingTopic,
} from "../../../../src/application/trends/FetchTrendingTopicsUseCase.js";
import type {
  ScoreTrendRelevanceUseCase,
  ScoredTrend,
} from "../../../../src/application/trends/ScoreTrendRelevanceUseCase.js";
import type {
  TrendRadarResultPort,
  TrendRadarUpsertInput,
} from "../../../../src/application/trends/TrendRadarResultPort.js";

function makeFetch(topics: TrendingTopic[]): FetchTrendingTopicsUseCase {
  return {
    execute: vi.fn(async () => ok({ topics, cachedUntil: new Date() })),
  } as unknown as FetchTrendingTopicsUseCase;
}

function makeScore(scored: ScoredTrend[]): ScoreTrendRelevanceUseCase {
  return {
    execute: vi.fn(async () => ok({ scored })),
  } as unknown as ScoreTrendRelevanceUseCase;
}

function makeResultPort(): {
  port: TrendRadarResultPort;
  calls: TrendRadarUpsertInput[];
} {
  const calls: TrendRadarUpsertInput[] = [];
  const port: TrendRadarResultPort = {
    upsert: vi.fn(async (input) => {
      calls.push(input);
      return { persisted: input.trends.length, updated: 0 };
    }),
  };
  return { port, calls };
}

const fixedDate = new Date("2026-05-20T00:00:00.000Z");

function topic(overrides: Partial<TrendingTopic> = {}): TrendingTopic {
  return {
    topic: "#AIArt",
    source: "perplexity-web",
    sourceUrl: null,
    platform: "TIKTOK",
    volume: 100,
    category: null,
    trend: "rising",
    fetchedAt: fixedDate,
    ...overrides,
  };
}

function scored(overrides: Partial<ScoredTrend> = {}): ScoredTrend {
  return {
    topic: "#AIArt",
    platform: "TIKTOK",
    source: "perplexity-web",
    sourceUrl: null,
    relevanceScore: 8,
    postIdea: "Ride the AI art wave",
    bestPlatform: "TIKTOK",
    urgency: "TODAY",
    volume: 100,
    ...overrides,
  };
}

describe("DetectTrendsUseCase", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs fetch→score→persist and returns aggregate counts on success", async () => {
    const fetch = makeFetch([topic({ topic: "#AIArt" }), topic({ topic: "#SpringFashion" })]);
    const score = makeScore([
      scored({ topic: "#AIArt", relevanceScore: 9 }),
      scored({ topic: "#SpringFashion", relevanceScore: 7 }),
    ]);
    const { port, calls } = makeResultPort();

    const uc = new DetectTrendsUseCase(fetch, score, port);
    const result = await uc.execute({ accountId: "acc-1" });

    assert.ok(result.ok);
    assert.deepStrictEqual(result.value, {
      fetched: 2,
      scored: 2,
      persisted: 2,
      updated: 0,
    });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0]?.accountId, "acc-1");
    assert.strictEqual(calls[0]?.trends.length, 2);
  });

  it("maps source-tag (kebab) to Prisma enum (SCREAMING_SNAKE) per row", async () => {
    const fetch = makeFetch([topic()]);
    const score = makeScore([
      scored({ source: "perplexity-web" }),
      scored({ topic: "#OwnTag", source: "account-analytics" }),
      scored({ topic: "@inboundMention", source: "inbox-mentions" }),
    ]);
    const { port, calls } = makeResultPort();

    const uc = new DetectTrendsUseCase(fetch, score, port);
    await uc.execute({ accountId: "acc-1" });

    const sources = calls[0]?.trends.map((r) => r.source).sort();
    assert.deepStrictEqual(sources, ["ACCOUNT_ANALYTICS", "INBOX_MENTIONS", "PERPLEXITY_WEB"]);
  });

  it("normalises platform strings to the Prisma Provider enum and drops unknown platforms", async () => {
    const fetch = makeFetch([topic()]);
    const score = makeScore([
      scored({ topic: "#Known", platform: "tiktok", bestPlatform: null }),
      scored({ topic: "#Unknown", platform: "MYSPACE", bestPlatform: null }),
    ]);
    const { port, calls } = makeResultPort();

    const uc = new DetectTrendsUseCase(fetch, score, port);
    const result = await uc.execute({ accountId: "acc-1" });

    assert.ok(result.ok);
    assert.strictEqual(calls[0]?.trends.length, 1);
    assert.strictEqual(calls[0]?.trends[0]?.topic, "#Known");
    assert.strictEqual(calls[0]?.trends[0]?.platform, "TIKTOK");
  });

  it("falls back to bestPlatform when platform is unknown", async () => {
    const fetch = makeFetch([topic()]);
    const score = makeScore([
      scored({ topic: "#FallbackPick", platform: "MYSPACE", bestPlatform: "INSTAGRAM" }),
    ]);
    const { port, calls } = makeResultPort();

    const uc = new DetectTrendsUseCase(fetch, score, port);
    await uc.execute({ accountId: "acc-1" });

    assert.strictEqual(calls[0]?.trends[0]?.platform, "INSTAGRAM");
    assert.strictEqual(calls[0]?.trends[0]?.bestPlatform, "INSTAGRAM");
  });

  it("returns zero counts and skips persistence when fetch yields no topics", async () => {
    const fetch = makeFetch([]);
    const score = makeScore([]);
    const { port } = makeResultPort();

    const uc = new DetectTrendsUseCase(fetch, score, port);
    const result = await uc.execute({ accountId: "acc-empty" });

    assert.ok(result.ok);
    assert.deepStrictEqual(result.value, { fetched: 0, scored: 0, persisted: 0, updated: 0 });
    assert.strictEqual(vi.mocked(score.execute).mock.calls.length, 0);
    assert.strictEqual(vi.mocked(port.upsert).mock.calls.length, 0);
  });

  it("returns fetched count but skips persistence when scoring yields no rows", async () => {
    const fetch = makeFetch([topic()]);
    const score = makeScore([]);
    const { port } = makeResultPort();

    const uc = new DetectTrendsUseCase(fetch, score, port);
    const result = await uc.execute({ accountId: "acc-1" });

    assert.ok(result.ok);
    assert.deepStrictEqual(result.value, { fetched: 1, scored: 0, persisted: 0, updated: 0 });
    assert.strictEqual(vi.mocked(port.upsert).mock.calls.length, 0);
  });

  it("runs inside the unit of work when one is provided", async () => {
    const fetch = makeFetch([topic()]);
    const score = makeScore([scored()]);
    const { port } = makeResultPort();
    let txUsed = false;
    const uow = {
      executeInTransaction: async (fn: () => Promise<void>) => {
        txUsed = true;
        await fn();
      },
    };

    const uc = new DetectTrendsUseCase(fetch, score, port, uow as never);
    const result = await uc.execute({ accountId: "acc-1" });

    assert.ok(result.ok);
    assert.strictEqual(txUsed, true);
  });
});
