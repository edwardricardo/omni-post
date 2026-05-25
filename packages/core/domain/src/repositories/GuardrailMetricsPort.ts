/**
 * @file GuardrailMetricsPort.ts
 * @description Application-layer port for recording guardrail evaluation
 *              metrics. `GuardrailRegistry` depends on this interface, not on
 *              the concrete Prometheus adapter (`createGuardrailMetrics`) that
 *              lives in infrastructure. Keeping the contract technology-free
 *              lets the registry run in tests/dev without a metrics backend.
 * @layer domain
 */

export type GuardrailMetricDecision = "allow" | "block";

/**
 * Contract for recording per-evaluation guardrail metrics. The infrastructure
 * adapter backs this with Prometheus counters + histograms; tests inject a
 * no-op or spy.
 */
export interface GuardrailMetrics {
  recordEvaluation(params: {
    guardrail: string;
    action: string;
    decision: GuardrailMetricDecision;
    durationSeconds: number;
  }): void;
}
