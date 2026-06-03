-- Drop the index that included fetchedAt; it overlaps with the new
-- (accountId, dayKey, topic) unique constraint which is more discriminating
-- and closes the find-then-create TOCTOU window plus the day-boundary bug
-- that allowed jobs crossing midnight to insert a second row per (account, day).
DROP INDEX IF EXISTS "TrendRadarResult_accountId_topic_fetchedAt_idx";

-- Add the dayKey column. Format is YYYY-MM-DD (UTC) computed upstream so
-- the bucket is invariant across the lifetime of a single detection job.
-- Table is empty at the time of this migration; NOT NULL without backfill
-- is safe. The application enforces the format via the use case.
ALTER TABLE "TrendRadarResult" ADD COLUMN "dayKey" TEXT NOT NULL;

-- Unique constraint backing the idempotency contract of TrendRadarResultPort:
-- (accountId, dayKey, topic) uniquely identifies a detection result, so
-- concurrent detect jobs for the same logical day cannot duplicate rows.
ALTER TABLE "TrendRadarResult"
  ADD CONSTRAINT "TrendRadarResult_accountId_dayKey_topic_key"
  UNIQUE ("accountId", "dayKey", "topic");
