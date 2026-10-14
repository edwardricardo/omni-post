/**
 * @file scopes.test.ts
 * @description Self-tests of the scope contract, fitness #36: the verdict over plain scopes (which
 *              globs are positive, how a glob is normalised and matched against tracked files),
 *              and the command line over planted trees: a dead `test.include` or
 *              `coverage.include` glob exits 1 naming its config and glob, a negation that matches
 *              nothing passes, a config vitest cannot resolve, a tree below the config floor and a
 *              listing that fails each exit 1 on an `error:` line, `--json` prints the report, and
 *              a usage error exits 2.
 * @layer infrastructure
 */
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { err, ok } from "@shared/types";
import { checkScopes, SCOPE_RULE, type Scope } from "../src/lib/scopes.js";
import { main, type ScopesSeams } from "../src/scopes.js";
import {
  configCollecting,
  plantTree,
  removeTree,
  TEST_BODY,
  type PlantedTree,
} from "./fixtures/tree.js";

/** A planted run spawns real vitest instances; 5.4 s was measured for one on a busy CI runner. */
const VITEST_TIMEOUT_MS = 60_000;

/** The root the plain-scope cases resolve their tracked paths against; nothing is read from it. */
const ROOT = path.join(path.sep, "repo");

const planted: PlantedTree[] = [];

/** Plants a tree and schedules its removal. */
function plant(contents: Readonly<Record<string, string>>): PlantedTree {
  const tree = plantTree(contents);
  planted.push(tree);
  return tree;
}

/** The planted tree stands in for `git ls-files`, with a floor a one-config tree can meet. */
function seamsFor(tree: PlantedTree): ScopesSeams {
  return { listFiles: () => ok([...tree.tracked]), floor: 1 };
}

/**
 * @param globs - The scope's globs.
 * @returns A `test.include` scope of `pkg/vitest.config.mjs`, relative to `<ROOT>/pkg`.
 */
function scopeOf(globs: readonly string[]): Scope {
  return {
    source: "pkg/vitest.config.mjs",
    key: "test.include",
    cwd: path.join(ROOT, "pkg"),
    globs,
  };
}

