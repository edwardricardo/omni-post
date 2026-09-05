-- Normalize registration-identity email addresses to lowercase, trimmed form.
--
-- WHAT THIS CARRIES
--   A pure DATA migration. No DDL, no schema change: the columns, the types and
--   the unique indexes are all untouched. It rewrites existing rows so that the
--   stored value of an identity email matches the value the application now
--   writes and reads through a single normalization helper.
--
--   Three models carry a registration identity and are normalized here:
--     - "Account".email       (account-level login identity)
--     - "CustomerUser".email  (customer portal login identity, per account)
--     - "AdminUser".email     (admin portal login identity)
--
--   Two models hold an email and are deliberately NOT touched:
--     - "AdminLoginAttempt".email is a historical log of what was TYPED at a
--       login form, including the failures. Normalizing it would falsify the
--       record: an attempt against "Foo@Example.com" would read back as an
--       attempt against "foo@example.com", which is not what happened. It is
--       evidence, not identity, and it carries no unique constraint.
--     - "CrmContact".email mirrors an address owned by an EXTERNAL system.
--       Rewriting it here could break the matching key that sync uses against
--       the remote record, so the remote system stays the authority.
--
-- WHY WRITE, READ AND DATA MUST MOVE TOGETHER
--   Normalizing only the read side is worse than doing nothing. A lookup that
--   lowercases its argument and searches rows that were stored raw MISSES the
--   row it was meant to find, and a duplicate-registration check built on that
--   lookup then reports "available" for an address that is already taken. The
--   application-side change and this backfill are two halves of one fix.
--
-- COLLISION GUARD (runs FIRST, and fails loudly)
--   Normalization can merge two distinct stored addresses into one value. Where
--   a unique index covers that value, a blind UPDATE would abort on a raw
--   constraint violation that names nothing useful. So the guard below raises
--   first, listing every colliding group, and a human adjudicates which row
--   keeps the address. It reports ALL three models in one message rather than
--   stopping at the first, so one run yields the whole worklist.
--
--   The scope of a collision is NOT the same for the three models, because
--   their unique constraints are not the same shape. This is the reason the
--   guard is three separate queries and not one generic loop:
--
--     "Account"       @@unique([email], where: deletedAt IS NULL)  -- PARTIAL
--         Soft-deleted rows are OUTSIDE the index, so two soft-deleted rows may
--         legitimately share an address and are not a collision. The guard
--         therefore considers LIVE rows only. (The UPDATE still normalizes the
--         soft-deleted rows: they are unconstrained, and leaving them in mixed
--         case would make the live-holder check on the restore path compare a
--         normalized value against a raw one.)
--
--     "CustomerUser"  @@unique([accountId, email])                 -- TOTAL
--         There is NO `where` clause on this index, so soft-deleted rows ARE
--         inside it and a soft-deleted twin WILL collide. Scoping this guard to
--         live rows — the obvious symmetry with Account — would step straight
--         into the constraint violation the guard exists to prevent. The scope
--         is every row, grouped within its own accountId, because the address is
--         unique per account and not globally.
--
--     "AdminUser"     email @unique                                -- TOTAL
--         This model has no `deletedAt` column at all: it is not soft-deletable,
--         so there is no live/deleted distinction to make. Scope is every row.
--
-- MEASURED ON DEV AT AUTHORING TIME
--   "Account":       44 rows to normalize, 0 colliding groups
--   "CustomerUser":   0 rows to normalize, 0 colliding groups
--   "AdminUser":      0 rows to normalize, 0 colliding groups
--   Other environments will differ — the guard exists for them, not for dev.
--
-- IDEMPOTENCY
--   Every UPDATE carries `WHERE email <> lower(btrim(email))`, so a second run
--   matches no rows and reports UPDATE 0. Re-running is a no-op, not a rewrite.
--
-- LOCK ANALYSIS
--   Row-level UPDATEs under ROW EXCLUSIVE; no table is rewritten and no index is
--   rebuilt. The touched-row count is bounded by the number of rows that were
--   stored in non-normalized form, which is a subset of three small identity
--   tables. The declared timeouts abort the whole transaction cleanly if any of
--   that stops being true.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. Collision guard. Nothing below this block runs unless it passes.
DO $$
DECLARE
  account_collisions      text;
  customer_collisions     text;
  admin_collisions        text;
  report                  text := '';
BEGIN
  -- "Account": LIVE rows only (the unique index is partial on deletedAt IS NULL).
  SELECT string_agg(
           format('    %L <- %s', normalized, raw_values),
           E'\n' ORDER BY normalized
         )
    INTO account_collisions
    FROM (
      SELECT lower(btrim(email)) AS normalized,
             string_agg(format('%L', email), ', ' ORDER BY email) AS raw_values
        FROM "Account"
       WHERE "deletedAt" IS NULL
       GROUP BY lower(btrim(email))
      HAVING count(*) > 1
    ) g;

  -- "CustomerUser": ALL rows, grouped within accountId (unique is TOTAL, so
  -- soft-deleted rows participate).
  SELECT string_agg(
           format('    account %L: %L <- %s', "accountId", normalized, raw_values),
           E'\n' ORDER BY "accountId", normalized
         )
    INTO customer_collisions
    FROM (
      SELECT "accountId",
             lower(btrim(email)) AS normalized,
             string_agg(format('%L', email), ', ' ORDER BY email) AS raw_values
        FROM "CustomerUser"
       GROUP BY "accountId", lower(btrim(email))
      HAVING count(*) > 1
    ) g;

  -- "AdminUser": ALL rows (unique is TOTAL and the model has no deletedAt).
  SELECT string_agg(
           format('    %L <- %s', normalized, raw_values),
           E'\n' ORDER BY normalized
         )
    INTO admin_collisions
    FROM (
      SELECT lower(btrim(email)) AS normalized,
             string_agg(format('%L', email), ', ' ORDER BY email) AS raw_values
        FROM "AdminUser"
       GROUP BY lower(btrim(email))
      HAVING count(*) > 1
    ) g;

  IF account_collisions IS NOT NULL THEN
    report := report || E'\n  "Account" (live rows):\n' || account_collisions;
  END IF;
  IF customer_collisions IS NOT NULL THEN
    report := report || E'\n  "CustomerUser" (all rows, per account):\n' || customer_collisions;
  END IF;
  IF admin_collisions IS NOT NULL THEN
    report := report || E'\n  "AdminUser" (all rows):\n' || admin_collisions;
  END IF;

  IF report <> '' THEN
    RAISE EXCEPTION
      'Email normalization aborted: % address(es) would collide.%',
      (length(report) - length(replace(report, '<-', ''))) / 2,
      report
      USING
        DETAIL  = 'Each line shows the normalized address followed by the distinct '
                  'stored values that collapse onto it. These rows are covered by a '
                  'unique index, so normalizing them would violate it.',
        HINT    = 'A human must adjudicate which row keeps the address: merge, '
                  'rename or remove the losing rows, then re-run this migration. '
                  'This migration deliberately does not choose a winner.';
  END IF;
END $$;

-- 2. Normalization. Each statement is idempotent by its own WHERE clause.

-- "Account": every row, including soft-deleted ones. They sit outside the
-- partial unique so they cannot collide, and normalizing them keeps the
-- restore path's live-holder check comparing like with like.
UPDATE "Account"
   SET email = lower(btrim(email))
 WHERE email <> lower(btrim(email));

UPDATE "CustomerUser"
   SET email = lower(btrim(email))
 WHERE email <> lower(btrim(email));

UPDATE "AdminUser"
   SET email = lower(btrim(email))
 WHERE email <> lower(btrim(email));
