-- Sub-fase 1.3: cleanup migration.
--
-- Flips every legacy FK that pointed at "TeamMember" so it now points at
-- "CustomerUser" (using the *CustomerUserId helper column populated by the
-- backfill in Sub-fase 1.2 / commit 7cec7cc), drops the helper columns and
-- their indexes, drops the "TeamMember" table, drops "CustomerUser"."role"
-- (legacy TeamRole mirror), and drops the "TeamRole" enum.
--
-- Data flip pattern per consumer column C with helper H on table T:
--   1. (nullable only) UPDATE T SET C = NULL WHERE H IS NULL AND C IS NOT NULL;
--      (legacy referenced a TeamMember whose backfill matched nothing — drop
--      the orphan reference before it becomes invalid.)
--   2. UPDATE T SET C = H WHERE H IS NOT NULL;
--      (canonical flip: write the matched CustomerUser.id into the slot.)
--   3. DROP CONSTRAINT T_C_fkey;        (drops FK → TeamMember)
--   4. DROP COLUMN H;                    (drops the helper)
--   5. ADD CONSTRAINT T_C_fkey ...;      (new FK → CustomerUser)
--
-- ON DELETE behaviour mirrors what the helper-column FKs declared (CASCADE
-- where the row dies with the user, SET NULL where the row should survive
-- the user's soft/hard delete).  For columns that are NOT NULL the legacy
-- RESTRICT semantics are preserved (a hard-delete of a CustomerUser is
-- blocked while these rows exist — soft-delete via CustomerUser.deletedAt is
-- unaffected).
--
-- Squawk advisories accepted for this migration:
--   * ban-drop-{table,column}, constraint-missing-not-valid,
--     adding-foreign-key-constraint, require-concurrent-index-deletion.
--   These warn about lock duration on populated tables.  The dev DB has 0
--   rows on every affected consumer (verified pre-migration), so the
--   ACCESS-EXCLUSIVE windows are sub-millisecond.  For prod-grade deployment
--   to a populated DB, this single file should be split into ordered steps
--   that use `NOT VALID` + `VALIDATE CONSTRAINT` and `DROP INDEX
--   CONCURRENTLY`, which Prisma's implicit-transaction migration runner
--   can't host in a single file.

-- ============================================================================
-- ProjectMember.memberId  (NOT NULL, CASCADE)
-- ============================================================================
UPDATE "ProjectMember" SET "memberId" = "customerUserId" WHERE "customerUserId" IS NOT NULL;
ALTER TABLE "ProjectMember" DROP CONSTRAINT "ProjectMember_memberId_fkey";
ALTER TABLE "ProjectMember" DROP CONSTRAINT "ProjectMember_customerUserId_fkey";
DROP INDEX "ProjectMember_customerUserId_idx";
ALTER TABLE "ProjectMember" DROP COLUMN "customerUserId";
ALTER TABLE "ProjectMember"
  ADD CONSTRAINT "ProjectMember_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "CustomerUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Notification.recipientId  (NOT NULL, CASCADE)
-- ============================================================================
UPDATE "Notification" SET "recipientId" = "recipientCustomerUserId" WHERE "recipientCustomerUserId" IS NOT NULL;
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_recipientId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_recipientCustomerUserId_fkey";
DROP INDEX "Notification_recipientCustomerUserId_idx";
ALTER TABLE "Notification" DROP COLUMN "recipientCustomerUserId";
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "CustomerUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- NotificationPreference.memberId  (NOT NULL, CASCADE)
-- ============================================================================
UPDATE "NotificationPreference" SET "memberId" = "customerUserId" WHERE "customerUserId" IS NOT NULL;
ALTER TABLE "NotificationPreference" DROP CONSTRAINT "NotificationPreference_memberId_fkey";
ALTER TABLE "NotificationPreference" DROP CONSTRAINT "NotificationPreference_customerUserId_fkey";
DROP INDEX "NotificationPreference_customerUserId_idx";
ALTER TABLE "NotificationPreference" DROP COLUMN "customerUserId";
ALTER TABLE "NotificationPreference"
  ADD CONSTRAINT "NotificationPreference_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "CustomerUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- ApprovalWorkflowLevel.assigneeId  (NULLABLE, SET NULL)
-- ============================================================================
UPDATE "ApprovalWorkflowLevel" SET "assigneeId" = NULL WHERE "assigneeCustomerUserId" IS NULL AND "assigneeId" IS NOT NULL;
UPDATE "ApprovalWorkflowLevel" SET "assigneeId" = "assigneeCustomerUserId" WHERE "assigneeCustomerUserId" IS NOT NULL;
ALTER TABLE "ApprovalWorkflowLevel" DROP CONSTRAINT "ApprovalWorkflowLevel_assigneeId_fkey";
ALTER TABLE "ApprovalWorkflowLevel" DROP CONSTRAINT "ApprovalWorkflowLevel_assigneeCustomerUserId_fkey";
DROP INDEX "ApprovalWorkflowLevel_assigneeCustomerUserId_idx";
ALTER TABLE "ApprovalWorkflowLevel" DROP COLUMN "assigneeCustomerUserId";
ALTER TABLE "ApprovalWorkflowLevel"
  ADD CONSTRAINT "ApprovalWorkflowLevel_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- ApprovalRequest.submitterId  (NOT NULL, RESTRICT preserved)
-- ============================================================================
UPDATE "ApprovalRequest" SET "submitterId" = "submitterCustomerUserId" WHERE "submitterCustomerUserId" IS NOT NULL;
ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_submitterId_fkey";
ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_submitterCustomerUserId_fkey";
DROP INDEX "ApprovalRequest_submitterCustomerUserId_idx";
ALTER TABLE "ApprovalRequest" DROP COLUMN "submitterCustomerUserId";
ALTER TABLE "ApprovalRequest"
  ADD CONSTRAINT "ApprovalRequest_submitterId_fkey"
  FOREIGN KEY ("submitterId") REFERENCES "CustomerUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- ApprovalReview.reviewerId  (NOT NULL, RESTRICT preserved)
-- ============================================================================
UPDATE "ApprovalReview" SET "reviewerId" = "reviewerCustomerUserId" WHERE "reviewerCustomerUserId" IS NOT NULL;
ALTER TABLE "ApprovalReview" DROP CONSTRAINT "ApprovalReview_reviewerId_fkey";
ALTER TABLE "ApprovalReview" DROP CONSTRAINT "ApprovalReview_reviewerCustomerUserId_fkey";
DROP INDEX "ApprovalReview_reviewerCustomerUserId_idx";
ALTER TABLE "ApprovalReview" DROP COLUMN "reviewerCustomerUserId";
ALTER TABLE "ApprovalReview"
  ADD CONSTRAINT "ApprovalReview_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "CustomerUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Task.assigneeId  (NULLABLE, SET NULL)
-- Task.createdById (NOT NULL, RESTRICT preserved)
-- ============================================================================
UPDATE "Task" SET "assigneeId" = NULL WHERE "assigneeCustomerUserId" IS NULL AND "assigneeId" IS NOT NULL;
UPDATE "Task" SET "assigneeId" = "assigneeCustomerUserId" WHERE "assigneeCustomerUserId" IS NOT NULL;
UPDATE "Task" SET "createdById" = "createdByCustomerUserId" WHERE "createdByCustomerUserId" IS NOT NULL;
ALTER TABLE "Task" DROP CONSTRAINT "Task_assigneeId_fkey";
ALTER TABLE "Task" DROP CONSTRAINT "Task_createdById_fkey";
ALTER TABLE "Task" DROP CONSTRAINT "Task_assigneeCustomerUserId_fkey";
ALTER TABLE "Task" DROP CONSTRAINT "Task_createdByCustomerUserId_fkey";
DROP INDEX "Task_assigneeCustomerUserId_idx";
DROP INDEX "Task_createdByCustomerUserId_idx";
ALTER TABLE "Task" DROP COLUMN "assigneeCustomerUserId";
ALTER TABLE "Task" DROP COLUMN "createdByCustomerUserId";
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "CustomerUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- PostComment.authorId  (NOT NULL, RESTRICT preserved)
-- ============================================================================
UPDATE "PostComment" SET "authorId" = "authorCustomerUserId" WHERE "authorCustomerUserId" IS NOT NULL;
ALTER TABLE "PostComment" DROP CONSTRAINT "PostComment_authorId_fkey";
ALTER TABLE "PostComment" DROP CONSTRAINT "PostComment_authorCustomerUserId_fkey";
DROP INDEX "PostComment_authorCustomerUserId_idx";
ALTER TABLE "PostComment" DROP COLUMN "authorCustomerUserId";
ALTER TABLE "PostComment"
  ADD CONSTRAINT "PostComment_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "CustomerUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- SocialMessage.assigneeId  (NULLABLE, SET NULL)
-- ============================================================================
UPDATE "SocialMessage" SET "assigneeId" = NULL WHERE "assigneeCustomerUserId" IS NULL AND "assigneeId" IS NOT NULL;
UPDATE "SocialMessage" SET "assigneeId" = "assigneeCustomerUserId" WHERE "assigneeCustomerUserId" IS NOT NULL;
ALTER TABLE "SocialMessage" DROP CONSTRAINT "SocialMessage_assigneeId_fkey";
ALTER TABLE "SocialMessage" DROP CONSTRAINT "SocialMessage_assigneeCustomerUserId_fkey";
DROP INDEX "SocialMessage_assigneeCustomerUserId_status_idx";
ALTER TABLE "SocialMessage" DROP COLUMN "assigneeCustomerUserId";
ALTER TABLE "SocialMessage"
  ADD CONSTRAINT "SocialMessage_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- SocialConversation.resolvedById  (NULLABLE, SET NULL)
-- ============================================================================
UPDATE "SocialConversation" SET "resolvedById" = NULL WHERE "resolvedByCustomerUserId" IS NULL AND "resolvedById" IS NOT NULL;
UPDATE "SocialConversation" SET "resolvedById" = "resolvedByCustomerUserId" WHERE "resolvedByCustomerUserId" IS NOT NULL;
ALTER TABLE "SocialConversation" DROP CONSTRAINT "SocialConversation_resolvedById_fkey";
ALTER TABLE "SocialConversation" DROP CONSTRAINT "SocialConversation_resolvedByCustomerUserId_fkey";
DROP INDEX "SocialConversation_resolvedByCustomerUserId_idx";
ALTER TABLE "SocialConversation" DROP COLUMN "resolvedByCustomerUserId";
ALTER TABLE "SocialConversation"
  ADD CONSTRAINT "SocialConversation_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- ConversationNote.authorId  (NOT NULL, RESTRICT preserved)
-- ============================================================================
UPDATE "ConversationNote" SET "authorId" = "authorCustomerUserId" WHERE "authorCustomerUserId" IS NOT NULL;
ALTER TABLE "ConversationNote" DROP CONSTRAINT "ConversationNote_authorId_fkey";
ALTER TABLE "ConversationNote" DROP CONSTRAINT "ConversationNote_authorCustomerUserId_fkey";
DROP INDEX "ConversationNote_authorCustomerUserId_idx";
ALTER TABLE "ConversationNote" DROP COLUMN "authorCustomerUserId";
ALTER TABLE "ConversationNote"
  ADD CONSTRAINT "ConversationNote_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "CustomerUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- SocialOutboundReply.authorId  (NOT NULL, RESTRICT preserved)
-- ============================================================================
UPDATE "SocialOutboundReply" SET "authorId" = "authorCustomerUserId" WHERE "authorCustomerUserId" IS NOT NULL;
ALTER TABLE "SocialOutboundReply" DROP CONSTRAINT "SocialOutboundReply_authorId_fkey";
ALTER TABLE "SocialOutboundReply" DROP CONSTRAINT "SocialOutboundReply_authorCustomerUserId_fkey";
DROP INDEX "SocialOutboundReply_authorCustomerUserId_idx";
ALTER TABLE "SocialOutboundReply" DROP COLUMN "authorCustomerUserId";
ALTER TABLE "SocialOutboundReply"
  ADD CONSTRAINT "SocialOutboundReply_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "CustomerUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- CustomReport.createdById  (NOT NULL, RESTRICT preserved)
-- ============================================================================
UPDATE "CustomReport" SET "createdById" = "createdByCustomerUserId" WHERE "createdByCustomerUserId" IS NOT NULL;
ALTER TABLE "CustomReport" DROP CONSTRAINT "CustomReport_createdById_fkey";
ALTER TABLE "CustomReport" DROP CONSTRAINT "CustomReport_createdByCustomerUserId_fkey";
DROP INDEX "CustomReport_createdByCustomerUserId_idx";
ALTER TABLE "CustomReport" DROP COLUMN "createdByCustomerUserId";
ALTER TABLE "CustomReport"
  ADD CONSTRAINT "CustomReport_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "CustomerUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Drop "TeamMember" table (auto-drops its own FK to "Account")
-- ============================================================================
DROP TABLE "TeamMember";

-- ============================================================================
-- Drop legacy "role" column on "CustomerUser" (mirror of CustomerRole.name)
-- ============================================================================
ALTER TABLE "CustomerUser" DROP COLUMN "role";

-- ============================================================================
-- Drop "TeamRole" enum (no more references after CustomerUser.role drop)
-- ============================================================================
DROP TYPE "TeamRole";
