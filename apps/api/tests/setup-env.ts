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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// apps/api/tests/setup-env.ts → repo root is three levels up.
const envFilePath = path.resolve(__dirname, "../../../.env.test");

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
