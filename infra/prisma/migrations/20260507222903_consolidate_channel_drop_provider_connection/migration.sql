/*
  Warnings:

  - You are about to drop the `ProviderConnection` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ProviderConnection" DROP CONSTRAINT "ProviderConnection_accountId_fkey";

-- DropForeignKey
ALTER TABLE "ProviderConnection" DROP CONSTRAINT "ProviderConnection_projectId_fkey";

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "accountName" TEXT,
ADD COLUMN     "connectedAt" TIMESTAMPTZ(6),
ADD COLUMN     "expiredAt" TIMESTAMPTZ(6),
ADD COLUMN     "lastUsedAt" TIMESTAMPTZ(6),
ADD COLUMN     "profileImage" TEXT;

-- Backfill connectedAt = createdAt for existing rows (PR-16 consolidation:
-- existing channels pre-date the dedicated connectedAt column, so we seed
-- it from their insertion timestamp rather than leaving NULL).
UPDATE "Channel" SET "connectedAt" = "createdAt" WHERE "connectedAt" IS NULL;

-- DropTable
DROP TABLE "ProviderConnection";

-- DropEnum
DROP TYPE "ConnectionStatus";
