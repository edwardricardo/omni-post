/**
 * @file playwright-collector.ts
 * @description The Playwright collector of the reach engine. For every tracked
 *              `playwright.config.*` it asks Playwright itself which spec files that config
 *              collects: `playwright test --list --reporter=json -c <config>`, the CLI found in the
 *              `node_modules` above the config, so each portal answers with the Playwright it
 *              installs. A config is one source whatever its projects: Playwright projects repeat
 *              one spec across browsers on purpose, which is one file run by one config, not a
 *              file collected twice.
 *
 *              It fails closed below {@link PLAYWRIGHT_CONFIG_FLOOR} tracked configs, on a config
 *              whose listing cannot be run, exits non-zero, prints anything but the JSON report,
 *              reports a load error or a spec with no file, and on a config that collects no file.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { err, ok, type Result } from "@shared/types";
import {
  asRecord,
  COLLECTOR_ID,
  describeError,
  trackedConfigs,
  type Collection,
  type Collector,
  type CollectorContext,
  type CollectorFailure,
  type CollectorOutcome,
} from "./registry.js";

/** A tracked Playwright config, by name. */
export const PLAYWRIGHT_CONFIG = /(^|\/)playwright\.config\.[cm]?[jt]s$/;

/** The fewest tracked Playwright configs the tree may hold: none read is nothing read. */
const PLAYWRIGHT_CONFIG_FLOOR = 1;

/** The time one `playwright test --list` may take before it is stopped and reported. */
const LIST_TIMEOUT_MS = 120_000;

/**
 * Opens the error of a report that loaded but carried errors of its own (a failing config, "No
 * tests found"). A failed listing prefers that error over stderr's tail, because Playwright
 * writes it into the JSON on stdout and leaves stderr empty; the listing tells it apart by this
 * prefix, so the parser and the listing share it rather than repeat the word.
 */
const REPORTED_ERRORS = "reported";

/**
 * One way to ask Playwright what a config collects.
 *
 * @param config - The config's absolute path.
 * @returns The collected spec files as absolute paths, or why the listing failed.
 */
type PlaywrightListing = (config: string) => Promise<Result<string[], string>>;

/** Overrides for the self-tests: a smaller floor, or a recorded listing. */
export interface PlaywrightCollectorOptions {
  readonly floor?: number;
  readonly listing?: PlaywrightListing;
}

/**
 * Collects the `file` of every spec under a suite, recursively.
 *
 * @param suite - One suite of the JSON report.
 * @param files - Where each spec's file is added.
 * @returns Why a spec could not be read, or `null`.
 */
function collectSpecFiles(suite: unknown, files: Set<string>): string | null {
  const record = asRecord(suite);
  if (record === null) return "a suite that is not an object";
  const specs = record.specs ?? [];
  const suites = record.suites ?? [];
  if (!Array.isArray(specs) || !Array.isArray(suites)) return "a suite whose specs are not a list";
  for (const spec of specs) {
    const file = asRecord(spec)?.file;
    if (typeof file !== "string" || file === "") return "a spec with no file";
    files.add(file);
  }
  for (const child of suites) {
    const failure = collectSpecFiles(child, files);
    if (failure !== null) return failure;
  }
  return null;
}

/**
 * Reads what `playwright test --list --reporter=json` printed on stdout. Measured on Playwright
 * 1.63.0: stdout is the JSON report and nothing else, its `config.rootDir` is absolute, every
 * spec's `file` is relative to it, and a config that cannot load lands in `errors`.
 *
 * @param stdout - The command's standard output.
 * @returns The spec files as absolute paths, or why the output is not the report.
 */
