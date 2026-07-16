-- Enroll ProjectMember in the tenant guard (tenant-guard rollout, Slice 5).
-- Assert double-parent accountId consistency, add accountId, backfill from Project over the
-- NOT-NULL projectId FK, assert no gaps remain, tighten to NOT NULL, then wire the Account FK
-- + index. This migration MUST sort BEFORE the companion RLS migration
-- (20260716000100_add_rls_project_member), whose policy references the "accountId" column added
-- here. It also sorts AFTER the Slice-4 final migration (20260715000100) per the rollout's
-- per-slice ordering invariant.
--
-- Pre-check (operator remediation query if step 1 raises):
--   SELECT pm."id" FROM "ProjectMember" pm
--   JOIN "Project" p ON p."id" = pm."projectId"
--   JOIN "CustomerUser" cu ON cu."id" = pm."memberId"
--   WHERE p."accountId" <> cu."accountId";

-- 1. ProjectMember is the first enrolled model with TWO accountId-bearing parents (Project via
--    projectId, CustomerUser via memberId). Assert both parents agree BEFORE writing anything:
--    a mismatch is a corrupt cross-tenant membership that must be remediated manually — the
--    backfill must never mint a "legitimate" accountId for such a row.
DO $$
DECLARE mismatched INTEGER;
BEGIN
  SELECT COUNT(*) INTO mismatched
  FROM "ProjectMember" pm
  JOIN "Project" p ON p."id" = pm."projectId"
  JOIN "CustomerUser" cu ON cu."id" = pm."memberId"
  WHERE p."accountId" <> cu."accountId";
  IF mismatched > 0 THEN
    RAISE EXCEPTION 'ProjectMember double-parent mismatch: % row(s) where Project.accountId <> CustomerUser.accountId — corrupt cross-tenant membership; run the pre-check query in this migration header and remediate before enrolling', mismatched;
  END IF;
END $$;

-- 2. Add nullable so existing rows survive the ADD.
ALTER TABLE "ProjectMember" ADD COLUMN "accountId" TEXT;

-- 3. Backfill from the owning Project. projectId is NOT NULL and Project.accountId is NOT NULL,
--    so this join covers every row (orphan-free); step 1 proved the CustomerUser parent agrees.
UPDATE "ProjectMember" pm
SET "accountId" = p."accountId"
FROM "Project" p
WHERE pm."projectId" = p."id";

-- 4. Fail the migration loudly if any row is still NULL (never SET NOT NULL on unbackfilled data).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ProjectMember" WHERE "accountId" IS NULL) THEN
    RAISE EXCEPTION 'Backfill incomplete: ProjectMember has rows with NULL accountId after the Project join';
  END IF;
END $$;

-- 5. Tighten to NOT NULL (atomic with the backfill inside Prisma's per-migration transaction).
ALTER TABLE "ProjectMember" ALTER COLUMN "accountId" SET NOT NULL;

-- 6. Foreign key + index (Prisma naming convention).
ALTER TABLE "ProjectMember"
  ADD CONSTRAINT "ProjectMember_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ProjectMember_accountId_projectId_idx" ON "ProjectMember"("accountId", "projectId");
