/**
 * @file reach.ts
 * @description The reach engine's command line: every test-shaped tracked file must be run by
 *              exactly one collector source that a required check runs, or sit in the
 *              quarantine. It reads the disk (`git ls-files`, filtered to test-shaped names), asks
 *              each collector (vitest, node:test, Playwright, k6) what it runs, reads
 *              `collectors.json`, the workflows it names and the ruleset's required checks to
 *              decide which sources a required check runs (R2, `lib/executed-by.ts`), reads the
 *              quarantine files it is given, and hands all of it to the pure verdict in
 *              `lib/rules.ts` (R1 and R3). It also reads the `package.json` of every package that
 *              keeps a tracked vitest config and holds its `test` script to `vitest run`, the
 *              script contract (C1, `lib/script-contract.ts`), and holds the `exclude` the vitest
 *              collector resolved for every tracked vitest config, its root config's and each
 *              project's, to every pattern of `RESERVED_TIER_EXCLUDES`, the exclude contract (C2,
 *              `lib/exclude-contract.ts`). The tracked test-shaped files come from `lib/disk.ts`,
 *              what each vitest config collects from `lib/vitest-collector.ts`, the contract every
 *              collector answers and the merge of their answers from `lib/registry.ts`, and the
 *              quarantine's schema from `lib/rules.ts`.
 *
 *              `--quarantine` names the quarantine under check; `--base` names the quarantine of
 *              the commit it is compared against, and R3 then refuses any entry the base does not
 *              hold, so the quarantine may only shrink. `--base` without `--quarantine` is a usage
 *              error: the comparison would run over no quarantine and report that it ran. Every
 *              failure to read an input — the disk below its floor, a collector below its floor or
 *              unable to list a source, C1 or C2 below the same floor, a config whose exclude the
 *              collector did not resolve, a registry, ruleset, manifest, quarantine or base
 *              quarantine that is missing or does not parse — is an error, and
 *              an error fails the run: a verdict over an input the engine did not read is not a
 *              verdict. Usage: `pnpm --filter @packages/test-contracts reach [--root <dir>]
 *              [--quarantine <file> [--base <file>]] [--collectors <file>] [--ruleset <file>]
 *              [--json]`. Every path resolves against the
 *              working directory, which `pnpm --filter` sets to the package's directory. Exit 0
 *              clean, 1 on any violation or error, 2 on a usage error. `--json` prints the whole
 *              report, and with it `reach`, every collected file mapped to the sources that collect
 *              it, which the terminal rendering leaves out.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { err, ok, type Result } from "@shared/types";
import { runIfInvoked, type CliResult } from "./lib/cli.js";
import { DISK_FLOOR, inventoryFromFiles, listTrackedFiles, type DiskFailure } from "./lib/disk.js";
import { checkExcludeContract } from "./lib/exclude-contract.js";
import {
  checkExecutedBy,
  parseCollectorRegistry,
  parseRequiredContexts,
  readWorkflows,
  REGISTRY_FILE,
  RULESET_FILE,
  type ExecutedByVerdict,
} from "./lib/executed-by.js";
import { createK6Collector } from "./lib/k6.js";
import { createNodeCollector } from "./lib/node-collector.js";
import { createPlaywrightCollector } from "./lib/playwright-collector.js";
import {
  describeError,
  runCollectors,
  sourceLabel,
  tallyReach,
  type Collection,
  type Collector,
} from "./lib/registry.js";
import {
  evaluate,
  parseQuarantine,
  RULE,
  type QuarantineEntry,
  type Violation,
} from "./lib/rules.js";
import { checkScriptContract } from "./lib/script-contract.js";
import { createVitestCollector, isVitestCollector } from "./lib/vitest-collector.js";

/** Whether R3's shrink-only clause ran, and why not when it did not. */
type ShrinkCheck =
  | "ran"
  | "not run: no --base given"
  | "not run: base unreadable"
  | "not run: quarantine unreadable"
  | "not run: disk listing failed";

