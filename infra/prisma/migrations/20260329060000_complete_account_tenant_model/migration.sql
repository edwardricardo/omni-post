-- AlterTable: Add tenant fields to Account
ALTER TABLE "Account" ADD COLUMN "slug" TEXT;
ALTER TABLE "Account" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE "Account" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "Account" ADD COLUMN "phone" TEXT;
ALTER TABLE "Account" ADD COLUMN "maxTeamMembers" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "Account" ADD COLUMN "maxStorageBytes" BIGINT NOT NULL DEFAULT 5368709120;
ALTER TABLE "Account" ADD COLUMN "maxRecurringPosts" INTEGER NOT NULL DEFAULT 5;

-- CreateIndex
CREATE UNIQUE INDEX "Account_slug_key" ON "Account"("slug");
