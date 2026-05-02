/**
 * @file env.ts
 * @description Single source of truth for environment configuration. Validates
 *              `process.env` against a Zod schema at module load time and exports
 *              a typed `env` constant. Fails fast with a precise error if any
 *              required variable is missing or malformed.
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

import { z } from "zod";

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

const envSchema = z.object({
  // ── Core ──────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(["development", "production", "test", "staging"]).default("development"),
  PORT: portNumber.default(3000),
  HOST: z.string().default("0.0.0.0"),

  // ── Database (REQUIRED — boot fails without these) ────────────────────
  DATABASE_URL: urlString,
  SHADOW_DATABASE_URL: urlString,

  // ── Redis (URL preferred; legacy host/port/password kept for compat) ──
  REDIS_URL: urlString.optional(),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: portNumber.optional(),
  REDIS_PASSWORD: z.string().optional(),

  // ── Auth secrets (REQUIRED — CWE-798 zero tolerance) ──────────────────
  JWT_SECRET: z.string().min(SECRET_MIN).optional(), // legacy, used only by realtimeAnalytics
  JWT_ACCESS_SECRET: z.string().min(SECRET_MIN),
  JWT_REFRESH_SECRET: z.string().min(SECRET_MIN),
  CUSTOMER_JWT_SECRET: z.string().min(SECRET_MIN),
  ADMIN_JWT_ACCESS_SECRET: z.string().min(SECRET_MIN),
  ADMIN_JWT_REFRESH_SECRET: z.string().min(SECRET_MIN),
  COOKIE_SECRET: z.string().min(SECRET_MIN),

  // ── Cryptography (REQUIRED — encryption is core, not opt-in) ──────────
  PLATFORM_ENCRYPTION_KEY: z.string().min(SECRET_MIN),
  OAUTH_ENCRYPTION_KEY: z.string().min(SECRET_MIN),

  // ── URLs (frontends + base) ───────────────────────────────────────────
  ADMIN_URL: urlString.optional(),
  CLIENT_URL: urlString.optional(),
  CLIENT_APP_URL: urlString.optional(),
  FRONTEND_URL: urlString.optional(),
  API_BASE_URL: urlString.optional(),
  APP_BASE_URL: urlString.optional(),
  ALLOWED_MEDIA_HOSTS: z.string().optional(), // comma-separated host list

  // ── Logging ───────────────────────────────────────────────────────────
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  LOG_CACHE_OPS: boolFromString.optional(),

  // ── Telemetry ─────────────────────────────────────────────────────────
  TRACING_ENABLED: boolFromString.default(false),
  METRICS_PORT: portNumber.optional(),

  // ── Cache ─────────────────────────────────────────────────────────────
  MATERIALIZED_VIEW_REFRESH_INTERVAL: z.coerce.number().int().positive().optional(),

  // ── Storage (CONDITIONAL on STORAGE_PROVIDER) ─────────────────────────
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

  // ── Payment (CONDITIONAL on PAYMENT_PROVIDER) ─────────────────────────
  PAYMENT_PROVIDER: z.enum(["stripe", "paddle", "none"]).default("none"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  PADDLE_API_KEY: z.string().optional(),
  PADDLE_WEBHOOK_SECRET: z.string().optional(),
  PADDLE_SANDBOX: boolFromString.optional(),

  // ── AI providers (CONDITIONAL — features auto-disable if missing) ─────
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  PERPLEXITY_API_KEY: z.string().optional(),
  PERPLEXITY_MODEL: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),

  // ── Email (Resend) ────────────────────────────────────────────────────
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_ADDRESS: z.string().optional(),

  // ── Analytics (GA4) ───────────────────────────────────────────────────
  GA4_MEASUREMENT_ID: z.string().optional(),
  GA4_API_SECRET: z.string().optional(),
  GA4_ENDPOINT: urlString.optional(),

  // ── Provider OAuth — Facebook ─────────────────────────────────────────
  FACEBOOK_CLIENT_ID: z.string().optional(),
  FACEBOOK_CLIENT_SECRET: z.string().optional(),
  FACEBOOK_REDIRECT_URI: urlString.optional(),

  // ── Provider OAuth — Instagram ────────────────────────────────────────
  INSTAGRAM_CLIENT_ID: z.string().optional(),
  INSTAGRAM_CLIENT_SECRET: z.string().optional(),
  INSTAGRAM_REDIRECT_URI: urlString.optional(),

  // ── Provider OAuth — X (Twitter) ──────────────────────────────────────
  X_CLIENT_ID: z.string().optional(),
  X_CLIENT_SECRET: z.string().optional(),
  X_REDIRECT_URI: urlString.optional(),

  // ── Provider OAuth — LinkedIn ─────────────────────────────────────────
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  LINKEDIN_REDIRECT_URI: urlString.optional(),

  // ── Provider OAuth — TikTok ───────────────────────────────────────────
  TIKTOK_CLIENT_ID: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  TIKTOK_REDIRECT_URI: urlString.optional(),

  // ── Provider OAuth — YouTube ──────────────────────────────────────────
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_REDIRECT_URI: urlString.optional(),

  // ── Provider OAuth — Pinterest ────────────────────────────────────────
  PINTEREST_CLIENT_ID: z.string().optional(),
  PINTEREST_CLIENT_SECRET: z.string().optional(),
  PINTEREST_REDIRECT_URI: urlString.optional(),

  // ── Provider OAuth — Snapchat ─────────────────────────────────────────
  SNAPCHAT_CLIENT_ID: z.string().optional(),
  SNAPCHAT_CLIENT_SECRET: z.string().optional(),
  SNAPCHAT_REDIRECT_URI: urlString.optional(),

  // ── CRM — HubSpot ─────────────────────────────────────────────────────
  HUBSPOT_CLIENT_ID: z.string().optional(),
  HUBSPOT_REDIRECT_URI: urlString.optional(),

  // ── CRM — Salesforce ──────────────────────────────────────────────────
  SALESFORCE_CLIENT_ID: z.string().optional(),
  SALESFORCE_REDIRECT_URI: urlString.optional(),
  SALESFORCE_SANDBOX: boolFromString.optional(),

  // ── System tools (with sensible defaults) ─────────────────────────────
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  THUMBNAIL_TEMP_DIR: z.string().default("/tmp/claude/thumbnails"),
  VIDEO_TEMP_DIR: z.string().default("/tmp/claude/video"),

  // ── Feature flags ─────────────────────────────────────────────────────
  ENABLE_RATE_LIMITING: boolFromString.default(true),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse process.env once at module load. If any required variable is missing
 * or malformed, throw a precise error and refuse to boot. Tests must set
 * required keys via `.env.test` or `vi.stubEnv` — there is no test-mode bypass.
 */
function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Environment validation failed. Refusing to boot.\n\n` +
        `${issues}\n\n` +
        `Reference: docs/architecture/secrets-and-env.md for the complete schema and rotation runbook.`
    );
  }
  return result.data;
}

export const env: Env = parseEnv();
