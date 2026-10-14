/**
 * @file exclude-contract.test.ts
 * @description Self-tests of the exclude contract, rule C2: the verdict over plain resolutions (a
 *              list that holds every reserved pattern passes, one that lacks some is named with
 *              exactly the patterns it lacks, a project is held on its own, a config whose exclude
 *              was not resolved and a scope below the floor are errors), and what the vitest
 *              collector resolves for it from real configs: this package's own factory-built
 *              config, planted hand-written configs with the full list, part of it or none, an
 *              inline project that does not extend its root, and a config only the CLI fallback
 *              could list. The engine's output for C2 is pinned in `reach.test.ts`.
 * @layer infrastructure
 */
import { afterEach, describe, expect, it } from "vitest";
import { RESERVED_TIER_EXCLUDES } from "@packages/vitest-shared";
import { err } from "@shared/types";
import { checkExcludeContract } from "../src/lib/exclude-contract.js";
import { createK6Collector } from "../src/lib/k6.js";
import {
  createVitestCollector,
  isVitestCollector,
  listWithCli,
  type ResolvedExcludes,
} from "../src/lib/vitest-collector.js";
import { REPOSITORY_ROOT } from "./fixtures/metrics.js";
import {
  configCollecting,
  plantTree,
  removeTree,
  TEST_BODY,
  type PlantedTree,
} from "./fixtures/tree.js";

/**
 * Budget for a case that starts real vitest instances or spawns `vitest list`; 5.4 s was measured
 * for one spawn on a busy CI runner, past vitest's 5 s default.
 */
const VITEST_TIMEOUT_MS = 60_000;

/** The config every plain case holds, a path and nothing more: nothing is read from it. */
const CONFIG = "pkg/vitest.config.ts";

/** vitest's own default `exclude`, which a config that names none resolves to. */
const VITEST_DEFAULTS = ["**/node_modules/**", "**/.git/**"] as const;

/** The full reserved list, quoted the way a violation names its patterns. */
const ALL_RESERVED = RESERVED_TIER_EXCLUDES.map((pattern) => JSON.stringify(pattern)).join(", ");

/** What every violation says after the patterns it lacks. */
const CONSEQUENCE =
  "of RESERVED_TIER_EXCLUDES, so vitest can collect a file another tier's runner owns";

const planted: PlantedTree[] = [];

/** Plants a tree and schedules its removal. */
function plant(contents: Readonly<Record<string, string>>): PlantedTree {
  const tree = plantTree(contents);
  planted.push(tree);
  return tree;
}

/**
 * @param root - The root config's resolved exclude.
 * @param projects - Each project's name and resolved exclude.
 * @returns The resolution of {@link CONFIG}, as the only entry of the map C2 reads.
 */
function resolvedAs(
  root: readonly string[],
  projects: ResolvedExcludes["projects"] = []
): Map<string, ResolvedExcludes | null> {
  return new Map([[CONFIG, { root, projects }]]);
}

