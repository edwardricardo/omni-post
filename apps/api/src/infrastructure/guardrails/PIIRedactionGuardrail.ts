/**
 * @file PIIRedactionGuardrail.ts
 * @description Guardrail that blocks input/output containing personally
 *              identifiable information — email, phone, SSN, credit-card.
 *              Credit-card detection adds a Luhn check on top of the
 *              13-19-digit pattern to drop false positives such as long
 *              numeric timestamps or order IDs.
 * @layer infrastructure
 */

import type {
  GuardrailPort,
  GuardrailInput,
  GuardrailDecision,
} from "@core/domain/repositories/GuardrailPort.js";

// Simplified RFC 5322 — sufficient to catch the common shapes without
// dragging in the full grammar.
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

// E.164 (+1234567890123) — between 8 and 15 digits, optional leading +.
// Bounded length avoids matching arbitrary integer runs in normal prose.
const PHONE_E164_RE = /(?:\+|\b)[1-9]\d{7,14}\b/;

// US local "(555) 123-4567" / "555-123-4567" with optional area code.
const PHONE_US_LOCAL_RE = /\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/;

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;

// Credit-card candidates: 13-19 digits, optionally separated by spaces or
// dashes (typical formats: AmEx 15, Visa/Mastercard 16). We extract digit
// runs and verify with Luhn.
const CC_CANDIDATE_RE = /\b(?:\d[ -]?){12,18}\d\b/g;

/**
 * Luhn checksum verifier. Returns true when `digits` (string of decimal
 * characters, no separators) satisfies the Luhn algorithm. Used to filter
 * out non-card numeric sequences (timestamps, long IDs) from the
 * credit-card regex match set.
 */
function luhnCheck(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits.charAt(i), 10);
    if (Number.isNaN(n)) return false;
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export class PIIRedactionGuardrail implements GuardrailPort {
  readonly name = "pii-redaction";

  async evaluate(input: GuardrailInput): Promise<GuardrailDecision> {
    if (EMAIL_RE.test(input.text)) {
      return this.block("email");
    }

    if (SSN_RE.test(input.text)) {
      return this.block("SSN");
    }

    if (PHONE_E164_RE.test(input.text) || PHONE_US_LOCAL_RE.test(input.text)) {
      return this.block("phone number");
    }

    for (const candidate of input.text.matchAll(CC_CANDIDATE_RE)) {
      const digits = candidate[0].replace(/[ -]/g, "");
      if (luhnCheck(digits)) {
        return this.block("credit card number");
      }
    }

    return { allow: true };
  }

  private block(piiKind: string): GuardrailDecision {
    return {
      allow: false,
      guardrailName: this.name,
      reason: `Text contains potential ${piiKind}`,
      severity: "high",
    };
  }
}
