/**
 * @file setup-env.ts
 * @description Vitest `setupFiles` hook for `apps/api`. Side-effect-only
 *   module: loads `.env.test` from the repo root before any test file's
 *   transitive `import` chain reaches `apps/api/src/config/env.ts` and
 *   triggers Zod validation. Registered in `vitest.config.ts`.
 *
 *   Why a dedicated file (separate from `apps/api/tests/setup.ts`):
 *   - `tests/setup.ts` imports `@adapters/db-prisma` + `@adapters/queue-bullmq`
 *     for integration test fixtures. Forcing every unit test through that
 *     module would pull the full adapter graph into the import phase —
 *     defeats the point of a fast unit test.
 *   - `setupFiles` MUST be lightweight: only dotenv loading, nothing else.
 *
 *   If `.env.test` is missing the loader logs a single stderr warning and
 *   returns. CI provides env via shell exports (see
 *   `scripts/ci-setup-test-env.sh`), so absence is non-fatal there. Local
 *   dev: copy `.env.test.example` to `.env.test`.
 *
 * @layer infrastructure
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { findMonorepoRoot } from "@packages/vitest-shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The root is FOUND, not counted. "Three levels up" held for a normal run and
// broke the one that matters: Stryker copies `apps/api` into
// `apps/api/.stryker-tmp/sandbox-XXXX/` and runs there, so three levels up
// lands on `apps/api/.stryker-tmp/.env.test` — absent. Every mutation run then
// died in the dry run with `REDIS_URL: expected string, received undefined`,
// and the nightly reported it as a failed artifact upload. `findMonorepoRoot`
// walks up for `pnpm-workspace.yaml`, which resolves to the real repository
// from inside the sandbox and from outside it alike.
const envFilePath = path.join(findMonorepoRoot(__dirname), ".env.test");

if (existsSync(envFilePath)) {
  dotenv.config({ path: envFilePath });
} else if (!process.env.DATABASE_URL) {
  // Only warn when the env var that everything depends on is also missing —
  // CI exports vars directly without needing the file.
  process.stderr.write(
    `⚠️  vitest setup-env: .env.test not found at ${envFilePath}\n` +
      `   Copy .env.test.example to .env.test (and edit DATABASE_URL/REDIS_URL).\n`
  );
}

// Ensure NODE_ENV reflects the test runner so downstream modules
// (e.g. `apps/api/src/config/env.ts`) take the test branch on subsequent
// dotenv loads even when the file already set it explicitly.
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
