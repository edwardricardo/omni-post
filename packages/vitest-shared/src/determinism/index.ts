/**
 * @file index.ts
 * @description The determinism kit, `@packages/vitest-shared/determinism`: what a test uses to
 *              wait on the observable result instead of on time. Condition waiters (`until`,
 *              `untilValue`), a one-shot gate that holds one call at a point the test chooses
 *              (`createGate`), a deferred (`createDeferred`) and the fixed clock
 *              (`FIXED_CLOCK_ISO`, `fixedClock`).
 *
 *              It imports neither vitest nor fast-check, only what Node and the language provide,
 *              so vitest suites and the node:test integration tier load the same module. It is a
 *              subpath of its own, apart from the package root, because the root imports
 *              `vitest/config`.
 * @layer infrastructure
 */

export { FIXED_CLOCK_ISO, fixedClock } from "./clock.js";
export { createDeferred, type Deferred } from "./deferred.js";
export { createGate, type Gate } from "./gate.js";
export { until, untilValue, type WaitOptions } from "./until.js";
