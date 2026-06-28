/**
 * @file env.ts
 * @description Single source of truth for environment configuration. Validates
 *              `process.env` against a Zod schema at module load time via
 *              `@t3-oss/env-core` and exports a typed `env` constant. Fails
 *              fast with a precise error if any required variable is missing
 *              or malformed.
 * @layer infrastructure
 */

// Load .env first so callers that import env.ts without setting up dotenv
// (e.g. vitest) still see the variables. Idempotent when `node --env-file`
// has already populated process.env.
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envFile = process.env.NODE_ENV === "test" ? ".env.test" : ".env";
dotenv.config({ path: path.resolve(__dirname, "../../../..", envFile) });

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * Shape of issues passed to `onValidationError` by t3-env (Standard Schema V1
 * spec — t3-env's API is schema-library-agnostic, so the issue type is the
 * neutral StandardSchemaV1.Issue, not Zod's `ZodIssue`).
 */
interface SchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

/**
 * Minimum length for symmetric secrets. 32 bytes = 256 bits — matches HS256
 * recommendation and our `openssl rand -hex 64`/`openssl rand -base64 32` flows.
 */
const SECRET_MIN = 32;

/**
 * Strict URL validator that also accepts postgres:// / postgresql:// / redis://
 * schemes (z.string().url() does too, since it delegates to URL).
 */
const urlString = z.string().url();

/**
 * Boolean coerced from "true"/"false"/"1"/"0". Defaults handled per-field via
 * `.default()` rather than here so each toggle's default is locally visible.
 */
const boolFromString = z
  .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
  .transform((v) => v === "true" || v === "1");

/**
 * Port: numeric string in [1, 65535]. Coerced because env vars are always strings.
 */
const portNumber = z.coerce.number().int().min(1).max(65535);

/**
 * The full `server` schema map for the apps/api environment. Extracted as a
 * named constant (rather than inlined into `createEnv`) so a single source of
 * truth backs both the module-level `env` AND the env fail-fast smoke test:
 * the test drives `parseApiEnv` against this exact schema, so any drift (e.g.
 * relaxing `REDIS_URL` back to `.optional()`) is caught by the guard instead
 * of silently passing a parallel copy. See `parseApiEnv` below.
 */
const serverSchema = {
  // ── Core ────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(["development", "production", "test", "staging"]).default("development"),
  PORT: portNumber.default(3000),
  HOST: z.string().default("0.0.0.0"),

  // ── Database (REQUIRED — boot fails without these) ──────────────────
  DATABASE_URL: urlString,
  SHADOW_DATABASE_URL: urlString,

  // ── Redis (REQUIRED — boot fails without it) ────────────────────────
  // REDIS_URL is the canonical input. The legacy REDIS_HOST/PORT/PASSWORD
  // trio is kept for compat (workers / docker-compose deploys may build a
  // URL from them via getRedisUrl), but it is no longer a fallback for
  // apps/api: REDIS_URL must be present or the app refuses to boot
  // (CWE-798 — no insecure localhost default).
  REDIS_URL: urlString,
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: portNumber.optional(),
  REDIS_PASSWORD: z.string().optional(),

  // ── Auth secrets (REQUIRED — CWE-798 zero tolerance) ────────────────
  JWT_SECRET: z.string().min(SECRET_MIN).optional(),
  JWT_ACCESS_SECRET: z.string().min(SECRET_MIN),
  JWT_REFRESH_SECRET: z.string().min(SECRET_MIN),
  CUSTOMER_JWT_SECRET: z.string().min(SECRET_MIN),
  ADMIN_JWT_ACCESS_SECRET: z.string().min(SECRET_MIN),
  ADMIN_JWT_REFRESH_SECRET: z.string().min(SECRET_MIN),
  COOKIE_SECRET: z.string().min(SECRET_MIN),

  // ── Cryptography (REQUIRED — encryption is core, not opt-in) ────────
  PLATFORM_ENCRYPTION_KEY: z.string().min(SECRET_MIN),
  OAUTH_ENCRYPTION_KEY: z.string().min(SECRET_MIN),

  // Active key version for new ciphertexts. Used by EncryptionService to
  // stamp new EncryptedValue rows with `keyVersion = N`. Defaults to 1
  // (the steady state). Bump to N+1 during a key rotation, alongside
  // setting `PLATFORM_ENCRYPTION_KEY_V<N>` to the previous key for the
  // dual-key validity window.
  PLATFORM_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).default(1),

  // Prior key versions, available during a rotation grace window so
  // existing ciphertexts (stamped with keyVersion=N-1) can still be
  // decrypted while new writes use the v=N key. Drop these env vars
  // after the re-wrap script has migrated all rows to the current key.
  PLATFORM_ENCRYPTION_KEY_V1: z.string().min(SECRET_MIN).optional(),
  PLATFORM_ENCRYPTION_KEY_V2: z.string().min(SECRET_MIN).optional(),
  PLATFORM_ENCRYPTION_KEY_V3: z.string().min(SECRET_MIN).optional(),

  // ── URLs (frontends + base) ─────────────────────────────────────────
  ADMIN_URL: urlString.optional(),
  CLIENT_URL: urlString.optional(),
  CLIENT_APP_URL: urlString.optional(),
  FRONTEND_URL: urlString.optional(),
  API_BASE_URL: urlString.optional(),
  APP_BASE_URL: urlString.optional(),
  ALLOWED_MEDIA_HOSTS: z.string().optional(),

  // ── Logging ─────────────────────────────────────────────────────────
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  LOG_CACHE_OPS: boolFromString.optional(),

  // ── Telemetry ───────────────────────────────────────────────────────
  TRACING_ENABLED: boolFromString.default(false),
  METRICS_PORT: portNumber.optional(),

  // ── Cache ───────────────────────────────────────────────────────────
  MATERIALIZED_VIEW_REFRESH_INTERVAL: z.coerce.number().int().positive().optional(),

  // ── Storage (CONDITIONAL on STORAGE_PROVIDER) ───────────────────────
  STORAGE_PROVIDER: z.enum(["s3", "local", "do-spaces"]).default("local"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  DO_SPACES_BUCKET: z.string().optional(),
  DO_SPACES_REGION: z.string().optional(),
  DO_SPACES_KEY: z.string().optional(),
  DO_SPACES_SECRET: z.string().optional(),
  DO_SPACES_ENDPOINT: z.string().optional(),

  // ── Payment (CONDITIONAL on PAYMENT_PROVIDER) ───────────────────────
  PAYMENT_PROVIDER: z.enum(["stripe", "paddle", "none"]).default("none"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  PADDLE_API_KEY: z.string().optional(),
  PADDLE_WEBHOOK_SECRET: z.string().optional(),
  PADDLE_SANDBOX: boolFromString.optional(),

  // ── AI providers (CONDITIONAL — features auto-disable if missing) ───
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  OPENAI_EMBEDDINGS_MODEL: z.string().default("text-embedding-3-small"),
  PERPLEXITY_API_KEY: z.string().optional(),
  PERPLEXITY_MODEL: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  GEMINI_EMBEDDINGS_MODEL: z.string().default("gemini-embedding-001"),
  EMBEDDINGS_DIMENSIONS: z.coerce.number().int().positive().default(768),
  EMBEDDINGS_PROVIDER_PREFERENCE: z.string().default("openai,gemini"),
  // Per-provider outbound request budget for the AI orchestrator token
  // bucket (capacity = permits, refilled over one minute).
  AI_PROVIDER_REQUESTS_PER_MIN: z.coerce.number().int().positive().default(60),

  // ── Email (Resend) ──────────────────────────────────────────────────
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_ADDRESS: z.string().optional(),

  // ── Analytics (GA4) ─────────────────────────────────────────────────
  GA4_MEASUREMENT_ID: z.string().optional(),
  GA4_API_SECRET: z.string().optional(),
  GA4_ENDPOINT: urlString.optional(),

  // ── Provider OAuth — Facebook ───────────────────────────────────────
  FACEBOOK_CLIENT_ID: z.string().optional(),
  FACEBOOK_CLIENT_SECRET: z.string().optional(),
  FACEBOOK_REDIRECT_URI: urlString.optional(),

  // ── Provider OAuth — Instagram ──────────────────────────────────────
  INSTAGRAM_CLIENT_ID: z.string().optional(),
  INSTAGRAM_CLIENT_SECRET: z.string().optional(),
  INSTAGRAM_REDIRECT_URI: urlString.optional(),

  // ── Provider OAuth — X (Twitter) ────────────────────────────────────
  X_CLIENT_ID: z.string().optional(),
  X_CLIENT_SECRET: z.string().optional(),
  X_REDIRECT_URI: urlString.optional(),

  // ── Provider OAuth — LinkedIn ───────────────────────────────────────
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  LINKEDIN_REDIRECT_URI: urlString.optional(),

  // ── Provider OAuth — TikTok ─────────────────────────────────────────
  TIKTOK_CLIENT_ID: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  TIKTOK_REDIRECT_URI: urlString.optional(),

  // ── Provider OAuth — YouTube ────────────────────────────────────────
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_REDIRECT_URI: urlString.optional(),

  // ── Provider OAuth — Pinterest ──────────────────────────────────────
  PINTEREST_CLIENT_ID: z.string().optional(),
  PINTEREST_CLIENT_SECRET: z.string().optional(),
  PINTEREST_REDIRECT_URI: urlString.optional(),

  // ── Provider OAuth — Snapchat ───────────────────────────────────────
  SNAPCHAT_CLIENT_ID: z.string().optional(),
  SNAPCHAT_CLIENT_SECRET: z.string().optional(),
  SNAPCHAT_REDIRECT_URI: urlString.optional(),

  // ── CRM — HubSpot ───────────────────────────────────────────────────
  HUBSPOT_CLIENT_ID: z.string().optional(),
  HUBSPOT_REDIRECT_URI: urlString.optional(),

  // ── CRM — Salesforce ────────────────────────────────────────────────
  SALESFORCE_CLIENT_ID: z.string().optional(),
  SALESFORCE_REDIRECT_URI: urlString.optional(),
  SALESFORCE_SANDBOX: boolFromString.optional(),

  // ── System tools (with sensible defaults) ───────────────────────────
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  THUMBNAIL_TEMP_DIR: z.string().default("/tmp/claude/thumbnails"),
  VIDEO_TEMP_DIR: z.string().default("/tmp/claude/video"),

  // ── Feature flags ───────────────────────────────────────────────────
  ENABLE_RATE_LIMITING: boolFromString.default(true),

  // ── Rate limiting — trusted proxy hops (anti-spoof) ─────────────────
  // Number of TRUSTED reverse-proxy hops directly in front of the API. The
  // HTTP rate limiter derives its per-client key from the
  // `X-Forwarded-For` entry at `len - TRUSTED_PROXY_HOP_COUNT`, ignoring the
  // attacker-spoofable left side of the chain (see ADR-0019 +
  // SECURITY_CANON §Rate Limiting). Default 1 = exactly one trusted proxy/LB
  // appends the real client IP as the rightmost entry. Set to the actual
  // number of proxies in your ingress path (e.g. 2 for CDN → LB). A value of
  // 0 is rejected (it would key off the raw socket peer, which behind any
  // proxy is the proxy itself — collapsing every client into one bucket).
  TRUSTED_PROXY_HOP_COUNT: z.coerce.number().int().min(1).max(10).default(1),
  // Headless schema-only boot for OpenAPI dump tooling. When true,
  // createApp() skips the saga/EventService background block (Redis
  // pub/sub subscriber, recovery checker) so the dump script can extract
  // the full route schema without long-lived connections hanging the loop.
  SCHEMA_ONLY: boolFromString.default(false),

  // ── SSE per-account cap (DoS protection) ────────────────────────────
  // Max concurrent SSE connections per account per process. Authenticated
  // DoS surface: a user can open N streams; each allocates a subscription +
  // per-connection heartbeat. Default 10 covers typical multi-tab/multi-device
  // usage with headroom; raise for ops-heavy accounts after capacity review.
  MAX_STREAMS_PER_ACCOUNT: z.coerce.number().int().min(1).max(100).default(10),
} as const;

/**
 * Shared `onValidationError` handler: throw a single multi-line message listing
 * every offending key + its constraint. Preserves the precise error format so
 * the boot-failure message points at the Zod schema rule, not just
 * "validation failed". Shared between the module-level `env` and `parseApiEnv`.
 */
const onValidationError = (issues: readonly SchemaIssue[]): never => {
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
};

/**
 * @function parseApiEnv
 * @description Validate a runtime env object against the REAL apps/api server
 *   schema via `@t3-oss/env-core`. This is the single construction site for the
 *   validated env — the module-level `env` calls it with `process.env`, and the
 *   env fail-fast smoke test calls it with crafted objects so it exercises the
 *   ACTUAL schema definition (not a parallel copy). Fails fast: throws via
 *   `onValidationError` if any required key is missing or malformed. The return
 *   type is left to inference so importers get the precise per-key types.
 * @param runtimeEnv - The raw env map to validate (typically `process.env`).
 * @returns The typed, validated env object.
 */
export function parseApiEnv(runtimeEnv: Record<string, string | undefined>) {
  return createEnv({
    server: serverSchema,

    /**
     * `runtimeEnv` is the raw map to validate; t3-env validates the subset
     * declared in `server`. Next.js apps use a literal object so the Webpack
     * DefinePlugin can statically replace each key; this server app passes the
     * full map.
     */
    runtimeEnv,

    /**
     * `KEY=` in .env (empty value) becomes `undefined` so `.default()` and
     * `.optional()` behave intuitively. Otherwise an empty string would silently
     * satisfy `z.string().optional()` and bypass the intended fallback.
     */
    emptyStringAsUndefined: true,

    onValidationError,
  });
}

/**
 * `createEnv` from `@t3-oss/env-core` — canon 2026 wrapper around Zod env
 * validation. The module-level `env` is built from `process.env` via
 * `parseApiEnv` at module load. Provides:
 *   - `emptyStringAsUndefined: true` — `KEY=` becomes `undefined` so
 *     `.default()`/`.optional()` work as authored.
 *   - `onValidationError` — throws a single precise error listing every
 *     offending key with its constraint.
 *   - Forward-compatible with the Next.js wrapper (`@t3-oss/env-nextjs`) used
 *     by `apps/admin/lib/env.ts` and `apps/client/lib/env.ts`.
 */
export const env = parseApiEnv(process.env);

/**
 * `Env` is the inferred shape of the `env` constant. Importers can do
 * `import { env, type Env } from "../config/env.js"` if they need the type
 * for parameter signatures.
 */
export type Env = typeof env;
