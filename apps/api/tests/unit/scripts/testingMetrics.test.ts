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
 *
 *   M5 runs the reach engine of `packages/test-contracts`, which asks every collector what it runs
 *   and takes seconds, so the suite runs `--all` once and every case reads that one output; only
 *   the single-metric case runs `--m5` again, under the same budget. The ledger metrics, M4, M6 and
 *   M14, are also run over ledgers of the suite's own, a recorded deletion and the ledgers they
 *   cannot read among them: each runs the script inside a throwaway git repository, in a private
 *   directory that `mkdtempSync` creates, so the committed ledger is never touched.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const METRICS_SCRIPT = path.join(REPO_ROOT, "scripts", "testing", "metrics.mjs");
const TRACKER = path.join(REPO_ROOT, "docs", "development", "TESTING_REFOUNDATION.md");

/**
 * The metrics whose value is derived from the tree at HEAD, and are therefore comparable to the
 * tracker's Now column byte for byte. Everything else names a run, an absent artefact, a metric
 * no lint rule counts yet, or the network, and says so in its own source field.
 */
const DERIVED_IDS = ["M1", "M3", "M4", "M5", "M6", "M7", "M8", "M14"] as const;

/**
 * The budget of one run that includes M5. The reach engine took about 3 s on an idle machine on
 * 2026-10-14; the battery runs this suite beside other steps, so the budget is generous rather
 * than measured to the edge.
 */
const REACH_BUDGET_MS = 60_000;

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

/**
 * Returns the rows the suite read, refusing an empty table. A case that filters the table for
 * something wrong finds nothing in an empty one and passes, so every case reads the rows through
 * here and fails instead when the shared run left them unset or printed no metric line.
 */
const rowsRead = (rows: readonly MetricLine[]): readonly MetricLine[] => {
  if (rows.length === 0) {
    throw new Error(
      "metrics.mjs printed no metric line; a case over an empty table proves nothing"
    );
  }
  return rows;
};

/** The throwaway repositories the ledger-metric cases create, removed once the suite ends. */
const fixtureRepos: string[] = [];

/**
 * Runs one metric at the root of a fresh git repository whose ledger.json is `ledger`, or that
 * holds none when `ledger` is `null`, and returns the line it prints.
 */
const metricOverLedger = (flag: string, ledger: string | null): MetricLine | undefined => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "metrics-ledger-"));
  fixtureRepos.push(repo);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  if (ledger !== null) writeFileSync(path.join(repo, "ledger.json"), ledger);
  const stdout = execFileSync(process.execPath, [METRICS_SCRIPT, flag, "--offline"], {
    encoding: "utf8",
    cwd: repo,
  });
  return parseMetricLines(stdout)[0];
};

/**
 * A ledger holding `slices` as its slices and `deleted` as its `summary.deleted`, the two parts
 * M4 and M14 read.
 */
const ledgerOf = (slices: unknown, deleted: unknown = { files: 0, blocks: 0 }): string =>
  JSON.stringify({ summary: { deleted }, slices });

