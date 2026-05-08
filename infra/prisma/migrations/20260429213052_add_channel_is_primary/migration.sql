-- Add `is_primary` column with default `false`. Existing rows are NOT primary
-- by default; the backfill below promotes the oldest non-deleted channel
-- per (project_id, provider) to primary so existing tenants get a sensible
-- default without manual intervention.
ALTER TABLE "Channel" ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: mark the oldest non-deleted channel per (projectId, provider) as primary.
-- Uses ROW_NUMBER() with createdAt ASC tie-broken by id to deterministically pick
-- a single primary. NULLS LAST is implicit because deletedAt IS NULL is in the WHERE.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "projectId", "provider"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS rn
  FROM "Channel"
  WHERE "deletedAt" IS NULL
)
UPDATE "Channel"
SET "isPrimary" = true
FROM ranked
WHERE "Channel"."id" = ranked."id" AND ranked.rn = 1;

-- Partial unique index: only one primary channel per (projectId, provider) among
-- non-deleted channels. Soft-deleted rows (deletedAt IS NOT NULL) are excluded so
-- a previous primary that was deleted does not block a new primary from being set.
CREATE UNIQUE INDEX "Channel_projectId_provider_isPrimary_unique"
  ON "Channel" ("projectId", "provider")
  WHERE "isPrimary" = true AND "deletedAt" IS NULL;
