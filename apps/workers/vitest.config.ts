/**
 * @file vitest.config.ts
 * @description Vitest configuration for apps/workers unit tests.
 * @layer test-infrastructure
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
      "@shared": path.join(root, "packages/shared/src"),
      "@ports/core": path.join(root, "packages/ports/src/index.ts"),
      "@ports": path.join(root, "packages/ports/src"),
      "@infra/prisma": path.join(root, "infra/prisma/src/vitest-entry.ts"),
      "@observability/logger": path.join(root, "packages/observability/logger/src/index.ts"),
      "@monitoring/circuit-breaker": path.join(
        root,
        "packages/monitoring/circuit-breaker/src/index.ts"
      ),
      "@adapters/queue-bullmq": path.join(root, "packages/adapters/queue-bullmq/src/index.ts"),
      "@adapters/cache-redis": path.join(root, "packages/adapters/cache-redis/src/index.ts"),
      "@providers/shared": path.join(root, "packages/providers/shared/src/index.ts"),
    },
    conditions: ["node"],
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/testdb",
    },
  },
});
