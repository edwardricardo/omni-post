-- AlterTable
ALTER TABLE "public"."Account" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."Channel" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."Post" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."Project" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Account_deletedAt_idx" ON "public"."Account"("deletedAt");

-- CreateIndex
CREATE INDEX "Channel_deletedAt_idx" ON "public"."Channel"("deletedAt");

-- CreateIndex
CREATE INDEX "Post_deletedAt_idx" ON "public"."Post"("deletedAt");

-- CreateIndex
CREATE INDEX "Project_deletedAt_idx" ON "public"."Project"("deletedAt");
