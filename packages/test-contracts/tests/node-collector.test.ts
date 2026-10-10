/**
 * @file node-collector.test.ts
 * @description Self-tests of the node:test collector: how a `run-tests.sh --list` output is read,
 *              line by line, and every way it fails closed — no line, a malformed line, an unknown
 *              kind, an absolute or repeated path, an untracked path, a run that exits non-zero or
 *              stops, a listing with nothing to collect. The real spawn runs a planted runner, never
 *              the repository's, and proves the runner starts without `DATABASE_URL` and `TIER`.
 * @layer infrastructure
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNodeCollector,
  NODE_RUNNER,
  parseRunnerList,
  type RunnerRun,
} from "../src/lib/node-collector.js";
import type { CollectorContext } from "../src/lib/registry.js";
import { plantTree, removeTree, type PlantedTree } from "./fixtures/tree.js";

const SOURCE = `${NODE_RUNNER.packageDir}/${NODE_RUNNER.script}`;
const INTEGRATION = "apps/api/tests/integration/a.integration.test.ts";
const LIVE = "apps/api/tests/b.live.test.ts";
const QUARANTINED = "apps/api/tests/integration/c.integration.test.ts";

/** A `--list` output naming one file of each kind, as the runner names them. */
const LISTING = [
  "integration\ttests/integration/a.integration.test.ts",
  "live\ttests/b.live.test.ts",
  "quarantined\ttests/integration/c.integration.test.ts",
  "",
].join("\n");

/** A context whose tracked files are the three listed ones. */
const CONTEXT: CollectorContext = { root: "/repo", tracked: [INTEGRATION, LIVE, QUARANTINED] };

/** A run that printed the given output and exited 0. */
function printed(stdout: string): () => RunnerRun {
  return () => ({ status: 0, signal: null, stdout, stderr: "" });
}

const planted: PlantedTree[] = [];

/** Plants a tree whose runner script has the given body. */
function plantRunner(body: string): PlantedTree {
  const tree = plantTree({ [SOURCE]: `#!/usr/bin/env bash\n${body}\n`, [INTEGRATION]: "" });
  planted.push(tree);
  return tree;
}

describe("node:test --list parsing", () => {
  it("returns every line with its kind and a repository-relative path", () => {
    expect(parseRunnerList(LISTING, "apps/api")).toEqual({
      ok: true,
      value: [
        { kind: "integration", file: INTEGRATION },
        { kind: "live", file: LIVE },
        { kind: "quarantined", file: QUARANTINED },
      ],
    });
  });

  it("returns the listing of an output with no final newline", () => {
    const parsed = parseRunnerList("live\ttests/b.live.test.ts", "apps/api");

    expect(parsed).toEqual({ ok: true, value: [{ kind: "live", file: LIVE }] });
  });

  it.each([
    ["no output", "", "--list printed no line"],
    ["a lone newline", "\n", "--list printed no line"],
    ["a blank line", "live\ttests/b.live.test.ts\n\n", 'line 2 is not "<kind>\\t<path>"'],
    ["a line with no tab", "integration tests/a.test.ts\n", 'line 1 is not "<kind>\\t<path>"'],
    ["a third field", "live\ttests/b.live.test.ts\textra\n", 'line 1 is not "<kind>\\t<path>"'],
    ["an unknown kind", "skipped\ttests/x.test.ts\n", 'line 1 carries the unknown kind "skipped"'],
    ["an absolute path", "live\t/tmp/x.live.test.ts\n", "line 1 names an absolute path"],
    [
      "a path listed under two kinds",
      "integration\ttests/x.test.ts\nlive\ttests/x.test.ts\n",
      "line 2 lists apps/api/tests/x.test.ts a second time",
    ],
  ])("returns a failure for an output with %s", (_label, stdout, expected) => {
    const parsed = parseRunnerList(stdout, "apps/api");

    expect(parsed.ok ? "" : parsed.error).toContain(expected);
  });
});

