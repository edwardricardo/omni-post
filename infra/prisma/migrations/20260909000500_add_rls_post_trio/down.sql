-- Rollback for 20260909000500_add_rls_post_trio (operator-run; Prisma never applies this).
-- Removes the three tenant_isolation policies and disables RLS on the three tables.
--
-- SCOPE. This reverses THIS migration only. It leaves the "accountId" columns, the
-- composite foreign keys and the (id, "accountId") uniques in place — those are earlier
-- migrations and are reverted, if ever, in reverse order after this one. That separation
-- is the point: dropping the policies restores the pre-RLS read path without touching the
-- structural tenant guarantee, so an RLS problem can be backed out without also backing
-- out referential integrity.
--
-- Dropping these policies re-opens cross-tenant reads for any raw SQL path that does not
-- filter by tenant itself; the application guard and the composite FK still stand.

-- Session-level SET, not SET LOCAL: this script is operator-run and is not guaranteed a
-- wrapping transaction, where SET LOCAL would warn and no-op. Values mirror the forward
-- migration. DROP POLICY and DISABLE ROW LEVEL SECURITY take ACCESS EXCLUSIVE briefly;
-- the lock_timeout bounds the wait behind a long-running query, not the hold.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DROP POLICY IF EXISTS tenant_isolation ON "Post";
DROP POLICY IF EXISTS tenant_isolation ON "PostContent";
DROP POLICY IF EXISTS tenant_isolation ON "PostMedia";

ALTER TABLE "Post" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "PostContent" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "PostMedia" DISABLE ROW LEVEL SECURITY;
