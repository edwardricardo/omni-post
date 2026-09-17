-- Inverse of 20260917093257_add_post_channel_publication.
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

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP TABLE "PostChannelPublication";

DROP TYPE "ChannelRetractionClearance";
DROP TYPE "ChannelRetractionBlock";
DROP TYPE "ChannelExclusionReason";
DROP TYPE "ChannelPublicationOutcome";
