/**
 * @file deletionRecordRetentionFloor.test.ts
 * @description Asks the REAL database the questions the unit suite could only answer from a
 *              literal its author typed in from memory: can `computeRetainUntil` produce a
 *              `retainUntil` that the `DeletionRecord_retainUntil_floor` CHECK rejects, and
 *              does the connection actually run in the time zone that answer depends on.
 *
 *              PostgreSQL evaluates `timestamptz + interval '1 year'` in the SESSION time
 *              zone; `computeRetainUntil` uses `setUTCFullYear`, which is unconditionally
 *              UTC. Worse, and measured here, the Prisma driver's `timestamptz` round-trip
 *              is ALSO session-relative: on a non-UTC session it returns an instant shifted
 *              by the session offset. `PG_SESSION_OPTIONS` closes both by pinning
 *              `timezone=UTC` in the connection startup packet.
 *
 *              Written so that removing that pin turns these RED on any server, not only on
 *              a server whose own default is non-UTC: the client below asks for
 *              `America/New_York` FIRST and depends on the pin (applied last, last-wins) to
 *              overrule it. Only integers and text cross the driver in the sweeps, so the
 *              round-trip defect cannot mask the floor defect or vice versa.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createTestPrismaClient, PG_SESSION_OPTIONS } from "@infra/prisma";
import {
  DELETION_RECORD_LAWFUL_BASIS,
  RETENTION_CEILING_YEARS,
  RETENTION_FLOOR_YEARS,
  computeRetainUntil,
} from "../../src/infrastructure/repositories/deletionRecordRetention.js";

/**
 * A zone whose DST transitions make `+ interval '1 year'` disagree with UTC, and whose
 * offset is large enough that a shifted driver round-trip is unmistakable rather than a
 * rounding artefact.
 */
const HOSTILE_TZ = "America/New_York";
const HOSTILE_OPTIONS = `-c timezone=${HOSTILE_TZ}`;

/**
 * Deletion instants swept against the constraint: hourly across a leap boundary and both
 * hemispheres' DST changeovers, rather than the single hand-picked date the replaced unit
 * test used. The divergence is a property of particular instants, so one instant can only
 * ever confirm the instant it names.
 */
const SWEEP_START = "2026-01-01T00:00:00Z";
const SWEEP_END = "2029-12-31T23:00:00Z";

/** The window lengths the policy admits, including both clamp endpoints. */
const CONFIGURED_YEARS = [RETENTION_FLOOR_YEARS, 3, RETENTION_CEILING_YEARS];

// Built in `before`, not at module scope: a client constructed while the module
// evaluates throws BEFORE any test exists, and node:test reports that as one
// anonymous failure with no name to read. The suite must fail as a suite.
let prisma: ReturnType<typeof createTestPrismaClient>;

