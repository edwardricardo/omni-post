/**
 * @file GuardrailPort.test.ts
 * @description Contract tests for the `GuardrailPort` domain port:
 *              implementations expose a stable `name`, return a typed
 *              decision shape, and the discriminated union narrows
 *              correctly on `allow`.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import type {
  GuardrailPort,
  GuardrailDecision,
  GuardrailInput,
  GuardrailAction,
  GuardrailSeverity,
} from "@core/domain/repositories/GuardrailPort.js";

function makePort(decision: GuardrailDecision, name = "test-port"): GuardrailPort {
  return {
    name,
    evaluate: async () => decision,
  };
}

describe("GuardrailPort contract", () => {
  it("exposes a readonly `name` on the implementation", () => {
    const port = makePort({ allow: true }, "my-name");
    expect(port.name).toBe("my-name");
  });

  it("returns an allow decision with a single discriminator", async () => {
    const port = makePort({ allow: true });
    const decision = await port.evaluate({ action: "send-reply", text: "hi" });
    expect(decision.allow).toBe(true);
    if (decision.allow) {
      // The allow branch has no extra fields — narrowing succeeds.
      expect(Object.keys(decision)).toEqual(["allow"]);
    }
  });

  it("returns a block decision with guardrailName, reason, and severity", async () => {
    const port = makePort({
      allow: false,
      guardrailName: "test-port",
      reason: "test reason",
      severity: "medium",
    });

    const decision = await port.evaluate({ action: "send-reply", text: "bad" });

    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.guardrailName).toBe("test-port");
      expect(decision.reason).toBe("test reason");
      const allowedSeverities: GuardrailSeverity[] = ["low", "medium", "high"];
      expect(allowedSeverities).toContain(decision.severity);
    }
  });

  it("accepts the canonical action literals and arbitrary action strings", () => {
    const canonical: GuardrailAction = "send-reply";
    const canonical2: GuardrailAction = "triage-suggestion";
    const customAction: GuardrailAction = "future-custom-action";

    expect(canonical).toBe("send-reply");
    expect(canonical2).toBe("triage-suggestion");
    expect(customAction).toBe("future-custom-action");
  });

  it("accepts an optional accountId and context on the input", async () => {
    const port = makePort({ allow: true });
    const input: GuardrailInput = {
      action: "send-reply",
      text: "hello",
      accountId: "acc-1",
      context: { hint: "extra" },
    };

    const decision = await port.evaluate(input);
    expect(decision.allow).toBe(true);
  });
});
