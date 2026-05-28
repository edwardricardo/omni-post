/**
 * @file SecurityClassifierPort.ts
 * @description Application-layer port for risk classification of AI requests
 *   (prompt injection detection, abuse signals, PII leakage). Adapter lives
 *   in `@core/security` and is wired in the composition root.
 *
 *   Resolves §5.1 cross-context violation `ai -> security`. The `ai` context
 *   used to import `PromptShieldService` directly from `@core/application/security`;
 *   now it depends on this port instead and the composition root injects the
 *   security adapter.
 *
 *   Workstream: §5.1 Normalization Roadmap — fullscope split.
 *
 * @layer domain
 */

export interface ClassifySecurityRiskInput {
  readonly accountId: string;
  readonly prompt: string;
  readonly modelHint?: string | undefined;
}

export type SecurityRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "BLOCK";

export interface ClassifySecurityRiskResult {
  readonly riskLevel: SecurityRiskLevel;
  readonly reasons: ReadonlyArray<string>;
  readonly blocked: boolean;
}

export interface SecurityClassifierPort {
  classify(input: ClassifySecurityRiskInput): Promise<ClassifySecurityRiskResult>;
}
