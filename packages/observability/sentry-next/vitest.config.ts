/**
 * @file vitest.config.ts
 * @description Vitest config for @observability/sentry-next. Delegates to the shared workspace factory so
 *              `@observability/*` and the other workspace specifiers resolve to TypeScript SOURCE when
 *              tests run against an unbuilt tree; jsdom hosts the fallback document's suite.
 * @layer infrastructure
 */
import { defineWorkspaceVitestConfig } from "@packages/vitest-shared";

export default defineWorkspaceVitestConfig(import.meta.dirname, {
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    pool: "forks",
  },
});
