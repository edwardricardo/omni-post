/**
 * @file TrendRadarQueryRepository.test.ts
 * @description Contract test for the trend-radar read port: the three
 *              urgency literals a ScoredTrendDTO accepts (the wire shape
 *              downstream consumers like the client trends page depend on)
 *              and the `{ scored, total }` page findByAccountId returns,
 *              both written as typed literals the compiler checks.
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

describe("ScoredTrendDTO contract", () => {
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
});
