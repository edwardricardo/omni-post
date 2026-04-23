/**
 * @file vitest.config.ts
 * @description Vitest configuration for @adapters/db-prisma unit tests.
 *              Tier 0: no DB, no Redis — pure logic tests for circuit breaker,
 *              retry logic, and metrics collector.
 * @layer infrastructure
 */
import { defineConfig } from "vitest/config";
import path from "node:path";
import { existsSync } from "node:fs";

function findMonorepoRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir, "../../");
}

const root = findMonorepoRoot(__dirname);

export default defineConfig({
  resolve: {
    alias: {
      "@shared/types": path.join(root, "packages/shared/src/index.ts"),
      "@ports/core": path.join(root, "packages/ports/src/index.ts"),
      "@observability/logger": path.join(root, "packages/observability/logger/src/index.ts"),
      "@infra/prisma": path.join(root, "infra/prisma/src/vitest-entry.ts"),
    },
    conditions: ["node"],
  },
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
