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
import { TRUSTED_PROXY_MODES, parseTrustedProxyRanges } from "../security/trustedProxy.js";

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
  // Custom S3 endpoint for S3-compatible backends (MinIO, LocalStack).
  // When set, the adapter switches to path-style addressing. Omit for AWS S3.
  S3_ENDPOINT: z.string().optional(),
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

  // ── Saga wait-step poll cadence ─────────────────────────────────────
  // How long a saga step that has NOT FINISHED waits before the engine asks it
  // again, in milliseconds. It is a POLL cadence for work happening elsewhere
  // (publish jobs on the queue), never an error backoff: a waiting step spends
  // no retry budget, so nothing about it grows with a retry count. Worker
  // completion events remain the primary advance; this bounds how long a LOST
  // event can stall a saga, and it is therefore also the tail a publish pays
  // when its completion event races the queue's own state update. Default
  // 30 000 — at the retry policy's 5 s a waiting step would be re-entered up to
  // 360 times per saga across the 30-minute horizon; at 30 s the worst case is
  // 60. Lower it where publish jobs are fast and the queue is cheap to read.
  SAGA_WAIT_POLL_MS: z.coerce.number().int().min(1000).max(300_000).default(30_000),

  // ── Trusted proxy model (rate-limit / IP-allowlist keying) ─────────────
  // Which peer this app believes when it claims to forward on someone's behalf.
  // `socket-only` (fail-closed default) ignores every forwarding header and keys
  // on the socket peer: always spoof-safe, but behind a proxy every caller
  // shares one bucket (availability risk, never a bypass). `trusted-ranges`
  // keys on the address a TRUSTED proxy vouched for, where "trusted" is the
  // TRUSTED_PROXY_RANGES allowlist matched against the IMMEDIATE PEER.
  //
  // There is deliberately no hop-count model: fastify >= 5.12.1 makes numeric
  // `trustProxy` fail closed ("Hop-count-only trust cannot validate the
  // immediate peer" — GHSA-3m5p-2c4r-xxw2). See ADR-0021 and SECURITY_CANON.md
  // §Rate Limiting for the topology invariant that both models depend on.
  TRUSTED_PROXY_MODE: z.enum(TRUSTED_PROXY_MODES).default("socket-only"),

  // Comma-separated IP / CIDR / preset entries (`loopback`, `linklocal`,
  // `uniquelocal`) identifying the reverse proxies in front of this app —
  // REQUIRED by, and only meaningful under, TRUSTED_PROXY_MODE=trusted-ranges.
  // The pair is cross-validated below; an inconsistent pair refuses to boot.
  // List ONLY real proxy addresses: every address in here may assert any
  // client identity in X-Forwarded-For, so a broad tenant subnet here hands
  // that power to everything inside it.
  TRUSTED_PROXY_RANGES: z.string().optional(),

  // NOTE: the removed TRUSTED_PROXY_HOP_COUNT is deliberately NOT declared here.
  // It is rejected from the raw runtime env in `createFinalSchema` below, so it
  // stays out of the validated env's type while still refusing to boot when an
  // operator leaves it set (see the tripwire there for why silence is unsafe).

  // ── DeletionRecord plaintext retention window ───────────────────────
  // How long a tombstone keeps the deleted entity's `name` in PLAINTEXT, in
  // years, counted from the moment of the hard delete (`clientUntil`). After it
  // the degradation job replaces the plaintext with an HMAC digest; the
  // tombstone survives forever, the readable PII does not.
  //
  // The `.min(1)` is NOT a tuning knob, it is the FLOOR of the retention
  // invariant, and it is enforced on three layers because a floor only one layer
  // knows about is a comment: this schema (the app refuses to BOOT below it —
  // no fallback, no clamp-and-warn, per SECURITY_CANON §Secrets and
  // Environment), a clamp applied where `retainUntil` is computed, and the
  // `DeletionRecord_retainUntil_floor` CHECK constraint that catches a
  // manual INSERT or any future write path that forgets the clamp. Dropping
  // `.min(1)` here silently disarms only the outermost layer, which is exactly
  // why the other two exist.
  //
  // `.max(7)` is the opposite kind of bound: policy, not invariant. Seven years
  // is the longest window the lawful basis on the row is written to justify, so
  // a larger value would keep PII past its own justification. Widening it is a
  // compliance decision, lowering the floor is not available.
  DELETION_RECORD_RETENTION_YEARS: z.coerce.number().int().min(1).max(7).default(7),
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
     * Cross-field validation hook. Per-key schemas cannot see each other, and
     * the trusted-proxy MODE and RANGES are only meaningful as a pair: selecting
     * `trusted-ranges` without a valid range list has no safe interpretation, so
     * it must refuse to boot rather than silently degrade to `socket-only` and
     * collapse every caller into one rate-limit bucket. This is the boundary
     * rejection; `TrustedProxyPolicy`'s non-empty tuple is what makes the state
     * unrepresentable once past it (see security/trustedProxy.ts).
     */
    createFinalSchema: (shape) =>
      z.object(shape).superRefine((value, ctx) => {
        const mode = (value as { TRUSTED_PROXY_MODE?: string }).TRUSTED_PROXY_MODE;
        const raw = (value as { TRUSTED_PROXY_RANGES?: string }).TRUSTED_PROXY_RANGES;
        const parsed = parseTrustedProxyRanges(raw);

        if (mode === "trusted-ranges" && !parsed.ok) {
          ctx.addIssue({
            code: "custom",
            path: ["TRUSTED_PROXY_RANGES"],
            message:
              `${parsed.reason} — required when TRUSTED_PROXY_MODE=trusted-ranges. ` +
              "Refusing to boot rather than falling back to socket-only, which would " +
              "collapse every caller into one shared rate-limit bucket without saying so.",
          });
        }

        if (mode === "socket-only" && parsed.ok) {
          ctx.addIssue({
            code: "custom",
            path: ["TRUSTED_PROXY_RANGES"],
            message:
              "TRUSTED_PROXY_RANGES is set but TRUSTED_PROXY_MODE=socket-only ignores every " +
              "forwarding header, so the list would never be consulted while reading as " +
              "though it were. Set TRUSTED_PROXY_MODE=trusted-ranges, or clear the ranges.",
          });
        }

        // Removal tripwire for TRUSTED_PROXY_HOP_COUNT. Read from the RAW env
        // rather than the parsed value so the dead key never enters the env's
        // type. Leaving it merely unread would be the trap this change exists to
        // remove: an operator who still sets it believes hop-count trust is in
        // force, while fastify >= 5.12.1 ignores it completely. Delete this
        // block once no deployed environment sets the variable.
        const legacyHopCount = runtimeEnv["TRUSTED_PROXY_HOP_COUNT"];
        if (legacyHopCount !== undefined && legacyHopCount.trim() !== "") {
          ctx.addIssue({
            code: "custom",
            path: ["TRUSTED_PROXY_HOP_COUNT"],
            message:
              "TRUSTED_PROXY_HOP_COUNT was removed (ADR-0021). Hop-count proxy trust is " +
              "fail-closed in fastify >= 5.12.1, so this value is read by nothing and its " +
              "presence misrepresents the deployment. Use TRUSTED_PROXY_MODE=socket-only " +
              "(equivalent to the old 0), or TRUSTED_PROXY_MODE=trusted-ranges with " +
              "TRUSTED_PROXY_RANGES set to your proxy IPs/CIDRs.",
          });
        }
      }),

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
