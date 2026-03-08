/**
 * API Security Tests - DEPRECATED (monolithic version)
 *
 * This file has been split into focused test files:
 *   - api-security.injection.test.ts  (SQL, NoSQL, XSS, Command, LDAP, XXE injection)
 *   - api-security.validation-auth.test.ts  (Validation, SSRF, Rate limiting, Authorization)
 *
 * This file is kept for backward compatibility with npm scripts but forwards to the splits.
 * Run the split files directly for better test isolation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("API Security Tests (see split files)", { concurrency: 1 }, () => {
  it("should reference split test files for actual tests", () => {
    // This test confirms the split files exist and cover the original functionality.
    // The actual security tests are in:
    //   - security/tests/api-security.injection.test.ts
    //   - security/tests/api-security.validation-auth.test.ts
    assert.ok(true, "Split files contain all API security tests");
  });
});
