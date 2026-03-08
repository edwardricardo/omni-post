-- CreateIndex
CREATE INDEX "ContentVersion_postId_createdAt_idx" ON "public"."ContentVersion"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "Post_projectId_scheduledAt_status_idx" ON "public"."Post"("projectId", "scheduledAt", "status");

-- CreateIndex
CREATE INDEX "PublishLog_postId_createdAt_idx" ON "public"."PublishLog"("postId", "createdAt");