export function parsePlaywrightList(stdout: string): Result<string[], string> {
  const text = stdout.trim();
  if (!text.startsWith("{")) {
    return err(`printed no JSON report; it begins ${JSON.stringify(text.slice(0, 60))}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    return err(`printed a report that is not valid JSON: ${describeError(error)}`);
  }
  const report = asRecord(parsed);
  const rootDir = asRecord(report?.config)?.rootDir;
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) {
    return err("printed a report with no absolute config.rootDir");
  }
  const errors = report?.errors;
  if (!Array.isArray(errors)) return err("printed a report with no errors list");
  if (errors.length > 0) {
    const first = asRecord(errors[0])?.message;
    const message = typeof first === "string" ? first : "(no message)";
    return err(`${REPORTED_ERRORS} ${String(errors.length)} errors: ${message}`);
  }
  const suites = report?.suites;
  if (!Array.isArray(suites)) return err("printed a report with no suites list");
  const files = new Set<string>();
  for (const suite of suites) {
    const failure = collectSpecFiles(suite, files);
    if (failure !== null) return err(`printed ${failure}`);
  }
  return ok([...files].map((file) => path.resolve(rootDir, file)));
}

/**
 * Finds the Playwright CLI a directory's own packages install, walking up through its
 * `node_modules` directories. It does not ask `require.resolve`, whose `NODE_PATH` fallback
 * would answer with a Playwright the config's package does not declare.
 *
 * @param directory - The config's directory.
 * @returns The CLI's path, or `null` when no enclosing `node_modules` holds `@playwright/test`.
 */
function findPlaywrightCli(directory: string): string | null {
  let current = directory;
  for (;;) {
    const candidate = path.join(current, "node_modules", "@playwright", "test", "cli.js");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Lists a config's spec files through the Playwright CLI its own directory installs.
 *
 * @param config - The config's absolute path.
 * @param timeoutMs - How long the listing may run before it is stopped.
 * @returns The spec files as absolute paths, or why the listing failed.
 */
export function listWithPlaywrightCli(
  config: string,
  timeoutMs: number = LIST_TIMEOUT_MS
): Promise<Result<string[], string>> {
  const directory = path.dirname(config);
  const cli = findPlaywrightCli(directory);
  if (cli === null) {
    return Promise.resolve(err(`no node_modules above ${directory} installs @playwright/test`));
  }
  const run = spawnSync(
    process.execPath,
    [cli, "test", "--list", "--reporter=json", "-c", config],
    { cwd: directory, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }
  );
  if (run.error !== undefined && "code" in run.error && run.error.code === "ETIMEDOUT") {
    return Promise.resolve(err(`playwright test --list timed out after ${String(timeoutMs)} ms`));
  }
  if (run.error !== undefined) {
    return Promise.resolve(err(`playwright test --list: ${run.error.message}`));
  }
  if (run.status !== 0) {
    const ending =
      run.status === null ? `was stopped by ${String(run.signal)}` : `exited ${String(run.status)}`;
    // A config that loads but fails, "No tests found" included, reports it in the JSON on stdout
    // and leaves stderr empty, so the report is read first.
    const report = parsePlaywrightList(run.stdout);
    const tail = run.stderr.trim().split("\n").slice(-3).join(" | ");
    const detail =
      !report.ok && (report.error.startsWith(REPORTED_ERRORS) || tail === "") ? report.error : tail;
    return Promise.resolve(err(`playwright test --list ${ending}: ${detail}`));
  }
  const parsed = parsePlaywrightList(run.stdout);
  return Promise.resolve(parsed.ok ? parsed : err(`playwright test --list ${parsed.error}`));
}

/**
 * Builds the Playwright collector.
 *
 * @param options - A smaller floor or a recorded listing, for the self-tests only.
 * @returns The collector.
 */
export function createPlaywrightCollector(options: PlaywrightCollectorOptions = {}): Collector {
  const floor = options.floor ?? PLAYWRIGHT_CONFIG_FLOOR;
  const listing = options.listing ?? ((config: string) => listWithPlaywrightCli(config));
  return {
    id: COLLECTOR_ID.PLAYWRIGHT,
    async collect(context: CollectorContext): Promise<CollectorOutcome> {
      const tracked = trackedConfigs(
        COLLECTOR_ID.PLAYWRIGHT,
        context,
        { pattern: PLAYWRIGHT_CONFIG, label: "Playwright" },
        floor
      );
      if (!tracked.ok) return tracked.error;
      const { configs, root } = tracked.value;
      const collections: Collection[] = [];
      const failures: CollectorFailure[] = [];
      for (const config of configs) {
        const listed = await listing(path.join(root, config));
        if (!listed.ok || listed.value.length === 0) {
          failures.push({
            collector: COLLECTOR_ID.PLAYWRIGHT,
            source: config,
            message: listed.ok
              ? "collects no file; every tracked Playwright config must collect at least one"
              : listed.error,
          });
          continue;
        }
        const files = listed.value.map((file) =>
          path.relative(root, file).split(path.sep).join("/")
        );
        collections.push({
          collector: COLLECTOR_ID.PLAYWRIGHT,
          source: config,
          files: [...new Set(files)].sort(),
        });
      }
      return { collections, failures };
    },
  };
}
