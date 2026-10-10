/**
 * @file vitest.config.ts
 * @description Vitest configuration for apps/workers unit tests.
 * @layer infrastructure
 */
import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";
import { existsSync } from "node:fs";
import { RESERVED_TIER_EXCLUDES, SOURCE_CONDITIONS } from "@packages/vitest-shared";

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

const root = findMonorepoRoot(import.meta.dirname);

export default defineConfig({
  resolve: {
    alias: {
      // The src DIR, not index.ts: an alias matches by prefix, so a file target turns a subpath
      // import (`@shared/types/channelCredentialsCrypto.js`) into `<file>/<subpath>` and fails
      // with ENOTDIR. The bare `@shared/types` still resolves the directory's index.ts.
      "@shared/types": path.join(root, "packages/shared/src"),
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
      // Subpath alias MUST precede the bare one: the bare @infra/prisma alias
      // targets a FILE (vitest-entry.ts), so a prefix match would resolve
      // subpath imports to <file>/extensions/... and fail with ENOTDIR.
      "@infra/prisma/extensions/tenantGuc.js": path.join(
        root,
        "infra/prisma/src/extensions/tenantGuc.ts"
      ),
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
    // The shared factory's export conditions, named here because this config does not go
    // through it: `development` sends an unaliased workspace package to its src/ whatever
    // NODE_ENV says, and node tests resolve through the ssr environment, which reads only `ssr`.
    conditions: [...SOURCE_CONDITIONS],
  },
  ssr: { resolve: { conditions: [...SOURCE_CONDITIONS] } },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    // The include also matches `*.integration.test.ts` and `*.live.test.ts`, so the reserved
    // suffixes keep those files out; setting `exclude` replaces vitest's defaults, spread back first.
    exclude: [...configDefaults.exclude, ...RESERVED_TIER_EXCLUDES],
    pool: "forks",
    // Loads `.env.test` from repo root before any test's transitive Zod env
    // validation kicks in.
    setupFiles: ["./tests/setup-env.ts"],
  },
});
