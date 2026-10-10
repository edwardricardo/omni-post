/**
 * @file executed-by.test.ts
 * @description Self-tests of rule R2: the registry and the ruleset are refused when malformed,
 *              check names render only when they are predictable, each broken condition of an
 *              entry comes back as an R2 violation naming the entry, and an entry's scope decides
 *              which sources count as run by a required check.
 * @layer infrastructure
 */
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { err, ok } from "@shared/types";
import {
  checkExecutedBy,
  parseCollectorRegistry,
  parseRequiredContexts,
  renderCheckNames,
  type ExecutedByEntry,
  type ExecutedByInput,
} from "../src/lib/executed-by.js";
import type { Collection } from "../src/lib/registry.js";
import {
  CI_PATHS,
  registryOf,
  rulesetRequiring,
  UNIT_ENTRY,
  UNIT_WORKFLOW,
} from "./fixtures/ci.js";

/** A collection of the vitest collector. */
function vitest(source: string): Collection {
  return { collector: "vitest", source, files: [`${source}.test.ts`] };
}

const WORKFLOW = `${UNIT_WORKFLOW}  shards:
    name: Shard \${{ matrix.shard }}
    runs-on: ubuntu-latest
    strategy:
      matrix:
        shard: [1, 2]
    steps:
      - run: >-
          pnpm exec vitest run
          --shard=\${{ matrix.shard }}/2
`;

/** An input whose one collector is vitest, over two packages, and whose workflow is parsed. */
function input(
  entries: readonly ExecutedByEntry[],
  overrides: Partial<ExecutedByInput> = {}
): ExecutedByInput {
  return {
    registry: new Map([["vitest", entries]]),
    contexts: new Set(["Unit", "Shard 1", "Shard 2"]),
    workflows: new Map([[CI_PATHS.workflow, ok(parseYaml(WORKFLOW))]]),
    collectorIds: ["vitest"],
    collections: [vitest("pkg-a/vitest.config.ts"), vitest("pkg-b/vitest.config.ts#unit")],
    ...overrides,
  };
}

const SUBJECT = `vitest:${CI_PATHS.workflow}#unit`;

describe("collectors.json parsing", () => {
  it("returns every collector with its entries", () => {
    const text = registryOf({ vitest: [{ ...UNIT_ENTRY, packages: ["pkg-a"] }], k6: [] });

    expect(parseCollectorRegistry(text, "c.json")).toEqual(
      ok(
        new Map([
          ["vitest", [{ ...UNIT_ENTRY, packages: ["pkg-a"] }]],
          ["k6", []],
        ])
      )
    );
  });

  it("accepts a note beside a collector's executedBy", () => {
    const text = JSON.stringify({ collectors: { k6: { executedBy: [], note: "no job" } } });

    expect(parseCollectorRegistry(text, "c.json").ok).toBe(true);
  });

  const entry = (fields: Record<string, unknown>) =>
    JSON.stringify({ collectors: { vitest: { executedBy: [{ ...UNIT_ENTRY, ...fields }] } } });

  it.each([
    ["not JSON", "{", "registry c.json is not JSON"],
    ["without collectors", "{}", 'registry c.json has no "collectors" object'],
    [
      "with a collector that has no executedBy",
      JSON.stringify({ collectors: { vitest: {} } }),
      'collector "vitest" needs an executedBy list and no other key',
    ],
    [
      "with a collector key it does not know",
      JSON.stringify({ collectors: { vitest: { executedBy: [], runs: [] } } }),
      'collector "vitest" needs an executedBy list and no other key',
    ],
    ["with an entry key it does not know", entry({ pakages: ["a"] }), "has unknown keys: pakages"],
    [
      "with a workflow outside .github/workflows",
      entry({ workflow: "ci.yml" }),
      "needs a workflow path under .github/workflows/",
    ],
    ["with no jobId", entry({ jobId: "" }), "needs a jobId and an entrypoint"],
    ["with a blank entrypoint", entry({ entrypoint: " " }), "needs a non-empty entrypoint"],
    [
      "with both packages and exclude",
      entry({ packages: ["a"], exclude: ["b"] }),
      "carries both packages and exclude",
    ],
    ["with empty packages", entry({ packages: [] }), "needs packages as a non-empty list"],
    ["with a blank exclude path", entry({ exclude: [""] }), "needs exclude as a non-empty list"],
  ])("returns a failure for a registry %s", (_label, text, expected) => {
    const parsed = parseCollectorRegistry(text, "c.json");

    expect(parsed.ok ? "" : parsed.error).toContain(expected);
  });
});

