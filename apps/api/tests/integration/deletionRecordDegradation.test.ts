/**
 * @file deletionRecordDegradation.test.ts
 * @description Asks the REAL database whether the degradation sweep actually
 *              empties the population the `deletion_record_overdue_plaintext`
 *              gauge reports. Acceptance is read from THAT GAUGE and never from
 *              the sweep's return value or its exit code: a job that reports
 *              success while writing nothing is precisely the failure this
 *              capability exists to make impossible, and a count the job
 *              produced about itself cannot rule it out.
 *
 *              Rows are seeded with BOTH `clientUntil` AND `retainUntil`
 *              back-dated, because `DeletionRecord_retainUntil_floor` refuses a
 *              tombstone whose retention horizon is under a year past the
 *              deletion instant — a fixture that back-dates only one of them is
 *              rejected by the constraint before any of this can be tested.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import client from "prom-client";

import { createTestPrismaClient } from "@infra/prisma";
import { DeletionRecordDegrader } from "../../src/infrastructure/retention/DeletionRecordDegrader.js";
import { setDeletionRecordOverdueProvider } from "../../src/metrics/deletionMetrics.js";
import { verifyNameDigest } from "../../src/security/nameDigest/nameDigest.js";
import type { NameDigestKeyRing } from "../../src/security/nameDigest/nameDigest.js";

/** Obviously-fake, deterministic generations. Never used outside this suite. */
const RING: NameDigestKeyRing = new Map([
  [1, Buffer.from("1".repeat(64), "hex")],
  [2, Buffer.from("2".repeat(64), "hex")],
]);

/** A name holding U+05FF, unassigned in the pinned UCD 17.0.0 tables. */
const UNASSIGNED_NAME = "Ana\u05FFDiaz";

/** Both instants sit far in the past, so the row is overdue AND satisfies the floor. */
const CLIENT_UNTIL = new Date("2015-01-01T00:00:00Z");
const RETAIN_UNTIL = new Date("2016-01-02T00:00:00Z");

/** A horizon no test run will reach, for the rows that must stay untouched. */
const FUTURE_RETAIN_UNTIL = new Date("2999-01-01T00:00:00Z");

let prisma: ReturnType<typeof createTestPrismaClient>;

/** Collects what the sweep said, so a leak would be visible rather than silent. */
function createCollectingLogger() {
  const entries: unknown[][] = [];
  const record =
    () =>
    (...args: unknown[]): void => {
      entries.push(args);
    };
  return { entries, info: record(), warn: record(), error: record() };
}

/** A tombstone row, shaped like the factory the retention-floor suite uses. */
function tombstone(accountId: string, name: string, retainUntil: Date = RETAIN_UNTIL) {
  return {
    id: randomUUID(),
    entityType: "project",
    entityId: randomUUID(),
    name,
    accountId,
    clientSince: new Date("2010-01-01T00:00:00Z"),
    clientUntil: CLIENT_UNTIL,
    deletedBy: "deletion-record-degradation-test",
    reason: "integration probe for the stage-two degradation sweep",
    retainUntil,
    lawfulBasis: "legal_obligation",
  };
}

/**
 * Scrape the overdue gauge. `getMetricsAsJSON` is what drives the registered
 * `collect` callback, so this reads the level the way Prometheus would rather
 * than the last value anyone happened to set.
 */
async function readOverdueGauge(): Promise<number> {
  const metrics = await client.register.getMetricsAsJSON();
  const gauge = metrics.find((metric) => metric.name === "deletion_record_overdue_plaintext");
  const value = gauge?.values?.[0]?.value;
  assert.equal(typeof value, "number", "the overdue gauge published no numeric sample");
  return value as number;
}

/** A degrader bound to this suite's client, pinning `activeVersion`. */
function degraderFor(activeVersion: number) {
  return new DeletionRecordDegrader(prisma, RING, activeVersion, createCollectingLogger());
}

