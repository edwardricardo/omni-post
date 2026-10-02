/**
 * @file batteryState.test.ts
 * @description Pins `scripts/testing/battery-state.mjs`, the CLI that records the local battery's
 *   verdict where a hook can read it: `<state dir>/battery/<sha>.json`, read before a push is
 *   proposed. The rules of the verdict are pinned in `batteryVerdict.test.ts`; this suite drives the
 *   CLI as a child process for what only it decides: the exit code, the usage errors and the state
 *   file, which must exist whatever the status and carry the documented shape.
 *
 *   Its fixture is deliberately smaller than the verdict suite's: one clean log directory and one
 *   with a single toolchain line are all a CLI decision needs, and the rules that tell them apart
 *   are not this suite's subject.
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
