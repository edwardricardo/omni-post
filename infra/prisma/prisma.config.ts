import dotenv from "dotenv";
import path from "path";
import { defineConfig, env } from "prisma/config";

// Load .env from project root (two levels up from infra/prisma/)
dotenv.config({ path: path.join(__dirname, "../../.env") });

export default defineConfig({
  schema: path.join(__dirname, "schema.prisma"),
  datasource: {
    url: env("DATABASE_URL"),
    shadowDatabaseUrl:
      env("SHADOW_DATABASE_URL") ??
      "postgresql://postgres:password123@localhost:5432/omnipostdb_shadow",
  },
  migrations: {
    seed: "npx tsx seed.ts",
  },
});
