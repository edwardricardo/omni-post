/**
 * @file batteryState.test.ts
 * @description Pins `scripts/testing/battery-state.mjs`, the CLI that records the local battery's
 *   verdict where a hook can read it: `<state dir>/battery/<sha>.json`, read before a push is
 *   proposed. The rules of the verdict are pinned in `batteryVerdict.test.ts`; this suite drives the
 *   CLI as a child process for what only it decides: the exit code, the usage errors, the report it
 *   prints, and the state file, which must exist whatever the status and carry the documented
 *   shape. A state file that cannot be written turns the run RED, and the error reported is the
 *   write's own, not one raised while cleaning up after it.
 *
 *   Its fixtures are deliberately smaller than the verdict suite's: a clean log directory, one with
 *   a single toolchain line, and one built so that every kind of report line appears once. The
 *   rules that tell them apart are not this suite's subject.
 * @layer infrastructure
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const STATE_SCRIPT = path.join(REPO_ROOT, "scripts", "testing", "battery-state.mjs");

const SHA = "0123456789abcdef0123456789abcdef01234567";
const TREE = "89abcdef0123456789abcdef0123456789abcdef";
const STARTED_AT = "2026-10-02T03:00:00.000Z";

/** Log contents by file name; every log is one step, recorded with exit 0. */
const CLEAN_LOGS: Readonly<Record<string, string>> = {
  "install.log": "done\n",
  "lint.log": "done\n",
};

interface StateDocument {
  readonly schema: string;
  readonly sha: string;
  readonly tree: string;
  readonly status: "GREEN" | "RED";
  readonly reasons: readonly string[];
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly steps: readonly { readonly name: string; readonly exit: number }[];
  readonly warnings: readonly {
    readonly log: string;
    readonly line: number;
    readonly text: string;
  }[];
  readonly appWarnRecords: { readonly total: number; readonly messages: readonly object[] };
  readonly apiRuns: readonly object[];
}

interface CliResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

let scratchRoot = "";

beforeEach(() => {
  scratchRoot = mkdtempSync(path.join(tmpdir(), "battery-state-"));
});

afterEach(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
});

/** Writes a log directory holding the given logs, each recorded in `steps.tsv` with exit 0. */
const writeLogDir = (logs: Readonly<Record<string, string>> = CLEAN_LOGS): string => {
  const dir = path.join(scratchRoot, "logs");
  mkdirSync(dir, { recursive: true });
  const rows = Object.keys(logs).map((file) => `${file.replace(/\.log$/, "")}\t0\n`);
  writeFileSync(path.join(dir, "steps.tsv"), rows.join(""));
  for (const [file, content] of Object.entries(logs)) writeFileSync(path.join(dir, file), content);
  return dir;
};

/** The CLI arguments for one run; a `null` override leaves that argument out. */
const cliArguments = (
  outDir: string,
  overrides: Readonly<Record<string, string | null>> = {}
): string[] => {
  const base: Record<string, string | null> = {
    "--out": outDir,
    "--sha": SHA,
    "--tree": TREE,
    "--state-dir": path.join(scratchRoot, "state"),
    "--expected-steps": String(Object.keys(CLEAN_LOGS).length),
    "--started-at": STARTED_AT,
    "--dirty-at-end": "0",
    ...overrides,
  };
  return Object.entries(base).flatMap(([flag, value]) => (value === null ? [] : [flag, value]));
};

