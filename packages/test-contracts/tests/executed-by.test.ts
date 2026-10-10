/**
 * @file executed-by.test.ts
 * @description Self-tests of the registry and the ruleset rule R2 reads: each is read when well
 *              formed and refused when malformed.
 * @layer infrastructure
 */
import { describe, expect, it } from "vitest";
import { ok } from "@shared/types";
import { parseCollectorRegistry, parseRequiredContexts } from "../src/lib/executed-by.js";
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
