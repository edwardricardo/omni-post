-- CreateEnum
CREATE TYPE "BulkScheduleBatchStatus" AS ENUM ('PROCESSING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "BulkScheduleItemStatus" AS ENUM ('PENDING', 'SCHEDULED', 'FAILED');

-- CreateTable
CREATE TABLE "BulkScheduleBatch" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "status" "BulkScheduleBatchStatus" NOT NULL DEFAULT 'PROCESSING',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "BulkScheduleBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkScheduleItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "BulkScheduleItemStatus" NOT NULL DEFAULT 'PENDING',
    "postId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "BulkScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BulkScheduleBatch_accountId_projectId_idx" ON "BulkScheduleBatch"("accountId", "projectId");

-- CreateIndex
CREATE INDEX "BulkScheduleItem_batchId_idx" ON "BulkScheduleItem"("batchId");

-- AddForeignKey
ALTER TABLE "BulkScheduleBatch" ADD CONSTRAINT "BulkScheduleBatch_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkScheduleBatch" ADD CONSTRAINT "BulkScheduleBatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkScheduleItem" ADD CONSTRAINT "BulkScheduleItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BulkScheduleBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
