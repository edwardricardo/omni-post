/**
 * @file vitest.config.ts
 * @description Vitest config for @packages/i18n. Delegates to the shared workspace factory so
 *              workspace specifiers resolve to TypeScript SOURCE when tests run against an
 *              unbuilt tree, matching every other package in the repo.
 * @layer infrastructure
 */
import { defineWorkspaceVitestConfig } from "../../vitest.shared.js";

export default defineWorkspaceVitestConfig(import.meta.dirname, {
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    pool: "forks",
  },
});
