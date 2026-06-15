/**
 * @file vitest.config.ts
 * @description Vitest config for @adapters/fallback-strategies. Delegates to the shared workspace factory so
 *              `@core/*` and the other workspace specifiers resolve to TypeScript SOURCE (not the
 *              production `dist/` `exports` target) when tests run against an unbuilt tree.
 * @layer infrastructure
 */
import { defineWorkspaceVitestConfig } from "../../../vitest.shared.js";

export default defineWorkspaceVitestConfig(import.meta.dirname, {
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    // Single fork: multi-fork pools on Node 24 intermittently die with
    // "Worker exited unexpectedly" (exit 1 with zero failed tests).
    poolOptions: { forks: { singleFork: true } },
    // The beforeAll dynamic-imports the source module; on a cold CI runner the
    // on-the-fly transform of its dependency graph can exceed the 10s default.
    hookTimeout: 30000,
  },
});
