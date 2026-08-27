/**
 * @file vitest.config.ts
 * @description Vitest configuration for apps/api unit tests.
 *              Collects tests/unit/** and tests/eval/** (the `include` globs below
 *              are the authority) — integration and flow tests remain
 *              on node:test via scripts/run-tests.sh. The workspace `resolve.alias`
 *              map is derived from `tsconfig.base.json` via the shared
 *              `buildWorkspaceAliases` factory (single source of truth shared with
 *              every package config) so it cannot drift from the canonical paths.
 * @layer infrastructure
 */
import { defineConfig } from "vitest/config";
import { shardedThresholdOverride } from "./vitest.coverage-thresholds.js";
import { buildWorkspaceAliases, findMonorepoRoot } from "../../vitest.shared.js";

// When CI shards the suite across jobs, each shard runs only part of the tests,
// so coverage thresholds are neutralised per shard and enforced once on the merged
// blobs in the coverage-merge job. Local and merge runs keep the full thresholds.
const sharded = process.env.VITEST_SHARDED === "true";

const root = findMonorepoRoot(__dirname);

export default defineConfig({
  resolve: {
    // Derived from tsconfig.base.json paths (single source shared with every
    // package config). Covers @core/*, @adapters/*, @ports/*, @shared/*,
    // @providers/*, @observability/*, @monitoring/*, and the @infra/prisma
    // test-only entry — no hand-maintained duplicate.
    alias: buildWorkspaceAliases(root),
    // Prisma 7 generated client has both client.ts (Node) and browser.ts.
    // Force Vite to use the Node condition so it picks client.ts.
    // See: https://github.com/prisma/prisma/issues/27627
    conditions: ["node"],
  },
  test: {
    environment: "node",
    globals: true,
    // A committed `.only()` silently skips the rest of the suite. Fail the run
    // instead of shipping a partial suite (canon: "Zero .only() committed").
    forbidOnly: true,
    // Load `.env.test` BEFORE any test file's transitive import reaches
    // `apps/api/src/config/env.ts` and triggers Zod validation. Replaces the
    // prior `test.env = { DATABASE_URL: dummy }` workaround, which fired too
    // late to satisfy the fail-fast env contract.
    setupFiles: ["./tests/setup-env.ts"],
    include: ["tests/unit/**/*.test.ts", "tests/eval/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    pool: "forks",
    // Serialize to a single fork. Each fork loads the full monorepo module
    // graph and, under v8 coverage, accumulates raw coverage for every file it
    // runs — so two forks were two full base processes whose combined RSS
    // intermittently tripped the OS OOM-killer on the CI runner (a fork got
    // SIGKILLed mid-run: "Worker exited unexpectedly", with every test still
    // passing). One fork removes a whole base process, keeping peak RSS to one
    // fork plus the orchestrator: slower (serial) but stable. Fallback if a
    // single fork still nears the ceiling: shard the run across CI jobs. (vitest
    // 4 dropped `poolOptions`; `maxWorkers` is the supported knob.)
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.spec.ts", "src/**/index.ts", "src/index.ts"],
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      // Coverage thresholds are enforced for unit tests only (tests/unit/** +
      // tests/eval/**); the node:test integration suites contribute coverage this
      // run never sees. Sharded runs neutralise the floor (see
      // shardedThresholdOverride); the merge step re-runs this same config without
      // VITEST_SHARDED and gates the combined blobs once.
      //
      // THE FOUR NUMBERS BELOW MUST STAY LITERALS ON THEIR OWN LINES. Two mechanisms
      // read the FILE rather than this object: `autoUpdate` rewrites the config
      // through an AST parse and throws "Unable to parse thresholds from configuration
      // file" on any `thresholds` that is not a literal object node (a helper call
      // fails the run outright — reproduced on vitest 4.1.10), and the fitness #37 diff
      // guard reads the top level of THIS block and fails closed unless it finds
      // exactly one literal per metric there. Extracting them into a helper "for
      // tidiness" silently breaks both. A per-scope block keyed by a glob is fine: it
      // nests one level deeper, and #37 ignores that depth on purpose.
      // tests/unit/config/coverageThresholds.test.ts pins that source shape AND — by
      // loading this config in both VITEST_SHARDED states — the values it resolves to,
      // because a floor that is not applied is a floor that is not there.
      //
      // The floor is the MEASURED value of this suite, floored to one decimal
      // (baseline 2026-08-27: statements 56.38, branches 47.93, functions 57.40,
      // lines 56.95 over 539 files / 8426 tests).
      //
      // It is a BEST-EFFORT ratchet, and the difference is worth stating because the
      // mechanism does not deliver more: the floor is the last measurement someone
      // COMMITTED, not the highest ever measured. `autoUpdate` rewrites this file
      // whenever a run measures above a floor, but CI's coverage-merge job does that
      // inside a container that is then discarded and nothing commits the result — so
      // a raise lands only when a developer runs
      // `pnpm --filter @apps/api test:unit:coverage` locally and commits the rewritten
      // file. What the floor does guarantee is one-directional: a run below it goes
      // red, and fitness #37 rejects a hand-lowered literal against the PR base.
      //
      // `functions` deliberately sits one decimal BELOW its measurement. Floored like
      // the rest it would be 57.4 against a measured 57.402645 (3125/5444) — 0.0026pp
      // of slack, while ONE function is 0.0184pp, seven times that margin. A floor
      // whose slack is thinner than one indivisible unit of its own metric can go red
      // with no code change at all: the CI runner tracks `node-version: "24"`, a
      // floating major, and V8's function-range counting shifts between releases.
      // 57.3 keeps ~5 functions of slack and still gates every real regression.
      //
      // A local coverage run WILL push this back up: `autoUpdate` fires whenever the
      // measurement is above the floor (57.402645 > 57.3), and it rewrites exactly
      // this line to 57.4 — observed, one-line diff, rest of the file untouched. Put
      // 57.3 back when that happens. Fitness #37 reads a hand-lowered literal as a
      // descent against the PR base, so once 57.4 is committed the restoration is a
      // human call in review, not an automatic one.
      thresholds: {
        perFile: false,
        lines: 56.9,
        functions: 57.3,
        branches: 47.9,
        statements: 56.3,
        autoUpdate: (n: number) => Math.floor(n * 10) / 10,
        ...shardedThresholdOverride(sharded),
      },
    },
  },
});
