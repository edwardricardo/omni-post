/**
 * @file TrendRadarQueryRepository.test.ts
 * @description Contract test for the trend-radar read port: validates the
 *              DTO field set (the wire shape downstream consumers like the
 *              client trends page depend on) and the port's method
 *              signature. Catches accidental DTO field drift before it
 *              reaches the API.
 * @layer infrastructure
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type {
  TrendRadarQueryRepository,
  TrendRadarQueryOptions,
  TrendRadarListResult,
  ScoredTrendDTO,
} from "@core/domain/repositories/TrendRadarQueryRepository.js";

const REQUIRED_DTO_FIELDS = [
  "topic",
  "platform",
  "source",
  "sourceUrl",
  "relevanceScore",
  "postIdea",
  "bestPlatform",
  "urgency",
  "volume",
  "fetchedAt",
] as const;

describe("ScoredTrendDTO contract", () => {
  it("exposes the full set of wire fields the client depends on", () => {
    const sample: ScoredTrendDTO = {
      topic: "#AIArt",
      platform: "TIKTOK",
      source: "PERPLEXITY_WEB",
      sourceUrl: null,
      relevanceScore: 9,
      postIdea: null,
      bestPlatform: null,
      urgency: "TODAY",
      volume: null,
      fetchedAt: "2026-05-20T00:00:00.000Z",
    };

    for (const field of REQUIRED_DTO_FIELDS) {
      assert.ok(field in sample, `ScoredTrendDTO must expose '${field}'`);
    }
  });

  it("accepts the three canonical urgency literals", () => {
    const urgencies: Array<ScoredTrendDTO["urgency"]> = ["NOW", "TODAY", "THIS_WEEK"];
    assert.deepStrictEqual(urgencies.sort(), ["NOW", "THIS_WEEK", "TODAY"]);
  });
});

describe("TrendRadarQueryRepository contract", () => {
  it("returns a `{ scored, total }` page from findByAccountId", async () => {
    const sample: TrendRadarListResult = {
      scored: [],
      total: 0,
    };
    const repo: TrendRadarQueryRepository = {
      findByAccountId: async (
        _accountId: string,
        _options: TrendRadarQueryOptions
      ): Promise<TrendRadarListResult> => sample,
    };

    const result = await repo.findByAccountId("acc-1", { limit: 20 });
    assert.deepStrictEqual(Object.keys(result).sort(), ["scored", "total"]);
  });

  it("takes a TrendRadarQueryOptions object with a mandatory `limit`", () => {
    const options: TrendRadarQueryOptions = { limit: 20 };
    assert.strictEqual(typeof options.limit, "number");
  });
});
