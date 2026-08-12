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

/**
 * The gauge equivalent of {@link getOrCreateCounter}, for re-observed levels.
 *
 * `collect` makes the level SCRAPE-TIME: prom-client invokes it while rendering
 * `/metrics`, so the value an alert evaluates is measured then, not whenever
 * some code path last remembered to publish it.
 */
function getOrCreateGauge(
  name: string,
  help: string,
  collect?: (this: client.Gauge) => void | Promise<void>
): client.Gauge {
  const existing = client.register.getSingleMetric(name);
  if (existing) return existing as client.Gauge;
  return new client.Gauge({ name, help, ...(collect && { collect }) });
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
 * - `compensation` — an UNDO that did not complete: a walk that could not
 *   start (no instance, no registered definition, no resolvable account), a
 *   walk that ended with a step still un-compensated, or a forward dispatch
 *   refused because the walk owns the row. Its own stage because the operator
 *   question it answers is different from every loop above: not "is recovery
 *   running?" but "is something this saga did still standing?".
 * - `rehydration` — a saga whose owning account could not be resolved.
 * - `mismatch` — a saga whose column and context name different accounts.
 *
 * Parking is NOT here. It is a decision the engine takes deliberately, not work
 * it failed to complete, and a series that mixes the two makes any unfiltered
 * sum of this counter report a designed outcome as a malfunction. It has its own
 * counter below.
 */
export type SagaRecoveryStage =
  | "boot"
  | "retry-scan"
  | "timeout"
  | "instance-load"
  | "resume-row"
  | "compensation"
  | "rehydration"
  | "mismatch";

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
 *
 * `compensation-expired` is distinct from both: the saga's forward work had
 * ALREADY failed and its undo is what stopped making progress, so some of its
 * effects may still be standing. A FAILED row under this reason is not "the
 * publish did not happen"; it is "the rollback did not finish".
 */
export type SagaFailureReason =
  | "step-failure"
  | "timeout"
  | "parked-expired"
  | "compensation-expired"
  | "unresolvable-account"
  | "tenant-mismatch";

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

/**
 * Answers "how many sagas are mid-rollback right now?", installed by the engine.
 *
 * A module-level hook rather than an import: this file publishes series and
 * must not learn about Prisma, tenancy or the saga engine's boundaries.
 */
let compensatingOrphansProvider: (() => Promise<number>) | undefined;

const sagaCompensatingOrphans = getOrCreateGauge(
  "saga_compensating_orphans",
  "Sagas currently mid-rollback (status COMPENSATING). The engine RESUMES these at boot and " +
    "an operator can re-drive them; a level that never drains is a rollback nothing can finish",
  async function collectCompensatingOrphans(this: client.Gauge): Promise<void> {
    if (!compensatingOrphansProvider) return;
    try {
      this.set(await compensatingOrphansProvider());
    } catch {
      // A scrape must not fail because one level could not be measured. The
      // previous sample stays, and the read failure is already counted and
      // logged where it happened.
    }
  }
);

/**
 * @function setSagaCompensatingOrphansProvider
 * @description Installs (or removes) the scrape-time source for the
 *   COMPENSATING level. Publishing the level only at boot made the gauge blind
 *   to every row that appears BETWEEN boots — which, now that the automatic
 *   path writes the status, is the population it exists to watch — and made a
 *   non-zero value latch until the next restart, long after the engine or an
 *   operator had resolved it.
 * @param provider - Counts rows currently in `COMPENSATING`, or `undefined` to
 *   detach on shutdown.
 */
export function setSagaCompensatingOrphansProvider(
  provider: (() => Promise<number>) | undefined
): void {
  compensatingOrphansProvider = provider;
  if (provider === undefined) {
    sagaCompensatingOrphans.set(0);
  }
}

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
 * @description Publishes an already-measured COMPENSATING level — the boot
 *   read, which happens before the scrape-time provider can be useful.
 *
 *   It measures the PRODUCTION path: the automatic walk persists that status
 *   before it undoes anything, so a pre-pivot step exhausting its retries is
 *   visible here, where previously only the admin endpoint could ever move this
 *   number. The engine also RESUMES these rows, so a non-zero value during a
 *   resume pass is work in progress rather than a stuck backlog — which is why
 *   the series is re-measured at every scrape (see
 *   {@link setSagaCompensatingOrphansProvider}) and the alert keys on a level
 *   that never drains.
 * @param orphans - Rows currently in `COMPENSATING`.
 */
export function recordSagaCompensatingOrphans(orphans: number): void {
  sagaCompensatingOrphans.set(orphans);
}
