/**
 * @file registry.test.ts
 * @description Self-tests of the collector registry: collectors merge in order, an id registered
 *              twice fails instead of merging, every source carries one label, and the tally keys
 *              every file by its sources.
 * @layer infrastructure
 */
import { describe, expect, it } from "vitest";
import {
  COLLECTOR_ID,
  describeError,
  runCollectors,
  sourceLabel,
  tallyReach,
  type Collection,
  type Collector,
  type CollectorContext,
  type CollectorFailure,
} from "../src/lib/registry.js";

/** A collector that reports the given collections and no failure. */
function fixedCollector(collections: readonly Collection[]): Collector {
  return { id: COLLECTOR_ID.VITEST, collect: () => Promise.resolve({ collections, failures: [] }) };
}

const CONTEXT: CollectorContext = { root: "/", tracked: [] };

const ONE: Collection = {
  collector: COLLECTOR_ID.VITEST,
  source: "b/vitest.config.ts",
  files: ["x.test.ts"],
};
const TWO: Collection = {
  collector: COLLECTOR_ID.VITEST,
  source: "a/vitest.config.ts",
  files: ["x.test.ts", "y.test.ts"],
};

describe("collector registry", () => {
  it("returns every collection of every collector, in collector order", async () => {
    const outcome = await runCollectors([fixedCollector([ONE, TWO])], CONTEXT);

    expect(outcome).toEqual({ collections: [ONE, TWO], failures: [] });
  });

  it("returns a failure and skips the second collector when an id is registered twice", async () => {
    const expected: CollectorFailure = {
      collector: COLLECTOR_ID.VITEST,
      source: "(registry)",
      message: 'collector id "vitest" is registered twice',
    };

    const outcome = await runCollectors([fixedCollector([ONE]), fixedCollector([TWO])], CONTEXT);

    expect(outcome).toEqual({ collections: [ONE], failures: [expected] });
  });

  it("returns the same collector-first label for a collection and for a failure", () => {
    const failure: CollectorFailure = { collector: COLLECTOR_ID.VITEST, source: "x", message: "m" };

    expect([sourceLabel(ONE), sourceLabel(failure)]).toEqual([
      "vitest:b/vitest.config.ts",
      "vitest:x",
    ]);
  });

  it("returns each file with its sources, sorted", () => {
    const reach = tallyReach([ONE, TWO]);

    expect([...reach.entries()]).toEqual([
      ["x.test.ts", ["vitest:a/vitest.config.ts", "vitest:b/vitest.config.ts"]],
      ["y.test.ts", ["vitest:a/vitest.config.ts"]],
    ]);
  });

  it.each([
    [new Error("boom"), "boom"],
    ["plain text", "plain text"],
    [42, "42"],
  ])("describes the caught value %s as %s", (caught, expected) => {
    expect(describeError(caught)).toBe(expected);
  });
});
