/**
 * @file value-objects.scheduled-time.test.ts
 * @description Mutation-killing tests for ScheduledTime value object.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ScheduledTime } from "../../../src/domain/value-objects/ScheduledTime.js";

const TEN_MIN = 10 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;

function futureDate(ms: number): Date {
  return new Date(Date.now() + ms);
}

describe("ScheduledTime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("creates for valid future date", () => {
      const r = ScheduledTime.create({ dateTime: futureDate(TEN_MIN) });
      assert.ok(r.ok);
    });

    it("rejects past date", () => {
      const r = ScheduledTime.create({ dateTime: new Date(Date.now() - ONE_HOUR) });
      assert.ok(!r.ok);
    });

    it("rejects date less than 5 min in future", () => {
      const r = ScheduledTime.create({ dateTime: futureDate(2 * 60 * 1000) }); // 2 min
      assert.ok(!r.ok);
    });

    it("accepts date exactly 5 min in future", () => {
      const r = ScheduledTime.create({ dateTime: futureDate(5 * 60 * 1000 + 1000) }); // 5 min + 1s buffer
      assert.ok(r.ok);
    });

    it("rejects date > 1 year in future", () => {
      const r = ScheduledTime.create({ dateTime: futureDate(366 * ONE_DAY) });
      assert.ok(!r.ok);
    });

    it("accepts date just under 1 year", () => {
      const r = ScheduledTime.create({ dateTime: futureDate(364 * ONE_DAY) });
      assert.ok(r.ok);
    });

    it("defaults timezone to UTC", () => {
      const r = ScheduledTime.create({ dateTime: futureDate(TEN_MIN) });
      assert.ok(r.ok);
      assert.equal(r.value.timezone, "UTC");
    });

    it("accepts valid timezone", () => {
      const r = ScheduledTime.create({
        dateTime: futureDate(TEN_MIN),
        timezone: "America/New_York",
      });
      assert.ok(r.ok);
      assert.equal(r.value.timezone, "America/New_York");
    });

    it("rejects invalid timezone", () => {
      const r = ScheduledTime.create({ dateTime: futureDate(TEN_MIN), timezone: "Invalid/Zone" });
      assert.ok(!r.ok);
    });

    it("rejects invalid date object", () => {
      const r = ScheduledTime.create({ dateTime: new Date("not-a-date") });
      assert.ok(!r.ok);
    });
  });

  describe("fromISOString", () => {
    it("parses valid ISO string", () => {
      const future = futureDate(ONE_HOUR);
      const r = ScheduledTime.fromISOString(future.toISOString());
      assert.ok(r.ok);
    });

    it("rejects invalid ISO string", () => {
      const r = ScheduledTime.fromISOString("not-a-date");
      assert.ok(!r.ok);
    });
  });

  describe("fromNowPlusMinutes", () => {
    it("creates for 10 minutes", () => {
      const r = ScheduledTime.fromNowPlusMinutes(10);
      assert.ok(r.ok);
    });

    it("rejects less than 5 minutes", () => {
      const r = ScheduledTime.fromNowPlusMinutes(3);
      assert.ok(!r.ok);
    });

    it("accepts exactly 5 minutes", () => {
      const r = ScheduledTime.fromNowPlusMinutes(5);
      assert.ok(r.ok);
    });
  });

  describe("reconstitute", () => {
    it("allows past dates (from DB)", () => {
      const past = new Date(Date.now() - ONE_DAY);
      const st = ScheduledTime.reconstitute(past);
      assert.equal(st.hasPassed(), true);
    });
  });

  describe("getters", () => {
    it("dateTime returns a copy", () => {
      const r = ScheduledTime.create({ dateTime: futureDate(TEN_MIN) });
      assert.ok(r.ok);
      const dt1 = r.value.dateTime;
      const dt2 = r.value.dateTime;
      assert.notStrictEqual(dt1, dt2); // Different objects
      assert.equal(dt1.getTime(), dt2.getTime()); // Same time
    });

    it("timestamp returns milliseconds", () => {
      const r = ScheduledTime.create({ dateTime: futureDate(TEN_MIN) });
      assert.ok(r.ok);
      assert.ok(r.value.timestamp > Date.now());
    });

    it("toISOString returns valid ISO string", () => {
      const r = ScheduledTime.create({ dateTime: futureDate(TEN_MIN) });
      assert.ok(r.ok);
      const iso = r.value.toISOString();
      assert.ok(new Date(iso).getTime() > 0);
    });
  });

  describe("time calculations", () => {
    it("hasPassed returns false for future time", () => {
      const r = ScheduledTime.create({ dateTime: futureDate(ONE_HOUR) });
      assert.ok(r.ok);
      assert.equal(r.value.hasPassed(), false);
    });

    it("hasPassed returns true for reconstituted past time", () => {
      const st = ScheduledTime.reconstitute(new Date(Date.now() - ONE_HOUR));
      assert.equal(st.hasPassed(), true);
    });

    it("isWithinMinutes returns true when within range", () => {
      const r = ScheduledTime.create({ dateTime: futureDate(TEN_MIN) });
      assert.ok(r.ok);
      assert.equal(r.value.isWithinMinutes(15), true);
    });

    it("isWithinMinutes returns false when beyond range", () => {
      const r = ScheduledTime.create({ dateTime: futureDate(ONE_HOUR) });
      assert.ok(r.ok);
      assert.equal(r.value.isWithinMinutes(15), false);
    });

    it("millisecondsUntil is positive for future time", () => {
      const r = ScheduledTime.create({ dateTime: futureDate(ONE_HOUR) });
      assert.ok(r.ok);
      assert.ok(r.value.millisecondsUntil > 0);
    });

    it("minutesUntil returns correct value", () => {
      const r = ScheduledTime.create({ dateTime: futureDate(ONE_HOUR) });
      assert.ok(r.ok);
      assert.ok(r.value.minutesUntil >= 55 && r.value.minutesUntil <= 60);
    });

    it("hoursUntil returns correct value", () => {
      const r = ScheduledTime.create({ dateTime: futureDate(3 * ONE_HOUR) });
      assert.ok(r.ok);
      assert.ok(r.value.hoursUntil >= 2 && r.value.hoursUntil <= 3);
    });
  });

  describe("immutable updates", () => {
    it("reschedule returns new ScheduledTime", () => {
      const r = ScheduledTime.create({ dateTime: futureDate(ONE_HOUR) });
      assert.ok(r.ok);
      const newTime = futureDate(2 * ONE_HOUR);
      const r2 = r.value.reschedule(newTime);
      assert.ok(r2.ok);
      assert.ok(r2.value.timestamp > r.value.timestamp);
    });

    it("delay adds minutes", () => {
      const r = ScheduledTime.create({ dateTime: futureDate(ONE_HOUR) });
      assert.ok(r.ok);
      const r2 = r.value.delay(30);
      assert.ok(r2.ok);
      assert.ok(r2.value.timestamp > r.value.timestamp);
    });

    it("delay rejects 0 or negative minutes", () => {
      const r = ScheduledTime.create({ dateTime: futureDate(ONE_HOUR) });
      assert.ok(r.ok);
      assert.ok(!r.value.delay(0).ok);
      assert.ok(!r.value.delay(-5).ok);
    });
  });

  describe("equality and comparison", () => {
    it("equals returns true for same time and timezone", () => {
      const dt = futureDate(ONE_HOUR);
      const a = ScheduledTime.reconstitute(dt, "UTC");
      const b = ScheduledTime.reconstitute(new Date(dt.getTime()), "UTC");
      assert.equal(a.equals(b), true);
    });

    it("equals returns false for different timezone", () => {
      const dt = futureDate(ONE_HOUR);
      const a = ScheduledTime.reconstitute(dt, "UTC");
      const b = ScheduledTime.reconstitute(dt, "America/New_York");
      assert.equal(a.equals(b), false);
    });

    it("compareTo returns -1 when before", () => {
      const a = ScheduledTime.reconstitute(futureDate(ONE_HOUR));
      const b = ScheduledTime.reconstitute(futureDate(2 * ONE_HOUR));
      assert.equal(a.compareTo(b), -1);
    });

    it("compareTo returns 1 when after", () => {
      const a = ScheduledTime.reconstitute(futureDate(2 * ONE_HOUR));
      const b = ScheduledTime.reconstitute(futureDate(ONE_HOUR));
      assert.equal(a.compareTo(b), 1);
    });

    it("compareTo returns 0 when equal", () => {
      const dt = futureDate(ONE_HOUR);
      const a = ScheduledTime.reconstitute(dt);
      const b = ScheduledTime.reconstitute(new Date(dt.getTime()));
      assert.equal(a.compareTo(b), 0);
    });
  });

  describe("toJSON", () => {
    it("includes dateTime, timezone, and timestamp", () => {
      const r = ScheduledTime.create({ dateTime: futureDate(TEN_MIN), timezone: "Europe/London" });
      assert.ok(r.ok);
      const json = r.value.toJSON();
      assert.ok(json.dateTime);
      assert.equal(json.timezone, "Europe/London");
      assert.ok(typeof json.timestamp === "number");
    });
  });
});
