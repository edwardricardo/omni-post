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
 * Background loop whose failure is being counted.
 *
 * - `boot` — the crash-recovery load that runs once per process start.
 * - `retry-scan` — the scheduled scan for sagas whose retry is due.
 * - `timeout` — the scheduled timeout checker, per saga it inspects.
 * - `instance-load` — the by-id read behind every resume trigger.
 * - `rehydration` — a saga whose owning account could not be resolved.
 * - `mismatch` — a saga whose column and context name different accounts.
 */
export type SagaRecoveryLoop =
  "boot" | "retry-scan" | "timeout" | "instance-load" | "rehydration" | "mismatch";

/** Why a saga reached its terminal FAILED state. */
export type SagaFailureReason =
  "step-failure" | "timeout" | "unresolvable-account" | "tenant-mismatch";

const sagaRecoveryFailuresTotal = getOrCreateCounter(
  "saga_recovery_failures_total",
  "Saga background-loop failures, by loop",
  ["loop"]
);

const sagasFailedTotal = getOrCreateCounter(
  "sagas_failed_total",
  "Sagas that reached the terminal FAILED state, by reason",
  ["reason"]
);

/**
 * @function recordSagaRecoveryFailure
 * @description Counts one failure of a saga background loop. A non-zero rate
 *   means the engine lost visibility of in-flight sagas or skipped work it could
 *   not scope — neither is distinguishable from an idle loop without this.
 * @param loop - The loop that failed.
 */
export function recordSagaRecoveryFailure(loop: SagaRecoveryLoop): void {
  sagaRecoveryFailuresTotal.inc({ loop });
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
