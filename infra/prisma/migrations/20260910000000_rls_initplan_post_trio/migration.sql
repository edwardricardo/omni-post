-- Rewrite the three Post-trio `tenant_isolation` policies so each `current_setting()` read
-- is hoisted into an InitPlan, evaluated ONCE per statement instead of once per candidate row.
--
-- SEMANTICS ARE UNCHANGED. Same column, same `__system__` cross-tenant escape for
-- withSystemContext() flows, same fail-closed behaviour when the GUC is unset
-- (`current_setting(..., true)` returns NULL, the predicate is not true, no rows are visible
-- and no write is admitted). The ONLY textual delta from
-- 20260909000500_add_rls_post_trio is that each `current_setting('app.account_id', true)`
-- call is wrapped in `(SELECT ...)`. PostgreSQL treats the wrapped call as a stable
-- initialization plan; unwrapped, it is re-evaluated for every row the scan considers.
--
-- THE FORM WAS MEASURED, NOT ARGUED. Three candidate bodies were installed and measured
-- against the same corpus over the 13 application queries that read these tables plus 3
-- policy-only shapes, and the run is recorded in
-- docs/reports/TENANT_RLS_AB_MEASUREMENT.md, section "The superseded pre-migration capture
-- — what the committed rewrite actually moved" (hand-written, OUTSIDE the generated block,
-- because the generated block is regenerated against whatever body is committed and after
-- this migration its control arm IS this body):
--   * the then-shipped unwrapped body (the control, measured as the live object rather than a copy);
--   * this body, both halves wrapped;
--   * a single-read set-membership body, `(SELECT current_setting(...)) IN ('__system__', "accountId")`.
-- Against that control, the scan-node medians of the three row-scanning probes fell from
-- 4.163/4.209/3.808 ms to 1.834/1.876/1.707 ms — 2.27x / 2.24x / 2.23x on the scan node,
-- which is the node this change acts on, measured against the COMMITTED policy rather than
-- against a candidate. The planner corroborates it independently of the clock: the control
-- arm's InitPlan count moved 0 -> 2, so the GUC read is now statement-scoped. The two
-- wrapped bodies were INDISTINGUISHABLE: no probe's difference was attributable to the form
-- (every probe that fell outside the band flipped sign between sweeps, so it measures the
-- run), and the tiebreak declared BEFORE the run selected this body — it is the minimal
-- textual delta from the BARE form it replaces, and it keeps a later account-wide sweep a
-- single mechanical "wrap each call" transform.
--
-- A NOTE ON WHICH NUMBER IS WHICH. The 2.27x / 2.24x / 2.23x above are SCAN-NODE medians.
-- The statement medians of the same three probes move 1.80x / 1.55x / 1.72x, because they
-- also carry planning and result assembly, which this change does not touch. The two
-- statistics are not interchangeable and the spread across those three ratios is the proof:
-- a band drawn on one cannot be read against the other.
--
-- BOTH CLAUSES MOVE. `USING` gates row visibility and `WITH CHECK` gates row mutation.
-- Wrapping only the first would leave every INSERT and UPDATE paying the per-row read,
-- and would leave the two clauses of one policy in two different forms.
--
-- `DROP POLICY` IS DELIBERATELY NOT `IF EXISTS`. A missing policy here is enrollment drift,
-- and the idempotent form would silently CREATE the policy on a database where none was
-- installed, reporting success while masking exactly the state this layer exists to detect.
-- The trio's own installing migration uses `IF EXISTS` because it is establishing the
-- enrollment; this one requires it to already be there.
--
-- ROLE POSTURE is unchanged: migrations and the seed connect on the owner channel, which is
-- not subject to these policies (the tables are not FORCE'd — see
-- docs/technical/ADR-0022-rls-enforcement-posture.md); application traffic connects as
-- `omnipost_app`, which is NOSUPERUSER / NOBYPASSRLS and IS subject to them.
--
-- Rollback: the companion down.sql, which Prisma never applies automatically.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP POLICY tenant_isolation ON "Post";
DROP POLICY tenant_isolation ON "PostContent";
DROP POLICY tenant_isolation ON "PostMedia";

CREATE POLICY tenant_isolation ON "Post"
  USING (
    (SELECT current_setting('app.account_id', true)) = '__system__'
    OR "accountId" = (SELECT current_setting('app.account_id', true))
  )
  WITH CHECK (
    (SELECT current_setting('app.account_id', true)) = '__system__'
    OR "accountId" = (SELECT current_setting('app.account_id', true))
  );

CREATE POLICY tenant_isolation ON "PostContent"
  USING (
    (SELECT current_setting('app.account_id', true)) = '__system__'
    OR "accountId" = (SELECT current_setting('app.account_id', true))
  )
  WITH CHECK (
    (SELECT current_setting('app.account_id', true)) = '__system__'
    OR "accountId" = (SELECT current_setting('app.account_id', true))
  );

CREATE POLICY tenant_isolation ON "PostMedia"
  USING (
    (SELECT current_setting('app.account_id', true)) = '__system__'
    OR "accountId" = (SELECT current_setting('app.account_id', true))
  )
  WITH CHECK (
    (SELECT current_setting('app.account_id', true)) = '__system__'
    OR "accountId" = (SELECT current_setting('app.account_id', true))
  );
