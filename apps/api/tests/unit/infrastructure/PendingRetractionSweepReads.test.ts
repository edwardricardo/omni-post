/**
 * @file PendingRetractionSweepReads.test.ts
 * @description Unit contract for the action-window sweep's discovery read.
 *
 *              The Prisma client is a FAKE that INTERPRETS the `where` it is given
 *              rather than one that returns a canned array: it applies each clause to
 *              a small table, sorts by the declared `orderBy` and slices by `take`,
 *              and it THROWS on any clause it does not recognise. That shape is what
 *              makes the assertions behavioural — "a row whose window is still open is
 *              not selected" fails on a mock that ignores its own predicate, and
 *              passes on one for every possible implementation.
 *
 *              The four clauses are not interchangeable. Dropping `pendingRetraction`
 *              or `retractionBlockedCause` selects channels whose customer was never
 *              obliged to do anything; dropping `actionWindowExpiredAt` re-selects rows
 *              an earlier tick already settled, forever; dropping the cutoff expires
 *              windows that are still open.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import { PendingRetractionSweepReads } from "@adapters/db-prisma";
import type { PrismaClient } from "@infra/prisma";

/** A row of the fake table, with only the columns the predicate reads. */
interface FakeRow {
  id: string;
  postId: string;
  channelId: string;
  accountId: string;
  pendingRetraction: boolean;
  retractionBlockedCause: string | null;
  actionWindowStartedAt: Date | null;
  actionWindowExpiredAt: Date | null;
}

const CUTOFF = new Date("2026-03-10T00:00:00.000Z");
const at = (iso: string): Date => new Date(iso);

function makeRow(overrides: Partial<FakeRow> & { id: string }): FakeRow {
  return {
    postId: `post-${overrides.id}`,
    channelId: `channel-${overrides.id}`,
    accountId: `account-${overrides.id}`,
    pendingRetraction: true,
    retractionBlockedCause: "NO_CAPABILITY",
    actionWindowStartedAt: at("2026-03-01T00:00:00.000Z"),
    actionWindowExpiredAt: null,
    ...overrides,
  };
}

interface FindManyArgs {
  where: Record<string, unknown>;
  orderBy: ReadonlyArray<Record<string, string>>;
  select: Record<string, boolean>;
  take: number;
}

/**
 * Interprets exactly the clauses this read is allowed to send, and refuses anything
 * else — a silently ignored clause is the defect this fake exists to catch.
 */
function matches(row: FakeRow, where: Record<string, unknown>): boolean {
  for (const [column, condition] of Object.entries(where)) {
    switch (column) {
      case "pendingRetraction":
        if (row.pendingRetraction !== condition) return false;
        break;
      case "retractionBlockedCause":
        if (JSON.stringify(condition) !== JSON.stringify({ not: null })) {
          throw new Error(`unrecognised condition on retractionBlockedCause`);
        }
        if (row.retractionBlockedCause === null) return false;
        break;
      case "actionWindowExpiredAt":
        if (condition !== null) throw new Error(`unrecognised condition on actionWindowExpiredAt`);
        if (row.actionWindowExpiredAt !== null) return false;
        break;
      case "actionWindowStartedAt": {
        const lte = (condition as { lte?: Date }).lte;
        if (!(lte instanceof Date)) {
          throw new Error(`unrecognised condition on actionWindowStartedAt`);
        }
        if (row.actionWindowStartedAt === null) return false;
        if (row.actionWindowStartedAt.getTime() > lte.getTime()) return false;
        break;
      }
      default:
        throw new Error(`the read sent an unexpected clause: ${column}`);
    }
  }
  return true;
}

function makeFakePrisma(table: FakeRow[]) {
  const calls: FindManyArgs[] = [];
  const prisma = {
    postChannelPublication: {
      findMany: async (args: FindManyArgs) => {
        calls.push(args);
        const selected = table
          .filter((row) => matches(row, args.where))
          .sort((a, b) => {
            const primary = a.actionWindowStartedAt!.getTime() - b.actionWindowStartedAt!.getTime();
            return primary !== 0 ? primary : a.id.localeCompare(b.id);
          })
          .slice(0, args.take);
        // Prisma returns only the selected columns; returning the whole row would
        // let an over-broad `select` pass unnoticed.
        return selected.map((row) =>
          Object.fromEntries(
            Object.keys(args.select).map((column) => [column, row[column as keyof FakeRow]])
          )
        );
      },
    },
  } as unknown as PrismaClient;
  return { prisma, calls };
}

describe("PendingRetractionSweepReads", () => {
  it("selects only channels that are pending retraction with a known cause", async () => {
    const { prisma } = makeFakePrisma([
      makeRow({ id: "due" }),
      makeRow({ id: "not-pending", pendingRetraction: false }),
      makeRow({ id: "no-cause", retractionBlockedCause: null }),
    ]);

    const rows = await new PendingRetractionSweepReads(prisma).listExpired({
      olderThan: CUTOFF,
      limit: 100,
    });

    expect(rows.map((row) => row.postId)).toEqual(["post-due"]);
  });

  it("skips an already-expired row and a window that is still open", async () => {
    const { prisma } = makeFakePrisma([
      makeRow({ id: "due" }),
      makeRow({ id: "settled", actionWindowExpiredAt: at("2026-03-05T00:00:00.000Z") }),
      makeRow({ id: "still-open", actionWindowStartedAt: at("2026-03-09T23:59:59.999Z") }),
    ]);

    const rows = await new PendingRetractionSweepReads(prisma).listExpired({
      olderThan: new Date("2026-03-09T00:00:00.000Z"),
      limit: 100,
    });

    expect(rows.map((row) => row.postId)).toEqual(["post-due"]);
  });

  it("returns the oldest windows first and no more than the limit", async () => {
    const { prisma, calls } = makeFakePrisma([
      makeRow({ id: "middle", actionWindowStartedAt: at("2026-03-02T00:00:00.000Z") }),
      makeRow({ id: "oldest", actionWindowStartedAt: at("2026-03-01T00:00:00.000Z") }),
      makeRow({ id: "newest", actionWindowStartedAt: at("2026-03-03T00:00:00.000Z") }),
    ]);

    const rows = await new PendingRetractionSweepReads(prisma).listExpired({
      olderThan: CUTOFF,
      limit: 2,
    });

    expect(rows.map((row) => row.postId)).toEqual(["post-oldest", "post-middle"]);
    // The page is bounded, so the order decides who waits — and a tie has to break
    // deterministically or the same page can shuffle between ticks.
    expect(calls[0]!.orderBy).toEqual([{ actionWindowStartedAt: "asc" }, { id: "asc" }]);
    expect(calls[0]!.take).toBe(2);
  });

  it("carries the three identifiers and nothing else out of the read", async () => {
    const { prisma, calls } = makeFakePrisma([makeRow({ id: "due" })]);

    const rows = await new PendingRetractionSweepReads(prisma).listExpired({
      olderThan: CUTOFF,
      limit: 100,
    });

    // Every row is re-read under its own tenant before anything is written, so
    // state carried out of this cross-account read would be state read under one
    // scope and acted on under another.
    expect(Object.keys(calls[0]!.select).sort()).toEqual(["accountId", "channelId", "postId"]);
    expect(rows[0]).toEqual({
      postId: "post-due",
      channelId: "channel-due",
      accountId: "account-due",
    });
  });
});
