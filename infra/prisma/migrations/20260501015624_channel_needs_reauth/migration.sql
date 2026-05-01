-- T4-I: Channel auth lifecycle.
--
-- `needsReauth` is flipped by workers when the provider returns an AUTH error
-- (token expired, scope revoked, account suspended). `authFailedAt` retains
-- when it happened; `authFailureReason` retains the provider's message for
-- inspection.
--
-- The partial index on `needsReauth = true` keeps lookup of "channels needing
-- attention" cheap regardless of total channel count — only the small subset
-- that actually needs reauth lives in the index.

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "authFailedAt" TIMESTAMP(3),
ADD COLUMN     "authFailureReason" TEXT,
ADD COLUMN     "needsReauth" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex (partial — covers only channels currently needing reauth)
CREATE INDEX "Channel_needsReauth_idx" ON "Channel" ("needsReauth")
  WHERE "needsReauth" = true;
