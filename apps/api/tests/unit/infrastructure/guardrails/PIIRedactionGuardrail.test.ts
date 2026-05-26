/**
 * @file PIIRedactionGuardrail.test.ts
 * @description Unit tests for the regex-based PII guardrail. Each PII
 *              kind (email / phone / SSN / credit-card with Luhn check)
 *              is covered with a positive case and at least one false-
 *              positive guard.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { PIIRedactionGuardrail } from "../../../../src/infrastructure/guardrails/PIIRedactionGuardrail.js";

const guardrail = new PIIRedactionGuardrail();

describe("PIIRedactionGuardrail", () => {
  it("exposes a stable name for metric labelling", () => {
    expect(guardrail.name).toBe("pii-redaction");
  });

  it("allows text without any PII", async () => {
    const decision = await guardrail.evaluate({
      action: "triage-suggestion",
      text: "Thanks for the feedback — we'll review and follow up soon.",
    });
    expect(decision.allow).toBe(true);
  });

  it("blocks text containing an email address", async () => {
    const decision = await guardrail.evaluate({
      action: "triage-suggestion",
      text: "Please reply to support@example.com for assistance.",
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.reason).toMatch(/email/);
      expect(decision.severity).toBe("high");
    }
  });

  it("blocks text containing an E.164 phone number", async () => {
    const decision = await guardrail.evaluate({
      action: "triage-suggestion",
      text: "Call +15551234567 anytime.",
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) expect(decision.reason).toMatch(/phone/);
  });

  it("blocks text containing a US local phone number", async () => {
    const decision = await guardrail.evaluate({
      action: "triage-suggestion",
      text: "Call (555) 123-4567 anytime.",
    });
    expect(decision.allow).toBe(false);
  });

  it("blocks text containing an SSN", async () => {
    const decision = await guardrail.evaluate({
      action: "triage-suggestion",
      text: "My SSN is 123-45-6789, please update.",
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) expect(decision.reason).toMatch(/SSN/);
  });

  it("blocks text containing a Luhn-valid credit card", async () => {
    // 4111 1111 1111 1111 is a canonical Visa test number (Luhn-valid).
    const decision = await guardrail.evaluate({
      action: "triage-suggestion",
      text: "Card 4111 1111 1111 1111 was declined.",
    });
    expect(decision.allow).toBe(false);
    if (!decision.allow) expect(decision.reason).toMatch(/credit card/);
  });

  it("allows 16-digit numeric strings that fail the Luhn check (CC false-positive guard)", async () => {
    // 16 digits (CC candidate length) but Luhn-invalid, and >15 digits
    // so it does not match the phone E.164 regex either.
    const decision = await guardrail.evaluate({
      action: "triage-suggestion",
      text: "Order 9999999999999999 was queued for review.",
    });
    expect(decision.allow).toBe(true);
  });

  it("does not flag short numeric strings as phone numbers", async () => {
    const decision = await guardrail.evaluate({
      action: "triage-suggestion",
      text: "We have 250 followers and 42 likes.",
    });
    expect(decision.allow).toBe(true);
  });
});
