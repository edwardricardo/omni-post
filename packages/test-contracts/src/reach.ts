/**
 * @file reach.ts
 * @description The reach engine's command line: every test-shaped tracked file must be run by
 *              exactly one collector, or sit in the quarantine. It reads the disk (`git ls-files`,
 *              filtered to test-shaped names), asks each registered collector what it runs, reads
 *              the quarantine files it is given, and hands all of it to the pure verdict in
 *              `lib/rules.ts` (R1 and R3).
 *
 *              Every failure to read an input — the disk below its floor, a collector below its
 *              floor or unable to list a source, a quarantine that is missing or does not parse —
 *              is an error, and an error fails the run: a verdict over an input the engine did not
 *              read is not a verdict. Usage: `pnpm --filter @packages/test-contracts reach
 *              [--root <dir>] [--quarantine <file>] [--base <file>] [--json]`. Exit 0 clean, 1 on
 *              any violation or error, 2 on a usage error.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { err, ok, type Result } from "@shared/types";
import { DISK_FLOOR, inventoryFromFiles, listTrackedFiles, type DiskFailure } from "./lib/disk.js";
import { describeError, runCollectors, sourceLabel, type Collector } from "./lib/registry.js";
import { evaluate, parseQuarantine, type QuarantineEntry, type Violation } from "./lib/rules.js";
import { createVitestCollector } from "./lib/vitest-collector.js";

/** The outcome of one run. */
interface ReachReport {
  readonly ok: boolean;
  /** Test-shaped tracked files on disk. */
  readonly testShaped: number;
  /** Collecting sources, labelled `<collector>:<source>`, with the count each collects. */
  readonly sources: readonly SourceCount[];
  readonly violations: readonly Violation[];
  /** Inputs the engine could not read in full; any one fails the run. */
  readonly errors: readonly string[];
  /** Whether a base quarantine was read, so the shrink-only check ran. */
  readonly baseChecked: boolean;
}

/** One collecting source and how many files it collects. */
interface SourceCount {
  readonly source: string;
  readonly files: number;
}

/** The inputs of one run. */
interface ReachOptions {
  /** Absolute repository root. */
  readonly root: string;
  readonly quarantinePath?: string;
  readonly basePath?: string;
}

/**
 * What the self-tests replace: the file listing (a planted tree is not a git repository), the
 * disk floor (a planted tree holds a handful of tests) and the collectors. The CLI passes none.
 */
export interface ReachSeams {
  readonly listFiles?: (root: string) => Result<string[], DiskFailure>;
  readonly diskFloor?: number;
  readonly collectors?: readonly Collector[];
}

/**
 * Reads a quarantine file when one was named.
 *
 * @param file - The file, or `undefined` when none was named.
 * @param errors - Where a read or parse failure is recorded.
 * @returns The entries, `[]` when no file was named, or `null` when the file could not be read.
 */
function readQuarantine(file: string | undefined, errors: string[]): QuarantineEntry[] | null {
  if (file === undefined) return [];
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error: unknown) {
    errors.push(`quarantine ${file} cannot be read: ${describeError(error)}`);
    return null;
  }
  const parsed = parseQuarantine(text, file);
  if (parsed.ok) return parsed.value;
  errors.push(parsed.error);
  return null;
}

/**
 * Runs the engine once: list, collect, read the quarantines, evaluate.
 *
 * @param options - The repository root and the quarantine inputs.
 * @param seams - Replacements for the self-tests; the CLI passes none.
 * @returns The report; nothing is thrown.
 */
async function runReach(options: ReachOptions, seams: ReachSeams): Promise<ReachReport> {
  const listed = (seams.listFiles ?? listTrackedFiles)(options.root);
  const inventory = listed.ok
    ? inventoryFromFiles(listed.value, seams.diskFloor ?? DISK_FLOOR)
    : listed;
  if (!inventory.ok) {
    return {
      ok: false,
      testShaped: 0,
      sources: [],
      violations: [],
      errors: [inventory.error.message],
      baseChecked: false,
    };
  }
  const errors: string[] = [];
  const quarantine = readQuarantine(options.quarantinePath, errors);
  const base = options.basePath === undefined ? null : readQuarantine(options.basePath, errors);
  const outcome = await runCollectors(seams.collectors ?? [createVitestCollector()], {
    root: options.root,
    tracked: inventory.value.tracked,
  });
  for (const failure of outcome.failures) {
    errors.push(`${sourceLabel(failure)}: ${failure.message}`);
  }
  const violations = evaluate({
    disk: inventory.value,
    collections: outcome.collections,
    quarantine: quarantine ?? [],
    base,
  });
  return {
    ok: errors.length === 0 && violations.length === 0,
    testShaped: inventory.value.testShaped.length,
    sources: outcome.collections.map((collection) => ({
      source: sourceLabel(collection),
      files: collection.files.length,
    })),
    violations,
    errors,
    baseChecked: base !== null,
  };
}

