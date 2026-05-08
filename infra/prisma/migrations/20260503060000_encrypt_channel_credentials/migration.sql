-- Drop existing dev/test channels (credentials column is plaintext placeholder
-- data; production deployments must run a separate backfill script before
-- this migration that encrypts existing rows via EncryptionService and
-- writes them to the new columns).
DELETE FROM "Channel";

-- AlterTable: replace plaintext JSON `credentials` with encrypted columns.
ALTER TABLE "Channel" DROP COLUMN "credentials";
ALTER TABLE "Channel" ADD COLUMN "credentialsCiphertext" TEXT NOT NULL;
ALTER TABLE "Channel" ADD COLUMN "credentialsIv" TEXT NOT NULL;
ALTER TABLE "Channel" ADD COLUMN "credentialsAuthTag" TEXT NOT NULL;
ALTER TABLE "Channel" ADD COLUMN "credentialsKeyVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "Channel_credentialsKeyVersion_idx" ON "Channel"("credentialsKeyVersion");
