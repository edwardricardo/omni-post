/**
 * @file retractionAlertMetrics.test.ts
 * @description Unit tests for the retraction alert's two Prometheus series. What is
 *   worth pinning is that the three not-delivered results stay SEPARATE label values:
 *   a build that collapsed them would still export a counter, still scrape green, and
 *   still be unable to answer the only question an operator asks — why was the customer
 *   not reached.
 * @layer infrastructure
 */

import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import client from "prom-client";
import {
  recordAlertContextDegraded,
  recordAlertDelivery,
  recordAlertWithoutRecipient,
} from "../../../src/metrics/retractionAlertMetrics.js";

const valuesOf = async (name: string) => {
  const metric = client.register.getSingleMetric(name);
  assert.ok(metric, `${name} is not registered`);
  const collected = await metric.get();
  return collected.values;
};

describe("retractionAlertMetrics", () => {
  beforeEach(() => {
    client.register.getSingleMetric("retraction_alert_delivery_total")?.reset();
    client.register.getSingleMetric("retraction_alert_no_recipient_total")?.reset();
    client.register.getSingleMetric("retraction_alert_context_degraded_total")?.reset();
  });

  it("counts a delivery under its medium and result", async () => {
    recordAlertDelivery("in-app", "delivered");
    recordAlertDelivery("in-app", "delivered");

    const values = await valuesOf("retraction_alert_delivery_total");
    const inApp = values.find(
      (v) => v.labels.medium === "in-app" && v.labels.result === "delivered"
    );
    assert.strictEqual(inApp?.value, 2);
  });

  it("keeps the three not-delivered reasons as distinct series", async () => {
    recordAlertDelivery("email", "suppressed-by-preference");
    recordAlertDelivery("slack-teams", "no-active-config");
    recordAlertDelivery("sms", "unavailable");

    const values = await valuesOf("retraction_alert_delivery_total");
    const results = values.map((v) => v.labels.result);
    assert.ok(results.includes("suppressed-by-preference"));
    assert.ok(results.includes("no-active-config"));
    assert.ok(results.includes("unavailable"));
    assert.strictEqual(new Set(results).size, 3, "two reasons collapsed into one series");
  });

  it("counts an alert that found nobody to address", async () => {
    recordAlertWithoutRecipient();

    const values = await valuesOf("retraction_alert_no_recipient_total");
    assert.strictEqual(values[0]?.value, 1);
  });

  describe("degraded context", () => {
    it("counts a degraded read under the field that could not be resolved", async () => {
      recordAlertContextDegraded("post");
      recordAlertContextDegraded("post");
      recordAlertContextDegraded("channel");

      const values = await valuesOf("retraction_alert_context_degraded_total");
      const post = values.find((v) => v.labels.field === "post");
      const channel = values.find((v) => v.labels.field === "channel");
      assert.strictEqual(post?.value, 2);
      assert.strictEqual(channel?.value, 1);
    });
  });
});
