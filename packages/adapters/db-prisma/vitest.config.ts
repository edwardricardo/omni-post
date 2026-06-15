/**
 * @file vitest.config.ts
 * @description Vitest config for @adapters/db-prisma. Delegates to the shared workspace factory so
 *              `@core/*` and the other workspace specifiers resolve to TypeScript SOURCE (not the
 *              production `dist/` `exports` target) when tests run against an unbuilt tree.
 * @layer infrastructure
 */
import { defineWorkspaceVitestConfig } from "../../../vitest.shared.js";

export default defineWorkspaceVitestConfig(import.meta.dirname, {
  test: {
    environment: "node",
    globals: false,
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/testdb",
    },
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    pool: "forks",
  },
});
