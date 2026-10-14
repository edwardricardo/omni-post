/**
 * @file scopes.ts
 * @description The scope contract, fitness #36: every positive glob a tracked vitest config
 *              scopes with matches at least one tracked file. A glob that matches nothing is a
 *              scope reporting green over code it never read: a suite that collects nothing from
 *              it, or a coverage floor measured over no file. For each tracked `vitest.config.*`
 *              it asks vitest itself, through the node API, for the resolved config, so the globs
 *              it checks are the ones a run applies: the shared factory's merge, `projects`, and
 *              vitest's defaults included. It reads two scopes: the `test.include` of every
 *              project, relative to the project's directory, and the root config's
 *              `coverage.include`, relative to its root, wherever the config sets one.
 *
 *              A negation is not a scope, so it is never checked: an exclusion that matches
 *              nothing is inert, and flagging it would teach authors to delete real exclusions.
 *              A glob is a negation the way tinyglobby, vitest's globber, reads one: a leading
 *              `!` not followed by `(`. Matching is Node's `path.matchesGlob` over the tracked
 *              files, which agrees with vitest's picomatch on the forms the tree uses (`**`,
 *              braces, extglobs, classes) and is the stricter of the two on dot-named segments:
 *              its wildcards skip them, so a glob whose only files sit under a dot-named
 *              directory reached by a wildcard reads as dead, a false red and never a false green.
 *
 *              It fails closed: below {@link VITEST_CONFIG_FLOOR} tracked configs, on a config
 *              vitest cannot resolve, and on a scope that holds no positive glob. A verdict over a
 *              config it did not resolve is not a verdict.
 * @layer infrastructure
 */
import path from "node:path";
import type { Vitest } from "vitest/node";
import { COLLECTOR_ID, sourceLabel, trackedConfigs } from "./registry.js";
import { VITEST_CONFIG, VITEST_CONFIG_FLOOR, withVitest } from "./vitest-collector.js";

/** The rule every scope violation carries: a scope that matches no tracked file. */
export const SCOPE_RULE = "S1";

/** The two config keys this contract reads. */
type ScopeKey = "test.include" | "coverage.include";

/** One glob list of a resolved config, and the directory its globs resolve against. */
export interface Scope {
  /** Repository-relative config path, suffixed `#<project>` for a named project's `test.include`. */
  readonly source: string;
  readonly key: ScopeKey;
  /** The absolute directory the globs are relative to. */
  readonly cwd: string;
  readonly globs: readonly string[];
}

/** One scope that matches no tracked file. */
export interface ScopeViolation {
  readonly rule: typeof SCOPE_RULE;
  readonly source: string;
  readonly message: string;
}

/** The outcome of one check. */
export interface ScopesReport {
  readonly ok: boolean;
  /** Tracked vitest configs. */
  readonly configs: number;
  /** Configs vitest resolved. */
  readonly resolved: number;
  /** Positive globs checked, across every scope. */
  readonly globs: number;
  readonly violations: readonly ScopeViolation[];
  /** Inputs the check could not read in full; any one fails it. */
  readonly errors: readonly string[];
}

/** Overrides for the self-tests: a smaller floor for a planted tree. */
export interface ScopeCheckOptions {
  readonly floor?: number;
}

/**
 * @param glob - One glob of a scope.
 * @returns Whether tinyglobby reads it as an include rather than a negation.
 */
function isPositive(glob: string): boolean {
  return !glob.startsWith("!") || glob.startsWith("!(");
}

/**
 * Reads the scopes of a resolved vitest instance: each project's `test.include`, and the root
 * config's `coverage.include` when it sets one. A project collects from its `dir` when it sets
 * one, else from its root, which is how vitest globs its test files.
 *
 * @param vitest - The open instance.
 * @param config - The repository-relative config path.
 * @returns The scopes, projects first.
 */
function scopesOf(vitest: Vitest, config: string): Scope[] {
  const scopes: Scope[] = vitest.projects.map((project) => ({
    source: project.name === "" ? config : `${config}#${project.name}`,
    key: "test.include",
    // `||`, not `??`: vitest itself treats an empty `dir` as unset (`dir || root`).
    cwd: project.config.dir || project.config.root,
    globs: project.config.include,
  }));
  const coverage = vitest.config.coverage.include;
  if (Array.isArray(coverage)) {
    scopes.push({
      source: config,
      key: "coverage.include",
      cwd: vitest.config.root,
      globs: coverage,
    });
  }
  return scopes;
}

/**
 * Lists the tracked files a glob of one directory can match, relative to that directory. A glob
 * that names no `..` segment cannot leave its directory, since `**` never climbs, so only the
 * files inside it are candidates; a glob that names one is matched against every tracked file.
 * Narrowing the candidates keeps a run over the whole tree from matching each glob against every
 * tracked path of the repository.
 *
 * The cache is keyed by the directory and by that one bit, whether the glob names `..`, and never
 * by the glob: the candidate list depends on nothing else, so every glob of a directory scans the
 * same list and only the match differs. A narrowing that came to depend on the glob itself (a
 * static prefix, say) would have to add the glob to the key.
 *
 * @param root - Absolute repository root, the base of the tracked paths.
 * @param tracked - Every tracked file, repository-relative.
 * @returns A lookup from a directory and a normalised glob to its candidate files, cached per
 *   directory and per side of the `..` bit.
 */
