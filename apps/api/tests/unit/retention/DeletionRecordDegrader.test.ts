/**
 * @file DeletionRecordDegrader.test.ts
 * @description Unit contract for the sweep that replaces an overdue tombstone's
 *              plaintext `name` with a keyed digest. The Prisma client is a
 *              FAKE that honours the real predicate — it filters on
 *              `retainUntil`, on `name != null` and on the `notIn` exclusion,
 *              sorts by the declared `orderBy` and slices by `take` — rather
 *              than returning canned arrays. That is deliberate: the properties
 *              under test are "the population drains", "a flagged row does not
 *              stall the rows behind it" and "the loop terminates", and a mock
 *              that ignores its own `where` clause cannot fail any of them.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  DEGRADER_BATCH_SIZE,
  DEGRADER_MAX_BATCHES_PER_TICK,
  DeletionRecordDegrader,
  type DeletionRecordDegraderLogger,
} from "../../../src/infrastructure/retention/DeletionRecordDegrader.js";
import { verifyNameDigest } from "../../../src/security/nameDigest/nameDigest.js";
import type { NameDigestKeyRing } from "../../../src/security/nameDigest/nameDigest.js";

/** Obviously-fake 32-byte generations. */
const RING: NameDigestKeyRing = new Map([
  [1, Buffer.from("1".repeat(64), "hex")],
  [2, Buffer.from("2".repeat(64), "hex")],
]);

/** A name holding U+05FF, which UCD 17.0.0 leaves unassigned. */
const UNASSIGNED_NAME = "Ana\u05FFDiaz";

/** One row of the fake table. */
interface FakeRow {
  id: string;
  name: string | null;
  retainUntil: Date;
  nameDigest: string | null;
  nameDigestKeyVersion: number | null;
}

/** The `where` shape the sweep is allowed to send. */
interface FindManyWhere {
  retainUntil: { lt: Date };
  name: { not: null };
  id?: { notIn: string[] };
}

/** The `findMany` call shape, recorded verbatim so the test can assert it. */
interface FindManyArgs {
  where: FindManyWhere;
  orderBy: ReadonlyArray<Record<string, string>>;
  select: Record<string, boolean>;
  take: number;
}

/** The per-row CAS `updateMany` call shape. */
interface UpdateManyArgs {
  where: { id: string; name: { not: null } };
  data: { name: null; nameDigest: string; nameDigestKeyVersion: number };
}

/**
 * Build a fake Prisma client backed by `rows`, honouring the real predicate.
 * Returns the handles a test needs to assert call shape and to inject a write
 * failure for one specific row.
 */
function createFakePrisma(rows: FakeRow[]) {
  const findManyCalls: FindManyArgs[] = [];
  const updateManyCalls: UpdateManyArgs[] = [];
  const failingWrites = new Set<string>();

  const deletionRecord = {
    findMany: vi.fn(async (args: FindManyArgs) => {
      findManyCalls.push(args);
      const excluded = new Set(args.where.id?.notIn ?? []);
      const cutoff = args.where.retainUntil.lt;
      return rows
        .filter((row) => row.name !== null && row.retainUntil < cutoff && !excluded.has(row.id))
        .sort((a, b) => a.retainUntil.getTime() - b.retainUntil.getTime() || (a.id < b.id ? -1 : 1))
        .slice(0, args.take)
        .map((row) => ({ id: row.id, name: row.name }));
    }),
    updateMany: vi.fn(async (args: UpdateManyArgs) => {
      updateManyCalls.push(args);
      if (failingWrites.has(args.where.id)) throw new Error("simulated write failure");
      const row = rows.find((candidate) => candidate.id === args.where.id);
      // The CAS guard: a row whose name already went null is not rewritten.
      if (row === undefined || row.name === null) return { count: 0 };
      row.name = args.data.name;
      row.nameDigest = args.data.nameDigest;
      row.nameDigestKeyVersion = args.data.nameDigestKeyVersion;
      return { count: 1 };
    }),
  };

  return {
    prisma: { deletionRecord } as unknown as ConstructorParameters<
      typeof DeletionRecordDegrader
    >[0],
    findManyCalls,
    updateManyCalls,
    failWriteFor: (id: string): void => {
      failingWrites.add(id);
    },
  };
}

/** A logger that keeps every argument so the suite can inspect what was said. */
function createSpyLogger(): DeletionRecordDegraderLogger & { entries: unknown[][] } {
  const entries: unknown[][] = [];
  const record =
    () =>
    (...args: unknown[]): void => {
      entries.push(args);
    };
  return { entries, info: record(), warn: record(), error: record() };
}

