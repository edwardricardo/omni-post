/**
 * @file cli.ts
 * @description What the command lines of this package share: the result one run returns, and the
 *              entry that runs a command's `main` only when its module is the script node was
 *              started with, so a self-test imports the module and calls `main` without starting
 *              a run of its own.
 * @layer infrastructure
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

/** What one CLI run prints and how it exits. */
export interface CliResult {
  readonly code: number;
  readonly output: string;
}

/**
 * @description Runs a command line when its module is the script node was started with: writes
 *   what `main` returns to stdout and sets the process's exit code from it. Imported by any other
 *   module, it runs nothing.
 * @param moduleUrl - The command module's `import.meta.url`.
 * @param main - The command line, as a function of the arguments after the script path.
 * @returns Once the run has written its output, or at once when the module is not the script.
 */
export async function runIfInvoked(
  moduleUrl: string,
  main: (argv: readonly string[]) => Promise<CliResult>
): Promise<void> {
  const script = process.argv[1];
  if (script === undefined || path.resolve(script) !== fileURLToPath(moduleUrl)) return;
  const result = await main(process.argv.slice(2));
  process.stdout.write(result.output);
  process.exitCode = result.code;
}
