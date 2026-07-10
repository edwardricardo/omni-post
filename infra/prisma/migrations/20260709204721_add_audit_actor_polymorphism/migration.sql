-- Audit actor polymorphism: additive exclusive arc on "AuditLog".
-- Adds a CUSTOMER actor FK alongside the existing ADMIN ("userId") FK, an
-- "actorType" discriminator enum, a deterministic backfill, and a database
-- CHECK so a single row can never carry two actor FKs at once.
-- See docs/technical/ADR-0020-audit-actor-exclusive-arc.md for the rationale
-- and the down-migration SQL.

-- Actor discriminator. CREATE TYPE values are usable in the same transaction.
CREATE TYPE "AuditActorType" AS ENUM ('SYSTEM', 'ADMIN', 'CUSTOMER');

-- Metadata-only on PostgreSQL 11+ (repo runs pgvector/pgvector:pg16) --
-- no table rewrite, no long lock.
ALTER TABLE "AuditLog" ADD COLUMN "customerUserId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "actorType" "AuditActorType" NOT NULL DEFAULT 'SYSTEM';

-- Deterministic backfill: rewrites only rows with a non-null userId.
UPDATE "AuditLog" SET "actorType" = 'ADMIN' WHERE "userId" IS NOT NULL;

-- Exclusive arc (Karwin, SQL Antipatterns ch. 7). Existing rows pass by
-- construction: customerUserId is brand-new, hence all-NULL.
ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_actor_exclusive_arc_check"
  CHECK (num_nonnulls("userId", "customerUserId") <= 1);

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_customerUserId_fkey"
  FOREIGN KEY ("customerUserId") REFERENCES "CustomerUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AuditLog_customerUserId_createdAt_idx"
  ON "AuditLog"("customerUserId", "createdAt");
