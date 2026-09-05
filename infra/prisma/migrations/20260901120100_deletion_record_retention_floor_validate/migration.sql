-- Validate the DeletionRecord retention floor added NOT VALID by its predecessor.
--
-- WHY THIS IS A SEPARATE MIGRATION
--   20260901120000 adds "DeletionRecord_retainUntil_floor" as NOT VALID: the
--   constraint is enforced for every INSERT and UPDATE from that moment, but
--   pre-existing rows are not scanned, so that transaction never holds ACCESS
--   EXCLUSIVE across a table scan.
--
--   Prisma runs each migration file in its own transaction, so putting the
--   VALIDATE in a SECOND file is what makes the split real. VALIDATE CONSTRAINT
--   takes SHARE UPDATE EXCLUSIVE, which does not block reads or writes; running
--   it in the SAME transaction as the ADD would keep the ACCESS EXCLUSIVE lock
--   from the ADD held across the scan, making the NOT VALID cosmetic.
--
--   This is the same shape as the deployed pair 20260830220417 (adds FK
--   constraints NOT VALID) + 20260830220517 (validates them).
--
-- WHY THIS CANNOT FAIL ON EXISTING ROWS
--   The predecessor backfills every pre-existing row to clientUntil + 7 years
--   before adding the constraint, and the constraint requires only
--   clientUntil + 1 year. Rows written after the predecessor were checked at
--   write time by the NOT VALID constraint itself. So the set of rows this
--   scan can reject is empty by construction, and a failure here means the
--   backfill did not run — which is a real defect worth failing on, not a
--   condition to swallow.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "DeletionRecord" VALIDATE CONSTRAINT "DeletionRecord_retainUntil_floor";
