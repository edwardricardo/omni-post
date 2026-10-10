/**
 * @file executed-by.test.ts
 * @description Self-tests of the registry and the ruleset rule R2 reads, and of check-name
 *              rendering: the registry and the ruleset are refused when malformed, and check names
 *              render only when they are predictable.
 * @layer infrastructure
 */
import { describe, expect, it } from "vitest";
import { ok } from "@shared/types";
import {
  parseCollectorRegistry,
  parseRequiredContexts,
  renderCheckNames,
} from "../src/lib/executed-by.js";
import { registryOf, rulesetRequiring, UNIT_ENTRY } from "./fixtures/ci.js";

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
