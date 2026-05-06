-- CreateTable
CREATE TABLE "SecretRotationLog" (
    "id" TEXT NOT NULL,
    "secretCategory" TEXT NOT NULL,
    "secretName" TEXT NOT NULL,
    "rotatedAt" TIMESTAMPTZ(6) NOT NULL,
    "rotatedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecretRotationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SecretRotationLog_secretName_rotatedAt_idx" ON "SecretRotationLog"("secretName", "rotatedAt" DESC);

-- CreateIndex
CREATE INDEX "SecretRotationLog_secretCategory_idx" ON "SecretRotationLog"("secretCategory");

-- T0A baseline: every secret listed in docs/security/SECRETS.md §3-§5 was
-- rotated during the original T0A remediation on 2026-04-21. Seeding one row
-- per secret so the dashboard arrives populated instead of empty.
INSERT INTO "SecretRotationLog" ("id", "secretCategory", "secretName", "rotatedAt", "rotatedBy", "notes")
VALUES
  (gen_random_uuid()::text, 'KEK', 'PLATFORM_ENCRYPTION_KEY', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'KEK', 'OAUTH_ENCRYPTION_KEY', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'DB_PASSWORD', 'DATABASE_URL', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'REDIS_PASSWORD', 'REDIS_PASSWORD', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'JWT', 'JWT_ACCESS_SECRET', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'JWT', 'JWT_REFRESH_SECRET', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'JWT', 'CUSTOMER_JWT_SECRET', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'JWT', 'ADMIN_JWT_ACCESS_SECRET', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'JWT', 'ADMIN_JWT_REFRESH_SECRET', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'JWT', 'COOKIE_SECRET', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'S3_CREDENTIAL', 'S3_ACCESS_KEY_ID', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'S3_CREDENTIAL', 'S3_SECRET_ACCESS_KEY', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'AI_API_KEY', 'OPENAI_API_KEY', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'AI_API_KEY', 'PERPLEXITY_API_KEY', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'AI_API_KEY', 'GEMINI_API_KEY', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'EMAIL_API_KEY', 'RESEND_API_KEY', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'ANALYTICS_API_KEY', 'GA4_API_SECRET', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'PAYMENT_API_KEY', 'STRIPE_SECRET_KEY', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'PAYMENT_API_KEY', 'STRIPE_WEBHOOK_SECRET', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'PAYMENT_API_KEY', 'PADDLE_API_KEY', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'PAYMENT_API_KEY', 'PADDLE_WEBHOOK_SECRET', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'OAUTH_PROVIDER', 'FACEBOOK_CLIENT_SECRET', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'OAUTH_PROVIDER', 'INSTAGRAM_CLIENT_SECRET', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'OAUTH_PROVIDER', 'X_CLIENT_SECRET', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'OAUTH_PROVIDER', 'LINKEDIN_CLIENT_SECRET', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'OAUTH_PROVIDER', 'TIKTOK_CLIENT_SECRET', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'OAUTH_PROVIDER', 'YOUTUBE_CLIENT_SECRET', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'OAUTH_PROVIDER', 'PINTEREST_CLIENT_SECRET', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline'),
  (gen_random_uuid()::text, 'OAUTH_PROVIDER', 'SNAPCHAT_CLIENT_SECRET', '2026-04-21T00:00:00Z', NULL, 'T0A initial baseline');
