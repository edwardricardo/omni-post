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
