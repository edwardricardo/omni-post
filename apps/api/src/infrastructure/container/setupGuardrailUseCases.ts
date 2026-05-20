/**
 * @file setupGuardrailUseCases.ts
 * @description DI registrations for the guardrail subsystem: registers
 *              the two `GuardrailPort` implementations and the
 *              `GuardrailRegistry` composer, wired with the Prometheus
 *              metrics built on the shared `client.register`. Order in
 *              the registry is intentional: `ContentPolicy` (rules,
 *              sub-millisecond) before `PIIRedaction` (regex), so cheap
 *              blocks short-circuit before more expensive checks.
 * @layer infrastructure
 */

import client from "prom-client";

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { GuardrailPort } from "../../domain/repositories/GuardrailPort.js";
import { ContentPolicyGuardrail } from "../guardrails/ContentPolicyGuardrail.js";
import { PIIRedactionGuardrail } from "../guardrails/PIIRedactionGuardrail.js";
import { GuardrailRegistry } from "../../application/guardrails/GuardrailRegistry.js";
import { createGuardrailMetrics } from "../../metrics/guardrailMetrics.js";

/**
 * @method setupGuardrailUseCases
 * @description Registers guardrail ports + registry. Idempotent: safe to
 *   call once per process from the composition root.
 */
export function setupGuardrailUseCases(container: Container): void {
  container.registerInstance<GuardrailPort>(
    TOKENS.GuardrailPort_ContentPolicy,
    new ContentPolicyGuardrail()
  );

  container.registerInstance<GuardrailPort>(
    TOKENS.GuardrailPort_PIIRedaction,
    new PIIRedactionGuardrail()
  );

  container.register<GuardrailRegistry>(
    TOKENS.GuardrailRegistry,
    () =>
      new GuardrailRegistry(
        [
          container.resolve<GuardrailPort>(TOKENS.GuardrailPort_ContentPolicy),
          container.resolve<GuardrailPort>(TOKENS.GuardrailPort_PIIRedaction),
        ],
        createGuardrailMetrics(client.register)
      ),
    true
  );
}
