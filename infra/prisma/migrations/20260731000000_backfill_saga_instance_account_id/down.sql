-- Rollback for 20260731000000_backfill_saga_instance_account_id
-- (operator-run; not auto-applied by Prisma).
--
-- Deliberate NO-OP: restoring corrupted CustomerUser.id values into the
-- tenant column is not a rollback goal. Post-backfill values are true
-- Account ids and remain correct even if the engine code reverts — old
-- code reads the column only incidentally, and new writes re-corrupt at
-- worst their own rows, which a re-run of the up migration repairs.
SELECT 1;
