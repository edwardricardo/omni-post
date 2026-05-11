-- Align SecuritySettings.sessionTimeoutMinutes default with the admin
-- session-cookie TTL (`SESSION_MAX_AGE = 15 * 60` in
-- apps/admin/lib/auth/sessionCookie.ts).
--
-- Prior default of 1440 (24h) caused the access JWT issued at login to
-- remain valid server-side for 24h while the frontend cookie expired
-- every 15 min — meaning a leaked JWT remained usable far beyond the
-- "session window" the UI implied. Ref: F.7 Auth audit, finding #1.
--
-- The schema-level `@default(15)` change is enforced at the Prisma
-- client layer (no DB-level column default to alter). This UPDATE
-- statement back-fills the singleton row that was seeded with 1440 so
-- existing dev/test environments converge on the new value.

UPDATE "SecuritySettings" SET "sessionTimeoutMinutes" = 15 WHERE "sessionTimeoutMinutes" = 1440;
