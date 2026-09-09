-- Tenant column for the Post trio, step 1 of 6: add the column, nothing else.
--
-- WHY THIS IS ITS OWN FILE. `Post`, `PostContent` and `PostMedia` are the only
-- tenant-owned tables in the schema with no `accountId` of their own: their tenant
-- identity lives one or two tables away, reachable only by joining up to `Project`.
-- That is what makes the account-wide feed unanswerable by any existing index, and
-- what makes the bulk-mutation tenant gate walk `Project` on every call (measured:
-- docs/reports/TENANT_RLS_AB_MEASUREMENT.md, the pre-migration capture). It is also
-- why neither table can carry an RLS policy today — a policy needs a local column.
--
-- The column lands NULLABLE here and becomes NOT NULL three files later, after the
-- backfill. Adding a nullable column with no default is CATALOG-ONLY on PostgreSQL 11+
-- (no table rewrite, no row-by-row work), so this file is milliseconds regardless of
-- table size. Adding it as NOT NULL in one shot — which is what `prisma migrate dev`
-- generates from the schema, and what is deliberately NOT used here — would either
-- fail outright on a non-empty table or force a full rewrite under ACCESS EXCLUSIVE.
--
-- LOCKS. Each ALTER takes ACCESS EXCLUSIVE on its table for the catalog update only.
-- `lock_timeout` bounds the WAIT to acquire that lock behind an in-flight reader; it
-- does NOT bound how long the lock is held once acquired. An abort here rolls the whole
-- file back and leaves a failed ledger row: recovery is `migrate resolve --rolled-back`,
-- never a bare re-run (docs/architecture/schema-conventions.md, "Recovering a failed
-- migration").

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "Post" ADD COLUMN "accountId" TEXT;
ALTER TABLE "PostContent" ADD COLUMN "accountId" TEXT;
ALTER TABLE "PostMedia" ADD COLUMN "accountId" TEXT;
