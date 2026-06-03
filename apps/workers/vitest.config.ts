/**
 * @file vitest.config.ts
 * @description Vitest configuration for apps/workers unit tests.
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
      "@shared": path.join(root, "packages/shared/src"),
      "@ports/core": path.join(root, "packages/ports/src/index.ts"),
      "@ports": path.join(root, "packages/ports/src"),
      // Point @core aliases at the package src DIR (not index.ts) so subpath
      // imports resolve (bare → dir → index.ts; subpath → src/x). Mirrors the
      // `@shared` → packages/shared/src pattern. Required for kernel shims that
      // re-export from `@core/domain/<subpath>.js`.
      "@core/domain": path.join(root, "packages/core/domain/src"),
      "@core/application": path.join(root, "packages/core/application/src"),
      "@core/listening": path.join(root, "packages/core/listening/src"),
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
    // Loads `.env.test` from repo root before any test's transitive Zod env
    // validation kicks in.
    setupFiles: ["./tests/setup-env.ts"],
  },
});