/** A live slice: its files are still rows and it records no deletion, so it adds nothing. */
const LIVE_SLICE = {
  files: ["apps/api/tests/unit/a.test.ts"],
  expectedDrop: { files: 1, blocks: 4 },
};

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
  let allRows: MetricLine[] = [];

  beforeAll(() => {
    allRows = parseMetricLines(runMetrics(["--all", "--offline"]));
  }, REACH_BUDGET_MS);

  afterAll(() => {
    for (const repo of fixtureRepos) rmSync(repo, { recursive: true, force: true });
  });

  describe("the whole table", () => {
    it("refuses to read an empty table, so no case can pass over rows it never saw", () => {
      expect(() => rowsRead([])).toThrow(/no metric line/);
    });

    it("prints every metric the tracker declares, in order, exactly once", () => {
      // The expected set is READ from the tracker rather than listed here. A third hand-written
      // copy of the metric ids would be one more thing to drift, and this workstream exists in
      // part because hand-written lists of what should run kept disagreeing with what ran.
      const declared = [...readTrackerNow().keys()];
      const printed = rowsRead(allRows).map((row) => row.id);

      expect(declared.length).toBeGreaterThan(0);
      expect(printed).toEqual(declared);
    });

    it("names a source class and a reason for every metric it cannot derive", () => {
      const malformed = rowsRead(allRows).filter(
        (row) => !/^(derived|pasted|network|unavailable): \S/.test(row.source)
      );

      expect(malformed).toEqual([]);
    });

    it("derives exactly the metrics the tracker says are derived from the tree", () => {
      const derived = rowsRead(allRows)
        .filter((row) => row.source.startsWith("derived:"))
        .map((row) => row.id);

      expect(derived).toEqual([...DERIVED_IDS]);
    });
  });

  describe("the now column", () => {
    it("reproduces every derived value of the Now column byte for byte", () => {
      const now = readTrackerNow();
      const rows = rowsRead(allRows).filter((row) => row.source.startsWith("derived:"));

      const derivedPairs = rows.map((row) => `${row.id}=${row.value}`);
      const trackerPairs = rows.map((row) => `${row.id}=${now.get(row.id) ?? "<missing row>"}`);

      expect(derivedPairs).toEqual(trackerPairs);
    });
  });

  describe("a single metric", () => {
    it(
      "prints the same line alone as it does inside the whole table",
      { timeout: REACH_BUDGET_MS },
      () => {
        for (const id of DERIVED_IDS) {
          const alone = parseMetricLines(runMetrics([`--${id.toLowerCase()}`, "--offline"]));
          const inTable = rowsRead(allRows).filter((row) => row.id === id);

          expect(alone).toEqual(inTable);
        }
      }
    );

    it("exits non-zero on an unknown flag rather than printing nothing", () => {
      expect(() => runMetrics(["--m99", "--offline"])).toThrow();
    });
  });

  describe("M6 over a ledger of its own", () => {
    /** Runs `--m6` at the root of a fresh git repository holding `ledger` as its ledger.json. */
    const m6In = (ledger: string | null): MetricLine | undefined =>
      metricOverLedger("--m6", ledger);

    it("derives machine / confirmed / total from summary.rows", () => {
      const line = m6In(
        JSON.stringify({ summary: { rows: { machine: 3, confirmed: 1, total: 4 } } })
      );

      expect(line).toEqual({
        id: "M6",
        value: "3 / 1 / 4",
        source: "derived: ledger.json summary.rows, machine / confirmed / total",
      });
    });

    it.each([
      ["no ledger.json", null, "unavailable: ledger.json is not present in the tree yet"],
      ["a ledger.json that is no JSON", '{ "summary": ', "unavailable: ledger.json is not JSON"],
      ["a ledger.json that is null", "null", "unavailable: ledger.json holds no summary.rows"],
      [
        "a count that is not an integer",
        JSON.stringify({ summary: { rows: { machine: "3", confirmed: 1, total: 4 } } }),
        "unavailable: ledger.json holds no summary.rows",
      ],
    ])("reads as unavailable, never as zeros, given %s", (_case, ledger, source) => {
      expect(m6In(ledger)).toEqual({ id: "M6", value: "—", source });
    });
  });

  describe("M4 over a ledger of its own", () => {
    /** Runs `--m4` at the root of a fresh git repository holding `ledger` as its ledger.json. */
    const m4In = (ledger: string | null): MetricLine | undefined =>
      metricOverLedger("--m4", ledger);

    it("derives 0 from summary.deleted when no slice records a deletion", () => {
      const line = m4In(ledgerOf({ "2.6a": LIVE_SLICE }));

      expect(line).toEqual({
        id: "M4",
        value: "0",
        source:
          "derived: ledger.json summary.deleted, 0 files and 0 blocks; no slice records a deletion",
      });
    });

    it("sums the deleted slices' files and blocks and lists each slice by id", () => {
      const line = m4In(
        ledgerOf(
          {
            "2.7": {
              files: ["apps/api/tests/unit/d.test.ts"],
              deleted: { files: 1, blocks: 18 },
              floors: {},
            },
            "2.6b": LIVE_SLICE,
            "2.6a": {
              files: [
                "apps/api/tests/unit/a.test.ts",
                "apps/api/tests/unit/b.test.ts",
                "apps/api/tests/unit/c.test.ts",
              ],
              deleted: { files: 3, blocks: 12 },
              floors: {},
            },
          },
          { files: 4, blocks: 30 }
        )
      );

      expect(line).toEqual({
        id: "M4",
        value: "4",
        source:
          "derived: ledger.json summary.deleted, 4 files and 30 blocks; " +
          "2.6a: 3 files, 12 blocks; 2.7: 1 file, 18 blocks",
      });
    });

    it.each([
      ["no ledger.json", null, "unavailable: ledger.json is not present in the tree yet"],
      ["a ledger.json that is no JSON", '{ "summary": ', "unavailable: ledger.json is not JSON"],
      ["a ledger.json that is null", "null", "unavailable: ledger.json holds no summary.deleted"],
      [
        "a summary.deleted count that is not an integer",
        ledgerOf({}, { files: "0", blocks: 0 }),
        "unavailable: ledger.json holds no summary.deleted",
      ],
      ["no slices object", ledgerOf(null), "unavailable: ledger.json holds no slices"],
      [
        "a slice that is not an object",
        ledgerOf({ "2.7": [] }),
        "unavailable: ledger.json slice 2.7 is not an object",
      ],
      [
        "a deleted slice whose drop is not whole files and blocks",
        ledgerOf({ "2.7": { files: [], deleted: { files: 1.5, blocks: 3 }, floors: {} } }),
        "unavailable: ledger.json slice 2.7 records a drop that is not whole files and blocks",
      ],
      [
        "a summary.deleted that is not the sum of its deleted slices",
        ledgerOf(
          { "2.7": { files: [], deleted: { files: 2, blocks: 18 }, floors: {} } },
          { files: 2, blocks: 17 }
        ),
        "unavailable: ledger.json summary.deleted is not the sum of its deleted slices",
      ],
      [
        "a summary.deleted whose files alone are not the sum of its deleted slices",
        ledgerOf(
          { "2.7": { files: [], deleted: { files: 2, blocks: 18 }, floors: {} } },
          { files: 3, blocks: 18 }
        ),
        "unavailable: ledger.json summary.deleted is not the sum of its deleted slices",
      ],
    ])("reads as unavailable, never as zeros, given %s", (_case, ledger, source) => {
      expect(m4In(ledger)).toEqual({ id: "M4", value: "—", source });
    });
  });

  describe("M14 over a ledger of its own", () => {
    /** Runs `--m14` at the root of a fresh git repository holding `ledger` as its ledger.json. */
    const m14In = (ledger: string | null): MetricLine | undefined =>
      metricOverLedger("--m14", ledger);

    it("lists each slice's descents and sums them per metric", () => {
      const line = m14In(
        ledgerOf(
          {
            "2.7": {
              files: ["apps/api/tests/unit/d.test.ts"],
              deleted: { files: 1, blocks: 6 },
              floors: { lines: { from: 55.2, to: 54.9 } },
            },
            "2.6a": {
              files: ["apps/api/tests/unit/a.test.ts"],
              deleted: { files: 1, blocks: 4 },
              floors: { branches: { from: 47.8, to: 47.1 }, lines: { from: 56.8, to: 55.2 } },
            },
            "2.6b": LIVE_SLICE,
          },
          { files: 2, blocks: 10 }
        )
      );

      expect(line).toEqual({
        id: "M14",
        value: "3",
        source:
          "derived: ledger.json deleted slices' floors, " +
          "2.6a: lines 56.8 → 55.2, branches 47.8 → 47.1; 2.7: lines 55.2 → 54.9; " +
          "descents per metric: lines 1.9, functions 0, branches 0.7, statements 0",
      });
    });

    it("derives 0 when no deleted slice records a floor descent", () => {
      const line = m14In(
        ledgerOf(
          {
            "2.6a": LIVE_SLICE,
            "2.7": {
              files: ["apps/api/tests/unit/d.test.ts"],
              deleted: { files: 1, blocks: 6 },
              floors: {},
            },
          },
          { files: 1, blocks: 6 }
        )
      );

      expect(line).toEqual({
        id: "M14",
        value: "0",
        source:
          "derived: ledger.json deleted slices' floors, no slice records a descent; " +
          "descents per metric: lines 0, functions 0, branches 0, statements 0",
      });
    });

    it("reads a deleted slice written without floors as no descent, and M4 still counts its drop", () => {
      const ledger = ledgerOf(
        { "2.7": { files: ["apps/api/tests/unit/d.test.ts"], deleted: { files: 1, blocks: 6 } } },
        { files: 1, blocks: 6 }
      );

      expect([m14In(ledger), metricOverLedger("--m4", ledger)]).toEqual([
        {
          id: "M14",
          value: "0",
          source:
            "derived: ledger.json deleted slices' floors, no slice records a descent; " +
            "descents per metric: lines 0, functions 0, branches 0, statements 0",
        },
        {
          id: "M4",
          value: "1",
          source:
            "derived: ledger.json summary.deleted, 1 file and 6 blocks; 2.7: 1 file, 6 blocks",
        },
      ]);
    });

    it.each([
      ["no ledger.json", null, "unavailable: ledger.json is not present in the tree yet"],
      ["a ledger.json that is null", "null", "unavailable: ledger.json holds no slices"],
      [
        "a floor that stays where it was",
        ledgerOf({
          "2.7": {
            files: [],
            deleted: { files: 1, blocks: 6 },
            floors: { lines: { from: 55.2, to: 55.2 } },
          },
        }),
        "unavailable: ledger.json slice 2.7 records a floor that is not a descent of " +
          "lines, functions, branches or statements",
      ],
      [
        "a floor that does not descend",
        ledgerOf({
          "2.7": {
            files: [],
            deleted: { files: 1, blocks: 6 },
            floors: { lines: { from: 54.9, to: 55.2 } },
          },
        }),
        "unavailable: ledger.json slice 2.7 records a floor that is not a descent of " +
          "lines, functions, branches or statements",
      ],
      [
        "a floor of a metric that fitness #37 (scripts/testing/coverage-floor-gate.mjs) does not hold",
        ledgerOf({
          "2.7": {
            files: [],
            deleted: { files: 1, blocks: 6 },
            floors: { mutation: { from: 60, to: 55 } },
          },
        }),
        "unavailable: ledger.json slice 2.7 records a floor that is not a descent of " +
          "lines, functions, branches or statements",
      ],
    ])("reads as unavailable, never as zeros, given %s", (_case, ledger, source) => {
      expect(m14In(ledger)).toEqual({ id: "M14", value: "—", source });
    });
  });
});
