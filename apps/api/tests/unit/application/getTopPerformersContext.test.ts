/**
 * @file getTopPerformersContext.test.ts
 * @description Unit tests for GetTopPerformersContextUseCase.
 * @layer test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { GetTopPerformersContextUseCase } from "../../../src/application/ai/GetTopPerformersContextUseCase.js";

function makeMockQueryPort(
  rows: Array<{
    postBody: string;
    platform: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    publishedAt: Date;
  }> = []
) {
  return {
    findTopPerformers: vi.fn().mockResolvedValue(rows),
  };
}

const samplePosts = [
  {
    postBody: "Our best post ever",
    platform: "INSTAGRAM",
    views: 1000,
    likes: 80,
    comments: 20,
    shares: 10,
    publishedAt: new Date("2026-03-10"),
  },
  {
    postBody: "Another great post",
    platform: "X",
    views: 500,
    likes: 50,
    comments: 15,
    shares: 5,
    publishedAt: new Date("2026-03-12"),
  },
  {
    postBody: "Decent performer",
    platform: "INSTAGRAM",
    views: 800,
    likes: 40,
    comments: 10,
    shares: 5,
    publishedAt: new Date("2026-03-15"),
  },
  {
    postBody: "Average post",
    platform: "LINKEDIN",
    views: 300,
    likes: 15,
    comments: 5,
    shares: 3,
    publishedAt: new Date("2026-03-18"),
  },
  {
    postBody: "Low performer",
    platform: "X",
    views: 200,
    likes: 5,
    comments: 1,
    shares: 0,
    publishedAt: new Date("2026-03-20"),
  },
];

describe("GetTopPerformersContextUseCase", () => {
  let queryPort: ReturnType<typeof makeMockQueryPort>;
  let useCase: GetTopPerformersContextUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    queryPort = makeMockQueryPort(samplePosts);
    useCase = new GetTopPerformersContextUseCase(queryPort);
  });

  it("returns top posts sorted by engagement rate", async () => {
    const result = await useCase.execute({ accountId: "acc-1", limit: 3 });

    assert.ok(result.ok);
    assert.strictEqual(result.value.posts.length, 3);
    const rates = result.value.posts.map((p) => p.engagementRate);
    for (let i = 0; i < rates.length - 1; i++) {
      assert.ok((rates[i] ?? 0) >= (rates[i + 1] ?? 0), "Should be sorted descending");
    }
  });

  it("calculates account average engagement", async () => {
    const result = await useCase.execute({ accountId: "acc-1" });

    assert.ok(result.ok);
    assert.ok(result.value.accountAvgEngagement > 0);
  });

  it("identifies top performing platform", async () => {
    const result = await useCase.execute({ accountId: "acc-1" });

    assert.ok(result.ok);
    assert.ok(result.value.topPerformingPlatform);
  });

  it("generates insights from patterns", async () => {
    queryPort = makeMockQueryPort([
      ...samplePosts,
      {
        postBody: "Extra post",
        platform: "INSTAGRAM",
        views: 600,
        likes: 60,
        comments: 10,
        shares: 5,
        publishedAt: new Date("2026-03-11"),
      },
    ]);
    useCase = new GetTopPerformersContextUseCase(queryPort);

    const result = await useCase.execute({ accountId: "acc-1" });

    assert.ok(result.ok);
    assert.ok(result.value.insights.length > 0);
  });

  it("returns empty context when no analytics data", async () => {
    queryPort = makeMockQueryPort([]);
    useCase = new GetTopPerformersContextUseCase(queryPort);

    const result = await useCase.execute({ accountId: "acc-empty-test" });

    assert.ok(result.ok);
    assert.deepStrictEqual(result.value.posts, []);
    assert.strictEqual(result.value.accountAvgEngagement, 0);
    assert.strictEqual(result.value.topPerformingPlatform, null);
  });

  it("filters by platform when specified", async () => {
    await useCase.execute({ accountId: "acc-1", platform: "INSTAGRAM" });

    const call = queryPort.findTopPerformers.mock.calls[0]?.[0] as { platform?: string };
    assert.ok(call);
    assert.strictEqual(call.platform, "INSTAGRAM");
  });

  it("caches results for subsequent calls", async () => {
    await useCase.execute({ accountId: "acc-cache-test" });
    await useCase.execute({ accountId: "acc-cache-test" });

    expect(queryPort.findTopPerformers).toHaveBeenCalledOnce();
  });
});
