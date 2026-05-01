/**
 * @file OutboxClaimService.test.ts
 * @description Tests for `OutboxClaimService` — atomic claim, release, and
 *   transactional dead-letter archival. The Prisma client is mocked at the
 *   call-shape level: the canonical `UPDATE ... FOR UPDATE SKIP LOCKED ...
 *   RETURNING` query goes through `$queryRaw`, while `markPublished` /
 *   `releaseForRetry` use the typed `outboxEvent.update`. Integration-level
 *   contention is covered separately in `OutboxRelay.integration.test.ts`.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import {
  OutboxClaimService,
  type ClaimedOutboxEvent,
} from "../../../src/infrastructure/outbox/OutboxClaimService.js";

interface MockTransactionOp {
  __op: "create" | "update";
  table: "outboxDeadLetter" | "outboxEvent";
  args: unknown;
}

function createMockPrisma() {
  let lastQueryRawSql: string | null = null;
  let lastQueryRawValues: readonly unknown[] = [];
  let queryRawResult: unknown[] = [];
  const transactionCalls: MockTransactionOp[][] = [];
  let transactionShouldThrow: Error | null = null;

  const prisma = {
    $queryRaw: vi.fn(
      async (query: { strings?: readonly string[]; values?: readonly unknown[] }) => {
        lastQueryRawSql = (query.strings ?? []).join("?");
        lastQueryRawValues = query.values ?? [];
        return queryRawResult;
      }
    ),
    outboxEvent: {
      update: vi.fn(
        async (args: unknown): Promise<MockTransactionOp> => ({
          __op: "update",
          table: "outboxEvent",
          args,
        })
      ),
    },
    outboxDeadLetter: {
      create: vi.fn(
        async (args: unknown): Promise<MockTransactionOp> => ({
          __op: "create",
          table: "outboxDeadLetter",
          args,
        })
      ),
    },
    $transaction: vi.fn(async (ops: Promise<MockTransactionOp>[]) => {
      const resolved = await Promise.all(ops);
      if (transactionShouldThrow) {
        const err = transactionShouldThrow;
        transactionShouldThrow = null;
        throw err;
      }
      transactionCalls.push(resolved);
      return resolved;
    }),
  };

  return {
    prisma,
    setQueryRawResult(rows: unknown[]) {
      queryRawResult = rows;
    },
    getLastQueryRawSql(): string | null {
      return lastQueryRawSql;
    },
    getLastQueryRawValues(): readonly unknown[] {
      return lastQueryRawValues;
    },
    getTransactionCalls(): readonly MockTransactionOp[][] {
      return transactionCalls;
    },
    setTransactionShouldThrow(err: Error) {
      transactionShouldThrow = err;
    },
  };
}

function makeRow(overrides: Partial<ClaimedOutboxEvent> = {}): ClaimedOutboxEvent {
  return {
    id: "evt-1",
    eventType: "PostCreated",
    aggregateId: "post-1",
    aggregateType: "Post",
    payload: { body: "x" },
    version: 1,
    occurredAt: new Date("2026-04-30T00:00:00Z"),
    retryCount: 0,
    createdAt: new Date("2026-04-30T00:00:00Z"),
    ...overrides,
  };
}

describe("OutboxClaimService", () => {
  let mock: ReturnType<typeof createMockPrisma>;
  let service: OutboxClaimService;

  beforeEach(() => {
    mock = createMockPrisma();
    service = new OutboxClaimService({
      prisma: mock.prisma as never,
      workerId: "worker-test",
      leaseDurationMs: 60_000,
    });
  });

  it("returns an empty array immediately when batchSize <= 0", async () => {
    const result = await service.claim(0);
    expect(result).toEqual([]);
    expect(mock.prisma.$queryRaw.mock.calls.length).toBe(0);
  });

  it("issues a single $queryRaw call when claiming", async () => {
    mock.setQueryRawResult([makeRow()]);
    const result = await service.claim(10);
    expect(result.length).toBe(1);
    expect(mock.prisma.$queryRaw.mock.calls.length).toBe(1);
  });

  it("uses FOR UPDATE SKIP LOCKED in the claim SQL", async () => {
    mock.setQueryRawResult([]);
    await service.claim(5);
    const sql = mock.getLastQueryRawSql() ?? "";
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("UPDATE");
    expect(sql).toContain("RETURNING");
  });

  it("filters by publishedAt IS NULL, retryCount, nextRetryAt and lease", async () => {
    mock.setQueryRawResult([]);
    await service.claim(5);
    const sql = mock.getLastQueryRawSql() ?? "";
    expect(sql).toContain('"publishedAt" IS NULL');
    expect(sql).toContain('"retryCount" < "maxRetries"');
    expect(sql).toContain('"nextRetryAt" <=');
    expect(sql).toContain('"claimedAt" IS NULL');
    expect(sql).toContain('"claimedAt" <');
  });

  it("interpolates workerId, now, leaseExpiry and batchSize as parameters", async () => {
    mock.setQueryRawResult([]);
    await service.claim(7);
    const values = mock.getLastQueryRawValues();
    // Order: now, workerId, now, leaseExpiry, batchSize
    expect(values).toContain("worker-test");
    expect(values).toContain(7);
    const dates = values.filter((v): v is Date => v instanceof Date);
    expect(dates.length).toBeGreaterThanOrEqual(2);
  });

  it("computes leaseExpiry as `now - leaseDurationMs`", async () => {
    mock.setQueryRawResult([]);
    await service.claim(1);
    const values = mock.getLastQueryRawValues();
    const dates = values.filter((v): v is Date => v instanceof Date);
    // Two `now` values + one `leaseExpiry`. The leaseExpiry should be ~60s before the others.
    const sortedAsc = [...dates].sort((a, b) => a.getTime() - b.getTime());
    const oldest = sortedAsc[0];
    const newest = sortedAsc[sortedAsc.length - 1];
    const diff = (newest?.getTime() ?? 0) - (oldest?.getTime() ?? 0);
    expect(diff).toBe(60_000);
  });

  it("orders by occurredAt ASC and respects batch size in SQL", async () => {
    mock.setQueryRawResult([]);
    await service.claim(50);
    const sql = mock.getLastQueryRawSql() ?? "";
    expect(sql).toContain('ORDER BY "occurredAt" ASC');
    expect(sql).toContain("LIMIT");
  });

  it("markPublished sets publishedAt + clears claim columns", async () => {
    await service.markPublished("evt-1");
    const args = mock.prisma.outboxEvent.update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { publishedAt: Date; claimedAt: null; claimedBy: null };
    };
    expect(args.where).toEqual({ id: "evt-1" });
    expect(args.data.publishedAt).toBeInstanceOf(Date);
    expect(args.data.claimedAt).toBeNull();
    expect(args.data.claimedBy).toBeNull();
  });

  it("releaseForRetry persists retryCount + nextRetryAt and clears claim", async () => {
    const nextRetry = new Date("2026-05-01T00:00:00Z");
    await service.releaseForRetry("evt-1", 3, nextRetry);
    const args = mock.prisma.outboxEvent.update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { retryCount: number; nextRetryAt: Date; claimedAt: null; claimedBy: null };
    };
    expect(args.where).toEqual({ id: "evt-1" });
    expect(args.data.retryCount).toBe(3);
    expect(args.data.nextRetryAt).toBe(nextRetry);
    expect(args.data.claimedAt).toBeNull();
    expect(args.data.claimedBy).toBeNull();
  });

  it("archiveToDeadLetter wraps DLQ create + outbox update in $transaction", async () => {
    const event = makeRow({ aggregateType: "Project" });
    await service.archiveToDeadLetter(event, "Max retries exhausted", 5);

    expect(mock.prisma.$transaction.mock.calls.length).toBe(1);
    const ops = mock.getTransactionCalls()[0] ?? [];
    expect(ops.length).toBe(2);
    expect(ops[0]?.table).toBe("outboxDeadLetter");
    expect(ops[1]?.table).toBe("outboxEvent");

    const dlqArgs = (ops[0]?.args ?? {}) as {
      data: {
        originalEventId: string;
        aggregateType: string;
        failureReason: string;
        retryCount: number;
      };
    };
    expect(dlqArgs.data.originalEventId).toBe(event.id);
    expect(dlqArgs.data.aggregateType).toBe("Project");
    expect(dlqArgs.data.failureReason).toBe("Max retries exhausted");
    expect(dlqArgs.data.retryCount).toBe(5);

    const outboxArgs = (ops[1]?.args ?? {}) as {
      where: { id: string };
      data: { publishedAt: Date; claimedAt: null; claimedBy: null };
    };
    expect(outboxArgs.where).toEqual({ id: event.id });
    expect(outboxArgs.data.publishedAt).toBeInstanceOf(Date);
    expect(outboxArgs.data.claimedAt).toBeNull();
  });

  it("archiveToDeadLetter rolls back when the transaction throws", async () => {
    mock.setTransactionShouldThrow(new Error("update failed mid-transaction"));
    await expect(service.archiveToDeadLetter(makeRow(), "Max retries", 5)).rejects.toThrow(
      "update failed mid-transaction"
    );
    expect(mock.getTransactionCalls().length).toBe(0);
  });
});
