-- CreateTable
CREATE TABLE "UsageMetric" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "postsPublished" INTEGER NOT NULL DEFAULT 0,
    "aiCallsMade" INTEGER NOT NULL DEFAULT 0,
    "storageGb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "teamMemberCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageMetric_accountId_periodYear_periodMonth_idx" ON "UsageMetric"("accountId", "periodYear", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "UsageMetric_accountId_periodYear_periodMonth_key" ON "UsageMetric"("accountId", "periodYear", "periodMonth");

-- AddForeignKey
ALTER TABLE "UsageMetric" ADD CONSTRAINT "UsageMetric_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
