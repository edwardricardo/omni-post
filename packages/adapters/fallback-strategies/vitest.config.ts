/**
 * @file vitest.config.ts
 * @description Vitest configuration for the fallback-strategies package — node environment,
 *              forked pool, and local test file glob.
 * @layer infrastructure
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
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
