/**
 * @file GetTrendRadarQuery.test.ts
 * @description Unit tests for the trend-radar read-side query: clamps the
 *              optional limit to [1, 50] with default 20, propagates port
 *              failures as a UseCaseError, and forwards the account-scoped
 *              listing unchanged. The port is mocked at the function
 *              boundary.
 * @layer infrastructure
 */
import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { GetTrendRadarQuery } from "../../../../src/application/trends/GetTrendRadarQuery.js";
import type {
  TrendRadarQueryRepository,
  ScoredTrendDTO,
} from "../../../../src/domain/repositories/TrendRadarQueryRepository.js";

function dto(overrides: Partial<ScoredTrendDTO> = {}): ScoredTrendDTO {
  return {
    topic: "#AIArt",
    platform: "TIKTOK",
    source: "PERPLEXITY_WEB",
    sourceUrl: null,
    relevanceScore: 9,
    postIdea: "Ride the AI art wave",
    bestPlatform: "TIKTOK",
    urgency: "TODAY",
    volume: 100,
    fetchedAt: "2026-05-20T00:00:00.000Z",
    ...overrides,
  };
}

function makeRepo(result: { scored: ScoredTrendDTO[]; total: number } | Error): {
  repo: TrendRadarQueryRepository;
  findByAccountId: ReturnType<typeof vi.fn>;
} {
  const findByAccountId = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const repo: TrendRadarQueryRepository = { findByAccountId };
  return { repo, findByAccountId };
}

describe("GetTrendRadarQuery", () => {
  it("returns the listing as-is from the port", async () => {
    const { repo } = makeRepo({ scored: [dto({ topic: "#A" }), dto({ topic: "#B" })], total: 2 });
    const query = new GetTrendRadarQuery(repo);

    const result = await query.execute({ accountId: "acc-1" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.total, 2);
    assert.strictEqual(result.value.scored.length, 2);
  });

  it("uses the default limit of 20 when none is provided", async () => {
    const { repo, findByAccountId } = makeRepo({ scored: [], total: 0 });
    const query = new GetTrendRadarQuery(repo);

    await query.execute({ accountId: "acc-1" });

    assert.deepStrictEqual(findByAccountId.mock.calls[0], ["acc-1", { limit: 20 }]);
  });

  it("clamps an over-large limit to 50", async () => {
    const { repo, findByAccountId } = makeRepo({ scored: [], total: 0 });
    const query = new GetTrendRadarQuery(repo);

    await query.execute({ accountId: "acc-1", limit: 9999 });

    assert.deepStrictEqual(findByAccountId.mock.calls[0], ["acc-1", { limit: 50 }]);
  });

  it("clamps an under-1 limit to 1", async () => {
    const { repo, findByAccountId } = makeRepo({ scored: [], total: 0 });
    const query = new GetTrendRadarQuery(repo);

    await query.execute({ accountId: "acc-1", limit: 0 });

    assert.deepStrictEqual(findByAccountId.mock.calls[0], ["acc-1", { limit: 1 }]);
  });

  it("returns a UseCaseError when the port throws", async () => {
    const { repo } = makeRepo(new Error("db offline"));
    const query = new GetTrendRadarQuery(repo);

    const result = await query.execute({ accountId: "acc-1" });

    assert.ok(!result.ok);
    assert.match(result.error.message, /Failed to fetch trend radar/);
  });
});
