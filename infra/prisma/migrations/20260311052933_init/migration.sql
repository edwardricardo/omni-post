-- AlterTable
ALTER TABLE "PostMedia" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
