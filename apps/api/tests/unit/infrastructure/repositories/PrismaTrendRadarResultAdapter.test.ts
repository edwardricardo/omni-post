/**
 * @file PrismaTrendRadarResultAdapter.test.ts
 * @description Unit tests for the trend-radar persistence adapter: a single
 *              idempotent UPSERT per trend keyed by the
 *              `(accountId, dayKey, topic)` unique constraint, 30-day retention
 *              via `expiresAt`, provenance preserved, and observability counts
 *              derived from the returned `fetchedAt`. Prisma is mocked at the
 *              `trendRadarResult` table boundary.
 * @layer infrastructure
 */
import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { PrismaTrendRadarResultAdapter } from "../../../../src/infrastructure/repositories/PrismaTrendRadarResultAdapter.js";
import type { PrismaClient } from "@infra/prisma";
import type { TrendRadarRow, TrendRadarUpsertInput } from "@core/trends/TrendRadarResultPort.js";

const fetchedAt = new Date("2026-05-20T12:00:00.000Z");
const dayKey = "2026-05-20";

/**
 * Mocks `trendRadarResult.upsert`. The adapter discriminates persisted vs
 * updated by comparing the returned `fetchedAt` to the input's: returning the
 * same instant ⇒ counted persisted; returning a different instant ⇒ counted
 * updated. `returnedFetchedAt` lets a test drive either branch per call.
 */
function makePrisma(opts: { returnedFetchedAt?: ReadonlyArray<Date> } = {}): {
  prisma: PrismaClient;
  calls: { upsert: Array<Record<string, unknown>> };
} {
  const calls = { upsert: [] as Array<Record<string, unknown>> };
  const returned = opts.returnedFetchedAt ?? [];
  let idx = 0;

  const prisma = {
    trendRadarResult: {
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        calls.upsert.push(args);
        const at = returned[idx] ?? fetchedAt;
        idx++;
        return { fetchedAt: at };
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

function makeInput(trends: TrendRadarRow[]): TrendRadarUpsertInput {
  return { accountId: "acc-1", dayKey, fetchedAt, trends };
}

describe("PrismaTrendRadarResultAdapter", () => {
  it("issues one upsert per trend keyed by (accountId, dayKey, topic)", async () => {
    const { prisma, calls } = makePrisma();
    const adapter = new PrismaTrendRadarResultAdapter(prisma);

    await adapter.upsert(makeInput([row({ topic: "#A" }), row({ topic: "#B" })]));

    assert.strictEqual(calls.upsert.length, 2);
    const where = (calls.upsert[0] as { where: { accountId_dayKey_topic: Record<string, string> } })
      .where.accountId_dayKey_topic;
    assert.deepStrictEqual(where, { accountId: "acc-1", dayKey, topic: "#A" });
  });

  it("counts every row as persisted when the upsert returns the input fetchedAt", async () => {
    const { prisma } = makePrisma();
    const adapter = new PrismaTrendRadarResultAdapter(prisma);

    const result = await adapter.upsert(makeInput([row({ topic: "#A" }), row({ topic: "#B" })]));

    assert.deepStrictEqual(result, { persisted: 2, updated: 0 });
  });

  it("counts a row as updated when the upsert returns a different fetchedAt", async () => {
    const olderRow = new Date("2026-05-20T09:00:00.000Z");
    const { prisma } = makePrisma({ returnedFetchedAt: [olderRow] });
    const adapter = new PrismaTrendRadarResultAdapter(prisma);

    const result = await adapter.upsert(makeInput([row({ topic: "#A", relevanceScore: 8 })]));

    assert.deepStrictEqual(result, { persisted: 0, updated: 1 });
  });

  it("sets expiresAt to fetchedAt + 30 days on both create and update payloads", async () => {
    const { prisma, calls } = makePrisma();
    const adapter = new PrismaTrendRadarResultAdapter(prisma);

    await adapter.upsert(makeInput([row()]));

    const args = calls.upsert[0] as {
      create: { expiresAt: Date };
      update: { expiresAt: Date };
    };
    const expected = new Date(fetchedAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    assert.strictEqual(args.create.expiresAt.toISOString(), expected);
    assert.strictEqual(args.update.expiresAt.toISOString(), expected);
  });

  it("persists provenance (source + sourceUrl) on the create payload", async () => {
    const { prisma, calls } = makePrisma();
    const adapter = new PrismaTrendRadarResultAdapter(prisma);

    await adapter.upsert(
      makeInput([row({ source: "ACCOUNT_ANALYTICS", sourceUrl: "https://ex.example/a" })])
    );

    const create = (calls.upsert[0] as { create: { source: string; sourceUrl: string | null } })
      .create;
    assert.strictEqual(create.source, "ACCOUNT_ANALYTICS");
    assert.strictEqual(create.sourceUrl, "https://ex.example/a");
  });

  it("mixes persisted and updated counts from the returned fetchedAt per row", async () => {
    const older = new Date("2026-05-20T08:00:00.000Z");
    // Row 1 → updated (different fetchedAt), row 2 → persisted (same), row 3 → updated.
    const { prisma } = makePrisma({ returnedFetchedAt: [older, fetchedAt, older] });
    const adapter = new PrismaTrendRadarResultAdapter(prisma);

    const result = await adapter.upsert(
      makeInput([row({ topic: "#A" }), row({ topic: "#B" }), row({ topic: "#C" })])
    );

    assert.deepStrictEqual(result, { persisted: 1, updated: 2 });
  });

  it("returns zero counts when there are no trends to persist", async () => {
    const { prisma, calls } = makePrisma();
    const adapter = new PrismaTrendRadarResultAdapter(prisma);

    const result = await adapter.upsert(makeInput([]));

    assert.deepStrictEqual(result, { persisted: 0, updated: 0 });
    assert.strictEqual(calls.upsert.length, 0);
  });
});
