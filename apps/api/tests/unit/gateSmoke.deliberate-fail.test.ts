/**
 * @file gateSmoke.deliberate-fail.test.ts
 * @description Gate-still-gates smoke: a DELIBERATELY failing unit test. This
 *              file exists only on a scratch branch to prove the sharded Test
 *              Suite turns the PR red. Never merge.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";

describe("gate-still-gates smoke (deliberate failure)", () => {
  it("must turn the shard red", () => {
    expect(true).toBe(false);
  });
});
