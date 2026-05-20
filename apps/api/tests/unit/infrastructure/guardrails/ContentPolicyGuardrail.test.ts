/**
 * @file ContentPolicyGuardrail.test.ts
 * @description Unit tests for the rules-based content-policy guardrail.
 *              Covers per-action max length, banned-terms detection
 *              (case-insensitive), and the allow path for normal text.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { ContentPolicyGuardrail } from "../../../../src/infrastructure/guardrails/ContentPolicyGuardrail.js";

const guardrail = new ContentPolicyGuardrail();

describe("ContentPolicyGuardrail", () => {
  it("exposes a stable name for metric labelling", () => {
    expect(guardrail.name).toBe("content-policy");
  });

  it("allows normal text within the action's length budget", async () => {
    const decision = await guardrail.evaluate({
      action: "send-reply",
      text: "Thanks for reaching out — happy to help.",
    });
    expect(decision.allow).toBe(true);
  });

  it("blocks send-reply text exceeding the 280-char ceiling", async () => {
    const decision = await guardrail.evaluate({
      action: "send-reply",
      text: "a".repeat(281),
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.guardrailName).toBe("content-policy");
      expect(decision.reason).toMatch(/exceeds maximum length/);
      expect(decision.severity).toBe("low");
    }
  });

  it("blocks triage-suggestion text exceeding the 500-char ceiling", async () => {
    const decision = await guardrail.evaluate({
      action: "triage-suggestion",
      text: "a".repeat(501),
    });
    expect(decision.allow).toBe(false);
  });

  it("applies the default fallback length for unknown actions", async () => {
    const within = await guardrail.evaluate({ action: "custom-action", text: "a".repeat(999) });
    expect(within.allow).toBe(true);

    const beyond = await guardrail.evaluate({ action: "custom-action", text: "a".repeat(1001) });
    expect(beyond.allow).toBe(false);
  });

  it("blocks text containing a banned term (case-insensitive)", async () => {
    const decision = await guardrail.evaluate({
      action: "send-reply",
      text: "Hello! Click HERE to win.",
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.severity).toBe("medium");
    }
  });

  it("returns the first matching reason (length wins over banned term)", async () => {
    const decision = await guardrail.evaluate({
      action: "send-reply",
      text: ("spam " + "a".repeat(290)).slice(0, 290),
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.reason).toMatch(/exceeds maximum length/);
    }
  });
});