/**
 * Renders a report for a terminal: errors first, then every violation file by file, then the
 * counts.
 *
 * @param report - The report.
 * @returns The text, newline-terminated.
 */
function formatReport(report: ReachReport): string {
  const lines = [`reach: ${report.ok ? "PASS" : "FAIL"}`];
  for (const error of report.errors) lines.push(`error: ${error}`);
  for (const violation of report.violations) {
    lines.push(`${violation.rule} ${violation.file}: ${violation.message}`);
  }
  const collected = report.sources.reduce((sum, source) => sum + source.files, 0);
  lines.push(
    `summary: ${String(report.testShaped)} test-shaped tracked files; ` +
      `${String(collected)} collected by ${String(report.sources.length)} sources; ` +
      `${String(report.violations.length)} violations; ${String(report.errors.length)} errors; ` +
      `quarantine shrink check ${report.baseChecked ? "ran" : "not run: no --base given"}`
  );
  return `${lines.join("\n")}\n`;
}

/** The parsed command line. */
interface CliArguments {
  readonly root?: string;
  readonly quarantine?: string;
  readonly base?: string;
  readonly json: boolean;
}

/** The flags that take a value, mapped to the argument they fill. */
const VALUE_FLAGS = {
  "--root": "root",
  "--quarantine": "quarantine",
  "--base": "base",
} as const;

/**
 * @param flag - One command-line argument.
 * @returns Whether it is a flag that takes a value. An own-property check, so `toString` and
 *   the rest of the prototype are not flags.
 */
function isValueFlag(flag: string): flag is keyof typeof VALUE_FLAGS {
  return Object.hasOwn(VALUE_FLAGS, flag);
}

/**
 * @param argv - The arguments after the script path.
 * @returns The parsed arguments, or the usage error.
 */
function parseArguments(argv: readonly string[]): Result<CliArguments, string> {
  const values: { root?: string; quarantine?: string; base?: string } = {};
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] ?? "";
    if (flag === "--json") {
      json = true;
      continue;
    }
    if (!isValueFlag(flag)) return err(`unknown argument "${flag}"`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) return err(`${flag} needs a value`);
    values[VALUE_FLAGS[flag]] = path.resolve(value);
    index += 1;
  }
  return ok({ ...values, json });
}

/** @returns The repository root around the working directory, or why it could not be found. */
function repositoryRoot(): Result<string, string> {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return ok(root.trim());
  } catch (error: unknown) {
    return err(`not inside a git repository: ${describeError(error)}`);
  }
}

/** What one CLI run prints and how it exits. */
interface CliResult {
  readonly code: number;
  readonly output: string;
}

/**
 * The command line, as a function: parse, run, render, decide the exit code.
 *
 * @param argv - The arguments after the script path.
 * @param seams - Replacements for the self-tests; the CLI passes none.
 * @returns The text to print and the exit code.
 */
export async function main(argv: readonly string[], seams: ReachSeams = {}): Promise<CliResult> {
  const parsed = parseArguments(argv);
  if (!parsed.ok) {
    return {
      code: 2,
      output:
        `reach: ${parsed.error}\n` +
        "usage: reach [--root <dir>] [--quarantine <file>] [--base <file>] [--json]\n",
    };
  }
  const root = parsed.value.root === undefined ? repositoryRoot() : ok(parsed.value.root);
  if (!root.ok) return { code: 1, output: `reach: FAIL\nerror: ${root.error}\n` };
  const report = await runReach(
    {
      root: root.value,
      ...(parsed.value.quarantine !== undefined && { quarantinePath: parsed.value.quarantine }),
      ...(parsed.value.base !== undefined && { basePath: parsed.value.base }),
    },
    seams
  );
  return {
    code: report.ok ? 0 : 1,
    output: parsed.value.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report),
  };
}

const invokedAsScript =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  const result = await main(process.argv.slice(2));
  process.stdout.write(result.output);
  process.exitCode = result.code;
}
