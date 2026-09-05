-- Deletion-record two-phase retention + anti-confiscation partial uniques.
--
-- WHAT THIS CARRIES
--   1. DeletionRecord gains the two-phase retention lifecycle columns:
--      `reason` (the mandatory justification, previously validated and then
--      discarded), `retainUntil` + `lawfulBasis` (phase 1: plaintext PII held
--      under a named legal basis until the retention horizon), and
--      `nameDigest` + `nameDigestKeyVersion` (phase 2: the degradation job
--      replaces the plaintext with a keyed HMAC; the columns exist from day
--      one so the job is a data change, not a schema change). `name` becomes
--      nullable because phase 2 nulls it.
--   2. The retention FLOOR as a database CHECK: `retainUntil` can never be
--      earlier than `clientUntil` + 1 year. This is the third of three
--      enforcement layers (Zod refuses to boot outside 1..7 years; the write
--      path clamps; this constraint stops even a manual INSERT). A floor only
--      the application enforces is a floor a psql session can ignore.
--   3. The anti-confiscation fix: `Account.email` and `Project.(accountId,
--      name)` uniqueness now applies to LIVE rows only (`WHERE "deletedAt" IS
--      NULL`). With the previous TOTAL uniques, soft-deleting a project named
--      "Marketing" confiscated that name forever: every read filters
--      soft-deleted rows, so the P2002 pointed at a row no reader could see.
--      Two soft-deleted rows may share a name by design; the restore path
--      resolves a live-name collision explicitly with a CONFLICT.
--
-- LOCK ANALYSIS
--   The ADD COLUMNs are catalog-only (nullable, or NOT NULL with a constant
--   DEFAULT — a metadata write since PostgreSQL 11), and DeletionRecord is a
--   tombstone table whose row count is bounded by deletions performed, so its
--   UPDATE backfill is trivially small.
--
--   The retention-floor CHECK is added NOT VALID here and VALIDATEd by the
--   companion migration 20260901120100_deletion_record_retention_floor_validate.
--   Prisma runs each migration file in its own transaction, so the split is a
--   real one: ADD CONSTRAINT ... NOT VALID takes ACCESS EXCLUSIVE without
--   scanning, and the VALIDATE runs in the NEXT transaction under SHARE UPDATE
--   EXCLUSIVE, which does not block reads or writes while it scans. Doing both
--   in ONE transaction would hold ACCESS EXCLUSIVE across the scan and would be
--   NOT VALID in name only. This mirrors the alignment/validate pair at
--   20260830220417 + 20260830220517.
--
--   The unique-index swaps rebuild indexes on Account and Project inside this
--   transaction; both tables are small enough that a non-CONCURRENT build
--   inside the declared timeouts is cheaper and safer than CONCURRENTLY, which
--   CANNOT run in a transaction at all (PostgreSQL rejects it) and would leave
--   an INVALID index behind on failure. If either table grows to where the
--   build exceeds the lock budget, the timeouts below abort the whole
--   transaction cleanly and this migration must be revisited as a CONCURRENTLY
--   runbook driven outside Prisma's migration engine.
--
-- ERRATUM for the two deployed predecessors (recorded here because editing an
-- applied migration breaks its checksum and every existing database):
--   20260830220417_ondelete_convention_alignment and its _validate companion
--   state "24 FK actions" in their headers; the measured count is 25. The
--   VALIDATE file inherited the miscount from the alignment file. Their SQL is
--   correct; only the prose number is wrong.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1a. Phase-2 columns and nullable name (all catalog-only).
ALTER TABLE "DeletionRecord" ALTER COLUMN "name" DROP NOT NULL;
ALTER TABLE "DeletionRecord" ADD COLUMN "nameDigest" TEXT;
ALTER TABLE "DeletionRecord" ADD COLUMN "nameDigestKeyVersion" INTEGER;

-- 1b. reason: NOT NULL for every new write; rows that predate the column get
-- an honest backfill value that says exactly what it is, then the default is
-- dropped so the application cannot lean on it.
ALTER TABLE "DeletionRecord" ADD COLUMN "reason" TEXT NOT NULL DEFAULT 'unrecorded (row predates the reason column)';
ALTER TABLE "DeletionRecord" ALTER COLUMN "reason" DROP DEFAULT;

-- 1c. retainUntil: backfilled per row from its own clientUntil at the 7-year
-- policy default (a constant DEFAULT cannot reference another column), then
-- locked NOT NULL.
ALTER TABLE "DeletionRecord" ADD COLUMN "retainUntil" TIMESTAMPTZ(6);
UPDATE "DeletionRecord" SET "retainUntil" = "clientUntil" + interval '7 years' WHERE "retainUntil" IS NULL;
ALTER TABLE "DeletionRecord" ALTER COLUMN "retainUntil" SET NOT NULL;

-- 1d. lawfulBasis: same backfill-then-drop-default shape as reason.
ALTER TABLE "DeletionRecord" ADD COLUMN "lawfulBasis" TEXT NOT NULL DEFAULT 'GDPR Art. 17(3)(e) - retained for the establishment, exercise or defence of legal claims (backfilled: row predates the column)';
ALTER TABLE "DeletionRecord" ALTER COLUMN "lawfulBasis" DROP DEFAULT;

-- 2. The retention floor, added NOT VALID so this transaction does not scan the
-- table while holding ACCESS EXCLUSIVE. NOT VALID still enforces the constraint
-- on every INSERT and UPDATE from this point on — it only defers the check of
-- pre-existing rows. Those rows were backfilled at clientUntil + 7 years by 1c
-- above, so they satisfy the >= 1 year floor by construction and the companion
-- VALIDATE migration cannot fail on them.
ALTER TABLE "DeletionRecord" ADD CONSTRAINT "DeletionRecord_retainUntil_floor"
  CHECK ("retainUntil" >= "clientUntil" + interval '1 year') NOT VALID;

-- 3. Phase-2 job scan index: only rows still holding plaintext are candidates
-- for degradation, so the index is partial on name IS NOT NULL.
CREATE INDEX "DeletionRecord_retainUntil_idx" ON "DeletionRecord"("retainUntil") WHERE "name" IS NOT NULL;

-- 4. Anti-confiscation: total uniques become live-rows-only partial uniques,
-- keeping the Prisma-conventional names so the client's P2002 mapping is
-- unchanged.
DROP INDEX "Account_email_key";
CREATE UNIQUE INDEX "Account_email_key" ON "Account"("email") WHERE "deletedAt" IS NULL;

DROP INDEX "Project_accountId_name_key";
CREATE UNIQUE INDEX "Project_accountId_name_key" ON "Project"("accountId", "name") WHERE "deletedAt" IS NULL;