/** The outcome of one run. */
interface ReachReport {
  readonly ok: boolean;
  /** Test-shaped tracked files on disk. */
  readonly testShaped: number;
  /** Collecting sources, labelled `<collector>:<source>`, with the count each collects. */
  readonly sources: readonly SourceCount[];
  /** Packages that keep a tracked vitest config, each held to the script contract (C1). */
  readonly packages: number;
  /** Tracked vitest configs, each held to the exclude contract (C2). */
  readonly configs: number;
  readonly violations: readonly Violation[];
  /** Inputs the engine could not read in full; any one fails the run. */
  readonly errors: readonly string[];
  readonly shrinkCheck: ShrinkCheck;
  /**
   * Every collected file mapped to the `<collector>:<source>` labels of the sources that collect
   * it, in the order {@link reachByFile} gives them: a file no source collects has no entry, and a
   * file two sources collect has two labels. Only `--json` prints it.
   */
  readonly reach: Readonly<Record<string, readonly string[]>>;
}

/** Each rule's place in a report: the order {@link RULE} declares. */
const RULE_ORDER: readonly string[] = Object.values(RULE);

/** One collecting source, how many files it collects, and whether a required check runs it. */
interface SourceCount {
  readonly source: string;
  readonly files: number;
  readonly run: boolean;
}

/** The inputs of one run. */
interface ReachOptions {
  /** Absolute repository root. */
  readonly root: string;
  readonly quarantinePath?: string;
  readonly basePath?: string;
  readonly registryPath: string;
  readonly rulesetPath: string;
}

/**
 * What the self-tests replace: the file listing (a planted tree is not a git repository), the
 * disk floor and the floor C1 and C2 share (a planted tree holds a handful of tests and packages)
 * and the collectors. The CLI passes none.
 */
export interface ReachSeams {
  readonly listFiles?: (root: string) => Result<string[], DiskFailure>;
  readonly diskFloor?: number;
  readonly packageFloor?: number;
  readonly collectors?: readonly Collector[];
}

/** @returns Every collector the engine runs, in the order they report. */
function defaultCollectors(): Collector[] {
  return [
    createVitestCollector(),
    createNodeCollector(),
    createPlaywrightCollector(),
    createK6Collector(),
  ];
}

/**
 * Reads a file, recording a read failure.
 *
 * @param kind - What the file is, for the failure.
 * @param file - The file.
 * @param errors - Where a read failure is recorded.
 * @returns The text, or `null` when it could not be read.
 */
function readInput(kind: string, file: string, errors: string[]): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch (error: unknown) {
    errors.push(`${kind} ${file} cannot be read: ${describeError(error)}`);
    return null;
  }
}

/**
 * Reads a quarantine file.
 *
 * @param kind - Which quarantine it is, `quarantine` or `base quarantine`, for its failures.
 * @param file - The file.
 * @param errors - Where a read or parse failure is recorded.
 * @returns The entries, or `null` when the file could not be read or parsed.
 */
function readQuarantine(kind: string, file: string, errors: string[]): QuarantineEntry[] | null {
  const text = readInput(kind, file, errors);
  if (text === null) return null;
  const parsed = parseQuarantine(text, file, kind);
  if (parsed.ok) return parsed.value;
  errors.push(parsed.error);
  return null;
}

/**
 * @param root - Absolute repository root.
 * @returns A reader of repository-relative files that reports a failure instead of throwing.
 */
function readerUnder(root: string): (file: string) => Result<string, string> {
  return (file) => {
    try {
      return ok(readFileSync(path.join(root, file), "utf8"));
    } catch (error: unknown) {
      return err(describeError(error));
    }
  };
}

/** What R3's shrink-only clause needs before it can compare: which inputs were named and read. */
interface ShrinkInputs {
  /** Whether `--base` named a base quarantine. */
  readonly baseNamed: boolean;
  /** Whether the disk listing held; when it did not, the run stopped before reading anything. */
  readonly diskListed: boolean;
  readonly baseRead: boolean;
  readonly quarantineRead: boolean;
}

/**
 * The one place that decides the summary's shrink-check status, for a run that stopped at the
 * disk listing and for one that read everything alike.
 *
 * @param inputs - Which inputs were named and read.
 * @returns Whether R3's shrink-only clause compared the two quarantines, and why not when it did not.
 */
