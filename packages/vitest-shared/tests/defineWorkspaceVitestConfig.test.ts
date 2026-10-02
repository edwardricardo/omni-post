/**
 * @file defineWorkspaceVitestConfig.test.ts
 * @description Pins the ONE key whose merge semantics are wrong by default. `mergeConfig`
 *              concatenates arrays, so a factory that always writes `test.reporters` would hand a
 *              caller who asked for `["junit"]` the list `["default", "junit"]` — a reporter it
 *              never requested, installed silently. The factory therefore writes its own selection
 *              only when the caller named none, and these tests are what keeps that true. Both
 *              signals the selection reads are stubbed in every case, so the expected lists hold on
 *              a laptop and on a GitHub Actions runner alike.
 * @layer infrastructure
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { defineWorkspaceVitestConfig, workspaceReporters } from "../src/index.js";

describe("defineWorkspaceVitestConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("test.reporters", () => {
    it("yields exactly the caller's reporters, never concatenated onto the factory's", () => {
      vi.stubEnv("GITHUB_ACTIONS", "true");
      vi.stubEnv("VITEST_SHARDED", "true");

      const config = defineWorkspaceVitestConfig(import.meta.dirname, {
        test: { reporters: ["junit"] },
      });

      expect(config.test?.reporters).toEqual(["junit"]);
    });

    it("yields every derived reporter when the caller names none and both signals are set", () => {
      vi.stubEnv("GITHUB_ACTIONS", "true");
      vi.stubEnv("VITEST_SHARDED", "true");

      const config = defineWorkspaceVitestConfig(import.meta.dirname, {
        test: { include: ["tests/**/*.test.ts"] },
      });

      expect(config.test?.reporters).toEqual(["default", "github-actions", "blob"]);
      expect(config.test?.reporters).toEqual(
        workspaceReporters({ GITHUB_ACTIONS: "true", VITEST_SHARDED: "true" })
      );
    });

    it("yields only the default reporter when the caller names none and neither signal is set", () => {
      vi.stubEnv("GITHUB_ACTIONS", undefined);
      vi.stubEnv("VITEST_SHARDED", undefined);

      const config = defineWorkspaceVitestConfig(import.meta.dirname, {
        test: { include: ["tests/**/*.test.ts"] },
      });

      expect(config.test?.reporters).toEqual(["default"]);
    });
  });
});
