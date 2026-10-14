/**
 * @file scopes.ts
 * @description The scope contract's command line, fitness #36: every positive `test.include` glob
 *              of every tracked vitest config, and its `coverage.include` where it sets one,
 *              matches at least one tracked file (see `lib/scopes.ts`). It lists the tracked files
 *              with `git ls-files`, resolves each config with vitest's own config loader and
 *              prints one line per violation (rule S1) and per error, then a summary. Usage:
 *              `pnpm --filter @packages/test-contracts scopes [--root <dir>] [--json]`; without
 *              `--root` the root is the monorepo around this package. Exit 0 clean, 1 on any
 *              violation or error, 2 on a usage error.
 * @layer infrastructure
 */
import path from "node:path";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { err, ok, type Result } from "@shared/types";
import { runIfInvoked, type CliResult } from "./lib/cli.js";
import { listTrackedFiles, type DiskFailure } from "./lib/disk.js";
import { checkScopeContract, type ScopesReport } from "./lib/scopes.js";

/** What the self-tests replace: the file listing (a planted tree is not a git repository) and the floor. */
export interface ScopesSeams {
  readonly listFiles?: (root: string) => Result<string[], DiskFailure>;
  readonly floor?: number;
}

/** The parsed command line. */
interface ScopesArguments {
  readonly root?: string;
  readonly json: boolean;
}

/** The usage line every usage error prints. */
const USAGE = "usage: scopes [--root <dir>] [--json]\n";

/**
 * @param argv - The arguments after the script path.
 * @returns The parsed arguments, or the usage error; a `--root` with no value is one.
 */
function parseScopesArguments(argv: readonly string[]): Result<ScopesArguments, string> {
  let root: string | undefined;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--json") {
      json = true;
    } else if (flag === "--root") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) return err("--root needs a value");
      root = path.resolve(value);
      index += 1;
    } else {
      return err(`unknown argument "${String(flag)}"`);
    }
  }
  return ok({ ...(root !== undefined && { root }), json });
}

/**
 * Renders a report for a terminal: errors first, then every violation, then the counts.
 *
 * @param report - The report.
 * @returns The text, newline-terminated.
 */
function formatScopes(report: ScopesReport): string {
  const lines = [`scopes: ${report.ok ? "PASS" : "FAIL"}`];
  for (const error of report.errors) lines.push(`error: ${error}`);
  for (const violation of report.violations) {
    lines.push(`${violation.rule} ${violation.source}: ${violation.message}`);
  }
  lines.push(
    `summary: ${String(report.resolved)} of ${String(report.configs)} tracked vitest configs ` +
      `resolved; ${String(report.globs)} positive scope globs checked; ` +
      `${String(report.violations.length)} violations; ${String(report.errors.length)} errors`
  );
  return `${lines.join("\n")}\n`;
}

/**
 * @description The command line, as a function: parse, list the tracked files, check every
 *   config's scopes, render, decide the exit code. A listing that fails is an error, never an
 *   empty tree.
 * @param argv - The arguments after the script path.
 * @param seams - Replacements for the self-tests; the CLI passes none.
 * @returns The text to print and the exit code.
 */
export async function main(argv: readonly string[], seams: ScopesSeams = {}): Promise<CliResult> {
  const parsed = parseScopesArguments(argv);
  if (!parsed.ok) return { code: 2, output: `scopes: ${parsed.error}\n${USAGE}` };
  const root = parsed.value.root ?? findMonorepoRoot(import.meta.dirname);
  const listed = (seams.listFiles ?? listTrackedFiles)(root);
  const report: ScopesReport = listed.ok
    ? await checkScopeContract(root, listed.value, {
        ...(seams.floor !== undefined && { floor: seams.floor }),
      })
    : {
        ok: false,
        configs: 0,
        resolved: 0,
        globs: 0,
        violations: [],
        errors: [listed.error.message],
      };
  return {
    code: report.ok ? 0 : 1,
    output: parsed.value.json ? `${JSON.stringify(report, null, 2)}\n` : formatScopes(report),
  };
}

await runIfInvoked(import.meta.url, main);