function shrinkCheckOf(inputs: ShrinkInputs): ShrinkCheck {
  if (!inputs.baseNamed) return "not run: no --base given";
  if (!inputs.diskListed) return "not run: disk listing failed";
  if (!inputs.baseRead) return "not run: base unreadable";
  if (!inputs.quarantineRead) return "not run: quarantine unreadable";
  return "ran";
}

/**
 * Reads the registry, the ruleset and the workflows, and holds them against R2.
 *
 * @param options - Where the registry and the ruleset live.
 * @param collectors - The collectors that ran.
 * @param collections - What they collected.
 * @param errors - Where a read or parse failure is recorded.
 * @returns The R2 verdict, or `null` when an input could not be read.
 */
function readExecutedBy(
  options: ReachOptions,
  collectors: readonly Collector[],
  collections: readonly Collection[],
  errors: string[]
): ExecutedByVerdict | null {
  const registryText = readInput("registry", options.registryPath, errors);
  const rulesetText = readInput("ruleset", options.rulesetPath, errors);
  if (registryText === null || rulesetText === null) return null;
  const registry = parseCollectorRegistry(registryText, options.registryPath);
  const contexts = parseRequiredContexts(rulesetText, options.rulesetPath);
  if (!registry.ok) errors.push(registry.error);
  if (!contexts.ok) errors.push(contexts.error);
  if (!registry.ok || !contexts.ok) return null;
  return checkExecutedBy({
    registry: registry.value,
    contexts: contexts.value,
    workflows: readWorkflows(options.root, registry.value),
    collectorIds: collectors.map((collector) => collector.id),
    collections,
  });
}

/**
 * @description Maps every collected file to the sources that collect it, for the JSON report.
 *   Files are compared with `<`, by UTF-16 code unit, which for the ASCII paths the tree holds is
 *   byte order, so one tree always prints in one order; `localeCompare` would not do, since its
 *   order depends on the locale and folds case. Each file's labels come from {@link tallyReach},
 *   whose `sort()` compares by the same code units. A file path is never an array index, so the
 *   object keeps that order when it is serialized.
 * @param collections - Every collection of every collector.
 * @returns File → sorted `<collector>:<source>` labels; a file no source collects has no entry.
 */
function reachByFile(
  collections: readonly Collection[]
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    [...tallyReach(collections)].sort(([a], [b]) => (a < b ? -1 : Number(a > b)))
  );
}

