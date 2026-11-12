-- A migrated database holds no row of the application (docs/product/plan/chain.md, "The platform
-- starts from an empty database"). The 29 rows that 20260506193101_add_secret_rotation_log inserted
-- leave the rotation log: they say every catalogued secret was rotated on 2026-04-21, which is
-- false for a database whose secrets were generated later. Nothing writes this table yet; a
-- recorded rotation writes its rows when that capability is built (docs/product/plan/areas.md,
-- "An administrator checks which platform secrets are due for rotation").
--
-- The predicate names those 29 rows and no other: the note, the instant and the missing author
-- that migration gave them, and the 29 secrets it gave them to. A row that differs in any of
-- these stays, so neither a rotation recorded later nor a row written by hand for another
-- secret is removed.
DELETE FROM "SecretRotationLog"
WHERE "notes" = 'T0A initial baseline'
  AND "rotatedAt" = '2026-04-21T00:00:00Z'
  AND "rotatedBy" IS NULL
  AND ("secretCategory", "secretName") IN (
    ('KEK', 'PLATFORM_ENCRYPTION_KEY'),
    ('KEK', 'OAUTH_ENCRYPTION_KEY'),
    ('DB_PASSWORD', 'DATABASE_URL'),
    ('REDIS_PASSWORD', 'REDIS_PASSWORD'),
    ('JWT', 'JWT_ACCESS_SECRET'),
    ('JWT', 'JWT_REFRESH_SECRET'),
    ('JWT', 'CUSTOMER_JWT_SECRET'),
    ('JWT', 'ADMIN_JWT_ACCESS_SECRET'),
    ('JWT', 'ADMIN_JWT_REFRESH_SECRET'),
    ('JWT', 'COOKIE_SECRET'),
    ('S3_CREDENTIAL', 'S3_ACCESS_KEY_ID'),
    ('S3_CREDENTIAL', 'S3_SECRET_ACCESS_KEY'),
    ('AI_API_KEY', 'OPENAI_API_KEY'),
    ('AI_API_KEY', 'PERPLEXITY_API_KEY'),
    ('AI_API_KEY', 'GEMINI_API_KEY'),
    ('EMAIL_API_KEY', 'RESEND_API_KEY'),
    ('ANALYTICS_API_KEY', 'GA4_API_SECRET'),
    ('PAYMENT_API_KEY', 'STRIPE_SECRET_KEY'),
    ('PAYMENT_API_KEY', 'STRIPE_WEBHOOK_SECRET'),
    ('PAYMENT_API_KEY', 'PADDLE_API_KEY'),
    ('PAYMENT_API_KEY', 'PADDLE_WEBHOOK_SECRET'),
    ('OAUTH_PROVIDER', 'FACEBOOK_CLIENT_SECRET'),
    ('OAUTH_PROVIDER', 'INSTAGRAM_CLIENT_SECRET'),
    ('OAUTH_PROVIDER', 'X_CLIENT_SECRET'),
    ('OAUTH_PROVIDER', 'LINKEDIN_CLIENT_SECRET'),
    ('OAUTH_PROVIDER', 'TIKTOK_CLIENT_SECRET'),
    ('OAUTH_PROVIDER', 'YOUTUBE_CLIENT_SECRET'),
    ('OAUTH_PROVIDER', 'PINTEREST_CLIENT_SECRET'),
    ('OAUTH_PROVIDER', 'SNAPCHAT_CLIENT_SECRET')
  );