function candidateFiles(
  root: string,
  tracked: readonly string[]
): (cwd: string, pattern: string) => readonly string[] {
  const inside = new Map<string, string[]>();
  const everywhere = new Map<string, string[]>();
  return (cwd, pattern) => {
    const reachesOut = pattern.includes("..");
    const cache = reachesOut ? everywhere : inside;
    const cached = cache.get(cwd);
    if (cached !== undefined) return cached;
    const base = path.relative(root, cwd).split(path.sep).join("/");
    let files: string[];
    if (reachesOut) {
      files = tracked.map((file) =>
        path.relative(cwd, path.join(root, file)).split(path.sep).join("/")
      );
    } else if (base === "") {
      files = [...tracked];
    } else {
      files = tracked
        .filter((file) => file.startsWith(`${base}/`))
        .map((file) => file.slice(base.length + 1));
    }
    cache.set(cwd, files);
    return files;
  };
}

/**
 * @description Holds every scope against the tracked files: each positive glob must match at
 *   least one of them, and each scope must hold at least one positive glob. A glob is normalised
 *   the way tinyglobby normalises it (an absolute glob made relative to the scope's directory, a
 *   leading `./` and a trailing `/` dropped) and matched against each tracked file's path
 *   relative to that directory, so a `../` glob reaches files outside it.
 * @param root - Absolute repository root, the base of the tracked paths.
 * @param scopes - The scopes of every resolved config.
 * @param tracked - Every tracked file, repository-relative.
 * @returns How many positive globs were checked, and every scope that matches nothing.
 */
export function checkScopes(
  root: string,
  scopes: readonly Scope[],
  tracked: readonly string[]
): { globs: number; violations: ScopeViolation[] } {
  const candidates = candidateFiles(root, tracked);
  let globs = 0;
  const violations: ScopeViolation[] = [];
  for (const scope of scopes) {
    const positive = scope.globs.filter(isPositive);
    if (positive.length === 0) {
      violations.push({
        rule: SCOPE_RULE,
        source: scope.source,
        message: `${scope.key} holds no positive glob, so it scopes no file`,
      });
      continue;
    }
    for (const glob of positive) {
      globs += 1;
      const pattern = normalizeGlob(glob, scope.cwd);
      if (candidates(scope.cwd, pattern).some((file) => path.matchesGlob(file, pattern))) continue;
      violations.push({
        rule: SCOPE_RULE,
        source: scope.source,
        message: `dead positive glob ${JSON.stringify(glob)} in ${scope.key}: it matches no tracked file`,
      });
    }
  }
  return { globs, violations };
}

/**
 * Normalises a glob the way tinyglobby 0.2.17's `normalizePattern` does before it crawls: an
 * absolute glob is made relative to the directory, any other goes through `path.posix.normalize`,
 * which drops `./` and empty segments and folds an interior `..` into the segment before it, and a
 * trailing `/` is dropped. Measured on 2026-10-14 against the tinyglobby copy vitest 4.1.11 ships,
 * over a planted tree: `a/./b/*`, `foo/../bar/*` with no `foo`, `a/b/../../c/*`,
 * `../shared/v/../*`, `a//b/*`, `**` followed by `..` and `bar/../a/*` matched the same files both
 * ways, 12 globs (the last one matching nothing either way) and no disagreement.
 *
 * @param glob - A positive glob as the config wrote it.
 * @param cwd - The directory it resolves against.
 * @returns The glob relative to `cwd`, `/`-separated, with no `./` segment, no interior `..` and
 *   no trailing `/`.
 */
function normalizeGlob(glob: string, cwd: string): string {
  const relative = path.isAbsolute(glob)
    ? path.relative(cwd, glob).split(path.sep).join("/")
    : path.posix.normalize(glob);
  return relative.endsWith("/") ? relative.slice(0, -1) : relative;
}

/**
 * @description Runs the scope contract over every tracked vitest config: resolve each one with
 *   vitest, then hold every scope it declares against the tracked files.
 * @param root - Absolute repository root.
 * @param tracked - Every tracked file that exists, repository-relative.
 * @param options - A smaller floor, for the self-tests only.
 * @returns The report; nothing is thrown.
 */
export async function checkScopeContract(
  root: string,
  tracked: readonly string[],
  options: ScopeCheckOptions = {}
): Promise<ScopesReport> {
  // One count for both outcomes: the tracked files whose name is a vitest config, the set the
  // floor is held against and, past it, the set this check resolves.
  const configCount = tracked.filter((file) => VITEST_CONFIG.test(file)).length;
  const configs = trackedConfigs(
    COLLECTOR_ID.VITEST,
    { root, tracked },
    { pattern: VITEST_CONFIG, label: "vitest" },
    options.floor ?? VITEST_CONFIG_FLOOR
  );
  if (!configs.ok) {
    return {
      ok: false,
      configs: configCount,
      resolved: 0,
      globs: 0,
      violations: [],
      errors: configs.error.failures.map(
        (failure) => `${sourceLabel(failure)}: ${failure.message}`
      ),
    };
  }
  const realRoot = configs.value.root;
  const errors: string[] = [];
  const scopes: Scope[] = [];
  let resolved = 0;
  for (const config of configs.value.configs) {
    const absolute = path.join(realRoot, config);
    const read = await withVitest(path.dirname(absolute), absolute, (vitest) =>
      scopesOf(vitest, config)
    );
    if (!read.ok) {
      errors.push(`${config}: does not resolve: ${read.error}`);
      continue;
    }
    resolved += 1;
    scopes.push(...read.value);
  }
  const checked = checkScopes(realRoot, scopes, tracked);
  return {
    ok: errors.length === 0 && checked.violations.length === 0,
    configs: configCount,
    resolved,
    globs: checked.globs,
    violations: checked.violations,
    errors,
  };
}