describe("ruleset parsing", () => {
  it("returns the context of every required status check", () => {
    expect(parseRequiredContexts(rulesetRequiring(["Unit", "Lint"]), "r.json")).toEqual(
      ok(new Set(["Unit", "Lint"]))
    );
  });

  it.each([
    ["not JSON", "[", "ruleset r.json is not JSON"],
    ["without rules", "{}", 'ruleset r.json has no "rules" list'],
    [
      "requiring no check",
      JSON.stringify({ rules: [{ type: "deletion" }] }),
      "requires no status check",
    ],
    [
      "with a status-check rule and no list",
      JSON.stringify({ rules: [{ type: "required_status_checks", parameters: {} }] }),
      "has a status-check rule with no list",
    ],
    [
      "with a check that has no context",
      JSON.stringify({
        rules: [{ type: "required_status_checks", parameters: { required_status_checks: [{}] } }],
      }),
      "has a required status check with no context",
    ],
  ])("returns a failure for a ruleset %s", (_label, text, expected) => {
    const parsed = parseRequiredContexts(text, "r.json");

    expect(parsed.ok ? "" : parsed.error).toContain(expected);
  });
});

describe("check names", () => {
  it.each([
    ["a named job", { name: "Unit" }, ["Unit"]],
    ["an unnamed job, by its id", {}, ["job"]],
    [
      "a matrix job, one name per value",
      { name: "Test (shard ${{ matrix.shard }})", strategy: { matrix: { shard: [1, 2] } } },
      ["Test (shard 1)", "Test (shard 2)"],
    ],
    [
      "a two-key matrix, one name per combination",
      {
        name: "${{ matrix.os }}-${{ matrix.node }}",
        strategy: { matrix: { os: ["a"], node: [1, 2] } },
      },
      ["a-1", "a-2"],
    ],
    [
      "a matrix job whose name uses some of its keys, once per distinct name",
      {
        name: "Test (${{ matrix.os }})",
        strategy: { matrix: { os: ["linux", "macos"], shard: [1, 2] } },
      },
      ["Test (linux)", "Test (macos)"],
    ],
  ])("returns the names of %s", (_label, job, expected) => {
    expect(renderCheckNames("job", job)).toEqual(ok(expected));
  });

  it.each([
    ["a name that is not a string", { name: 3 }, "its name is not a string"],
    [
      "an unnamed matrix job",
      { strategy: { matrix: { shard: [1] } } },
      "a matrix job with no name",
    ],
    [
      "a matrix job whose name leaves its matrix out",
      { name: "Test", strategy: { matrix: { shard: [1, 2] } } },
      "whose name leaves its matrix values out",
    ],
    [
      "a matrix with include",
      { name: "T ${{ matrix.a }}", strategy: { matrix: { a: [1], include: [{ a: 2 }] } } },
      "its matrix uses include",
    ],
    [
      "a matrix with exclude",
      { name: "T ${{ matrix.a }}", strategy: { matrix: { a: [1, 2], exclude: [{ a: 2 }] } } },
      "its matrix uses exclude",
    ],
    [
      "a matrix set by an expression",
      { name: "T ${{ matrix.a }}", strategy: { matrix: "${{ fromJSON(x) }}" } },
      "its matrix is not a mapping of lists",
    ],
    [
      "a matrix key with an object value",
      { name: "T ${{ matrix.a }}", strategy: { matrix: { a: [{ b: 1 }] } } },
      'its matrix key "a" is not a list of plain values',
    ],
    [
      "a matrix key with an empty list",
      { name: "T ${{ matrix.a }}", strategy: { matrix: { a: [] } } },
      'its matrix key "a" is not a list of plain values',
    ],
    [
      "a name using a matrix key no matrix sets",
      { name: "T ${{ matrix.a }}" },
      "its name uses matrix.a, which no matrix key sets",
    ],
    [
      "a name using another expression",
      { name: "k6 (${{ github.event.inputs.scenario }})" },
      "its name uses an expression other than a matrix value",
    ],
  ])("returns a failure for %s", (_label, job, expected) => {
    const rendered = renderCheckNames("job", job);

    expect(rendered.ok ? "" : rendered.error).toContain(expected);
  });
});

