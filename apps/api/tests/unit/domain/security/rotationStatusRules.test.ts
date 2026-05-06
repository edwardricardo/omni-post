/**
 * @file rotationStatusRules.test.ts
 * @description Tests for the calculateStatus pure function: status transitions,
 *              boundary conditions, and arithmetic correctness.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  calculateStatus,
  DUE_SOON_WINDOW_DAYS,
} from "../../../../src/domain/security/rotationStatusRules.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * MS_PER_DAY);
}

describe("calculateStatus", () => {
  const now = new Date("2026-05-06T00:00:00.000Z");

  describe("status transitions", () => {
    it("returns OK when rotation is recent (90d ago, 365d cadence)", () => {
      const result = calculateStatus(daysAgo(now, 90), 365, now);
      assert.equal(result.status, "OK");
    });

    it("returns DUE_SOON within the warning window (340d ago, 365d cadence → 25d remaining)", () => {
      const result = calculateStatus(daysAgo(now, 340), 365, now);
      assert.equal(result.status, "DUE_SOON");
    });

    it("returns OVERDUE past the cadence (400d ago, 365d cadence)", () => {
      const result = calculateStatus(daysAgo(now, 400), 365, now);
      assert.equal(result.status, "OVERDUE");
    });

    it("returns OK when rotation just happened (0d ago, 365d cadence)", () => {
      const result = calculateStatus(now, 365, now);
      assert.equal(result.status, "OK");
    });
  });

  describe("DUE_SOON window boundaries", () => {
    it("returns DUE_SOON exactly at the warning window edge", () => {
      const rotated = daysAgo(now, 365 - DUE_SOON_WINDOW_DAYS);
      const result = calculateStatus(rotated, 365, now);
      assert.equal(result.status, "DUE_SOON");
    });

    it("returns OK one day before the warning window starts", () => {
      const rotated = daysAgo(now, 365 - DUE_SOON_WINDOW_DAYS - 1);
      const result = calculateStatus(rotated, 365, now);
      assert.equal(result.status, "OK");
    });

    it("transitions to OVERDUE the day after cadence expiry (366d ago, 365d cadence)", () => {
      const result = calculateStatus(daysAgo(now, 366), 365, now);
      assert.equal(result.status, "OVERDUE");
    });
  });

  describe("daysUntilDue arithmetic", () => {
    it("returns positive days remaining when not yet due", () => {
      const result = calculateStatus(daysAgo(now, 100), 365, now);
      assert.equal(result.daysUntilDue, 265);
    });

    it("returns negative days when overdue", () => {
      const result = calculateStatus(daysAgo(now, 400), 365, now);
      assert.ok(result.daysUntilDue < 0, "expected negative daysUntilDue");
      assert.equal(result.daysUntilDue, -35);
    });
  });

  describe("nextRotationAt", () => {
    it("equals rotatedAt + cadenceDays exactly", () => {
      const rotatedAt = new Date("2026-01-01T00:00:00.000Z");
      const result = calculateStatus(rotatedAt, 90, now);
      const expected = new Date(rotatedAt.getTime() + 90 * MS_PER_DAY);
      assert.equal(result.nextRotationAt.getTime(), expected.getTime());
    });
  });

  describe("JWT 90-day cadence", () => {
    it("returns OVERDUE when rotation older than 90 days (95d ago)", () => {
      const result = calculateStatus(daysAgo(now, 95), 90, now);
      assert.equal(result.status, "OVERDUE");
    });

    it("returns DUE_SOON inside the 30-day window (65d ago, 90d cadence → 25d remaining)", () => {
      const result = calculateStatus(daysAgo(now, 65), 90, now);
      assert.equal(result.status, "DUE_SOON");
    });

    it("returns OK well inside 90-day cadence (30d ago)", () => {
      const result = calculateStatus(daysAgo(now, 30), 90, now);
      assert.equal(result.status, "OK");
    });
  });
});
