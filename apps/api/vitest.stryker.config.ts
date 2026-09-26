/**
 * @file vitest.stryker.config.ts
 * @description Vitest config for Stryker mutation testing runs. Caps fork count
 *              so the combined footprint (Stryker concurrency × vitest forks)
 *              stays within the WSL2 memory ceiling.
 * @layer infrastructure
 */
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config.js";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      pool: "forks",
      // Two workers. This file exists only for this cap: Stryker's own
      // concurrency multiplies vitest's, and the product of the two exceeds the
      // memory ceiling of the machines these runs happen on. (vitest 4 dropped
      // `poolOptions`; `maxWorkers` is the supported knob, and vitest 4 has no
      // `minWorkers` counterpart to the old `minForks`.)
      maxWorkers: 2,
    },
  })
);
