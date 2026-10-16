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
 *              tree runs. {@link withVitest}, which opens and closes the instance, is shared with
 *              the scope check (`lib/scopes.ts`), so the two resolve a config the same way.
 *
 *              The instance that lists a config's files has resolved the whole config, so the
 *              collector also keeps what it resolved of each config's `exclude`, the root config's
 *              and each project's, for the exclude contract (rule C2, `lib/exclude-contract.ts`):
 *              that rule reads the very resolution whose files R1 judged. A config the CLI
 *              fallback listed has no resolution to keep, since `vitest list` prints files only.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { createVitest, type Vitest } from "vitest/node";
import { err, ok, type Result } from "@shared/types";
import {
  COLLECTOR_ID,
  describeError,
  trackedConfigs,
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

/**
 * The bytes one `vitest list` fallback may print on stdout or stderr before it is stopped and
 * reported: one config's files, so the cap bounds a runaway listing, far above a real one.
 */
const CLI_OUTPUT_CAP_BYTES = 64 * 1024 * 1024;

/** The caps of one `vitest list` fallback; the self-tests lower them, the collector takes none. */
export interface VitestListLimits {
  /** How long the command may run before it is stopped. */
  readonly timeoutMs?: number;
  /** How many bytes stdout or stderr may carry before the command is stopped. */
  readonly outputCapBytes?: number;
}

/** One collected file: its absolute path and the project that collects it (`""` at the root). */
interface CollectedSpec {
  readonly file: string;
  readonly project: string;
}

/**
 * What the node API resolved of one config's `exclude`: the root config's list, and the list of
 * each project other than the root one. A config that declares no projects has none here, because
 * its one project is the root config itself, whose list `root` already holds.
 */
export interface ResolvedExcludes {
  readonly root: readonly string[];
  /** Each project's name, as vitest resolved it, and its `exclude`. */
  readonly projects: readonly { readonly name: string; readonly exclude: readonly string[] }[];
}

/**
 * One listing of a config: the files it collects, and its resolved `exclude` when the listing
 * resolved the config.
 */
interface ConfigListing {
  readonly specs: readonly CollectedSpec[];
  /** `null` when the listing resolved no config: the CLI fallback reads files, never a config. */
  readonly excludes: ResolvedExcludes | null;
}

/**
 * One way to ask vitest what a config collects.
 *
 * @param root - The config's directory, the root vitest runs it from.
 * @param config - The config's absolute path.
 * @returns The collected files with the resolved excludes, or the reason the listing failed.
 */
type VitestListing = (root: string, config: string) => Promise<Result<ConfigListing, string>>;

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
 * @description Opens a vitest instance over one config, the way `vitest run` in that config's
 *   directory resolves it, hands it to `read`, and closes it. The instance is always closed, and
 *   a failed close is a failure of the whole read: an instance that cannot be closed may still
 *   hold the process open. The collector lists files through it and the scope check reads the
 *   resolved globs through it, so both see one resolution.
 * @param root - The config's directory.
 * @param config - The config's absolute path.
 * @param read - What to read from the open instance.
 * @returns What `read` returned, or the error vitest raised while resolving, reading or closing.
 */
export async function withVitest<T>(
  root: string,
  config: string,
  read: (vitest: Vitest) => T | Promise<T>
): Promise<Result<T, string>> {
  let vitest: Vitest | undefined;
  let result: Result<T, string>;
  try {
    // Vite's own logger would print a config it cannot load before the error reaches the catch
    // below; silencing it keeps the reason in exactly one place, the failure this returns.
    vitest = await createVitest("test", { root, config, watch: false }, { logLevel: "silent" });
    result = ok(await read(vitest));
  } catch (error: unknown) {
    result = err(`vitest/node: ${describeError(error)}`);
  }
  if (vitest !== undefined) {
    try {
      await vitest.close();
    } catch (error: unknown) {
      return err(`vitest/node close: ${describeError(error)}`);
    }
  }
  return result;
}

/**
 * Reads the resolved `exclude` of an open instance: the root config's, and each project's other
 * than the root project, whose config is the root config itself. Measured on vitest 4.1.11: a
 * config that declares no projects resolves to one root project sharing the root config, and an
 * inline project that does not set `extends: true` resolves vitest's default `exclude` rather than
 * the root's, so each project's list is read on its own.
 *
 * @param vitest - The open instance.
 * @returns Copies of the lists, which outlive the instance.
 */
function excludesOf(vitest: Vitest): ResolvedExcludes {
  return {
    root: [...vitest.config.exclude],
    projects: vitest.projects
      .filter((project) => !project.isRootProject())
      .map((project) => ({ name: project.name, exclude: [...project.config.exclude] })),
  };
}

/**
 * Lists a config's files through the vitest node API, with what it resolved of the config's
 * `exclude`. A failed listing falls back to the CLI, which starts from a clean process.
 *
 * @param root - The config's directory.
 * @param config - The config's absolute path.
 * @returns The collected files and the resolved excludes, or the error vitest raised.
 */
const listWithNodeApi: VitestListing = (root, config) =>
  withVitest(root, config, async (vitest) => {
    const specs = await vitest.globTestSpecifications();
    return {
      specs: specs.map((spec) => ({ file: spec.moduleId, project: spec.project.name })),
      excludes: excludesOf(vitest),
    };
  });

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
 * @description Lists a config's files through `vitest list --filesOnly --json`, in a child
 *   process.
 *
 * @param root - The config's directory.
 * @param config - The config's absolute path.
 * @param limits - Lower caps, for the self-tests only.
 * @returns The collected files with `excludes: null`, since the command prints no config, or why
 *   the command or its output failed.
 */
export async function listWithCli(
  root: string,
  config: string,
  limits: VitestListLimits = {}
): Promise<Result<ConfigListing, string>> {
  const timeoutMs = limits.timeoutMs ?? CLI_TIMEOUT_MS;
  const outputCapBytes = limits.outputCapBytes ?? CLI_OUTPUT_CAP_BYTES;
  const run = spawnSync(
    process.execPath,
    [vitestCliPath(), "list", "--filesOnly", "--json", "--config", config, "--root", root],
    { cwd: root, encoding: "utf8", timeout: timeoutMs, maxBuffer: outputCapBytes }
  );
  const code = run.error !== undefined && "code" in run.error ? run.error.code : undefined;
  if (code === "ETIMEDOUT") {
    return err(`vitest list for ${config} timed out after the ${String(timeoutMs)} ms cap`);
  }
  // spawnSync stops the child and reports ENOBUFS when a stream outgrows maxBuffer; its own
  // message names neither the cap nor the config.
  if (code === "ENOBUFS") {
    return err(
      `vitest list for ${config} printed more than the ${String(outputCapBytes)}-byte output cap`
    );
  }
  if (run.error !== undefined) {
    return err(`vitest list for ${config}: ${run.error.message}`);
  }
  if (run.status !== 0) {
    // spawnSync names a signal whenever it reports no status and no error, so the last arm only
    // keeps this message in step with the node collector's, whose recorded runs can omit both.
    const ending =
      run.status !== null
        ? `exited ${String(run.status)}`
        : run.signal !== null
          ? `was stopped by ${run.signal}`
          : "produced no exit status";
    const tail = run.stderr.trim().split("\n").slice(-3).join(" | ");
    return err(`vitest list ${ending}: ${tail}`);
  }
  const listed = parseListOutput(run.stdout);
  return listed.ok ? ok({ specs: listed.value, excludes: null }) : listed;
}

/**
 * Lists one config, falling back to the CLI when the node API fails.
 *
 * @param root - Absolute repository root.
 * @param config - Repository-relative config path.
 * @param strategies - The primary listing and its fallback.
 * @returns The listing that held, or both failures.
 */
async function listConfig(
  root: string,
  config: string,
  strategies: VitestStrategies
): Promise<Result<ConfigListing, string>> {
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

/** The vitest collector, which also keeps what it resolved of each config's `exclude`. */
export interface VitestCollector extends Collector {
  /**
   * @method resolvedExcludes
   * @description What the last `collect` resolved of the `exclude` of each config it listed.
   * @returns Repository-relative config path → its resolved excludes, or `null` for a config the
   *   CLI fallback listed. A config no listing held is absent, as is every config when `collect`
   *   has not run or stopped at the floor.
   */
  resolvedExcludes(): ReadonlyMap<string, ResolvedExcludes | null>;
}

/**
 * @description Builds the vitest collector.
 *
 * @param options - A smaller floor or replacement listings, for the self-tests only.
 * @returns The collector.
 */
export function createVitestCollector(options: VitestCollectorOptions = {}): VitestCollector {
  const floor = options.floor ?? VITEST_CONFIG_FLOOR;
  const strategies = options.strategies ?? { programmatic: listWithNodeApi, cli: listWithCli };
  const resolved = new Map<string, ResolvedExcludes | null>();
  return {
    id: COLLECTOR_ID.VITEST,
    async collect(context: CollectorContext): Promise<CollectorOutcome> {
      resolved.clear();
      const tracked = trackedConfigs(
        COLLECTOR_ID.VITEST,
        context,
        { pattern: VITEST_CONFIG, label: "vitest" },
        floor
      );
      if (!tracked.ok) return tracked.error;
      const { configs, root } = tracked.value;
      const collections: Collection[] = [];
      const failures: CollectorFailure[] = [];
      for (const config of configs) {
        const listed = await listConfig(root, config, strategies);
        if (!listed.ok) {
          failures.push({ collector: COLLECTOR_ID.VITEST, source: config, message: listed.error });
          continue;
        }
        resolved.set(config, listed.value.excludes);
        if (listed.value.specs.length === 0) {
          failures.push({
            collector: COLLECTOR_ID.VITEST,
            source: config,
            message: "collects no file; every tracked vitest config must collect at least one",
          });
          continue;
        }
        collections.push(...toCollections(root, config, listed.value.specs));
      }
      return { collections, failures };
    },
    resolvedExcludes: () => new Map(resolved),
  };
}

/**
 * @description Tells the vitest collector apart among the collectors a run was given, so the
 *   engine reads what that collector resolved instead of resolving every config a second time.
 * @param collector - Any collector.
 * @returns Whether it is the vitest collector and keeps the excludes it resolved.
 */
export function isVitestCollector(collector: Collector): collector is VitestCollector {
  return (
    collector.id === COLLECTOR_ID.VITEST &&
    "resolvedExcludes" in collector &&
    typeof collector.resolvedExcludes === "function"
  );
}
