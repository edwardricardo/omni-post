/**
 * @file sagaRecoveryMetrics.ts
 * @description Prometheus series for the saga engine's detached work. The
 *              engine's in-process `SagaMetrics` object is readable only through
 *              an authenticated admin endpoint, so a background loop that fails
 *              on every tick is invisible to alerting. These series put the same
 *              events on the scrape endpoint, including the `sagas_failed_total`
 *              series the saga alert rules already query.
 *
 *              Two shapes on purpose. EVENTS are counters: something happened,
 *              once, and the total only grows. STATES are gauges: a re-observed
 *              level that a restart re-measures — how many rows this process is
 *              not covering, how many orphans exist right now. Recording a state
 *              as a counter would sum the same rows once per boot and report a
 *              backlog of two as six after three restarts.
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

/** The gauge equivalent of {@link getOrCreateCounter}, for re-observed levels. */
function getOrCreateGauge(name: string, help: string): client.Gauge {
  const existing = client.register.getSingleMetric(name);
  if (existing) return existing as client.Gauge;
  return new client.Gauge({ name, help });
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

const sagaRecoveryDeferredRows = getOrCreateGauge(
  "saga_recovery_deferred_rows",
  "Non-terminal sagas this process did NOT load at boot because it hit its load ceiling"
);

const sagaCompensatingOrphans = getOrCreateGauge(
  "saga_compensating_orphans",
  "Sagas left in COMPENSATING that no mechanism currently loads, scans or tracks"
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

/**
 * @function recordSagaBootLoadDeferred
 * @description Publishes how many non-terminal rows this process left unread at
 *   boot. A GAUGE, not a counter: it is a level this process re-measures on every
 *   start, and summing it across restarts would report the same backlog again and
 *   again. Deferral is a BOUND doing its job, not a malfunction — it belongs on
 *   neither the failure series nor the parked one — but "N inherited sagas are
 *   uncovered by this process" is exactly the thing an operator must be able to
 *   alert on after a long outage.
 * @param deferred - Rows matching the load predicate that this boot did not read.
 */
export function recordSagaBootLoadDeferred(deferred: number): void {
  sagaRecoveryDeferredRows.set(deferred);
}

/**
 * @function recordSagaCompensatingOrphans
 * @description Publishes how many sagas sit in `COMPENSATING`. Also a gauge, for
 *   the same reason. These rows are currently claimed by NOBODY — the boot load
 *   and the retry scan both filter `status IN (RUNNING, PENDING)`, and the timeout
 *   checker only inspects rows the process is tracking — so the count is a
 *   standing backlog of the infinite non-terminal state the saga canon forbids.
 *   Detection only: the engine deliberately does not resume them, because a
 *   compensation walk resumed without a claim is a second walk over the same
 *   steps.
 * @param orphans - Rows currently in `COMPENSATING`.
 */
export function recordSagaCompensatingOrphans(orphans: number): void {
  sagaCompensatingOrphans.set(orphans);
}
