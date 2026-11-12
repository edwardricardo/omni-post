-- A migrated database holds no row of the application (docs/product/plan/chain.md, "The platform
-- starts from an empty database"). The 29 rows that 20260506193101_add_secret_rotation_log inserted
-- leave the rotation log: they say every catalogued secret was rotated on 2026-04-21, which is
-- false for a database whose secrets were generated later. Nothing writes this table yet; a
-- recorded rotation writes its rows when that capability is built (docs/product/plan/areas.md,
-- "An administrator checks which platform secrets are due for rotation").
--
-- The predicate names that baseline alone: its note, its instant and its missing author together.
-- A row a later writer records differs in at least one of the three, and stays.
DELETE FROM "SecretRotationLog"
WHERE "notes" = 'T0A initial baseline'
  AND "rotatedAt" = '2026-04-21T00:00:00Z'
  AND "rotatedBy" IS NULL;
