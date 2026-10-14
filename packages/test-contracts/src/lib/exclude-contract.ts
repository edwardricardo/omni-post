/**
 * @file exclude-contract.ts
 * @description Part C of the reach engine, the exclude contract: rule C2 holds the resolved
 *              `exclude` of every tracked vitest config to every pattern of
 *              `RESERVED_TIER_EXCLUDES`, the suffixes another tier's runner owns. A config built by
 *              `defineWorkspaceVitestConfig` carries them by construction. The four app configs
 *              (`apps/api`, `apps/workers`, `apps/admin`, `apps/client`) compose their own and
 *              spread the list by hand, and one that drops the spread collects a reserved-suffix
 *              file with nothing else to notice: R1 sees the harm only once that file is also
 *              collected by its own tier, as "collected 2 times".
 *
 *              The list C2 reads is the one vitest resolved, never the config's source text: the
 *              vitest collector keeps what the node API resolved of each config it lists, the root
 *              config's `exclude` and each project's, and C2 reads that. A project is held on its
 *              own, because an inline project that does not set `extends: true` resolves vitest's
 *              default `exclude` rather than the root's. Membership is exact: each reserved pattern
 *              must appear as written, which is what spreading the constant produces.
 *
 *              It fails closed like C1. Fewer tracked configs than {@link VITEST_CONFIG_FLOOR} is
 *              an error, and so is a config whose resolution C2 never saw: one the CLI fallback
 *              listed, since `vitest list` prints files and no config, or one the collector could
 *              not list at all. Nothing here reads a file or starts a process: the command line in
 *              `reach.ts` hands the collector's resolutions in.
 * @layer infrastructure
 */
import { RESERVED_TIER_EXCLUDES } from "@packages/vitest-shared";
import { RULE, type Violation } from "./rules.js";
import { VITEST_CONFIG, VITEST_CONFIG_FLOOR, type ResolvedExcludes } from "./vitest-collector.js";

/** What C2 found over every tracked vitest config. */
export interface ExcludeContractVerdict {
  /** The tracked vitest configs held to the contract. */
  readonly configs: number;
  readonly violations: readonly Violation[];
  /**
   * A scope below the floor, and the configs whose resolved exclude was never read; any one fails
   * the run.
   */
  readonly errors: readonly string[];
}

/**
 * The resolved lists of one config, each labelled the way a violation names it: the root config
 * by its path, a project by `<config>#<project>`, as the collector names a project's source.
 *
 * @param config - The repository-relative config path.
 * @param excludes - What the node API resolved of its `exclude`.
 * @returns The root config's list first, then each project's.
 */
function listsOf(
  config: string,
  excludes: ResolvedExcludes
): { readonly label: string; readonly exclude: readonly string[] }[] {
  return [
    { label: config, exclude: excludes.root },
    ...excludes.projects.map((project) => ({
      label: project.name === "" ? config : `${config}#${project.name}`,
      exclude: project.exclude,
    })),
  ];
}

/**
 * @description Holds the resolved `exclude` of every tracked vitest config, its root config's and
 *   each project's, to every pattern of `RESERVED_TIER_EXCLUDES`.
 * @param tracked - Every tracked file, repository-relative.
 * @param resolved - Config → what the vitest collector resolved of its `exclude`, or `null` for a
 *   config the CLI fallback listed; a config the collector did not list is absent.
 * @param floor - The fewest tracked configs the scope may hold; the self-tests lower it for a
 *   planted tree, as they lower C1's.
 * @returns The configs held to the contract, one C2 violation per list that lacks a reserved
 *   pattern, naming every pattern it lacks, and the errors: a scope below the floor and the configs
 *   whose resolved exclude was not read.
 */
export function checkExcludeContract(
  tracked: readonly string[],
  resolved: ReadonlyMap<string, ResolvedExcludes | null>,
  floor: number = VITEST_CONFIG_FLOOR
): ExcludeContractVerdict {
  const configs = tracked
    .filter((file) => VITEST_CONFIG.test(file))
    .sort((a, b) => a.localeCompare(b));
  const violations: Violation[] = [];
  const errors: string[] = [];
  if (configs.length < floor) {
    errors.push(
      `C2 saw ${String(configs.length)} vitest configs, below the floor of ${String(floor)}; ` +
        "the listing read less of the tree than it holds"
    );
  }
  for (const config of configs) {
    const excludes = resolved.get(config);
    if (excludes === undefined) {
      errors.push(
        `C2 ${config}: the vitest collector resolved no config for it, so its exclude was not read`
      );
      continue;
    }
    if (excludes === null) {
      errors.push(
        `C2 ${config}: listed through the CLI fallback, which resolves no config, ` +
          "so its exclude was not read"
      );
      continue;
    }
    for (const { label, exclude } of listsOf(config, excludes)) {
      const missing = RESERVED_TIER_EXCLUDES.filter((pattern) => !exclude.includes(pattern));
      if (missing.length === 0) continue;
      violations.push({
        rule: RULE.C2,
        file: label,
        message:
          `resolved exclude lacks ${missing.map((pattern) => JSON.stringify(pattern)).join(", ")} ` +
          "of RESERVED_TIER_EXCLUDES, so vitest can collect a file another tier's runner owns",
      });
    }
  }
  return { configs: configs.length, violations, errors };
}
