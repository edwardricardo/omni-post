/**
 * @file guardrailMetrics.test.ts
 * @description Unit tests for the Prometheus instrumentation: counter
 *              increments with the expected label set, histogram observes
 *              durations, and re-creation on the same registry is
 *              idempotent (HMR / test re-import safety).
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import client from "prom-client";
import { createGuardrailMetrics } from "../../../src/metrics/guardrailMetrics.js";

function freshRegister(): client.Registry {
  const register = new client.Registry();
  return register;
}

describe("createGuardrailMetrics", () => {
  it("increments the counter with the expected labels on each evaluation", async () => {
    const register = freshRegister();
    const metrics = createGuardrailMetrics(register);

    metrics.recordEvaluation({
      guardrail: "content-policy",
      action: "send-reply",
      decision: "allow",
      durationSeconds: 0.01,
    });
    metrics.recordEvaluation({
      guardrail: "content-policy",
      action: "send-reply",
      decision: "block",
      durationSeconds: 0.02,
    });

    const counter = register.getSingleMetric("omnipost_guardrail_evaluations_total");
    expect(counter).toBeDefined();
    const json = (await counter!.get()).values;
    const allowVal = json.find(
      (v) =>
        v.labels["guardrail"] === "content-policy" &&
        v.labels["action"] === "send-reply" &&
        v.labels["decision"] === "allow"
    );
    const blockVal = json.find(
      (v) =>
        v.labels["guardrail"] === "content-policy" &&
        v.labels["action"] === "send-reply" &&
        v.labels["decision"] === "block"
    );
    expect(allowVal?.value).toBe(1);
    expect(blockVal?.value).toBe(1);
  });

  it("observes durations on the histogram", async () => {
    const register = freshRegister();
    const metrics = createGuardrailMetrics(register);

    metrics.recordEvaluation({
      guardrail: "pii-redaction",
      action: "triage-suggestion",
      decision: "allow",
      durationSeconds: 0.005,
    });

    const histogram = register.getSingleMetric("omnipost_guardrail_duration_seconds");
    expect(histogram).toBeDefined();
    const json = (await histogram!.get()).values;
    const countMetric = json.find(
      (v) =>
        v.metricName?.endsWith("_count") &&
        v.labels["guardrail"] === "pii-redaction" &&
        v.labels["action"] === "triage-suggestion"
    );
    expect(countMetric?.value).toBe(1);
  });

  it("is idempotent when called twice on the same registry (HMR safety)", () => {
    const register = freshRegister();
    const first = createGuardrailMetrics(register);
    const second = createGuardrailMetrics(register);

    // Both should record without throwing a duplicate-registration error.
    first.recordEvaluation({
      guardrail: "content-policy",
      action: "send-reply",
      decision: "allow",
      durationSeconds: 0.001,
    });
    second.recordEvaluation({
      guardrail: "content-policy",
      action: "send-reply",
      decision: "allow",
      durationSeconds: 0.001,
    });

    expect(register.getSingleMetric("omnipost_guardrail_evaluations_total")).toBeDefined();
  });
});
