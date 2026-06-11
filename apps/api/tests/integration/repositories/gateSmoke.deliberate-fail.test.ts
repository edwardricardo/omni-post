/**
 * @file gateSmoke.deliberate-fail.test.ts
 * @description Gate-still-gates smoke: a DELIBERATELY failing integration test
 *              in the PR-tier repositories batch. Scratch branch only.
 * @layer infrastructure
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("gate-still-gates smoke (deliberate failure)", () => {
  it("must turn the integration job red", () => {
    assert.strictEqual(true, false, "deliberate failure - gate must catch this");
  });
});
