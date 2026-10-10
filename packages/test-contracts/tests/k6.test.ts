/**
 * @file k6.test.ts
 * @description Self-tests of the k6 collector: the tracked `*.k6.js` files are one source, a
 *              disabled or renamed copy is not a scenario, and a glob that matches nothing fails
 *              closed.
 * @layer infrastructure
 */
import { describe, expect, it } from "vitest";
import { CANONICAL_TEST_SHAPED } from "../src/lib/disk.js";
import { createK6Collector, K6_SCENARIO } from "../src/lib/k6.js";

describe("k6 collector", () => {
  it("returns every tracked scenario, sorted, as one source", async () => {
    const tracked = ["perf/b.k6.js", "perf/a.k6.js", "perf/old.k6.js.disabled", "perf/c.js"];

    const outcome = await createK6Collector().collect({ root: "/", tracked });

    expect(outcome).toEqual({
      collections: [
        { collector: "k6", source: "*.k6.js", files: ["perf/a.k6.js", "perf/b.k6.js"] },
      ],
      failures: [],
    });
  });

  it("returns a failure when no tracked file is a scenario", async () => {
    const outcome = await createK6Collector().collect({ root: "/", tracked: ["perf/a.js"] });

    expect(outcome).toEqual({
      collections: [],
      failures: [
        {
          collector: "k6",
          source: "*.k6.js",
          message: "matches no tracked file; the glob read nothing",
        },
      ],
    });
  });

  it("matches only names the disk side counts as test-shaped", () => {
    const names = ["a.k6.js", "a.k6.js.old", "a.k6.ts", "k6.js", "a.k6.mjs"];

    const scenarios = names.filter((name) => K6_SCENARIO.test(name));

    expect(scenarios).toEqual(["a.k6.js"]);
    expect(scenarios.every((name) => CANONICAL_TEST_SHAPED.test(name))).toBe(true);
  });
});
