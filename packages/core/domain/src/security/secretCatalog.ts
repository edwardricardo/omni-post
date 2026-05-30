/**
 * @file secretCatalog.ts
 * @description Domain-level catalog of every secret managed by omni-post plus
 *              its NIST cryptoperiod cadence. Pure constants — no env access,
 *              no I/O. Used by the secret-rotation-status feature to enumerate
 *              secrets and compute due/overdue status.
 * @layer domain
 */

export const SECRET_CATEGORY_VALUES = [
  "KEK",
  "JWT",
  "DB_PASSWORD",
  "REDIS_PASSWORD",
  "S3_CREDENTIAL",
  "AI_API_KEY",
  "EMAIL_API_KEY",
  "ANALYTICS_API_KEY",
  "PAYMENT_API_KEY",
  "OAUTH_PROVIDER",
] as const;

export type SecretCategory = (typeof SECRET_CATEGORY_VALUES)[number];

export interface SecretCategoryRule {
  cadenceDays: number;
  description: string;
}

/**
 * NIST SP 800-57 Part 1 Rev 5 cryptoperiods. Cadences are policy, not
 * configuration — they live in domain so they can't drift through env.
 */
export const SECRET_CATEGORIES: Record<SecretCategory, SecretCategoryRule> = {
  KEK: { cadenceDays: 365, description: "Symmetric key-encryption keys (master keys)" },
  JWT: { cadenceDays: 90, description: "JWT signing keys + cookie integrity secret" },
  DB_PASSWORD: { cadenceDays: 365, description: "Database role password" },
  REDIS_PASSWORD: { cadenceDays: 365, description: "Redis ACL password" },
  S3_CREDENTIAL: { cadenceDays: 365, description: "Static IAM credentials for object storage" },
  AI_API_KEY: { cadenceDays: 365, description: "Third-party LLM provider API keys" },
  EMAIL_API_KEY: { cadenceDays: 365, description: "Transactional email provider API key" },
  ANALYTICS_API_KEY: { cadenceDays: 365, description: "Analytics measurement-protocol API key" },
  PAYMENT_API_KEY: { cadenceDays: 365, description: "Payment provider API key + webhook secret" },
  OAUTH_PROVIDER: {
    cadenceDays: 365,
    description: "Provider OAuth client secrets (re-issue cap)",
  },
};

export interface SecretEntry {
  /** Stable identifier; matches `secret_rotation_logs.secretName`. */
  readonly name: string;
  /** Category drives the cadence rule applied. */
  readonly category: SecretCategory;
  /** Human-readable description of what the secret is used for. */
  readonly description: string;
}

/**
 * Every secret tracked for rotation. Order is stable for UI display.
 */
export const SECRETS_CATALOG: readonly SecretEntry[] = [
  // §3 — Master keys
  {
    name: "PLATFORM_ENCRYPTION_KEY",
    category: "KEK",
    description: "AES-256-GCM master key for Class A columns (Channel.credentials et al.)",
  },
  {
    name: "OAUTH_ENCRYPTION_KEY",
    category: "KEK",
    description: "AES-256-GCM master key for ProviderConnection token columns",
  },

  // > 4.1 — Database
  {
    name: "DATABASE_URL",
    category: "DB_PASSWORD",
    description: "PostgreSQL connection string with embedded role password",
  },

  // > 4.2 — Redis
  {
    name: "REDIS_PASSWORD",
    category: "REDIS_PASSWORD",
    description: "Redis ACL password (when ACL enabled)",
  },

  // > 4.3 — Auth / sessions
  {
    name: "JWT_ACCESS_SECRET",
    category: "JWT",
    description: "Customer-facing JWT access tokens",
  },
  {
    name: "JWT_REFRESH_SECRET",
    category: "JWT",
    description: "Customer-facing JWT refresh tokens",
  },
  {
    name: "CUSTOMER_JWT_SECRET",
    category: "JWT",
    description: "Customer SDK / portal API JWTs",
  },
  {
    name: "ADMIN_JWT_ACCESS_SECRET",
    category: "JWT",
    description: "Admin app access tokens",
  },
  {
    name: "ADMIN_JWT_REFRESH_SECRET",
    category: "JWT",
    description: "Admin app refresh tokens",
  },
  {
    name: "COOKIE_SECRET",
    category: "JWT",
    description: "Signed-cookie integrity secret",
  },

  // > 4.4 — Storage (S3)
  {
    name: "S3_ACCESS_KEY_ID",
    category: "S3_CREDENTIAL",
    description: "S3 / MinIO access key ID",
  },
  {
    name: "S3_SECRET_ACCESS_KEY",
    category: "S3_CREDENTIAL",
    description: "S3 / MinIO secret access key",
  },

  // > 5.1 — AI providers
  { name: "OPENAI_API_KEY", category: "AI_API_KEY", description: "OpenAI GPT API key" },
  { name: "PERPLEXITY_API_KEY", category: "AI_API_KEY", description: "Perplexity API key" },
  { name: "GEMINI_API_KEY", category: "AI_API_KEY", description: "Google Gemini API key" },

  // > 5.2 — Email
  {
    name: "RESEND_API_KEY",
    category: "EMAIL_API_KEY",
    description: "Resend transactional email API key",
  },

  // > 5.3 — Analytics
  {
    name: "GA4_API_SECRET",
    category: "ANALYTICS_API_KEY",
    description: "GA4 Measurement Protocol API secret",
  },

  // > 5.4 — Payment
  {
    name: "STRIPE_SECRET_KEY",
    category: "PAYMENT_API_KEY",
    description: "Stripe secret API key",
  },
  {
    name: "STRIPE_WEBHOOK_SECRET",
    category: "PAYMENT_API_KEY",
    description: "Stripe webhook signature verification secret",
  },
  {
    name: "PADDLE_API_KEY",
    category: "PAYMENT_API_KEY",
    description: "Paddle billing API key",
  },
  {
    name: "PADDLE_WEBHOOK_SECRET",
    category: "PAYMENT_API_KEY",
    description: "Paddle webhook signature verification secret",
  },

  // > 5.5 — Provider OAuth client secrets
  {
    name: "FACEBOOK_CLIENT_SECRET",
    category: "OAUTH_PROVIDER",
    description: "Facebook (Meta) OAuth app secret",
  },
  {
    name: "INSTAGRAM_CLIENT_SECRET",
    category: "OAUTH_PROVIDER",
    description: "Instagram (Meta) OAuth app secret",
  },
  {
    name: "X_CLIENT_SECRET",
    category: "OAUTH_PROVIDER",
    description: "X (Twitter) OAuth 2.0 client secret",
  },
  {
    name: "LINKEDIN_CLIENT_SECRET",
    category: "OAUTH_PROVIDER",
    description: "LinkedIn OAuth 2.0 client secret",
  },
  {
    name: "TIKTOK_CLIENT_SECRET",
    category: "OAUTH_PROVIDER",
    description: "TikTok Marketing API client secret",
  },
  {
    name: "YOUTUBE_CLIENT_SECRET",
    category: "OAUTH_PROVIDER",
    description: "YouTube (Google Cloud Console) OAuth client secret",
  },
  {
    name: "PINTEREST_CLIENT_SECRET",
    category: "OAUTH_PROVIDER",
    description: "Pinterest OAuth 2.0 client secret",
  },
  {
    name: "SNAPCHAT_CLIENT_SECRET",
    category: "OAUTH_PROVIDER",
    description: "Snapchat Marketing API client secret",
  },
] as const;