describe("DeletionRecord degradation against the real database", () => {
  before(async () => {
    prisma = createTestPrismaClient();
    await prisma.$connect();
    // The same unscoped count the bootstrap installs. DeletionRecord is a
    // documented global table that outlives the account it records, so the level
    // is a property of the deployment rather than of any one tenant.
    setDeletionRecordOverdueProvider(async () =>
      prisma.deletionRecord.count({
        where: { retainUntil: { lt: new Date() }, name: { not: null } },
      })
    );
  });

  after(async () => {
    // Detaching resets the gauge to UNKNOWN rather than to a reassuring zero.
    setDeletionRecordOverdueProvider(undefined);
    await prisma.$disconnect();
  });

  it("drains the gauge to zero and writes all three columns on every seeded row", async () => {
    const accountId = `degrade-drain-${randomUUID()}`;
    const names = ["Ana Díaz", "Wolfgang Mozart", "Anna", "Weiß"];

    try {
      for (const name of names) {
        await prisma.deletionRecord.create({ data: tombstone(accountId, name) });
      }

      const before = await readOverdueGauge();
      assert.ok(before > 0, `expected overdue rows before the sweep, gauge read ${before}`);

      await degraderFor(1).degrade();

      // THE acceptance assertion: the witness, not the job's own account of itself.
      assert.equal(await readOverdueGauge(), 0, "the overdue gauge did not drain to zero");

      const rows = await prisma.deletionRecord.findMany({ where: { accountId } });
      assert.equal(rows.length, names.length);
      for (const row of rows) {
        assert.equal(row.name, null, `row ${row.id} still holds its plaintext name`);
        assert.notEqual(row.nameDigest, null, `row ${row.id} has no digest`);
        assert.equal(row.nameDigestKeyVersion, 1, `row ${row.id} pinned the wrong generation`);
        assert.match(row.nameDigest ?? "", /^[0-9a-f]{64}$/);
      }

      // Every digest verifies against the name it was computed from, and only it.
      for (const name of names) {
        const match = rows.find((row) =>
          verifyNameDigest(RING, name, {
            nameDigest: row.nameDigest ?? "",
            nameDigestKeyVersion: row.nameDigestKeyVersion ?? 0,
          })
        );
        assert.ok(match, `no degraded row verifies against ${JSON.stringify(name)}`);
      }
    } finally {
      // Tombstones deliberately outlive their tenant, so nothing else collects them.
      await prisma.deletionRecord.deleteMany({ where: { accountId } });
    }
  });

  it("leaves a row that is not yet due entirely alone", async () => {
    const accountId = `degrade-future-${randomUUID()}`;

    try {
      await prisma.deletionRecord.create({
        data: tombstone(accountId, "Not Due Yet", FUTURE_RETAIN_UNTIL),
      });

      await degraderFor(1).degrade();

      const row = await prisma.deletionRecord.findFirst({ where: { accountId } });
      assert.ok(row);
      assert.equal(row.name, "Not Due Yet");
      assert.equal(row.nameDigest, null);
      assert.equal(row.nameDigestKeyVersion, null);
      assert.equal(await readOverdueGauge(), 0, "a not-yet-due row must not count as overdue");
    } finally {
      await prisma.deletionRecord.deleteMany({ where: { accountId } });
    }
  });

  it("degrades nothing on a second pass and rewrites no digest or pin", async () => {
    const accountId = `degrade-idempotent-${randomUUID()}`;

    try {
      await prisma.deletionRecord.create({ data: tombstone(accountId, "Ana Díaz") });
      await degraderFor(1).degrade();

      const first = await prisma.deletionRecord.findFirstOrThrow({ where: { accountId } });
      const second = await degraderFor(1).degrade();

      assert.deepEqual(second, { degraded: 0, flagged: 0, failed: 0 });
      const after = await prisma.deletionRecord.findFirstOrThrow({ where: { accountId } });
      assert.equal(after.nameDigest, first.nameDigest, "an existing digest was rewritten");
      assert.equal(after.nameDigestKeyVersion, first.nameDigestKeyVersion);
      assert.equal(await readOverdueGauge(), 0);
    } finally {
      await prisma.deletionRecord.deleteMany({ where: { accountId } });
    }
  });

  it("keeps the gauge above zero for a flagged row while degrading the rows behind it", async () => {
    const accountId = `degrade-flagged-${randomUUID()}`;

    try {
      await prisma.deletionRecord.create({ data: tombstone(accountId, UNASSIGNED_NAME) });
      await prisma.deletionRecord.create({ data: tombstone(accountId, "Ana Díaz") });
      await prisma.deletionRecord.create({ data: tombstone(accountId, "Otra Persona") });

      const summary = await degraderFor(1).degrade();

      assert.equal(summary.flagged, 1, "the unassigned-codepoint row was not flagged");
      assert.equal(summary.degraded, 2, "the rows behind the flagged one did not degrade");

      // The gauge keeps naming the row nobody could process — which is the whole
      // point of leaving it intact rather than degrading it to an unverifiable value.
      assert.equal(await readOverdueGauge(), 1);

      const flagged = await prisma.deletionRecord.findFirstOrThrow({
        where: { accountId, name: { not: null } },
      });
      assert.equal(flagged.name, UNASSIGNED_NAME);
      assert.equal(flagged.nameDigest, null);
      assert.equal(flagged.nameDigestKeyVersion, null);
    } finally {
      await prisma.deletionRecord.deleteMany({ where: { accountId } });
    }
  });

  it("round-trips a rotation: append a generation, bump the pointer, verify both", async () => {
    // These are the runbook's own steps 2, 3 and 5. Steps 1 (generating the key)
    // and 4 (restarting the process) are operator actions and are NOT covered here.
    const accountId = `degrade-rotation-${randomUUID()}`;

    try {
      await prisma.deletionRecord.create({ data: tombstone(accountId, "Ana Díaz") });
      await degraderFor(1).degrade();

      const underV1 = await prisma.deletionRecord.findFirstOrThrow({ where: { accountId } });
      assert.equal(underV1.nameDigestKeyVersion, 1);

      // Pointer bumped to the appended generation; a NEW row degrades under it.
      await prisma.deletionRecord.create({ data: tombstone(accountId, "Otra Persona") });
      await degraderFor(2).degrade();

      const rows = await prisma.deletionRecord.findMany({ where: { accountId } });
      const rotated = rows.find((row) => row.id !== underV1.id);
      assert.ok(rotated);
      assert.equal(rotated.nameDigestKeyVersion, 2, "a new row did not pin the bumped pointer");

      // The older row keeps ITS OWN pin and still verifies under it. This is what
      // append-only means in practice: rotation never reaches backwards.
      const unchanged = rows.find((row) => row.id === underV1.id);
      assert.ok(unchanged);
      assert.equal(unchanged.nameDigestKeyVersion, 1, "rotation rewrote an existing pin");
      assert.equal(unchanged.nameDigest, underV1.nameDigest);
      assert.equal(
        verifyNameDigest(RING, "Ana Díaz", {
          nameDigest: unchanged.nameDigest ?? "",
          nameDigestKeyVersion: unchanged.nameDigestKeyVersion ?? 0,
        }),
        true,
        "a row degraded under generation 1 stopped verifying after the pointer moved"
      );
      assert.equal(
        verifyNameDigest(RING, "Otra Persona", {
          nameDigest: rotated.nameDigest ?? "",
          nameDigestKeyVersion: rotated.nameDigestKeyVersion ?? 0,
        }),
        true
      );
      assert.equal(await readOverdueGauge(), 0);
    } finally {
      await prisma.deletionRecord.deleteMany({ where: { accountId } });
    }
  });
});
