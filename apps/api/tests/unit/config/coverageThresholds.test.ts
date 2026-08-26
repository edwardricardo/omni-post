/**
 * @file coverageThresholds.test.ts
 * @description Pins the two halves of the coverage gate. (1) The shard conditional:
 *              a per-shard run must carry an override that cannot fail (each shard
 *              sees only part of the suite) and must never auto-raise the floor from
 *              partial data, while the merged/local run carries no override so the
 *              literal floor in vitest.config.ts gates for real. (2) The config shape
 *              itself: `autoUpdate` rewrites vitest.config.ts through an AST parse and
 *              throws unless `test.coverage.thresholds` is a literal object of
 *              numbers, so a refactor that hides the numbers behind a helper — the
 *              exact shape this file used to assert — must fail here rather than in a
 *              required CI job.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { shardedThresholdOverride } from "../../../vitest.coverage-thresholds.js";

const THRESHOLD_KEYS = ["lines", "functions", "branches", "statements"] as const;

describe("shardedThresholdOverride", () => {
  describe("merged / local run", () => {
    it("returns no override so the literal floor in vitest.config.ts gates the run", () => {
      expect(shardedThresholdOverride(false)).toEqual({});
    });
  });

  describe("sharded run", () => {
    it("zeroes every metric so partial per-shard coverage cannot fail the run", () => {
      const override = shardedThresholdOverride(true);

      for (const key of THRESHOLD_KEYS) {
        expect(override[key]).toBe(0);
      }
    });

    it("disables autoUpdate so a shard never ratchets the floor from partial data", () => {
      expect(shardedThresholdOverride(true).autoUpdate).toBe(false);
    });
  });
});

describe("vitest.config.ts coverage thresholds", () => {
  const source = readFileSync(new URL("../../../vitest.config.ts", import.meta.url), "utf8");

  it("declares every threshold as a literal number on its own line", () => {
    // autoUpdate parses this file as an AST and refuses a non-literal `thresholds`;
    // the PR diff guard reads the same lines to reject a lowered floor.
    for (const key of THRESHOLD_KEYS) {
      expect(source).toMatch(new RegExp(`^\\s{8}${key}: \\d+(\\.\\d+)?,$`, "m"));
    }
  });

  it("keeps autoUpdate as the flooring function so a raise travels in its own commit", () => {
    expect(source).toContain("autoUpdate: (n: number) => Math.floor(n * 10) / 10,");
  });

  it("applies the shard override last so it can neutralise the literal floor", () => {
    const statementsAt = source.indexOf("statements: ");
    const overrideAt = source.indexOf("...shardedThresholdOverride(sharded),");

    expect(overrideAt).toBeGreaterThan(statementsAt);
  });
});
