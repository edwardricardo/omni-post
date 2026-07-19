/**
 * @file coverageThresholds.test.ts
 * @description Verifies the sharded-coverage conditional: under sharding the
 *              per-shard run must NOT carry coverage thresholds (each shard sees
 *              only half the suite), while the default (merge + local) run keeps
 *              the global floor (lines/functions 55, statements 54, branches 45)
 *              so coverage is gated once on merged data.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { buildCoverageThresholds } from "../../../vitest.coverage-thresholds.js";

describe("buildCoverageThresholds", () => {
  describe("default (non-sharded) run", () => {
    it("returns the global floor when sharding is disabled", () => {
      const thresholds = buildCoverageThresholds(false);

      expect(thresholds).toBeDefined();
      expect(thresholds?.lines).toBe(55);
      expect(thresholds?.functions).toBe(55);
      expect(thresholds?.branches).toBe(45);
      expect(thresholds?.statements).toBe(54);
    });

    it("keeps the per-scope override keys for the domain and application scopes", () => {
      const thresholds = buildCoverageThresholds(false);

      expect(thresholds?.["src/domain/**/*.ts"]).toEqual({
        lines: 55,
        functions: 55,
        branches: 45,
        statements: 54,
      });
      expect(thresholds?.["src/application/**/*.ts"]).toEqual({
        lines: 55,
        functions: 55,
        branches: 45,
        statements: 54,
      });
    });
  });

  describe("sharded run", () => {
    it("returns undefined so a per-shard run does not gate on partial coverage", () => {
      const thresholds = buildCoverageThresholds(true);

      expect(thresholds).toBeUndefined();
    });
  });
});
