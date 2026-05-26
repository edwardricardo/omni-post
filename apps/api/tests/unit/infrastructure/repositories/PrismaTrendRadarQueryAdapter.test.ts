/**
 * @file PrismaTrendRadarQueryAdapter.test.ts
 * @description Unit tests for the Prisma read adapter: account-scoped
 *              listing with `expiresAt > now` filter, ordering by
 *              relevanceScore desc + fetchedAt desc, and Decimal→Number
 *              conversion on relevanceScore. Prisma is mocked at the
 *              `trendRadarResult` table boundary.
 * @layer infrastructure
 */
import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { PrismaTrendRadarQueryAdapter } from "../../../../src/infrastructure/repositories/PrismaTrendRadarQueryAdapter.js";
import type { PrismaClient } from "@infra/prisma";

interface FakeRow {
  topic: string;
  platform: string;
  source: string;
  sourceUrl: string | null;
  relevanceScore: number | { toString(): string };
  postIdea: string | null;
  bestPlatform: string | null;
  urgency: "NOW" | "TODAY" | "THIS_WEEK";
  volume: number | null;
  fetchedAt: Date;
}

function makePrisma(
  rows: FakeRow[],
  total = rows.length
): {
  prisma: PrismaClient;
  findMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn().mockResolvedValue(rows);
  const count = vi.fn().mockResolvedValue(total);
  const prisma = { trendRadarResult: { findMany, count } } as unknown as PrismaClient;
  return { prisma, findMany, count };
}

function row(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    topic: "#AIArt",
    platform: "TIKTOK",
    source: "PERPLEXITY_WEB",
    sourceUrl: null,
    relevanceScore: 9,
    postIdea: "Lean into AI",
    bestPlatform: "TIKTOK",
    urgency: "TODAY",
    volume: 1000,
    fetchedAt: new Date("2026-05-20T00:00:00.000Z"),
    ...overrides,
  };
}

describe("PrismaTrendRadarQueryAdapter", () => {
  it("scopes the query to the requested accountId", async () => {
    const { prisma, findMany, count } = makePrisma([]);
    const adapter = new PrismaTrendRadarQueryAdapter(prisma);

    await adapter.findByAccountId("acc-42", { limit: 10 });

    const findCall = findMany.mock.calls[0]?.[0] as { where: { accountId: string } };
    assert.strictEqual(findCall.where.accountId, "acc-42");
    const countCall = count.mock.calls[0]?.[0] as { where: { accountId: string } };
    assert.strictEqual(countCall.where.accountId, "acc-42");
  });

  it("filters out expired rows via expiresAt > now", async () => {
    const { prisma, findMany } = makePrisma([]);
    const adapter = new PrismaTrendRadarQueryAdapter(prisma);

    await adapter.findByAccountId("acc-1", { limit: 10 });

    const where = (findMany.mock.calls[0]?.[0] as { where: { expiresAt: { gt: Date } } }).where;
    assert.ok(where.expiresAt.gt instanceof Date);
    assert.ok(where.expiresAt.gt.getTime() > Date.now() - 5000);
  });

  it("orders by relevanceScore desc then fetchedAt desc", async () => {
    const { prisma, findMany } = makePrisma([]);
    const adapter = new PrismaTrendRadarQueryAdapter(prisma);

    await adapter.findByAccountId("acc-1", { limit: 10 });

    const orderBy = (findMany.mock.calls[0]?.[0] as { orderBy: unknown[] }).orderBy;
    assert.deepStrictEqual(orderBy, [{ relevanceScore: "desc" }, { fetchedAt: "desc" }]);
  });

  it("forwards limit to Prisma `take`", async () => {
    const { prisma, findMany } = makePrisma([]);
    const adapter = new PrismaTrendRadarQueryAdapter(prisma);

    await adapter.findByAccountId("acc-1", { limit: 35 });

    const take = (findMany.mock.calls[0]?.[0] as { take: number }).take;
    assert.strictEqual(take, 35);
  });

  it("maps rows to DTOs with Decimal→Number on relevanceScore and ISO on fetchedAt", async () => {
    const { prisma } = makePrisma([
      row({
        topic: "#A",
        relevanceScore: { toString: () => "8.5" },
        fetchedAt: new Date("2026-05-20T12:34:56.000Z"),
      }),
    ]);
    const adapter = new PrismaTrendRadarQueryAdapter(prisma);

    const result = await adapter.findByAccountId("acc-1", { limit: 10 });

    assert.strictEqual(result.scored[0]?.relevanceScore, 8.5);
    assert.strictEqual(result.scored[0]?.fetchedAt, "2026-05-20T12:34:56.000Z");
  });

  it("returns the total count alongside the page", async () => {
    const { prisma } = makePrisma([row(), row({ topic: "#B" })], 47);
    const adapter = new PrismaTrendRadarQueryAdapter(prisma);

    const result = await adapter.findByAccountId("acc-1", { limit: 10 });

    assert.strictEqual(result.scored.length, 2);
    assert.strictEqual(result.total, 47);
  });

  it("returns an empty page when the account has no rows", async () => {
    const { prisma } = makePrisma([], 0);
    const adapter = new PrismaTrendRadarQueryAdapter(prisma);

    const result = await adapter.findByAccountId("acc-1", { limit: 10 });

    assert.deepStrictEqual(result, { scored: [], total: 0 });
  });
});
