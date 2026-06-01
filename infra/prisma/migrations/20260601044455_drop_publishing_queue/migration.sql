/*
  Warnings:

  - You are about to drop the column `queueId` on the `ContentVersion` table. All the data in the column will be lost.
  - You are about to drop the `PublishingQueue` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ContentVersion" DROP CONSTRAINT "ContentVersion_queueId_fkey";

-- DropForeignKey
ALTER TABLE "PublishingQueue" DROP CONSTRAINT "PublishingQueue_accountId_fkey";

-- DropForeignKey
ALTER TABLE "PublishingQueue" DROP CONSTRAINT "PublishingQueue_parentQueueId_fkey";

-- DropForeignKey
ALTER TABLE "PublishingQueue" DROP CONSTRAINT "PublishingQueue_postId_fkey";

-- DropForeignKey
ALTER TABLE "PublishingQueue" DROP CONSTRAINT "PublishingQueue_projectId_fkey";

-- DropForeignKey
ALTER TABLE "PublishingQueue" DROP CONSTRAINT "PublishingQueue_storyProjectId_fkey";

-- DropForeignKey
ALTER TABLE "PublishingQueue" DROP CONSTRAINT "PublishingQueue_templateId_fkey";

-- DropForeignKey
ALTER TABLE "PublishingQueue" DROP CONSTRAINT "PublishingQueue_videoProcessingJobId_fkey";

-- DropIndex
DROP INDEX "ContentVersion_queueId_idx";

-- AlterTable
ALTER TABLE "ContentVersion" DROP COLUMN "queueId";

-- DropTable
DROP TABLE "PublishingQueue";

-- DropEnum
DROP TYPE "PublishingStatus";

-- DropEnum
DROP TYPE "QueuePriority";
