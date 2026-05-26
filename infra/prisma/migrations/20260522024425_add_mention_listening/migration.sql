-- CreateEnum
CREATE TYPE "MentionSource" AS ENUM ('WEBHOOK', 'SEARCH');

-- CreateEnum
CREATE TYPE "TrackedTermKind" AS ENUM ('BRAND', 'MARKET');

-- CreateEnum
CREATE TYPE "MentionSentiment" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE');

-- DropIndex
DROP INDEX "Glossary_embedding_hnsw_idx";

-- DropIndex
DROP INDEX "StyleGuideRule_embedding_hnsw_idx";

-- CreateTable
CREATE TABLE "TrackedTerm" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "kind" "TrackedTermKind" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TrackedTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mention" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "trackedTermId" TEXT,
    "channelId" TEXT,
    "source" "MentionSource" NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorHandle" TEXT,
    "authorAvatarUrl" TEXT,
    "authorProviderId" TEXT NOT NULL,
    "url" TEXT,
    "body" TEXT NOT NULL,
    "lang" TEXT,
    "mediaUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sentimentScore" DECIMAL(3,2),
    "sentimentLabel" "MentionSentiment",
    "providerCreatedAt" TIMESTAMPTZ(6) NOT NULL,
    "ingestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Mention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrackedTerm_projectId_isActive_idx" ON "TrackedTerm"("projectId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedTerm_projectId_term_key" ON "TrackedTerm"("projectId", "term");

-- CreateIndex
CREATE INDEX "Mention_accountId_projectId_providerCreatedAt_idx" ON "Mention"("accountId", "projectId", "providerCreatedAt");

-- CreateIndex
CREATE INDEX "Mention_projectId_trackedTermId_idx" ON "Mention"("projectId", "trackedTermId");

-- CreateIndex
CREATE INDEX "Mention_provider_providerCreatedAt_idx" ON "Mention"("provider", "providerCreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Mention_provider_externalId_key" ON "Mention"("provider", "externalId");

-- AddForeignKey
ALTER TABLE "TrackedTerm" ADD CONSTRAINT "TrackedTerm_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedTerm" ADD CONSTRAINT "TrackedTerm_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_trackedTermId_fkey" FOREIGN KEY ("trackedTermId") REFERENCES "TrackedTerm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
