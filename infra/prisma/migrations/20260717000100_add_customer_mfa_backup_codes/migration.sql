-- AlterTable
ALTER TABLE "CustomerUser" ADD COLUMN     "mfaBackupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "mfaBackupUsedAt" JSONB DEFAULT '{}';
