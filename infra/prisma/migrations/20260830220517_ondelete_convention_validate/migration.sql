-- Validate the 24 FK constraints re-added as NOT VALID by the ON DELETE convention
-- alignment migration. Runs in its own migration file (= its own transaction) so each
-- VALIDATE takes only SHARE UPDATE EXCLUSIVE: reads and writes proceed during the scan.
-- No data audit is needed between the two migrations: the constraint predicate is
-- unchanged (same columns, same referenced table), so every row that satisfied the old
-- constraint satisfies the new one by construction (schema-conventions.md "Changing an
-- existing ON DELETE action").

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '300s';

ALTER TABLE "AdminRoleHistory" VALIDATE CONSTRAINT "AdminRoleHistory_userId_fkey";
ALTER TABLE "CustomerUser" VALIDATE CONSTRAINT "CustomerUser_roleId_fkey";
ALTER TABLE "ApprovalRequest" VALIDATE CONSTRAINT "ApprovalRequest_submitterId_fkey";
ALTER TABLE "ApprovalReview" VALIDATE CONSTRAINT "ApprovalReview_reviewerId_fkey";
ALTER TABLE "Task" VALIDATE CONSTRAINT "Task_createdById_fkey";
ALTER TABLE "PostComment" VALIDATE CONSTRAINT "PostComment_authorId_fkey";
ALTER TABLE "Post" VALIDATE CONSTRAINT "Post_projectId_fkey";
ALTER TABLE "PostContent" VALIDATE CONSTRAINT "PostContent_postId_fkey";
ALTER TABLE "PostMedia" VALIDATE CONSTRAINT "PostMedia_postId_fkey";
ALTER TABLE "Channel" VALIDATE CONSTRAINT "Channel_projectId_fkey";
ALTER TABLE "Analytics" VALIDATE CONSTRAINT "Analytics_postId_fkey";
ALTER TABLE "ContentTemplate" VALIDATE CONSTRAINT "ContentTemplate_projectId_fkey";
ALTER TABLE "WebhookEvent" VALIDATE CONSTRAINT "WebhookEvent_accountId_fkey";
ALTER TABLE "WebhookEvent" VALIDATE CONSTRAINT "WebhookEvent_projectId_fkey";
ALTER TABLE "SocialMessage" VALIDATE CONSTRAINT "SocialMessage_channelId_fkey";
ALTER TABLE "SocialConversation" VALIDATE CONSTRAINT "SocialConversation_channelId_fkey";
ALTER TABLE "ConversationNote" VALIDATE CONSTRAINT "ConversationNote_authorId_fkey";
ALTER TABLE "SocialOutboundReply" VALIDATE CONSTRAINT "SocialOutboundReply_authorId_fkey";
ALTER TABLE "CustomReport" VALIDATE CONSTRAINT "CustomReport_createdById_fkey";
ALTER TABLE "BundleFeatureFlag" VALIDATE CONSTRAINT "BundleFeatureFlag_bundleId_fkey";
ALTER TABLE "AccountSubscription" VALIDATE CONSTRAINT "AccountSubscription_bundleId_fkey";
ALTER TABLE "SubscriptionPriceHistory" VALIDATE CONSTRAINT "SubscriptionPriceHistory_subscriptionId_fkey";
ALTER TABLE "Invoice" VALIDATE CONSTRAINT "Invoice_accountId_fkey";
ALTER TABLE "RepurposeProposal" VALIDATE CONSTRAINT "RepurposeProposal_sourcePostId_fkey";
ALTER TABLE "Referral" VALIDATE CONSTRAINT "Referral_referralCodeId_fkey";
