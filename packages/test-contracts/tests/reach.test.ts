/**
 * @file reach.test.ts
 * @description Self-tests of the reach engine's command line over planted trees: a planted R1 or
 *              R3 violation reaches the exit code and the output naming its file, a clean tree
 *              passes, every input the engine cannot read in full fails the run, `--json` prints
 *              the report, and a usage error exits 2. The rules themselves are pinned over plain
 *              values in `rules.test.ts`.
 * @layer infrastructure
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ok } from "@shared/types";
import { createVitestCollector } from "../src/lib/vitest-collector.js";
import { main, type ReachSeams } from "../src/reach.js";
import {
  configCollecting,
  plantTree,
  removeTree,
  TEST_BODY,
  type PlantedTree,
} from "./fixtures/tree.js";

const planted: PlantedTree[] = [];

/**
 * Two packages, each collecting its one top-level test, plus whatever a test adds. `pkg-b`'s
 * includes are a parameter so a test can make it reach into `pkg-a`.
 */
function plant(
  extra: Readonly<Record<string, string>> = {},
  pkgBInclude: readonly string[] = ["*.test.ts"]
): PlantedTree {
  const tree = plantTree({
    "pkg-a/vitest.config.mjs": configCollecting(["*.test.ts"]),
    "pkg-a/one.test.ts": TEST_BODY,
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

  it.each([[["--bogus"]], [["--root"]], [["--quarantine", "--json"]], [["--toString", "x"]]])(
    "exits 2 on the usage error %j",
    async (argv) => {
      const result = await main(argv);

      expect(result.code).toBe(2);
      expect(result.output).toContain("usage: reach");
    }
  );
});
