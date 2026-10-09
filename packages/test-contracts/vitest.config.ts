/**
 * @file vitest.config.ts
 * @description Vitest config for @packages/test-contracts. Delegates to the shared workspace
 *              factory, like every other package. The `include` names the suites at the top of
 *              `tests/` only: `tests/fixtures/` holds helpers the suites import, never a test
 *              file, so nothing under it is collected as a suite.
 * @layer infrastructure
 */
import { defineWorkspaceVitestConfig } from "@packages/vitest-shared";

export default defineWorkspaceVitestConfig(import.meta.dirname, {
  test: {
    include: ["tests/*.test.ts"],
  },
});
