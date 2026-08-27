/**
 * @file vitest.coverage-thresholds.ts
 * @description Supplies the shard-mode override for the coverage thresholds declared
 *              in vitest.config.ts. The threshold NUMBERS deliberately do NOT live
 *              here: `coverage.thresholds.autoUpdate` rewrites the vitest config file
 *              in place through an AST parse, and it refuses any config whose
 *              `test.coverage.thresholds` is not a literal object node — a value
 *              produced by a helper call throws
 *              "Unable to parse thresholds from configuration file" and fails the run
 *              (reproduced against vitest 4.1.10). This module therefore owns only the
 *              conditional half, applied as a trailing spread the AST rewrite ignores.
 * @layer infrastructure
 */

/**
 * Threshold values that make the gate unfalsifiable, plus the autoUpdate kill switch.
 * Used ONLY under sharding, where that is the correct answer rather than a hole: a
 * shard executes a fraction of the suite, so its coverage is partial by construction
 * and any floor above 0 would fail on work the shard was never asked to run. The
 * merged run re-reads the same config without VITEST_SHARDED and gates for real.
 */
interface ShardThresholdOverride {
  lines: 0;
  functions: 0;
  branches: 0;
  statements: 0;
  autoUpdate: false;
}

/**
 * @method shardedThresholdOverride
 * @description Returns the override that neutralises the coverage gate for a single
 *              shard, or an empty object for the merged/local run that gates for real.
 *              A shard executes only a fraction of the suite, so its coverage is
 *              partial by construction and any floor above 0 would fail on work the
 *              shard was never asked to do; the merge job re-runs the same config
 *              without `VITEST_SHARDED` and enforces the real floor once on the
 *              combined blobs. `autoUpdate: false` is part of the override because a
 *              shard must never write a ratcheted floor derived from partial data.
 * @param sharded - True when the run covers only one shard of the suite.
 * @returns The neutralising override per shard, or `{}` for the gating run.
 */
export function shardedThresholdOverride(
  sharded: boolean
): ShardThresholdOverride | Record<string, never> {
  if (!sharded) {
    return {};
  }

  return { lines: 0, functions: 0, branches: 0, statements: 0, autoUpdate: false };
}
