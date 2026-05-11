import dotenv from "dotenv";
import path from "path";
import { defineConfig } from "prisma/config";

// Load .env from project root (two levels up from infra/prisma/) so the Prisma
// CLI can read DATABASE_URL / SHADOW_DATABASE_URL when running migrate / push
// commands from a developer machine. In CI, .env is created by the workflow's
// setup step after `pnpm install`, so this dotenv call is a no-op there — the
// real envs come from the workflow `env:` block at runtime.
dotenv.config({ path: path.join(__dirname, "../../.env") });

// IMPORTANT: do NOT use Prisma's `env()` helper here. `env()` is strict in
// Prisma 7 — it throws at module-load time if the variable isn't defined,
// which breaks `prisma generate` during `pnpm install` postinstall on a CI
// runner that hasn't populated `.env` yet. Fallback to "" keeps `generate`
// working (it doesn't need a real URL — only schema parsing). The fail-fast
// for real runtime usage lives in apps/api/src/config/env.ts (Zod schema)
// and in the Prisma CLI itself when running migrate/push without a URL.
export default defineConfig({
  schema: path.join(__dirname, "schema.prisma"),
  datasource: {
    url: process.env.DATABASE_URL ?? "",
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL ?? "",
  },
  migrations: {
    seed: "pnpm exec tsx seed.ts",
  },
});
