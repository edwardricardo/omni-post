-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "mfaLastUsedTotpStep" INTEGER;

-- AlterTable
ALTER TABLE "CustomerUser" ADD COLUMN     "mfaLastUsedTotpStep" INTEGER;
