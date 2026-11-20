/**
 * @file workersDevScript.test.ts
 * @description Pins how the workers' `dev` script loads the checkout's environment file: named on
 *              Node's command line, as the API's `dev` does, so the file is read before any module
 *              runs. A variable a module reads at import, as the shared logger reads `LOG_LEVEL`,
 *              then sees the file's value, and the workers read the same file the API reads. The
 *              second case runs the script's own words, with this case's file and an entry that
 *              prints the logger's level, so it lives with the suites that start a process.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const WORKERS_DIR = path.join(REPO_ROOT, "apps", "workers");

/** The environment file both `dev` scripts name, relative to the app's directory. */
const ENVIRONMENT_FILE_FLAG = "--env-file=../../.env";

/** An app's `dev` script, as its package declares it. */
function devScript(app: "api" | "workers"): string {
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "apps", app, "package.json"), "utf8")
  ) as { scripts: Record<string, string | undefined> };
  return manifest.scripts["dev"] ?? "";
}

/** A `dev` script without its entry, the last word, so two scripts compare by their flags. */
function flagsOf(script: string): string {
  return script.split(" ").slice(0, -1).join(" ");
}

const scratch: string[] = [];

describe("the workers' dev script", () => {
  beforeEach(() => {
    scratch.splice(0);
  });

  afterEach(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  it("starts as the API's dev does, naming the checkout's environment file, with its own entry", () => {
    const workers = devScript("workers");

    expect({
      flags: flagsOf(workers),
      entry: workers.split(" ").at(-1),
      namesTheFile: workers.split(" ").includes(ENVIRONMENT_FILE_FLAG),
    }).toEqual({
      flags: flagsOf(devScript("api")),
      entry: "src/bootstrap.ts",
      namesTheFile: true,
    });
  });

  it("hands the shared logger a LOG_LEVEL set only in the environment file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "workers-dev-script-"));
    scratch.push(dir);
    const file = path.join(dir, ".env");
    writeFileSync(file, "LOG_LEVEL=debug\n");
    // The script's own words, run from the workers' directory as pnpm runs it: its file is this
    // case's, and its entry imports the logger first, as the workers' entry does, and prints the
    // level the logger took when it was imported.
    const words = devScript("workers")
      .split(" ")
      .slice(0, -1)
      .map((word) => (word.startsWith("--env-file=") ? `--env-file=${file}` : word));
    const entry = [
      "-e",
      'import("@observability/logger").then(({ createLogger }) => ' +
        'process.stdout.write(createLogger("dev-script").level + "\\n"))',
    ];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: [
        path.join(WORKERS_DIR, "node_modules", ".bin"),
        path.join(REPO_ROOT, "node_modules", ".bin"),
        process.env["PATH"] ?? "",
      ].join(path.delimiter),
    };
    delete env["LOG_LEVEL"];

    const [program = "", ...args] = words;
    const run = spawnSync(program, [...args, ...entry], {
      cwd: WORKERS_DIR,
      env,
      encoding: "utf8",
      timeout: 60_000,
    });

    expect({ status: run.status, level: run.stdout.trim().split("\n").at(-1) }).toEqual({
      status: 0,
      level: "debug",
    });
  }, 90_000);
});
