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
 *   walk that ended with a step still un-compensated, a forward dispatch
 *   refused because the walk owns the DURABLE row, or a detached walk that
 *   died on dispatch. Its own stage because the operator question it answers is
 *   different from every loop above: not "is recovery running?" but "is
 *   something this saga did still standing?".
 *
 *   Deliberately NOT here: the in-process claim's refusals. A walk that arrives
 *   while a forward pass holds the saga is HANDED OFF to that pass's release,
 *   and a second walk is turned away while the first is still running — both
 *   are the guard working, nothing is lost, and counting them would dilute the
 *   one series an operator pages on for a rollback that really is stuck.
 * - `rehydration` — a saga whose owning account could not be resolved.
 * - `mismatch` — a saga whose column and context name different accounts.
 * - `event-dispatch` — a worker event the engine could not route: it carries no
 *   usable saga identity, so it advances nothing. Counted rather than dropped
 *   because a silent discard here reads exactly like a publish that never
 *   emitted an event at all.
 * - `wait-poll` — a step that has not finished could not have its poll re-armed
 *   (the durable write failed). The saga is NOT terminalized for it — bookkeeping
 *   never ends a saga — so without this series a degraded database is invisible
 *   on the one path that now runs up to sixty times per saga.
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
  | "mismatch"
  | "event-dispatch"
  | "wait-poll";

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
 * The histogram equivalent of {@link getOrCreateCounter}, for distributions.
 */
function getOrCreateHistogram(
  name: string,
  help: string,
  labelNames: readonly string[],
  buckets: number[]
): client.Histogram {
  const existing = client.register.getSingleMetric(name);
  if (existing) return existing as client.Histogram;
  return new client.Histogram({ name, help, labelNames, buckets });
}

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
 * Answers "how many sagas are parked on a poll right now?", installed by the
 * engine for the same reason the orphans provider is: this file publishes
 * series and must not learn about Prisma or tenancy.
 */
let waitingRowsProvider: (() => Promise<number>) | undefined;

const sagaWaitingRows = getOrCreateGauge(
  "saga_waiting_rows",
  "Sagas parked on a step that has not finished (RUNNING with a scheduled re-entry). A step " +
    "that waits spends no retry budget, so this population drains on its own work rather than " +
    "on a failure — a level that keeps climbing is work nothing is finishing",
  async function collectWaitingRows(this: client.Gauge): Promise<void> {
    if (!waitingRowsProvider) return;
    try {
      this.set(await waitingRowsProvider());
    } catch {
      // A scrape must not fail because one level could not be measured.
    }
  }
);

/**
 * @function setSagaWaitingRowsProvider
 * @description Installs (or removes) the scrape-time source for the WAITING
 *   population. It exists because the budget exemption changed the shape of
 *   this population without changing any series: a step that waits no longer
 *   converts into a failure in ~35 s, it sits on a poll for as long as the
 *   horizon allows, and nothing published a number for it — so a worker outage
 *   was invisible until a burst of timeouts half an hour later.
 * @param provider - Counts rows currently waiting on a scheduled re-entry, or
 *   `undefined` to detach on shutdown.
 */
export function setSagaWaitingRowsProvider(provider: (() => Promise<number>) | undefined): void {
  waitingRowsProvider = provider;
  if (provider === undefined) {
    sagaWaitingRows.set(0);
  }
}

/**
 * The value `publish_queue_consumers` carries when the consumer count could NOT
 * be read — the broker refused its client registry, the port errored, or no
 * provider is installed.
 *
 * A Prometheus gauge has no null, and the alert fires on `== 0`, so unknown MUST
 * NOT be published as zero: that would page for an outage nobody observed. A
 * negative sentinel is outside every legitimate count, so it fails the alert's
 * predicate and stays silent on its own.
 */
export const PUBLISH_QUEUE_UNKNOWN_CONSUMERS = -1;

/**
 * Reads the publish queue's health at scrape time. Installed by the composition
 * root; this file publishes series and must not learn about BullMQ or Redis.
 *
 * The API publishes these rather than the workers on purpose: the observer has
 * to survive the outage, and a worker-side gauge goes ABSENT exactly when the
 * workers die — absence being ambiguous with a scrape misconfiguration. The API
 * holds the same publish queue as a producer and is up precisely when the
 * consumers are not.
 */
let publishQueueHealthProvider:
  | (() => Promise<
      | { ok: true; value: { consumers: number | null; waiting: number } }
      | { ok: false; error: unknown }
    >)
  | undefined;

