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
 * called a "loop": only the first four are loops, while `rehydration` and
 * `mismatch` are per-saga outcomes. An operator paging on `stage="mismatch"`
 * must not go hunting for a background loop by that name.
 *
 * - `boot` — the crash-recovery load that runs once per process start.
 * - `retry-scan` — the scheduled scan for sagas whose retry is due.
 * - `timeout` — the scheduled timeout checker, per saga it inspects.
 * - `instance-load` — the by-id read behind every resume trigger.
 * - `resume-row` — one row the boot resume pass could not even dispatch a
 *   decision about, because inspecting it threw. Its neighbours still ran.
 * - `rehydration` — a saga whose owning account could not be resolved.
 * - `mismatch` — a saga whose column and context name different accounts.
 *
 * Parking is NOT here. It is a decision the engine takes deliberately, not work
 * it failed to complete, and a series that mixes the two makes any unfiltered
 * sum of this counter report a designed outcome as a malfunction. It has its own
 * counter below.
 */
export type SagaRecoveryStage =
  "boot" | "retry-scan" | "timeout" | "instance-load" | "resume-row" | "rehydration" | "mismatch";

/**
 * Why boot recovery declined to resume a row it loaded.
 *
 * - `pivot` — the row was interrupted at or past its pivot, so a replay would
 *   re-run steps whose external effects already happened.
 * - `definition-unregistered` — this process has no definition for the row, so
 *   its pivot boundary is unknowable here and the decision cannot be taken.
 */
export type SagaParkReason = "pivot" | "definition-unregistered";

/**
 * Why a saga reached its terminal FAILED state.
 *
 * `parked-expired` is deliberately distinct from `timeout`: a parked row is
 * terminalized because the HUMAN window opened at parking ran out, not because a
 * step hung, and the two send an operator to different runbooks.
 */
export type SagaFailureReason =
  "step-failure" | "timeout" | "parked-expired" | "unresolvable-account" | "tenant-mismatch";

const sagaRecoveryFailuresTotal = getOrCreateCounter(
  "saga_recovery_failures_total",
  "Saga detached work the engine did not complete, by stage",
  ["stage"]
);

const sagaRecoveryParkedTotal = getOrCreateCounter(
  "saga_recovery_parked_total",
  "Sagas boot recovery deliberately declined to resume, by reason",
  ["reason"]
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
 * @function recordSagaParked
 * @description Counts one saga boot recovery declined to resume. Its own series,
 *   not a failure stage: parking is the engine reporting instead of guessing,
 *   and an operator asking "is recovery broken?" must not be answered with the
 *   count of decisions it took correctly.
 * @param reason - Why the row was declined.
 */
export function recordSagaParked(reason: SagaParkReason): void {
  sagaRecoveryParkedTotal.inc({ reason });
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
