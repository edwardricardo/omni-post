-- Backfill SagaInstance.accountId with the TRUE tenant (core-publishing
-- correctness workstream). The saga engine historically persisted the caller's
-- CustomerUser.id into this column; guard enrollment made the column
-- tenant-semantic, so existing rows must be repaired to the owning
-- Account.id. Data-only, idempotent, re-runnable; single transaction
-- (Prisma wraps the file in one tx — every statement commits or none).
--
-- Disposition (four classes, order matters):
--   1. metadata-first (authoritative): the saga context carries the tenant at
--      metadata.accountId; repairs userId-corrupted AND NULL rows alike.
--   2. join-mappable: rows still holding a live CustomerUser.id map through
--      that user's owning account.
--   3. terminal residuals: sentinel NULL + RAISE NOTICE count — evidence
--      preserved, never deleted, no fake FK-looking value invented.
--   4. non-terminal residuals: RAISE EXCEPTION listing ids — a live saga
--      without a true tenant is not safely recoverable; abort, no partial
--      commit.
--
-- Cutover runbook: in the migrate-deploy -> code-cutover gap, old code may
-- write a handful of fresh userId rows; every statement here is idempotent —
-- re-run the file manually post-cutover. The engine's fail-loud tenant
-- rehydration surfaces any straggler.

-- 1. Metadata-first repair (covers corrupted values AND NULL).
UPDATE "SagaInstance" si
SET "accountId" = si."context"->'metadata'->>'accountId'
WHERE ("accountId" IS NULL OR "accountId" NOT IN (SELECT id FROM "Account"))
  AND si."context"->'metadata'->>'accountId' IN (SELECT id FROM "Account");

-- 2. Join repair for rows still holding a live CustomerUser.id.
UPDATE "SagaInstance" si
SET "accountId" = cu."accountId"
FROM "CustomerUser" cu
WHERE si."accountId" = cu."id"
  AND si."accountId" IS NOT NULL
  AND si."accountId" NOT IN (SELECT id FROM "Account");

-- 3. Terminal residuals: sentinel NULL, counted loudly, never deleted.
DO $$
DECLARE sentinel_count INTEGER;
BEGIN
  WITH sentineled AS (
    UPDATE "SagaInstance"
    SET "accountId" = NULL
    WHERE "accountId" IS NOT NULL
      AND "accountId" NOT IN (SELECT id FROM "Account")
      AND "status" IN ('COMPLETED', 'FAILED', 'COMPENSATED')
    RETURNING id
  )
  SELECT COUNT(*) INTO sentinel_count FROM sentineled;
  IF sentinel_count > 0 THEN
    RAISE NOTICE 'SagaInstance backfill: % terminal row(s) had no mappable tenant; accountId set to the NULL sentinel (ids preserved for audit)', sentinel_count;
  END IF;
END $$;

-- 4. Non-terminal residuals: abort loudly with the offending ids.
DO $$
DECLARE bad_ids TEXT;
BEGIN
  SELECT string_agg(id, ', ') INTO bad_ids
  FROM "SagaInstance"
  WHERE ("accountId" IS NULL OR "accountId" NOT IN (SELECT id FROM "Account"))
    AND "status" NOT IN ('COMPLETED', 'FAILED', 'COMPENSATED');
  IF bad_ids IS NOT NULL THEN
    RAISE EXCEPTION 'SagaInstance backfill: non-terminal row(s) with no mappable tenant cannot be safely recovered — remediate manually before migrating: %', bad_ids;
  END IF;
END $$;
