-- AlterTable
ALTER TABLE "SagaInstance" ADD COLUMN     "nextRetryAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "SecuritySettings" ALTER COLUMN "sessionTimeoutMinutes" SET DEFAULT 15;

-- CreateIndex
CREATE INDEX "SagaInstance_status_nextRetryAt_idx" ON "SagaInstance"("status", "nextRetryAt");
