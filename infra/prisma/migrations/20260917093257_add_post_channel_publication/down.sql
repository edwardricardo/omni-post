-- Inverse of 20260917093257_add_post_channel_publication (operator-run; Prisma never
-- applies this).
--
-- THE RUNNER IS `psql -f`, and naming it is not decoration: this file's atomicity claim
-- below is a claim about how psql executes it. `psql -f` sends each statement in order
-- and, with the explicit block below, commits or rolls back all five DDL statements as a
-- unit; the same bytes fed through a tool that strips or reorders statements do not carry
-- that guarantee. The repo has a measured precedent for both the runner and the property
-- — docs/reports/TENANT_RLS_AB_MEASUREMENT.md records an operator-run rollback where
-- "psql exited 3, the transaction rolled back" and the catalog read back unchanged.
--
-- Prisma NEVER applies a down.sql automatically; it exists so the rollback is a
-- reviewed artefact rather than something improvised during an incident.
--
-- THE INVERSE IS TOTAL HERE, and it is worth saying why, because the companion
-- migration of this change's alert consumer will NOT be: nothing below is a
-- PostgreSQL one-way operation. The table is new, so dropping it takes its own
-- constraints, indexes, foreign keys and row-security policy with it, and the four
-- enum types are created by that same migration and referenced by nothing else, so
-- they drop cleanly. DROP TYPE is deliberately NOT "IF EXISTS": a type already gone
-- is enrollment drift, and the idempotent form would report success over it.
--
-- WHAT THIS FILE CANNOT UNDO, stated rather than implied: the rows. Reverting this
-- change means reverting the code range AND applying this file AND removing
-- "postChannelPublication" from TENANT_SCOPED_MODELS and its row from
-- docs/security/MULTI_TENANT_GUARDS.md — fitness #39 fails closed if any one of
-- those is left behind, which is the intended behaviour and not a nuisance.

-- ONE TRANSACTION, and it diverges from the four RLS rollbacks beside it on purpose.
-- Those scripts leave the transaction to the operator and therefore use a session-level
-- SET, because `SET LOCAL` outside a transaction block only warns and does nothing. This
-- file OPENS the block itself, for the reason the reviewer named: five statements run
-- here, and without a block a failure at the third leaves the table gone and two enum
-- types still defined — a shape neither the forward migration nor this file describes,
-- and one an operator would then have to unpick by hand mid-incident. Every statement
-- below is transactional DDL in PostgreSQL, so the block is real: it either drops all
-- five objects or none. Opening it also makes the two `SET LOCAL` bounds effective,
-- which is what they were written to be.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP TABLE "PostChannelPublication";

DROP TYPE "ChannelRetractionClearance";
DROP TYPE "ChannelRetractionBlock";
DROP TYPE "ChannelExclusionReason";
DROP TYPE "ChannelPublicationOutcome";

COMMIT;
