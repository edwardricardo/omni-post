/**
 * @file runTestsGate.behavior.test.ts
 * @description Executable proof that `apps/api/scripts/run-tests.sh` exits non-zero
 *              whenever a batch is recorded failed. Its sibling
 *              `runTestsGate.static.test.ts` reads the script's SHAPE; this one runs
 *              the real script and reads its EXIT CODE, which is the contract every
 *              "the tests pass" claim in this repository actually rests on.
 *
 *              A source scan alone is not enough. Piping a single `run_batch` call
 *              (`… | tee -a log`, an ordinary "keep this batch's output" edit) puts
 *              the function in a subshell, so its `FAILED_BATCHES` and `TOTAL_*`
 *              mutations never reach the parent — the gate reverts in full while
 *              every static assertion stays green. That is why the batch-accounting
 *              assertion below is not decoration: it compares the batches the run
 *              PRINTED as failed against the batches the run REPORTED as failed, and
 *              a lost mutation shows up as a name missing from the second list.
 *
 *              No real suite executes. A stub `node` is placed first on `PATH`, so
 *              every batch invocation is a few lines of `printf` and a chosen exit
 *              code: the whole script finishes in tens of milliseconds and the
 *              scenarios are exactly reproducible on any machine, with no database,
 *              no Redis and no recursion back into this runner. The stub is written
 *              here rather than committed as a script so the reproduction cannot
 *              drift away from the assertions that depend on it.
 * @layer infrastructure
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(currentDir, "..", "..", "..");
const runnerPath = join(apiRoot, "scripts", "run-tests.sh");

/**
 * `pr-integration` runs the node:test batches without the live-API ones, so no
 * scenario waits on `wait_for_api`'s curl loop, and the Vitest phase (which needs
 * `TIER` unset) stays out of the way. It is also the tier CI runs on pull requests.
 */
const TIER = "pr-integration";

/**
 * Overrides the runner's `.env` sourcing at the top of the script. Nothing connects
 * — the stub never opens a socket — but leaving the real URL in place would let a
 * future edit reach a live database from a unit test.
 */
const UNUSED_DATABASE_URL = "postgresql://gate-behavior@127.0.0.1:1/none";

/** The TAP summary a stub run reports, plus the exit code it ends on. */
interface StubShape {
  tests: number;
  pass: number;
  fail: number;
  cancel: number;
  exit: number;
}

interface RunResult {
  exitCode: number;
  stdout: string;
}

let stubDir: string;

/**
 * Writes the stand-in runner. It ignores its arguments — the batch file lists never
 * matter here — prints the five summary lines `run_batch` greps for, and ends on the
 * exit code the scenario is about.
 */
beforeAll(() => {
  stubDir = mkdtempSync(join(tmpdir(), "run-tests-gate-"));
  mkdirSync(stubDir, { recursive: true });
  const stubPath = join(stubDir, "node");
  writeFileSync(
    stubPath,
    [
      "#!/usr/bin/env bash",
      "printf '# tests %s\\n# suites 1\\n# pass %s\\n# fail %s\\n# cancelled %s\\n# skipped 0\\n# todo 0\\n' \\",
      '  "$GATE_STUB_TESTS" "$GATE_STUB_PASS" "$GATE_STUB_FAIL" "$GATE_STUB_CANCEL"',
      'exit "$GATE_STUB_EXIT"',
      "",
    ].join("\n"),
    "utf8"
  );
  chmodSync(stubPath, 0o755);
});

afterAll(() => {
  rmSync(stubDir, { recursive: true, force: true });
});

