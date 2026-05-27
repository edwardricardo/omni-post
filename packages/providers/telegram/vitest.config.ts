/**
 * @file vitest.config.ts
 * @description Vitest configuration for the Telegram provider — resolves workspace aliases
 *              relative to the monorepo root and runs tests in forked node processes.
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
      "@adapters/external-apis": path.join(root, "packages/adapters/external-apis/src/index.ts"),
      "@adapters/fallback-strategies": path.join(
        root,
        "packages/adapters/fallback-strategies/src/index.ts"
      ),
      "@observability/logger": path.join(root, "packages/observability/logger/src/index.ts"),
      // More-specific subpath alias before the bare one — `@providers/shared`
      // resolves to `src/index.ts` (a file), so subpath imports like
      // `@providers/shared/test-utils/msw-helpers` would otherwise fail
      // con ENOTDIR. §3.2 Normalization Roadmap.
      "@providers/shared/test-utils": path.join(root, "packages/providers/shared/src/test-utils"),
      "@providers/shared": path.join(root, "packages/providers/shared/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    pool: "forks",
  },
});