describe("DeletionRecord retention floor against the real database", () => {
  before(async () => {
    prisma = createTestPrismaClient(undefined, HOSTILE_OPTIONS);
    await prisma.$connect();
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("opens its session on UTC even though the client asked for a hostile zone", async () => {
    // The pin, observed directly. This client explicitly requests America/New_York in the
    // same startup packet; PG_SESSION_OPTIONS is appended after it and wins.
    const rows = await prisma.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;
    assert.strictEqual(
      rows[0]?.tz,
      "UTC",
      `expected the connection pin (${PG_SESSION_OPTIONS}) to overrule the requested ${HOSTILE_TZ}`
    );
  });

  it("reads a timestamptz back as the same instant it stored", async () => {
    // The widest consequence of an unpinned session, and the one that fails SILENTLY.
    // Prisma renders and parses `timestamptz` relative to the session zone, so on a
    // non-UTC session this literal comes back shifted by the session offset — measured at
    // five hours under America/New_York. Nothing about that is specific to deletion: every
    // scheduled publish time, analytics window and retention deadline the application reads
    // would be wrong by the same amount, with no error anywhere. The CHECK constraint below
    // is merely the one place the drift happens to be loud.
    const stored = "2027-03-08T08:00:00.000Z";
    const rows = await prisma.$queryRaw<{ v: Date }[]>`
      SELECT timestamptz '2027-03-08 08:00:00+00' AS v`;
    assert.strictEqual(
      rows[0]?.v.toISOString(),
      stored,
      "the driver round-tripped a timestamptz through the session zone instead of UTC"
    );
  });

  it("proves the hazard is real: on a non-UTC session the database floor outruns the computed value", async () => {
    // Guards against the pin becoming untestable. If PostgreSQL evaluated the interval
    // identically in every zone, the pin would be dead weight and every assertion here
    // would pass for the wrong reason — so measure the divergence rather than assume it.
    // `set_config(..., true)` is transaction-local and this statement is its own implicit
    // transaction, so the hostile zone applies to this measurement ONLY.
    const [row] = await prisma.$queryRaw<{ divergent: bigint }[]>`
      WITH tz AS (SELECT set_config('TimeZone', ${HOSTILE_TZ}, true) AS applied),
      sweep AS (
        SELECT g AS client_until
        FROM tz, generate_series(
          ${SWEEP_START}::timestamptz, ${SWEEP_END}::timestamptz, interval '1 hour'
        ) g
      )
      SELECT count(*) AS divergent FROM sweep
      WHERE (client_until + interval '1 year')
          > ((client_until AT TIME ZONE 'UTC' + interval '1 year') AT TIME ZONE 'UTC')`;

    assert.ok(
      Number(row?.divergent ?? 0) > 0,
      `expected ${HOSTILE_TZ} to disagree with UTC on at least one instant; a zero here means ` +
        `the session pin protects nothing and this suite is vacuous`
    );
  });

  it("never computes a retainUntil below the floor the database would enforce", async () => {
    for (const years of CONFIGURED_YEARS) {
      // Both sides are computed INSIDE the database — the CHECK's own expression, and the
      // UTC year arithmetic `computeRetainUntil` performs — and only counts come back, so
      // the driver's round-trip cannot colour the result. Any instant where the floor is
      // higher is an erasure production would refuse.
      const [row] = await prisma.$queryRaw<{ violations: bigint; sampled: bigint }[]>`
        WITH sweep AS (
          SELECT g AS client_until
          FROM generate_series(
            ${SWEEP_START}::timestamptz, ${SWEEP_END}::timestamptz, interval '1 hour'
          ) g
        )
        SELECT
          count(*) FILTER (
            WHERE (client_until + interval '1 year')
                > ((client_until AT TIME ZONE 'UTC' + make_interval(years => ${years})) AT TIME ZONE 'UTC')
          ) AS violations,
          count(*) AS sampled
        FROM sweep`;

      assert.ok(Number(row?.sampled ?? 0) > 0, "the sweep must actually sample instants");
      assert.strictEqual(
        Number(row?.violations ?? -1),
        0,
        `configuredYears=${years}: ${String(row?.violations)} of ${String(row?.sampled)} swept ` +
          `instants would be REJECTED by DeletionRecord_retainUntil_floor`
      );
    }
  });

  it("accepts a real tombstone at the instants most at risk, and still rejects one below the floor", async () => {
    // End-to-end against the live constraint rather than a re-derivation of it. The
    // instants are the ones a hostile session would trip on, delivered as TEXT so the
    // driver's round-trip cannot choose them wrongly.
    const rows = await prisma.$queryRaw<{ iso: string }[]>`
      WITH tz AS (SELECT set_config('TimeZone', ${HOSTILE_TZ}, true) AS applied),
      sweep AS (
        SELECT g AS client_until
        FROM tz, generate_series(
          ${SWEEP_START}::timestamptz, ${SWEEP_END}::timestamptz, interval '1 hour'
        ) g
      )
      SELECT to_char(client_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS iso
      FROM sweep
      WHERE (client_until + interval '1 year')
          > ((client_until AT TIME ZONE 'UTC' + interval '1 year') AT TIME ZONE 'UTC')
      LIMIT 12`;

    assert.ok(rows.length > 0, "expected at least one at-risk instant to write");

    const accountId = `tz-floor-${randomUUID()}`;
    const tombstone = (clientUntil: Date, retainUntil: Date) => ({
      id: randomUUID(),
      entityType: "project",
      entityId: randomUUID(),
      name: "retention floor probe",
      accountId,
      clientSince: new Date("2020-01-01T00:00:00Z"),
      clientUntil,
      deletedBy: "retention-floor-test",
      reason: "integration probe for the retention floor CHECK",
      retainUntil,
      lawfulBasis: DELETION_RECORD_LAWFUL_BASIS,
    });

    try {
      for (const { iso } of rows) {
        const clientUntil = new Date(iso);
        await prisma.deletionRecord.create({
          data: tombstone(clientUntil, computeRetainUntil(clientUntil, RETENTION_FLOOR_YEARS)),
        });
      }

      // NEGATIVE CONTROL. Without it every assertion above would also pass against a
      // database where the CHECK had been dropped — "the constraint accepted my row" is
      // only evidence when something provably gets refused. One second under the floor.
      const clientUntil = new Date(rows[0]!.iso);
      const justBelow = computeRetainUntil(clientUntil, RETENTION_FLOOR_YEARS);
      justBelow.setUTCSeconds(justBelow.getUTCSeconds() - 1);
      await assert.rejects(
        () => prisma.deletionRecord.create({ data: tombstone(clientUntil, justBelow) }),
        /DeletionRecord_retainUntil_floor/,
        "a retainUntil one second under the floor must be refused by the CHECK constraint"
      );
    } finally {
      // Tombstones deliberately outlive their tenant, so nothing else will ever collect
      // these. The suite that made them removes them.
      await prisma.deletionRecord.deleteMany({ where: { accountId } });
    }
  });
});