describe("scope contract", () => {
  afterEach(() => {
    for (const tree of planted.splice(0)) removeTree(tree);
  });

  describe("checkScopes", () => {
    it("returns no violation when every positive glob matches a tracked file", () => {
      const verdict = checkScopes(ROOT, [scopeOf(["tests/**/*.test.ts"])], ["pkg/tests/a.test.ts"]);

      expect(verdict).toEqual({ globs: 1, violations: [] });
    });

    it("returns a violation naming the source, the glob and the key for a glob matching nothing", () => {
      const verdict = checkScopes(
        ROOT,
        [scopeOf(["tests/**/*.test.ts", "testz/**/*.test.ts"])],
        ["pkg/tests/a.test.ts"]
      );

      expect(verdict).toEqual({
        globs: 2,
        violations: [
          {
            rule: SCOPE_RULE,
            source: "pkg/vitest.config.mjs",
            message:
              'dead positive glob "testz/**/*.test.ts" in test.include: it matches no tracked file',
          },
        ],
      });
    });

    it("skips a negation that matches nothing, and reads `!(` as an extglob, not a negation", () => {
      const verdict = checkScopes(
        ROOT,
        [scopeOf(["!(skip)*.test.ts", "!nothing/**"])],
        ["pkg/a.test.ts"]
      );

      expect(verdict).toEqual({ globs: 1, violations: [] });
    });

    it("returns a violation for a scope that holds only negations", () => {
      const verdict = checkScopes(ROOT, [scopeOf(["!**/*.test.ts"])], ["pkg/a.test.ts"]);

      expect(verdict.violations.map((violation) => violation.message)).toEqual([
        "test.include holds no positive glob, so it scopes no file",
      ]);
    });

    it("matches a glob with a leading ./, a ../ or an absolute path, as tinyglobby does", () => {
      const globs = [
        "./tests/*.test.ts",
        "../shared/*.test.ts",
        path.join(ROOT, "pkg", "tests", "*.test.ts"),
      ];

      const verdict = checkScopes(
        ROOT,
        [scopeOf(globs)],
        ["pkg/tests/a.test.ts", "shared/b.test.ts"]
      );

      expect(verdict).toEqual({ globs: 3, violations: [] });
    });

    it("reads a glob naming a directory as tinyglobby does: it matches no file", () => {
      const verdict = checkScopes(ROOT, [scopeOf(["tests/"])], ["pkg/tests/a.test.ts"]);

      expect(verdict.violations.map((violation) => violation.message)).toEqual([
        'dead positive glob "tests/" in test.include: it matches no tracked file',
      ]);
    });

    it("reads every tracked file for a scope rooted at the repository root", () => {
      const scope: Scope = { ...scopeOf(["pkg/**/*.test.ts"]), cwd: ROOT };

      const verdict = checkScopes(ROOT, [scope], ["pkg/tests/a.test.ts"]);

      expect(verdict).toEqual({ globs: 1, violations: [] });
    });

    it("does not let `**` climb out of the scope's directory", () => {
      const verdict = checkScopes(ROOT, [scopeOf(["**/*.test.ts"])], ["shared/b.test.ts"]);

      expect(verdict.violations).toHaveLength(1);
    });
  });

  describe("the command line", () => {
    it(
      "exits 0 when every positive glob of every config matches a tracked file",
      async () => {
        const tree = plant({
          "pkg/vitest.config.mjs": configCollecting(["*.test.ts", "!nothing/**"]),
          "pkg/one.test.ts": TEST_BODY,
        });

        const result = await main(["--root", tree.root], seamsFor(tree));

        expect(result.code).toBe(0);
        expect(result.output).toBe(
          "scopes: PASS\n" +
            "summary: 1 of 1 tracked vitest configs resolved; 1 positive scope globs checked; " +
            "0 violations; 0 errors\n"
        );
      },
      VITEST_TIMEOUT_MS
    );

    it(
      "exits 1 naming the config and the dead test.include glob",
      async () => {
        const tree = plant({
          "pkg/vitest.config.mjs": configCollecting(["*.test.ts", "testz/**/*.test.ts"]),
          "pkg/one.test.ts": TEST_BODY,
        });

        const result = await main(["--root", tree.root], seamsFor(tree));

        expect(result.code).toBe(1);
        expect(result.output).toContain(
          'S1 pkg/vitest.config.mjs: dead positive glob "testz/**/*.test.ts" in test.include'
        );
      },
      VITEST_TIMEOUT_MS
    );

    it(
      "exits 1 naming a dead coverage.include glob, and reads coverage.include only where it is set",
      async () => {
        const tree = plant({
          "pkg/vitest.config.mjs":
            'export default { test: { include: ["*.test.ts"], ' +
            'coverage: { include: ["src/**/*.ts", "srcz/**/*.ts"] } } };\n',
          "pkg/one.test.ts": TEST_BODY,
          "pkg/src/index.ts": "export const x = 1;\n",
          "other/vitest.config.mjs": configCollecting(["*.test.ts"]),
          "other/two.test.ts": TEST_BODY,
        });

        const result = await main(["--root", tree.root], seamsFor(tree));

        expect(result.code).toBe(1);
        expect(result.output.split("\n").filter((line) => line.startsWith("S1"))).toEqual([
          'S1 pkg/vitest.config.mjs: dead positive glob "srcz/**/*.ts" in coverage.include: it matches no tracked file',
        ]);
        expect(result.output).toContain("2 of 2 tracked vitest configs resolved; 4 positive");
      },
      VITEST_TIMEOUT_MS
    );

    it(
      "exits 1 when the only file a glob matches is on disk but not tracked",
      async () => {
        const tree = plant({
          "pkg/vitest.config.mjs": configCollecting(["*.test.ts"]),
          "pkg/one.test.ts": TEST_BODY,
        });

        const result = await main(["--root", tree.root], {
          listFiles: () => ok(tree.tracked.filter((file) => !file.endsWith(".test.ts"))),
          floor: 1,
        });

        expect(result.code).toBe(1);
        expect(result.output).toContain('S1 pkg/vitest.config.mjs: dead positive glob "*.test.ts"');
      },
      VITEST_TIMEOUT_MS
    );

    it(
      "names the project of a config that declares projects",
      async () => {
        const tree = plant({
          "pkg/vitest.config.mjs":
            'export default { test: { projects: [{ test: { name: "one", include: ["*.test.ts"] } }, ' +
            '{ test: { name: "two", include: ["gone/*.test.ts"] } }] } };\n',
          "pkg/x.test.ts": TEST_BODY,
        });

        const result = await main(["--root", tree.root], seamsFor(tree));

        expect(result.code).toBe(1);
        expect(result.output).toContain(
          'S1 pkg/vitest.config.mjs#two: dead positive glob "gone/*.test.ts" in test.include'
        );
        expect(result.output).not.toContain("pkg/vitest.config.mjs#one:");
      },
      VITEST_TIMEOUT_MS
    );

    it(
      "exits 1 on an error line naming a config vitest cannot resolve, never a silent zero",
      async () => {
        const tree = plant({
          "pkg/vitest.config.mjs": "export default { test: { include: [ };\n",
          "pkg/x.test.ts": TEST_BODY,
        });

        const result = await main(["--root", tree.root], seamsFor(tree));

        expect(result.code).toBe(1);
        expect(result.output).toMatch(
          /^error: pkg\/vitest\.config\.mjs: does not resolve: vitest\/node: /m
        );
        expect(result.output).toContain("summary: 0 of 1 tracked vitest configs resolved");
      },
      VITEST_TIMEOUT_MS
    );

    it("exits 1 and resolves nothing when fewer configs are tracked than the floor", async () => {
      const tree = plant({ "pkg/vitest.config.mjs": configCollecting(["*.test.ts"]) });

      const result = await main(["--root", tree.root], { listFiles: () => ok([...tree.tracked]) });

      expect(result.code).toBe(1);
      expect(result.output).toContain(
        "error: vitest:(tracked configs): 1 tracked vitest configs, below the floor of 80"
      );
      expect(result.output).toContain("0 of 1 tracked vitest configs resolved");
    });

    it("exits 1 on the listing's own message when the file listing fails", async () => {
      const tree = plant({ "pkg/vitest.config.mjs": configCollecting(["*.test.ts"]) });

      const result = await main(["--root", tree.root], {
        listFiles: () => err({ message: "git ls-files failed in /x: planted" }),
        floor: 1,
      });

      expect(result).toEqual({
        code: 1,
        output:
          "scopes: FAIL\nerror: git ls-files failed in /x: planted\n" +
          "summary: 0 of 0 tracked vitest configs resolved; 0 positive scope globs checked; " +
          "0 violations; 1 errors\n",
      });
    });

    it(
      "prints the report as JSON with --json",
      async () => {
        const tree = plant({
          "pkg/vitest.config.mjs": configCollecting(["*.test.ts"]),
          "pkg/one.test.ts": TEST_BODY,
        });

        const result = await main(["--root", tree.root, "--json"], seamsFor(tree));

        expect(JSON.parse(result.output)).toEqual({
          ok: true,
          configs: 1,
          resolved: 1,
          globs: 1,
          violations: [],
          errors: [],
        });
      },
      VITEST_TIMEOUT_MS
    );

    it.each([[["--bogus"]], [["--root"]], [["--root", "--json"]]])(
      "exits 2 on the usage error %j",
      async (argv) => {
        const result = await main(argv);

        expect(result.code).toBe(2);
        expect(result.output).toContain("usage: scopes [--root <dir>] [--json]");
      }
    );
  });
});
