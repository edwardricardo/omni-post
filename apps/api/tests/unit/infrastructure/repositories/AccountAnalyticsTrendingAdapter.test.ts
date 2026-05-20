/**
 * @file AccountAnalyticsTrendingAdapter.test.ts
 * @description Unit tests for the account-analytics trending source:
 *              identifies hashtags from the account's own posted content
 *              (last 30 days), aggregates engagement from
 *              `AnalyticsDailySummary`, ranks by engagement (then volume),
 *              and tags results with source `account-analytics`. Prisma is
 *              mocked at the `post.findMany` boundary.
 * @layer infrastructure
 */
import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { AccountAnalyticsTrendingAdapter } from "../../../../src/infrastructure/repositories/AccountAnalyticsTrendingAdapter.js";
import type { PrismaClient } from "@infra/prisma";

interface FakePost {
  contents: Array<{ tags: string[] }>;
  analyticsDailySummaries: Array<{
    likes: number;
    comments: number;
    shares: number;
    views: number;
    provider: string;
  }>;
}

function makePrisma(posts: FakePost[]): {
  prisma: PrismaClient;
  findMany: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn().mockResolvedValue(posts);
  const prisma = { post: { findMany } } as unknown as PrismaClient;
  return { prisma, findMany };
}

describe("AccountAnalyticsTrendingAdapter", () => {
  it("returns an empty list when sources filter excludes account-analytics", async () => {
    const { prisma, findMany } = makePrisma([]);
    const adapter = new AccountAnalyticsTrendingAdapter(prisma);

    const topics = await adapter.fetchTrends({
      accountId: "acc-1",
      sources: ["perplexity-web", "inbox-mentions"],
    });

    assert.deepStrictEqual(topics, []);
    assert.strictEqual(findMany.mock.calls.length, 0);
  });

  it("extracts hashtags from PostContent.tags and aggregates engagement per tag", async () => {
    const { prisma } = makePrisma([
      {
        contents: [{ tags: ["#ai", "#art"] }],
        analyticsDailySummaries: [
          { likes: 10, comments: 2, shares: 1, views: 100, provider: "TIKTOK" },
        ],
      },
      {
        contents: [{ tags: ["#ai"] }],
        analyticsDailySummaries: [
          { likes: 20, comments: 5, shares: 3, views: 300, provider: "TIKTOK" },
        ],
      },
    ]);
    const adapter = new AccountAnalyticsTrendingAdapter(prisma);

    const topics = await adapter.fetchTrends({ accountId: "acc-1" });

    const byTopic = new Map(topics.map((t) => [t.topic, t]));
    assert.strictEqual(byTopic.get("#ai")?.volume, 2);
    assert.strictEqual(byTopic.get("#art")?.volume, 1);
  });

  it("ranks results by engagement descending (then by volume as tiebreaker)", async () => {
    const { prisma } = makePrisma([
      {
        contents: [{ tags: ["#low"] }],
        analyticsDailySummaries: [{ likes: 1, comments: 0, shares: 0, views: 10, provider: "X" }],
      },
      {
        contents: [{ tags: ["#high"] }],
        analyticsDailySummaries: [
          { likes: 100, comments: 50, shares: 25, views: 1000, provider: "X" },
        ],
      },
    ]);
    const adapter = new AccountAnalyticsTrendingAdapter(prisma);

    const topics = await adapter.fetchTrends({ accountId: "acc-1" });

    assert.strictEqual(topics[0]?.topic, "#high");
    assert.strictEqual(topics[1]?.topic, "#low");
  });

  it("tags every returned topic with source account-analytics", async () => {
    const { prisma } = makePrisma([
      {
        contents: [{ tags: ["#brand"] }],
        analyticsDailySummaries: [
          { likes: 5, comments: 0, shares: 0, views: 50, provider: "INSTAGRAM" },
        ],
      },
    ]);
    const adapter = new AccountAnalyticsTrendingAdapter(prisma);

    const topics = await adapter.fetchTrends({ accountId: "acc-1" });

    assert.strictEqual(topics[0]?.source, "account-analytics");
    assert.strictEqual(topics[0]?.platform, "INSTAGRAM");
  });

  it("marks tags with volume >= 3 as rising and the rest as stable", async () => {
    const { prisma } = makePrisma([
      {
        contents: [{ tags: ["#hot"] }],
        analyticsDailySummaries: [{ likes: 1, comments: 0, shares: 0, views: 1, provider: "X" }],
      },
      {
        contents: [{ tags: ["#hot"] }],
        analyticsDailySummaries: [{ likes: 1, comments: 0, shares: 0, views: 1, provider: "X" }],
      },
      {
        contents: [{ tags: ["#hot"] }],
        analyticsDailySummaries: [{ likes: 1, comments: 0, shares: 0, views: 1, provider: "X" }],
      },
      {
        contents: [{ tags: ["#cool"] }],
        analyticsDailySummaries: [{ likes: 1, comments: 0, shares: 0, views: 1, provider: "X" }],
      },
    ]);
    const adapter = new AccountAnalyticsTrendingAdapter(prisma);

    const topics = await adapter.fetchTrends({ accountId: "acc-1" });
    const byTopic = new Map(topics.map((t) => [t.topic, t]));

    assert.strictEqual(byTopic.get("#hot")?.trend, "rising");
    assert.strictEqual(byTopic.get("#cool")?.trend, "stable");
  });

  it("returns an empty list when the account has no recent posts", async () => {
    const { prisma } = makePrisma([]);
    const adapter = new AccountAnalyticsTrendingAdapter(prisma);

    const topics = await adapter.fetchTrends({ accountId: "acc-1" });

    assert.deepStrictEqual(topics, []);
  });
});
