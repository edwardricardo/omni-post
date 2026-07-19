/**
 * @file vitest.coverage-thresholds.ts
 * @description Builds the v8 coverage threshold object for apps/api unit tests.
 *              When the suite is sharded across CI jobs each shard runs only a
 *              fraction of the tests, so applying thresholds per shard would fail
 *              on partial coverage. In that mode this returns `undefined` (no
 *              gating) and the merged run enforces the floor instead. The default
 *              (merge step + local runs) keeps the global floor: lines/functions
 *              55, statements 54, branches 45.
 * @layer infrastructure
 */

interface CoverageScopeThresholds {
  lines: number;
  functions: number;
  branches: number;
  statements: number;
}

interface CoverageThresholds extends CoverageScopeThresholds {
  perFile: boolean;
  "src/domain/**/*.ts": CoverageScopeThresholds;
  "src/application/**/*.ts": CoverageScopeThresholds;
}

const GLOBAL_FLOOR: CoverageScopeThresholds = {
  // Global floor — fails CI on any regression below the current baseline.
  lines: 55,
  functions: 55,
  branches: 45,
  // Re-baselined 55 -> 54: removing the never-wired CQRSIntegration scaffolding and
  // its ~2160 lines of tests (PR #128) stripped artificial statement coverage that had
  // padded this floor; 54.98% is the real live-code figure. Raise this back as
  // live-code coverage improves (re-baseline authorized by Edward, 2026-07-19).
  statements: 54,
};

/**
 * @method buildCoverageThresholds
 * @description Returns the coverage thresholds for the unit suite, or `undefined`
 *              when sharding is active so per-shard partial coverage is not gated.
 * @param sharded - True when the run covers only one shard of the suite.
 * @returns The threshold object for the merged/local run, or `undefined` per shard.
 */
export function buildCoverageThresholds(sharded: boolean): CoverageThresholds | undefined {
  if (sharded) {
    return undefined;
  }

  return {
    ...GLOBAL_FLOOR,
    // Per-scope override keys keep the per-scope structure in place ready for the
    // ratchet (domain 90 / application 85 / infra 70) without breaking CI today.
    perFile: false,
    "src/domain/**/*.ts": { ...GLOBAL_FLOOR },
    "src/application/**/*.ts": { ...GLOBAL_FLOOR },
  };
}
