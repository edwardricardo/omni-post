-- CreateEnum
CREATE TYPE "AnnouncementType" AS ENUM ('INFO', 'WARNING', 'MAINTENANCE', 'CRITICAL');

-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "avatarUrl" TEXT;

-- AlterTable
ALTER TABLE "CustomerUser" ADD COLUMN     "avatarUrl" TEXT;

-- AlterTable
ALTER TABLE "TeamMember" ADD COLUMN     "inviteToken" TEXT,
ADD COLUMN     "inviteTokenExpiry" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SystemAnnouncement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" "AnnouncementType" NOT NULL DEFAULT 'INFO',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SystemAnnouncement_isActive_startsAt_idx" ON "SystemAnnouncement"("isActive", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_inviteToken_key" ON "TeamMember"("inviteToken");
