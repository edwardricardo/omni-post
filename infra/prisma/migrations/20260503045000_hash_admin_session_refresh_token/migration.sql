-- DropIndex
DROP INDEX "AdminSession_refreshToken_key";

-- AlterTable: rename refreshToken column to refreshTokenHash and drop accessToken
ALTER TABLE "AdminSession" DROP COLUMN "accessToken";
ALTER TABLE "AdminSession" RENAME COLUMN "refreshToken" TO "refreshTokenHash";

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_refreshTokenHash_key" ON "AdminSession"("refreshTokenHash");
