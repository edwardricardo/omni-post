/**
 * @file vitest.config.ts
 * @description Vitest config for @observability/browser-logger. Delegates to the shared workspace factory so
 *              `@core/*` and the other workspace specifiers resolve to TypeScript SOURCE (not the
 *              production `dist/` `exports` target) when tests run against an unbuilt tree.
 * @layer infrastructure
 */
import { defineWorkspaceVitestConfig } from "../../../vitest.shared.js";

export default defineWorkspaceVitestConfig(import.meta.dirname, {
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    pool: "forks",
  },
});