const runCli = (args: readonly string[]): CliResult => {
  const result = spawnSync(process.execPath, [STATE_SCRIPT, ...args], { encoding: "utf8" });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

/**
 * Runs the CLI in a Node process that first creates a DIRECTORY at the staging path the CLI will
 * choose, so the write fails and so does removing what is at that path. The staging name carries
 * the CLI's pid, which only its own process knows; the prelude therefore imports the module itself
 * with the module as `argv[1]`, which is exactly how `node <script>` would run it.
 */
const runCliWithStagingDirectory = (args: readonly string[]): CliResult => {
  const prelude = [
    'import { mkdirSync } from "node:fs";',
    'const stateDir = process.argv[process.argv.indexOf("--state-dir") + 1];',
    `mkdirSync(stateDir + "/battery/.${SHA}.json." + process.pid, { recursive: true });`,
    "await import(process.argv[1]);",
  ].join("\n");
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", prelude, "--", STATE_SCRIPT, ...args],
    { encoding: "utf8" }
  );
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

const stateFile = (): string => path.join(scratchRoot, "state", "battery", `${SHA}.json`);

const readState = (): StateDocument =>
  JSON.parse(readFileSync(stateFile(), "utf8")) as StateDocument;

describe("battery-state CLI", () => {
  it("exits 0 and writes the state file with the documented shape when the verdict is GREEN", () => {
    const outDir = writeLogDir();

    const result = runCli(cliArguments(outDir));

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout.trimEnd().split("\n").at(-1)).toBe("BATTERY GREEN");
    const state = readState();
    expect(Object.keys(state)).toEqual([
      "schema",
      "sha",
      "tree",
      "status",
      "reasons",
      "startedAt",
      "finishedAt",
      "steps",
      "warnings",
      "appWarnRecords",
      "apiRuns",
    ]);
    expect(state).toMatchObject({
      schema: "omnipost.battery/v1",
      sha: SHA,
      tree: TREE,
      status: "GREEN",
      reasons: [],
      startedAt: STARTED_AT,
      steps: [
        { name: "install", exit: 0 },
        { name: "lint", exit: 0 },
      ],
      warnings: [],
      appWarnRecords: { total: 0, messages: [] },
      apiRuns: [],
    });
    expect(Number.isNaN(Date.parse(state.finishedAt))).toBe(false);
    expect(readdirSync(path.dirname(stateFile()))).toEqual([`${SHA}.json`]);
  });

  it("exits 1 and still writes the state file when the verdict is RED", () => {
    const outDir = writeLogDir({ ...CLEAN_LOGS, "lint.log": "warning: unused directive\n" });

    const result = runCli(cliArguments(outDir));

    expect(result.status).toBe(1);
    expect(result.stdout.trimEnd().split("\n").at(-1)).toBe("BATTERY RED");
    const state = readState();
    expect(state.status).toBe("RED");
    expect(state.warnings).toEqual([
      { log: "lint.log", line: 1, text: "warning: unused directive" },
    ]);
  });

  it("exits 1 when the tree changed during the battery", () => {
    const outDir = writeLogDir();

    const result = runCli(cliArguments(outDir, { "--dirty-at-end": "1" }));

    expect(result.status).toBe(1);
    expect(readState().reasons).toEqual(["tree changed during the battery"]);
  });

  it("prints the full report: steps, api runs, toolchain lines, application records and reasons", () => {
    const outDir = writeLogDir({
      "install.log": "done\n",
      "lint.log": "> eslint . --max-warnings 0\n(node:7) Warning: a deprecated API\n",
      "api-1.log": '{"level":"warn","msg":"queue paused"}\n{"level":"warn","msg":"queue paused"}\n',
      "api-2.log": "Test Files  2 passed (2)\n",
    });
    writeFileSync(
      path.join(outDir, "api-2.json"),
      JSON.stringify({
        numTotalTests: 3,
        numPassedTests: 3,
        numPendingTests: 0,
        numFailedTests: 0,
        testResults: [{ name: "first.test.ts" }, { name: "second.test.ts" }],
      })
    );

    const result = runCli(cliArguments(outDir, { "--expected-steps": "4" }));

    expect(result.status).toBe(1);
    expect(result.stdout.split("\n")).toEqual([
      "install exit=0",
      "lint exit=0",
      "api-1 exit=0",
      "api-2 exit=0",
      "api-1 files ? tests ? passed ? pending ? failed ? unhandled 0",
      "api-2 files 2 tests 3 passed 3 pending 0 failed 0 unhandled 0",
      "warning lines: 1",
      "  lint.log:2:(node:7) Warning: a deprecated API",
      "app-log warn (code under test, not a toolchain warning): 2 record(s), 1 distinct message(s)",
      "    2 queue paused",
      "RED because 1 warning line(s)",
      "RED because api-1.json is missing or unreadable",
      `state: ${stateFile()}`,
      "BATTERY RED",
      "",
    ]);
  });

  it("exits 1 with BATTERY RED and the reason when the state directory cannot be created", () => {
    const outDir = writeLogDir();
    const blocker = path.join(scratchRoot, "blocker");
    writeFileSync(blocker, "");

    const result = runCli(cliArguments(outDir, { "--state-dir": path.join(blocker, "state") }));

    expect(result.status).toBe(1);
    expect(result.stdout.trimEnd().split("\n").at(-1)).toBe("BATTERY RED");
    expect(result.stdout).not.toContain("BATTERY GREEN");
    expect(result.stderr).toContain("the state file could not be written");
    expect(result.stderr).toContain("ENOTDIR");
    expect(existsSync(stateFile())).toBe(false);
  });

  it("reports the write's own error when the staging path cannot be cleaned up either", () => {
    const outDir = writeLogDir();

    const result = runCliWithStagingDirectory(cliArguments(outDir));

    expect(result.status).toBe(1);
    expect(result.stdout.trimEnd().split("\n").at(-1)).toBe("BATTERY RED");
    expect(result.stderr).toContain("EISDIR: illegal operation on a directory, open");
    expect(result.stderr).toContain("could not be removed either");
    expect(existsSync(stateFile())).toBe(false);
  });

  it("exits 2 naming a missing required argument and writes no state", () => {
    const outDir = writeLogDir();

    const result = runCli(cliArguments(outDir, { "--sha": null }));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("missing required argument --sha");
    expect(existsSync(stateFile())).toBe(false);
  });

  it("exits 2 naming a malformed argument", () => {
    const outDir = writeLogDir();

    const dirty = runCli(cliArguments(outDir, { "--dirty-at-end": "yes" }));
    const sha = runCli(cliArguments(outDir, { "--sha": "../../escape" }));
    const steps = runCli(cliArguments(outDir, { "--expected-steps": "0" }));

    expect(dirty.status).toBe(2);
    expect(dirty.stderr).toContain("--dirty-at-end");
    expect(sha.status).toBe(2);
    expect(sha.stderr).toContain("--sha");
    expect(steps.status).toBe(2);
    expect(steps.stderr).toContain("--expected-steps");
  });

  it("exits 2 naming an argument it does not recognise", () => {
    const outDir = writeLogDir();

    const result = runCli([...cliArguments(outDir), "--allow", "lint.log"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--allow");
  });
});
