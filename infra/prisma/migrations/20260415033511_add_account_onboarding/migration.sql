-- CreateTable
CREATE TABLE "AccountOnboarding" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "connectedFirstProvider" BOOLEAN NOT NULL DEFAULT false,
    "createdFirstPost" BOOLEAN NOT NULL DEFAULT false,
    "invitedTeamMember" BOOLEAN NOT NULL DEFAULT false,
    "configuredBilling" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountOnboarding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountOnboarding_accountId_key" ON "AccountOnboarding"("accountId");

-- AddForeignKey
ALTER TABLE "AccountOnboarding" ADD CONSTRAINT "AccountOnboarding_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
