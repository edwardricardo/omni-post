/**
 * @file cleanExitNonZero.fixture.ts
 * @description The passing half of the runner-gate reproduction: a node:test suite
 *              whose every test succeeds, so its batch summary reports `# fail 0`
 *              and `# cancelled 0`. Run inside a batch whose runner process then
 *              ends non-zero, it reproduces the shape `apps/api/scripts/run-tests.sh`
 *              names in its own comment but could not act on: clean counts, non-zero
 *              runner exit.
 *
 *              Why the non-zero exit is injected at the RUNNER and not by a hook in
 *              this file: node:test isolates each file in a child process and reports
 *              a child that ends non-zero as a FAILED file-level test. A hook here
 *              would therefore produce `# fail 1` — the shape the gate already
 *              catches — never the one it was blind to. Only the runner process
 *              itself can end non-zero while the counts stay clean, which is what
 *              "crashed after printing the summary" means. Two ways to reproduce it,
 *              both measured against a derived copy of the runner whose `run_batch`
 *              and final gate are byte-identical to the real script:
 *                - list a suite path that no longer exists as the batch's only file
 *                  (node prints `Could not find …`, emits no TAP at all, and exits
 *                  non-zero, so every parsed count defaults to zero);
 *                - put a `node` shim first on `PATH` that runs the real binary and
 *                  turns a zero exit into a non-zero one.
 *
 *              Neither this file nor its sibling is a suite the project runs: the
 *              `.fixture.ts` suffix keeps both outside vitest's `tests/unit/**`
 *              collection and outside every explicit node:test batch list, so no
 *              collector picks them up. They are executed by hand as gate evidence.
 * @layer infrastructure
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("runner-gate input: a batch that reports clean counts", () => {
  it("passes, so the batch summary reports zero failed and zero cancelled", () => {
    assert.equal(1 + 1, 2);
  });
});
