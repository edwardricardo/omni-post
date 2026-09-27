/**
 * @file vitest.config.ts
 * @description Vitest config for @adapters/fallback-strategies. Delegates to the shared workspace factory so
 *              `@core/*` and the other workspace specifiers resolve to TypeScript SOURCE (not the
 *              production `dist/` `exports` target) when tests run against an unbuilt tree.
 * @layer infrastructure
 */
import { defineWorkspaceVitestConfig } from "@packages/vitest-shared";

export default defineWorkspaceVitestConfig(import.meta.dirname, {
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    // One worker. Multi-fork runs on Node 24 intermittently die with "Worker
    // exited unexpectedly" and exit 1 while zero tests failed, which reads as a
    // mystery red. apps/api documents the same class: each fork is a full base
    // process, and their combined RSS trips the OS OOM-killer. (vitest 4 dropped
    // `poolOptions`; `maxWorkers` is the supported knob.)
    maxWorkers: 1,
    // The beforeAll dynamic-imports the source module; on a cold CI runner the
    // on-the-fly transform of its dependency graph can exceed the 10s default.
    hookTimeout: 30000,
  },
});
