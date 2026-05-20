/**
 * @file guardrailMetrics.ts
 * @description Prometheus instrumentation for the guardrail subsystem.
 *              Two metrics, registered against the shared `client.register`
 *              so they surface on the `/metrics` endpoint:
 *
 *                - `omnipost_guardrail_evaluations_total` (counter): every
 *                  evaluate call, labelled by guardrail name, action, and
 *                  decision (`allow` / `block`).
 *                - `omnipost_guardrail_duration_seconds` (histogram):
 *                  per-evaluation latency, labelled by guardrail and
 *                  action.
 *
 *              Registration is singleton-safe via `getSingleMetric` lookup
 *              so re-imports don't double-register against the registry.
 * @layer infrastructure
 */

import client from "prom-client";

const COUNTER_NAME = "omnipost_guardrail_evaluations_total";
const HISTOGRAM_NAME = "omnipost_guardrail_duration_seconds";

export type GuardrailMetricDecision = "allow" | "block";

/**
 * Wrapper exposing the two Prometheus metrics used by `GuardrailRegistry`.
 * Construct via `createGuardrailMetrics(register)` so test/dev runs can
 * pass an isolated registry; the production composition root uses
 * `client.register`.
 */
export interface GuardrailMetrics {
  recordEvaluation(params: {
    guardrail: string;
    action: string;
    decision: GuardrailMetricDecision;
    durationSeconds: number;
  }): void;
}

/**
 * @method createGuardrailMetrics
 * @description Returns a `GuardrailMetrics` view backed by Prometheus
 *   counters + histograms on the given registry. Idempotent w.r.t.
 *   `client.register` — if the metrics already exist (HMR, repeated
 *   bootstrap), the existing instances are reused instead of registering
 *   duplicates.
 * @param register - The Prometheus registry to attach metrics to.
 */
export function createGuardrailMetrics(register: client.Registry): GuardrailMetrics {
  const counter =
    (register.getSingleMetric(COUNTER_NAME) as client.Counter<string> | undefined) ??
    new client.Counter({
      name: COUNTER_NAME,
      help: "Total guardrail evaluations, labelled by guardrail, action, and decision.",
      labelNames: ["guardrail", "action", "decision"],
      registers: [register],
    });

  const histogram =
    (register.getSingleMetric(HISTOGRAM_NAME) as client.Histogram<string> | undefined) ??
    new client.Histogram({
      name: HISTOGRAM_NAME,
      help: "Guardrail evaluation latency in seconds, labelled by guardrail and action.",
      labelNames: ["guardrail", "action"],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [register],
    });

  return {
    recordEvaluation({ guardrail, action, decision, durationSeconds }) {
      counter.inc({ guardrail, action, decision });
      histogram.observe({ guardrail, action }, durationSeconds);
    },
  };
}
