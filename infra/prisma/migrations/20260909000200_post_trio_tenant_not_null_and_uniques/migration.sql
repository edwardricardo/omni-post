-- Tenant column for the Post trio, step 3 of 6: make the column mandatory, and build
-- the two FK targets plus the one new read index.
--
-- WHY NOT NULL IS NOT OPTIONAL HERE. A composite foreign key is declared MATCH SIMPLE by
-- default, and MATCH SIMPLE SKIPS THE CHECK ENTIRELY whenever ANY referencing column is
-- NULL. A nullable "accountId" would therefore turn the tenant guarantee off for exactly
-- the rows that omit it — the constraint would still be listed in the catalog and would
-- still enforce nothing. NOT NULL on all three referencing columns is what forecloses
-- that escape, and it is asserted directly by the integration suite rather than assumed.
--
-- WHY THE UNIQUES ARE TOTAL. PostgreSQL cannot reference a PARTIAL unique index from a
-- foreign key: the FK target index must cover every row. `Project` already carries a
-- PARTIAL unique on (accountId, name) so a soft-deleted project does not confiscate its
-- name; that one stays exactly as it is. The new (id, "accountId") uniques are separate
-- objects with no `WHERE` clause, and they must stay that way — a child pointing at a
-- soft-deleted parent still needs its FK target to exist.
--
-- WHY THE NEW INDEX LANDS IN THIS FILE. It cannot be built before the column exists, and
-- building it before the backfill would make every batched UPDATE in step 2 pay index
-- maintenance on rows it is about to rewrite. Here the data is final and the index is
-- built once. It is the ONE new index this change adds: the account-wide feed is the only
-- measured read that sequentially scans "Post", because every existing "Post" index is
-- projectId-led and that query supplies no projectId (evidence: the pre-migration capture
-- in docs/reports/TENANT_RLS_AB_MEASUREMENT.md). It also serves the tenant qual of the RLS
-- policy added in step 6. "PostContent" and "PostMedia" deliberately get NO accountId-led
-- index: their reads are parent-key-led, and the exemption plus its revisit trigger are
-- recorded in docs/security/MULTI_TENANT_GUARDS.md.
--
-- LOCKS, CHARACTERIZED HONESTLY. `SET NOT NULL` takes ACCESS EXCLUSIVE and HOLDS it
-- through a full-table verification scan. `CREATE [UNIQUE] INDEX` without CONCURRENTLY
-- takes SHARE, which blocks writers (readers proceed) for the whole build. `lock_timeout`
-- bounds only the WAIT to ACQUIRE each lock — it does NOT bound the HOLD, so a large table
-- can block writers well past 5s once the lock is granted. That is acceptable for today's
-- single deployable (dev and CI, no production traffic) and is stated so a future operator
-- does not read the timeout as a duration guarantee.
--
-- LIVE-PATH VARIANTS, named here for the runbook rather than used here:
--   * NOT NULL without a blocking scan (PG12+): ADD CONSTRAINT ... CHECK ("accountId" IS
--     NOT NULL) NOT VALID -> VALIDATE CONSTRAINT (SHARE UPDATE EXCLUSIVE) -> SET NOT NULL,
--     which reuses the validated CHECK and skips its own scan -> DROP CONSTRAINT.
--   * Uniques without blocking writers: CREATE UNIQUE INDEX CONCURRENTLY, then
--     ALTER TABLE ... ADD CONSTRAINT ... UNIQUE USING INDEX. CONCURRENTLY cannot run
--     inside a transaction, so it would have to leave the migration file entirely.
--
-- An abort here rolls the whole file back and leaves a failed ledger row: recover with
-- `migrate resolve --rolled-back`, never a bare re-run (docs/architecture/schema-conventions.md,
-- "Recovering a failed migration").

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

-- The backfill in step 2 aborts its own transaction unless every row resolved, so these
-- three scans find no NULLs by construction.
ALTER TABLE "Post" ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "PostContent" ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "PostMedia" ALTER COLUMN "accountId" SET NOT NULL;

-- FK targets for step 4. Names and form match what `prisma migrate dev` generates from
-- the corresponding `@@unique([id, accountId])`, so the migration history and the schema
-- describe the same database object and drift detection stays quiet.
CREATE UNIQUE INDEX "Project_id_accountId_key" ON "Project" ("id", "accountId");
CREATE UNIQUE INDEX "Post_id_accountId_key" ON "Post" ("id", "accountId");

-- The one new read index.
CREATE INDEX "Post_accountId_projectId_idx" ON "Post" ("accountId", "projectId") WHERE ("deletedAt" IS NULL);
