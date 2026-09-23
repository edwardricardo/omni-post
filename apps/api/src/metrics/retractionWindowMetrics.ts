/**
 * @file retractionWindowMetrics.ts
 * @description Prometheus series for the action-window sweep — the tick that finalizes
 *              a channel whose customer never removed the content they were asked to
 *              remove.
 *
 *              A SECOND module rather than two more counters in
 *              `retractionAlertMetrics.ts`, because that file answers one question —
 *              was the customer REACHED — and these answer a different one: is the
 *              deadline actually being enforced. The two fail independently. Alerts can
 *              be delivered perfectly while the sweep has been dead for a week, and a
 *              sweep can be healthy while nobody was ever told.
 *
 *              The failure counter is read as a LEVEL across ticks, not as a total. A
 *              row whose write keeps failing is re-selected on every pass, so a flat
 *              non-zero reading means the same rows are failing repeatedly — and since
 *              discovery takes one bounded page oldest-first, enough of them starve the
 *              younger rows behind. The remedy is that row's cause, which the ERROR log
 *              beside this counter names; a bigger page would only hide it.
 *
 *              Shapes follow `retractionAlertMetrics.ts`: get-or-create so a module
 *              evaluated twice (test subprocesses sharing a registry) does not throw.
 * @layer infrastructure
 */
import client from "prom-client";

function getOrCreateCounter(name: string, help: string): client.Counter {
  const existing = client.register.getSingleMetric(name);
  if (existing) return existing as client.Counter;
  return new client.Counter({ name, help });
}

const expiredTotal = getOrCreateCounter(
  "retraction_action_window_expired_total",
  "Channel action windows the sweep CLOSED. Each one finalizes a channel as excluded " +
    "with cause ACTION_WINDOW_EXPIRED and resolves its standing alert; the live " +
    "fragments and the content lock are untouched, so this counts obligations that " +
    "stopped being asked about, never content that came down"
);

const sweepFailuresTotal = getOrCreateCounter(
  "retraction_action_window_sweep_failures_total",
  "Rows the sweep selected and could NOT settle. Unlabelled on purpose: every arm " +
    "would be the same remedy, which is the row's own cause in the ERROR log emitted " +
    "beside it. Read as a level across ticks — a flat non-zero reading is the same rows " +
    "failing every pass, and a bounded oldest-first page means enough of them starve " +
    "the younger windows behind"
);

/**
 * @function recordActionWindowExpired
 * @description Counts one channel whose action window the sweep closed.
 */
export function recordActionWindowExpired(): void {
  expiredTotal.inc();
}

/**
 * @function recordActionWindowSweepFailure
 * @description Counts one selected row the sweep could not settle.
 */
export function recordActionWindowSweepFailure(): void {
  sweepFailuresTotal.inc();
}
