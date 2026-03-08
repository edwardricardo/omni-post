/*
  Warnings:

  - Changed the type of `oldRole` on the `AdminRoleHistory` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `newRole` on the `AdminRoleHistory` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "AdminRoleHistory" DROP COLUMN "oldRole",
ADD COLUMN     "oldRole" TEXT NOT NULL,
DROP COLUMN "newRole",
ADD COLUMN     "newRole" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "AdminUser" ALTER COLUMN "passwordHashAlgo" SET DEFAULT 'argon2id';

-- CreateTable
CREATE TABLE "SagaInstance" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "context" JSONB NOT NULL,
    "stepResults" JSONB NOT NULL DEFAULT '[]',
    "compensationResults" JSONB NOT NULL DEFAULT '[]',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "accountId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SagaInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SagaInstance_status_startedAt_idx" ON "SagaInstance"("status", "startedAt");

-- CreateIndex
CREATE INDEX "SagaInstance_definitionId_status_idx" ON "SagaInstance"("definitionId", "status");

-- CreateIndex
CREATE INDEX "SagaInstance_accountId_status_idx" ON "SagaInstance"("accountId", "status");

-- CreateIndex
CREATE INDEX "SagaInstance_completedAt_idx" ON "SagaInstance"("completedAt");
