-- ON DELETE convention alignment: every FK relation now declares its adjudicated
-- referential action (docs/architecture/schema-conventions.md "Choosing the ON DELETE
-- action"). 24 constraints swap action, 9 attribution/ledger columns become nullable.
--
-- Owned children -> CASCADE (Post.projectId, PostContent/PostMedia.postId,
-- Channel.projectId, SocialMessage/SocialConversation.channelId,
-- SubscriptionPriceHistory.subscriptionId, RepurposeProposal.sourcePostId,
-- BundleFeatureFlag.bundleId). Audit/ledger/attribution references -> SET NULL with
-- nullable FK (approval submitter/reviewer, task creator, comment/note/reply authors,
-- report creator, Invoice.accountId, AdminRoleHistory.userId, Analytics.postId,
-- ContentTemplate.projectId, WebhookEvent.accountId/projectId). Catalog references ->
-- RESTRICT (CustomerUser.roleId, AccountSubscription.bundleId).
--
-- Locks: each DROP+ADD pair takes ACCESS EXCLUSIVE on both the child and the parent
-- table, but with NOT VALID the ADD skips the existing-row scan, so every statement is
-- catalog-only: milliseconds each, ~70 statements total. DROP NOT NULL is likewise
-- catalog-only. lock_timeout bounds the wait behind any long-running reader; on
-- contention the migration fails fast and can simply be re-run. Validation happens in
-- the follow-up migration under SHARE UPDATE EXCLUSIVE (see schema-conventions.md
-- "Changing an existing ON DELETE action" for why the split must be two files).
-- NOT VALID constraints are fully live for new writes and referential actions.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';


-- Attribution/ledger columns become nullable (SET NULL needs a NULL to set)
ALTER TABLE "AdminRoleHistory" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "ApprovalRequest" ALTER COLUMN "submitterId" DROP NOT NULL;
ALTER TABLE "ApprovalReview" ALTER COLUMN "reviewerId" DROP NOT NULL;
ALTER TABLE "Task" ALTER COLUMN "createdById" DROP NOT NULL;
ALTER TABLE "PostComment" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "ConversationNote" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "SocialOutboundReply" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "CustomReport" ALTER COLUMN "createdById" DROP NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "accountId" DROP NOT NULL;

-- Swap referential actions: DROP + re-ADD as NOT VALID (no table scan)
ALTER TABLE "AdminRoleHistory" DROP CONSTRAINT "AdminRoleHistory_userId_fkey";
ALTER TABLE "AdminRoleHistory" ADD CONSTRAINT "AdminRoleHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "CustomerUser" DROP CONSTRAINT "CustomerUser_roleId_fkey";
ALTER TABLE "CustomerUser" ADD CONSTRAINT "CustomerUser_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "CustomerRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_submitterId_fkey";
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ApprovalReview" DROP CONSTRAINT "ApprovalReview_reviewerId_fkey";
ALTER TABLE "ApprovalReview" ADD CONSTRAINT "ApprovalReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Task" DROP CONSTRAINT "Task_createdById_fkey";
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "PostComment" DROP CONSTRAINT "PostComment_authorId_fkey";
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Post" DROP CONSTRAINT "Post_projectId_fkey";
ALTER TABLE "Post" ADD CONSTRAINT "Post_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "PostContent" DROP CONSTRAINT "PostContent_postId_fkey";
ALTER TABLE "PostContent" ADD CONSTRAINT "PostContent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "PostMedia" DROP CONSTRAINT "PostMedia_postId_fkey";
ALTER TABLE "PostMedia" ADD CONSTRAINT "PostMedia_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Channel" DROP CONSTRAINT "Channel_projectId_fkey";
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Analytics" DROP CONSTRAINT "Analytics_postId_fkey";
ALTER TABLE "Analytics" ADD CONSTRAINT "Analytics_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ContentTemplate" DROP CONSTRAINT "ContentTemplate_projectId_fkey";
ALTER TABLE "ContentTemplate" ADD CONSTRAINT "ContentTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "WebhookEvent" DROP CONSTRAINT "WebhookEvent_accountId_fkey";
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "WebhookEvent" DROP CONSTRAINT "WebhookEvent_projectId_fkey";
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "SocialMessage" DROP CONSTRAINT "SocialMessage_channelId_fkey";
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "SocialConversation" DROP CONSTRAINT "SocialConversation_channelId_fkey";
ALTER TABLE "SocialConversation" ADD CONSTRAINT "SocialConversation_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ConversationNote" DROP CONSTRAINT "ConversationNote_authorId_fkey";
ALTER TABLE "ConversationNote" ADD CONSTRAINT "ConversationNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "SocialOutboundReply" DROP CONSTRAINT "SocialOutboundReply_authorId_fkey";
ALTER TABLE "SocialOutboundReply" ADD CONSTRAINT "SocialOutboundReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "CustomReport" DROP CONSTRAINT "CustomReport_createdById_fkey";
ALTER TABLE "CustomReport" ADD CONSTRAINT "CustomReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "BundleFeatureFlag" DROP CONSTRAINT "BundleFeatureFlag_bundleId_fkey";
ALTER TABLE "BundleFeatureFlag" ADD CONSTRAINT "BundleFeatureFlag_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "ProviderBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "AccountSubscription" DROP CONSTRAINT "AccountSubscription_bundleId_fkey";
ALTER TABLE "AccountSubscription" ADD CONSTRAINT "AccountSubscription_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "ProviderBundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "SubscriptionPriceHistory" DROP CONSTRAINT "SubscriptionPriceHistory_subscriptionId_fkey";
ALTER TABLE "SubscriptionPriceHistory" ADD CONSTRAINT "SubscriptionPriceHistory_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "AccountSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_accountId_fkey";
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "RepurposeProposal" DROP CONSTRAINT "RepurposeProposal_sourcePostId_fkey";
ALTER TABLE "RepurposeProposal" ADD CONSTRAINT "RepurposeProposal_sourcePostId_fkey" FOREIGN KEY ("sourcePostId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

-- Signed decision (2026-08-30): Referral.referralCodeId -> SET NULL. The referral row
-- is the code's usage ledger; it survives the code's deletion unattributed instead of
-- blocking it. Account hard-delete no longer blocks while referrals exist.
ALTER TABLE "Referral" ALTER COLUMN "referralCodeId" DROP NOT NULL;
ALTER TABLE "Referral" DROP CONSTRAINT "Referral_referralCodeId_fkey";
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES "ReferralCode"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- Tombstone for hard deletes (signed decision 2026-08-30): a hard delete must leave a
-- minimal record (entity id, name, client since->until, who deleted), written inside
-- the same transaction as the delete. Deliberately FK-free: the referenced rows are
-- gone by design and this row must survive every deletion including the account's own
-- (schema-conventions.md "Foreign keys", audit-survives-deletion exception).
-- CREATE TABLE on a new table takes no lock on existing tables.
CREATE TABLE "DeletionRecord" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "clientSince" TIMESTAMPTZ(6) NOT NULL,
    "clientUntil" TIMESTAMPTZ(6) NOT NULL,
    "deletedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeletionRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeletionRecord_accountId_idx" ON "DeletionRecord"("accountId");

CREATE INDEX "DeletionRecord_entityType_entityId_idx" ON "DeletionRecord"("entityType", "entityId");
