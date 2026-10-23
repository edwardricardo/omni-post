// @ts-check
/**
 * @file ledger-core.mjs
 * @description The pure core of the test ledger: the shape a path takes. It spawns nothing,
 *   writes nothing and reads no file; the command that lists the tree, runs the reach engine
 *   and the classifier and writes `ledger.json` builds on these functions.
 * @layer infrastructure
 */

/** The version of the ledger's JSON; a change of a row's shape raises it. */
export const LEDGER_VERSION = 1;

/**
 * The paths a decision keeps out of every delete slice, each mapped to the decision's id. D17
 * (`docs/development/TESTING_REFOUNDATION.md:360`, `TESTING_REFOUNDATION_PLAN.md:946-947`): the two
 * seed scripts are command-line tools with no importer, which is normal for them, and wait on a
 * product classification; their verdict is ADJUDICATE whatever their blocks, never DELETE.
 * @type {Readonly<Record<string, string>>}
 */
export const EXCLUDED_BY_DECISION = Object.freeze({
  "apps/api/scripts/seed-demo-data.ts": "D17",
  "apps/api/scripts/seed-large-dataset.ts": "D17",
});

/**
 * A basename that names a test by convention, `.k6.js` being a tier of its own. It must stay
 * byte-equal to `CANONICAL_TEST_SHAPED` in `scripts/testing/metrics.mjs:45`, which defines metric
 * M1, and in `packages/test-contracts/src/lib/disk.ts:23`, the reach engine's: the ledger's
 * test-shaped population is M1's by construction. `ledger.test.ts` reads all three and fails on a
 * drift. Anchored at the end, so a `.disabled`, `.old` or `.bak` tail is not test-shaped.
 */
export const CANONICAL_TEST_SHAPED = /(\.(test|spec)\.[cm]?[jt]sx?|\.k6\.js)$/;

/**
 * The shapes a row may take. The first five are test-shaped; `runner` is `tests/run*.ts`;
 * `helper` is a `.ts`, `.tsx` or `.js` file under a `tests/`, `__tests__/` or `test/` directory,
 * or under `security/` or `performance/`, that is none of the others; `disabled` is any of them
 * with a `.disabled`, `.old` or `.bak` tail.
 * @typedef {"test" | "integration-test" | "live-test" | "spec" | "k6" | "runner" | "helper" | "disabled"} Shape
 */

const DEAD_TAIL = /\.(disabled|old|bak)$/;
const INTEGRATION = /\.integration\.test\.[cm]?[jt]sx?$/;
const LIVE = /\.live\.test\.[cm]?[jt]sx?$/;
const SPEC = /\.spec\.[cm]?[jt]sx?$/;
const K6 = /\.k6\.js$/;
const RUNNER = /(^|\/)tests\/run[^/]*\.ts$/;
const HELPER_EXTENSION = /\.(ts|tsx|js)$/;
const TEST_DIRECTORY = /(^|\/)(tests|__tests__|test)\//;
const SUITE_ROOT = /^(security|performance)\//;

/**
 * @description Names the shape of a ledger candidate. Test-shaped is `CANONICAL_TEST_SHAPED`; a
 *   `.disabled`, `.old` or `.bak` tail is `disabled` when the path without it has a shape. Which
 *   directories are listed at all (the workspaces, `security/`, `performance/`) is the listing's
 *   choice, not this function's.
 * @param {string} file Repository-relative, with `/` separators.
 * @returns {Shape | null} The shape, or `null` when the path is not a ledger candidate.
 */
export function shapeOf(file) {
  const tail = DEAD_TAIL.exec(file);
  if (tail !== null) return shapeOf(file.slice(0, tail.index)) === null ? null : "disabled";
  if (CANONICAL_TEST_SHAPED.test(file)) {
    if (INTEGRATION.test(file)) return "integration-test";
    if (LIVE.test(file)) return "live-test";
    if (SPEC.test(file)) return "spec";
    if (K6.test(file)) return "k6";
    return "test";
  }
  if (RUNNER.test(file)) return "runner";
  const underTests = TEST_DIRECTORY.test(file) || SUITE_ROOT.test(file);
  return underTests && HELPER_EXTENSION.test(file) ? "helper" : null;
}
