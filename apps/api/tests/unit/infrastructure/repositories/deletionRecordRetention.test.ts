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

  describe("never lands before the database floor it must satisfy", () => {
    it("resolves a 29 February deletion on or after the CHECK constraint's own floor", () => {
      // PostgreSQL renders 2028-02-29 + INTERVAL '1 year' as 2029-02-28. JS year
      // arithmetic overflows the same date to 2029-03-01, which is LATER — so the
      // CHECK constraint can never reject what this function produced.
      const leapDeletion = new Date("2028-02-29T00:00:00.000Z");
      const result = computeRetainUntil(leapDeletion, RETENTION_FLOOR_YEARS);

      const postgresFloor = new Date("2029-02-28T00:00:00.000Z");
      assert.ok(
        result.getTime() >= postgresFloor.getTime(),
        `expected >= ${postgresFloor.toISOString()}, got ${result.toISOString()}`
      );
      assert.strictEqual(result.toISOString(), "2029-03-01T00:00:00.000Z");
    });
  });

  describe("does not mutate its input", () => {
    it("leaves clientUntil unchanged", () => {
      const clientUntil = new Date("2026-09-01T12:00:00.000Z");
      computeRetainUntil(clientUntil, 7);
      assert.strictEqual(clientUntil.toISOString(), "2026-09-01T12:00:00.000Z");
    });
  });
});

describe("DELETION_RECORD_LAWFUL_BASIS", () => {
  it("names the article that justifies keeping the plaintext", () => {
    expect(DELETION_RECORD_LAWFUL_BASIS).toContain("17(3)");
  });
});
