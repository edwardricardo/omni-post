/**
 * @file defineWorkspaceVitestConfig.test.ts
 * @description Pins the ONE key whose merge semantics are wrong by default. `mergeConfig`
 *              concatenates arrays, so a factory that always writes `test.reporters` would hand a
 *              caller who asked for `["junit"]` the list `["default", "junit"]` — a reporter it
 *              never requested, installed silently. The factory therefore writes its own selection
 *              only when the caller named none, and these two tests are what keeps that true.
 * @layer infrastructure
 */

import { describe, expect, it } from "vitest";
import { defineWorkspaceVitestConfig, workspaceReporters } from "../src/index.js";

describe("defineWorkspaceVitestConfig", () => {
  describe("test.reporters", () => {
    it("yields exactly the caller's reporters, never concatenated onto the factory's", () => {
      const config = defineWorkspaceVitestConfig(import.meta.dirname, {
        test: { reporters: ["junit"] },
      });

      expect(config.test?.reporters).toEqual(["junit"]);
    });

    it("yields the derived reporter list when the caller names none", () => {
      const config = defineWorkspaceVitestConfig(import.meta.dirname, {
        test: { include: ["tests/**/*.test.ts"] },
      });

      expect(config.test?.reporters).toEqual(workspaceReporters());
    });
  });
});
