/**
 * @file batteryModes.test.ts
 * @description Pins the modes of `scripts/testing/battery.sh`: the full battery, the static mode
 *   (`--static`) and the listing (`--list`). Every step is declared once in the script with its
 *   kind, `static` or `suite`; the full battery runs every declared step, and the static mode runs
 *   the static ones alone, with the same commands and in the same order, and certifies nothing.
 *
 *   A static run is judged by the full verdict's own rules (`battery-verdict.mjs`): a step that
 *   exits non-zero or a warning line in any static log makes it RED.
 *
 *   The suite runs the script itself and reads its stdout, stderr and exit code, and reads the
 *   script's text only to compare the listing with the declarations. No real gate ever runs: the
 *   listing runs nothing, the refusals exit before the first step, and a static run gets a
 *   `timeout` on its PATH that records each call, may print a line into a step's log, and runs
 *   nothing. That run happens in a scratch repository holding a copy of the real verdict module
 *   and a `battery-state.mjs` that leaves a marker if anything calls it. All state lives under a
 *   temp dir, and no case needs the environment file.
 * @layer infrastructure
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
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

const BATTERY_SCRIPT = path.join(REPO_ROOT, "scripts", "testing", "battery.sh");

const USAGE = "usage: scripts/testing/battery.sh [--static] [--list] [<worktree>]";

/** The steps that need no test environment and run no product test suite, in the script's order. */
const STATIC_STEPS = [
  "install",
  "hooks",
  "audit",
  "holds",
  "patched-deps",
  "engines",
  "lint",
  "format",
  "typecheck",
  "syncpack",
  "dedupe",
  "knip",
  "duplicates",
  "stories-gate",
  "jsdoc",
  "legal",
  "support",
  "deps-ledger",
  "i18n",
  "architecture",
  "floors",
  "record-coverage",
  "ledger",
  "artifact-language",
  "audit-end",
] as const;

/** The steps only the full battery runs, in the script's order. */
const SUITE_STEPS = [
  "stories",
  "scripts",
  "api-common",
  "workers",
  "admin",
  "client",
  "api-1",
  "api-2",
  "tier",
] as const;

const VERDICT_MODULE = path.join(REPO_ROOT, "scripts", "testing", "battery-verdict.mjs");
const STATIC_MODULE = path.join(REPO_ROOT, "scripts", "testing", "battery-static.mjs");

/** The command of the lint step, as the stand-in `timeout` receives it after its own arguments. */
const LINT_COMMAND = "pnpm lint --max-warnings 0";

/**
 * Stands in for `timeout` in a static run: it records the command it was handed and runs nothing.
 * When that command holds STUB_PRINT_ON it prints STUB_PRINT, which lands in the step's log, and
 * when it holds STUB_FAIL_ON it exits 1, so one step can carry a line or fail.
 */
const STUB_TIMEOUT = `#!/bin/sh
printf '%s\\n' "$*" >>"$STUB_CALLS"
if [ -n "\${STUB_PRINT_ON:-}" ]; then
  case "$*" in
    *"$STUB_PRINT_ON"*) printf '%s\\n' "$STUB_PRINT" ;;
  esac
fi
if [ -n "\${STUB_FAIL_ON:-}" ]; then
  case "$*" in
    *"$STUB_FAIL_ON"*) exit 1 ;;
  esac
fi
exit 0
`;

/** Stands in for the verdict writer in the scratch repository: a call leaves a marker where the real one writes. */
const MARKER_STATE_SCRIPT = `import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync(".claude/state/battery", { recursive: true });
writeFileSync(".claude/state/battery/called", "battery-state.mjs was called\\n");
`;

interface Declaration {
  readonly kind: string;
  readonly name: string;
}

interface RunResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface RunOptions {
  readonly cwd?: string;
  readonly script?: string;
  readonly env?: Readonly<Record<string, string>>;
}

let scratchRoot = "";

beforeEach(() => {
  scratchRoot = mkdtempSync(path.join(tmpdir(), "battery-modes-"));
});

afterEach(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
});

