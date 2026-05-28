/**
 * @file GuardrailEvaluationAdapter.ts
 * @description Composition-root adapter implementing `GuardrailEvaluationPort`
 *   by delegating to the `guardrails` bounded context's `GuardrailRegistry`.
 *   Pure passthrough — `GuardrailRegistry.evaluate(...)` already matches the
 *   port shape exactly (domain `GuardrailInput` → `GuardrailDecision`).
 * @layer infrastructure
 */

import type { GuardrailEvaluationPort } from "@ports/core";
import type { GuardrailInput, GuardrailDecision } from "@core/domain/repositories/GuardrailPort.js";
import type { GuardrailRegistry } from "@core/guardrails/GuardrailRegistry.js";

export class GuardrailEvaluationAdapter implements GuardrailEvaluationPort {
  constructor(private readonly registry: GuardrailRegistry) {}

  evaluate(input: GuardrailInput): Promise<GuardrailDecision> {
    return this.registry.evaluate(input);
  }
}