/** Runs the real script with every batch served by the stub. */
function runGate(shape: StubShape): RunResult {
  const result = spawnSync("bash", [runnerPath], {
    cwd: apiRoot,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH ?? ""}`,
      TIER,
      DATABASE_URL: UNUSED_DATABASE_URL,
      GATE_STUB_TESTS: String(shape.tests),
      GATE_STUB_PASS: String(shape.pass),
      GATE_STUB_FAIL: String(shape.fail),
      GATE_STUB_CANCEL: String(shape.cancel),
      GATE_STUB_EXIT: String(shape.exit),
    },
  });

  return { exitCode: result.status ?? -1, stdout: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** Batch names the run PRINTED with a `[FAIL]` marker, in order. */
function printedFailedBatches(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line.includes("[FAIL]"))
    .map((line) => line.trim().split(/\s+/)[0] ?? "")
    .filter((name) => name !== "");
}

/** Batch names the run REPORTED on its `FAILED batches:` line. */
function reportedFailedBatches(stdout: string): string[] {
  const line = stdout.split("\n").find((candidate) => candidate.startsWith("FAILED batches:"));
  if (line === undefined) return [];
  return line.slice("FAILED batches:".length).trim().split(/\s+/).filter(Boolean);
}

/** Batch names the run printed a summary row for, failed or not. */
function allBatchRows(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => /^\s{2}\S+\s+\d+ tests\s/.test(line))
    .map((line) => line.trim().split(/\s+/)[0] ?? "");
}

describe("run-tests.sh exits non-zero when a batch is recorded failed", () => {
  it("runs every batch through the stub instead of a real suite", () => {
    // Non-vacuity. If the stub were not on PATH the real runner would execute and
    // the scenarios below would be measuring something else entirely (or nothing,
    // with no database). More than one batch is required for the accounting
    // assertion to be able to detect a single lost batch.
    const run = runGate({ tests: 1, pass: 1, fail: 0, cancel: 0, exit: 0 });

    expect(allBatchRows(run.stdout).length).toBeGreaterThan(1);
    expect(run.stdout).toContain("TOTAL:");
  });

  it("exits 1 when a batch runner exits non-zero with zero failed and zero cancelled", () => {
    // The reproduction the whole slice exists for: every test the runner collected
    // passed, so the totals are clean, and only the runner's own exit says anything
    // is wrong.
    const run = runGate({ tests: 1, pass: 1, fail: 0, cancel: 0, exit: 3 });

    expect({
      exitCode: run.exitCode,
      cleanTotals: /TOTAL: \d+ tests, \d+ pass, 0 fail, 0 cancel/.test(run.stdout),
      namesTheBatches: run.stdout.includes("FAILED batches:"),
      saysWhy: /ERROR: every test that ran reported passing/.test(run.stdout),
    }).toEqual({ exitCode: 1, cleanTotals: true, namesTheBatches: true, saysWhy: true });
  });

  it("reports every batch it printed as failed, losing none to a subshell", () => {
    // The mutation this suite exists to kill: piping ONE `run_batch` call runs the
    // function in a subshell, so that batch still PRINTS `[FAIL]` while its append
    // to `FAILED_BATCHES` is discarded. With sibling batches still appending, the
    // run keeps exiting 1 and the assertion above stays green — the accounting is
    // what notices. Measured: with `| tee -a /dev/null` on one call, the printed
    // set has 7 names and the reported set has 6.
    const run = runGate({ tests: 1, pass: 1, fail: 0, cancel: 0, exit: 3 });

    const printed = printedFailedBatches(run.stdout);
    expect(printed.length).toBeGreaterThan(1);
    expect(reportedFailedBatches(run.stdout)).toEqual(printed);
  });

  it("exits 0 on a healthy run, so the stricter gate raises no false alarm", () => {
    // A gate that cannot stay green is as useless as one that cannot go red.
    const run = runGate({ tests: 1, pass: 1, fail: 0, cancel: 0, exit: 0 });

    expect({
      exitCode: run.exitCode,
      noFailedList: !run.stdout.includes("FAILED batches:"),
      noErrorLine: !run.stdout.includes("ERROR:"),
    }).toEqual({ exitCode: 0, noFailedList: true, noErrorLine: true });
  });

  it("exits 1 on cancelled tests and explains them as cancelled, not as a runner exit", () => {
    // The control for the branch that already shipped: a broken `before` hook gives
    // cancelled subtests with `# fail 0`, and it must keep selecting its own message
    // rather than the new clean-count one.
    const run = runGate({ tests: 2, pass: 0, fail: 0, cancel: 2, exit: 1 });

    expect({
      exitCode: run.exitCode,
      cancelledMessage: /ERROR: \d+ test\(s\) were CANCELLED/.test(run.stdout),
      notTheCleanCountMessage: !run.stdout.includes("every test that ran reported passing"),
    }).toEqual({ exitCode: 1, cancelledMessage: true, notTheCleanCountMessage: true });
  });

  it("exits 1 when a batch collects nothing at all", () => {
    // Zero collected tests with a zero exit used to read as OK. Every batch in the
    // inventory names at least one suite, so nothing collected means a suite stopped
    // being found — a renamed path, an emptied file, a suite-wide skip.
    const run = runGate({ tests: 0, pass: 0, fail: 0, cancel: 0, exit: 0 });

    expect(run.exitCode).toBe(1);
    expect(reportedFailedBatches(run.stdout).length).toBeGreaterThan(1);
  });
});

describe("the runner-gate fixtures still produce the shapes they document", () => {
  it("reports the passing fixture as passing and the broken-hook fixture as cancelled", () => {
    // Executing both in ONE runner invocation is what makes them controls rather
    // than two unread files: the clean fixture contributes the passes, the broken
    // hook contributes the cancellations, and the shared summary shows `# fail 0`
    // for both — the shape a gate reading only failure counts calls green.
    const result = spawnSync(
      process.execPath,
      [
        "--conditions",
        "development",
        "--import",
        "tsx",
        "--test",
        "--test-reporter=tap",
        "--test-reporter-destination=stdout",
        "--test-force-exit",
        "--test-concurrency=1",
        "--test-timeout=30000",
        "tests/fixtures/run-tests-gate/cleanExitNonZero.fixture.ts",
        "tests/fixtures/run-tests-gate/brokenHook.fixture.ts",
      ],
      { cwd: apiRoot, encoding: "utf8", timeout: 60_000 }
    );

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const count = (label: string): number =>
      Number(new RegExp(`^# ${label} (\\d+)$`, "m").exec(output)?.[1] ?? "-1");

    expect({
      pass: count("pass"),
      fail: count("fail"),
      cancelled: count("cancelled"),
      runnerExit: result.status,
    }).toEqual({ pass: 1, fail: 0, cancelled: 2, runnerExit: 1 });
  });
});
