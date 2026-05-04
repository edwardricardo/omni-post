-- AlterTable: add `providerAccountId` so webhook processors can resolve a
-- channel by the provider's entity ID without decrypting credentials.
ALTER TABLE "Channel" ADD COLUMN "providerAccountId" TEXT;

-- CreateIndex
CREATE INDEX "Channel_provider_providerAccountId_idx"
  ON "Channel"("provider", "providerAccountId")
  WHERE "deletedAt" IS NULL;
