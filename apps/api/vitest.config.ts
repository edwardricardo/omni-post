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
      "@core/ai-image": path.join(root, "packages/core/ai-image/src"),
      "@core/ai": path.join(root, "packages/core/ai/src"),
      "@core/aiPromptTemplates": path.join(root, "packages/core/aiPromptTemplates/src"),
      "@core/analytics": path.join(root, "packages/core/analytics/src"),
      "@core/apiKeys": path.join(root, "packages/core/apiKeys/src"),
      "@core/approvals": path.join(root, "packages/core/approvals/src"),
      "@core/assets": path.join(root, "packages/core/assets/src"),
      "@core/auth": path.join(root, "packages/core/auth/src"),
      "@core/billing": path.join(root, "packages/core/billing/src"),
      "@core/brand-kit": path.join(root, "packages/core/brand-kit/src"),
      "@core/brand-voice": path.join(root, "packages/core/brand-voice/src"),
      "@core/bulk-scheduling": path.join(root, "packages/core/bulk-scheduling/src"),
      "@core/campaigns": path.join(root, "packages/core/campaigns/src"),
      "@core/channels": path.join(root, "packages/core/channels/src"),
      "@core/comments": path.join(root, "packages/core/comments/src"),
      "@core/compliance": path.join(root, "packages/core/compliance/src"),
      "@core/crisis": path.join(root, "packages/core/crisis/src"),
      "@core/crm": path.join(root, "packages/core/crm/src"),
      "@core/custom-reports": path.join(root, "packages/core/custom-reports/src"),
      "@core/customer-auth": path.join(root, "packages/core/customer-auth/src"),
      "@core/embeddings": path.join(root, "packages/core/embeddings/src"),
      "@core/external-notifications": path.join(root, "packages/core/external-notifications/src"),
      "@core/first-comment": path.join(root, "packages/core/first-comment/src"),
      "@core/glossary": path.join(root, "packages/core/glossary/src"),
      "@core/guardrails": path.join(root, "packages/core/guardrails/src"),
      "@core/inbox": path.join(root, "packages/core/inbox/src"),
      "@core/integrations": path.join(root, "packages/core/integrations/src"),
      "@core/links": path.join(root, "packages/core/links/src"),
      "@core/listening": path.join(root, "packages/core/listening/src"),
      "@core/mentions": path.join(root, "packages/core/mentions/src"),
      "@core/ml": path.join(root, "packages/core/ml/src"),
      "@core/notifications": path.join(root, "packages/core/notifications/src"),
      "@core/posts": path.join(root, "packages/core/posts/src"),
      "@core/providers": path.join(root, "packages/core/providers/src"),
      "@core/recurring": path.join(root, "packages/core/recurring/src"),
      "@core/referral": path.join(root, "packages/core/referral/src"),
      "@core/reports": path.join(root, "packages/core/reports/src"),
      "@core/security": path.join(root, "packages/core/security/src"),
      "@core/settings": path.join(root, "packages/core/settings/src"),
      "@core/style-guide": path.join(root, "packages/core/style-guide/src"),
      "@core/tasks": path.join(root, "packages/core/tasks/src"),
      "@core/team": path.join(root, "packages/core/team/src"),
      "@core/trends": path.join(root, "packages/core/trends/src"),
      "@core/usage": path.join(root, "packages/core/usage/src"),
      "@core/utm": path.join(root, "packages/core/utm/src"),
      "@core/webhooks": path.join(root, "packages/core/webhooks/src"),
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
      // More specific subpath alias MUST come before the bare `@infra/prisma`
      // alias so it wins prefix matching (Vite resolves aliases in declaration
      // order). Without this, `@infra/prisma/extensions/...` would resolve to
      // `vitest-entry.ts/extensions/...` (a non-existent path inside a file).
      "@infra/prisma/extensions": path.join(root, "infra/prisma/src/extensions"),
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
    // §1.4 canon — load `.env.test` BEFORE any test file's transitive import
    // reaches `apps/api/src/config/env.ts` and triggers Zod validation.
    // Replaces the prior `test.env = { DATABASE_URL: dummy }` workaround.
    // See `docs/architecture/secrets-and-env.md` §"Test environment".
    setupFiles: ["./tests/setup-env.ts"],
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
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      // §2.2 (Normalization Roadmap) Phase A — enforced in CI via the
      // `test:coverage` script. Thresholds are for unit tests only
      // (tests/unit/**); integration tests run via node:test and contribute
      // additional coverage not captured here. Mutation score via Stryker
      // is the primary quality gate.
      thresholds: {
        // Global floor — fails CI on any regression below current baseline.
        lines: 55,
        functions: 55,
        branches: 45,
        statements: 55,
        // Per-scope OVERRIDES — Phase A keeps these at the global floor so
        // CI passes today; §2.2.b ratchets each scope to its aspirational
        // target after measurement: domain 90 / application 85 / infra 70.
        // The glob keys put the per-scope structure in place ready for the
        // ratchet without breaking CI today.
        perFile: false,
        "src/domain/**/*.ts": { lines: 55, functions: 55, branches: 45, statements: 55 },
        "src/application/**/*.ts": { lines: 55, functions: 55, branches: 45, statements: 55 },
      },
    },
  },
});
