/**
 * @file pseudoTerminal.test.ts
 * @description Tests of `runInPseudoTerminal`, `@packages/vitest-shared/pseudo-terminal`, each
 *              running a real `script` over a one-line shell command: the command's three
 *              standard streams are a terminal, its exit code and what it wrote come back, it runs
 *              in the directory and with only the environment it is given, the time limit ends it,
 *              and a `script` that cannot be started comes back as a run with no exit code.
 * @layer infrastructure
 */

import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { until } from "../src/determinism/index.js";
import { runInPseudoTerminal } from "../src/pseudoTerminal.js";

/** A limit no command of the cases below comes near, except the one that outlives it. */
const LIMIT_MS = 10_000;

/** Whether a process with this pid exists: signal 0 checks for it and delivers nothing. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("runInPseudoTerminal", () => {
  it("gives the command a terminal as its standard input, output and error", async () => {
    const run = await runInPseudoTerminal({
      command: "[ -t 0 ] && [ -t 1 ] && [ -t 2 ] && printf terminal",
      cwd: tmpdir(),
      env: {},
      timeoutMs: LIMIT_MS,
    });

    expect(run).toEqual({ code: 0, killed: false, stdout: "terminal", stderr: "" });
  });

  it("returns the command's exit code and what it wrote, its lines ending CR LF", async () => {
    const run = await runInPseudoTerminal({
      command: "printf 'refused\\n'; exit 3",
      cwd: tmpdir(),
      env: {},
      timeoutMs: LIMIT_MS,
    });

    expect(run).toEqual({ code: 3, killed: false, stdout: "refused\r\n", stderr: "" });
  });

  it("runs the command in the given directory with only the given environment", async () => {
    const directory = realpathSync(tmpdir());

    const run = await runInPseudoTerminal({
      command: `printf '%s|%s|%s' "$PWD" "$ONLY_VARIABLE" "\${HOME-absent}"`,
      cwd: directory,
      env: { ONLY_VARIABLE: "value" },
      timeoutMs: LIMIT_MS,
    });

    expect(run).toEqual({
      code: 0,
      killed: false,
      stdout: `${directory}|value|absent`,
      stderr: "",
    });
  });

  it("ends a command that outlives its limit and returns no exit code, killed", async () => {
    const run = await runInPseudoTerminal({
      command: `printf '%s\\n' "$$"; exec sleep 30`,
      cwd: tmpdir(),
      env: {},
      timeoutMs: 200,
    });

    expect({ ...run, stdout: run.stdout.replace(/^\d+\r\n$/, "<pid>") }).toEqual({
      code: -1,
      killed: true,
      stdout: "<pid>",
      stderr: "",
    });
    // `script` exits first; the terminal it closes then ends the command.
    const command = Number(run.stdout.trim());
    await until(() => !isRunning(command), {
      description: `the command ${String(command)} to end`,
    });
  });

  it("returns no exit code and nothing written when script cannot be started", async () => {
    const run = await runInPseudoTerminal({
      command: "true",
      cwd: tmpdir(),
      env: { PATH: "/a-directory-that-does-not-exist" },
      timeoutMs: LIMIT_MS,
    });

    expect(run).toEqual({ code: -1, killed: false, stdout: "", stderr: "" });
  });
});
