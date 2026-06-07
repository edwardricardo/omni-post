/**
 * @file ScheduledTime.test.ts
 * @description Unit tests for the ScheduledTime value object — construction validation,
 *   minimum lead time, maximum horizon, timezone validation, reconstitution, and equality.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { ScheduledTime } from "@core/domain/value-objects/ScheduledTime.js";

/** Returns a Date that is `ms` milliseconds from now */
const future = (ms: number): Date => new Date(Date.now() + ms);

const TEN_MINUTES = 10 * 60 * 1000;
const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;

describe("ScheduledTime", () => {
  describe("create — valid inputs", () => {
    it("constructs successfully for a date 10 minutes in the future", () => {
      const r = ScheduledTime.create({ dateTime: future(TEN_MINUTES) });
      assert.ok(r.ok);
    });

    it("constructs with an explicit timezone and exposes it", () => {
      const r = ScheduledTime.create({
        dateTime: future(TEN_MINUTES),
        timezone: "America/New_York",
      });
      assert.ok(r.ok);
      assert.strictEqual(r.value.timezone, "America/New_York");
    });

    it("defaults to UTC when timezone is omitted", () => {
      const r = ScheduledTime.create({ dateTime: future(TEN_MINUTES) });
      assert.ok(r.ok);
      assert.strictEqual(r.value.timezone, "UTC");
    });
  });

  describe("create — invalid inputs", () => {
    it("rejects an invalid Date object (NaN)", () => {
      const r = ScheduledTime.create({ dateTime: new Date("not-a-date") });
      assert.ok(!r.ok);
      assert.match(r.error.message, /invalid date/i);
    });

    it("rejects a date in the past", () => {
      const r = ScheduledTime.create({ dateTime: new Date(Date.now() - 1000) });
      assert.ok(!r.ok);
      assert.match(r.error.message, /future/i);
    });

    it("rejects a date fewer than 5 minutes in the future (lead time violation)", () => {
      const r = ScheduledTime.create({ dateTime: new Date(Date.now() + 2 * 60 * 1000) });
      assert.ok(!r.ok);
      assert.match(r.error.message, /5 minutes/i);
    });

    it("rejects a date more than 1 year in the future (max horizon violation)", () => {
      const tooFar = new Date(Date.now() + 366 * 24 * 60 * 60 * 1000);
      const r = ScheduledTime.create({ dateTime: tooFar });
      assert.ok(!r.ok);
      assert.match(r.error.message, /1 year/i);
    });

    it("rejects an unrecognized timezone string", () => {
      const r = ScheduledTime.create({ dateTime: future(TEN_MINUTES), timezone: "Not/ACity" });
      assert.ok(!r.ok);
      assert.match(r.error.message, /invalid timezone/i);
    });
  });

  describe("fromISOString", () => {
    it("constructs from a valid ISO string that is 10 minutes ahead", () => {
      const iso = future(TEN_MINUTES).toISOString();
      const r = ScheduledTime.fromISOString(iso);
      assert.ok(r.ok);
    });

    it("rejects a non-date ISO string", () => {
      const r = ScheduledTime.fromISOString("bananas");
      assert.ok(!r.ok);
      assert.match(r.error.message, /invalid iso date string/i);
    });
  });

  describe("fromNowPlusMinutes", () => {
    it("constructs when minutes >= 5", () => {
      const r = ScheduledTime.fromNowPlusMinutes(10);
      assert.ok(r.ok);
    });

    it("rejects when minutes < 5", () => {
      const r = ScheduledTime.fromNowPlusMinutes(3);
      assert.ok(!r.ok);
      assert.match(r.error.message, /at least 5/i);
    });
  });

  describe("reconstitute (bypass validation)", () => {
    it("reconstitutes from a past date without error (DB load scenario)", () => {
      const pastDate = new Date("2020-01-01T00:00:00Z");
      const st = ScheduledTime.reconstitute(pastDate, "UTC");
      assert.strictEqual(st.toISOString(), pastDate.toISOString());
    });
  });

  describe("immutability — dateTime getter returns a copy", () => {
    it("mutating the returned dateTime does not affect the internal value", () => {
      const r = ScheduledTime.create({ dateTime: future(TEN_MINUTES) });
      assert.ok(r.ok);
      const original = r.value.toISOString();
      const dateRef = r.value.dateTime;
      dateRef.setFullYear(2000); // mutate the returned copy
      assert.strictEqual(r.value.toISOString(), original);
    });
  });

  describe("equality", () => {
    it("two instances with the same dateTime and timezone are equal", () => {
      const dt = future(TWO_DAYS);
      const a = ScheduledTime.create({ dateTime: new Date(dt.getTime()), timezone: "UTC" });
      const b = ScheduledTime.create({ dateTime: new Date(dt.getTime()), timezone: "UTC" });
      assert.ok(a.ok && b.ok);
      assert.ok(a.value.equals(b.value));
    });

    it("two instances with different timezones are NOT equal", () => {
      const dt = future(TWO_DAYS);
      const a = ScheduledTime.create({ dateTime: new Date(dt.getTime()), timezone: "UTC" });
      const b = ScheduledTime.create({
        dateTime: new Date(dt.getTime()),
        timezone: "Europe/London",
      });
      assert.ok(a.ok && b.ok);
      assert.ok(!a.value.equals(b.value));
    });
  });

  describe("compareTo", () => {
    it("returns -1 when this is before other", () => {
      const a = ScheduledTime.create({ dateTime: future(TEN_MINUTES) });
      const b = ScheduledTime.create({ dateTime: future(TWO_DAYS) });
      assert.ok(a.ok && b.ok);
      assert.strictEqual(a.value.compareTo(b.value), -1);
    });

    it("returns 1 when this is after other", () => {
      const a = ScheduledTime.create({ dateTime: future(TWO_DAYS) });
      const b = ScheduledTime.create({ dateTime: future(TEN_MINUTES) });
      assert.ok(a.ok && b.ok);
      assert.strictEqual(a.value.compareTo(b.value), 1);
    });
  });
});
