/**
 * @file setupGuardrailUseCases.test.ts
 * @description Tests for the guardrail DI wiring: registers the two
 *              `GuardrailPort` instances and the `GuardrailRegistry`
 *              singleton against the canonical TOKENS, and the registry
 *              ends up wired with both ports in the expected order
 *              (ContentPolicy before PIIRedaction).
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { Container } from "../../../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../../../src/infrastructure/container/types.js";
import { setupGuardrailUseCases } from "../../../../src/infrastructure/container/setupGuardrailUseCases.js";
import type { GuardrailPort } from "../../../../src/domain/repositories/GuardrailPort.js";
import { GuardrailRegistry } from "../../../../src/application/guardrails/GuardrailRegistry.js";
import { ContentPolicyGuardrail } from "../../../../src/infrastructure/guardrails/ContentPolicyGuardrail.js";
import { PIIRedactionGuardrail } from "../../../../src/infrastructure/guardrails/PIIRedactionGuardrail.js";

describe("setupGuardrailUseCases", () => {
  it("registers the ContentPolicyGuardrail under the canonical token", () => {
    const container = new Container();
    setupGuardrailUseCases(container);

    const port = container.resolve<GuardrailPort>(TOKENS.GuardrailPort_ContentPolicy);
    expect(port).toBeInstanceOf(ContentPolicyGuardrail);
    expect(port.name).toBe("content-policy");
  });

  it("registers the PIIRedactionGuardrail under the canonical token", () => {
    const container = new Container();
    setupGuardrailUseCases(container);

    const port = container.resolve<GuardrailPort>(TOKENS.GuardrailPort_PIIRedaction);
    expect(port).toBeInstanceOf(PIIRedactionGuardrail);
    expect(port.name).toBe("pii-redaction");
  });

  it("registers the GuardrailRegistry as a singleton (same instance on every resolve)", () => {
    const container = new Container();
    setupGuardrailUseCases(container);

    const a = container.resolve<GuardrailRegistry>(TOKENS.GuardrailRegistry);
    const b = container.resolve<GuardrailRegistry>(TOKENS.GuardrailRegistry);

    expect(a).toBeInstanceOf(GuardrailRegistry);
    expect(a).toBe(b);
  });

  it("wires the registry with ContentPolicy first, then PIIRedaction", async () => {
    const container = new Container();
    setupGuardrailUseCases(container);

    const registry = container.resolve<GuardrailRegistry>(TOKENS.GuardrailRegistry);

    // A body that violates BOTH policies (long + banned term + email)
    // surfaces the ContentPolicy block first, since it runs first.
    const longBody = "click here free money " + "a".repeat(300) + " contact me@example.com";
    const decision = await registry.evaluate({ action: "send-reply", text: longBody });

    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.guardrailName).toBe("content-policy");
    }
  });

  it("allows clean text through both guardrails", async () => {
    const container = new Container();
    setupGuardrailUseCases(container);

    const registry = container.resolve<GuardrailRegistry>(TOKENS.GuardrailRegistry);

    const decision = await registry.evaluate({
      action: "send-reply",
      text: "Thanks for reaching out — we'll take a look soon.",
    });

    expect(decision.allow).toBe(true);
  });
});
