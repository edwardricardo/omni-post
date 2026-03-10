-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('CSV', 'JSON');

-- AlterTable
ALTER TABLE "TrackedLink" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "utmCampaign" TEXT,
ADD COLUMN     "utmContent" TEXT,
ADD COLUMN     "utmMedium" TEXT,
ADD COLUMN     "utmSource" TEXT,
ADD COLUMN     "utmTerm" TEXT;

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignPost" (
    "campaignId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "taggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignPost_pkey" PRIMARY KEY ("campaignId","postId")
);

-- CreateTable
CREATE TABLE "AnalyticsDailySummary" (
    "id" TEXT NOT NULL,
    "postId" TEXT,
    "channelId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "date" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "records" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsDailySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsMonthlySummary" (
    "id" TEXT NOT NULL,
    "postId" TEXT,
    "channelId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "month" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "records" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsMonthlySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cronSchedule" TEXT NOT NULL,
    "format" "ReportFormat" NOT NULL DEFAULT 'CSV',
    "recipients" TEXT[],
    "filters" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_projectId_status_idx" ON "Campaign"("projectId", "status");

-- CreateIndex
CREATE INDEX "Campaign_projectId_createdAt_idx" ON "Campaign"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "CampaignPost_postId_idx" ON "CampaignPost"("postId");

-- CreateIndex
CREATE INDEX "AnalyticsDailySummary_channelId_date_idx" ON "AnalyticsDailySummary"("channelId", "date");

-- CreateIndex
CREATE INDEX "AnalyticsDailySummary_provider_date_idx" ON "AnalyticsDailySummary"("provider", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDailySummary_postId_channelId_provider_date_key" ON "AnalyticsDailySummary"("postId", "channelId", "provider", "date");

-- CreateIndex
CREATE INDEX "AnalyticsMonthlySummary_channelId_month_idx" ON "AnalyticsMonthlySummary"("channelId", "month");

-- CreateIndex
CREATE INDEX "AnalyticsMonthlySummary_provider_month_idx" ON "AnalyticsMonthlySummary"("provider", "month");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsMonthlySummary_postId_channelId_provider_month_key" ON "AnalyticsMonthlySummary"("postId", "channelId", "provider", "month");

-- CreateIndex
CREATE INDEX "ScheduledReport_projectId_isActive_idx" ON "ScheduledReport"("projectId", "isActive");

-- CreateIndex
CREATE INDEX "ScheduledReport_nextRunAt_isActive_idx" ON "ScheduledReport"("nextRunAt", "isActive");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignPost" ADD CONSTRAINT "CampaignPost_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignPost" ADD CONSTRAINT "CampaignPost_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledReport" ADD CONSTRAINT "ScheduledReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
