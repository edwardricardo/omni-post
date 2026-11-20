// @ts-check
/**
 * @file git-environment.mjs
 * @description The environment a gate runs `git` in. A git hook exports `GIT_DIR`,
 *   `GIT_WORK_TREE` and `GIT_INDEX_FILE` to everything it starts, and each of them points git at a
 *   repository, a work tree or an index other than the one the gate's root holds: a gate run from
 *   a hook, or from a shell that exported one of them, would list, diff and show another tree and
 *   judge it as the root's. The gates that read git drop the three, so git finds the repository
 *   from the root it runs in. It imports nothing, so a gate that must load no package can use it.
 * @layer infrastructure
 */

/** The git variables that point git at a repository other than the one the root holds. */
export const FOREIGN_GIT_VARIABLES = Object.freeze(["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]);

/**
 * @description The environment for a `git` call, without the variables that would point it at
 *   another repository.
 * @param {NodeJS.ProcessEnv} [environment] The environment to start from; the process's own by
 *   default.
 * @returns {NodeJS.ProcessEnv} A copy of it without `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE`.
 */
export function gitEnvironment(environment = process.env) {
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => !FOREIGN_GIT_VARIABLES.includes(key))
  );
}
