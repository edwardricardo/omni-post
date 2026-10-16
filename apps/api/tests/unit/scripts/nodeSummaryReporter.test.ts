/**
 * @file nodeSummaryReporter.test.ts
 * @description Pins `scripts/testing/node-summary-reporter.mjs`, the node:test reporter the
 *   integration collector (`apps/api/scripts/run-tests.sh`) reads its verdict from. The
 *   collector reads ONE line of what it prints, `@@SUMMARY tests=N pass=N fail=N cancelled=N
 *   skipped=N todo=N`, so that line is what most cases assert, exactly.
 *
 *   Two halves. The first runs the real node:test runner with the reporter over small files
 *   written into a scratch directory here, one per shape the collector's guards read: a pass, a
 *   failure, a broken `before` hook, a timeout, a runtime skip, a todo, a file that throws while
 *   it loads, a file that registers no test, and a file that prints. The second feeds the
 *   reporter synthetic events in a node process of its own, for what a real run cannot produce
 *   on demand: a `test:summary` whose counts disagree with the events, and a run that ends
 *   without a cumulative summary.
 * @layer infrastructure
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const REPORTER = path.join(REPO_ROOT, "scripts", "testing", "node-summary-reporter.mjs");

/** The integration collector, whose `SUMMARY_LINE` pattern reads the reporter's line. */
const RUNNER = path.join(REPO_ROOT, "apps", "api", "scripts", "run-tests.sh");

/** The cap `spawnSync` puts on one node process a case starts. */
const SPAWN_TIMEOUT_MS = 60_000;

/**
 * No case starts more than one process. The vitest default of 5 s is shorter than one cap,
 * and a node:test run on a loaded host can take longer than that to start and finish.
 */
vi.setConfig({ testTimeout: 2 * SPAWN_TIMEOUT_MS });

/** The output of one process, and the exit code it ended on. */
interface Run {
  readonly exitCode: number;
  readonly stdout: string;
}

/** One `TestsStream` event as the reporter receives it, with plain objects for errors. */
interface SyntheticEvent {
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
}

let scratch: string;

beforeAll(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "node-summary-reporter-"));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * Writes `source` as `<name>.test.mjs` in the scratch directory and runs it alone under the
 * reporter, with the flags `run-tests.sh` passes that do not need a transpiler.
 */
function runFile(name: string, source: string): Run {
  const file = `${name}.test.mjs`;
  writeFileSync(path.join(scratch, file), source, "utf8");
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      `--test-reporter=${REPORTER}`,
      "--test-reporter-destination=stdout",
      "--test-force-exit",
      "--test-concurrency=1",
      file,
    ],
    { cwd: scratch, encoding: "utf8", timeout: SPAWN_TIMEOUT_MS }
  );
  return { exitCode: result.status ?? -1, stdout: result.stdout ?? "" };
}

/**
 * Feeds `events` to the reporter in a node process of its own and returns what it printed.
 * The module is imported there rather than here, the way node loads a reporter.
 */
function feed(events: readonly SyntheticEvent[]): Run {
  const prelude = [
    "const { default: reporter } = await import(process.argv[1]);",
    "const events = JSON.parse(process.argv[2]);",
    "async function* source() { yield* events; }",
    "for await (const chunk of reporter(source())) process.stdout.write(chunk);",
  ].join("\n");
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", prelude, "--", REPORTER, JSON.stringify(events)],
    { cwd: scratch, encoding: "utf8", timeout: SPAWN_TIMEOUT_MS }
  );
  return { exitCode: result.status ?? -1, stdout: result.stdout ?? "" };
}

/** Every line of `stdout` that starts with the anchor the collector reads. */
function summaryLines(stdout: string): string[] {
  return stdout.split("\n").filter((line) => line.startsWith("@@SUMMARY "));
}

/** A completed test, passing unless `extra` says otherwise. */
function completed(
  type: "test:pass" | "test:fail",
  name: string,
  extra: Readonly<Record<string, unknown>> = {}
): SyntheticEvent {
  return { type, data: { name, nesting: 0, details: { type: "test" }, ...extra } };
}

/** The cumulative summary event, the one without a `file`. */
function summary(counts: Readonly<Record<string, number>>): SyntheticEvent {
  return {
    type: "test:summary",
    data: {
      success: false,
      counts: { tests: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0, ...counts },
    },
  };
}

