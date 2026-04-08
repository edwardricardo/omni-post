-- CreateEnum
CREATE TYPE "ReportChartType" AS ENUM ('LINE', 'BAR', 'AREA', 'PIE', 'TABLE');

-- CreateTable (before enum alteration — uses pre-existing default)
CREATE TABLE "CustomReport" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metrics" TEXT[],
    "dimensions" TEXT[],
    "dateRange" TEXT NOT NULL DEFAULT 'LAST_30_DAYS',
    "dateRangeStart" TIMESTAMP(3),
    "dateRangeEnd" TIMESTAMP(3),
    "chartType" "ReportChartType" NOT NULL DEFAULT 'LINE',
    "filters" JSONB,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable (format default set to CSV first, then altered after enum expansion)
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "format" "ReportFormat" NOT NULL DEFAULT 'CSV',
    "recipients" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- AlterEnum — add new values after tables are created with safe defaults
COMMIT;
ALTER TYPE "ReportFormat" ADD VALUE IF NOT EXISTS 'PDF';
ALTER TYPE "ReportFormat" ADD VALUE IF NOT EXISTS 'XLSX';
BEGIN;

-- Now set the intended default for ReportSchedule.format
ALTER TABLE "ReportSchedule" ALTER COLUMN "format" SET DEFAULT 'PDF';

-- CreateIndex
CREATE INDEX "CustomReport_accountId_idx" ON "CustomReport"("accountId");

-- CreateIndex
CREATE INDEX "CustomReport_createdById_idx" ON "CustomReport"("createdById");

-- CreateIndex
CREATE INDEX "ReportSchedule_reportId_idx" ON "ReportSchedule"("reportId");

-- CreateIndex
CREATE INDEX "ReportSchedule_nextRunAt_idx" ON "ReportSchedule"("nextRunAt");

-- AddForeignKey
ALTER TABLE "CustomReport" ADD CONSTRAINT "CustomReport_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomReport" ADD CONSTRAINT "CustomReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "CustomReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
