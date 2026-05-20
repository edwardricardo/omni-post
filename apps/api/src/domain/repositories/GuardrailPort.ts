/**
 * @file GuardrailPort.ts
 * @description Domain port for content/policy guardrails. Each
 *              implementation evaluates a `GuardrailInput` and returns
 *              `{ allow: true }` or `{ allow: false, ...reason }`. The
 *              `GuardrailRegistry` (application layer) composes multiple
 *              guardrails in cascade.
 * @layer domain
 */

/**
 * Action being guarded. Stable string identifiers used as metric labels.
 * Open-ended (`string`) so new sites can add their own without changing
 * the port, but the canonical set is the literal union of known actions.
 */
export type GuardrailAction = "send-reply" | "triage-suggestion" | string;

/**
 * Severity classification a guardrail attaches to a block decision. Drives
 * metric labelling and downstream routing (future HITL: high-severity may
 * route to human review instead of hard block).
 */
export type GuardrailSeverity = "low" | "medium" | "high";

/**
 * Input passed to every guardrail's `evaluate` method. Carries the text
 * under review plus the action context (which use case, which account,
 * any additional structured context).
 */
export interface GuardrailInput {
  action: GuardrailAction;
  text: string;
  accountId?: string;
  context?: Record<string, unknown>;
}

/**
 * Decision returned by a guardrail. Discriminated union:
 *
 * - `{ allow: true }` — proceed.
 * - `{ allow: false, guardrailName, reason, severity }` — block; caller
 *   typically returns a `UseCaseError(USE_CASE_ERRORS.GUARDRAIL_REJECTED)`.
 */
export type GuardrailDecision =
  | { allow: true }
  | {
      allow: false;
      guardrailName: string;
      reason: string;
      severity: GuardrailSeverity;
    };

/**
 * @interface GuardrailPort
 * @description Single guardrail contract. Implementations live in the
 *              infrastructure layer (rules-based, regex, LLM-judge, etc).
 *              The application-layer `GuardrailRegistry` composes them.
 */
export interface GuardrailPort {
  /**
   * Stable identifier used as a metric label and as the `guardrailName`
   * field in block decisions. Must be unique across the registry.
   */
  readonly name: string;

  /**
   * @method evaluate
   * @description Decides whether the input is allowed. Implementations
   *   are deterministic w.r.t. their declared rules and never raise —
   *   they signal failure by returning `{ allow: false, ... }`.
   * @param input - Text + action context to evaluate.
   * @returns Promise resolving to an allow/block decision.
   */
  evaluate(input: GuardrailInput): Promise<GuardrailDecision>;
}
