/**
 * @file vitest-collector.test.ts
 * @description Self-tests of the vitest collector over planted trees: what each config collects,
 *              per project, through the node API and through its CLI fallback, the two floors it
 *              fails closed on, the config expression metric M8 counts with, and how the CLI
 *              fallback names an output that is not the listing and a run past its time cap.
 * @layer infrastructure
 */
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { err } from "@shared/types";
import {
  createVitestCollector,
  listWithCli,
  VITEST_CONFIG,
  type VitestStrategies,
} from "../src/lib/vitest-collector.js";
import { metricsExpression } from "./fixtures/metrics.js";
import {
  configCollecting,
  plantTree,
  removeTree,
  TEST_BODY,
  type PlantedTree,
} from "./fixtures/tree.js";

const planted: PlantedTree[] = [];

/** Plants a tree and schedules its removal. */
function plant(contents: Readonly<Record<string, string>>): PlantedTree {
  const tree = plantTree(contents);
  planted.push(tree);
  return tree;
}

/** Two packages, each with a config that collects its one test. */
function twoPackages(): PlantedTree {
  return plant({
    "pkg-a/vitest.config.mjs": configCollecting(["*.test.ts"]),
    "pkg-a/one.test.ts": TEST_BODY,
    "pkg-b/vitest.config.mjs": configCollecting(["tests/*.test.ts"]),
    "pkg-b/tests/two.test.ts": TEST_BODY,
  });
}

const failingListing =
  (reason: string): VitestStrategies["cli"] =>
  () =>
    Promise.resolve(err(reason));

describe("vitest collector", () => {
  afterEach(() => {
    for (const tree of planted.splice(0)) removeTree(tree);
  });

  it("uses the expression scripts/testing/metrics.mjs counts M8 with, pattern and flags", () => {
    const { source, flags } = VITEST_CONFIG;

    expect(metricsExpression("VITEST_CONFIG")).toEqual({ source, flags });
  });

  it("returns each config's files, repository-relative, when vitest lists them", async () => {
    const tree = twoPackages();

    const outcome = await createVitestCollector({ floor: 2 }).collect(tree);

    expect(outcome).toEqual({
      collections: [
        { collector: "vitest", source: "pkg-a/vitest.config.mjs", files: ["pkg-a/one.test.ts"] },
        {
          collector: "vitest",
          source: "pkg-b/vitest.config.mjs",
          files: ["pkg-b/tests/two.test.ts"],
        },
      ],
      failures: [],
    });
  });

  it("returns one source per project when a config declares projects", async () => {
    const tree = plant({
      "pkg/vitest.config.mjs":
        'export default { test: { projects: [{ test: { name: "one", include: ["*.test.ts"] } }, ' +
        '{ test: { name: "two", include: ["*.test.ts"] } }] } };\n',
      "pkg/x.test.ts": TEST_BODY,
    });

    const outcome = await createVitestCollector({ floor: 1 }).collect(tree);

    expect(outcome.collections.map((collection) => collection.source)).toEqual([
      "pkg/vitest.config.mjs#one",
      "pkg/vitest.config.mjs#two",
    ]);
  });

  it("returns a floor failure and no collection when fewer configs are tracked than the floor", async () => {
    const tree = twoPackages();

    const outcome = await createVitestCollector().collect(tree);

    expect(outcome).toEqual({
      collections: [],
      failures: [
        {
          collector: "vitest",
          source: "(tracked configs)",
          message:
            "2 tracked vitest configs, below the floor of 80; the listing read less of the tree than it holds",
        },
      ],
    });
  });

  it("returns a failure naming a config that collects no file", async () => {
    const tree = plant({ "pkg/vitest.config.mjs": configCollecting(["none/*.test.ts"]) });

    const outcome = await createVitestCollector({ floor: 1 }).collect(tree);

    expect(outcome.failures).toEqual([
      {
        collector: "vitest",
        source: "pkg/vitest.config.mjs",
        message: "collects no file; every tracked vitest config must collect at least one",
      },
    ]);
  });

  it("returns the CLI listing when the node API fails", async () => {
    const tree = twoPackages();
    const collector = createVitestCollector({
      floor: 2,
      strategies: { programmatic: failingListing("planted"), cli: listWithCli },
    });

    const outcome = await collector.collect(tree);

    expect(outcome.failures).toEqual([]);
    expect(outcome.collections.flatMap((collection) => collection.files)).toEqual([
      "pkg-a/one.test.ts",
      "pkg-b/tests/two.test.ts",
    ]);
  });

  it("returns both reasons when the CLI fallback fails too", async () => {
    const tree = plant({ "pkg/vitest.config.mjs": configCollecting(["*.test.ts"]) });
    const collector = createVitestCollector({
      floor: 1,
      strategies: { programmatic: failingListing("first"), cli: failingListing("second") },
    });

    const outcome = await collector.collect(tree);

    expect(outcome.failures.map((failure) => failure.message)).toEqual([
      "first; the CLI fallback failed too: second",
    ]);
  });

  it("returns a failure naming a config vitest cannot load, through both listings", async () => {
    const tree = plant({
      "pkg/vitest.config.mjs": "export default {\n",
      "pkg/x.test.ts": TEST_BODY,
    });

    const outcome = await createVitestCollector({ floor: 1 }).collect(tree);

    expect(outcome.collections).toEqual([]);
    expect(outcome.failures.map((failure) => failure.source)).toEqual(["pkg/vitest.config.mjs"]);
    expect(outcome.failures[0]?.message).toMatch(
      /^vitest\/node: .*the CLI fallback failed too: vitest list exited 1/s
    );
  });

  it("returns a failure naming a root that does not resolve", async () => {
    const tree = plant({ "pkg/vitest.config.mjs": configCollecting(["*.test.ts"]) });
    removeTree(tree);

    const outcome = await createVitestCollector({ floor: 1 }).collect(tree);

    expect(outcome.failures.map((failure) => failure.source)).toEqual([tree.root]);
    expect(outcome.failures[0]?.message).toContain("cannot resolve the root");
  });
});

describe("vitest list fallback", () => {
  afterEach(() => {
    for (const tree of planted.splice(0)) removeTree(tree);
  });

  /** Plants one package whose config has the given source, and returns its directory and config. */
  function plantConfig(source: string): { directory: string; config: string } {
    const tree = plant({ "pkg/vitest.config.mjs": source, "pkg/x.test.ts": TEST_BODY });
    const directory = path.join(tree.root, "pkg");
    return { directory, config: path.join(directory, "vitest.config.mjs") };
  }

  it("returns a failure naming how stdout begins when it does not open with the JSON array", async () => {
    const { directory, config } = plantConfig(
      `console.log("preamble from the config");\n${configCollecting(["*.test.ts"])}`
    );

    const listed = await listWithCli(directory, config);

    expect(listed.ok ? "" : listed.error).toMatch(
      /^vitest list printed no JSON array on stdout; it begins "preamble from the config\\n\[/
    );
  });

  it("returns a failure when vitest list exits cleanly with nothing on stdout", async () => {
    const { directory, config } = plantConfig("process.exit(0);\nexport default {};\n");

    const listed = await listWithCli(directory, config);

    expect(listed).toEqual({ ok: false, error: "vitest list printed nothing on stdout" });
  });

  it("returns a failure naming the config and the cap when vitest list times out", async () => {
    const { directory, config } = plantConfig(configCollecting(["*.test.ts"]));

    const listed = await listWithCli(directory, config, 1);

    expect(listed).toEqual({
      ok: false,
      error: `vitest list for ${config} timed out after the 1 ms cap`,
    });
  });
});
