-- AlterTable
ALTER TABLE "WebhookSubscription" ADD COLUMN     "previousSecretKey" TEXT,
ADD COLUMN     "previousSecretKeyExpiresAt" TIMESTAMPTZ(6);
