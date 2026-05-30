/**
 * @file GuardrailEvaluationPort.ts
 * @description Port for evaluating content against the composed guardrail
 *   registry from outside the `guardrails` bounded context. Adapter wraps
 *   `GuardrailRegistry` from `@core/guardrails` and is wired in the
 *   composition root.
 *
 *   Reuses the domain `GuardrailInput` / `GuardrailDecision` types from
 *   `@core/domain/repositories/GuardrailPort.js` (the per-guardrail port).
 *   The application-level `GuardrailRegistry.evaluate(...)` returns the
 *   same `GuardrailDecision` shape, so the port mirrors that contract.
 *
 * @layer domain
 */

import type { GuardrailInput, GuardrailDecision } from "@core/domain/repositories/GuardrailPort.js";

export interface GuardrailEvaluationPort {
  /**
   * Evaluate content against the composed guardrail registry. The decision
   * carries the action (`block` / `warn` / `allow`) plus the list of triggered
   * rules so callers can surface diagnostics to the editor or audit trail.
   */
  evaluate(input: GuardrailInput): Promise<GuardrailDecision>;
}
