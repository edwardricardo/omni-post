/**
 * @file rules.test.ts
 * @description Self-tests of the reach verdict over plain values: each rule is planted in an
 *              input and must come back as a violation naming its file, a clean input must come
 *              back empty, and every malformed quarantine must be refused.
 * @layer infrastructure
 */
import { describe, expect, it } from "vitest";
import { COLLECTOR_ID, type Collection } from "../src/lib/registry.js";
import {
  evaluate,
  parseQuarantine,
  type QuarantineEntry,
  type ReachInput,
  type Violation,
} from "../src/lib/rules.js";

const CONFIG_A = "pkg-a/vitest.config.ts";
const CONFIG_B = "pkg-b/vitest.config.ts";

/** A collection of the vitest collector. */
function collected(source: string, files: readonly string[]): Collection {
  return { collector: COLLECTOR_ID.VITEST, source, files };
}

/** A quarantine entry for a path. */
function quarantined(file: string): QuarantineEntry {
  return { path: file, reason: "planted", owner: "self-test" };
}

/** Two tracked tests, each collected once by its own config, plus a third that a test plants. */
function input(overrides: Partial<ReachInput> = {}, extraTest?: string): ReachInput {
  const tests = ["a.test.ts", "b.test.ts", ...(extraTest === undefined ? [] : [extraTest])];
  return {
    disk: { tracked: [...tests, "notes.md"].sort(), testShaped: tests },
    collections: [collected(CONFIG_A, ["a.test.ts"]), collected(CONFIG_B, ["b.test.ts"])],
    quarantine: [],
    base: null,
    ...overrides,
  };
}

