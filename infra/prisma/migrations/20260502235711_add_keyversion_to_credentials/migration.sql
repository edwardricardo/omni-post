-- AlterTable
ALTER TABLE "AccountCredential" ADD COLUMN     "keyVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PlatformCredential" ADD COLUMN     "keyVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "AccountCredential_keyVersion_idx" ON "AccountCredential"("keyVersion");

-- CreateIndex
CREATE INDEX "PlatformCredential_keyVersion_idx" ON "PlatformCredential"("keyVersion");
