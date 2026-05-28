/**
 * @file GuardrailEvaluationPort.ts
 * @description Application-layer port for evaluating content against guardrails
 *   (PII detection, toxicity, brand safety, glossary compliance) from outside
 *   the `guardrails` bounded context. Adapter lives in `@core/guardrails`
 *   and is wired in the composition root.
 *
 *   Resolves §5.1 cross-context violation `inbox -> guardrails` (2 imports:
 *   SendReplyUseCase + TriageInboxMessageUseCase). The `inbox` context used
 *   to import guardrail services directly from `@core/guardrails`;
 *   now it depends on this port instead and the composition root injects the
 *   guardrails adapter.
 *
 *   Workstream: §5.1 Normalization Roadmap — fullscope split.
 *
 * @layer domain
 */

export interface EvaluateGuardrailsInput {
  readonly accountId: string;
  readonly content: string;
  readonly contextHint?: "INBOX_REPLY" | "POST_DRAFT" | "TRIAGE" | undefined;
}

export type GuardrailViolationSeverity = "INFO" | "WARN" | "BLOCK";

export interface GuardrailViolation {
  readonly category: string;
  readonly severity: GuardrailViolationSeverity;
  readonly message: string;
}

export interface EvaluateGuardrailsResult {
  readonly violations: ReadonlyArray<GuardrailViolation>;
  readonly blocked: boolean;
}

export interface GuardrailEvaluationPort {
  evaluate(input: EvaluateGuardrailsInput): Promise<EvaluateGuardrailsResult>;
}