/** Last snapshot read, shared by both gauges so one scrape costs one round trip. */
async function readPublishQueue(): Promise<{ consumers: number; waiting: number } | undefined> {
  if (!publishQueueHealthProvider) return undefined;
  const result = await publishQueueHealthProvider();
  if (!result.ok) return undefined;
  const { consumers, waiting } = result.value;
  return {
    consumers: consumers === null ? PUBLISH_QUEUE_UNKNOWN_CONSUMERS : consumers,
    waiting,
  };
}

const publishQueueConsumers = getOrCreateGauge(
  "publish_queue_consumers",
  "Consumers the broker has registered for the publish queue. -1 means the count could NOT be " +
    "read (no client registry, port error, or no provider installed) — UNKNOWN, never zero, so " +
    "an alert keyed on zero cannot fire on an unanswered question",
  async function collectPublishQueueConsumers(this: client.Gauge): Promise<void> {
    try {
      const snapshot = await readPublishQueue();
      this.set(snapshot?.consumers ?? PUBLISH_QUEUE_UNKNOWN_CONSUMERS);
    } catch {
      // A scrape must not fail because one level could not be measured. Unknown
      // is the honest value here, and it is the value that keeps the alert quiet.
      this.set(PUBLISH_QUEUE_UNKNOWN_CONSUMERS);
    }
  }
);

const publishQueueWaiting = getOrCreateGauge(
  "publish_queue_waiting",
  "Publish jobs enqueued and not yet taken. Paired with publish_queue_consumers: work queued AND " +
    "nobody taking it is the outage; either term alone is an ordinary burst or an idle system",
  async function collectPublishQueueWaiting(this: client.Gauge): Promise<void> {
    try {
      const snapshot = await readPublishQueue();
      if (snapshot) this.set(snapshot.waiting);
    } catch {
      // Previous sample stands; the consumers gauge carries the unknown.
    }
  }
);

/**
 * @function setPublishQueueHealthProvider
 * @description Installs (or removes) the scrape-time source for publish-queue
 *   attendance. It exists because a consumer outage now converts into sagas that
 *   WAIT rather than into terminal failures within ~35 s — more correct, and much
 *   quieter: nothing published a number for "work is queued and nobody is taking
 *   it", so the outage was invisible for a full horizon and then arrived as a
 *   cohort of timeouts.
 * @param provider - Reads the publish queue's health, or `undefined` to detach on
 *   shutdown. Detaching resets the count to UNKNOWN rather than to zero, so a
 *   stopped process cannot leave a stale "attended" reading behind either.
 */
export function setPublishQueueHealthProvider(provider: typeof publishQueueHealthProvider): void {
  publishQueueHealthProvider = provider;
  if (provider === undefined) {
    publishQueueConsumers.set(PUBLISH_QUEUE_UNKNOWN_CONSUMERS);
    publishQueueWaiting.set(0);
  }
}

const sagasDurationSeconds = getOrCreateHistogram(
  "sagas_duration_seconds",
  "End-to-end saga lifetime, from start to terminal state, by definition and outcome",
  ["definition_id", "status"],
  // Sized for what this engine really produces: a publish that advances on
  // worker events settles in seconds, while one whose completion event races
  // the queue's own state update waits a poll interval (30 s) — so the buckets
  // straddle 30 s and 60 s rather than clustering under a second, and the top
  // bucket sits above the 30-minute horizon so a terminalized saga still lands
  // in a bucket instead of only in +Inf.
  [1, 5, 15, 30, 45, 60, 120, 300, 900, 1800, 2400]
);

/**
 * @function recordSagaDuration
 * @description Observes one saga's total lifetime at the moment it reaches a
 *   terminal state. The SLO table named this series long before anything
 *   implemented it, so the budget it states was unmeasurable in production —
 *   and the one change that moved the number (a waiting step no longer giving
 *   up on its retry budget) could not be seen at all.
 * @param definitionId - Which saga definition ran.
 * @param status - The terminal state it reached.
 * @param durationMs - Milliseconds from `startedAt` to that terminal state.
 */
export function recordSagaDuration(
  definitionId: string,
  status: "COMPLETED" | "FAILED" | "COMPENSATED",
  durationMs: number
): void {
  sagasDurationSeconds.observe({ definition_id: definitionId, status }, durationMs / 1000);
}

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