describe("node-summary-reporter over a real node:test run", () => {
  it("prints one summary line for a passing file", () => {
    const run = runFile("passes", 'import { it } from "node:test";\nit("passes", () => {});\n');

    expect({ exitCode: run.exitCode, summary: summaryLines(run.stdout) }).toEqual({
      exitCode: 0,
      summary: ["@@SUMMARY tests=1 pass=1 fail=0 cancelled=0 skipped=0 todo=0"],
    });
  });

  it("counts a failing test and prints it with its location, its error and its frame", () => {
    const run = runFile(
      "fails",
      'import { it } from "node:test";\nit("fails", () => { throw new Error("planted failure"); });\n'
    );

    expect({ exitCode: run.exitCode, summary: summaryLines(run.stdout) }).toEqual({
      exitCode: 1,
      summary: ["@@SUMMARY tests=1 pass=0 fail=1 cancelled=0 skipped=0 todo=0"],
    });
    expect(run.stdout).toContain(
      "failed: fails (fails.test.mjs:2:1)\n  testCodeFailure: planted failure\n    at "
    );
    expect(run.stdout).toMatch(/^ {4}at .*fails\.test\.mjs:2:\d+\)$/m);
  });

  it("counts the tests a broken before hook cancels as cancelled, and names the hook's error", () => {
    // The shape a gate reading only failures calls green: Node fails the suite and cancels
    // its tests, and counts no failed test at all.
    const run = runFile(
      "hook",
      [
        'import { before, describe, it } from "node:test";',
        'describe("broken", () => {',
        '  before(() => { throw new Error("planted hook failure"); });',
        '  it("a", () => {});',
        '  it("b", () => {});',
        "});",
        "",
      ].join("\n")
    );

    expect({ exitCode: run.exitCode, summary: summaryLines(run.stdout) }).toEqual({
      exitCode: 1,
      summary: ["@@SUMMARY tests=2 pass=0 fail=0 cancelled=2 skipped=0 todo=0"],
    });
    expect(run.stdout).toContain(
      "cancelled: broken > a (hook.test.mjs:4:3)\n  cancelledByParent: test did not finish before its parent and was cancelled\n"
    );
    expect(run.stdout).toContain(
      "suite failed: broken (hook.test.mjs:2:1)\n  hookFailed: failed running before hook\n  cause: planted hook failure\n"
    );
  });

  it("counts a test that times out as cancelled, as Node's own counts do", () => {
    // A cross-check that knew only `cancelledByParent` would disagree with Node here and
    // report a mismatch on every timeout.
    const run = runFile(
      "timeout",
      [
        'import { it } from "node:test";',
        'it("hangs", { timeout: 50 }, () => new Promise((resolve) => setTimeout(resolve, 2000)));',
        "",
      ].join("\n")
    );

    expect({
      exitCode: run.exitCode,
      summary: summaryLines(run.stdout),
      mismatch: run.stdout.includes("summary mismatch"),
    }).toEqual({
      exitCode: 1,
      summary: ["@@SUMMARY tests=1 pass=0 fail=0 cancelled=1 skipped=0 todo=0"],
      mismatch: false,
    });
    expect(run.stdout).toContain("  testTimeoutFailure: test timed out after 50ms\n");
  });

  it("counts a runtime skip and a todo, and prints each with its reason", () => {
    const run = runFile(
      "directives",
      [
        'import { it } from "node:test";',
        'it("needs a service", (t) => { t.skip("absent"); });',
        'it("later", { todo: "not written" }, () => {});',
        "",
      ].join("\n")
    );

    expect({ exitCode: run.exitCode, summary: summaryLines(run.stdout) }).toEqual({
      exitCode: 0,
      summary: ["@@SUMMARY tests=2 pass=0 fail=0 cancelled=0 skipped=1 todo=1"],
    });
    expect(run.stdout).toContain("skipped: needs a service (directives.test.mjs:2:1) — absent\n");
    expect(run.stdout).toContain("todo: later (directives.test.mjs:3:1) — not written\n");
  });

  it("counts a file that throws while it loads as one failure, with the process's exit code", () => {
    const run = runFile("crash", 'throw new Error("planted load failure");\n');

    expect({ exitCode: run.exitCode, summary: summaryLines(run.stdout) }).toEqual({
      exitCode: 1,
      summary: ["@@SUMMARY tests=1 pass=0 fail=1 cancelled=0 skipped=0 todo=0"],
    });
    expect(run.stdout).toContain(
      "failed: crash.test.mjs (crash.test.mjs:1:1)\n  testCodeFailure: test failed\n  exit code 1\n"
    );
    expect(run.stdout).toContain("# Error: planted load failure\n");
  });

  it("counts zero tests for a file that registers none, which Node reports as one passing test", () => {
    // Node's stand-in is a passing test named by the file's path. Counted, an emptied
    // suite reads as one pass and the collector's zero-collection guard never fires.
    const run = runFile("empty", "export {};\n");

    expect({ exitCode: run.exitCode, summary: summaryLines(run.stdout) }).toEqual({
      exitCode: 0,
      summary: ["@@SUMMARY tests=0 pass=0 fail=0 cancelled=0 skipped=0 todo=0"],
    });
    expect(run.stdout).toContain("no test registered: empty.test.mjs — ");
  });

  it("relays what a suite prints behind '# ', so no printed line passes for the summary", () => {
    const run = runFile(
      "prints",
      [
        'import { it } from "node:test";',
        'it("prints", () => {',
        '  console.error("a line from the suite");',
        '  console.error("@@SUMMARY tests=9 pass=9 fail=0 cancelled=0 skipped=0 todo=0");',
        "});",
        "",
      ].join("\n")
    );

    expect({ exitCode: run.exitCode, summary: summaryLines(run.stdout) }).toEqual({
      exitCode: 0,
      summary: ["@@SUMMARY tests=1 pass=1 fail=0 cancelled=0 skipped=0 todo=0"],
    });
    expect(run.stdout).toContain("# a line from the suite\n");
    expect(run.stdout).toContain("# @@SUMMARY tests=9 pass=9");
  });
});

