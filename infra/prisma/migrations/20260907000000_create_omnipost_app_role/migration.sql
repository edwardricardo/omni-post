-- Provision `omnipost_app`: the role the application connects as.
--
-- Why this exists. The deployment connects as `postgres`, which carries
-- SUPERUSER and BYPASSRLS, so every `tenant_isolation` policy installed since
-- 20260527000000 has been inert for the running application. That is not a
-- suspicion, it is a recorded measurement: docs/reports/RLS_POSTURE_RED_BASELINE.md
-- captures the read returning tenant A's rows while `app.account_id` was bound
-- to tenant B.
--
-- A role bypasses row security in exactly three ways, and this role closes all
-- three: it is NOSUPERUSER, it is NOBYPASSRLS, and it owns no table (an owner
-- is exempt from its own policies unless the table carries FORCE ROW LEVEL
-- SECURITY, and no table here does). ADR-0022 records why the non-owner remedy
-- was chosen over FORCE.
--
-- NO PASSWORD APPEARS IN THIS FILE (CWE-798 — security canon, no exception).
-- The role is created NOLOGIN; each environment enables login from its own
-- secret channel via `scripts/db/enable-app-role-login.sh`.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- Roles are CLUSTER-global while migrations are per-database, and Prisma
-- re-runs the whole migration tree against the shadow database on the same
-- cluster — so a bare CREATE ROLE aborts the second pass. `duplicate_object`
-- (SQLSTATE 42710) is the exact condition CREATE ROLE raises for an existing
-- name, so the handler is narrow rather than a blanket swallow.
DO $$
BEGIN
  CREATE ROLE omnipost_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- Re-assert the two attributes that decide whether row security applies, on
-- every run: a pre-existing role may have been granted BYPASSRLS by hand, and
-- this migration is what owns that posture. LOGIN is deliberately NOT touched
-- here — it belongs to the environment's secret channel, and re-asserting
-- NOLOGIN would revoke the application's own connection on the next deploy.
ALTER ROLE omnipost_app NOSUPERUSER NOBYPASSRLS;

GRANT USAGE ON SCHEMA public TO omnipost_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO omnipost_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO omnipost_app;

-- `ON ALL TABLES` covers only what exists right now. Without these two
-- statements every table a later migration creates would be invisible to the
-- application until someone remembered to re-grant, which is the failure mode
-- that turns a tenant-isolation rollout into a production outage. No FOR ROLE
-- clause: the defaults attach to objects created by the role running
-- migrations, which is exactly the role that creates the tables.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO omnipost_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO omnipost_app;

-- Retire the synthetic proof role. `rls-tenant-isolation.test.ts` used to
-- create `rls_test_role` itself and prove the policy against it, which
-- demonstrated that the POLICY was written correctly while saying nothing
-- about the role the application connects as. The suite now runs as
-- `omnipost_app`, so the synthetic role is left over in every database a
-- previous run touched. DROP OWNED BY clears the grants that would otherwise
-- make DROP ROLE fail; `dependent_objects_still_exist` (SQLSTATE 2BP01) is
-- caught by name because privileges the role may still hold in ANOTHER
-- database of the same cluster are not this migration's to remove.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rls_test_role') THEN
    EXECUTE 'DROP OWNED BY rls_test_role';
    BEGIN
      EXECUTE 'DROP ROLE rls_test_role';
    EXCEPTION
      WHEN dependent_objects_still_exist THEN NULL;
    END;
  END IF;
END
$$;
