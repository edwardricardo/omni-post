-- Rollback for 20260910000100_post_feed_index_winner (operator-run; Prisma never applies this).
-- Restores the as-shipped ("accountId", "projectId") partial index on "Post".
--
-- SCOPE. This reverses THIS migration only. Nothing else on "Post" is touched: the
-- "accountId" column, the composite foreign key, the (id, "accountId") unique and the six
-- projectId-led indexes all belong to earlier migrations and are unaffected, and the three
-- trio `tenant_isolation` policies belong to 20260910000000 and keep whatever body they
-- currently hold. That separation is the point — an index shape can be backed out without
-- touching row-level security for one second, and the two questions stay independently
-- revertible.
--
-- THE RESTORED STATEMENT IS THE BYTES OF
-- 20260909000200_post_trio_tenant_not_null_and_uniques/migration.sql line 65, reproduced
-- verbatim rather than paraphrased, so the restored object is textually the object that
-- migration installed and a `pg_indexes` (indexname, indexdef) comparison after rollback is
-- exact rather than approximately right. Do not "tidy" the parentheses around the WHERE
-- predicate, and do not close the space before the column list to match the forward file:
-- those bytes are that migration's, and this script's job is to reproduce them. (The forward
-- file uses Prisma's own emission, which omits that space. The difference is cosmetic — the
-- catalog deparses both identically, which is why schema.prisma has never reported drift
-- against the spaced form — and the two files differ on purpose, each matching its own
-- source of truth.)
--
-- WHAT REVERTING COSTS, measured rather than asserted. It reinstates the displacement the
-- forward migration repaired: `Q1` (listByProject page 1) and `Q5` (findByProjectId) go back
-- to `Limit -> Sort -> Index Scan`, scan-node medians 0.019 -> 0.047 ms and 0.019 -> 0.048 ms
-- on the measured corpus (docs/reports/TENANT_RLS_AB_MEASUREMENT.md, section "Reading the
-- index shortlist run"). It is a COST, not a correctness change: both index shapes answer
-- every one of the 16 probes with identical rows — 16/16 row-equivalence across all four arms
-- and all five sweeps — which is why this rollback is safe to take. An index is never part of
-- the tenant guarantee: that is the composite foreign key plus the RLS policy, both untouched
-- here.
--
-- ORDER IS THE MIRROR OF THE FORWARD FILE, deliberately. Forward drops the old key then
-- builds the new one; this drops the new key then rebuilds the old one. The intermediate
-- state — "Post" with no accountId-led index — exists inside this script's transaction just as
-- it does inside the forward migration's, and it is bounded the same way.
--
-- NEITHER STATEMENT IS `IF EXISTS`, DELIBERATELY, and it is the same argument the sibling
-- down.sql in 20260910000000 makes for `DROP POLICY`. This script's target state is "the
-- as-shipped index present, the extension gone". An extension that is already absent when the
-- rollback runs is drift — the forward migration did not apply, or something else dropped it —
-- and the idempotent form would swallow that, create the old index, and report a clean
-- rollback over a database whose index set nobody has verified. A `DROP INDEX` that fails
-- loudly is the diagnosis; a silent one is the bug.

-- Session-level SET, not SET LOCAL: this script is operator-run and is not guaranteed a
-- wrapping transaction, where SET LOCAL would warn and no-op. Values mirror the forward
-- migration. `DROP INDEX` takes ACCESS EXCLUSIVE and `CREATE INDEX` takes SHARE (writers
-- blocked, readers proceed) for the build; the lock_timeout bounds the wait behind a
-- long-running query, not the hold, and statement_timeout bounds the build.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DROP INDEX "Post_accountId_projectId_createdAt_idx";

CREATE INDEX "Post_accountId_projectId_idx" ON "Post" ("accountId", "projectId") WHERE ("deletedAt" IS NULL);
