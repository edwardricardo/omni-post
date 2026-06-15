/**
 * @file vitest.config.ts
 * @description Vitest config for @adapters/dead-letter-queue. Delegates to the shared workspace factory so
 *              `@core/*` and the other workspace specifiers resolve to TypeScript SOURCE (not the
 *              production `dist/` `exports` target) when tests run against an unbuilt tree.
 * @layer infrastructure
 */
import { defineWorkspaceVitestConfig } from "../../../vitest.shared.js";

export default defineWorkspaceVitestConfig(import.meta.dirname, {
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
