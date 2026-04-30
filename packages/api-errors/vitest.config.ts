/**
 * @file vitest.config.ts
 * @description Vitest configuration for the @packages/api-errors package — pure
 *              node, no DOM, no workspace alias resolution needed.
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