describe("reach rules", () => {
  it("returns no violation when every test-shaped file is collected exactly once", () => {
    expect(evaluate(input())).toEqual([]);
  });

  it("returns an R1 violation naming a test-shaped file no collector runs", () => {
    const expected: Violation[] = [
      { rule: "R1", file: "c.test.ts", message: "unreached: no collector runs it" },
    ];

    expect(evaluate(input({}, "c.test.ts"))).toEqual(expected);
  });

  it("returns an R1 violation naming a file two sources collect, with both sources", () => {
    const collections = [
      collected(CONFIG_A, ["a.test.ts"]),
      collected(CONFIG_B, ["a.test.ts", "b.test.ts"]),
    ];

    expect(evaluate(input({ collections }))).toEqual([
      {
        rule: "R1",
        file: "a.test.ts",
        message: `collected 2 times: vitest:${CONFIG_A}, vitest:${CONFIG_B}`,
      },
    ]);
  });

  it("returns an R1 violation for a collected file the disk does not list as test-shaped", () => {
    const collections = [
      collected(CONFIG_A, ["a.test.ts", "x.test-d.ts"]),
      collected(CONFIG_B, ["b.test.ts", "x.test-d.ts"]),
    ];

    expect(evaluate(input({ collections }))).toEqual([
      {
        rule: "R1",
        file: "x.test-d.ts",
        message: `collected 2 times: vitest:${CONFIG_A}, vitest:${CONFIG_B}`,
      },
    ]);
  });

  it("returns an R1 violation naming the source of a file only an unrun source collects", () => {
    const runSources = new Set([`vitest:${CONFIG_A}`]);

    expect(evaluate(input({ runSources }))).toEqual([
      {
        rule: "R1",
        file: "b.test.ts",
        message: `unreached: collected by vitest:${CONFIG_B}, which no required check runs`,
      },
    ]);
  });

  it("returns an R1 violation for a file two sources collect even when one is not run", () => {
    const collections = [
      collected(CONFIG_A, ["a.test.ts"]),
      collected(CONFIG_B, ["a.test.ts", "b.test.ts"]),
    ];
    const runSources = new Set([`vitest:${CONFIG_A}`, `vitest:${CONFIG_B}`]);

    expect(evaluate(input({ collections, runSources: new Set([`vitest:${CONFIG_A}`]) }))).toEqual([
      {
        rule: "R1",
        file: "a.test.ts",
        message: `collected 2 times: vitest:${CONFIG_A}, vitest:${CONFIG_B}`,
      },
      {
        rule: "R1",
        file: "b.test.ts",
        message: `unreached: collected by vitest:${CONFIG_B}, which no required check runs`,
      },
    ]);
    expect(evaluate(input({ collections, runSources }))).toHaveLength(1);
  });

  it("returns no violation for a quarantined file only an unrun source collects", () => {
    const runSources = new Set([`vitest:${CONFIG_A}`]);

    expect(evaluate(input({ runSources, quarantine: [quarantined("b.test.ts")] }))).toEqual([]);
  });

  it("returns an R3 violation naming only the run sources of a quarantined file", () => {
    const collections = [
      collected(CONFIG_A, ["a.test.ts", "b.test.ts"]),
      collected(CONFIG_B, ["b.test.ts"]),
    ];
    const runSources = new Set([`vitest:${CONFIG_A}`]);

    expect(
      evaluate(input({ collections, runSources, quarantine: [quarantined("b.test.ts")] }))
    ).toEqual([
      {
        rule: "R3",
        file: "b.test.ts",
        message: `quarantined, but collected by vitest:${CONFIG_A}`,
      },
    ]);
  });

  it("returns no violation when the only unreached file is quarantined", () => {
    expect(evaluate(input({ quarantine: [quarantined("c.test.ts")] }, "c.test.ts"))).toEqual([]);
  });

  it("returns an R3 violation naming a quarantine entry that is not tracked", () => {
    expect(evaluate(input({ quarantine: [quarantined("gone.test.ts")] }))).toEqual([
      { rule: "R3", file: "gone.test.ts", message: "quarantined, but not a tracked file" },
    ]);
  });

  it("returns only an R3 violation, with its source, for a quarantined file that is collected", () => {
    expect(evaluate(input({ quarantine: [quarantined("a.test.ts")] }))).toEqual([
      {
        rule: "R3",
        file: "a.test.ts",
        message: `quarantined, but collected by vitest:${CONFIG_A}`,
      },
    ]);
  });

  it("returns an R3 violation naming a quarantine entry listed twice", () => {
    const quarantine = [quarantined("c.test.ts"), quarantined("c.test.ts")];

    expect(evaluate(input({ quarantine }, "c.test.ts"))).toEqual([
      { rule: "R3", file: "c.test.ts", message: "quarantined more than once" },
    ]);
  });

  it("returns the untracked violation once, then the repeat, for an untracked entry listed twice", () => {
    const quarantine = [quarantined("gone.test.ts"), quarantined("gone.test.ts")];

    expect(evaluate(input({ quarantine }))).toEqual([
      { rule: "R3", file: "gone.test.ts", message: "quarantined, but not a tracked file" },
      { rule: "R3", file: "gone.test.ts", message: "quarantined more than once" },
    ]);
  });

  it("returns the base violation once, then the repeat, for an entry outside the base listed twice", () => {
    const quarantine = [quarantined("c.test.ts"), quarantined("c.test.ts")];

    expect(evaluate(input({ quarantine, base: [] }, "c.test.ts"))).toEqual([
      {
        rule: "R3",
        file: "c.test.ts",
        message: "quarantined, but not in the base quarantine; the quarantine may only shrink",
      },
      { rule: "R3", file: "c.test.ts", message: "quarantined more than once" },
    ]);
  });

  it("returns an R3 violation naming a quarantine entry the base does not hold", () => {
    const quarantine = [quarantined("c.test.ts")];

    expect(evaluate(input({ quarantine, base: [] }, "c.test.ts"))).toEqual([
      {
        rule: "R3",
        file: "c.test.ts",
        message: "quarantined, but not in the base quarantine; the quarantine may only shrink",
      },
    ]);
  });

  it.each([
    [
      "a base that holds every entry and more",
      [quarantined("c.test.ts"), quarantined("d.test.ts")],
    ],
    ["no base at all", null],
  ])("returns no violation for a quarantine checked against %s", (_label, base) => {
    const quarantine = [quarantined("c.test.ts")];

    expect(evaluate(input({ quarantine, base }, "c.test.ts"))).toEqual([]);
  });
});

describe("quarantine parsing", () => {
  it("returns every entry of a well-formed quarantine", () => {
    const entry = quarantined("c.test.ts");

    const parsed = parseQuarantine(JSON.stringify({ entries: [entry] }), "q.json");

    expect(parsed).toEqual({ ok: true, value: [entry] });
  });

  it.each([
    ["not JSON", "{", "quarantine q.json is not JSON"],
    ["without entries", "{}", 'quarantine q.json has no "entries" array'],
    ["with entries that are not an array", '{"entries":{}}', 'has no "entries" array'],
    ["whose root is null", "null", 'quarantine q.json has no "entries" array'],
    ["whose root is a number", "42", 'quarantine q.json has no "entries" array'],
    ["whose root is an array", '[{"path":"a"}]', 'quarantine q.json has no "entries" array'],
    ["with an entry missing its owner", '{"entries":[{"path":"a","reason":"r"}]}', "entry 0 needs"],
    [
      "with a blank reason",
      '{"entries":[{"path":"a","reason":"  ","owner":"o"}]}',
      "entry 0 needs a non-empty path, reason and owner",
    ],
  ])("returns a failure for a quarantine %s", (_label, text, expected) => {
    const parsed = parseQuarantine(text, "q.json");

    expect(parsed.ok ? "" : parsed.error).toContain(expected);
  });
});
