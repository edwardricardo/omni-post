/**
 * @file adminAuthErrorMessageKey.test.ts
 * @description Pins the catalog message the sign-in and the required password change show for an
 *   error: every code of `ADMIN_AUTH_ERROR` names its own message, the codes no form shows (a
 *   redirect, an answer without a code) and any other text name the general one. The table is
 *   typed over every code, so a code added without its expected message fails the typecheck.
 * @layer infrastructure
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { ADMIN_AUTH_ERROR, adminAuthErrorMessageKey } from "@/lib/auth/types";

type AdminAuthErrorCode = (typeof ADMIN_AUTH_ERROR)[keyof typeof ADMIN_AUTH_ERROR];

const EXPECTED_KEYS: Record<AdminAuthErrorCode, string> = {
  INVALID_CREDENTIALS: "invalidCredentials",
  MFA_REQUIRED: "mfaRequired",
  MFA_INVALID: "mfaInvalid",
  ACCOUNT_LOCKED: "accountLocked",
  ACCOUNT_INACTIVE: "accountInactive",
  PASSWORD_CHANGE_REQUIRED: "unknown",
  PASSWORD_CHANGE_NOT_REQUIRED: "passwordChangeNotRequired",
  CONCURRENT_MODIFICATION: "concurrentModification",
  PASSWORD_TOO_WEAK: "passwordTooWeak",
  PASSWORD_REUSED: "passwordReused",
  RATE_LIMIT_EXCEEDED: "rateLimitExceeded",
  IP_NOT_ALLOWED: "ipNotAllowed",
  INTERNAL_ERROR: "internalError",
  VALIDATION_FAILED: "validationFailed",
  UNKNOWN_ERROR: "unknown",
  PASSWORD_MISMATCH: "passwordMismatch",
};

describe("adminAuthErrorMessageKey", () => {
  it.each(Object.entries(EXPECTED_KEYS))("names the message %s → %s", (code, key) => {
    expect(adminAuthErrorMessageKey(code)).toBe(key);
  });

  it.each([
    ["a code the forms do not know", "A_CODE_NO_FORM_KNOWS"],
    ["the API's validation sentence", "Validation failed"],
    ["a sentence an action returned", "Invalid response from server"],
    ["a name every object inherits", "constructor"],
    ["an empty text", ""],
  ])("names the general message for %s", (_what, text) => {
    expect(adminAuthErrorMessageKey(text)).toBe("unknown");
  });
});
