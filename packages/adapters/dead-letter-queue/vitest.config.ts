/**
 * @file vitest.config.ts
 * @description Vitest configuration for the dead-letter-queue package — node environment,
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
    // Hooks dynamically import the source module after vi.mock setup; under
    // turbo parallel test execution the first cold import can exceed the
    // 10 s default while Vite/tsx warm up. 30 s gives headroom without
    // hiding real hangs.
    hookTimeout: 30_000,
  },
});
