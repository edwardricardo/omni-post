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
  evaluate(input: GuardrailInput): Promise<GuardrailDecision>;
}
