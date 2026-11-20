/**
 * @file pseudoTerminal.ts
 * @description Runs a shell command whose standard streams are a pseudo-terminal, for a test of a
 *              program that writes only to a terminal, such as the first-administrator command,
 *              which refuses to print its single-use password anywhere else. util-linux `script`
 *              opens the terminal: `--command` runs the line through the shell, `--return` ends
 *              `script` with the command's exit code, or 128 plus the number of the signal that
 *              ended the command, `--flush` writes the terminal's output as it comes, and
 *              `/dev/null` keeps the session's transcript out of every file. The test
 *              that runs the program in a terminal and the browser journey that signs in with the
 *              password it printed both run it through this module.
 * @layer infrastructure
 */
import { execFile } from "node:child_process";

/** What to run, where, with which environment and for how long. */
export interface PseudoTerminalOptions {
  /** The command line the shell runs, its words quoted by the caller. */
  readonly command: string;
  /** The working directory of the command. */
  readonly cwd: string;
  /** The whole environment of the command: nothing of this process's is added to it. */
  readonly env: NodeJS.ProcessEnv;
  /** How long the command may run before `script` is sent SIGTERM, which ends the command too. */
  readonly timeoutMs: number;
}

/** How the command ended and what it wrote. */
export interface PseudoTerminalRun {
  /**
   * `script`'s exit code: the command's, or 128 plus the number of the signal that ended the
   * command. -1 when `script` itself ended without one, by the time limit or another signal, or
   * never started.
   */
  readonly code: number;
  /** Whether the command outlived its time limit and was ended. */
  readonly killed: boolean;
  /** What the terminal showed, the command's standard output and error together, lines ending CR LF. */
  readonly stdout: string;
  /** What `script` itself wrote to its standard error. */
  readonly stderr: string;
}

/**
 * @description Runs `options.command` under `script` and resolves once it has ended. It never
 *   rejects: an exit code other than 0, the time limit and a `script` that cannot be started all
 *   come back as the run's code and `killed`.
 * @param options - The command line, the working directory, the environment and the time limit
 * @returns The exit code, whether the limit ended the command, and what it wrote
 */
export function runInPseudoTerminal(options: PseudoTerminalOptions): Promise<PseudoTerminalRun> {
  return new Promise((resolve) => {
    execFile(
      "script",
      ["--quiet", "--return", "--flush", "--command", options.command, "/dev/null"],
      { cwd: options.cwd, env: options.env, timeout: options.timeoutMs },
      (error, stdout, stderr) => {
        resolve({
          code: error === null ? 0 : typeof error.code === "number" ? error.code : -1,
          killed: error?.killed === true,
          stdout,
          stderr,
        });
      }
    );
  });
}
