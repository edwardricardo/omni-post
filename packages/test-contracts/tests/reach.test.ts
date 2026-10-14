/**
 * @file reach.test.ts
 * @description Self-tests of the reach engine's command line over planted trees: a planted R1,
 *              R2, R3 or C1 violation reaches the exit code and the output naming its file or
 *              registry entry, a clean tree passes, every input the engine cannot read in full
 *              fails the run, `--json` prints the report, and a usage error exits 2. Every planted
 *              tree carries a workflow, a ruleset and a `collectors.json` whose required check runs
 *              its vitest configs, and a `package.json` beside each config whose `test` script is
 *              `vitest run`. R1, R2 and R3 are pinned over plain values in `rules.test.ts` and
 *              `executed-by.test.ts`; C1 is pinned here, over the manifests it reads.
 * @layer infrastructure
 */
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ok } from "@shared/types";
import { createNodeCollector } from "../src/lib/node-collector.js";
import { createVitestCollector } from "../src/lib/vitest-collector.js";
import { main, type ReachSeams } from "../src/reach.js";
import { CI_PATHS, ciFiles, registryOf, rulesetRequiring, UNIT_ENTRY } from "./fixtures/ci.js";
import {
  configCollecting,
  plantTree,
  removeTree,
  TEST_BODY,
  type PlantedTree,
} from "./fixtures/tree.js";

const planted: PlantedTree[] = [];

/**
 * @param test - The `test` script, or `undefined` for a manifest with no scripts.
 * @returns A package manifest declaring it.
 */
function manifestWith(test?: string): string {
  return JSON.stringify(test === undefined ? { name: "planted" } : { scripts: { test } });
}

/**
 * Two packages, each collecting its one top-level test with a `test` script of `vitest run`, plus
 * the CI files and whatever a test adds, which may replace a CI file or a manifest. `pkg-b`'s
 * includes are a parameter so a test can make it reach into `pkg-a`.
 */
function plant(
  extra: Readonly<Record<string, string>> = {},
  pkgBInclude: readonly string[] = ["*.test.ts"]
): PlantedTree {
  const tree = plantTree({
    ...ciFiles(),
    "pkg-a/package.json": manifestWith("vitest run"),
    "pkg-a/vitest.config.mjs": configCollecting(["*.test.ts"]),
    "pkg-a/one.test.ts": TEST_BODY,
    "pkg-b/package.json": manifestWith("vitest run"),
    "pkg-b/vitest.config.mjs": configCollecting(pkgBInclude),
    "pkg-b/two.test.ts": TEST_BODY,
    ...extra,
  });
  planted.push(tree);
  return tree;
}

/** The planted tree stands in for `git ls-files`, with floors a two-package tree can meet. */
function seamsFor(tree: PlantedTree): ReachSeams {
  return {
    listFiles: () => ok([...tree.tracked]),
    diskFloor: 1,
    collectors: [createVitestCollector({ floor: 1 })],
  };
}

/** Writes a quarantine file beside the tree's packages, outside its tracked list. */
function writeQuarantine(tree: PlantedTree, name: string, paths: readonly string[]): string {
  const file = path.join(tree.root, name);
  const entries = paths.map((entry) => ({ path: entry, reason: "planted", owner: "self-test" }));
  writeFileSync(file, JSON.stringify({ entries }));
  return file;
}

const ORPHAN = "pkg-a/nested/orphan.test.ts";

