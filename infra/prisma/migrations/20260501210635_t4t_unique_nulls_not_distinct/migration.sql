-- Convert 5 composite unique indexes containing nullable columns to
-- NULLS NOT DISTINCT (PG15+) so multi-row dedup intent is preserved when
-- one or more component columns is NULL.

-- AdminUserPermission: scope is nullable (NULL = global permission)
DROP INDEX "AdminUserPermission_userId_resource_action_scope_key";
CREATE UNIQUE INDEX "AdminUserPermission_userId_resource_action_scope_key"
    ON "AdminUserPermission" ("userId", "resource", "action", "scope")
    NULLS NOT DISTINCT;

-- WebhookSubscription: projectId is nullable (NULL = account-wide subscription)
DROP INDEX "WebhookSubscription_accountId_provider_projectId_key";
CREATE UNIQUE INDEX "WebhookSubscription_accountId_provider_projectId_key"
    ON "WebhookSubscription" ("accountId", "provider", "projectId")
    NULLS NOT DISTINCT;

-- AnalyticsDailySummary: postId is nullable (NULL = channel-level aggregation)
DROP INDEX "AnalyticsDailySummary_postId_channelId_provider_date_key";
CREATE UNIQUE INDEX "AnalyticsDailySummary_postId_channelId_provider_date_key"
    ON "AnalyticsDailySummary" ("postId", "channelId", "provider", "date")
    NULLS NOT DISTINCT;

-- AnalyticsMonthlySummary: postId is nullable (NULL = channel-level aggregation)
DROP INDEX "AnalyticsMonthlySummary_postId_channelId_provider_month_key";
CREATE UNIQUE INDEX "AnalyticsMonthlySummary_postId_channelId_provider_month_key"
    ON "AnalyticsMonthlySummary" ("postId", "channelId", "provider", "month")
    NULLS NOT DISTINCT;

-- BundleFeatureFlag: bundleId is nullable (NULL = global feature flag)
DROP INDEX "BundleFeatureFlag_bundleId_featureKey_key";
CREATE UNIQUE INDEX "BundleFeatureFlag_bundleId_featureKey_key"
    ON "BundleFeatureFlag" ("bundleId", "featureKey")
    NULLS NOT DISTINCT;
