/**
 * @file vitest.config.ts
 * @description Vitest configuration for apps/api unit tests.
 *              Covers tests/unit/** only — integration and flow tests remain
 *              on node:test via scripts/run-tests.sh.
 * @layer infrastructure
 */
import { defineConfig } from "vitest/config";
import path from "node:path";
import { existsSync } from "node:fs";

// Find monorepo root by walking up to find pnpm-workspace.yaml.
// This handles Stryker's sandbox (.stryker-tmp/sandbox-xxx/) where
// __dirname is 2 extra levels deep, breaking the normal "../../" path.
function findMonorepoRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback to the original relative path
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
      // imports resolve: @rollup/plugin-alias prefix-matches `@core/domain`
      // (bare → dir → index.ts) AND `@core/domain/x` (→ src/x). Mirrors the
      // `@shared` → packages/shared/src pattern. Required for the kernel shims
      // that re-export from `@core/domain/<subpath>.js`.
      "@core/domain": path.join(root, "packages/core/domain/src"),
      "@core/application": path.join(root, "packages/core/application/src"),
      "@adapters/db-prisma": path.join(root, "packages/adapters/db-prisma/src/index.ts"),
      "@adapters/cache-redis": path.join(root, "packages/adapters/cache-redis/src/index.ts"),
      "@adapters/queue-bullmq": path.join(root, "packages/adapters/queue-bullmq/src/index.ts"),
      "@adapters/storage-s3": path.join(root, "packages/adapters/storage-s3/src/index.ts"),
      "@adapters/external-apis": path.join(root, "packages/adapters/external-apis/src/index.ts"),
      "@adapters/fallback-strategies": path.join(
        root,
        "packages/adapters/fallback-strategies/src/index.ts"
      ),
      "@adapters/dead-letter-queue": path.join(
        root,
        "packages/adapters/dead-letter-queue/src/index.ts"
      ),
      "@monitoring/health-checks": path.join(
        root,
        "packages/monitoring/health-checks/src/index.ts"
      ),
      "@monitoring/circuit-breaker": path.join(
        root,
        "packages/monitoring/circuit-breaker/src/index.ts"
      ),
      "@observability/logger": path.join(root, "packages/observability/logger/src/index.ts"),
      "@observability/opentelemetry": path.join(
        root,
        "packages/observability/opentelemetry/src/index.ts"
      ),
      "@infra/prisma": path.join(root, "infra/prisma/src/vitest-entry.ts"),
      "@providers/shared": path.join(root, "packages/providers/shared/src/index.ts"),
      "@providers/x": path.join(root, "packages/providers/x/src/index.ts"),
      "@providers/instagram": path.join(root, "packages/providers/instagram/src/index.ts"),
      "@providers/facebook": path.join(root, "packages/providers/facebook/src/index.ts"),
      "@providers/youtube": path.join(root, "packages/providers/youtube/src/index.ts"),
      "@providers/tiktok": path.join(root, "packages/providers/tiktok/src/index.ts"),
      "@providers/snapchat": path.join(root, "packages/providers/snapchat/src/index.ts"),
      "@providers/telegram": path.join(root, "packages/providers/telegram/src/index.ts"),
      "@providers/pinterest": path.join(root, "packages/providers/pinterest/src/index.ts"),
      "@providers/linkedin": path.join(root, "packages/providers/linkedin/src/index.ts"),
      "@providers/bluesky": path.join(root, "packages/providers/bluesky/src/index.ts"),
    },
    // Prisma 7 generated client has both client.ts (Node) and browser.ts.
    // Force Vite to use the Node condition so it picks client.ts.
    // See: https://github.com/prisma/prisma/issues/27627
    conditions: ["node"],
  },
  test: {
    environment: "node",
    globals: true,
    env: {
      // Unit tests mock all DB access via DI. This dummy URL prevents the lazy
      // Prisma Proxy from crashing when modules that re-export from @infra/prisma
      // are imported transitively. No real connection is ever established.
      DATABASE_URL: "postgresql://test:test@localhost:5432/testdb",
    },
    include: ["tests/unit/**/*.test.ts", "tests/eval/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    pool: "forks",
    // Cap parallel workers. The default is one per CPU (8 here), and each fork
    // loads the full module graph — running the whole suite that wide spikes
    // memory and OOM-collapses the memory-constrained dev box. Two workers keeps
    // peak memory bounded while retaining some parallelism. (vitest 4 dropped
    // `poolOptions`; `maxWorkers` is the supported cap.)
    maxWorkers: 2,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.spec.ts", "src/**/index.ts", "src/index.ts"],
      // Thresholds are for unit tests only (tests/unit/**).
      // Integration tests (tests/integration/, tests/*.test.ts) run via node:test
      // and contribute additional coverage not captured here.
      // Mutation score via Stryker is the primary quality gate.
      thresholds: {
        lines: 55,
        functions: 55,
        branches: 45,
      },
    },
  },
});