describe("reach engine", () => {
  afterEach(() => {
    for (const tree of planted.splice(0)) removeTree(tree);
  });

  it("exits 0 when every test-shaped file is collected exactly once", async () => {
    const tree = plant();

    const result = await main(["--root", tree.root], seamsFor(tree));

    expect(result.code).toBe(0);
    expect(result.output).toMatch(/^reach: PASS\n/);
    expect(result.output).toContain("2 vitest packages held to the script contract; 0 violations");
  });

  it("exits 1 naming a test-shaped file no collector runs (R1)", async () => {
    const tree = plant({ [ORPHAN]: TEST_BODY });

    const result = await main(["--root", tree.root], seamsFor(tree));

    expect(result.code).toBe(1);
    expect(result.output).toContain(`R1 ${ORPHAN}: unreached: no collector runs it`);
  });

  it("exits 1 naming a file two configs collect, with both sources (R1)", async () => {
    const tree = plant({}, ["*.test.ts", "../pkg-a/*.test.ts"]);

    const result = await main(["--root", tree.root], seamsFor(tree));

    expect(result.code).toBe(1);
    expect(result.output).toContain(
      "R1 pkg-a/one.test.ts: collected 2 times: vitest:pkg-a/vitest.config.mjs, vitest:pkg-b/vitest.config.mjs"
    );
  });

  it("exits 0 when the only unreached file is quarantined", async () => {
    const tree = plant({ [ORPHAN]: TEST_BODY });
    const quarantine = writeQuarantine(tree, "quarantine.json", [ORPHAN]);

    const result = await main(["--root", tree.root, "--quarantine", quarantine], seamsFor(tree));

    expect(result.code).toBe(0);
  });

  it("exits 1 naming a quarantine entry a collector runs, with its source (R3)", async () => {
    const tree = plant();
    const quarantine = writeQuarantine(tree, "quarantine.json", ["pkg-a/one.test.ts"]);

    const result = await main(["--root", tree.root, "--quarantine", quarantine], seamsFor(tree));

    expect(result.code).toBe(1);
    expect(result.output).toContain(
      "R3 pkg-a/one.test.ts: quarantined, but collected by vitest:pkg-a/vitest.config.mjs"
    );
  });

  it("exits 1 naming a quarantine entry the base quarantine does not hold (R3)", async () => {
    const tree = plant({ [ORPHAN]: TEST_BODY });
    const quarantine = writeQuarantine(tree, "quarantine.json", [ORPHAN]);
    const base = writeQuarantine(tree, "base.json", []);

    const result = await main(
      ["--root", tree.root, "--quarantine", quarantine, "--base", base],
      seamsFor(tree)
    );

    expect(result.code).toBe(1);
    expect(result.output).toContain(
      `R3 ${ORPHAN}: quarantined, but not in the base quarantine; the quarantine may only shrink`
    );
  });

  it("exits 0 when the quarantine is a subset of the base quarantine", async () => {
    const tree = plant({ [ORPHAN]: TEST_BODY });
    const quarantine = writeQuarantine(tree, "quarantine.json", [ORPHAN]);
    const base = writeQuarantine(tree, "base.json", [ORPHAN, "pkg-a/fixed.test.ts"]);

    const result = await main(
      ["--root", tree.root, "--quarantine", quarantine, "--base", base],
      seamsFor(tree)
    );

    expect(result.code).toBe(0);
    expect(result.output).toContain("quarantine shrink check ran");
  });

  it("exits 1 naming a base quarantine that cannot be read, and says the check did not run", async () => {
    const tree = plant({ [ORPHAN]: TEST_BODY });
    const quarantine = writeQuarantine(tree, "quarantine.json", [ORPHAN]);
    const missing = path.join(tree.root, "missing-base.json");

    const result = await main(
      ["--root", tree.root, "--quarantine", quarantine, "--base", missing],
      seamsFor(tree)
    );

    expect(result.code).toBe(1);
    expect(result.output).toContain(`error: base quarantine ${missing} cannot be read: ENOENT`);
    expect(result.output).toContain("quarantine shrink check not run: base unreadable\n");
  });

  it("exits 1 naming a base quarantine that does not parse", async () => {
    const tree = plant();
    const base = path.join(tree.root, "base.json");
    writeFileSync(base, "{");

    const result = await main(["--root", tree.root, "--base", base], seamsFor(tree));

    expect(result.code).toBe(1);
    expect(result.output).toContain(`error: base quarantine ${base} is not JSON`);
  });

  it("exits 1 when the quarantine does not parse", async () => {
    const tree = plant();
    const quarantine = path.join(tree.root, "quarantine.json");
    writeFileSync(quarantine, "{");

    const result = await main(["--root", tree.root, "--quarantine", quarantine], seamsFor(tree));

    expect(result.code).toBe(1);
    expect(result.output).toContain(`error: quarantine ${quarantine} is not JSON`);
  });

  it("exits 1 when a named quarantine file does not exist", async () => {
    const tree = plant();
    const missing = path.join(tree.root, "missing.json");

    const result = await main(["--root", tree.root, "--quarantine", missing], seamsFor(tree));

    expect(result.code).toBe(1);
    expect(result.output).toContain(`error: quarantine ${missing} cannot be read: ENOENT`);
  });

  it("exits 1 at the production disk floor, before any collector runs", async () => {
    const tree = plant();
    const { diskFloor: _diskFloor, ...seams } = seamsFor(tree);

    const result = await main(["--root", tree.root], seams);

    expect(result.code).toBe(1);
    expect(result.output).toContain("disk: 2 test-shaped tracked files, below the floor of 800");
  });

  it("exits 1 at the production vitest config floor", async () => {
    const tree = plant();

    const result = await main(["--root", tree.root], {
      ...seamsFor(tree),
      collectors: [createVitestCollector()],
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain(
      "error: vitest:(tracked configs): 2 tracked vitest configs, below the floor of 80"
    );
  });

  it("exits 1 naming the node:test runner when its listing is empty", async () => {
    const registry = registryOf({ vitest: [UNIT_ENTRY], node: [] });
    const tree = plant({ [CI_PATHS.registry]: registry });
    const empty = () => ({ status: 0, signal: null, stdout: "", stderr: "" });

    const result = await main(["--root", tree.root], {
      ...seamsFor(tree),
      collectors: [createVitestCollector({ floor: 1 }), createNodeCollector({ run: empty })],
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain(
      "error: node:apps/api/scripts/run-tests.sh: --list printed no line"
    );
  });

  it("prints the report as JSON when asked", async () => {
    const tree = plant({ [ORPHAN]: TEST_BODY });

    const result = await main(["--root", tree.root, "--json"], seamsFor(tree));

    expect(JSON.parse(result.output)).toMatchObject({
      ok: false,
      testShaped: 3,
      violations: [{ rule: "R1", file: ORPHAN }],
      errors: [],
    });
  });

  it("exits 1 naming a registry entry whose job the workflow does not hold (R2)", async () => {
    const registry = registryOf({ vitest: [{ ...UNIT_ENTRY, jobId: "gone" }] });
    const tree = plant({ [CI_PATHS.registry]: registry });

    const result = await main(["--root", tree.root], seamsFor(tree));

    expect(result.code).toBe(1);
    expect(result.output).toContain(
      `R2 vitest:${CI_PATHS.workflow}#gone: ${CI_PATHS.workflow} has no job "gone"`
    );
  });

  it("exits 1 naming a job whose check the ruleset does not require (R2)", async () => {
    const tree = plant({ [CI_PATHS.ruleset]: rulesetRequiring(["Lint"]) });

    const result = await main(["--root", tree.root], seamsFor(tree));

    expect(result.code).toBe(1);
    expect(result.output).toContain(
      `R2 vitest:${CI_PATHS.workflow}#unit: its check "Unit" is not a required check`
    );
  });

  it("exits 1 naming the file of a package no registered job runs (R1)", async () => {
    const registry = registryOf({ vitest: [{ ...UNIT_ENTRY, packages: ["pkg-a"] }] });
    const tree = plant({ [CI_PATHS.registry]: registry });

    const result = await main(["--root", tree.root], seamsFor(tree));

    expect(result.code).toBe(1);
    expect(result.output).toContain(
      "R1 pkg-b/two.test.ts: unreached: collected by vitest:pkg-b/vitest.config.mjs, " +
        "which no required check runs"
    );
    expect(result.output).toContain("2 collected by 2 sources, 1 of them run by a required check");
  });

  it("exits 1 when the ruleset does not exist", async () => {
    const tree = plant();
    const missing = path.join(tree.root, "missing.json");

    const result = await main(["--root", tree.root, "--ruleset", missing], seamsFor(tree));

    expect(result.code).toBe(1);
    expect(result.output).toContain(`error: ruleset ${missing} cannot be read: ENOENT`);
  });

  it("exits 1 when the registry does not parse", async () => {
    const tree = plant({ [CI_PATHS.registry]: "{" });

    const result = await main(["--root", tree.root], seamsFor(tree));

    expect(result.code).toBe(1);
    expect(result.output).toContain(
      `error: registry ${path.join(tree.root, CI_PATHS.registry)} is not JSON`
    );
  });

  it.each([
    ["a bare vitest, which watches under a terminal", manifestWith("vitest"), '"test" is "vitest"'],
    [
      "any other command",
      manifestWith("vitest run --coverage"),
      '"test" is "vitest run --coverage"',
    ],
    ["no test script", manifestWith(), 'declares no "test" script'],
  ])(
    "exits 1 naming the manifest of a package whose test script is %s (C1)",
    async (_label, manifest, expected) => {
      const tree = plant({ "pkg-a/package.json": manifest });

      const result = await main(["--root", tree.root], seamsFor(tree));

      expect(result.code).toBe(1);
      expect(result.output).toContain(`C1 pkg-a/package.json: ${expected}`);
    }
  );

  it("exits 1 naming the missing manifest of a directory with a vitest config (C1)", async () => {
    const tree = plant();
    const untracked = tree.tracked.filter((file) => file !== "pkg-b/package.json");

    const result = await main(["--root", tree.root], {
      ...seamsFor(tree),
      listFiles: () => ok(untracked),
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain(
      "C1 pkg-b/package.json: missing: no package script runs the tracked vitest config " +
        "pkg-b/vitest.config.mjs"
    );
  });

  it("prints R1 violations before C1 ones", async () => {
    const tree = plant({ [ORPHAN]: TEST_BODY, "pkg-b/package.json": manifestWith("vitest") });

    const result = await main(["--root", tree.root], seamsFor(tree));

    expect(result.output.indexOf(`R1 ${ORPHAN}`)).toBeLessThan(
      result.output.indexOf("C1 pkg-b/package.json")
    );
  });

  it("exits 1 when a manifest does not parse", async () => {
    const tree = plant({ "pkg-a/package.json": "{" });

    const result = await main(["--root", tree.root], seamsFor(tree));

    expect(result.code).toBe(1);
    expect(result.output).toContain("error: manifest pkg-a/package.json is not JSON");
  });

  it("exits 1 when a tracked manifest cannot be read", async () => {
    const tree = plant();
    rmSync(path.join(tree.root, "pkg-a/package.json"));

    const result = await main(["--root", tree.root], seamsFor(tree));

    expect(result.code).toBe(1);
    expect(result.output).toContain("error: manifest pkg-a/package.json cannot be read: ENOENT");
  });

  it("reads the registry named on the command line instead of the default one", async () => {
    const tree = plant({ [CI_PATHS.registry]: registryOf({ vitest: [] }) });
    const registry = path.join(tree.root, "registry.json");
    writeFileSync(registry, registryOf({ vitest: [UNIT_ENTRY] }));

    const result = await main(["--root", tree.root, "--collectors", registry], seamsFor(tree));

    expect(result.code).toBe(0);
  });

  it.each([[["--bogus"]], [["--root"]], [["--quarantine", "--json"]], [["--toString", "x"]]])(
    "exits 2 on the usage error %j",
    async (argv) => {
      const result = await main(argv);

      expect(result.code).toBe(2);
      expect(result.output).toContain("usage: reach");
    }
  );

  it.each([[["--collectors"]], [["--ruleset", "--json"]]])(
    "exits 2 when a registry flag has no value %j",
    async (argv) => {
      const result = await main(argv);

      expect(result.code).toBe(2);
      expect(result.output).toContain("[--collectors <file>] [--ruleset <file>]");
    }
  );
});
