/**
 * @file source-resolution.ts
 * @description The source-resolution contract's command line: every workspace package a
 *              vitest-collected test imports resolves to its `src/` (see
 *              `lib/source-resolution.ts`). It runs in a process of its own because vite decides
 *              `isProduction` from `NODE_ENV` when a config is resolved, so a check of both modes
 *              needs two processes rather than a mutation of the caller's environment. Usage:
 *              `node --conditions development --import tsx src/source-resolution.ts [--root
 *              <dir>]`, with `NODE_ENV` naming the mode. Every input prints one JSON report: it
 *              exits 0 clean, 1 on any violation or error, 2 on a usage error.
 * @layer infrastructure
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { err, ok, type Result } from "@shared/types";
import { listTrackedFiles, type DiskFailure } from "./lib/disk.js";
import { describeError } from "./lib/registry.js";
import {
  checkSourceResolution,
  type SourceResolutionOptions,
  type SourceResolutionReport,
} from "./lib/source-resolution.js";

/**
 * Replacements for the self-tests: a recorded file listing (a planted tree is not a git
 * repository) and smaller floors. The CLI passes none.
 */
export interface SourceResolutionSeams extends SourceResolutionOptions {
  readonly listFiles?: (root: string) => Result<string[], DiskFailure>;
}

/** The usage every usage error names. */
const USAGE = "usage: source-resolution [--root <dir>]";

/**
 * Parses the command line. A value that begins with `--` is read as the next flag, never as the
 * root, so `--root --root` is a usage error rather than a root named `--root`.
 *
 * @param argv - The arguments after the script path.
 * @returns The root named, `undefined` when none is, or the usage error.
 */
function parseRoot(argv: readonly string[]): Result<string | undefined, string> {
  let root: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== "--root") return err(`unknown argument "${String(flag)}"`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) return err("--root needs a value");
    root = value;
    index += 1;
  }
  return ok(root);
}

/**
 * Builds the report of a run that checked nothing.
 *
 * @param error - Why nothing was checked.
 * @returns A report with no config, no import and that one error.
 */
function uncheckedReport(error: string): SourceResolutionReport {
  return { configs: 0, checked: 0, violations: [], errors: [error] };
}

/**
 * @description Runs the check over a repository. Every input ends in a report: a usage error and
 *   a root that does not resolve are errors of the report, never a thrown exception.
 * @param argv - The arguments after the script path: nothing, or `--root <dir>`.
 * @param seams - Replacements for the self-tests; the CLI passes none.
 * @returns The report and the exit code: 0 clean, 1 on a violation or an error, 2 on a usage error.
 */
export async function main(
  argv: readonly string[],
  seams: SourceResolutionSeams = {}
): Promise<{ code: number; report: SourceResolutionReport }> {
  const parsed = parseRoot(argv);
  if (!parsed.ok) return { code: 2, report: uncheckedReport(`${parsed.error}; ${USAGE}`) };
  const named = parsed.value ?? findMonorepoRoot(import.meta.dirname);
  let root: string;
  try {
    root = realpathSync(named);
  } catch (error: unknown) {
    const why = `root ${named} does not resolve: ${describeError(error)}`;
    return { code: 1, report: uncheckedReport(why) };
  }
  const tracked = (seams.listFiles ?? listTrackedFiles)(root);
  const report: SourceResolutionReport = tracked.ok
    ? await checkSourceResolution(root, tracked.value, seams)
    : uncheckedReport(tracked.error.message);
  const clean = report.violations.length === 0 && report.errors.length === 0;
  return { code: clean ? 0 : 1, report };
}

const invokedAsScript =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  const { code, report } = await main(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = code;
}