describe("the collector's pattern reads the reporter's line", () => {
  /** The `SUMMARY_LINE` pattern exactly as run-tests.sh assigns it, without its quotes. */
  function runnerSummaryPattern(): string {
    const assignment = readFileSync(RUNNER, "utf8")
      .split("\n")
      .find((line) => line.startsWith("SUMMARY_LINE='"));
    return /^SUMMARY_LINE='(.*)'$/.exec(assignment ?? "")?.[1] ?? "";
  }

  it("matches the line a real run prints whole, in bash, with each count in the group the collector reads", () => {
    // The collector reads groups 1 to 5 as tests, pass, fail, cancelled and skipped. A
    // field the reporter renamed, reordered or added would leave every file without a
    // verdict at run time; matched here, by bash's own `=~` as the collector matches it,
    // the drift is a unit-test red. The counts differ from each other where they can, so
    // a group read from the wrong field cannot pass.
    const run = runFile(
      "coupled",
      [
        'import { it } from "node:test";',
        'it("one", () => {});',
        'it("two", () => {});',
        'it("three", () => {});',
        'it("fails", () => { throw new Error("planted"); });',
        'it("skip one", (t) => { t.skip("absent"); });',
        'it("skip two", (t) => { t.skip("absent"); });',
        'it("later", { todo: "not written" }, () => {});',
        "",
      ].join("\n")
    );
    const [line = ""] = summaryLines(run.stdout);
    const pattern = runnerSummaryPattern();
    const matched = spawnSync(
      "bash",
      ["-c", '[[ $1 =~ $2 ]] && printf "%s\\n" "${BASH_REMATCH[@]:1}"', "coupling", line, pattern],
      { encoding: "utf8", timeout: SPAWN_TIMEOUT_MS }
    );

    expect(pattern.startsWith("^@@SUMMARY ")).toBe(true);
    expect({
      line,
      matchExit: matched.status,
      groups: (matched.stdout ?? "").split("\n").filter(Boolean),
    }).toEqual({
      line: "@@SUMMARY tests=7 pass=3 fail=1 cancelled=0 skipped=2 todo=1",
      matchExit: 0,
      groups: ["7", "3", "1", "0", "2", "1"],
    });
  });
});

