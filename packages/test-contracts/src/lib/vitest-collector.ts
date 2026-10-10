/**
 * @file vitest-collector.ts
 * @description The vitest collector of the reach engine. For every tracked `vitest.config.*` it
 *              asks vitest itself which files that config collects, with the config's directory
 *              as root, which is how `vitest run` in that package resolves it. The primary listing
 *              is the node API (`createVitest` plus `globTestSpecifications`), which reads every
 *              tracked config of this repository in under a second in one process; when it fails for a
 *              config, the listing falls back to the CLI (`vitest list --filesOnly --json`) for
 *              that config alone. Asking vitest rather than re-reading `include` globs is the
 *              point: the answer then carries the factory's excludes, `projects`, and every
 *              default vitest applies, so the engine sees what a run sees.
 *
 *              It fails closed twice: below {@link VITEST_CONFIG_FLOOR} tracked configs, and for a
 *              config that collects no file at all. Either means the collector read less than the
 *              tree runs.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createVitest, type Vitest } from "vitest/node";
import { err, ok, type Result } from "@shared/types";
import {
  COLLECTOR_ID,
  describeError,
  type Collection,
  type Collector,
  type CollectorContext,
  type CollectorFailure,
  type CollectorOutcome,
} from "./registry.js";

/**
 * A tracked vitest config, by name: the expression `scripts/testing/metrics.mjs` counts metric
 * M8 with, held equal to it by a self-test.
 * M8 counts the tracked vitest configs, with their coverage floors, and that script derives it;
 * this constant must equal the script's expression so the engine and the metric count one set.
 */
export const VITEST_CONFIG = /(^|\/)vitest\.config\.[cm]?[jt]s$/;

/**
 * The fewest tracked vitest configs this repository may hold. It sits below the tracked count,
 * which metric M8 in `docs/development/TESTING_REFOUNDATION.md` measures, so adding or removing a
 * config does not trip it; a listing below it read the wrong directory or a partial index.
 */
export const VITEST_CONFIG_FLOOR = 80;

/** The time one `vitest list` fallback may take before it is stopped and reported. */
const CLI_TIMEOUT_MS = 120_000;

/** One collected file: its absolute path and the project that collects it (`""` at the root). */
interface CollectedSpec {
  readonly file: string;
  readonly project: string;
}

/**
 * One way to ask vitest what a config collects.
 *
 * @param root - The config's directory, the root vitest runs it from.
 * @param config - The config's absolute path.
 * @returns The collected files, or the reason the listing failed.
 */
type VitestListing = (root: string, config: string) => Promise<Result<CollectedSpec[], string>>;

/** The primary listing and its fallback. */
export interface VitestStrategies {
  readonly programmatic: VitestListing;
  readonly cli: VitestListing;
}

/** Overrides for the self-tests: a smaller floor, or listings that fail on purpose. */
export interface VitestCollectorOptions {
  readonly floor?: number;
  readonly strategies?: VitestStrategies;
}

/**
 * Lists a config's files through the vitest node API. The instance is always closed, and a
 * failed close is a failed listing: an instance that cannot be closed may still hold the
 * process open, and the CLI fallback starts from a clean process.
 *
 * @param root - The config's directory.
 * @param config - The config's absolute path.
 * @returns The collected files, or the error vitest raised.
 */
const listWithNodeApi: VitestListing = async (root, config) => {
  let vitest: Vitest | undefined;
  let listed: Result<CollectedSpec[], string>;
  try {
    // Vite's own logger would print a config it cannot load before the error reaches the catch
    // below; silencing it keeps the reason in exactly one place, the failure this returns.
    vitest = await createVitest("test", { root, config, watch: false }, { logLevel: "silent" });
    const specs = await vitest.globTestSpecifications();
    listed = ok(specs.map((spec) => ({ file: spec.moduleId, project: spec.project.name })));
  } catch (error: unknown) {
    listed = err(`vitest/node: ${describeError(error)}`);
  }
  if (vitest !== undefined) {
    try {
      await vitest.close();
    } catch (error: unknown) {
      return err(`vitest/node close: ${describeError(error)}`);
    }
  }
  return listed;
};

/** The entry point the `vitest` binary runs, resolved from this package's own dependency. */
function vitestCliPath(): string {
  const manifest = createRequire(import.meta.url).resolve("vitest/package.json");
  return path.join(path.dirname(manifest), "vitest.mjs");
}

/**
 * @param value - One parsed element of the `vitest list --json` output.
 * @returns The element as a collected spec, or `null` when it does not carry a file.
 */
function specFromListEntry(value: unknown): CollectedSpec | null {
  if (typeof value !== "object" || value === null || !("file" in value)) return null;
  const { file } = value;
  if (typeof file !== "string") return null;
  const project = "projectName" in value ? value.projectName : "";
  return { file, project: typeof project === "string" ? project : "" };
}

/**
 * Reads what `vitest list --filesOnly --json` printed on stdout. Measured on vitest 4.1.11: stdout
 * is the JSON array and nothing else — `[` is its first byte, a config that collects nothing
 * prints `[]`, and every diagnostic goes to stderr. So the array must start at the first
 * non-whitespace character; anything else, a config that writes to stdout as it loads included,
 * is named as a failure instead of being searched for an array further on.
 *
 * @param stdout - The command's standard output.
 * @returns The collected files, or why the output is not the listing.
 */