/** An environment for a child process: no inherited git or battery variable, and no environment file. */
const childEnv = (overrides: Readonly<Record<string, string>> = {}): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith("GIT_") || key.startsWith("BATTERY_")) continue;
    env[key] = value;
  }
  env["BATTERY_ENV_FILE"] = path.join(scratchRoot, "no-environment-file");
  return { ...env, ...overrides };
};

const runBattery = (args: readonly string[], options: RunOptions = {}): RunResult => {
  const result = spawnSync("bash", [options.script ?? BATTERY_SCRIPT, ...args], {
    cwd: options.cwd ?? REPO_ROOT,
    env: childEnv(options.env),
    encoding: "utf8",
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

const lines = (text: string): string[] => text.split("\n").filter((line) => line !== "");

/**
 * The script's step declarations, read from its text, in order. A declaration inside a
 * `for <var> in <words>; do` loop is expanded once per word, as the loop runs it.
 */
const declaredSteps = (): Declaration[] => {
  const declarations: Declaration[] = [];
  let loopVariable = "";
  let loopWords: readonly string[] = [];
  for (const line of readFileSync(BATTERY_SCRIPT, "utf8").split("\n")) {
    const loop = /^\s*for (\w+) in ([^;]+); do\s*$/.exec(line);
    if (loop?.[1] !== undefined && loop[2] !== undefined) {
      loopVariable = loop[1];
      loopWords = loop[2].trim().split(/\s+/);
      continue;
    }
    if (/^\s*done\s*$/.test(line)) {
      loopVariable = "";
      loopWords = [];
      continue;
    }
    const declaration = /^\s*step\s+(\S+)\s+(?:-C\s+\S+\s+)?(\S+)/.exec(line);
    if (declaration?.[1] === undefined || declaration[2] === undefined) continue;
    const kind = declaration[1];
    const name = declaration[2].replace(/^"|"$/g, "");
    const placeholder = `$${loopVariable}`;
    const names =
      loopVariable !== "" && name.includes(placeholder)
        ? loopWords.map((word) => name.replace(placeholder, word))
        : [name];
    for (const expanded of names) declarations.push({ kind, name: expanded });
  }
  return declarations;
};

const plannedSteps = (): number => {
  const match = /^PLANNED_STEPS=(\d+)$/m.exec(readFileSync(BATTERY_SCRIPT, "utf8"));
  if (match?.[1] === undefined) throw new Error("battery.sh declares no PLANNED_STEPS");
  return Number(match[1]);
};

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync("git", [...args], { cwd, env: childEnv(), encoding: "utf8" }).trim();

/**
 * A committed scratch repository holding the real verdict and static-result modules, which a
 * static run reads its logs with, and a marker in place of the verdict writer.
 */
const createRepository = (): string => {
  const repo = path.join(scratchRoot, "repo");
  mkdirSync(path.join(repo, "scripts", "testing"), { recursive: true });
  writeFileSync(path.join(repo, "scripts", "testing", "battery-state.mjs"), MARKER_STATE_SCRIPT);
  copyFileSync(VERDICT_MODULE, path.join(repo, "scripts", "testing", "battery-verdict.mjs"));
  copyFileSync(STATIC_MODULE, path.join(repo, "scripts", "testing", "battery-static.mjs"));
  git(repo, ["init", "--quiet"]);
  git(repo, ["add", "."]);
  git(repo, [
    "-c",
    "user.name=battery",
    "-c",
    "user.email=battery@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "--no-verify",
    "-m",
    "fixture",
  ]);
  return repo;
};

const makeDirty = (repo: string): void => {
  writeFileSync(path.join(repo, "untracked.txt"), "not committed\n");
};

/** Runs `--static` on the repository with the recording `timeout` first on PATH. */
const runStatic = (repo: string, env: Readonly<Record<string, string>> = {}): RunResult => {
  const bin = path.join(scratchRoot, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, "timeout"), STUB_TIMEOUT, { mode: 0o755 });
  return runBattery(["--static", repo], {
    cwd: repo,
    env: {
      PATH: `${bin}:${process.env["PATH"] ?? ""}`,
      STUB_CALLS: path.join(scratchRoot, "timeout-calls.txt"),
      ...env,
    },
  });
};

const lastLine = (text: string): string => lines(text).at(-1) ?? "";

describe("battery.sh --list", () => {
  it("prints the names of the script's step declarations, in order, when --list is given alone", () => {
    const result = runBattery(["--list"]);

    expect(result.status).toBe(0);
    expect(lines(result.stdout)).toEqual(declaredSteps().map((step) => step.name));
  });

  it("prints as many names as PLANNED_STEPS, which is 34, when --list is given alone", () => {
    const result = runBattery(["--list"]);

    expect(lines(result.stdout)).toHaveLength(plannedSteps());
    expect(plannedSteps()).toBe(34);
  });

  it("prints the static steps in the script's order when --static --list is given", () => {
    const result = runBattery(["--static", "--list"]);
    const declaredStatic = declaredSteps()
      .filter((step) => step.kind === "static")
      .map((step) => step.name);

    expect(result.status).toBe(0);
    expect(lines(result.stdout)).toEqual([...STATIC_STEPS]);
    expect(declaredStatic).toEqual([...STATIC_STEPS]);
  });

  it("returns listings that differ by exactly the nine suite steps when both modes are listed", () => {
    const full = lines(runBattery(["--list"]).stdout);
    const staticOnly = lines(runBattery(["--static", "--list"]).stdout);

    expect(full.filter((name) => !staticOnly.includes(name))).toEqual([...SUITE_STEPS]);
    expect(full.filter((name) => staticOnly.includes(name))).toEqual(staticOnly);
  });

  it("prints the listing with exit 0 when the tree is dirty and no environment file exists", () => {
    const repo = createRepository();
    makeDirty(repo);

    const result = runBattery(["--list", repo], { cwd: repo });

    expect(result.status).toBe(0);
    expect(lines(result.stdout)).toEqual(declaredSteps().map((step) => step.name));
  });

  it("returns exit 2 naming the missing kind when a step declaration names no kind", () => {
    const text = readFileSync(BATTERY_SCRIPT, "utf8");
    const broken = text.replace("step static lint pnpm lint", "step lint pnpm lint");
    if (broken === text) {
      throw new Error("battery.sh no longer declares `step static lint pnpm lint`");
    }
    const copy = path.join(scratchRoot, "battery.sh");
    writeFileSync(copy, broken);

    const result = runBattery(["--list"], { script: copy });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("each step declares 'static' or 'suite'");
  });
});

describe("battery.sh arguments", () => {
  it("returns exit 2 and the usage naming both flags when a flag is unknown", () => {
    const result = runBattery(["--bogus"]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(lastLine(result.stderr)).toBe(USAGE);
  });

  it("returns exit 2 and the usage when two worktrees are given", () => {
    const result = runBattery(["one", "two"]);

    expect(result.status).toBe(2);
    expect(lastLine(result.stderr)).toBe(USAGE);
  });

  it("returns exit 2 and the usage when a flag is repeated", () => {
    const result = runBattery(["--static", "--static", "--list"]);

    expect(result.status).toBe(2);
    expect(lastLine(result.stderr)).toBe(USAGE);
  });
});

describe("battery.sh full run", () => {
  it("returns exit 2 and the environment refusal when the full battery has no environment file", () => {
    const repo = createRepository();

    const result = runBattery([repo], { cwd: repo });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("battery: environment file not found:");
  });

  it("returns exit 2 and the dirty-tree refusal when the full battery runs on a dirty tree", () => {
    const repo = createRepository();
    makeDirty(repo);
    const envFile = path.join(scratchRoot, "battery-env");
    writeFileSync(envFile, "");

    const result = runBattery([repo], { cwd: repo, env: { BATTERY_ENV_FILE: envFile } });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "battery: the tree is not clean, and a battery certifies a commit:"
    );
  });
});

describe("battery.sh --static run", () => {
  it("prints STATIC GREEN with the step count and exits 0 when every static step exits 0 and no environment file exists", () => {
    const repo = createRepository();

    const result = runStatic(repo);

    expect(result.status).toBe(0);
    expect(lastLine(result.stdout)).toBe(
      `STATIC GREEN: all ${STATIC_STEPS.length} static steps exited 0 and no log holds a warning line; a static run certifies nothing`
    );
    expect(lines(readFileSync(path.join(scratchRoot, "timeout-calls.txt"), "utf8"))).toHaveLength(
      STATIC_STEPS.length
    );
  });

  it("prints STATIC RED naming the failing step and exits 1 when one static step fails", () => {
    const repo = createRepository();

    const result = runStatic(repo, { STUB_FAIL_ON: "pnpm check:duplicates" });

    expect(result.status).toBe(1);
    expect(lastLine(result.stdout)).toBe(
      `STATIC RED: 1 of ${STATIC_STEPS.length} static steps failed: duplicates; a static run certifies nothing`
    );
  });

  it("prints STATIC RED naming the log and exits 1 when every step exits 0 but lint.log holds a warning line", () => {
    const repo = createRepository();

    const result = runStatic(repo, {
      STUB_PRINT_ON: LINT_COMMAND,
      STUB_PRINT: "src/a.ts: 1 warning",
    });

    expect(result.status).toBe(1);
    expect(lines(result.stdout)).toContain("  lint.log:1:src/a.ts: 1 warning");
    expect(lastLine(result.stdout)).toBe(
      "STATIC RED: 1 warning line(s) in lint.log; a static run certifies nothing"
    );
  });

  it("prints STATIC GREEN when a static log holds only a path and a flag the verdict does not count as warnings", () => {
    const repo = createRepository();

    const result = runStatic(repo, {
      STUB_PRINT_ON: LINT_COMMAND,
      STUB_PRINT: "src/warnings/index.ts\neslint --max-warnings 0",
    });

    expect(result.status).toBe(0);
    expect(lastLine(result.stdout)).toBe(
      `STATIC GREEN: all ${STATIC_STEPS.length} static steps exited 0 and no log holds a warning line; a static run certifies nothing`
    );
  });

  it("records only the static steps in its own log directory and writes no verdict when --static runs", () => {
    const repo = createRepository();
    const sha = git(repo, ["rev-parse", "HEAD"]);

    runStatic(repo);

    const stateDir = path.join(repo, ".claude", "state");
    const stepsFile = path.join(stateDir, "battery-static-logs", sha, "steps.tsv");
    const recorded = lines(readFileSync(stepsFile, "utf8")).map((row) => row.split("\t")[0]);
    expect(readdirSync(stateDir)).toEqual(["battery-static-logs"]);
    expect(recorded).toEqual([...STATIC_STEPS]);
  });

  it("leaves a full run's log directory untouched when --static runs with BATTERY_OUT naming it", () => {
    const repo = createRepository();
    const fullRunLogs = path.join(scratchRoot, "full-run-logs");
    mkdirSync(fullRunLogs);
    writeFileSync(path.join(fullRunLogs, "steps.tsv"), "install\t0\n");
    writeFileSync(path.join(fullRunLogs, "install.log"), "full run\n");

    runStatic(repo, { BATTERY_OUT: fullRunLogs });

    expect(readdirSync(fullRunLogs).sort()).toEqual(["install.log", "steps.tsv"]);
    expect(readFileSync(path.join(fullRunLogs, "steps.tsv"), "utf8")).toBe("install\t0\n");
    expect(readFileSync(path.join(fullRunLogs, "install.log"), "utf8")).toBe("full run\n");
  });

  it("prints the dirty-tree notice and still runs when --static runs on a dirty tree", () => {
    const repo = createRepository();
    makeDirty(repo);

    const result = runStatic(repo);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      "battery: static run on a tree with 1 changed path(s); jsdoc, record-coverage and floors read commits and see only what is committed"
    );
    expect(lastLine(result.stdout)).toMatch(/^STATIC GREEN: /);
  });
});
