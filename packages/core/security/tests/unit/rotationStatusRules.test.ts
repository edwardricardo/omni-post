/**
 * @file rotationStatusRules.test.ts
 * @description Unit tests for the pure calculateStatus domain function —
 *   OK / DUE_SOON / OVERDUE status transitions, nextRotationAt computation,
 *   and daysUntilDue values. Caller-controlled clock (deterministic).
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  calculateStatus,
  DUE_SOON_WINDOW_DAYS,
  ROTATION_STATUS_VALUES,
} from "@core/domain/security/rotationStatusRules.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Build a reference now + a rotatedAt that puts the next rotation exactly `daysFromNow` days away. */
function makeScenario(cadenceDays: number, daysFromNow: number) {
  const now = new Date("2025-06-01T00:00:00Z");
  // rotatedAt = now - (cadenceDays - daysFromNow) days
  const rotatedAt = new Date(now.getTime() - (cadenceDays - daysFromNow) * MS_PER_DAY);
  return { now, rotatedAt };
}

describe("ROTATION_STATUS_VALUES", () => {
  it("contains exactly OK, DUE_SOON, and OVERDUE", () => {
    assert.deepStrictEqual([...ROTATION_STATUS_VALUES].sort(), ["DUE_SOON", "OK", "OVERDUE"]);
  });
});

describe("calculateStatus", () => {
  describe("OK status", () => {
    it("returns OK when daysUntilDue > DUE_SOON_WINDOW_DAYS (31 days out)", () => {
      const { now, rotatedAt } = makeScenario(90, 31);
      const result = calculateStatus(rotatedAt, 90, now);
      assert.strictEqual(result.status, "OK");
    });

    it("returns positive daysUntilDue when status is OK", () => {
      const { now, rotatedAt } = makeScenario(90, 60);
      const result = calculateStatus(rotatedAt, 90, now);
      assert.ok(result.daysUntilDue > DUE_SOON_WINDOW_DAYS);
    });
  });

  describe("DUE_SOON status", () => {
    it("returns DUE_SOON when daysUntilDue equals DUE_SOON_WINDOW_DAYS exactly", () => {
      const { now, rotatedAt } = makeScenario(90, DUE_SOON_WINDOW_DAYS);
      const result = calculateStatus(rotatedAt, 90, now);
      assert.strictEqual(result.status, "DUE_SOON");
    });

    it("returns DUE_SOON when daysUntilDue is 1 (one day left)", () => {
      const { now, rotatedAt } = makeScenario(90, 1);
      const result = calculateStatus(rotatedAt, 90, now);
      assert.strictEqual(result.status, "DUE_SOON");
    });

    it("returns DUE_SOON when daysUntilDue is 0 (due today, not yet overdue)", () => {
      const { now, rotatedAt } = makeScenario(90, 0);
      const result = calculateStatus(rotatedAt, 90, now);
      // daysUntilDue = 0: not < 0, so not OVERDUE; not > 30, so DUE_SOON
      assert.strictEqual(result.status, "DUE_SOON");
    });
  });

  describe("OVERDUE status", () => {
    it("returns OVERDUE when the cadence has elapsed (negative daysUntilDue)", () => {
      const { now, rotatedAt } = makeScenario(90, -5); // 5 days past due
      const result = calculateStatus(rotatedAt, 90, now);
      assert.strictEqual(result.status, "OVERDUE");
      assert.ok(result.daysUntilDue < 0);
    });

    it("returns OVERDUE for a very old rotation (365 days with 90-day cadence)", () => {
      const now = new Date("2025-06-01T00:00:00Z");
      const rotatedAt = new Date(now.getTime() - 365 * MS_PER_DAY);
      const result = calculateStatus(rotatedAt, 90, now);
      assert.strictEqual(result.status, "OVERDUE");
    });
  });

  describe("nextRotationAt invariant", () => {
    it("nextRotationAt equals rotatedAt + cadenceDays", () => {
      const now = new Date("2025-06-01T00:00:00Z");
      const rotatedAt = new Date("2025-03-03T00:00:00Z"); // 90 days before
      const result = calculateStatus(rotatedAt, 90, now);
      const expected = new Date(rotatedAt.getTime() + 90 * MS_PER_DAY);
      assert.strictEqual(result.nextRotationAt.getTime(), expected.getTime());
    });
  });

  describe("cadence variation", () => {
    it("respects a 365-day cadence (KEK — annual rotation)", () => {
      const now = new Date("2025-06-01T00:00:00Z");
      const rotatedAt = new Date(now.getTime() - 400 * MS_PER_DAY); // 400 days ago → 35 overdue
      const result = calculateStatus(rotatedAt, 365, now);
      assert.strictEqual(result.status, "OVERDUE");
    });

    it("respects a 30-day cadence (short-lived secrets)", () => {
      const now = new Date("2025-06-01T00:00:00Z");
      const rotatedAt = new Date(now.getTime() - 10 * MS_PER_DAY); // 10 days ago → 20 days left
      const result = calculateStatus(rotatedAt, 30, now);
      // 20 days left ≤ 30 (DUE_SOON_WINDOW_DAYS) → DUE_SOON
      assert.strictEqual(result.status, "DUE_SOON");
    });
  });
});