describe("node:test collector", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const tree of planted.splice(0)) removeTree(tree);
  });

  it("returns one collection per run kind and collects no quarantined file", async () => {
    const outcome = await createNodeCollector({ run: printed(LISTING) }).collect(CONTEXT);

    expect(outcome).toEqual({
      collections: [
        { collector: "node", source: `${SOURCE}#integration`, files: [INTEGRATION] },
        { collector: "node", source: `${SOURCE}#live`, files: [LIVE] },
      ],
      failures: [],
    });
  });

  it("returns a failure naming the exit code and the end of stderr when the runner fails", async () => {
    const run = (): RunnerRun => ({ status: 2, signal: null, stdout: "", stderr: "a\nb\nc\nd\n" });

    const outcome = await createNodeCollector({ run }).collect(CONTEXT);

    expect(outcome).toEqual({
      collections: [],
      failures: [{ collector: "node", source: SOURCE, message: "--list exited 2: b | c | d" }],
    });
  });

  it("returns a failure when the runner could not run or was stopped", async () => {
    const run = (): RunnerRun => ({
      status: null,
      signal: "SIGTERM",
      stdout: LISTING,
      stderr: "",
      error: "timed out after the 10 ms cap",
    });

    const outcome = await createNodeCollector({ run }).collect(CONTEXT);

    expect(outcome.failures).toEqual([
      {
        collector: "node",
        source: SOURCE,
        message: "--list could not run: timed out after the 10 ms cap",
      },
    ]);
  });

  it("returns a failure when the listing is malformed", async () => {
    const outcome = await createNodeCollector({ run: printed("unit\ttests/x.test.ts\n") }).collect(
      CONTEXT
    );

    expect(outcome.failures[0]?.message).toBe('--list line 1 carries the unknown kind "unit"');
  });

  it("returns a failure naming paths that are not tracked files", async () => {
    const stdout = "integration\tapps/api/tests/integration/a.integration.test.ts\n";

    const outcome = await createNodeCollector({ run: printed(stdout) }).collect(CONTEXT);

    expect(outcome.failures[0]?.message).toBe(
      "--list names 1 paths that are not tracked files: apps/api/apps/api/tests/integration/a.integration.test.ts"
    );
  });

  it("returns a failure when every listed file is quarantined", async () => {
    const stdout = "quarantined\ttests/integration/c.integration.test.ts\n";

    const outcome = await createNodeCollector({ run: printed(stdout) }).collect(CONTEXT);

    expect(outcome).toEqual({
      collections: [],
      failures: [
        {
          collector: "node",
          source: SOURCE,
          message: "--list collects no file; the runner must run at least one",
        },
      ],
    });
  });

  it("runs the planted runner with --list, without DATABASE_URL and TIER", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://must-not-reach/db");
    vi.stubEnv("TIER", "full-integration");
    const tree = plantRunner(
      [
        '[ "$1" = "--list" ] || exit 4',
        '[ -z "${DATABASE_URL:-}" ] || { echo "database reached" >&2; exit 3; }',
        '[ -z "${TIER:-}" ] || { echo "tier set" >&2; exit 5; }',
        "printf 'integration\\ttests/integration/a.integration.test.ts\\n'",
      ].join("\n")
    );

    const outcome = await createNodeCollector().collect(tree);

    expect(outcome).toEqual({
      collections: [{ collector: "node", source: `${SOURCE}#integration`, files: [INTEGRATION] }],
      failures: [],
    });
  });

  it("returns a failure when the planted runner exits non-zero instead of listing", async () => {
    const tree = plantRunner('echo "DATABASE_URL is empty" >&2\nexit 2');

    const outcome = await createNodeCollector().collect(tree);

    expect(outcome.failures).toEqual([
      { collector: "node", source: SOURCE, message: "--list exited 2: DATABASE_URL is empty" },
    ]);
  });

  it("returns a failure when the planted runner outlives its cap", async () => {
    const tree = plantRunner("exec sleep 5");

    const outcome = await createNodeCollector({ timeoutMs: 200 }).collect(tree);

    expect(outcome.failures[0]?.message).toBe(
      "--list could not run: timed out after the 200 ms cap"
    );
  });
});
