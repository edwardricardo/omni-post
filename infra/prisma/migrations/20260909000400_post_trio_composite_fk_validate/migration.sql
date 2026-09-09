-- Tenant column for the Post trio, step 5 of 6: validate the three composite FKs against
-- the rows that already exist.
--
-- WHY THIS IS A SEPARATE FILE, AND NOT A TAIL ON STEP 4. Prisma wraps each migration file
-- in ONE transaction. Adding a constraint NOT VALID and validating it in the same
-- transaction would hold the ACCESS EXCLUSIVE lock taken by the ADD across the full-table
-- verification scan, which is precisely the blocking this two-file shape exists to avoid.
-- Split, VALIDATE CONSTRAINT runs in its own transaction and takes only SHARE UPDATE
-- EXCLUSIVE: concurrent readers AND writers proceed while it scans.
--
-- WHAT IT CHANGES. Nothing about new writes — those have been checked since step 4. What
-- it changes is the STRENGTH OF THE CLAIM: once `convalidated` is true, the guarantee
-- covers historical rows too, and the slice may report the tenant key as enforced rather
-- than as forward-only. If this file has not run and passed, the completion report must
-- say forward-only. The integration suite reads `convalidated` directly so a NOT VALID
-- constraint can never be mistaken for a validated one.
--
-- IF IT FAILS. A failure here means real rows violate the tenant key — a child whose
-- "accountId" disagrees with its parent's. That is a data finding, not a migration defect:
-- do not weaken the constraint to get past it. Identify the offending rows (join each
-- child to its parent and compare "accountId"), decide per row whether the parent or the
-- child holds the true tenant, correct them, then re-run.
--
-- The scan is the only real cost in this sequence. `statement_timeout` is set to 10min for
-- that reason; an abort rolls back cleanly and leaves a failed ledger row, recovered with
-- `migrate resolve --rolled-back` (docs/architecture/schema-conventions.md, "Recovering a
-- failed migration").

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

ALTER TABLE "Post" VALIDATE CONSTRAINT "Post_projectId_accountId_fkey";
ALTER TABLE "PostContent" VALIDATE CONSTRAINT "PostContent_postId_accountId_fkey";
ALTER TABLE "PostMedia" VALIDATE CONSTRAINT "PostMedia_postId_accountId_fkey";
