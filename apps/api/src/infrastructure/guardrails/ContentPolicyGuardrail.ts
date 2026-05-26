/**
 * @file ContentPolicyGuardrail.ts
 * @description Rules-based guardrail. Enforces per-action maximum length
 *              and rejects text containing banned terms. No LLM, no DB —
 *              deterministic and sub-millisecond.
 * @layer infrastructure
 */

import type {
  GuardrailPort,
  GuardrailInput,
  GuardrailDecision,
  GuardrailAction,
} from "@core/domain/repositories/GuardrailPort.js";

/**
 * Per-action maximum length. `send-reply` honours the smallest canonical
 * provider limit (X = 280); larger providers (IG = 2200) accept the same
 * lower bound, so 280 acts as a safe ceiling across the fleet. Other
 * actions fall back to `DEFAULT_MAX_LENGTH`.
 */
const MAX_LENGTH_BY_ACTION: Record<string, number> = {
  "send-reply": 280,
  "triage-suggestion": 500,
};

const DEFAULT_MAX_LENGTH = 1000;

const BANNED_TERMS: ReadonlyArray<string> = [
  "spam",
  "click here",
  "free money",
  "buy now act fast",
  "guaranteed win",
];

export class ContentPolicyGuardrail implements GuardrailPort {
  readonly name = "content-policy";

  async evaluate(input: GuardrailInput): Promise<GuardrailDecision> {
    const max = this.maxLengthFor(input.action);
    if (input.text.length > max) {
      return {
        allow: false,
        guardrailName: this.name,
        reason: `Text exceeds maximum length for ${input.action} (${input.text.length} > ${max})`,
        severity: "low",
      };
    }

    const lower = input.text.toLowerCase();
    for (const term of BANNED_TERMS) {
      if (lower.includes(term)) {
        return {
          allow: false,
          guardrailName: this.name,
          reason: `Text contains banned term`,
          severity: "medium",
        };
      }
    }

    return { allow: true };
  }

  private maxLengthFor(action: GuardrailAction): number {
    return MAX_LENGTH_BY_ACTION[action] ?? DEFAULT_MAX_LENGTH;
  }
}
