/**
 * @file retractionAlertMetrics.ts
 * @description Prometheus series for the question the retraction alert cannot answer
 *              from logs alone: was the customer actually REACHED?
 *
 *              The alert obliges a manual act on a third-party platform, so "not
 *              delivered" is never one fact. A member who switched the type off, a
 *              project with no team channel configured, and a medium this application
 *              cannot reach at all are three different situations with three different
 *              answers, and collapsing them into one counter would make the only useful
 *              question — why was nobody reached — unanswerable at exactly the moment
 *              it matters.
 *
 *              Shapes follow `deletionMetrics.ts`: get-or-create so a module evaluated
 *              twice (test subprocesses sharing a registry) does not throw.
 * @layer infrastructure
 */
import client from "prom-client";

function getOrCreateCounter(
  name: string,
  help: string,
  labelNames: readonly string[]
): client.Counter {
  const existing = client.register.getSingleMetric(name);
  if (existing) return existing as client.Counter;
  return new client.Counter({ name, help, labelNames: [...labelNames] });
}

const deliveryTotal = getOrCreateCounter(
  "retraction_alert_delivery_total",
  "Retraction alert delivery outcomes, by medium and result. The three not-delivered " +
    "results are kept apart deliberately: suppressed-by-preference is the customer's own " +
    "choice, no-active-config is a destination never set up, and unavailable is a medium " +
    "with no adapter in this build",
  ["medium", "result"]
);

const noRecipientTotal = getOrCreateCounter(
  "retraction_alert_no_recipient_total",
  "Retraction alerts raised for a project and account with NO customer user to address. " +
    "Non-zero means content is stranded on a platform and the per-member media reached " +
    "nobody — the shared destinations may still have carried it",
  []
);

const contextDegradedTotal = getOrCreateCounter(
  "retraction_alert_context_degraded_total",
  "Retraction alerts whose human-readable context could not be resolved and fell back to an " +
    "identifier, by field. The alert still goes out — the obligation exists whether or not a " +
    "title loads — but a run of these means customers are being asked to remove 'Post <uuid>', " +
    "which is not something they can recognise",
  ["field"]
);

const realtimePushFailedTotal = getOrCreateCounter(
  "retraction_alert_realtime_push_failed_total",
  "In-app retraction alerts whose notification row was stored but whose LIVE push to " +
    "open sessions failed. The alert is delivered — the dashboard reads the row — so this " +
    "is not a failed delivery and its ledger claim is kept; what it costs is immediacy, " +
    "and a run of these means customers see the alert only on their next page load",
  []
);

const refusedTotal = getOrCreateCounter(
  "retraction_alert_refused_total",
  "Retraction alert events REFUSED before any delivery was attempted, by the field the " +
    "payload did not name. A refusal is not a retry: the same bytes would be refused " +
    "again, so the alert is not delivered at all and nothing tries later. Non-zero means " +
    "a producer is emitting events this consumer cannot act on, and content may be live " +
    "on a platform with nobody told. Counted ONCE per refused event, labelled by the " +
    "first field missing in the order tenant, alert key, channel, project",
  ["reason"]
);

/**
 * @function recordAlertRefused
 * @description Counts one event refused for naming too little to act on.
 * @param reason - The field that was missing: `missing-tenant`, `missing-alert-key`,
 *   `missing-channel` or `missing-project`
 */
export function recordAlertRefused(reason: string): void {
  refusedTotal.inc({ reason });
}

/**
 * @function recordAlertRealtimePushFailed
 * @description Counts one stored alert whose live push did not reach the session.
 */
export function recordAlertRealtimePushFailed(): void {
  realtimePushFailedTotal.inc();
}

/**
 * @function recordAlertContextDegraded
 * @description Counts one field that fell back to an identifier.
 * @param field - Which lookup degraded: `post`, `channel` or `account`
 */
export function recordAlertContextDegraded(field: string): void {
  contextDegradedTotal.inc({ field });
}

/**
 * @function recordAlertDelivery
 * @description Counts one delivery outcome.
 * @param medium - The medium the alert was carried on
 * @param result - What happened to it
 */
export function recordAlertDelivery(medium: string, result: string): void {
  deliveryTotal.inc({ medium, result });
}

/**
 * @function recordAlertWithoutRecipient
 * @description Counts an alert that found nobody to address.
 */
export function recordAlertWithoutRecipient(): void {
  noRecipientTotal.inc();
}
