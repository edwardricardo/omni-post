-- B3 PR-1: audit log family — DateTime → TIMESTAMPTZ(6) migration.
--
-- Affected models (8): AuditLog, AdminLoginAttempt, BillingEvent,
-- OutboxEvent, OutboxInbox, OutboxDeadLetter, StoredEvent, EventSnapshot.
--
-- 13 columns flipped + 2 normalized (StoredEvent.timestamp,
-- EventSnapshot.createdAt: empty parens → explicit (6)).
--
-- Canon: PostgreSQL 9.2+ no-rewrite optimization. With session timezone =
-- UTC, ALTER COLUMN TYPE TIMESTAMPTZ USING col AT TIME ZONE 'UTC' is a
-- catalog-only flip (sub-second metadata change, no table rewrite). The
-- existing TIMESTAMP data already represents UTC instants (Prisma writes
-- UTC), so the bytes don't change — only pg_attribute.atttypid.
--
-- lock_timeout = '5s' protects against long-held read locks pinning the
-- migration. If contention arises, retry off-peak.
--
-- Prisma migrate auto-wraps migrations in a transaction, so SET LOCAL
-- below is scoped to that wrapper (no explicit BEGIN/COMMIT).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL TIMEZONE = 'UTC';

-- AuditLog (1 column)
ALTER TABLE "AuditLog"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC';

-- AdminLoginAttempt (1 column)
ALTER TABLE "AdminLoginAttempt"
  ALTER COLUMN "attemptedAt" TYPE TIMESTAMPTZ(6) USING "attemptedAt" AT TIME ZONE 'UTC';

-- BillingEvent (2 columns)
ALTER TABLE "BillingEvent"
  ALTER COLUMN "processedAt" TYPE TIMESTAMPTZ(6) USING "processedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt"   TYPE TIMESTAMPTZ(6) USING "createdAt"   AT TIME ZONE 'UTC';

-- OutboxEvent (5 columns)
ALTER TABLE "OutboxEvent"
  ALTER COLUMN "occurredAt"  TYPE TIMESTAMPTZ(6) USING "occurredAt"  AT TIME ZONE 'UTC',
  ALTER COLUMN "publishedAt" TYPE TIMESTAMPTZ(6) USING "publishedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "nextRetryAt" TYPE TIMESTAMPTZ(6) USING "nextRetryAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt"   TYPE TIMESTAMPTZ(6) USING "createdAt"   AT TIME ZONE 'UTC',
  ALTER COLUMN "claimedAt"   TYPE TIMESTAMPTZ(6) USING "claimedAt"   AT TIME ZONE 'UTC';

-- OutboxDeadLetter (3 columns)
ALTER TABLE "OutboxDeadLetter"
  ALTER COLUMN "firstFailedAt" TYPE TIMESTAMPTZ(6) USING "firstFailedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "archivedAt"    TYPE TIMESTAMPTZ(6) USING "archivedAt"    AT TIME ZONE 'UTC',
  ALTER COLUMN "resolvedAt"    TYPE TIMESTAMPTZ(6) USING "resolvedAt"    AT TIME ZONE 'UTC';

-- outbox_inbox table (Prisma @@map'd from OutboxInbox)
ALTER TABLE "outbox_inbox"
  ALTER COLUMN "processedAt" TYPE TIMESTAMPTZ(6) USING "processedAt" AT TIME ZONE 'UTC';

-- StoredEvent + EventSnapshot: schema annotation normalized from
-- @db.Timestamptz() to @db.Timestamptz(6). Postgres default precision IS 6
-- already, so this is a no-op DDL — but we keep it explicit for canon
-- alignment and to silence Squawk's prefer-timestamp-tz rule.
