/**
 * @file setup-env.ts
 * @description Vitest `setupFiles` hook for `apps/workers`. Mirror of
 *   `apps/api/tests/setup-env.ts` — loads the root `.env.test` before any
 *   transitive `import` triggers Zod env validation. Registered in
 *   `apps/workers/vitest.config.ts`. See the apps/api companion for the
 *   full rationale.
 *
 * @layer infrastructure
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// apps/workers/tests/setup-env.ts → repo root is three levels up.
const envFilePath = path.resolve(__dirname, "../../../.env.test");

if (existsSync(envFilePath)) {
  dotenv.config({ path: envFilePath });
} else if (!process.env.DATABASE_URL) {
  process.stderr.write(
    `⚠️  vitest setup-env: .env.test not found at ${envFilePath}\n` +
      `   Copy .env.test.example to .env.test (and edit DATABASE_URL/REDIS_URL).\n`
  );
}

process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
