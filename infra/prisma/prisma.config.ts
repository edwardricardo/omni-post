import dotenv from "dotenv";
import path from "path";
import { defineConfig, env } from "prisma/config";

// Load .env from project root (two levels up from infra/prisma/)
dotenv.config({ path: path.join(__dirname, "../../.env") });

export default defineConfig({
  schema: path.join(__dirname, "schema.prisma"),
  datasource: {
    url: env("DATABASE_URL"),
    // SHADOW_DATABASE_URL must be declared in .env — Prisma CLI requires it
    // to diff migrations. No fallback: fail fast if the env is missing.
    shadowDatabaseUrl: env("SHADOW_DATABASE_URL"),
  },
  migrations: {
    seed: "pnpm exec tsx seed.ts",
  },
});
