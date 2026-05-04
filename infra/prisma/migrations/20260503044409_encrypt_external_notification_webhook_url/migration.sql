/*
  Warnings:

  - You are about to drop the column `webhookUrl` on the `ExternalNotificationConfig` table. All the data in the column will be lost.
  - Added the required column `webhookUrlAuthTag` to the `ExternalNotificationConfig` table without a default value. This is not possible if the table is not empty.
  - Added the required column `webhookUrlCiphertext` to the `ExternalNotificationConfig` table without a default value. This is not possible if the table is not empty.
  - Added the required column `webhookUrlIv` to the `ExternalNotificationConfig` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ExternalNotificationConfig" DROP COLUMN "webhookUrl",
ADD COLUMN     "webhookUrlAuthTag" TEXT NOT NULL,
ADD COLUMN     "webhookUrlCiphertext" TEXT NOT NULL,
ADD COLUMN     "webhookUrlIv" TEXT NOT NULL,
ADD COLUMN     "webhookUrlKeyVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "ExternalNotificationConfig_webhookUrlKeyVersion_idx" ON "ExternalNotificationConfig"("webhookUrlKeyVersion");
