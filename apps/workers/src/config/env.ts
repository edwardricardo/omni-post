/**
 * @file env.ts
 * @description Single source of truth for environment configuration in the workers
 *              process. Validates `process.env` against a Zod schema at module load
 *              time via `@t3-oss/env-core` and exports a typed `env` constant.
 *              Fails fast with a precise error if any required variable is missing
 *              or malformed — no fallbacks, no warn-and-continue (SECURITY_CANON
 *              §Secrets, CWE-798).
 * @layer infrastructure
 */

// Load .env first so callers that import env.ts without setting up dotenv
// (e.g. vitest) still see the variables. Idempotent when the env is already set.
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// apps/workers/src/config/ → repo root is four levels up (same depth as apps/api/src/config/).
const envFile = process.env.NODE_ENV === "test" ? ".env.test" : ".env";
dotenv.config({ path: path.resolve(__dirname, "../../../..", envFile) });

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * Shape of issues passed to `onValidationError` by t3-env (Standard Schema V1
 * spec — t3-env's API is schema-library-agnostic).
 */
interface SchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

/**
 * Minimum length for symmetric secrets. 32 bytes = 256 bits — matches HS256
 * recommendation and the openssl rand -hex 64 / openssl rand -base64 32 flows.
 */
const SECRET_MIN = 32;

/**
 * @description Workers environment, validated at module load. Trimmed to exactly
 *   what `apps/workers` reads — keeps the schema minimal and intentional.
 *   Mirrors the shape of `apps/api/src/config/env.ts` but without API-specific keys.
 */
export const env = createEnv({
  server: {
    // ── Core ────────────────────────────────────────────────────────────
    NODE_ENV: z.enum(["development", "production", "test", "staging"]).default("development"),

    // ── Database (REQUIRED — boot fails without it) ──────────────────────
    DATABASE_URL: z.string().url(),

    // ── Redis (REQUIRED — no fallback, CWE-798) ──────────────────────────
    // Workers open at least two Redis connections: one for the BullMQ queue
    // (consumer-adapter) and one for the saga pub/sub notify channel. Both
    // must connect to the same configured Redis, fail-fast on missing URL.
    REDIS_URL: z.string().url(),

    // ── Cryptography (REQUIRED — decrypt Channel.credentials) ─────────────
    PLATFORM_ENCRYPTION_KEY: z.string().min(SECRET_MIN),

    // ── Telemetry ───────────────────────────────────────────────────────
    METRICS_PORT: z.coerce.number().int().min(1).max(65535).optional(),

    // ── Telemetry toggle ────────────────────────────────────────────────
    // Mirror of apps/api/src/config/env.ts TRACING_ENABLED.
    TRACING_ENABLED: z
      .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
      .default("false")
      .transform((v) => v === "true" || v === "1"),

    // ── Logging ─────────────────────────────────────────────────────────
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
  },

  runtimeEnv: process.env,

  emptyStringAsUndefined: true,

  onValidationError: (issues: readonly SchemaIssue[]): never => {
    const formatted = issues
      .map((i) => {
        const segments = (i.path ?? []).map((seg) =>
          typeof seg === "object" && "key" in seg ? String(seg.key) : String(seg)
        );
        const path = segments.join(".") || "(root)";
        return `  - ${path}: ${i.message}`;
      })
      .join("\n");
    throw new Error(
      `Environment validation failed. Refusing to boot.\n\n` +
        `${formatted}\n\n` +
        `Reference: docs/architecture/secrets-and-env.md for the complete schema and rotation runbook.`
    );
  },
});
