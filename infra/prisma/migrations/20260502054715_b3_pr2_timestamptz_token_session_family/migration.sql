-- B3 PR-2: token/session family — DateTime → TIMESTAMPTZ(6) migration.
--
-- Affected models (12): AdminSession, TeamMember, ApiKey, DsarRequest,
-- AdminUser, CustomerUser, OidcConfiguration, SamlConfiguration,
-- SamlSession, WebhookSubscription, AdminUserPermission, AdminRoleHistory.
--
-- 46 columns flipped. Token expirations, session lifetimes, password reset
-- expiries, MFA timestamps — all canonical UTC instants.
--
-- Canon: PG 9.2+ no-rewrite optimization with session timezone = UTC +
-- USING col AT TIME ZONE 'UTC' = catalog-only flip (no table rewrite).
-- Existing TIMESTAMP data already represents UTC instants (Prisma writes
-- UTC), so on-disk bytes don't change — only pg_attribute.atttypid.
--
-- Defensive guards: lock_timeout = '5s' fail-fast on contention,
-- statement_timeout = '60s' bound the operation. No explicit BEGIN/COMMIT
-- (Prisma migrate auto-wraps).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL TIMEZONE = 'UTC';

-- AlterTable
ALTER TABLE "AdminRoleHistory" ALTER COLUMN "changedAt" TYPE TIMESTAMPTZ(6) USING "changedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "effectiveFrom" TYPE TIMESTAMPTZ(6) USING "effectiveFrom" AT TIME ZONE 'UTC',
ALTER COLUMN "effectiveUntil" TYPE TIMESTAMPTZ(6) USING "effectiveUntil" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "AdminSession" ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(6) USING "expiresAt" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "revokedAt" TYPE TIMESTAMPTZ(6) USING "revokedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "lastActivityAt" TYPE TIMESTAMPTZ(6) USING "lastActivityAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "AdminUser" ALTER COLUMN "lastLoginAt" TYPE TIMESTAMPTZ(6) USING "lastLoginAt" AT TIME ZONE 'UTC',
ALTER COLUMN "passwordResetExpires" TYPE TIMESTAMPTZ(6) USING "passwordResetExpires" AT TIME ZONE 'UTC',
ALTER COLUMN "passwordChangedAt" TYPE TIMESTAMPTZ(6) USING "passwordChangedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "lockedUntil" TYPE TIMESTAMPTZ(6) USING "lockedUntil" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "AdminUserPermission" ALTER COLUMN "grantedAt" TYPE TIMESTAMPTZ(6) USING "grantedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(6) USING "expiresAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "ApiKey" ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(6) USING "expiresAt" AT TIME ZONE 'UTC',
ALTER COLUMN "lastUsedAt" TYPE TIMESTAMPTZ(6) USING "lastUsedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "CustomerUser" ALTER COLUMN "emailVerifyExpiry" TYPE TIMESTAMPTZ(6) USING "emailVerifyExpiry" AT TIME ZONE 'UTC',
ALTER COLUMN "resetTokenExpiry" TYPE TIMESTAMPTZ(6) USING "resetTokenExpiry" AT TIME ZONE 'UTC',
ALTER COLUMN "lastLoginAt" TYPE TIMESTAMPTZ(6) USING "lastLoginAt" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "deletedAt" TYPE TIMESTAMPTZ(6) USING "deletedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "DsarRequest" ALTER COLUMN "deadlineAt" TYPE TIMESTAMPTZ(6) USING "deadlineAt" AT TIME ZONE 'UTC',
ALTER COLUMN "requestedAt" TYPE TIMESTAMPTZ(6) USING "requestedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "acknowledgedAt" TYPE TIMESTAMPTZ(6) USING "acknowledgedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "completedAt" TYPE TIMESTAMPTZ(6) USING "completedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "rejectedAt" TYPE TIMESTAMPTZ(6) USING "rejectedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "exportExpiresAt" TYPE TIMESTAMPTZ(6) USING "exportExpiresAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "OidcConfiguration" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "SamlConfiguration" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "SamlSession" ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(6) USING "expiresAt" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "TeamMember" ALTER COLUMN "joinedAt" TYPE TIMESTAMPTZ(6) USING "joinedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "inviteTokenExpiry" TYPE TIMESTAMPTZ(6) USING "inviteTokenExpiry" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "WebhookSubscription" ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(6) USING "expiresAt" AT TIME ZONE 'UTC',
ALTER COLUMN "lastVerified" TYPE TIMESTAMPTZ(6) USING "lastVerified" AT TIME ZONE 'UTC',
ALTER COLUMN "lastEventAt" TYPE TIMESTAMPTZ(6) USING "lastEventAt" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';
