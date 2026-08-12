/**
 * @file brokenHook.fixture.ts
 * @description Control input for the runner-gate self-test: a node:test suite whose
 *              `before` hook throws, so its subtests are reported CANCELLED while the
 *              summary still says `# fail 0`. This is the shape the runner already
 *              fails on, and it stays here as the control — a change that makes the
 *              gate see the clean-exit shape must not stop seeing this one.
 *
 *              Like its sibling, the `.fixture.ts` suffix keeps it outside vitest's
 *              `tests/unit/**` collection and outside every explicit node:test batch
 *              list, so no collector picks it up.
 * @layer infrastructure
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

describe("runner-gate input: a collapsing before hook", () => {
  before(() => {
    throw new Error("runner-gate input: setup collapses on purpose");
  });

  it("never runs, so the runner reports it cancelled rather than failed", () => {
    assert.fail("unreachable: the before hook throws first");
  });

  it("never runs either", () => {
    assert.fail("unreachable: the before hook throws first");
  });
});