/** `count` overdue rows, oldest first, with sequential zero-padded ids. */
function overdueRows(count: number, name: string, prefix = "row"): FakeRow[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `${prefix}-${String(index).padStart(5, "0")}`,
    name,
    retainUntil: new Date(Date.UTC(2020, 0, 1) + index * 1000),
    nameDigest: null,
    nameDigestKeyVersion: null,
  }));
}

let logger: ReturnType<typeof createSpyLogger>;

beforeEach(() => {
  vi.clearAllMocks();
  logger = createSpyLogger();
});

describe("DeletionRecordDegrader — the query it issues", () => {
  it("selects only overdue rows that still hold a name, newest last, one batch deep", async () => {
    const rows = overdueRows(3, "Ana Díaz");
    const fake = createFakePrisma(rows);

    await new DeletionRecordDegrader(fake.prisma, RING, 1, logger).degrade();

    const [first] = fake.findManyCalls;
    expect(first).toBeDefined();
    expect(first?.take).toBe(DEGRADER_BATCH_SIZE);
    expect(first?.orderBy).toEqual([{ retainUntil: "asc" }, { id: "asc" }]);
    expect(first?.select).toEqual({ id: true, name: true });
    expect(first?.where.name).toEqual({ not: null });
    expect(first?.where.retainUntil.lt).toBeInstanceOf(Date);
    // Nothing is excluded before anything has been flagged.
    expect(first?.where.id).toBeUndefined();
  });

  it("asks for a stable population — the cutoff does not move between batches", async () => {
    const rows = overdueRows(DEGRADER_BATCH_SIZE + 5, "Ana Díaz");
    const fake = createFakePrisma(rows);

    await new DeletionRecordDegrader(fake.prisma, RING, 1, logger).degrade();

    const cutoffs = fake.findManyCalls.map((call) => call.where.retainUntil.lt.getTime());
    expect(cutoffs.length).toBeGreaterThan(1);
    expect(new Set(cutoffs).size).toBe(1);
  });
});

