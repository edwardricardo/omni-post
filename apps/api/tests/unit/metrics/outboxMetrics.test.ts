/**
 * @file outboxMetrics.test.ts
 * @description Unit tests for the outbox relay's dead-letter series. What is worth
 *   pinning here is not that a counter increments — it is that the series NAME and its
 *   ONE label survive refactoring, because they are the contract the
 *   `RetractionAlertEventDeadLettered` rule selects on
 *   (`prometheus/alerts/publish-record.yml`). That rule matches
 *   `outbox_dead_lettered_total{event_type=~"PostChannelRetractionAlert(Raised|Resolved)"}`,
 *   and a rename or a relabel breaks it SILENTLY: `increase()` over a series that no
 *   longer exists returns nothing, which is indistinguishable from calm. There is no
 *   compiler between this module and that rule file, so this suite is the only thing
 *   standing between the two.
 *
 *   The label being per event type is load-bearing on its own. A dead-lettered billing
 *   event and a dead-lettered retraction alert are different obligations with different
 *   replays, so a collapse to an unlabelled total would keep the rule's regex matching
 *   nothing while the metric still scraped green.
 * @layer infrastructure
 */

import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import client from "prom-client";
import { recordOutboxDeadLettered } from "../../../src/metrics/outboxMetrics.js";

const DEAD_LETTERED = "outbox_dead_lettered_total";

/** The exact series the alert rule selects on. */
const RAISED = "PostChannelRetractionAlertRaised";
const RESOLVED = "PostChannelRetractionAlertResolved";

const valuesOf = async (name: string) => {
  const metric = client.register.getSingleMetric(name);
  assert.ok(metric, `${name} is not registered`);
  const collected = await metric.get();
  return collected.values;
};

const valueFor = async (name: string, eventType: string) => {
  const values = await valuesOf(name);
  return values.find((v) => v.labels.event_type === eventType)?.value;
};

describe("outboxMetrics", () => {
  beforeEach(() => {
    // Reset THIS series, never the registry: `client.register.clear()` would drop every
    // other module's series for the rest of the process, and the absolute readings below
    // are what make a miscount visible.
    client.register.getSingleMetric(DEAD_LETTERED)?.reset();
  });

  it("exports the exact series name the alert rule selects on", async () => {
    // The rule file names this string and nothing verifies the pair but this assertion.
    recordOutboxDeadLettered(RAISED);

    assert.ok(
      client.register.getSingleMetric(DEAD_LETTERED),
      `${DEAD_LETTERED} must keep its name — prometheus/alerts/publish-record.yml selects it`
    );
  });

  it("labels every sample by event type, and by nothing else", async () => {
    // One label, exactly. An extra label would not break the rule's regex, but it would
    // split the series and change what `increase()` sums; a missing one makes the regex
    // match nothing at all while the metric still scrapes.
    recordOutboxDeadLettered(RAISED);

    const values = await valuesOf(DEAD_LETTERED);
    assert.strictEqual(values.length, 1, "exactly one series should be exported");
    assert.deepStrictEqual(values[0]?.labels, { event_type: RAISED });
  });

  it("keeps the two retraction alert event types on separate series", async () => {
    // The two halves mean opposite things to an operator: a dead-lettered Raised is a
    // customer never asked to remove live content; a dead-lettered Resolved is a standing
    // alert never withdrawn. Collapsing them would leave the runbook's first diagnostic
    // step — read the event_type label — with nothing to read.
    recordOutboxDeadLettered(RAISED);
    recordOutboxDeadLettered(RAISED);
    recordOutboxDeadLettered(RESOLVED);

    assert.strictEqual(await valueFor(DEAD_LETTERED, RAISED), 2);
    assert.strictEqual(await valueFor(DEAD_LETTERED, RESOLVED), 1);
  });

  it("does not export a series for an event type that never dead-lettered", async () => {
    // This is the blind spot the rule file and the runbook both name, pinned here so it
    // is a known property rather than a surprise: a labelled counter has NO series before
    // its first `inc`, so `increase()` over it cannot fire. Correct while nothing has
    // happened, and indistinguishable from a dead process.
    recordOutboxDeadLettered(RAISED);

    assert.strictEqual(await valueFor(DEAD_LETTERED, RESOLVED), undefined);
  });

  it("survives a second evaluation of the module without throwing", async () => {
    // prom-client refuses a duplicate registration, and a test tree that loads this
    // module in more than one subprocess against a shared registry hits exactly that. The
    // get-or-create shape is what prevents it, so a second evaluation must be a no-op
    // rather than a throw — and must not reset the counts either.
    //
    // The query suffix is load-bearing and NOT decoration: a plain `await import()` of a
    // path already imported at the top of this file returns the CACHED module and never
    // re-evaluates it, so it exercises no registration at all. Measured both ways —
    // with the get-or-create deleted, the plain form still passes and this form raises
    // "A metric with the name outbox_dead_lettered_total has already been registered."
    recordOutboxDeadLettered(RAISED);

    const reevaluated = await import("../../../src/metrics/outboxMetrics.js?reevaluate=1");
    reevaluated.recordOutboxDeadLettered(RAISED);

    assert.strictEqual(await valueFor(DEAD_LETTERED, RAISED), 2);
  });
});
