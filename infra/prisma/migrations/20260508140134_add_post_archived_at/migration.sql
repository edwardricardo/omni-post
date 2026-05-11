-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "archivedAt" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "Post_projectId_archivedAt_idx" ON "Post"("projectId", "archivedAt") WHERE ("deletedAt" IS NULL);
