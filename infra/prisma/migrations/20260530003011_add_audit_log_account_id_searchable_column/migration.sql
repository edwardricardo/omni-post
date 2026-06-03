-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "accountId" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_accountId_createdAt_idx" ON "AuditLog"("accountId", "createdAt");
