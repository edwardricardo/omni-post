/**
 * @file vitest.stryker.config.ts
 * @description Vitest config for Stryker mutation testing runs. Caps fork count
 *              so the combined footprint (Stryker concurrency × vitest forks)
 *              stays within the WSL2 memory ceiling.
 * @layer test-infrastructure
 */
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      pool: "forks",
      poolOptions: {
        forks: { singleFork: false, maxForks: 2, minForks: 1 },
      },
    },
  })
);
