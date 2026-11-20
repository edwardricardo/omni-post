/**
 * @file vitest.config.ts
 * @description Vitest config for @packages/eslint-plugin-errors. Delegates to the shared workspace
 *              factory, like every other package, so the rule's suite runs with the same reporters
 *              and node defaults as the rest of the repository.
 * @layer infrastructure
 */
import { defineWorkspaceVitestConfig } from "@packages/vitest-shared";

export default defineWorkspaceVitestConfig(import.meta.dirname, {
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
