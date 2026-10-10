/**
 * @file registry.ts
 * @description The collector contract of the reach engine. A collector answers one question —
 *              which tracked files does each of my sources run — and reports it as data: a list of
 *              collections (one per source: a vitest config, a project inside one) and a list of
 *              failures. A collector never throws and never decides a verdict; the engine's rules
 *              read the merged outcome. Adding a collector is adding an id below and an object
 *              that satisfies {@link Collector}: nothing here changes shape, because the merge and
 *              the tally are keyed by id and source, not by collector kind. The module also hosts
 *              the helpers the collectors share: {@link describeError}, which every collector and
 *              the disk listing use to turn a caught value into the text of a failure, and
 *              {@link trackedConfigs}, which holds a config-driven collector to its floor and
 *              resolves the real root its listed paths are made relative to.
 * @layer infrastructure
 */
import { realpathSync } from "node:fs";
import { err, ok, type Result } from "@shared/types";

/**
 * Every collector the engine knows, by id. The id prefixes each source in the tally, so two
 * collectors that happen to name the same source path stay distinct.
 */
export const COLLECTOR_ID = {
  VITEST: "vitest",
  NODE: "node",
  K6: "k6",
} as const;

/** A collector id, derived from {@link COLLECTOR_ID}. */
type CollectorId = (typeof COLLECTOR_ID)[keyof typeof COLLECTOR_ID];

/** The files one source of one collector runs. */
export interface Collection {
  readonly collector: CollectorId;
  /** Repository-relative source path, suffixed `#<project>` when a config declares projects. */
  readonly source: string;
  /** Repository-relative, `/`-separated file paths, each listed once. */
  readonly files: readonly string[];
}

/** A source a collector could not read, or a floor it did not reach. */
export interface CollectorFailure {
  readonly collector: CollectorId;
  readonly source: string;
  readonly message: string;
}

/** Everything a collector, or the whole registry, reports. */
export interface CollectorOutcome {
  readonly collections: readonly Collection[];
  readonly failures: readonly CollectorFailure[];
}

/** What a collector may read. */
export interface CollectorContext {
  /** Absolute repository root. */
  readonly root: string;
  /** Every tracked path that exists in the working tree, repository-relative and sorted. */
  readonly tracked: readonly string[];
}

/** One collector: an id and a way to collect. */
export interface Collector {
  readonly id: CollectorId;
  /**
   * @method collect
   * @description Lists the files every source of this collector runs.
   * @param context - The repository root and its tracked files.
   * @returns The collections and the failures, never a thrown error.
   */
  collect(context: CollectorContext): Promise<CollectorOutcome>;
}

/**
 * Runs every collector in order and merges what they report. Collectors run one after another:
 * the vitest collector starts a vitest instance per config, and running them side by side buys
 * little while making their console output and their process listeners interleave.
 *
 * @param collectors - The collectors to run; two with the same id are a failure, not a merge.
 * @param context - The repository root and its tracked files.
 * @returns Every collection and every failure, in collector order.
 */
export async function runCollectors(
  collectors: readonly Collector[],
  context: CollectorContext
): Promise<CollectorOutcome> {
  const collections: Collection[] = [];
  const failures: CollectorFailure[] = [];
  const seen = new Set<CollectorId>();
  for (const collector of collectors) {
    if (seen.has(collector.id)) {
      failures.push({
        collector: collector.id,
        source: "(registry)",
        message: `collector id "${collector.id}" is registered twice`,
      });
      continue;
    }
    seen.add(collector.id);
    const outcome = await collector.collect(context);
    collections.push(...outcome.collections);
    failures.push(...outcome.failures);
  }
  return { collections, failures };
}

/**
 * Turns a caught value into the text a failure carries. Everything this engine reads can fail
 * with something that is not an `Error` (a child process, a parsed file), so the narrowing lives
 * in one place.
 *
 * @param error - The caught value.
 * @returns Its message, or its string form.
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What a config-driven collector reads before it lists anything. */
interface TrackedConfigs {
  /** The tracked configs, repository-relative. */
  readonly configs: string[];
  /** The real path of the repository root. */
  readonly root: string;
}

/**
 * Selects the tracked configs of a config-driven collector, held to its floor, and resolves the
 * real path of the root. The tools report each file by its real path, so the root those paths
 * are made relative to must be real too; otherwise a root reached through a symbolic link yields
 * `../` paths that match no tracked file.
 *
 * @param collector - The collector, for its failures.
 * @param context - The repository root and its tracked files.
 * @param config - What a tracked config's name matches, and what to call it in a failure.
 * @param floor - The fewest tracked configs the tree may hold.
 * @returns The configs and the real root, or the outcome that reports why there are none.
 */
export function trackedConfigs(
  collector: CollectorId,
  context: CollectorContext,
  config: { readonly pattern: RegExp; readonly label: string },
  floor: number
): Result<TrackedConfigs, CollectorOutcome> {
  const fail = (source: string, message: string) =>
    err({ collections: [], failures: [{ collector, source, message }] });
  const configs = context.tracked.filter((file) => config.pattern.test(file));
  if (configs.length < floor) {
    return fail(
      "(tracked configs)",
      `${String(configs.length)} tracked ${config.label} configs, below the floor of ` +
        `${String(floor)}; the listing read less of the tree than it holds`
    );
  }
  try {
    return ok({ configs, root: realpathSync(context.root) });
  } catch (error: unknown) {
    return fail(context.root, `cannot resolve the root: ${describeError(error)}`);
  }
}

/**
 * The label a source carries in a verdict, `<collector>:<source>`, for a collection and for a
 * failure alike.
 *
 * @param origin - The collector and source to label.
 * @returns The label.
 */
export function sourceLabel(origin: Pick<Collection, "collector" | "source">): string {
  return `${origin.collector}:${origin.source}`;
}

/**
 * Maps every collected file to the labels of the sources that collect it.
 *
 * @param collections - Every collection of every collector.
 * @returns File → sorted source labels, one entry per collecting source.
 */
export function tallyReach(collections: readonly Collection[]): Map<string, string[]> {
  const reach = new Map<string, string[]>();
  for (const collection of collections) {
    const label = sourceLabel(collection);
    for (const file of collection.files) {
      const sources = reach.get(file) ?? [];
      sources.push(label);
      reach.set(file, sources);
    }
  }
  for (const sources of reach.values()) sources.sort();
  return reach;
}