describe("exclude contract (C2)", () => {
  afterEach(() => {
    for (const tree of planted.splice(0)) removeTree(tree);
  });

  describe("checkExcludeContract", () => {
    it("returns no violation when the root config's exclude holds every reserved pattern", () => {
      const verdict = checkExcludeContract(
        [CONFIG],
        resolvedAs([...VITEST_DEFAULTS, ...RESERVED_TIER_EXCLUDES]),
        1
      );

      expect(verdict).toEqual({ configs: 1, violations: [], errors: [] });
    });

    it("returns one violation naming the config and every pattern when the exclude holds none", () => {
      const verdict = checkExcludeContract([CONFIG], resolvedAs(VITEST_DEFAULTS), 1);

      expect(verdict.violations).toEqual([
        {
          rule: "C2",
          file: CONFIG,
          message: `resolved exclude lacks ${ALL_RESERVED} ${CONSEQUENCE}`,
        },
      ]);
    });

    it("names only the patterns the exclude lacks when it holds part of the list", () => {
      const [first, second, third, fourth] = RESERVED_TIER_EXCLUDES;

      const verdict = checkExcludeContract([CONFIG], resolvedAs([first, third]), 1);

      expect(verdict.violations.map((violation) => violation.message)).toEqual([
        `resolved exclude lacks ${JSON.stringify(second)}, ${JSON.stringify(fourth)} ${CONSEQUENCE}`,
      ]);
    });

    it("holds each project's exclude on its own, naming the project", () => {
      const verdict = checkExcludeContract(
        [CONFIG],
        resolvedAs(RESERVED_TIER_EXCLUDES, [
          { name: "unit", exclude: VITEST_DEFAULTS },
          { name: "dom", exclude: RESERVED_TIER_EXCLUDES },
        ]),
        1
      );

      expect(verdict.violations).toEqual([
        {
          rule: "C2",
          file: `${CONFIG}#unit`,
          message: `resolved exclude lacks ${ALL_RESERVED} ${CONSEQUENCE}`,
        },
      ]);
    });

    it("returns an error, never a pass, for a config the CLI fallback listed", () => {
      const verdict = checkExcludeContract([CONFIG], new Map([[CONFIG, null]]), 1);

      expect(verdict).toEqual({
        configs: 1,
        violations: [],
        errors: [
          `C2 ${CONFIG}: listed through the CLI fallback, which resolves no config, ` +
            "so its exclude was not read",
        ],
      });
    });

    it("returns an error for a tracked config the vitest collector did not resolve", () => {
      const verdict = checkExcludeContract([CONFIG], new Map(), 1);

      expect(verdict.errors).toEqual([
        `C2 ${CONFIG}: the vitest collector resolved no config for it, so its exclude was not read`,
      ]);
    });

    it("returns an error naming the floor when fewer configs are tracked than it", () => {
      const verdict = checkExcludeContract([CONFIG], resolvedAs(RESERVED_TIER_EXCLUDES));

      expect(verdict.errors).toEqual([
        "C2 saw 1 vitest configs, below the floor of 80; " +
          "the listing read less of the tree than it holds",
      ]);
    });

    it("holds only tracked vitest configs, reporting them in path order", () => {
      const resolved = new Map<string, ResolvedExcludes | null>([
        ["b/vitest.config.mts", { root: [], projects: [] }],
        ["a/vitest.config.ts", { root: [], projects: [] }],
      ]);

      const verdict = checkExcludeContract(
        ["b/vitest.config.mts", "a/vitest.stories.config.ts", "a/vitest.config.ts", "a/x.ts"],
        resolved,
        2
      );

      expect(verdict.configs).toBe(2);
      expect(verdict.violations.map((violation) => violation.file)).toEqual([
        "a/vitest.config.ts",
        "b/vitest.config.mts",
      ]);
    });
  });

  describe("over what the vitest collector resolved", () => {
    it(
      "passes a factory-built config: this package's own",
      { timeout: VITEST_TIMEOUT_MS },
      async () => {
        const config = "packages/test-contracts/vitest.config.ts";
        const collector = createVitestCollector({ floor: 1 });

        await collector.collect({ root: REPOSITORY_ROOT, tracked: [config] });
        const verdict = checkExcludeContract([config], collector.resolvedExcludes(), 1);

        expect(verdict).toEqual({ configs: 1, violations: [], errors: [] });
      }
    );

    it(
      "passes a hand-written config that writes the whole list and names what the others lack",
      { timeout: VITEST_TIMEOUT_MS },
      async () => {
        const [first, second, third, fourth] = RESERVED_TIER_EXCLUDES;
        const tree = plant({
          "full/vitest.config.mjs": configCollecting(["*.test.ts"]),
          "full/a.test.ts": TEST_BODY,
          "none/vitest.config.mjs": configCollecting(["*.test.ts"], ["**/node_modules/**"]),
          "none/b.test.ts": TEST_BODY,
          "part/vitest.config.mjs": configCollecting(["*.test.ts"], [second, fourth]),
          "part/c.test.ts": TEST_BODY,
        });
        const collector = createVitestCollector({ floor: 3 });

        await collector.collect(tree);
        const verdict = checkExcludeContract(tree.tracked, collector.resolvedExcludes(), 3);

        expect(verdict).toEqual({
          configs: 3,
          errors: [],
          violations: [
            {
              rule: "C2",
              file: "none/vitest.config.mjs",
              message: `resolved exclude lacks ${ALL_RESERVED} ${CONSEQUENCE}`,
            },
            {
              rule: "C2",
              file: "part/vitest.config.mjs",
              message:
                `resolved exclude lacks ${JSON.stringify(first)}, ${JSON.stringify(third)} ` +
                CONSEQUENCE,
            },
          ],
        });
      }
    );

    it(
      "holds an inline project that does not extend its root, which loses the root's list",
      { timeout: VITEST_TIMEOUT_MS },
      async () => {
        const reserved = JSON.stringify(RESERVED_TIER_EXCLUDES);
        const tree = plant({
          "pkg/vitest.config.mjs":
            `export default { test: { exclude: ${reserved}, projects: [` +
            '{ test: { name: "alone", include: ["*.test.ts"] } }, ' +
            '{ extends: true, test: { name: "extended", include: ["*.test.ts"] } }] } };\n',
          "pkg/x.test.ts": TEST_BODY,
        });
        const collector = createVitestCollector({ floor: 1 });

        await collector.collect(tree);
        const verdict = checkExcludeContract(tree.tracked, collector.resolvedExcludes(), 1);

        expect(verdict.violations).toEqual([
          {
            rule: "C2",
            file: "pkg/vitest.config.mjs#alone",
            message: `resolved exclude lacks ${ALL_RESERVED} ${CONSEQUENCE}`,
          },
        ]);
      }
    );

    it(
      "returns an error for a config only the CLI fallback could list",
      { timeout: VITEST_TIMEOUT_MS },
      async () => {
        const tree = plant({
          "pkg/vitest.config.mjs": configCollecting(["*.test.ts"]),
          "pkg/x.test.ts": TEST_BODY,
        });
        const collector = createVitestCollector({
          floor: 1,
          strategies: { programmatic: () => Promise.resolve(err("planted")), cli: listWithCli },
        });

        const outcome = await collector.collect(tree);
        const verdict = checkExcludeContract(tree.tracked, collector.resolvedExcludes(), 1);

        expect(outcome.failures).toEqual([]);
        expect(verdict.errors).toEqual([
          "C2 pkg/vitest.config.mjs: listed through the CLI fallback, which resolves no config, " +
            "so its exclude was not read",
        ]);
      }
    );

    it("keeps only what the last collect resolved", { timeout: VITEST_TIMEOUT_MS }, async () => {
      const first = plant({
        "one/vitest.config.mjs": configCollecting(["*.test.ts"]),
        "one/a.test.ts": TEST_BODY,
      });
      const second = plant({
        "two/vitest.config.mjs": configCollecting(["*.test.ts"]),
        "two/b.test.ts": TEST_BODY,
      });
      const collector = createVitestCollector({ floor: 1 });

      await collector.collect(first);
      await collector.collect(second);

      expect([...collector.resolvedExcludes().keys()]).toEqual(["two/vitest.config.mjs"]);
    });
  });

  describe("isVitestCollector", () => {
    it("returns true for the vitest collector and false for any other", () => {
      const lookalike = {
        id: "vitest" as const,
        collect: () => Promise.resolve({ collections: [], failures: [] }),
      };

      expect(isVitestCollector(createVitestCollector())).toBe(true);
      expect(isVitestCollector(createK6Collector())).toBe(false);
      expect(isVitestCollector(lookalike)).toBe(false);
    });
  });
});
