/**
 * @file deletionRecordRetention.test.ts
 * @description Locks the second layer of the retention floor: the clamp applied
 *              where `retainUntil` is computed. The env schema guards only values
 *              arriving through the environment, so these cases deliberately feed
 *              the function what the environment could never hand it.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";

import {
  DELETION_RECORD_LAWFUL_BASIS,
  RETENTION_CEILING_YEARS,
  RETENTION_FLOOR_YEARS,
  computeRetainUntil,
} from "../../../../src/infrastructure/repositories/deletionRecordRetention.js";

const CLIENT_UNTIL = new Date("2026-09-01T12:00:00.000Z");

// Calendar comparison, not a 365.25-day average: the floor is "one CALENDAR
// year after clientUntil" (the same arithmetic the CHECK constraint and the
// implementation use). An average-length year is LONGER than a common year
// (365.25d vs 365d), so an average-based bound rejects the exact calendar
// value the strict assertions below demand — the first version of this file
// carried that contradiction and could never pass.
const atLeastOneCalendarYearAfter = (from: Date, to: Date): boolean => {
  const floor = new Date(from.getTime());
  floor.setUTCFullYear(floor.getUTCFullYear() + RETENTION_FLOOR_YEARS);
  return to.getTime() >= floor.getTime();
};

describe("computeRetainUntil", () => {
  describe("honours a configured window inside the policy range", () => {
    it("returns clientUntil plus the configured years when given 3", () => {
      const result = computeRetainUntil(CLIENT_UNTIL, 3);
      assert.strictEqual(result.toISOString(), "2029-09-01T12:00:00.000Z");
    });

    it("returns clientUntil plus seven years at the policy ceiling", () => {
      const result = computeRetainUntil(CLIENT_UNTIL, RETENTION_CEILING_YEARS);
      assert.strictEqual(result.toISOString(), "2033-09-01T12:00:00.000Z");
    });
  });

  describe("clamps to the one-year floor when the input never met the env bound", () => {
    for (const corrupted of [0, -1, -100, 0.4, Number.NaN, Number.NEGATIVE_INFINITY]) {
      it(`returns at least clientUntil plus one year when given ${String(corrupted)}`, () => {
        const result = computeRetainUntil(CLIENT_UNTIL, corrupted);

        assert.ok(
          Number.isFinite(result.getTime()),
          "a corrupted input must not produce an unreadable deadline"
        );
        assert.ok(
          atLeastOneCalendarYearAfter(CLIENT_UNTIL, result),
          `expected >= ${RETENTION_FLOOR_YEARS} calendar year(s) after clientUntil, got ${result.toISOString()}`
        );
        assert.strictEqual(result.toISOString(), "2027-09-01T12:00:00.000Z");
      });
    }
  });

  describe("clamps down to the policy ceiling", () => {
    it("returns clientUntil plus seven years when given 99", () => {
      const result = computeRetainUntil(CLIENT_UNTIL, 99);
      assert.strictEqual(result.toISOString(), "2033-09-01T12:00:00.000Z");
    });

    it("returns clientUntil plus seven years when given Infinity", () => {
      const result = computeRetainUntil(CLIENT_UNTIL, Number.POSITIVE_INFINITY);
      assert.strictEqual(result.toISOString(), "2033-09-01T12:00:00.000Z");
    });
  });

  // The claim "this function's result never lands before the database's floor"
  // is NOT asserted here, deliberately. It used to be: one hardcoded date, with
  // the PostgreSQL side of the comparison typed in from memory as a literal.
  // That test could only ever confirm what its author already believed, and it
  // stayed green through the whole time-zone divergence it appeared to guard —
  // PostgreSQL evaluates `+ interval '1 year'` in the SESSION time zone, a
  // variable a unit test has no access to at all.
  //
  // It now lives where the answer comes from the database instead of from a
  // literal: tests/integration/deletionRecordRetentionFloor.test.ts sweeps a
  // multi-year range against real Postgres, under a session deliberately
  // started on a hostile time zone, and proves the connection pin overrides it.

  describe("does not mutate its input", () => {
    it("leaves clientUntil unchanged", () => {
      const clientUntil = new Date("2026-09-01T12:00:00.000Z");
      computeRetainUntil(clientUntil, 7);
      assert.strictEqual(clientUntil.toISOString(), "2026-09-01T12:00:00.000Z");
    });
  });
});

describe("DELETION_RECORD_LAWFUL_BASIS", () => {
  // The SUB-ARTICLE, not the article family. `toContain("17(3)")` was satisfied
  // by (a) through (e) alike, so it could not have noticed that this constant
  // and the migration that backfills the same column named two DIFFERENT legal
  // grounds — which is exactly what they did. Art. 17(3)(e) is the adjudicated
  // ground (see the constant's own JSDoc); asserting the letter is what makes a
  // future silent re-divergence fail.
  it("names art. 17(3)(e), the ground the backfilled rows also carry", () => {
    expect(DELETION_RECORD_LAWFUL_BASIS).toContain("17(3)(e)");
  });

  it("does not claim a legal obligation nobody can cite", () => {
    expect(DELETION_RECORD_LAWFUL_BASIS).not.toContain("17(3)(b)");
  });
});
