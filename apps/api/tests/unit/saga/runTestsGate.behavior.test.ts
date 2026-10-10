/**
 * @file runTestsGate.behavior.test.ts
 * @description Executable proof that `apps/api/scripts/run-tests.sh` exits non-zero
 *              whenever a batch is recorded failed, gives every listed file its own
 *              verdict, keeps a quarantined file out of the run while printing it,
 *              lists its inventory without running anything, and refuses to start at
 *              all without a test database or with a quarantine it cannot trust. Its sibling
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
 *              every file's invocation is a few lines of `printf` and a chosen exit
 *              code: the whole script finishes in about half a second and the
 *              scenarios are exactly reproducible on any machine, with no database,
 *              no Redis and no recursion back into this runner. The stub is written
 *              here rather than committed as a script so the reproduction cannot
 *              drift away from the assertions that depend on it. The per-file reds
 *              are proven end to end, on a real node:test run of a fixture written
 *              into a scratch copy of the path layout.
 * @layer infrastructure
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  rmSync,
  existsSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(currentDir, "..", "..", "..");
const runnerPath = join(apiRoot, "scripts", "run-tests.sh");

/**
 * `pr-integration` runs the node:test batches without the live-API ones, so no
 * scenario waits on `wait_for_api`'s curl loop. It is also the tier CI runs on
 * pull requests.
 */
const TIER = "pr-integration";

/**
 * Satisfies the runner's refusal to start without a test database. Nothing connects
 * — the stand-in never opens a socket — and the URL names a closed port, so no
 * future edit can reach a live database from a unit test through the inherited one.
 */
const UNUSED_DATABASE_URL = "postgresql://gate-behavior@127.0.0.1:1/none";

/**
 * Every program a refused run could start in place of a suite: the node:test
 * runner, `npx` (the way a vitest start would be spelled) and `curl` (the live-API
 * probes). The refusal scenarios put a recorder for each first on `PATH`.
 */
const RECORDED_PROGRAMS = ["node", "npx", "curl"] as const;

/** The file the per-file scenarios single out, in a batch that lists siblings too. */
const TARGET_FILE = "tests/integration/repositories/UserRepository.integration.test.ts";
const TARGET_BATCH = "integration:repositories";
/** A path the hand-listed live-API batches name. */
const LIVE_TARGET = "tests/integration/crisisRoutes.live.test.ts";

/** The TAP summary a stub run reports, plus the exit code it ends on. */
interface StubShape {
  tests: number;
  pass: number;
  fail: number;
  cancel: number;
  /** Defaults to 0 so every pre-existing scenario keeps its exact shape. */
  skip?: number;
  exit: number;
}

/** A healthy file: what every listed path reports in the per-file scenarios. */
const PASSING: StubShape = { tests: 1, pass: 1, fail: 0, cancel: 0, exit: 0 };

/** What a scenario may change about a run besides the shape. */
interface GateOptions {
  /** Receives, for each call, how many suite paths the stub was handed and the last one. */
  callLog?: string;
  cwd?: string;
  /** A listed path the stub hands to the real node:test runner instead. */
  realTarget?: string;
  /** The quarantine the run reads; defaults to the committed one. */
  quarantineFile?: string;
}

interface RunResult {
  exitCode: number;
  stdout: string;
}

/** A run whose streams are read apart, plus every recorded program it started. */
interface RefusedRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  started: string[];
}

/** One quarantine entry, in the shape the runner and the reach engine share. */
interface QuarantineFixture {
  path: string;
  reason: string;
  owner: string;
  since?: string;
}

let stubDir: string;
let emptyQuarantine: string;

/** Writes a quarantine file holding `entries` into the stub directory. */
function writeQuarantine(name: string, entries: QuarantineFixture[]): string {
  const path = join(stubDir, name);
  writeFileSync(path, JSON.stringify({ entries }), "utf8");
  return path;
}

/**
 * Writes the stand-in runner. Each suite path the runner is
 * handed reports the scenario's shape, printed as the five summary lines `run_file`
 * greps for, and the call ends on the exit code the scenario is about. A call whose
 * last argument is `GATE_REAL_TARGET` goes to the real runner instead.
 */
