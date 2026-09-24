/**
 * @file outboxMetrics.ts
 * @description Prometheus series for the outbox relay's TERMINAL exit: the event that
 *              exhausted every redelivery and was archived to the dead-letter table.
 *
 *              Nothing published this fact. `OutboxLagHigh` watches a PENDING level, and
 *              a dead-lettered row is no longer pending — it leaves that gauge by
 *              succeeding at giving up. So the single outcome in which a domain event is
 *              permanently undelivered is exactly the outcome the existing outbox
 *              telemetry cannot see, and the admin dead-letter listing only answers
 *              somebody who is already looking.
 *
 *              Labelled by `event_type` because the remedy is per event: a dead-lettered
 *              billing event and a dead-lettered retraction alert are different
 *              obligations with different replays, and an unlabelled total would force an
 *              operator to open the table before knowing whether to care. Cardinality is
 *              bounded by the domain event catalogue, a closed set authored in this
 *              repository — not by tenant, aggregate or payload.
 *
 *              Shapes follow `retractionWindowMetrics.ts`: get-or-create so a module
 *              evaluated twice (test subprocesses sharing a registry) does not throw.
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

const deadLetteredTotal = getOrCreateCounter(
  "outbox_dead_lettered_total",
  "Outbox events that exhausted every redelivery and were archived to the dead-letter " +
    "table, by event type. Counted ONCE per row, by the relay that WON the archive: a " +
    "lease-expiry race makes the loser raise a unique-constraint violation over a row the " +
    "winner has already counted, so the loser counts nothing",
  ["event_type"]
);

/**
 * @function recordOutboxDeadLettered
 * @description Counts one event the relay stopped trying to deliver.
 * @param eventType - The domain event type of the archived row
 */
export function recordOutboxDeadLettered(eventType: string): void {
  deadLetteredTotal.inc({ event_type: eventType });
}