describe("DeletionRecordDegrader — the write it issues", () => {
  it("moves all three columns in ONE guarded statement per row", async () => {
    const rows = overdueRows(1, "Ana Díaz");
    const fake = createFakePrisma(rows);

    await new DeletionRecordDegrader(fake.prisma, RING, 1, logger).degrade();

    expect(fake.updateManyCalls).toHaveLength(1);
    const [write] = fake.updateManyCalls;
    expect(write?.where).toEqual({ id: "row-00000", name: { not: null } });
    expect(Object.keys(write?.data ?? {}).sort()).toEqual([
      "name",
      "nameDigest",
      "nameDigestKeyVersion",
    ]);
    expect(write?.data.name).toBeNull();
    expect(write?.data.nameDigestKeyVersion).toBe(1);
    expect(write?.data.nameDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never leaves a row observable with both a live name and a digest", async () => {
    const rows = overdueRows(4, "Ana Díaz");
    const fake = createFakePrisma(rows);

    await new DeletionRecordDegrader(fake.prisma, RING, 1, logger).degrade();

    for (const row of rows) {
      expect(row.name).toBeNull();
      expect(row.nameDigest).not.toBeNull();
      expect(row.nameDigestKeyVersion).toBe(1);
      // The stored digest is the one the verifier reproduces from the name.
      expect(
        verifyNameDigest(RING, "Ana Díaz", {
          nameDigest: row.nameDigest ?? "",
          nameDigestKeyVersion: row.nameDigestKeyVersion ?? 0,
        })
      ).toBe(true);
    }
  });

  it("pins the ACTIVE generation, so a rotated pointer lands on new rows", async () => {
    const rows = overdueRows(1, "Ana Díaz");
    const fake = createFakePrisma(rows);

    await new DeletionRecordDegrader(fake.prisma, RING, 2, logger).degrade();

    expect(rows[0]?.nameDigestKeyVersion).toBe(2);
    expect(
      verifyNameDigest(RING, "Ana Díaz", {
        nameDigest: rows[0]?.nameDigest ?? "",
        nameDigestKeyVersion: 2,
      })
    ).toBe(true);
  });
});

describe("DeletionRecordDegrader — draining", () => {
  it("loops until the population is empty, across several batches", async () => {
    const total = DEGRADER_BATCH_SIZE * 2 + 7;
    const rows = overdueRows(total, "Ana Díaz");
    const fake = createFakePrisma(rows);

    const result = await new DeletionRecordDegrader(fake.prisma, RING, 1, logger).degrade();

    expect(result.degraded).toBe(total);
    expect(rows.every((row) => row.name === null)).toBe(true);
    expect(fake.findManyCalls).toHaveLength(3);
  });

  it("leaves rows that are not yet due completely alone", async () => {
    const due = overdueRows(2, "Ana Díaz", "due");
    const future: FakeRow[] = [
      {
        id: "future-1",
        name: "Not Due Yet",
        retainUntil: new Date(Date.UTC(2999, 0, 1)),
        nameDigest: null,
        nameDigestKeyVersion: null,
      },
    ];
    const fake = createFakePrisma([...due, ...future]);

    const result = await new DeletionRecordDegrader(fake.prisma, RING, 1, logger).degrade();

    expect(result.degraded).toBe(2);
    expect(future[0]?.name).toBe("Not Due Yet");
    expect(future[0]?.nameDigest).toBeNull();
  });

  it("degrades nothing and rewrites nothing on a second pass", async () => {
    const rows = overdueRows(3, "Ana Díaz");
    const fake = createFakePrisma(rows);
    const degrader = new DeletionRecordDegrader(fake.prisma, RING, 1, logger);

    await degrader.degrade();
    const digests = rows.map((row) => row.nameDigest);
    const writesAfterFirst = fake.updateManyCalls.length;

    const second = await degrader.degrade();

    expect(second).toEqual({ degraded: 0, flagged: 0, failed: 0 });
    expect(fake.updateManyCalls).toHaveLength(writesAfterFirst);
    expect(rows.map((row) => row.nameDigest)).toEqual(digests);
    expect(rows.map((row) => row.nameDigestKeyVersion)).toEqual([1, 1, 1]);
  });
});

describe("DeletionRecordDegrader — flagged and failed rows", () => {
  it("leaves a flagged row whole and still overdue", async () => {
    const rows = overdueRows(1, UNASSIGNED_NAME);
    const fake = createFakePrisma(rows);

    const result = await new DeletionRecordDegrader(fake.prisma, RING, 1, logger).degrade();

    expect(result).toEqual({ degraded: 0, flagged: 1, failed: 0 });
    expect(fake.updateManyCalls).toHaveLength(0);
    expect(rows[0]?.name).toBe(UNASSIGNED_NAME);
    expect(rows[0]?.nameDigest).toBeNull();
    expect(rows[0]?.nameDigestKeyVersion).toBeNull();
  });

  it("excludes a flagged row from the NEXT query instead of re-reading it", async () => {
    const rows = [...overdueRows(1, UNASSIGNED_NAME, "bad"), ...overdueRows(1, "Ana Díaz")];
    const fake = createFakePrisma(rows);

    await new DeletionRecordDegrader(fake.prisma, RING, 1, logger).degrade();

    expect(fake.findManyCalls.length).toBeGreaterThan(0);
    expect(fake.findManyCalls[0]?.where.id).toBeUndefined();
  });

  it("degrades the normal rows BEHIND a full batch of flagged ones", async () => {
    // The starvation shape: a whole batch of flaggable rows sorts ahead of the
    // normal ones. Without the per-tick exclusion set, every batch would return
    // the same unflaggable rows forever and nothing behind them would degrade.
    const flaggable = overdueRows(DEGRADER_BATCH_SIZE, UNASSIGNED_NAME, "bad");
    const normal = overdueRows(5, "Ana Díaz", "good").map((row) => ({
      ...row,
      retainUntil: new Date(row.retainUntil.getTime() + 10_000_000),
    }));
    const fake = createFakePrisma([...flaggable, ...normal]);

    const result = await new DeletionRecordDegrader(fake.prisma, RING, 1, logger).degrade();

    expect(result.flagged).toBe(DEGRADER_BATCH_SIZE);
    expect(result.degraded).toBe(5);
    expect(normal.every((row) => row.name === null)).toBe(true);
    expect(flaggable.every((row) => row.name === UNASSIGNED_NAME)).toBe(true);

    const second = fake.findManyCalls[1];
    expect(second?.where.id?.notIn).toHaveLength(DEGRADER_BATCH_SIZE);
  });

  it("terminates instead of re-reading an identical unflaggable batch", async () => {
    const rows = overdueRows(DEGRADER_BATCH_SIZE * 2, UNASSIGNED_NAME, "bad");
    const fake = createFakePrisma(rows);

    const result = await new DeletionRecordDegrader(fake.prisma, RING, 1, logger).degrade();

    expect(result.flagged).toBe(DEGRADER_BATCH_SIZE * 2);
    // Batch 1 and 2 return rows; batch 3 comes back empty and ends the loop.
    expect(fake.findManyCalls).toHaveLength(3);
    const exclusions = fake.findManyCalls.map((call) => call.where.id?.notIn?.length ?? 0);
    expect(exclusions).toEqual([0, DEGRADER_BATCH_SIZE, DEGRADER_BATCH_SIZE * 2]);
  });

  it("stops at the defensive per-tick batch cap and says so", async () => {
    const rows = overdueRows(
      DEGRADER_BATCH_SIZE * (DEGRADER_MAX_BATCHES_PER_TICK + 2),
      UNASSIGNED_NAME,
      "bad"
    );
    const fake = createFakePrisma(rows);

    const result = await new DeletionRecordDegrader(fake.prisma, RING, 1, logger).degrade();

    expect(fake.findManyCalls).toHaveLength(DEGRADER_MAX_BATCHES_PER_TICK);
    expect(result.flagged).toBe(DEGRADER_BATCH_SIZE * DEGRADER_MAX_BATCHES_PER_TICK);
    expect(rows.some((row) => row.name === UNASSIGNED_NAME)).toBe(true);
  });

  it("keeps sweeping when one row's write throws, and counts it as failed", async () => {
    const rows = overdueRows(4, "Ana Díaz");
    const fake = createFakePrisma(rows);
    fake.failWriteFor("row-00001");

    const result = await new DeletionRecordDegrader(fake.prisma, RING, 1, logger).degrade();

    expect(result).toEqual({ degraded: 3, flagged: 0, failed: 1 });
    expect(rows[1]?.name).toBe("Ana Díaz");
    expect(rows[1]?.nameDigest).toBeNull();
    expect(rows[1]?.nameDigestKeyVersion).toBeNull();
    expect(rows.filter((row) => row.name === null)).toHaveLength(3);
  });

  it("excludes a failed row too, so it cannot stall the batch behind it", async () => {
    const rows = overdueRows(DEGRADER_BATCH_SIZE + 3, "Ana Díaz");
    const fake = createFakePrisma(rows);
    fake.failWriteFor("row-00000");

    await new DeletionRecordDegrader(fake.prisma, RING, 1, logger).degrade();

    expect(fake.findManyCalls[1]?.where.id?.notIn).toEqual(["row-00000"]);
  });
});

describe("DeletionRecordDegrader — the triple it returns", () => {
  it("reports a clean run as three zeros", async () => {
    const fake = createFakePrisma([]);
    const result = await new DeletionRecordDegrader(fake.prisma, RING, 1, logger).degrade();
    expect(result).toEqual({ degraded: 0, flagged: 0, failed: 0 });
  });

  it("distinguishes a degraded, a flagged and a failed run from a clean one", async () => {
    const rows = [
      ...overdueRows(2, "Ana Díaz", "good"),
      ...overdueRows(1, UNASSIGNED_NAME, "bad"),
      ...overdueRows(1, "Otra Persona", "boom"),
    ];
    const fake = createFakePrisma(rows);
    fake.failWriteFor("boom-00000");

    const result = await new DeletionRecordDegrader(fake.prisma, RING, 1, logger).degrade();

    expect(result).toEqual({ degraded: 2, flagged: 1, failed: 1 });
    expect(result).not.toEqual({ degraded: 0, flagged: 0, failed: 0 });
  });
});

describe("DeletionRecordDegrader — what it is allowed to say", () => {
  it("reports a flagged row by id and reason, never by name", async () => {
    const rows = overdueRows(1, UNASSIGNED_NAME);
    const fake = createFakePrisma(rows);

    await new DeletionRecordDegrader(fake.prisma, RING, 1, logger).degrade();

    expect(logger.entries.length).toBeGreaterThan(0);
    const said = JSON.stringify(logger.entries);
    expect(said).toContain("row-00000");
    expect(said).toContain("unassigned_codepoint");
  });

  it("lets no fragment of any plaintext name reach any log argument", async () => {
    // The whole point of the sweep is that the plaintext stops existing. A name
    // copied into a log line survives in the log aggregator long after the
    // column is null, which would defeat the erasure this job performs.
    const names = ["Ana Díaz", UNASSIGNED_NAME, "Wolfgang Amadeus Mozart"];
    const rows = [
      ...overdueRows(1, names[0] ?? "", "good"),
      ...overdueRows(1, names[1] ?? "", "bad"),
      ...overdueRows(1, names[2] ?? "", "boom"),
    ];
    const fake = createFakePrisma(rows);
    fake.failWriteFor("boom-00000");

    await new DeletionRecordDegrader(fake.prisma, RING, 1, logger).degrade();

    const said = JSON.stringify(logger.entries);
    for (const name of names) {
      expect(said).not.toContain(name);
      for (const fragment of name.split(/\s+/)) {
        if (fragment.length < 4) continue;
        expect(said).not.toContain(fragment);
      }
    }
  });
});
