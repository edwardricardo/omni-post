/**
 * @file vitest.config.ts
 * @description Vitest configuration for apps/api unit tests.
 *              Covers tests/unit/** only — integration and flow tests remain
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
      // depend on it: `autoUpdate` rewrites this file through an AST parse and throws
      // on any `thresholds` that is not a literal object node (a helper call fails the
      // run outright — reproduced on vitest 4.1.10), and the PR diff guard reads these
      // lines to reject a lowered floor. Extracting them into a helper "for tidiness"
      // silently breaks both.
      //
      // The floor is the MEASURED value of this suite, floored to one decimal
      // (baseline 2026-08-26: statements 56.38, branches 47.93, functions 57.40,
      // lines 56.95 over 539 files / 8421 tests, merged run). It is a ratchet, not an
      // aspiration: `autoUpdate` raises each number to the new measurement in the very
      // commit that earns it, so a later regression below what was already achieved
      // goes red. Lowering a number by hand is the one move the diff guard rejects.
      thresholds: {
        perFile: false,
        lines: 56.9,
        functions: 57.4,
        branches: 47.9,
        statements: 56.3,
        autoUpdate: (n: number) => Math.floor(n * 10) / 10,
        ...shardedThresholdOverride(sharded),
      },
    },
  },
});
