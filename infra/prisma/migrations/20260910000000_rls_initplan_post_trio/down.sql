-- Rollback for 20260910000000_rls_initplan_post_trio (operator-run; Prisma never applies this).
-- Restores the three trio `tenant_isolation` policies to their unwrapped bodies.
--
-- SCOPE. This reverses THIS migration only. RLS stays ENABLED on all three tables and the
-- policies stay installed — only their bodies revert. Nothing structural is touched: the
-- "accountId" columns, the composite foreign keys and the (id, "accountId") uniques belong
-- to earlier migrations and are unaffected. That separation is the point: a plan regression
-- traced to the wrapped form can be backed out WITHOUT reopening cross-tenant reads for one
-- second, which is what disabling the policies would do.
--
-- The bodies below are the bytes of 20260909000500_add_rls_post_trio/migration.sql,
-- reproduced verbatim rather than paraphrased, so the restored object is textually the
-- object that migration installed and a catalog comparison after rollback is exact.
--
-- WHAT REVERTING COSTS. The unwrapped body re-evaluates `current_setting('app.account_id',
-- true)` once per candidate row. On the measured corpus that is a 2.23-2.27x scan-node
-- penalty on the row-scanning reads (docs/reports/TENANT_RLS_AB_MEASUREMENT.md, section
-- "The superseded pre-migration capture — what the committed rewrite actually moved"). It is a
-- cost, not a correctness change: both bodies admit exactly the same rows in every GUC
-- state, which is why this rollback is safe to take.
--
-- `DROP POLICY` IS NOT `IF EXISTS`, DELIBERATELY, and this diverges from the sibling
-- down.sql in 20260909000500 for a reason rather than by accident. That script's target
-- state is "no policy", so a policy that is already absent is the goal and `IF EXISTS` is
-- coherent. THIS script's target state is "the bare policy present", so a policy that is
-- absent when the rollback runs is enrollment drift — and the idempotent form would swallow
-- it, create the bare policy, and report a clean rollback over a database whose enrollment
-- nobody has actually verified.

-- Session-level SET, not SET LOCAL: this script is operator-run and is not guaranteed a
-- wrapping transaction, where SET LOCAL would warn and no-op. Values mirror the forward
-- migration. DROP POLICY and CREATE POLICY take ACCESS EXCLUSIVE on the table briefly; the
-- lock_timeout bounds the wait behind a long-running query, not the hold.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DROP POLICY tenant_isolation ON "Post";
DROP POLICY tenant_isolation ON "PostContent";
DROP POLICY tenant_isolation ON "PostMedia";

CREATE POLICY tenant_isolation ON "Post"
  USING (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  )
  WITH CHECK (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  );

CREATE POLICY tenant_isolation ON "PostContent"
  USING (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  )
  WITH CHECK (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  );

CREATE POLICY tenant_isolation ON "PostMedia"
  USING (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  )
  WITH CHECK (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  );
