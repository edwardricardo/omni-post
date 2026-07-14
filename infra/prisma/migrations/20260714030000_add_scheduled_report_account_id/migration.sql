-- Enroll ScheduledReport in the tenant guard (tenant-guard rollout, Slice 2).
-- Add accountId, backfill from Project over the NOT-NULL projectId FK, assert no gaps remain,
-- tighten to NOT NULL, then wire the Account FK + index. This migration MUST sort BEFORE the
-- companion RLS migration (20260714030100_add_rls_scheduled_report), whose policy references
-- the "accountId" column added here. It also sorts AFTER the Slice-1 RLS migration
-- (20260714020135) per the rollout's per-slice ordering invariant.

-- 1. Add nullable so existing rows survive the ADD.
ALTER TABLE "ScheduledReport" ADD COLUMN "accountId" TEXT;

-- 2. Backfill from the owning Project. projectId is NOT NULL and Project.accountId is NOT NULL,
--    so this join covers every row (orphan-free).
UPDATE "ScheduledReport" s
SET "accountId" = p."accountId"
FROM "Project" p
WHERE s."projectId" = p."id";

-- 3. Fail the migration loudly if any row is still NULL (never SET NOT NULL on unbackfilled data).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ScheduledReport" WHERE "accountId" IS NULL) THEN
    RAISE EXCEPTION 'Backfill incomplete: ScheduledReport has rows with NULL accountId after the Project join';
  END IF;
END $$;

-- 4. Tighten to NOT NULL (atomic with the backfill inside Prisma's per-migration transaction).
ALTER TABLE "ScheduledReport" ALTER COLUMN "accountId" SET NOT NULL;

-- 5. Foreign key + index (Prisma naming convention).
ALTER TABLE "ScheduledReport"
  ADD CONSTRAINT "ScheduledReport_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ScheduledReport_accountId_idx" ON "ScheduledReport"("accountId");
