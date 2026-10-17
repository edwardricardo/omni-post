/**
 * @file clock.ts
 * @description The fixed instant tests pin their clock to. The kit carries the value only; the
 *              test installs it through its own framework's fake timers, because faking the clock
 *              is the framework's job and this module imports none:
 *              vitest `vi.useFakeTimers({ now: fixedClock() })`, node:test
 *              `mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval", "setImmediate"],
 *              now: fixedClock() })`.
 * @layer infrastructure
 */

/** The fixed instant, midnight UTC on 2026-01-01, as an ISO 8601 string. */
export const FIXED_CLOCK_ISO = "2026-01-01T00:00:00.000Z";

/**
 * @description Returns the fixed instant as a new `Date`. Each call builds its own instance,
 *   because a `Date` is mutable and one shared instance would carry a test's changes into the next.
 * @returns A `Date` at `FIXED_CLOCK_ISO`.
 */
export function fixedClock(): Date {
  return new Date(FIXED_CLOCK_ISO);
}
