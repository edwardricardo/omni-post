/**
 * @file thresholds.ts
 * @description The latency above which a dependency that still answers reads degraded, in one
 *              place for the checker that grades by it and the manager's alert thresholds.
 * @layer infrastructure
 */

/** Above this latency, in milliseconds, a dependency still answers, slowly, and reads degraded. */
export const DEGRADED_LATENCY_MS = 1000;
