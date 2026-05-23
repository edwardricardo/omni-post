-- CreateEnum
CREATE TYPE "ConversionType" AS ENUM ('SALE', 'LEAD', 'SIGNUP', 'DOWNLOAD', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "ConversionAttribution" AS ENUM ('FIRST_CLICK', 'LAST_CLICK', 'LINEAR', 'TIME_DECAY');

-- CreateTable
CREATE TABLE "Conversion" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "source" "Provider" NOT NULL,
    "contentId" TEXT NOT NULL,
    "conversionType" "ConversionType" NOT NULL,
    "value" DECIMAL(19,4) NOT NULL,
    "attribution" "ConversionAttribution" NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conversion_accountId_occurredAt_idx" ON "Conversion"("accountId", "occurredAt");

-- CreateIndex
CREATE INDEX "Conversion_contentId_idx" ON "Conversion"("contentId");

-- CreateIndex
CREATE INDEX "Conversion_source_occurredAt_idx" ON "Conversion"("source", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversion_accountId_source_contentId_conversionType_occurr_key" ON "Conversion"("accountId", "source", "contentId", "conversionType", "occurredAt");

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