beforeAll(() => {
  stubDir = mkdtempSync(join(tmpdir(), "run-tests-gate-"));
  mkdirSync(stubDir, { recursive: true });
  const stubPath = join(stubDir, "node");
  writeFileSync(
    stubPath,
    [
      "#!/usr/bin/env bash",
      'if [ -n "${GATE_REAL_TARGET:-}" ] && [ "${!#}" = "$GATE_REAL_TARGET" ]; then',
      '  exec "$GATE_REAL_NODE" "$@"',
      "fi",
      "files=0",
      'for arg in "$@"; do case "$arg" in *.ts) files=$((files + 1)) ;; esac; done',
      'if [ -n "${GATE_CALL_LOG:-}" ]; then echo "$files ${!#}" >> "$GATE_CALL_LOG"; fi',
      "printf '# tests %s\\n# suites 1\\n# pass %s\\n# fail %s\\n# cancelled %s\\n# skipped %s\\n# todo 0\\n' \\",
      '  "$((files * GATE_STUB_TESTS))" "$((files * GATE_STUB_PASS))" "$((files * GATE_STUB_FAIL))" \\',
      '  "$((files * GATE_STUB_CANCEL))" "$((files * GATE_STUB_SKIP))"',
      'exit "$GATE_STUB_EXIT"',
      "",
    ].join("\n"),
    "utf8"
  );
  chmodSync(stubPath, 0o755);
  emptyQuarantine = writeQuarantine("empty-quarantine.json", []);
});

afterAll(() => {
  rmSync(stubDir, { recursive: true, force: true });
});