/**
 * Runs the engine once: list, collect, read the registry and the quarantines, evaluate.
 *
 * @param options - The repository root and the registry and quarantine inputs.
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
      packages: 0,
      configs: 0,
      violations: [],
      errors: [inventory.error.message],
      shrinkCheck: shrinkCheckOf({
        baseNamed: options.basePath !== undefined,
        diskListed: false,
        baseRead: false,
        quarantineRead: false,
      }),
      reach: {},
    };
  }
  const errors: string[] = [];
  const quarantine =
    options.quarantinePath === undefined
      ? []
      : readQuarantine("quarantine", options.quarantinePath, errors);
  const base =
    options.basePath === undefined
      ? null
      : readQuarantine("base quarantine", options.basePath, errors);
  const collectors = seams.collectors ?? defaultCollectors();
  const outcome = await runCollectors(collectors, {
    root: options.root,
    tracked: inventory.value.tracked,
  });
  for (const failure of outcome.failures) {
    errors.push(`${sourceLabel(failure)}: ${failure.message}`);
  }
  const executedBy = readExecutedBy(options, collectors, outcome.collections, errors);
  const scripts = checkScriptContract(
    inventory.value.tracked,
    readerUnder(options.root),
    seams.packageFloor
  );
  errors.push(...scripts.errors);
  // C2 reads what the vitest collector resolved while it listed, never a second resolution; a run
  // given no vitest collector has resolved nothing, and every config is then an error.
  const excludes = checkExcludeContract(
    inventory.value.tracked,
    collectors.find(isVitestCollector)?.resolvedExcludes() ?? new Map(),
    seams.packageFloor
  );
  errors.push(...excludes.errors);
  const evaluated = evaluate({
    disk: inventory.value,
    collections: outcome.collections,
    quarantine: quarantine ?? [],
    base,
    ...(executedBy !== null && { runSources: executedBy.runSources }),
  });
  // The sort is stable, so each rule's violations keep the file order their check gave them.
  const violations = [
    ...evaluated,
    ...(executedBy?.violations ?? []),
    ...scripts.violations,
    ...excludes.violations,
  ].sort((a, b) => RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule));
  return {
    ok: errors.length === 0 && violations.length === 0,
    testShaped: inventory.value.testShaped.length,
    sources: outcome.collections.map((collection) => ({
      source: sourceLabel(collection),
      files: collection.files.length,
      run: executedBy?.runSources.has(sourceLabel(collection)) ?? false,
    })),
    packages: scripts.packages,
    configs: excludes.configs,
    violations,
    errors,
    shrinkCheck: shrinkCheckOf({
      baseNamed: options.basePath !== undefined,
      diskListed: true,
      baseRead: base !== null,
      quarantineRead: quarantine !== null,
    }),
    reach: reachByFile(outcome.collections),
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
  const run = report.sources.filter((source) => source.run).length;
  lines.push(
    `summary: ${String(report.testShaped)} test-shaped tracked files; ` +
      `${String(collected)} collected by ${String(report.sources.length)} sources, ` +
      `${String(run)} of them run by a required check; ` +
      `${String(report.packages)} vitest packages held to the script contract; ` +
      `${String(report.configs)} vitest configs held to the exclude contract; ` +
      `${String(report.violations.length)} violations; ${String(report.errors.length)} errors; ` +
      `quarantine shrink check ${report.shrinkCheck}`
  );
  return `${lines.join("\n")}\n`;
}

/** The parsed command line. */
interface CliArguments {
  readonly root?: string;
  readonly quarantine?: string;
  readonly base?: string;
  readonly collectors?: string;
  readonly ruleset?: string;
  readonly json: boolean;
}

/** The flags that take a value, mapped to the argument they fill. */
const VALUE_FLAGS = {
  "--root": "root",
  "--quarantine": "quarantine",
  "--base": "base",
  "--collectors": "collectors",
  "--ruleset": "ruleset",
} as const;

/** The usage line every usage error prints. */
const USAGE =
  "usage: reach [--root <dir>] [--quarantine <file> [--base <file>]] " +
  "[--collectors <file>] [--ruleset <file>] [--json]\n";

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
  const values: { -readonly [K in keyof Omit<CliArguments, "json">]?: string } = {};
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
  if (values.base !== undefined && values.quarantine === undefined) {
    return err(
      "--base needs --quarantine: the shrink-only check compares the quarantine under check " +
        "with the base, and without --quarantine there is none to compare"
    );
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

/**
 * @description The command line, as a function: parse, run, render, decide the exit code.
 * @param argv - The arguments after the script path.
 * @param seams - Replacements for the self-tests; the CLI passes none.
 * @returns The text to print and the exit code.
 */
export async function main(argv: readonly string[], seams: ReachSeams = {}): Promise<CliResult> {
  const parsed = parseArguments(argv);
  if (!parsed.ok) return { code: 2, output: `reach: ${parsed.error}\n${USAGE}` };
  const root = parsed.value.root === undefined ? repositoryRoot() : ok(parsed.value.root);
  if (!root.ok) return { code: 1, output: `reach: FAIL\nerror: ${root.error}\n` };
  const report = await runReach(
    {
      root: root.value,
      ...(parsed.value.quarantine !== undefined && { quarantinePath: parsed.value.quarantine }),
      ...(parsed.value.base !== undefined && { basePath: parsed.value.base }),
      registryPath: parsed.value.collectors ?? path.join(root.value, REGISTRY_FILE),
      rulesetPath: parsed.value.ruleset ?? path.join(root.value, RULESET_FILE),
    },
    seams
  );
  return {
    code: report.ok ? 0 : 1,
    output: parsed.value.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report),
  };
}

await runIfInvoked(import.meta.url, main);
