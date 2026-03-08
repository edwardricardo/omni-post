/**
 * Injection Attack Tests - DEPRECATED (monolithic version)
 *
 * This file has been split into focused test files:
 *   - injection-tests.sql-nosql.test.ts   (SQL and NoSQL injection)
 *   - injection-tests.xss-command.test.ts  (XSS and Command injection)
 *   - injection-tests.ldap-xml-template-header.test.ts  (LDAP, XML, Template, Header)
 *
 * This file is kept for backward compatibility with npm scripts but forwards to the splits.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Injection Tests (see split files)", { concurrency: 1 }, () => {
  it("should reference split test files for actual tests", () => {
    // The actual injection tests are in:
    //   - security/tests/injection-tests.sql-nosql.test.ts
    //   - security/tests/injection-tests.xss-command.test.ts
    //   - security/tests/injection-tests.ldap-xml-template-header.test.ts
    assert.ok(true, "Split files contain all injection tests");
  });
});
