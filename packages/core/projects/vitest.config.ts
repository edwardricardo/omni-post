/**
 * @file vitest.config.ts
 * @description Vitest config for @core/projects. Delegates to the shared workspace factory so
 *              `@core/*` and the other workspace specifiers resolve to TypeScript SOURCE (not the
 *              production `dist/` `exports` target) when tests run against an unbuilt tree.
 * @layer infrastructure
 */
import { defineWorkspaceVitestConfig } from "@packages/vitest-shared";

export default defineWorkspaceVitestConfig(import.meta.dirname, {
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
