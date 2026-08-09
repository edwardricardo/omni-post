/**
 * @file sagaRecoveryMetrics.ts
 * @description Prometheus counters for the saga engine's detached work. The
 *              engine's in-process `SagaMetrics` object is readable only through
 *              an authenticated admin endpoint, so a background loop that fails
 *              on every tick is invisible to alerting. These counters put the
 *              same events on the scrape endpoint, including the
 *              `sagas_failed_total` series the saga alert rules already query.
 * @layer infrastructure
 */
import client from "prom-client";

/**
 * Returns the existing counter from the default registry, or creates it. Safe at
 * module-evaluation time even when the module is evaluated more than once (test
 * subprocesses sharing a registry) — mirrors `businessMetrics.ts`.
 */
function getOrCreateCounter(
  name: string,
  help: string,
  labelNames: readonly string[] = []
): client.Counter {
  const existing = client.register.getSingleMetric(name);
  if (existing) return existing as client.Counter;
  return new client.Counter({ name, help, labelNames });
}

/**
 * Stage of detached saga work the engine did NOT complete. Deliberately NOT
 * called a "loop": only the first four are loops, while `rehydration`,
 * `mismatch` and `parked` are per-saga outcomes. An operator paging on
 * `stage="mismatch"` must not go hunting for a background loop by that name.
 *
 * - `boot` — the crash-recovery load that runs once per process start.
 * - `retry-scan` — the scheduled scan for sagas whose retry is due.
 * - `timeout` — the scheduled timeout checker, per saga it inspects.
 * - `instance-load` — the by-id read behind every resume trigger.
 * - `rehydration` — a saga whose owning account could not be resolved.
 * - `mismatch` — a saga whose column and context name different accounts.
 * - `parked` — a saga interrupted at or past its pivot that boot recovery
 *   deliberately left alone. It is not a malfunction of the engine, it is
 *   recovery DECLINED: replaying a pivot cannot be proven side-effect-free, so
 *   the row waits for a human instead of being resumed on a guess. It shares
 *   this series because the operator question is the same one — "what did
 *   recovery fail to bring back?" — and every parked row needs an answer.
 */
export type SagaRecoveryStage =
  "boot" | "retry-scan" | "timeout" | "instance-load" | "rehydration" | "mismatch" | "parked";

/** Why a saga reached its terminal FAILED state. */
export type SagaFailureReason =
  "step-failure" | "timeout" | "unresolvable-account" | "tenant-mismatch";

const sagaRecoveryFailuresTotal = getOrCreateCounter(
  "saga_recovery_failures_total",
  "Saga detached work the engine did not complete, by stage",
  ["stage"]
);

const sagasFailedTotal = getOrCreateCounter(
  "sagas_failed_total",
  "Sagas that reached the terminal FAILED state, by reason",
  ["reason"]
);

/**
 * @function recordSagaRecoveryFailure
 * @description Counts one failure of the engine's detached work. A non-zero rate
 *   means the engine lost visibility of in-flight sagas or skipped work it could
 *   not scope — neither is distinguishable from an idle loop without this.
 * @param stage - The stage that failed.
 */
export function recordSagaRecoveryFailure(stage: SagaRecoveryStage): void {
  sagaRecoveryFailuresTotal.inc({ stage });
}

/**
 * @function recordSagaFailed
 * @description Counts one saga reaching the terminal FAILED state. The alert
 *   rules read this series (notably `reason="timeout"`), so every terminal
 *   failure path must pass through here.
 * @param reason - What drove the saga to FAILED.
 */
export function recordSagaFailed(reason: SagaFailureReason): void {
  sagasFailedTotal.inc({ reason });
}
