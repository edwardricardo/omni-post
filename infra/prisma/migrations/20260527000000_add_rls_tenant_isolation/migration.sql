-- ─────────────────────────────────────────────────────────────────────────────
-- S2.1c — PostgreSQL Row Level Security for the 51 tenant-scoped tables.
--
-- Defense-in-depth layer 2 (after the Prisma `$extends` tenant guard from
-- S2.1b). The guard catches programming mistakes at the ORM boundary; RLS
-- catches anything that slips past — raw SQL (`$queryRaw`/`$executeRaw`),
-- direct psql connections, future ORM swaps, or hypothetical guard bugs.
--
-- ## How it works
--
-- Each tenant-scoped table gets ENABLE ROW LEVEL SECURITY plus a single
-- `tenant_isolation` policy that gates both row visibility (USING) and row
-- mutation (WITH CHECK) by matching the row's `accountId` against the
-- session-scoped GUC `app.account_id`. The GUC is set per-transaction by
-- `PrismaUnitOfWork.executeInTransaction` via:
--
--     SELECT set_config('app.account_id', '<accountId>', true)
--
-- The third argument `true` makes the setting transaction-local (`SET
-- LOCAL`), so it resets automatically on COMMIT/ROLLBACK and never leaks
-- into the next checkout from the connection pool.
--
-- Three distinguished states:
--
--   1. `app.account_id = '<uuid>'`     — tenant scope; RLS matches that
--                                        accountId or NULL (for the few
--                                        tables where NULL means "global
--                                        system row" — only AIPromptTemplate
--                                        in the current schema).
--   2. `app.account_id = '__system__'` — explicit cross-tenant bypass for
--                                        admin impersonation, scheduled
--                                        sweeps, migration scripts running
--                                        inside `withSystemContext()`. RLS
--                                        passes for any row.
--   3. unset                            — `current_setting(name, true)`
--                                        returns NULL, RLS evaluates to
--                                        false, queries return 0 rows /
--                                        reject writes. Fail-closed default.
--
-- ## Scope
--
-- Defense applies to queries running inside a UoW transaction (every
-- mutating use case in the codebase, per §Unit of Work). Single-statement
-- reads outside a tx depend on layer 1 (the Prisma guard) alone — an
-- acknowledged trade-off documented in `docs/security/MULTI_TENANT_GUARDS.md`.
--
-- ## Migrations + seed scripts
--
-- Run as the DB owner / superuser, which BYPASSRLS implicitly. Application
-- code runs as the `omnipost_app` role (or equivalent), which is subject to
-- RLS. Verify with `\du` in psql: the app role must NOT have BYPASSRLS or
-- SUPERUSER. (Locally, the docker-compose default `postgres` user IS a
-- superuser — fine for migrations, but local tests of RLS effectiveness MUST
-- connect as a non-superuser role; see the integration test for the
-- `app_test_role` setup.)
--
-- ## Rollback
--
-- The companion `down.sql` (not auto-applied by Prisma) drops the 51
-- policies and disables RLS on each table. Restore by piping through psql
-- against the target DB.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tenant_tables TEXT[] := ARRAY[
    'AIPromptTemplate',
    'AccountCredential',
    'AccountOnboarding',
    'AccountSubscription',
    'AiTokenUsage',
    'ApiKey',
    'ApprovalWorkflow',
    'AssetFolder',
    'AssetTag',
    'BillingEvent',
    'BrandKit',
    'BrandVoice',
    'BulkScheduleBatch',
    'ConsentRecord',
    'ContentTemplate',
    'Conversion',
    'CrmActivity',
    'CrmConnection',
    'CrmContact',
    'CustomReport',
    'CustomerUser',
    'DsarRequest',
    'GatewaySwitchEvent',
    'Glossary',
    'InstagramAnalytics',
    'InstagramStoryProject',
    'IntegrationApiKey',
    'IntegrationSubscription',
    'Invoice',
    'MediaAsset',
    'Mention',
    'OidcConfiguration',
    'Project',
    'PublishingQueue',
    'ReferralCode',
    'RepurposeProposal',
    'SagaInstance',
    'SamlConfiguration',
    'SamlSession',
    'SchedulingRule',
    'SocialConversation',
    'SocialMessage',
    'StyleGuideRule',
    'Task',
    'Template',
    'TrackedTerm',
    'TrendRadarResult',
    'UsageMetric',
    'VideoProcessingJob',
    'WebhookEvent',
    'WebhookSubscription'
  ];
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    -- Defensive: drop any pre-existing policy with the same name so the
    -- migration is idempotent on re-runs (Prisma applies each migration
    -- once, but local devs may apply this DB to a stale snapshot).
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING ('
      '  current_setting(''app.account_id'', true) = ''__system__'' '
      '  OR "accountId" = current_setting(''app.account_id'', true)'
      ') '
      'WITH CHECK ('
      '  current_setting(''app.account_id'', true) = ''__system__'' '
      '  OR "accountId" = current_setting(''app.account_id'', true)'
      ')',
      tbl
    );
  END LOOP;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Special case: AIPromptTemplate.accountId IS NULL ⇒ "global system template"
-- visible to every tenant. Override the standard policy to allow NULL
-- accountId rows through for SELECT (USING) but NOT for customer writes
-- (WITH CHECK retains the strict policy — only system context can write
-- NULL).
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS tenant_isolation ON "AIPromptTemplate";
CREATE POLICY tenant_isolation ON "AIPromptTemplate"
  USING (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
    OR "accountId" IS NULL
  )
  WITH CHECK (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  );