/** Runs the real script with every listed path served by the stub. */
function runGate(shape: StubShape, options: GateOptions = {}): RunResult {
  const { callLog, realTarget, quarantineFile } = options;
  const result = spawnSync("bash", [runnerPath], {
    cwd: options.cwd ?? apiRoot,
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
      GATE_STUB_SKIP: String(shape.skip ?? 0),
      GATE_STUB_EXIT: String(shape.exit),
      ...(callLog !== undefined && { GATE_CALL_LOG: callLog }),
      ...(quarantineFile !== undefined && { QUARANTINE_FILE: quarantineFile }),
      ...(realTarget !== undefined && {
        GATE_REAL_TARGET: realTarget,
        GATE_REAL_NODE: process.execPath,
      }),
    },
  });

  return { exitCode: result.status ?? -1, stdout: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** The suite paths the stub was handed, one per call, in call order. */
function calledPaths(callLog: string): string[] {
  return readFileSync(callLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(line.indexOf(" ") + 1));
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

/** Paths the run printed a passing verdict line for. */
function passedFiles(stdout: string): string[] {
  return [...stdout.matchAll(/^ {4}✓ (\S+) \(\d+ tests\)$/gm)].map((match) => match[1] ?? "");
}

/**
 * The run's exit, its failed batches, and each `<path>: <reasons>` it printed on a
 * failing verdict line and listed again under `FAILED files:`.
 */
function fileVerdict(run: RunResult) {
  const listed = /^FAILED files:\n((?: {2}\S.*(?:\n|$))*)/m.exec(run.stdout)?.[1] ?? "";
  return {
    exitCode: run.exitCode,
    failedBatches: reportedFailedBatches(run.stdout),
    printed: [...run.stdout.matchAll(/^ {4}✗ (.+)$/gm)].map((match) => match[1] ?? ""),
    listed: listed.trim().split(/\n\s*/).filter(Boolean),
  };
}

/** `fileVerdict` of a run in which `TARGET_FILE` alone fails, for `reasons`. */
function targetAloneFails(reasons: string): ReturnType<typeof fileVerdict> {
  const entry = `${TARGET_FILE}: ${reasons}`;
  return { exitCode: 1, failedBatches: [TARGET_BATCH], printed: [entry], listed: [entry] };
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
    // set has 12 names and the reported set has 11.
    const run = runGate({ tests: 1, pass: 1, fail: 0, cancel: 0, exit: 3 });

    const printed = printedFailedBatches(run.stdout);
    expect(printed.length).toBeGreaterThan(1);
    expect(reportedFailedBatches(run.stdout)).toEqual(printed);
  });

  it("exits 0 on a healthy run, so the stricter gate raises no false alarm", () => {
    // A gate that cannot stay green is as useless as one that cannot go red. It is
    // also what kills a subshell around ONE `run_file` call: the verdict `run_batch`
    // resets before the call never arrives, so every file fails (measured: exit 1).
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

  it("exits 1 when a batch reports a skipped test in a tier-driven run", () => {
    // The reproduction that was LIVE on the trunk: a batch prints
    // `… 0 fail  0 cancel  3 skip  exit 0  [OK]`, the totals print the same three
    // skips, and the run exits 0. Three service-dependent tests were reported
    // green without executing. A tier run provides the services its batches name;
    // a test that skipped for want of one is a service the tier did not provide,
    // which is a tier failure, not a test's own business.
    const run = runGate({ tests: 3, pass: 2, fail: 0, cancel: 0, skip: 1, exit: 0 });

    expect({
      exitCode: run.exitCode,
      cleanFailureCounts: /TOTAL: \d+ tests, \d+ pass, 0 fail, 0 cancel/.test(run.stdout),
      namesTheBatches: reportedFailedBatches(run.stdout).length > 1,
      saysWhy: /ERROR: \d+ test\(s\) were SKIPPED/.test(run.stdout),
    }).toEqual({
      exitCode: 1,
      cleanFailureCounts: true,
      namesTheBatches: true,
      saysWhy: true,
    });
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

describe("run-tests.sh gives every listed file its own verdict", () => {
  it("hands node one listed path per call and prints one verdict line per call", () => {
    // Handed a whole batch at once, node reads back one summary, and no guard can
    // say which file it is about.
    const callLog = join(stubDir, "calls.log");
    rmSync(callLog, { force: true });
    const run = runGate(PASSING, { callLog });
    const pathsPerCall = readFileSync(callLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => Number(line.split(" ")[0]));

    expect(pathsPerCall.length).toBeGreaterThan(1);
    expect({
      exitCode: run.exitCode,
      onePathEach: pathsPerCall.every((paths) => paths === 1),
    }).toEqual({ exitCode: 0, onePathEach: true });
    expect(passedFiles(run.stdout)).toHaveLength(pathsPerCall.length);
    expect(passedFiles(run.stdout)).toContain(TARGET_FILE);
  });

  it("prints a quarantined file with its reason and does not run it", () => {
    // A quarantined suite runs nowhere; the line it prints on every run is what
    // keeps it from being forgotten there.
    const reason = "fixture: kept out of the run on purpose";
    const quarantineFile = writeQuarantine("one-entry.json", [
      { path: `apps/api/${TARGET_FILE}`, reason, owner: "runner gate", since: "2026-10-10" },
    ]);
    const callLog = join(stubDir, "quarantine-calls.log");
    rmSync(callLog, { force: true });
    const run = runGate(PASSING, { callLog, quarantineFile });
    const called = calledPaths(callLog);

    expect(called.length).toBeGreaterThan(1);
    expect({
      exitCode: run.exitCode,
      printed: run.stdout.includes(`  QUARANTINED (not run): ${TARGET_FILE} — ${reason}\n`),
      handedToNode: called.includes(TARGET_FILE),
      verdictLine: passedFiles(run.stdout).includes(TARGET_FILE),
    }).toEqual({ exitCode: 0, printed: true, handedToNode: false, verdictLine: false });
  });
});

describe("a real node:test file gets the same verdict, end to end", () => {
  /**
   * Runs the real script from a scratch directory holding `TARGET_FILE` with
   * `source` as its content (no file when null) and a link to the API's
   * `node_modules`, so `--import tsx` resolves. The stub hands that one path to
   * the real node:test runner, so no suite under `tests/` runs. The quarantine is
   * an empty one, so the scratch tree is all the run reads.
   */
  function runRealTarget(source: string | null): RunResult {
    const root = mkdtempSync(join(tmpdir(), "run-tests-real-"));
    const modulesLink = join(root, "node_modules");
    try {
      symlinkSync(join(apiRoot, "node_modules"), modulesLink, "dir");
      if (source !== null) {
        mkdirSync(dirname(join(root, TARGET_FILE)), { recursive: true });
        writeFileSync(join(root, TARGET_FILE), source, "utf8");
      }
      return runGate(PASSING, {
        cwd: root,
        realTarget: TARGET_FILE,
        quarantineFile: emptyQuarantine,
      });
    } finally {
      // The link leaves first, alone, so the recursive removal cannot follow it.
      rmSync(modulesLink, { force: true });
      rmSync(root, { recursive: true, force: true });
    }
  }

  it("passes a file whose real test passes, so the harness raises no red of its own", () => {
    const run = runRealTarget('import { it } from "node:test";\nit("passes", () => {});\n');

    expect({ exitCode: run.exitCode, passed: passedFiles(run.stdout) }).toEqual({
      exitCode: 0,
      passed: expect.arrayContaining([TARGET_FILE]),
    });
  });

  it("exits 1 naming an empty file, which node:test counts as one passing test", () => {
    // Its siblings in the batch pass: a batch-wide count stayed above zero and hid
    // it, and node:test counts a file that registers nothing as one passing test.
    const run = runRealTarget("export {};\n");

    expect(fileVerdict(run)).toEqual(targetAloneFails("zero tests"));
  });

  it("exits 1 naming a file whose before hook throws", () => {
    const fixture = join(apiRoot, "tests", "fixtures", "run-tests-gate", "brokenHook.fixture.ts");
    const run = runRealTarget(readFileSync(fixture, "utf8"));

    expect(fileVerdict(run)).toEqual(targetAloneFails("2 cancelled, exit 1"));
  });

  it("exits 1 naming a file whose test calls t.skip() in a tier-driven run", () => {
    const run = runRealTarget(
      'import { it } from "node:test";\nit("needs a service", (t) => { t.skip("absent"); });\n'
    );

    expect(fileVerdict(run)).toEqual(targetAloneFails("1 skipped under TIER"));
  });

  it("exits 1 naming a listed path that does not exist", () => {
    // Beside paths that exist, node:test drops a missing one and exits 0, so a
    // renamed suite stopped running unnoticed (SMELL-74). Alone it exits non-zero.
    const run = runRealTarget(null);

    expect(fileVerdict(run)).toEqual(targetAloneFails("zero tests, exit 1"));
  });
});

describe("run-tests.sh refuses what it cannot trust, and lists without a database", () => {
  let recorderDir: string;
  let recordPath: string;

  /**
   * Writes one recorder per program: it appends its own name to `GATE_RECORD` and
   * exits 97, so a refused run that started anything is caught by name, and a run
   * that went on would fail rather than reach a database, the network or vitest.
   */
  beforeAll(() => {
    recorderDir = mkdtempSync(join(tmpdir(), "run-tests-refusal-"));
    recordPath = join(recorderDir, "started.log");
    for (const program of RECORDED_PROGRAMS) {
      const programPath = join(recorderDir, program);
      writeFileSync(
        programPath,
        ["#!/usr/bin/env bash", `echo ${program} >> "$GATE_RECORD"`, "exit 97", ""].join("\n"),
        "utf8"
      );
      chmodSync(programPath, 0o755);
    }
  });

  afterAll(() => {
    rmSync(recorderDir, { recursive: true, force: true });
  });

  /**
   * Runs the real script with the recorders first on `PATH`. `DATABASE_URL`, `TIER`
   * and `QUARANTINE_FILE` are removed from the inherited environment first — the
   * vitest process holds the test database's URL — so each scenario states its own.
   */
  function runRecorded(overrides: NodeJS.ProcessEnv, args: string[] = []): RefusedRun {
    rmSync(recordPath, { force: true });
    const {
      DATABASE_URL: _inheritedDatabaseUrl,
      TIER: _inheritedTier,
      QUARANTINE_FILE: _inheritedQuarantine,
      ...inherited
    } = process.env;
    const result = spawnSync("bash", [runnerPath, ...args], {
      cwd: apiRoot,
      encoding: "utf8",
      timeout: 60_000,
      env: {
        ...inherited,
        PATH: `${recorderDir}:${process.env.PATH ?? ""}`,
        GATE_RECORD: recordPath,
        ...overrides,
      },
    });
    const started = existsSync(recordPath)
      ? readFileSync(recordPath, "utf8").split("\n").filter(Boolean)
      : [];

    return {
      exitCode: result.status ?? -1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      started,
    };
  }

  it("exits 2 under a TIER when DATABASE_URL is empty, before any suite starts", () => {
    // The reproduction: with no test database exported, the run reached the
    // development database instead. `full-integration` is the widest tier — it
    // also probes the live API — so a refusal that holds there holds everywhere.
    const run = runRecorded({ TIER: "full-integration", DATABASE_URL: "" });

    expect({
      exitCode: run.exitCode,
      started: run.started,
      stdout: run.stdout,
      namesTheVariable: run.stderr.includes("DATABASE_URL"),
      namesTheTestEnvironment: run.stderr.includes(".env.test"),
    }).toEqual({
      exitCode: 2,
      started: [],
      stdout: "",
      namesTheVariable: true,
      namesTheTestEnvironment: true,
    });
  });

  it("exits 2 with TIER unset when DATABASE_URL is not set at all", () => {
    // The local default path, `pnpm --filter @apps/api test:integration` from a
    // shell that exported nothing: no tier, no variable. Nothing legitimate runs
    // the suites against whatever database a file at the repository root names.
    const run = runRecorded({});

    expect({
      exitCode: run.exitCode,
      started: run.started,
      stdout: run.stdout,
      namesTheVariable: run.stderr.includes("DATABASE_URL"),
    }).toEqual({ exitCode: 2, started: [], stdout: "", namesTheVariable: true });
  });

  it("exits 2 before any suite starts on a quarantine entry without a field", () => {
    // A quarantine decides what does NOT run, so one that cannot be read whole
    // must stop the run instead of being applied in part.
    const quarantineFile = writeQuarantine("no-since.json", [
      { path: `apps/api/${TARGET_FILE}`, reason: "fixture", owner: "runner gate" },
    ]);
    const run = runRecorded({
      TIER,
      DATABASE_URL: UNUSED_DATABASE_URL,
      QUARANTINE_FILE: quarantineFile,
    });

    expect({
      exitCode: run.exitCode,
      started: run.started,
      namesTheQuarantine: run.stderr.includes(quarantineFile),
    }).toEqual({ exitCode: 2, started: [], namesTheQuarantine: true });
  });

  it("exits 2 on an argument it does not know, rather than ignoring it", () => {
    const run = runRecorded({ TIER, DATABASE_URL: UNUSED_DATABASE_URL }, [TARGET_FILE]);

    expect({ exitCode: run.exitCode, started: run.started }).toEqual({ exitCode: 2, started: [] });
  });

  it("lists every file it owns once, with its kind, and runs nothing, without a database", () => {
    // `--list` is what fitness #30 and the reach engine read; it touches no
    // database, so it needs none, and it must start no suite and no probe.
    const run = runRecorded({}, ["--list"]);
    const lines = run.stdout.split("\n").filter(Boolean);
    const kindOf = new Map<string, string[]>();
    for (const line of lines) {
      const [kind = "", path = ""] = line.split("\t");
      kindOf.set(path, [...(kindOf.get(path) ?? []), kind]);
    }
    const kinds = (path: string): string[] => kindOf.get(path) ?? [];
    const liveSuffixed = [...kindOf.keys()].filter((path) => path.endsWith(".live.test.ts"));

    expect(lines.length).toBeGreaterThan(1);
    expect({
      exitCode: run.exitCode,
      started: run.started,
      wellFormed: lines.every((line) => /^(integration|live|quarantined)\t\S+$/.test(line)),
      eachPathOnce: [...kindOf.values()].every((listed) => listed.length === 1),
      target: kinds(TARGET_FILE),
      liveTarget: kinds(LIVE_TARGET),
      noLiveSuiteInTheServicesTier: liveSuffixed.filter((path) => kinds(path)[0] !== "live"),
    }).toEqual({
      exitCode: 0,
      started: [],
      wellFormed: true,
      eachPathOnce: true,
      target: ["integration"],
      liveTarget: ["live"],
      noLiveSuiteInTheServicesTier: [],
    });
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