describe("node-summary-reporter over synthetic events", () => {
  it("counts a cancelledByParent failure as cancelled", () => {
    const run = feed([
      completed("test:fail", "cut short", {
        details: {
          type: "test",
          error: { message: "cancelled by its parent", failureType: "cancelledByParent" },
        },
      }),
      summary({ tests: 1, cancelled: 1 }),
    ]);

    expect(summaryLines(run.stdout)).toEqual([
      "@@SUMMARY tests=1 pass=0 fail=0 cancelled=1 skipped=0 todo=0",
    ]);
  });

  it("prints both counts when the summary disagrees with the events, and takes the larger failure count", () => {
    const run = feed([
      completed("test:pass", "passes"),
      completed("test:fail", "fails", {
        details: { type: "test", error: { message: "boom", failureType: "testCodeFailure" } },
      }),
      summary({ tests: 2, passed: 2 }),
    ]);

    expect(run.stdout.split("\n").filter((line) => line.startsWith("summary mismatch: "))).toEqual([
      "summary mismatch: the test:summary event counts tests=2 pass=2 fail=0 cancelled=0 skipped=0 todo=0",
      "summary mismatch: the test events add up to   tests=2 pass=1 fail=1 cancelled=0 skipped=0 todo=0",
      "summary mismatch: each count below takes the value that fails the run",
    ]);
    expect(summaryLines(run.stdout)).toEqual([
      "@@SUMMARY tests=2 pass=1 fail=1 cancelled=0 skipped=0 todo=0",
    ]);
  });

  it("takes the summary's larger failure count, and the smaller test count, over the events", () => {
    const run = feed([completed("test:pass", "passes"), summary({ tests: 0, failed: 3 })]);

    expect(summaryLines(run.stdout)).toEqual([
      "@@SUMMARY tests=0 pass=0 fail=3 cancelled=0 skipped=0 todo=0",
    ]);
  });

  it("prints the summary once, for the cumulative event, not for a file's own", () => {
    const run = feed([
      completed("test:pass", "passes"),
      { type: "test:summary", data: { file: "/x.test.mjs", counts: { tests: 1, passed: 1 } } },
      summary({ tests: 1, passed: 1 }),
    ]);

    expect(summaryLines(run.stdout)).toEqual([
      "@@SUMMARY tests=1 pass=1 fail=0 cancelled=0 skipped=0 todo=0",
    ]);
  });

  it("prints no summary line, and says so, when no cumulative summary arrives", () => {
    const run = feed([
      completed("test:pass", "passes"),
      { type: "test:summary", data: { file: "/x.test.mjs", counts: { tests: 1, passed: 1 } } },
    ]);

    expect({ exitCode: run.exitCode, summary: summaryLines(run.stdout) }).toEqual({
      exitCode: 0,
      summary: [],
    });
    expect(run.stdout).toContain("no cumulative test:summary event arrived");
  });

  it("cuts a long detail, and names a signal, a failure with no error and an interrupted test", () => {
    const longMessage = Array.from({ length: 50 }, (_, index) => `line ${index + 1}`).join("\n");
    const run = feed([
      completed("test:fail", "long", {
        details: { type: "test", error: { message: longMessage, failureType: "testCodeFailure" } },
      }),
      completed("test:fail", "killed", {
        details: {
          type: "test",
          error: { message: "test failed", failureType: "testCodeFailure", signal: "SIGKILL" },
        },
      }),
      completed("test:fail", "bare", { details: { type: "test" } }),
      {
        type: "test:interrupted",
        data: { tests: [{ name: "hung", file: path.join(scratch, "hung.test.mjs"), line: 3 }] },
      },
      summary({ tests: 3, failed: 3 }),
    ]);

    expect(run.stdout).toContain("  line 40\n  … 10 more lines\nfailed: killed\n");
    expect(run.stdout).not.toContain("  line 41\n");
    expect(run.stdout).toContain("  testCodeFailure: test failed\n  signal SIGKILL\n");
    expect(run.stdout).toContain("failed: bare\n  the event carried no error\n");
    expect(run.stdout).toContain("interrupted: hung (hung.test.mjs:3:1)\n");
    expect(summaryLines(run.stdout)).toEqual([
      "@@SUMMARY tests=3 pass=0 fail=3 cancelled=0 skipped=0 todo=0",
    ]);
  });
});