function parseListOutput(stdout: string): Result<CollectedSpec[], string> {
  const text = stdout.trim();
  if (text === "") return err("vitest list printed nothing on stdout");
  if (!text.startsWith("[")) {
    return err(
      `vitest list printed no JSON array on stdout; it begins ${JSON.stringify(text.slice(0, 60))}`
    );
  }
  let parsed: unknown[];
  try {
    // A JSON text whose first character is `[` can only parse to an array.
    parsed = JSON.parse(text) as unknown[];
  } catch (error: unknown) {
    return err(`vitest list printed an array that is not valid JSON: ${describeError(error)}`);
  }
  const specs: CollectedSpec[] = [];
  for (const entry of parsed) {
    const spec = specFromListEntry(entry);
    if (spec === null) {
      return err(`vitest list printed an entry with no file: ${JSON.stringify(entry)}`);
    }
    specs.push(spec);
  }
  return ok(specs);
}

/**
 * Lists a config's files through `vitest list --filesOnly --json`, in a child process.
 *
 * @param root - The config's directory.
 * @param config - The config's absolute path.
 * @param timeoutMs - How long the command may run before it is stopped; the self-tests shorten it.
 * @returns The collected files, or why the command or its output failed.
 */
export async function listWithCli(
  root: string,
  config: string,
  timeoutMs: number = CLI_TIMEOUT_MS
): Promise<Result<CollectedSpec[], string>> {
  const run = spawnSync(
    process.execPath,
    [vitestCliPath(), "list", "--filesOnly", "--json", "--config", config, "--root", root],
    { cwd: root, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }
  );
  if (run.error !== undefined && "code" in run.error && run.error.code === "ETIMEDOUT") {
    return err(`vitest list for ${config} timed out after the ${String(timeoutMs)} ms cap`);
  }
  if (run.error !== undefined) {
    return err(`vitest list for ${config}: ${run.error.message}`);
  }
  if (run.status !== 0) {
    const ending =
      run.status === null ? `was stopped by ${String(run.signal)}` : `exited ${String(run.status)}`;
    const tail = run.stderr.trim().split("\n").slice(-3).join(" | ");
    return err(`vitest list ${ending}: ${tail}`);
  }
  return parseListOutput(run.stdout);
}

/**
 * Lists one config, falling back to the CLI when the node API fails.
 *
 * @param root - Absolute repository root.
 * @param config - Repository-relative config path.
 * @param strategies - The primary listing and its fallback.
 * @returns The collected files, or both failures.
 */
async function listConfig(
  root: string,
  config: string,
  strategies: VitestStrategies
): Promise<Result<CollectedSpec[], string>> {
  const absolute = path.join(root, config);
  const directory = path.dirname(absolute);
  const primary = await strategies.programmatic(directory, absolute);
  if (primary.ok) return primary;
  const fallback = await strategies.cli(directory, absolute);
  if (fallback.ok) return fallback;
  return err(`${primary.error}; the CLI fallback failed too: ${fallback.error}`);
}

/**
 * Groups one config's specs into one collection per project, with repository-relative paths.
 * A file a project lists twice (one per pool) is one collection entry: it is one test file run
 * by one project.
 *
 * @param root - Absolute repository root.
 * @param config - Repository-relative config path.
 * @param specs - What vitest listed for the config.
 * @returns The collections, sorted by source.
 */
function toCollections(
  root: string,
  config: string,
  specs: readonly CollectedSpec[]
): Collection[] {
  const byProject = new Map<string, Set<string>>();
  for (const spec of specs) {
    const relative = path.relative(root, spec.file).split(path.sep).join("/");
    const files = byProject.get(spec.project) ?? new Set<string>();
    files.add(relative);
    byProject.set(spec.project, files);
  }
  return [...byProject.entries()]
    .map(([project, files]) => ({
      collector: COLLECTOR_ID.VITEST,
      source: project === "" ? config : `${config}#${project}`,
      files: [...files].sort(),
    }))
    .sort((a, b) => a.source.localeCompare(b.source));
}

/**
 * Builds the vitest collector.
 *
 * @param options - A smaller floor or replacement listings, for the self-tests only.
 * @returns The collector.
 */
export function createVitestCollector(options: VitestCollectorOptions = {}): Collector {
  const floor = options.floor ?? VITEST_CONFIG_FLOOR;
  const strategies = options.strategies ?? { programmatic: listWithNodeApi, cli: listWithCli };
  return {
    id: COLLECTOR_ID.VITEST,
    async collect(context: CollectorContext): Promise<CollectorOutcome> {
      const configs = context.tracked.filter((file) => VITEST_CONFIG.test(file));
      if (configs.length < floor) {
        return {
          collections: [],
          failures: [
            {
              collector: COLLECTOR_ID.VITEST,
              source: "(tracked configs)",
              message:
                `${String(configs.length)} tracked vitest configs, below the floor of ` +
                `${String(floor)}; the listing read less of the tree than it holds`,
            },
          ],
        };
      }
      // vitest reports each file by its real path, so the root its paths are made relative to
      // must be real too; otherwise a root reached through a symbolic link yields `../` paths
      // that match no tracked file.
      let root: string;
      try {
        root = realpathSync(context.root);
      } catch (error: unknown) {
        const message = `cannot resolve the root: ${describeError(error)}`;
        return {
          collections: [],
          failures: [{ collector: COLLECTOR_ID.VITEST, source: context.root, message }],
        };
      }
      const collections: Collection[] = [];
      const failures: CollectorFailure[] = [];
      for (const config of configs) {
        const listed = await listConfig(root, config, strategies);
        if (!listed.ok) {
          failures.push({ collector: COLLECTOR_ID.VITEST, source: config, message: listed.error });
          continue;
        }
        if (listed.value.length === 0) {
          failures.push({
            collector: COLLECTOR_ID.VITEST,
            source: config,
            message: "collects no file; every tracked vitest config must collect at least one",
          });
          continue;
        }
        collections.push(...toCollections(root, config, listed.value));
      }
      return { collections, failures };
    },
  };
}
