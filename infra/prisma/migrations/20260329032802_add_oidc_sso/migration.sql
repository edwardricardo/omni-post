-- CreateEnum
CREATE TYPE "SsoProvider" AS ENUM ('NONE', 'SAML', 'OIDC');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "ssoProvider" "SsoProvider" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "OidcConfiguration" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "issuerUrl" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['openid', 'email', 'profile']::TEXT[],
    "attributeMapping" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OidcConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OidcConfiguration_accountId_key" ON "OidcConfiguration"("accountId");

-- AddForeignKey
ALTER TABLE "OidcConfiguration" ADD CONSTRAINT "OidcConfiguration_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
