/**
 * @file node-collector.ts
 * @description The node:test collector of the reach engine. `apps/api/scripts/run-tests.sh`
 *              selects the node:test files, and its `--list` mode prints what it selects, one
 *              `<kind>\t<path>` line per file: `<kind>` is `integration`, `live` or
 *              `quarantined`, and `<path>` is relative to the runner's package, the way the
 *              runner names its files. `integration` and `live` lines are collected, one
 *              collection per kind. A `quarantined` line is a file the runner knows and does not
 *              run, so no source collects it and it reaches the verdict through the quarantine.
 *
 *              It fails closed on a runner that cannot be started, times out or exits non-zero,
 *              on a listing with no line, a line that is not `<kind>\t<path>`, an unknown kind, a
 *              path listed twice or one that is not a tracked file (a listing that names paths
 *              from another base), and on a listing that collects no file.
 *
 *              The runner starts with `DATABASE_URL` and `TIER` removed from its environment.
 *              Listing needs no database, and the full inventory is the listing of no tier; a
 *              runner that does not know `--list` then stops at its own empty-database guard
 *              instead of running every suite against the database the caller exported.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { err, ok, type Result } from "@shared/types";
import {
  COLLECTOR_ID,
  describeError,
  type Collection,
  type Collector,
  type CollectorContext,
  type CollectorOutcome,
} from "./registry.js";

/** The runner's package, repository-relative, and its script, relative to that package. */
export const NODE_RUNNER = { packageDir: "apps/api", script: "scripts/run-tests.sh" } as const;

/** The kinds a `--list` line can carry. */
const NODE_KIND = {
  INTEGRATION: "integration",
  LIVE: "live",
  QUARANTINED: "quarantined",
} as const;

/** A listing kind, derived from {@link NODE_KIND}. */
type NodeKind = (typeof NODE_KIND)[keyof typeof NODE_KIND];

/** The kinds whose files the runner runs, in the order their collections are reported. */
const COLLECTED_KINDS: readonly NodeKind[] = [NODE_KIND.INTEGRATION, NODE_KIND.LIVE];

/** The time one `--list` run may take before it is stopped and reported. */
const LIST_TIMEOUT_MS = 60_000;

/** One line of the listing: its kind and its repository-relative path. */
export interface ListedFile {
  readonly kind: NodeKind;
  readonly file: string;
}

/** What one run of the runner produced. */
export interface RunnerRun {
  readonly status: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Why the runner could not be started or was stopped, when it was. */
  readonly error?: string;
}

/**
 * One way to run `<script> --list`.
 *
 * @param packageDirectory - The runner's absolute package directory, its working directory.
 * @returns What the run produced; never a thrown error.
 */
type RunList = (packageDirectory: string) => RunnerRun;

/** Overrides for the self-tests: a recorded run, or a shorter time cap. */
export interface NodeCollectorOptions {
  readonly run?: RunList;
  readonly timeoutMs?: number;
}

/**
 * @param value - The kind text of one line.
 * @returns Whether it is a kind the listing may carry.
 */
function isNodeKind(value: string): value is NodeKind {
  return Object.values<string>(NODE_KIND).includes(value);
}

/**
 * Reads the `--list` output: every line `<kind>\t<path>`, each path once.
 *
 * @param stdout - The runner's standard output.
 * @param packageDir - The runner's repository-relative package, the base of every path.
 * @returns The listed files with repository-relative paths, or why the output is not a listing.
 */
export function parseRunnerList(stdout: string, packageDir: string): Result<ListedFile[], string> {
  if (stdout === "" || stdout === "\n") return err("--list printed no line");
  const lines = (stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout).split("\n");
  const listed: ListedFile[] = [];
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const where = `--list line ${String(index + 1)}`;
    const match = /^([^\t]+)\t([^\t]+)$/.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) {
      return err(`${where} is not "<kind>\\t<path>": ${JSON.stringify(line)}`);
    }
    const kind = match[1];
    const relative = match[2];
    if (!isNodeKind(kind)) return err(`${where} carries the unknown kind "${kind}"`);
    if (path.posix.isAbsolute(relative)) return err(`${where} names an absolute path`);
    const file = path.posix.normalize(path.posix.join(packageDir, relative));
    if (seen.has(file)) return err(`${where} lists ${file} a second time`);
    seen.add(file);
    listed.push({ kind, file });
  }
  return ok(listed);
}

