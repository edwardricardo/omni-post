/**
 * @file GuardrailRegistry.ts
 * @description Application-layer composer that runs a list of
 *              `GuardrailPort` implementations in cascade (fail-fast),
 *              wiring per-evaluation Prometheus metrics. Order matters:
 *              cheaper guardrails first so blocks short-circuit before
 *              more expensive checks run. The composition root registers
 *              `ContentPolicy` before `PIIRedaction` for that reason.
 * @layer application
 */

import type {
  GuardrailPort,
  GuardrailInput,
  GuardrailDecision,
} from "../../domain/repositories/GuardrailPort.js";
import type { GuardrailMetrics } from "../../metrics/guardrailMetrics.js";

export class GuardrailRegistry {
  constructor(
    private readonly guardrails: ReadonlyArray<GuardrailPort>,
    private readonly metrics?: GuardrailMetrics
  ) {}

  /**
   * @method evaluate
   * @description Runs each guardrail in order. Returns the first block
   *   decision encountered, or `{ allow: true }` if all pass. Each
   *   evaluation emits a Prometheus counter + histogram observation.
   * @param input - The action context to evaluate.
   * @returns The combined decision (first block wins; otherwise allow).
   */
  async evaluate(input: GuardrailInput): Promise<GuardrailDecision> {
    for (const guardrail of this.guardrails) {
      const start = process.hrtime.bigint();
      const decision = await guardrail.evaluate(input);
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;

      this.metrics?.recordEvaluation({
        guardrail: guardrail.name,
        action: input.action,
        decision: decision.allow ? "allow" : "block",
        durationSeconds,
      });

      if (!decision.allow) {
        return decision;
      }
    }
    return { allow: true };
  }
}
