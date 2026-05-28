/**
 * @file PrismaTrendRadarResultAdapter.test.ts
 * @description Unit tests for the trend-radar persistence adapter:
 *              day-bucketed idempotent upsert (lookup by accountId/topic +
 *              fetchedAt within the calendar day, then update OR insert),
 *              30-day retention window via `expiresAt`, accurate
 *              persisted/updated counts. Prisma is mocked at the
 *              `trendRadarResult` table boundary.
 * @layer infrastructure
 */
import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { PrismaTrendRadarResultAdapter } from "../../../../src/infrastructure/repositories/PrismaTrendRadarResultAdapter.js";
import type { PrismaClient } from "@infra/prisma";
import type { TrendRadarRow, TrendRadarUpsertInput } from "@core/trends/TrendRadarResultPort.js";

function makePrisma(opts: { existing?: ReadonlyArray<{ id: string } | null> }): {
  prisma: PrismaClient;
  calls: {
    findFirst: Array<Record<string, unknown>>;
    update: Array<Record<string, unknown>>;
    create: Array<Record<string, unknown>>;
  };
} {
  const calls = {
    findFirst: [] as Array<Record<string, unknown>>,
    update: [] as Array<Record<string, unknown>>,
    create: [] as Array<Record<string, unknown>>,
  };
  const existing = opts.existing ?? [];
  let findCallIndex = 0;

  const prisma = {
    trendRadarResult: {
      findFirst: vi.fn(async (args: Record<string, unknown>) => {
        calls.findFirst.push(args);
        const next = existing[findCallIndex] ?? null;
        findCallIndex++;
        return next;
      }),
      update: vi.fn(async (args: Record<string, unknown>) => {
        calls.update.push(args);
        return {};
      }),
      create: vi.fn(async (args: Record<string, unknown>) => {
        calls.create.push(args);
        return {};
      }),
    },
  } as unknown as PrismaClient;

  return { prisma, calls };
}

function row(overrides: Partial<TrendRadarRow> = {}): TrendRadarRow {
  return {
    topic: "#AIArt",
    platform: "TIKTOK",
    source: "PERPLEXITY_WEB",
    sourceUrl: null,
    relevanceScore: 9,
    postIdea: "Lean into the AI art trend",
    bestPlatform: "TIKTOK",
    urgency: "TODAY",
    volume: 100,
    ...overrides,
  };
}

const fetchedAt = new Date("2026-05-20T12:00:00.000Z");

function makeInput(trends: TrendRadarRow[]): TrendRadarUpsertInput {
  return { accountId: "acc-1", fetchedAt, trends };
}

describe("PrismaTrendRadarResultAdapter", () => {
  it("creates one row per trend when nothing exists for the day", async () => {
    const { prisma, calls } = makePrisma({ existing: [null, null] });
    const adapter = new PrismaTrendRadarResultAdapter(prisma);

    const result = await adapter.upsert(makeInput([row({ topic: "#A" }), row({ topic: "#B" })]));

    assert.deepStrictEqual(result, { persisted: 2, updated: 0 });
    assert.strictEqual(calls.create.length, 2);
    assert.strictEqual(calls.update.length, 0);
  });

  it("updates an existing same-day row instead of creating a duplicate", async () => {
    const { prisma, calls } = makePrisma({ existing: [{ id: "trend-1" }] });
    const adapter = new PrismaTrendRadarResultAdapter(prisma);

    const result = await adapter.upsert(makeInput([row({ topic: "#A", relevanceScore: 8 })]));

    assert.deepStrictEqual(result, { persisted: 0, updated: 1 });
    assert.strictEqual(calls.update.length, 1);
    assert.strictEqual(calls.create.length, 0);
    const updateData = (calls.update[0] as { data: { relevanceScore: number } }).data;
    assert.strictEqual(updateData.relevanceScore, 8);
  });

  it("bucket-scopes the lookup to the calendar day of fetchedAt", async () => {
    const { prisma, calls } = makePrisma({ existing: [null] });
    const adapter = new PrismaTrendRadarResultAdapter(prisma);

    await adapter.upsert(makeInput([row()]));

    const where = (calls.findFirst[0] as { where: { fetchedAt: { gte: Date; lt: Date } } }).where;
    assert.strictEqual(where.fetchedAt.gte.toISOString(), "2026-05-20T00:00:00.000Z");
    assert.strictEqual(where.fetchedAt.lt.toISOString(), "2026-05-21T00:00:00.000Z");
  });

  it("sets expiresAt to fetchedAt + 30 days on every write", async () => {
    const { prisma, calls } = makePrisma({ existing: [null] });
    const adapter = new PrismaTrendRadarResultAdapter(prisma);

    await adapter.upsert(makeInput([row()]));

    const data = (calls.create[0] as { data: { expiresAt: Date } }).data;
    const expected = new Date(fetchedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    assert.strictEqual(data.expiresAt.toISOString(), expected.toISOString());
  });

  it("persists provenance (source + sourceUrl) on the row", async () => {
    const { prisma, calls } = makePrisma({ existing: [null] });
    const adapter = new PrismaTrendRadarResultAdapter(prisma);

    await adapter.upsert(
      makeInput([row({ source: "ACCOUNT_ANALYTICS", sourceUrl: "https://ex.example/a" })])
    );

    const data = (calls.create[0] as { data: { source: string; sourceUrl: string | null } }).data;
    assert.strictEqual(data.source, "ACCOUNT_ANALYTICS");
    assert.strictEqual(data.sourceUrl, "https://ex.example/a");
  });

  it("mixes create and update counts when some trends already exist for the day", async () => {
    const { prisma } = makePrisma({ existing: [{ id: "trend-1" }, null, { id: "trend-3" }] });
    const adapter = new PrismaTrendRadarResultAdapter(prisma);

    const result = await adapter.upsert(
      makeInput([row({ topic: "#A" }), row({ topic: "#B" }), row({ topic: "#C" })])
    );

    assert.deepStrictEqual(result, { persisted: 1, updated: 2 });
  });

  it("returns zero counts when there are no trends to persist", async () => {
    const { prisma } = makePrisma({});
    const adapter = new PrismaTrendRadarResultAdapter(prisma);

    const result = await adapter.upsert(makeInput([]));

    assert.deepStrictEqual(result, { persisted: 0, updated: 0 });
  });
});
