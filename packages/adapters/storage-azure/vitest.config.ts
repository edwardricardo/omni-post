/**
 * @file vitest.config.ts
 * @description Vitest config for @adapters/storage-azure. Delegates to the shared workspace factory so the
 *              workspace specifiers resolve to TypeScript source when tests run against an
 *              unbuilt tree.
 * @layer infrastructure
 */
import { defineWorkspaceVitestConfig } from "@packages/vitest-shared";

export default defineWorkspaceVitestConfig(import.meta.dirname, {
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    pool: "forks",
  },
});
