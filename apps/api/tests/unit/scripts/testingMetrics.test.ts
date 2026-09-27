/**
 * @file testingMetrics.test.ts
 * @description Pins `scripts/testing/metrics.mjs` against the Now column of
 *   `docs/development/TESTING_REFOUNDATION.md`. The tracker's rule is that a number is believed
 *   only when a command reproduces it, so this suite runs the command and compares its output to
 *   the document, byte for byte, in BOTH directions: the script drifting from the tracker fails
 *   here, and the tracker drifting from the script fails here too. The Baseline column is the
 *   value at the base commit and is not re-derivable from a later tree — a change that moves a
 *   metric (this test file itself moves M1 by one) updates Now in the same pull request.
 *
 *   It also pins WHICH metrics are derived from the tree. A derivation that silently degrades to
 *   "unavailable" would otherwise leave a stale number in the document reading as measured, so the
 *   derived set is asserted exactly rather than counted.
 *
 *   Hermetic by construction: `--offline` keeps the script off the network, and nothing here
 *   touches Postgres, Redis or a booted process. The repository root is RESOLVED with
 *   `git rev-parse --show-toplevel` rather than counted with `../..`, so the suite is correct from
 *   a copied or relocated working directory.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const METRICS_SCRIPT = path.join(REPO_ROOT, "scripts", "testing", "metrics.mjs");
const TRACKER = path.join(REPO_ROOT, "docs", "development", "TESTING_REFOUNDATION.md");

/**
 * The metrics whose value is derived from the tree at HEAD, and are therefore comparable to the
 * tracker's Now column byte for byte. Everything else names a run, an absent artefact, or the
 * network, and says so in its own source field.
 */
const DERIVED_IDS = ["M1", "M7", "M8"] as const;

interface MetricLine {
  readonly id: string;
  readonly value: string;
  readonly source: string;
}

const runMetrics = (args: readonly string[]): string =>
  execFileSync(process.execPath, [METRICS_SCRIPT, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });

const parseMetricLines = (stdout: string): MetricLine[] =>
  stdout
    .split("\n")
    .filter((line) => /^M\d+\t/.test(line))
    .map((line) => {
      const [id = "", value = "", source = ""] = line.split("\t");
      return { id, value, source };
    });

/** The `Now` cell of every `M<n>` row of the tracker's Metrics table. */
const readTrackerNow = (): Map<string, string> => {
  const now = new Map<string, string>();
  for (const line of readFileSync(TRACKER, "utf8").split("\n")) {
    if (!line.startsWith("| M")) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    const id = cells[1];
    const value = cells[4];
    if (id === undefined || value === undefined) continue;
    if (!/^M\d+$/.test(id)) continue;
    now.set(id, value);
  }
  return now;
};

describe("testing re-foundation metrics script", () => {
  describe("the whole table", () => {
    it("prints every metric the tracker declares, in order, exactly once", () => {
      // The expected set is READ from the tracker rather than listed here. A third hand-written
      // copy of the metric ids would be one more thing to drift, and this workstream exists in
      // part because hand-written lists of what should run kept disagreeing with what ran.
      const declared = [...readTrackerNow().keys()];
      const printed = parseMetricLines(runMetrics(["--all", "--offline"])).map((row) => row.id);

      expect(declared.length).toBeGreaterThan(0);
      expect(printed).toEqual(declared);
    });

    it("names a source class and a reason for every metric it cannot derive", () => {
      const rows = parseMetricLines(runMetrics(["--all", "--offline"]));

      const malformed = rows.filter(
        (row) => !/^(derived|pasted|network|unavailable): \S/.test(row.source)
      );

      expect(malformed).toEqual([]);
    });

    it("derives exactly the metrics the tracker says are derived from the tree", () => {
      const rows = parseMetricLines(runMetrics(["--all", "--offline"]));

      const derived = rows.filter((row) => row.source.startsWith("derived:")).map((row) => row.id);

      expect(derived).toEqual([...DERIVED_IDS]);
    });
  });

  describe("the now column", () => {
    it("reproduces every derived value of the Now column byte for byte", () => {
      const now = readTrackerNow();
      const rows = parseMetricLines(runMetrics(["--all", "--offline"])).filter((row) =>
        row.source.startsWith("derived:")
      );

      const derivedPairs = rows.map((row) => `${row.id}=${row.value}`);
      const trackerPairs = rows.map((row) => `${row.id}=${now.get(row.id) ?? "<missing row>"}`);

      expect(derivedPairs).toEqual(trackerPairs);
    });
  });

  describe("a single metric", () => {
    it("prints the same line alone as it does inside the whole table", () => {
      const all = parseMetricLines(runMetrics(["--all", "--offline"]));

      for (const id of DERIVED_IDS) {
        const alone = parseMetricLines(runMetrics([`--${id.toLowerCase()}`, "--offline"]));
        const inTable = all.filter((row) => row.id === id);

        expect(alone).toEqual(inTable);
      }
    });

    it("exits non-zero on an unknown flag rather than printing nothing", () => {
      expect(() => runMetrics(["--m99", "--offline"])).toThrow();
    });
  });
});
