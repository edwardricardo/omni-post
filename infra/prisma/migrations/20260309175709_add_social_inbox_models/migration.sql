-- CreateEnum
CREATE TYPE "SocialMessageType" AS ENUM ('COMMENT', 'MENTION', 'DIRECT_MESSAGE', 'REPLY');

-- CreateEnum
CREATE TYPE "SocialMessageStatus" AS ENUM ('UNREAD', 'READ', 'REPLIED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OutboundReplyStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'INBOX_MESSAGE_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'INBOX_MENTION_RECEIVED';

-- CreateTable
CREATE TABLE "SocialMessage" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "conversationId" TEXT,
    "provider" "Provider" NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "providerParentId" TEXT,
    "messageType" "SocialMessageType" NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorHandle" TEXT,
    "authorAvatarUrl" TEXT,
    "authorProviderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mediaUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "webhookEventId" TEXT,
    "relatedPostId" TEXT,
    "status" "SocialMessageStatus" NOT NULL DEFAULT 'UNREAD',
    "assigneeId" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "providerCreatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialConversation" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "subject" TEXT,
    "participantCount" INTEGER NOT NULL DEFAULT 1,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "rootProviderMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialOutboundReply" (
    "id" TEXT NOT NULL,
    "socialMessageId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "providerReplyId" TEXT,
    "status" "OutboundReplyStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialOutboundReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SocialMessage_webhookEventId_key" ON "SocialMessage"("webhookEventId");

-- CreateIndex
CREATE INDEX "SocialMessage_accountId_projectId_status_idx" ON "SocialMessage"("accountId", "projectId", "status");

-- CreateIndex
CREATE INDEX "SocialMessage_conversationId_idx" ON "SocialMessage"("conversationId");

-- CreateIndex
CREATE INDEX "SocialMessage_channelId_messageType_idx" ON "SocialMessage"("channelId", "messageType");

-- CreateIndex
CREATE INDEX "SocialMessage_assigneeId_status_idx" ON "SocialMessage"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "SocialMessage_providerCreatedAt_idx" ON "SocialMessage"("providerCreatedAt");

-- CreateIndex
CREATE INDEX "SocialMessage_relatedPostId_idx" ON "SocialMessage"("relatedPostId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialMessage_provider_providerMessageId_key" ON "SocialMessage"("provider", "providerMessageId");

-- CreateIndex
CREATE INDEX "SocialConversation_accountId_projectId_isResolved_idx" ON "SocialConversation"("accountId", "projectId", "isResolved");

-- CreateIndex
CREATE INDEX "SocialConversation_channelId_provider_idx" ON "SocialConversation"("channelId", "provider");

-- CreateIndex
CREATE INDEX "SocialConversation_lastMessageAt_idx" ON "SocialConversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "SocialOutboundReply_socialMessageId_idx" ON "SocialOutboundReply"("socialMessageId");

-- CreateIndex
CREATE INDEX "SocialOutboundReply_authorId_idx" ON "SocialOutboundReply"("authorId");

-- CreateIndex
CREATE INDEX "SocialOutboundReply_status_idx" ON "SocialOutboundReply"("status");

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SocialConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "WebhookEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_relatedPostId_fkey" FOREIGN KEY ("relatedPostId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialConversation" ADD CONSTRAINT "SocialConversation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialConversation" ADD CONSTRAINT "SocialConversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialConversation" ADD CONSTRAINT "SocialConversation_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialConversation" ADD CONSTRAINT "SocialConversation_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialOutboundReply" ADD CONSTRAINT "SocialOutboundReply_socialMessageId_fkey" FOREIGN KEY ("socialMessageId") REFERENCES "SocialMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialOutboundReply" ADD CONSTRAINT "SocialOutboundReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "TeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
