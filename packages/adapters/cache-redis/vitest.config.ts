/**
 * @file vitest.config.ts
 * @description Vitest configuration for the cache-redis adapter — node environment,
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
  },
});