describe("rule R2", () => {
  it("returns no violation and every source as run when one entry covers them all", () => {
    const verdict = checkExecutedBy(input([UNIT_ENTRY]));

    expect(verdict).toEqual({
      violations: [],
      runSources: new Set(["vitest:pkg-a/vitest.config.ts", "vitest:pkg-b/vitest.config.ts#unit"]),
    });
  });

  it("returns no violation for a matrix job whose every check is required", () => {
    const shards = { ...UNIT_ENTRY, jobId: "shards", entrypoint: "pnpm exec vitest run --shard=" };

    expect(checkExecutedBy(input([shards])).violations).toEqual([]);
  });

  it("returns only the sources a packages scope covers as run", () => {
    const verdict = checkExecutedBy(input([{ ...UNIT_ENTRY, packages: ["pkg-b/"] }]));

    expect([...verdict.runSources]).toEqual(["vitest:pkg-b/vitest.config.ts#unit"]);
  });

  it("returns the sources outside an exclude scope as run", () => {
    const verdict = checkExecutedBy(input([{ ...UNIT_ENTRY, exclude: ["pkg-b"] }]));

    expect([...verdict.runSources]).toEqual(["vitest:pkg-a/vitest.config.ts"]);
  });

  it.each([
    [
      "a job the workflow does not hold",
      { ...UNIT_ENTRY, jobId: "gone" },
      `vitest:${CI_PATHS.workflow}#gone`,
      `${CI_PATHS.workflow} has no job "gone"`,
    ],
    [
      "an entrypoint no step runs",
      { ...UNIT_ENTRY, entrypoint: "pnpm exec vitest run --coverage" },
      SUBJECT,
      'no step of the job runs "pnpm exec vitest run --coverage"',
    ],
    [
      "a packages path that covers no source",
      { ...UNIT_ENTRY, packages: ["pkg-c"] },
      SUBJECT,
      'packages "pkg-c" covers no source of vitest',
    ],
  ])("returns an R2 violation naming the entry for %s", (_label, entry, file, message) => {
    expect(checkExecutedBy(input([entry])).violations).toEqual([{ rule: "R2", file, message }]);
  });

  it("returns an R2 violation naming each check the ruleset does not require", () => {
    const shards = { ...UNIT_ENTRY, jobId: "shards", entrypoint: "--shard=" };

    const verdict = checkExecutedBy(input([shards], { contexts: new Set(["Unit", "Shard 1"]) }));

    expect(verdict.violations).toEqual([
      {
        rule: "R2",
        file: `vitest:${CI_PATHS.workflow}#shards`,
        message: 'its check "Shard 2" is not a required check',
      },
    ]);
  });

  it("returns an R2 violation when the job's check names cannot be rendered", () => {
    const workflow =
      "jobs:\n  unit:\n    name: X ${{ inputs.a }}\n    steps:\n      - run: pnpm exec vitest run\n";

    const verdict = checkExecutedBy(
      input([UNIT_ENTRY], { workflows: new Map([[CI_PATHS.workflow, ok(parseYaml(workflow))]]) })
    );

    expect(verdict.violations).toEqual([
      {
        rule: "R2",
        file: SUBJECT,
        message:
          "its check names cannot be rendered: its name uses an expression other than a matrix value",
      },
    ]);
  });

  it("returns an R2 violation when the workflow cannot be read", () => {
    const workflows = new Map([[CI_PATHS.workflow, err("ENOENT: no such file")]]);

    const verdict = checkExecutedBy(input([UNIT_ENTRY], { workflows }));

    expect(verdict.violations).toEqual([
      { rule: "R2", file: SUBJECT, message: "its workflow cannot be read: ENOENT: no such file" },
    ]);
  });

  it("returns R2 violations for a collector the registry omits and one the engine does not run", () => {
    const verdict = checkExecutedBy(
      input([UNIT_ENTRY], {
        registry: new Map([["k6", []]]),
        collectorIds: ["vitest"],
      })
    );

    expect(verdict.violations).toEqual([
      { rule: "R2", file: CI_PATHS.registry, message: 'collector "vitest" is not registered' },
      {
        rule: "R2",
        file: CI_PATHS.registry,
        message: 'registers "k6", which the engine does not run',
      },
    ]);
  });

  it("returns no run source for a collector with an empty executedBy", () => {
    const verdict = checkExecutedBy(input([]));

    expect(verdict).toEqual({ violations: [], runSources: new Set() });
  });
});
