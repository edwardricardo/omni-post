-- CreateEnum
CREATE TYPE "TrendSource" AS ENUM ('PERPLEXITY_WEB', 'ACCOUNT_ANALYTICS', 'INBOX_MENTIONS');

-- AlterTable
ALTER TABLE "TrendRadarResult" ADD COLUMN     "source" "TrendSource" NOT NULL DEFAULT 'PERPLEXITY_WEB',
ADD COLUMN     "sourceUrl" TEXT;

-- CreateIndex
CREATE INDEX "TrendRadarResult_accountId_topic_fetchedAt_idx" ON "TrendRadarResult"("accountId", "topic", "fetchedAt");
