/*
  Warnings:

  - You are about to drop the column `clientSecret` on the `OidcConfiguration` table. All the data in the column will be lost.
  - Added the required column `clientSecretAuthTag` to the `OidcConfiguration` table without a default value. This is not possible if the table is not empty.
  - Added the required column `clientSecretCiphertext` to the `OidcConfiguration` table without a default value. This is not possible if the table is not empty.
  - Added the required column `clientSecretIv` to the `OidcConfiguration` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "OidcConfiguration" DROP COLUMN "clientSecret",
ADD COLUMN     "clientSecretAuthTag" TEXT NOT NULL,
ADD COLUMN     "clientSecretCiphertext" TEXT NOT NULL,
ADD COLUMN     "clientSecretIv" TEXT NOT NULL,
ADD COLUMN     "clientSecretKeyVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "OidcConfiguration_clientSecretKeyVersion_idx" ON "OidcConfiguration"("clientSecretKeyVersion");
