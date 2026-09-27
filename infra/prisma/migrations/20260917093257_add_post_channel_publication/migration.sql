-- The per-channel publication record: one row per (post, channel), the only source
-- of publication truth for a post, and a new tenant-scoped child of "Post".
--
-- WHAT IS HERE BEYOND THE GENERATED DDL, and why each piece is not optional:
--
--   1. THE TIMEOUT PREAMBLE, FIRST. Every DDL statement below takes an ACCESS
--      EXCLUSIVE lock on a table the application writes. Without a bounded
--      lock_timeout a deploy that meets a long-running transaction waits behind it
--      while every writer queues behind the waiter. The bound turns that into a
--      failed migration, which is a state an operator can see and retry.
--
--   2. NINE CHECK CONSTRAINTS. The record's states are not independent: "published"
--      without a reference, "pending retraction" with no live fragments, or an
--      expired window that never opened are each a row the domain cannot produce
--      and the database should not be able to hold. The application enforces them
--      too; these exist because raw SQL, a future worker and manual operations do
--      not go through the application.
--
--   3. ROW LEVEL SECURITY. The table carries "accountId", so it is cross-tenant by
--      default until it is both enrolled in the Prisma guard (layer 1) and covered
--      by a policy (layer 2). The policy body is the canonical InitPlan-wrapped
--      form of 20260910000000_rls_initplan_post_trio: each current_setting() read is
--      wrapped in (SELECT ...) so PostgreSQL evaluates it ONCE per statement instead
--      of once per candidate row. Semantics are the trio's, unchanged — same column,
--      same '__system__' escape for withSystemContext() flows, and a fail-closed
--      default when the GUC is unset (current_setting(..., true) returns NULL, the
--      predicate is not true, no row is visible and no write is admitted).
--
-- THE CHANNEL FOREIGN KEY IS "NO ACTION" where every other child of "Channel"
-- cascades, and that asymmetry is deliberate: deleting a channel must not silently
-- shrink a post's intended target set, which would make the record lie about what
-- was attempted. NO ACTION is checked at END OF STATEMENT rather than per row, so an
-- account-wide cascade that also removes the posts still succeeds.
--
-- ROLE POSTURE is the trio's, unchanged: migrations and the seed connect on the
-- owner channel, which is not subject to these policies (the table is not FORCE'd —
-- see docs/technical/ADR-0022-rls-enforcement-posture.md); application traffic
-- connects as `omnipost_app`, which is NOSUPERUSER / NOBYPASSRLS and IS subject.
--
-- Rollback: the companion down.sql, which Prisma never applies automatically.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- CreateEnum
CREATE TYPE "ChannelPublicationOutcome" AS ENUM ('UNRESOLVED', 'PUBLISHED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "ChannelExclusionReason" AS ENUM ('CHANNEL_AUTH_REQUIRED', 'CONTENT_REJECTED', 'RENDER_FAILED', 'THREAD_INTERRUPTED', 'BUDGET_EXHAUSTED', 'UNCLASSIFIED_BUDGET_EXHAUSTED', 'ACTION_WINDOW_EXPIRED');

-- CreateEnum
CREATE TYPE "ChannelRetractionBlock" AS ENUM ('NO_CAPABILITY', 'EXHAUSTED');

-- CreateEnum
CREATE TYPE "ChannelRetractionClearance" AS ENUM ('RETRACTED', 'MANUALLY_REMOVED');

-- CreateTable
CREATE TABLE "PostChannelPublication" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "outcome" "ChannelPublicationOutcome" NOT NULL DEFAULT 'UNRESOLVED',
    "externalId" TEXT,
    "externalIdMissing" BOOLEAN NOT NULL DEFAULT false,
    "liveFragments" JSONB NOT NULL DEFAULT '[]',
    "pendingRetraction" BOOLEAN NOT NULL DEFAULT false,
    "retractionBlockedCause" "ChannelRetractionBlock",
    "actionWindowStartedAt" TIMESTAMPTZ(6),
    "actionWindowExpiredAt" TIMESTAMPTZ(6),
    "retractionAlertHash" TEXT,
    "retractionClearedCause" "ChannelRetractionClearance",
    "retractionClearedAt" TIMESTAMPTZ(6),
    "contentHash" TEXT,
    "publishedAt" TIMESTAMPTZ(6),
    "reasonCode" "ChannelExclusionReason",
    "reasonDetail" TEXT,
    "lastFailureCode" "ChannelExclusionReason",
    "lastFailureDetail" TEXT,
    "lastAttemptAt" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "episode" INTEGER NOT NULL DEFAULT 0,
    "episodeAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PostChannelPublication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostChannelPublication_channelId_idx" ON "PostChannelPublication"("channelId");

-- CreateIndex
CREATE INDEX "PostChannelPublication_accountId_postId_idx" ON "PostChannelPublication"("accountId", "postId");

-- CreateIndex
CREATE INDEX "PostChannelPublication_actionWindowStartedAt_idx" ON "PostChannelPublication"("actionWindowStartedAt") WHERE ("pendingRetraction" = true AND "actionWindowExpiredAt" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "PostChannelPublication_postId_channelId_key" ON "PostChannelPublication"("postId", "channelId");

-- AddForeignKey
ALTER TABLE "PostChannelPublication" ADD CONSTRAINT "PostChannelPublication_postId_accountId_fkey" FOREIGN KEY ("postId", "accountId") REFERENCES "Post"("id", "accountId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PostChannelPublication" ADD CONSTRAINT "PostChannelPublication_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostChannelPublication" ADD CONSTRAINT "PostChannelPublication_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- The record's state invariants, at the layer raw SQL cannot go around.
-- Added to an empty table, so none needs NOT VALID / VALIDATE staging.

-- A published channel names its head reference EXACTLY ONE way: either the provider
-- returned an id, or it accepted the content and returned none and we say so.
-- Carrying both, or neither, would make "published with no id" indistinguishable
-- from a write that lost the id.
ALTER TABLE "PostChannelPublication"
  ADD CONSTRAINT "PostChannelPublication_published_reference_check"
  CHECK ("outcome" <> 'PUBLISHED' OR (("externalId" IS NOT NULL) <> "externalIdMissing"));

-- Nothing is live while the channel is still unresolved.
ALTER TABLE "PostChannelPublication"
  ADD CONSTRAINT "PostChannelPublication_unresolved_no_live_fragments_check"
  CHECK ("outcome" <> 'UNRESOLVED' OR jsonb_array_length("liveFragments") = 0);

-- Pending retraction means exactly this: the channel is EXCLUDED and something it
-- put out is still on the platform. A pending flag over an empty set would be an
-- obligation with no subject.
ALTER TABLE "PostChannelPublication"
  ADD CONSTRAINT "PostChannelPublication_pending_retraction_shape_check"
  CHECK ("pendingRetraction" = false OR ("outcome" = 'EXCLUDED' AND jsonb_array_length("liveFragments") > 0));

-- The converse: an excluded channel with live fragments is ALWAYS pending
-- retraction. Without this an interrupted thread could record its fragments and
-- leave nobody obliged to remove them.
ALTER TABLE "PostChannelPublication"
  ADD CONSTRAINT "PostChannelPublication_excluded_fragments_pending_check"
  CHECK ("outcome" <> 'EXCLUDED' OR "pendingRetraction" OR jsonb_array_length("liveFragments") = 0);

-- A reason retraction did not happen only exists while retraction is owed.
ALTER TABLE "PostChannelPublication"
  ADD CONSTRAINT "PostChannelPublication_block_cause_requires_pending_check"
  CHECK ("retractionBlockedCause" IS NULL OR "pendingRetraction");

-- A window cannot expire without having opened.
ALTER TABLE "PostChannelPublication"
  ADD CONSTRAINT "PostChannelPublication_window_expiry_requires_start_check"
  CHECK ("actionWindowExpiredAt" IS NULL OR "actionWindowStartedAt" IS NOT NULL);

-- The alert dedupe hash only means something while an alert can be owed.
ALTER TABLE "PostChannelPublication"
  ADD CONSTRAINT "PostChannelPublication_alert_hash_requires_pending_check"
  CHECK ("retractionAlertHash" IS NULL OR "pendingRetraction");

-- A published channel records WHAT was published, so the audit answer exists at
-- the moment it could be asked rather than being reconstructed later.
ALTER TABLE "PostChannelPublication"
  ADD CONSTRAINT "PostChannelPublication_published_has_content_hash_check"
  CHECK ("outcome" <> 'PUBLISHED' OR "contentHash" IS NOT NULL);

-- An exclusion always names its cause. An unexplained exclusion is the shape the
-- customer cannot act on.
ALTER TABLE "PostChannelPublication"
  ADD CONSTRAINT "PostChannelPublication_excluded_has_reason_check"
  CHECK ("outcome" <> 'EXCLUDED' OR "reasonCode" IS NOT NULL);

-- Tenant isolation, layer 2. Body copied from 20260910000000_rls_initplan_post_trio.
ALTER TABLE "PostChannelPublication" ENABLE ROW LEVEL SECURITY;

-- Idempotent on re-apply to a stale snapshot, as the installing migrations are.
DROP POLICY IF EXISTS tenant_isolation ON "PostChannelPublication";

CREATE POLICY tenant_isolation ON "PostChannelPublication"
  USING (
    (SELECT current_setting('app.account_id', true)) = '__system__'
    OR "accountId" = (SELECT current_setting('app.account_id', true))
  )
  WITH CHECK (
    (SELECT current_setting('app.account_id', true)) = '__system__'
    OR "accountId" = (SELECT current_setting('app.account_id', true))
  );
