-- AlterTable
ALTER TABLE "ApprovalRequest" ADD COLUMN     "submitterCustomerUserId" TEXT;

-- AlterTable
ALTER TABLE "ApprovalReview" ADD COLUMN     "reviewerCustomerUserId" TEXT;

-- AlterTable
ALTER TABLE "ApprovalWorkflowLevel" ADD COLUMN     "assigneeCustomerUserId" TEXT;

-- AlterTable
ALTER TABLE "ConversationNote" ADD COLUMN     "authorCustomerUserId" TEXT;

-- AlterTable
ALTER TABLE "CustomReport" ADD COLUMN     "createdByCustomerUserId" TEXT;

-- AlterTable
ALTER TABLE "CustomerUser" ADD COLUMN     "inviteToken" TEXT,
ADD COLUMN     "inviteTokenExpiry" TIMESTAMPTZ(6),
ADD COLUMN     "invitedBy" TEXT,
ADD COLUMN     "joinedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "roleId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "recipientCustomerUserId" TEXT;

-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "customerUserId" TEXT;

-- AlterTable
ALTER TABLE "PostComment" ADD COLUMN     "authorCustomerUserId" TEXT;

-- AlterTable
ALTER TABLE "ProjectMember" ADD COLUMN     "customerUserId" TEXT;

-- AlterTable
ALTER TABLE "SocialConversation" ADD COLUMN     "resolvedByCustomerUserId" TEXT;

-- AlterTable
ALTER TABLE "SocialMessage" ADD COLUMN     "assigneeCustomerUserId" TEXT;

-- AlterTable
ALTER TABLE "SocialOutboundReply" ADD COLUMN     "authorCustomerUserId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "assigneeCustomerUserId" TEXT,
ADD COLUMN     "createdByCustomerUserId" TEXT;

-- CreateTable
CREATE TABLE "CustomerRole" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "level" INTEGER NOT NULL DEFAULT 1,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CustomerRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerRolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerRolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRole_name_key" ON "CustomerRole"("name");

-- CreateIndex
CREATE INDEX "CustomerRole_isActive_idx" ON "CustomerRole"("isActive");

-- CreateIndex
CREATE INDEX "CustomerRolePermission_roleId_idx" ON "CustomerRolePermission"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRolePermission_roleId_permission_key" ON "CustomerRolePermission"("roleId", "permission");

-- CreateIndex
CREATE INDEX "ApprovalRequest_submitterCustomerUserId_idx" ON "ApprovalRequest"("submitterCustomerUserId");

-- CreateIndex
CREATE INDEX "ApprovalReview_reviewerCustomerUserId_idx" ON "ApprovalReview"("reviewerCustomerUserId");

-- CreateIndex
CREATE INDEX "ApprovalWorkflowLevel_assigneeCustomerUserId_idx" ON "ApprovalWorkflowLevel"("assigneeCustomerUserId");

-- CreateIndex
CREATE INDEX "ConversationNote_authorCustomerUserId_idx" ON "ConversationNote"("authorCustomerUserId") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "CustomReport_createdByCustomerUserId_idx" ON "CustomReport"("createdByCustomerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerUser_inviteToken_key" ON "CustomerUser"("inviteToken");

-- CreateIndex
CREATE INDEX "CustomerUser_roleId_idx" ON "CustomerUser"("roleId");

-- CreateIndex
CREATE INDEX "Notification_recipientCustomerUserId_idx" ON "Notification"("recipientCustomerUserId");

-- CreateIndex
CREATE INDEX "NotificationPreference_customerUserId_idx" ON "NotificationPreference"("customerUserId");

-- CreateIndex
CREATE INDEX "PostComment_authorCustomerUserId_idx" ON "PostComment"("authorCustomerUserId") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "ProjectMember_customerUserId_idx" ON "ProjectMember"("customerUserId");

-- CreateIndex
CREATE INDEX "SocialConversation_resolvedByCustomerUserId_idx" ON "SocialConversation"("resolvedByCustomerUserId");

-- CreateIndex
CREATE INDEX "SocialMessage_assigneeCustomerUserId_status_idx" ON "SocialMessage"("assigneeCustomerUserId", "status");

-- CreateIndex
CREATE INDEX "SocialOutboundReply_authorCustomerUserId_idx" ON "SocialOutboundReply"("authorCustomerUserId");

-- CreateIndex
CREATE INDEX "Task_assigneeCustomerUserId_idx" ON "Task"("assigneeCustomerUserId") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Task_createdByCustomerUserId_idx" ON "Task"("createdByCustomerUserId") WHERE ("deletedAt" IS NULL);

-- AddForeignKey
ALTER TABLE "CustomerRolePermission" ADD CONSTRAINT "CustomerRolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "CustomerRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerUser" ADD CONSTRAINT "CustomerUser_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "CustomerRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "CustomerUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientCustomerUserId_fkey" FOREIGN KEY ("recipientCustomerUserId") REFERENCES "CustomerUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "CustomerUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalWorkflowLevel" ADD CONSTRAINT "ApprovalWorkflowLevel_assigneeCustomerUserId_fkey" FOREIGN KEY ("assigneeCustomerUserId") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_submitterCustomerUserId_fkey" FOREIGN KEY ("submitterCustomerUserId") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalReview" ADD CONSTRAINT "ApprovalReview_reviewerCustomerUserId_fkey" FOREIGN KEY ("reviewerCustomerUserId") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeCustomerUserId_fkey" FOREIGN KEY ("assigneeCustomerUserId") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdByCustomerUserId_fkey" FOREIGN KEY ("createdByCustomerUserId") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_authorCustomerUserId_fkey" FOREIGN KEY ("authorCustomerUserId") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_assigneeCustomerUserId_fkey" FOREIGN KEY ("assigneeCustomerUserId") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialConversation" ADD CONSTRAINT "SocialConversation_resolvedByCustomerUserId_fkey" FOREIGN KEY ("resolvedByCustomerUserId") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationNote" ADD CONSTRAINT "ConversationNote_authorCustomerUserId_fkey" FOREIGN KEY ("authorCustomerUserId") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialOutboundReply" ADD CONSTRAINT "SocialOutboundReply_authorCustomerUserId_fkey" FOREIGN KEY ("authorCustomerUserId") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomReport" ADD CONSTRAINT "CustomReport_createdByCustomerUserId_fkey" FOREIGN KEY ("createdByCustomerUserId") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
