-- DropIndex
DROP INDEX "Account_isOnTrial_trialEndDate_idx";

-- DropIndex
DROP INDEX "Account_nextBillingDate_idx";

-- DropIndex
DROP INDEX "Channel_createdAt_idx";

-- DropIndex
DROP INDEX "Channel_projectId_idx";

-- DropIndex
DROP INDEX "Channel_projectId_provider_idx";

-- DropIndex
DROP INDEX "Channel_provider_idx";

-- DropIndex
DROP INDEX "ConversationNote_authorId_idx";

-- DropIndex
DROP INDEX "ConversationNote_conversationId_idx";

-- DropIndex
DROP INDEX "CustomerUser_accountId_idx";

-- DropIndex
DROP INDEX "CustomerUser_email_idx";

-- DropIndex
DROP INDEX "MediaAsset_accountId_idx";

-- DropIndex
DROP INDEX "MediaAsset_folderId_idx";

-- DropIndex
DROP INDEX "MediaAsset_mimeType_idx";

-- DropIndex
DROP INDEX "MediaAsset_projectId_idx";

-- DropIndex
DROP INDEX "Post_projectId_createdAt_idx";

-- DropIndex
DROP INDEX "Post_projectId_publishedAt_idx";

-- DropIndex
DROP INDEX "Post_projectId_scheduledAt_status_idx";

-- DropIndex
DROP INDEX "Post_projectId_status_idx";

-- DropIndex
DROP INDEX "Post_scheduledAt_idx";

-- DropIndex
DROP INDEX "PostComment_authorId_idx";

-- DropIndex
DROP INDEX "PostComment_parentId_idx";

-- DropIndex
DROP INDEX "Project_accountId_idx";

-- DropIndex
DROP INDEX "Project_createdAt_idx";

-- DropIndex
DROP INDEX "Project_isInCrisisMode_idx";

-- DropIndex
DROP INDEX "Project_locale_idx";

-- DropIndex
DROP INDEX "Task_accountId_idx";

-- DropIndex
DROP INDEX "Task_assigneeId_idx";

-- DropIndex
DROP INDEX "Task_createdById_idx";

-- DropIndex
DROP INDEX "Task_status_idx";

-- DropIndex
DROP INDEX "Template_accountId_isActive_idx";

-- DropIndex
DROP INDEX "Template_category_idx";

-- DropIndex
DROP INDEX "Template_platforms_idx";

-- DropIndex
DROP INDEX "Template_projectId_isActive_idx";

-- DropIndex
DROP INDEX "Template_tags_idx";

-- AlterTable
ALTER TABLE "AccountPricingTier" ALTER COLUMN "multiplier" SET DATA TYPE DECIMAL(10,6);

-- AlterTable
ALTER TABLE "AccountSubscription" ALTER COLUMN "pricePerMonth" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "ProviderBundle" ALTER COLUMN "pricePerAccountMonth" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "ProviderPricingTier" ALTER COLUMN "pricePerProviderMonth" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "RepurposeProposal" ALTER COLUMN "engagementRate" SET DATA TYPE DECIMAL(10,6),
ALTER COLUMN "engagementMultiplier" SET DATA TYPE DECIMAL(10,6);

-- AlterTable
ALTER TABLE "SubscriptionPriceHistory" ALTER COLUMN "previousPrice" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "newPrice" SET DATA TYPE DECIMAL(19,4);

-- CreateIndex
CREATE INDEX "Account_isOnTrial_trialEndDate_idx" ON "Account"("isOnTrial", "trialEndDate") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Account_nextBillingDate_idx" ON "Account"("nextBillingDate") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Channel_projectId_idx" ON "Channel"("projectId") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Channel_provider_idx" ON "Channel"("provider") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Channel_projectId_provider_idx" ON "Channel"("projectId", "provider") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Channel_createdAt_idx" ON "Channel"("createdAt") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "ConversationNote_conversationId_idx" ON "ConversationNote"("conversationId") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "ConversationNote_authorId_idx" ON "ConversationNote"("authorId") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "CustomerUser_accountId_idx" ON "CustomerUser"("accountId") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "CustomerUser_email_idx" ON "CustomerUser"("email") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "MediaAsset_accountId_idx" ON "MediaAsset"("accountId") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "MediaAsset_projectId_idx" ON "MediaAsset"("projectId") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "MediaAsset_folderId_idx" ON "MediaAsset"("folderId") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "MediaAsset_mimeType_idx" ON "MediaAsset"("mimeType") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Post_scheduledAt_idx" ON "Post"("scheduledAt") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Post_projectId_status_idx" ON "Post"("projectId", "status") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Post_projectId_createdAt_idx" ON "Post"("projectId", "createdAt") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Post_projectId_publishedAt_idx" ON "Post"("projectId", "publishedAt") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Post_projectId_scheduledAt_status_idx" ON "Post"("projectId", "scheduledAt", "status") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "PostComment_parentId_idx" ON "PostComment"("parentId") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "PostComment_authorId_idx" ON "PostComment"("authorId") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Project_accountId_idx" ON "Project"("accountId") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Project_createdAt_idx" ON "Project"("createdAt") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Project_locale_idx" ON "Project"("locale") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Project_isInCrisisMode_idx" ON "Project"("isInCrisisMode") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Task_accountId_idx" ON "Task"("accountId") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Task_createdById_idx" ON "Task"("createdById") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Template_projectId_isActive_idx" ON "Template"("projectId", "isActive") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Template_accountId_isActive_idx" ON "Template"("accountId", "isActive") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Template_category_idx" ON "Template"("category") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Template_platforms_idx" ON "Template"("platforms") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Template_tags_idx" ON "Template"("tags") WHERE ("deletedAt" IS NULL);
