/**
 * @file ConversionRepository.test.ts
 * @description Contract tests for the conversion repository port. Exercises an
 *              in-memory reference implementation against the semantics every
 *              adapter must honour: idempotent record (re-report of the same
 *              logical event is a no-op), account-scoped reads, date-range and
 *              source filtering, and occurredAt-ascending ordering.
 * @layer infrastructure
 */
import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type {
  ConversionRepositoryPort,
  ConversionRecordInput,
  ConversionFindOptions,
} from "@core/domain/repositories/ConversionRepository.js";
import type { ConversionDto } from "@core/domain/repositories/ReadModelDtos.js";

/**
 * In-memory reference implementation of the conversion port. Captures the
 * contract: the natural-key idempotency tuple and account-scoped reads.
 */
class InMemoryConversionRepository implements ConversionRepositoryPort {
  private rows: ConversionDto[] = [];
  private seq = 0;

  private key(i: {
    accountId: string;
    source: string;
    contentId: string;
    conversionType: string;
    occurredAt: Date;
  }): string {
    return `${i.accountId}|${i.source}|${i.contentId}|${i.conversionType}|${i.occurredAt.toISOString()}`;
  }

  async record(input: ConversionRecordInput): Promise<void> {
    const k = this.key(input);
    if (this.rows.some((r) => this.key(r) === k)) return; // idempotent no-op
    this.rows.push({
      id: `conv-${++this.seq}`,
      accountId: input.accountId,
      source: input.source,
      contentId: input.contentId,
      conversionType: input.conversionType,
      value: input.value,
      attribution: input.attribution,
      occurredAt: input.occurredAt,
      createdAt: new Date("2026-05-23T00:00:00Z"),
    });
  }

  async findByAccount(accountId: string, options: ConversionFindOptions): Promise<ConversionDto[]> {
    return this.rows
      .filter((r) => r.accountId === accountId)
      .filter((r) => r.occurredAt >= options.start && r.occurredAt <= options.end)
      .filter((r) => (options.source !== undefined ? r.source === options.source : true))
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  }
}

const makeInput = (overrides: Partial<ConversionRecordInput> = {}): ConversionRecordInput => ({
  accountId: "acc-1",
  source: "X",
  contentId: "post-1",
  conversionType: "SALE",
  value: 100,
  attribution: "LAST_CLICK",
  occurredAt: new Date("2026-05-10T12:00:00Z"),
  ...overrides,
});

describe("ConversionRepository contract", () => {
  let repo: ConversionRepositoryPort;

  beforeEach(() => {
    repo = new InMemoryConversionRepository();
  });

  it("persists a recorded conversion and returns it within the window", async () => {
    await repo.record(makeInput());
    const rows = await repo.findByAccount("acc-1", {
      start: new Date("2026-05-01T00:00:00Z"),
      end: new Date("2026-05-31T00:00:00Z"),
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.value, 100);
    assert.equal(rows[0]?.conversionType, "SALE");
  });

  it("treats a re-report of the same logical event as a no-op (idempotent)", async () => {
    await repo.record(makeInput({ value: 100 }));
    await repo.record(makeInput({ value: 999 })); // same natural key, different value
    const rows = await repo.findByAccount("acc-1", {
      start: new Date("2026-05-01T00:00:00Z"),
      end: new Date("2026-05-31T00:00:00Z"),
    });
    assert.equal(rows.length, 1, "duplicate event must not create a second row");
    assert.equal(rows[0]?.value, 100, "the first write wins");
  });

  it("records distinct events that differ only by occurredAt", async () => {
    await repo.record(makeInput({ occurredAt: new Date("2026-05-10T12:00:00Z") }));
    await repo.record(makeInput({ occurredAt: new Date("2026-05-10T12:00:01Z") }));
    const rows = await repo.findByAccount("acc-1", {
      start: new Date("2026-05-01T00:00:00Z"),
      end: new Date("2026-05-31T00:00:00Z"),
    });
    assert.equal(rows.length, 2);
  });

  it("never returns another account's conversions (tenancy)", async () => {
    await repo.record(makeInput({ accountId: "acc-1" }));
    await repo.record(makeInput({ accountId: "acc-2", contentId: "post-2" }));
    const rows = await repo.findByAccount("acc-2", {
      start: new Date("2026-05-01T00:00:00Z"),
      end: new Date("2026-05-31T00:00:00Z"),
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.accountId, "acc-2");
  });

  it("excludes conversions outside the date window", async () => {
    await repo.record(makeInput({ occurredAt: new Date("2026-04-01T00:00:00Z") }));
    await repo.record(
      makeInput({ contentId: "post-2", occurredAt: new Date("2026-05-15T00:00:00Z") })
    );
    const rows = await repo.findByAccount("acc-1", {
      start: new Date("2026-05-01T00:00:00Z"),
      end: new Date("2026-05-31T00:00:00Z"),
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.contentId, "post-2");
  });

  it("filters by source provider when supplied", async () => {
    await repo.record(makeInput({ source: "X", contentId: "post-x" }));
    await repo.record(makeInput({ source: "INSTAGRAM", contentId: "post-ig" }));
    const rows = await repo.findByAccount("acc-1", {
      start: new Date("2026-05-01T00:00:00Z"),
      end: new Date("2026-05-31T00:00:00Z"),
      source: "INSTAGRAM",
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.source, "INSTAGRAM");
  });

  it("returns conversions ordered by occurredAt ascending", async () => {
    await repo.record(makeInput({ contentId: "p3", occurredAt: new Date("2026-05-20T00:00:00Z") }));
    await repo.record(makeInput({ contentId: "p1", occurredAt: new Date("2026-05-05T00:00:00Z") }));
    await repo.record(makeInput({ contentId: "p2", occurredAt: new Date("2026-05-12T00:00:00Z") }));
    const rows = await repo.findByAccount("acc-1", {
      start: new Date("2026-05-01T00:00:00Z"),
      end: new Date("2026-05-31T00:00:00Z"),
    });
    assert.deepEqual(
      rows.map((r) => r.contentId),
      ["p1", "p2", "p3"]
    );
  });
});
