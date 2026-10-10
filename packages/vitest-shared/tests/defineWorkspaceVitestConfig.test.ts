/**
 * @file defineWorkspaceVitestConfig.test.ts
 * @description Pins the two array keys of the factory, whose merge semantics point in opposite
 *              directions. `mergeConfig` concatenates arrays. For `test.reporters` that is wrong
 *              by default: a factory that always wrote its selection would hand a caller who asked
 *              for `["junit"]` the list `["default", "junit"]`, a reporter it never requested,
 *              installed silently, so the factory writes its own selection only when the caller
 *              named none. Both signals the selection reads are stubbed in every case, so the
 *              expected lists hold on a laptop and on a GitHub Actions runner alike. For
 *              `test.exclude` concatenation is the point: the reserved tier suffixes must survive
 *              a caller that names its own exclusions, or a package could hand a node:test,
 *              Playwright or k6 file to vitest by adding one glob. It also pins the export
 *              conditions the factory sets in both environments, `client` and `ssr`; whether they
 *              send every test's workspace import to `src/` is the contract
 *              `packages/test-contracts/tests/source-resolution.test.ts` holds over the tree.
 * @layer infrastructure
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { configDefaults } from "vitest/config";
import {
  RESERVED_TIER_EXCLUDES,
  SOURCE_CONDITIONS,
  defineWorkspaceVitestConfig,
  workspaceReporters,
} from "../src/index.js";

describe("defineWorkspaceVitestConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("RESERVED_TIER_EXCLUDES", () => {
    it("names exactly the suffixes another collector owns", () => {
      expect(RESERVED_TIER_EXCLUDES).toEqual([
        "**/*.integration.test.*",
        "**/*.live.test.*",
        "**/*.spec.*",
        "**/*.k6.js",
      ]);
    });
  });

  describe("export conditions", () => {
    it("names development before node, so an unaliased package resolves to its src/", () => {
      expect(SOURCE_CONDITIONS).toEqual(["development", "node"]);
    });

    it("sets the source conditions on the ssr environment, which node tests resolve through", () => {
      const config = defineWorkspaceVitestConfig(import.meta.dirname);

      expect(config.ssr?.resolve?.conditions).toEqual([...SOURCE_CONDITIONS]);
    });

    it("sets the source conditions on the client environment, which DOM tests resolve through", () => {
      const config = defineWorkspaceVitestConfig(import.meta.dirname);

      expect(config.resolve?.conditions).toEqual([...SOURCE_CONDITIONS]);
    });
  });

  describe("test.exclude", () => {
    it("yields vitest's default exclusions and every reserved suffix when the caller names none", () => {
      const config = defineWorkspaceVitestConfig(import.meta.dirname, {
        test: { include: ["tests/**/*.test.ts"] },
      });

      expect(config.test?.exclude).toEqual([...configDefaults.exclude, ...RESERVED_TIER_EXCLUDES]);
    });

    it("adds the caller's exclusions to the reserved suffixes instead of replacing them", () => {
      const config = defineWorkspaceVitestConfig(import.meta.dirname, {
        test: { include: ["tests/**/*.test.ts"], exclude: ["tests/fixtures/**"] },
      });

      expect(config.test?.exclude).toEqual([
        ...configDefaults.exclude,
        ...RESERVED_TIER_EXCLUDES,
        "tests/fixtures/**",
      ]);
    });
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