/**
 * Runs `<script> --list` in a child process, without the database and tier variables.
 *
 * @param packageDirectory - The runner's absolute package directory.
 * @param timeoutMs - How long the runner may take before it is stopped.
 * @returns What the run produced.
 */
function runListWithBash(packageDirectory: string, timeoutMs: number): RunnerRun {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.TIER;
  const run = spawnSync("bash", [NODE_RUNNER.script, "--list"], {
    cwd: packageDirectory,
    env,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  const stopped =
    run.error !== undefined && "code" in run.error && run.error.code === "ETIMEDOUT"
      ? `timed out after the ${String(timeoutMs)} ms cap`
      : run.error?.message;
  return {
    status: run.status,
    signal: run.signal,
    stdout: run.stdout,
    stderr: run.stderr,
    ...(stopped !== undefined && { error: stopped }),
  };
}

/**
 * @param run - What the runner produced.
 * @returns Why the run cannot be read as a listing, or `null` when it can.
 */
function runFailure(run: RunnerRun): string | null {
  if (run.error !== undefined) return `--list could not run: ${run.error}`;
  if (run.status === 0) return null;
  const ending =
    run.status === null ? `was stopped by ${String(run.signal)}` : `exited ${String(run.status)}`;
  const tail = run.stderr.trim().split("\n").slice(-3).join(" | ");
  return `--list ${ending}: ${tail}`;
}

/**
 * Builds the node:test collector.
 *
 * @param options - A recorded run or a shorter cap, for the self-tests only.
 * @returns The collector.
 */
export function createNodeCollector(options: NodeCollectorOptions = {}): Collector {
  const timeoutMs = options.timeoutMs ?? LIST_TIMEOUT_MS;
  const run = options.run ?? ((directory: string) => runListWithBash(directory, timeoutMs));
  const source = `${NODE_RUNNER.packageDir}/${NODE_RUNNER.script}`;
  const fail = (message: string): CollectorOutcome => ({
    collections: [],
    failures: [{ collector: COLLECTOR_ID.NODE, source, message }],
  });
  return {
    id: COLLECTOR_ID.NODE,
    collect(context: CollectorContext): Promise<CollectorOutcome> {
      let produced: RunnerRun;
      try {
        produced = run(path.join(context.root, NODE_RUNNER.packageDir));
      } catch (error: unknown) {
        return Promise.resolve(fail(`--list could not run: ${describeError(error)}`));
      }
      const failure = runFailure(produced);
      if (failure !== null) return Promise.resolve(fail(failure));
      const parsed = parseRunnerList(produced.stdout, NODE_RUNNER.packageDir);
      if (!parsed.ok) return Promise.resolve(fail(parsed.error));
      const tracked = new Set(context.tracked);
      const untracked = parsed.value.filter(({ file }) => !tracked.has(file));
      if (untracked.length > 0) {
        const named = untracked.slice(0, 3).map(({ file }) => file);
        return Promise.resolve(
          fail(
            `--list names ${String(untracked.length)} paths that are not tracked files: ` +
              `${named.join(", ")}${untracked.length > named.length ? ", …" : ""}`
          )
        );
      }
      const collections: Collection[] = COLLECTED_KINDS.map((kind) => ({
        collector: COLLECTOR_ID.NODE,
        source: `${source}#${kind}`,
        files: parsed.value
          .filter((listed) => listed.kind === kind)
          .map(({ file }) => file)
          .sort(),
      })).filter((collection) => collection.files.length > 0);
      if (collections.length === 0) {
        return Promise.resolve(fail("--list collects no file; the runner must run at least one"));
      }
      return Promise.resolve({ collections, failures: [] });
    },
  };
}
