/**
 * @file pseudoTerminalRunner.integration.test.ts
 * @description The pseudo-terminal runner, `@packages/vitest-shared/pseudo-terminal`, which the
 *              first-administrator command's suite and the administration portal's browser journey
 *              run the command through. Each case runs a real util-linux `script` over a one-line
 *              shell command, so the suite lives in this tier, which may depend on what the machine
 *              has installed: the command's three standard streams are a terminal, its exit code
 *              and what it wrote come back, a signal that ends it comes back as 128 plus the
 *              signal's number, it runs in the directory and with only the environment it is
 *              given, the time limit ends it, and a `script` that cannot be started comes back as a
 *              run with no exit code. It needs no database and no Redis, and reads no environment
 *              variable.
 * @layer infrastructure
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { until } from "@packages/vitest-shared/determinism";
import { runInPseudoTerminal } from "@packages/vitest-shared/pseudo-terminal";

/** The directory each command runs in, the suite's own, resolved as the shell reports it. */
const DIRECTORY = realpathSync(fileURLToPath(new URL(".", import.meta.url)));

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
      cwd: DIRECTORY,
      env: {},
      timeoutMs: LIMIT_MS,
    });

    assert.deepEqual(run, { code: 0, killed: false, stdout: "terminal", stderr: "" });
  });

  it("returns the command's exit code and what it wrote, its lines ending CR LF", async () => {
    const run = await runInPseudoTerminal({
      command: "printf 'refused\\n'; exit 3",
      cwd: DIRECTORY,
      env: {},
      timeoutMs: LIMIT_MS,
    });

    assert.deepEqual(run, { code: 3, killed: false, stdout: "refused\r\n", stderr: "" });
  });

  it("returns 128 plus the signal's number when a signal ends the command", async () => {
    const run = await runInPseudoTerminal({
      command: "kill -KILL $$",
      cwd: DIRECTORY,
      env: {},
      timeoutMs: LIMIT_MS,
    });

    assert.deepEqual(run, { code: 128 + 9, killed: false, stdout: "", stderr: "" });
  });

  it("runs the command in the given directory with only the given environment", async () => {
    const run = await runInPseudoTerminal({
      command: `printf '%s|%s|%s' "$PWD" "$ONLY_VARIABLE" "\${HOME-absent}"`,
      cwd: DIRECTORY,
      env: { ONLY_VARIABLE: "value" },
      timeoutMs: LIMIT_MS,
    });

    assert.deepEqual(run, {
      code: 0,
      killed: false,
      stdout: `${DIRECTORY}|value|absent`,
      stderr: "",
    });
  });

  it("ends a command that outlives its limit and returns no exit code, killed", async () => {
    // Five seconds outlast the limit many times over and end well inside the runner's 30 s per
    // test, so a runner that ignored its limit fails this case instead of having it cancelled.
    const run = await runInPseudoTerminal({
      command: `printf '%s\\n' "$$"; exec sleep 5`,
      cwd: DIRECTORY,
      env: {},
      timeoutMs: 200,
    });

    assert.deepEqual(
      { ...run, stdout: run.stdout.replace(/^\d+\r\n$/, "<pid>") },
      { code: -1, killed: true, stdout: "<pid>", stderr: "" }
    );
    // `script` exits first; the terminal it closes then ends the command.
    const command = Number(run.stdout.trim());
    await until(() => !isRunning(command), {
      description: `the command ${String(command)} to end`,
    });
  });

  it("returns no exit code and nothing written when script cannot be started", async () => {
    const run = await runInPseudoTerminal({
      command: "true",
      cwd: DIRECTORY,
      env: { PATH: "/a-directory-that-does-not-exist" },
      timeoutMs: LIMIT_MS,
    });

    assert.deepEqual(run, { code: -1, killed: false, stdout: "", stderr: "" });
  });
});
