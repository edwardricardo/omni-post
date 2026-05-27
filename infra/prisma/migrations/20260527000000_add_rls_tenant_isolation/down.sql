-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK companion for 20260527000000_add_rls_tenant_isolation.
--
-- Prisma migrate does NOT auto-apply down.sql files. Operator-driven only:
--   psql "$DATABASE_URL" < down.sql
--
-- Drops the `tenant_isolation` policy and disables RLS on each of the 51
-- tenant-scoped tables, returning the schema to the pre-S2.1c state. Use
-- if the migration causes an unexpected production regression and the
-- Prisma guard alone (S2.1b) is judged sufficient while diagnosing.
--
-- Safe to run on a database where the policy doesn't exist (DROP POLICY IF
-- EXISTS) but ALTER TABLE ... DISABLE ROW LEVEL SECURITY is idempotent at
-- the table-already-disabled level.
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
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', tbl);
  END LOOP;
END
$$;
