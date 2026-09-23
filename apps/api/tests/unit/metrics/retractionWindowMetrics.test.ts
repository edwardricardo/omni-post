/**
 * @file retractionWindowMetrics.test.ts
 * @description Unit tests for the action-window sweep's two Prometheus series. What is
 *   worth pinning here is not that a counter increments — it is that the two counters
 *   stay SEPARATE and that neither carries a label. A build that merged them would still
 *   export a series and still scrape green while answering neither question: "is the
 *   deadline being enforced" and "are rows failing to settle" have opposite remedies,
 *   and a sweep can be healthy on one while dead on the other. The unlabelled shape is
 *   equally load-bearing: this counter is read as a LEVEL across ticks, so a label that
 *   split the level across arms would hide the flat non-zero reading that means the same
 *   rows are failing every pass.
 * @layer infrastructure
 */

import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import client from "prom-client";
import {
  recordActionWindowExpired,
  recordActionWindowSweepFailure,
} from "../../../src/metrics/retractionWindowMetrics.js";

const EXPIRED = "retraction_action_window_expired_total";
const FAILURES = "retraction_action_window_sweep_failures_total";

const valuesOf = async (name: string) => {
  const metric = client.register.getSingleMetric(name);
  assert.ok(metric, `${name} is not registered`);
  const collected = await metric.get();
  return collected.values;
};

const totalOf = async (name: string) => {
  const values = await valuesOf(name);
  return values.reduce((sum, v) => sum + v.value, 0);
};

describe("retractionWindowMetrics", () => {
  beforeEach(() => {
    // Reset THESE two, never the registry: `client.register.clear()` would drop every
    // other module's series for the rest of the process, and the absolute readings below
    // are what make a miscount visible.
    client.register.getSingleMetric(EXPIRED)?.reset();
    client.register.getSingleMetric(FAILURES)?.reset();
  });

  it("counts each closed action window once", async () => {
    recordActionWindowExpired();
    recordActionWindowExpired();
    recordActionWindowExpired();

    assert.strictEqual(await totalOf(EXPIRED), 3);
  });

  it("counts each row the sweep could not settle once", async () => {
    recordActionWindowSweepFailure();
    recordActionWindowSweepFailure();

    assert.strictEqual(await totalOf(FAILURES), 2);
  });

  it("keeps the two series independent, because their remedies are opposite", async () => {
    // A tick that closes windows cleanly and a tick that cannot settle a row are not the
    // same health signal. If a refactor ever routed both through one counter, this is the
    // assertion that notices.
    recordActionWindowExpired();

    assert.strictEqual(await totalOf(EXPIRED), 1);
    assert.strictEqual(await totalOf(FAILURES), 0);

    recordActionWindowSweepFailure();

    assert.strictEqual(await totalOf(EXPIRED), 1);
    assert.strictEqual(await totalOf(FAILURES), 1);
  });

  it("carries no labels on either series", async () => {
    // Deliberate, and pinned so a later label cannot arrive unnoticed. The failure count
    // is read as a level across ticks; splitting it by stage or cause would spread that
    // level across arms and hide the flat non-zero reading the runbook depends on, while
    // every arm would point at the same remedy — the row's own cause, in the ERROR log
    // emitted beside this counter.
    recordActionWindowExpired();
    recordActionWindowSweepFailure();

    for (const name of [EXPIRED, FAILURES]) {
      const values = await valuesOf(name);
      assert.strictEqual(values.length, 1, `${name} should export exactly one series`);
      assert.deepStrictEqual(values[0]?.labels, {}, `${name} should carry no labels`);
    }
  });

  it("survives a second evaluation of the module without throwing", async () => {
    // prom-client refuses a duplicate registration, and a test tree that loads this
    // module in more than one subprocess against a shared registry would hit exactly
    // that. The get-or-create shape is what prevents it, so re-importing must be a no-op
    // rather than a throw — and must not reset the counts either.
    recordActionWindowExpired();

    const reimported = await import("../../../src/metrics/retractionWindowMetrics.js");
    reimported.recordActionWindowExpired();

    assert.strictEqual(await totalOf(EXPIRED), 2);
  });
});
