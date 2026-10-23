/**
 * @file vitest.config.ts
 * @description Vitest config for @observability/opentelemetry. Delegates to the shared workspace
 *              factory so the workspace specifiers resolve to TypeScript source and the reserved
 *              tier suffixes stay excluded.
 * @layer infrastructure
 */
import { defineWorkspaceVitestConfig } from "@packages/vitest-shared";

export default defineWorkspaceVitestConfig(import.meta.dirname, {
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    pool: "forks",
  },
});
