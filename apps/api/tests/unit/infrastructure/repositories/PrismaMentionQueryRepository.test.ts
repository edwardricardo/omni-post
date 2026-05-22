/**
 * @file PrismaMentionQueryRepository.test.ts
 * @description Unit tests for PrismaMentionQueryRepository — verifies the SoV
 *   where-clauses (brand = webhook OR BRAND term; market = MARKET term), the
 *   sov math (incl. divide-by-zero), the per-provider groupBy merge, the
 *   sentiment breakdown, and the cursor-paginated feed mapping. Prisma mocked.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { PrismaMentionQueryRepository } from "../../../../src/infrastructure/repositories/PrismaMentionQueryRepository.js";
import type { PrismaClient } from "@infra/prisma";

function makeMockPrisma() {
  const count = vi.fn();
  const groupBy = vi.fn();
  const findMany = vi.fn();
  const prisma = { mention: { count, groupBy, findMany } } as unknown as PrismaClient;
  return { prisma, count, groupBy, findMany };
}

const SINCE = new Date("2026-04-01T00:00:00Z");
const UNTIL = new Date("2026-05-01T00:00:00Z");

describe("PrismaMentionQueryRepository.getShareOfVoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("computes counts, sov, per-provider and per-sentiment breakdowns", async () => {
    const { prisma, count, groupBy } = makeMockPrisma();
    // Promise.all order: count(base), count(brand), count(market)
    count.mockResolvedValueOnce(12).mockResolvedValueOnce(8).mockResolvedValueOnce(4);
    // then groupBy: total / brand / market (by provider), then bySentiment
    groupBy
      .mockResolvedValueOnce([
        { provider: "X", _count: { _all: 7 } },
        { provider: "INSTAGRAM", _count: { _all: 5 } },
      ])
      .mockResolvedValueOnce([
        { provider: "X", _count: { _all: 5 } },
        { provider: "INSTAGRAM", _count: { _all: 3 } },
      ])
      .mockResolvedValueOnce([{ provider: "X", _count: { _all: 2 } }])
      .mockResolvedValueOnce([{ sentimentLabel: null, _count: { _all: 12 } }]);

    const repo = new PrismaMentionQueryRepository(prisma);
    const dto = await repo.getShareOfVoice({
      accountId: "acc-1",
      projectId: "proj-1",
      since: SINCE,
      until: UNTIL,
    });

    assert.strictEqual(dto.totalCount, 12);
    assert.strictEqual(dto.brandCount, 8);
    assert.strictEqual(dto.marketCount, 4);
    assert.strictEqual(dto.sov, 2); // 8 / 4

    const x = dto.byProvider.find((p) => p.provider === "X");
    const ig = dto.byProvider.find((p) => p.provider === "INSTAGRAM");
    assert.deepStrictEqual(x, {
      provider: "X",
      brandCount: 5,
      marketCount: 2,
      totalCount: 7,
      sov: 2.5,
    });
    // INSTAGRAM has 0 market → sov 0 (divide-by-zero guard)
    assert.deepStrictEqual(ig, {
      provider: "INSTAGRAM",
      brandCount: 3,
      marketCount: 0,
      totalCount: 5,
      sov: 0,
    });

    assert.deepStrictEqual(dto.bySentiment, { positive: 0, neutral: 0, negative: 0, unscored: 12 });
  });

  it("uses brand = (webhook OR BRAND term) and market = MARKET term where-clauses", async () => {
    const { prisma, count, groupBy } = makeMockPrisma();
    count.mockResolvedValue(0);
    groupBy.mockResolvedValue([]);
    const repo = new PrismaMentionQueryRepository(prisma);

    await repo.getShareOfVoice({
      accountId: "acc-1",
      projectId: "proj-1",
      since: SINCE,
      until: UNTIL,
    });

    const baseWhere = (count.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
    const brandWhere = (count.mock.calls[1]?.[0] as { where: Record<string, unknown> }).where;
    const marketWhere = (count.mock.calls[2]?.[0] as { where: Record<string, unknown> }).where;

    assert.deepStrictEqual(baseWhere.providerCreatedAt, { gte: SINCE, lt: UNTIL });
    assert.strictEqual(baseWhere.accountId, "acc-1");
    assert.deepStrictEqual(brandWhere.OR, [
      { source: "WEBHOOK" },
      { trackedTerm: { kind: "BRAND" } },
    ]);
    assert.deepStrictEqual(marketWhere.trackedTerm, { kind: "MARKET" });
  });

  it("returns sov 0 when there are no market mentions", async () => {
    const { prisma, count, groupBy } = makeMockPrisma();
    count.mockResolvedValueOnce(5).mockResolvedValueOnce(5).mockResolvedValueOnce(0);
    groupBy.mockResolvedValue([]);
    const repo = new PrismaMentionQueryRepository(prisma);

    const dto = await repo.getShareOfVoice({
      accountId: "acc-1",
      projectId: "proj-1",
      since: SINCE,
      until: UNTIL,
    });

    assert.strictEqual(dto.sov, 0);
  });
});

describe("PrismaMentionQueryRepository.listMentions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function row(overrides: Record<string, unknown> = {}) {
    return {
      id: "m-1",
      accountId: "acc-1",
      projectId: "proj-1",
      provider: "X",
      externalId: "ext-1",
      source: "SEARCH",
      trackedTermId: "t-1",
      channelId: null,
      authorName: "Fan",
      authorHandle: "fan",
      authorAvatarUrl: null,
      authorProviderId: "u-1",
      url: "https://x.com/i/web/status/ext-1",
      body: "loving acme",
      lang: "en",
      mediaUrls: [],
      sentimentScore: 0.8,
      sentimentLabel: "POSITIVE",
      providerCreatedAt: new Date("2026-04-10T00:00:00Z"),
      ingestedAt: new Date("2026-04-10T01:00:00Z"),
      createdAt: new Date("2026-04-10T01:00:00Z"),
      updatedAt: new Date("2026-04-10T01:00:00Z"),
      trackedTerm: { kind: "BRAND" },
      ...overrides,
    };
  }

  it("maps rows to MentionDTO (trackedTermKind from join, numeric sentimentScore)", async () => {
    const { prisma, findMany } = makeMockPrisma();
    findMany.mockResolvedValue([row()]);
    const repo = new PrismaMentionQueryRepository(prisma);

    const page = await repo.listMentions({ accountId: "acc-1" }, { limit: 20 });

    assert.strictEqual(page.items.length, 1);
    const dto = page.items[0];
    assert.ok(dto);
    assert.strictEqual(dto.trackedTermKind, "BRAND");
    assert.strictEqual(dto.sentimentScore, 0.8);
    assert.strictEqual(typeof dto.sentimentScore, "number");
    assert.strictEqual(page.hasMore, false);
    assert.strictEqual(page.nextCursor, null);
  });

  it("signals hasMore + nextCursor when more than `limit` rows return", async () => {
    const { prisma, findMany } = makeMockPrisma();
    findMany.mockResolvedValue([
      row({ id: "m-1" }),
      row({ id: "m-2", providerCreatedAt: new Date("2026-04-09T00:00:00Z") }),
    ]);
    const repo = new PrismaMentionQueryRepository(prisma);

    const page = await repo.listMentions({ accountId: "acc-1" }, { limit: 1 });

    assert.strictEqual(page.items.length, 1);
    assert.strictEqual(page.hasMore, true);
    assert.ok(page.nextCursor?.endsWith("_m-1"));
    // take = limit + 1
    assert.strictEqual((findMany.mock.calls[0]?.[0] as { take: number }).take, 2);
  });

  it("builds the where-clause from provider/kind/sentiment/date filters", async () => {
    const { prisma, findMany } = makeMockPrisma();
    findMany.mockResolvedValue([]);
    const repo = new PrismaMentionQueryRepository(prisma);

    await repo.listMentions(
      {
        accountId: "acc-1",
        projectId: "proj-1",
        provider: "X",
        kind: "MARKET",
        sentiment: "NEGATIVE",
        since: SINCE,
        until: UNTIL,
      },
      { limit: 20 }
    );

    const where = (findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
    assert.strictEqual(where.accountId, "acc-1");
    assert.strictEqual(where.projectId, "proj-1");
    assert.strictEqual(where.provider, "X");
    assert.deepStrictEqual(where.trackedTerm, { kind: "MARKET" });
    assert.strictEqual(where.sentimentLabel, "NEGATIVE");
    assert.deepStrictEqual(where.providerCreatedAt, { gte: SINCE, lt: UNTIL });
  });
});
