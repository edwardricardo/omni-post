/**
 * @file customerAuthSystemReasons.test.ts
 * @description Pins the declared system-context reason constants for the four customer
 *   pre-identity auth seams: the fixed-set `system:customer-*` form, mutual
 *   distinctness, and staticness (no request data can enter a constant, so the
 *   declared-bypass set stays bounded and grep-able — the property the
 *   tenant-context-boundaries A9 static scenario requires).
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";

import {
  CUSTOMER_REGISTER_SYSTEM_REASON,
  CUSTOMER_REFRESH_SYSTEM_REASON,
  CUSTOMER_REQUEST_PASSWORD_RESET_SYSTEM_REASON,
  CUSTOMER_RESET_PASSWORD_SYSTEM_REASON,
} from "../../../src/auth/customerAuthSystemReasons.js";

const ALL_REASONS = [
  CUSTOMER_REGISTER_SYSTEM_REASON,
  CUSTOMER_REFRESH_SYSTEM_REASON,
  CUSTOMER_REQUEST_PASSWORD_RESET_SYSTEM_REASON,
  CUSTOMER_RESET_PASSWORD_SYSTEM_REASON,
] as const;

describe("customerAuthSystemReasons", () => {
  it("declares exactly the four A9 seam reasons in the fixed system:customer-* form", () => {
    assert.deepStrictEqual(ALL_REASONS, [
      "system:customer-register",
      "system:customer-refresh",
      "system:customer-request-password-reset",
      "system:customer-reset-password",
    ] as const);
  });

  it("keeps every reason inside the bounded fixed-set grammar (no interpolation shapes)", () => {
    for (const reason of ALL_REASONS) {
      // The grammar a declared bypass must fit: a static kebab-case suffix under the
      // system:customer- namespace. A reason built from request data (ids, emails,
      // template braces, colons beyond the namespace) cannot match it.
      expect(reason).toMatch(/^system:customer-[a-z]+(-[a-z]+)*$/);
    }
  });

  it("declares no duplicate reasons — each seam is individually attributable", () => {
    assert.strictEqual(new Set(ALL_REASONS).size, ALL_REASONS.length);
  });
});
