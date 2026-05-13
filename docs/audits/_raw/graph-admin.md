# Graph Report - admin (2026-05-12)

## Corpus Check

- 205 files · ~81,793 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary

- 1077 nodes · 1924 edges · 63 communities (54 shown, 9 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 82 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness

- Built from commit: `edc8ab61`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)

- [[_COMMUNITY_componentssettings (~50%)|components/settings (~50%)]]
- [[_COMMUNITY_hooksapiuseWebhooks|hooks/api/useWebhooks]]
- [[_COMMUNITY_componentscharts (~46%)|components/charts (~46%)]]
- [[_COMMUNITY_hooksapiuseCompliance|hooks/api/useCompliance]]
- [[_COMMUNITY_libauth (~46%)|lib/auth (~46%)]]
- [[_COMMUNITY_testse2e|tests/e2e]]
- [[_COMMUNITY_componentsmaintenance (~40%)|components/maintenance (~40%)]]
- [[_COMMUNITY_hooksapiuseGatewaySwitches|hooks/api/useGatewaySwitches]]
- [[_COMMUNITY_hooksapiusePricingTiers|hooks/api/usePricingTiers]]
- [[_COMMUNITY_hooksapiuseAdminUsers|hooks/api/useAdminUsers]]
- [[_COMMUNITY_componentswebhooks (~40%)|components/webhooks (~40%)]]
- [[_COMMUNITY_testsunit (~37%)|tests/unit (~37%)]]
- [[_COMMUNITY_componentsshared (~37%)|components/shared (~37%)]]
- [[_COMMUNITY_app(dashboard) (~56%)|app/(dashboard) (~56%)]]
- [[_COMMUNITY_componentssecurity (~40%)|components/security (~40%)]]
- [[_COMMUNITY_componentsqueue (~50%)|components/queue (~50%)]]
- [[_COMMUNITY_libapitypes.ts|lib/api/types.ts]]
- [[_COMMUNITY_libapiclients|lib/api/clients]]
- [[_COMMUNITY_componentscompliance|components/compliance]]
- [[_COMMUNITY_hooksapi (~57%)|hooks/api (~57%)]]
- [[_COMMUNITY_componentssubscriptions (~44%)|components/subscriptions (~44%)]]
- [[_COMMUNITY_hooksapi (~47%)|hooks/api (~47%)]]
- [[_COMMUNITY_app(dashboard) (~58%)|app/(dashboard) (~58%)]]
- [[_COMMUNITY_testsunithooksuseWebhooks.test.tsx|tests/unit/hooks/useWebhooks.test.tsx]]
- [[_COMMUNITY_testsunithooksuseContentLibrary.test.tsx|tests/unit/hooks/useContentLibrary.test.tsx]]
- [[_COMMUNITY_componentsui (~37%)|components/ui (~37%)]]
- [[_COMMUNITY_hooksapi|hooks/api]]
- [[_COMMUNITY_componentsui (~33%)|components/ui (~33%)]]
- [[_COMMUNITY_testsunit (~57%)|tests/unit (~57%)]]
- [[_COMMUNITY_testsunithooksusePosts.test.tsx|tests/unit/hooks/usePosts.test.tsx]]
- [[_COMMUNITY_testsunithooksuseDashboardStats.test.tsx|tests/unit/hooks/useDashboardStats.test.tsx]]
- [[_COMMUNITY_testsunithooksuseCompliance.test.tsx|tests/unit/hooks/useCompliance.test.tsx]]
- [[_COMMUNITY_componentsaccounts|components/accounts]]
- [[_COMMUNITY_componentssharedErrorBoundary.tsx|components/shared/ErrorBoundary.tsx]]
- [[_COMMUNITY_libstores__tests__notificationStore.test.ts|lib/stores/__tests__/notificationStore.test.ts]]
- [[_COMMUNITY_app(dashboard)pricingpage.tsx|app/(dashboard)/pricing/page.tsx]]
- [[_COMMUNITY_componentssettings (~55%)|components/settings (~55%)]]
- [[_COMMUNITY_libapi (~44%)|lib/api (~44%)]]
- [[_COMMUNITY_libapi (~50%)|lib/api (~50%)]]
- [[_COMMUNITY_libapi (~50%)|lib/api (~50%)]]
- [[_COMMUNITY_libapi (~50%)|lib/api (~50%)]]
- [[_COMMUNITY_libapi (~50%)|lib/api (~50%)]]
- [[_COMMUNITY_componentsshared (~57%)|components/shared (~57%)]]
- [[_COMMUNITY_app(dashboard)helppage.tsx|app/(dashboard)/help/page.tsx]]
- [[_COMMUNITY_testsunitsharedLoadingSpinner.test.tsx|tests/unit/shared/LoadingSpinner.test.tsx]]
- [[_COMMUNITY_componentsshared (~50%)|components/shared (~50%)]]
- [[_COMMUNITY_hooksapi (~50%)|hooks/api (~50%)]]
- [[_COMMUNITY_testse2eutilsa11y.ts|tests/e2e/utils/a11y.ts]]
- [[_COMMUNITY_app(dashboard)announcementspage.tsx|app/(dashboard)/announcements/page.tsx]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_i18nrequest.ts|i18n/request.ts]]
- [[_COMMUNITY_testsposts.flow.test.ts|tests/posts.flow.test.ts]]
- [[_COMMUNITY_apploading.tsx|app/loading.tsx]]

## God Nodes (most connected - your core abstractions)

1. `ActionButton()` - 35 edges
2. `Badge()` - 27 edges
3. `LoadingSpinner()` - 25 edges
4. `PageHeader()` - 23 edges
5. `api` - 23 edges
6. `LoginPage` - 21 edges
7. `useCurrentUser()` - 15 edges
8. `useChartColors()` - 14 edges
9. `buildFieldDefs()` - 14 edges
10. `http()` - 14 edges

## Surprising Connections (you probably didn't know these)

- `CredentialForm()` --calls--> `useUpdateGroupSettings()` [INFERRED]
  components/settings/CredentialForm.tsx → hooks/api/useSettings/mutations.ts
- `CredentialForm()` --calls--> `useDeleteCredential()` [INFERRED]
  components/settings/CredentialForm.tsx → hooks/api/useSettings/mutations.ts
- `CredentialForm()` --calls--> `useTestConnection()` [INFERRED]
  components/settings/CredentialForm.tsx → hooks/api/useSettings/mutations.ts
- `CredentialForm()` --calls--> `useGroupSettings()` [INFERRED]
  components/settings/CredentialForm.tsx → hooks/api/useSettings/queries.ts
- `AdminUsersContent()` --calls--> `useCreateAdminUser()` [INFERRED]
  app/(dashboard)/users/page.tsx → hooks/api/useAdminUsers/mutations.ts

## Communities (63 total, 9 thin omitted)

### Community 0 - "components/settings (~50%)"

Cohesion: 0.05
Nodes (42): AnalyticsPageContent(), formatCurrency(), formatNumber(), PROVIDER_COLORS, AnalyticsSummary, useAnalytics(), ChartEmptyState(), ChartEmptyStateProps (+34 more)

### Community 1 - "hooks/api/useWebhooks"

Cohesion: 0.05
Nodes (33): useSecretRotationStatus(), DATA_TYPE_OPTIONS, EMPTY_FORM, SEVERITY_OPTIONS, SEVERITY_VARIANT, STATUS_VARIANT, GdprSettingsForm(), JURISDICTIONS (+25 more)

### Community 2 - "components/charts (~46%)"

Cohesion: 0.07
Nodes (50): createWebhookSubscription(), deleteWebhookSubscription(), exportWebhookEvents(), fetchDlqMetrics(), fetchOutboxDeadLetter(), fetchProjectsForSubscriptionForm(), fetchWebhookDeadLetter(), fetchWebhookEventDetail() (+42 more)

### Community 3 - "hooks/api/useCompliance"

Cohesion: 0.06
Nodes (49): BreachTable(), DsarTable(), CompliancePageContent(), SecuritySettingsForm(), acknowledgeDsar(), completeDsar(), createBreachReport(), fetchBreachReports() (+41 more)

### Community 4 - "lib/auth (~46%)"

Cohesion: 0.06
Nodes (39): addHours(), canModify(), DetailDialog(), DetailDialogProps, EXTEND_OPTIONS, ExtendDialog(), ExtendDialogProps, formatDate() (+31 more)

### Community 5 - "tests/e2e"

Cohesion: 0.07
Nodes (34): log, loginAction(), logoutAction(), ApiResponse, authenticateAdmin(), log, LoginCredentials, LoginResponseData (+26 more)

### Community 6 - "components/maintenance (~40%)"

Cohesion: 0.06
Nodes (19): button, callbackUrl, logoutButton, url, createButton, criticalErrors, errors, textInput (+11 more)

### Community 7 - "hooks/api/useGatewaySwitches"

Cohesion: 0.07
Nodes (32): FailedJob, QueueStats, useFailedJobs(), useQueueStats(), useRetryJob(), verifyAccessToken(), DashboardLayout(), FailedJobsTable() (+24 more)

### Community 8 - "hooks/api/usePricingTiers"

Cohesion: 0.13
Nodes (22): AiTab(), buildFieldDefs(), CREDENTIAL_KEYS, FieldDef, NON_SECRET_KEYS, SOCIAL_GROUPS, TAB_GROUP_MAP, CredentialForm() (+14 more)

### Community 9 - "hooks/api/useAdminUsers"

Cohesion: 0.09
Nodes (30): AccountTiersTab(), PricingPageContent(), ProviderTiersTab(), createAccountTier(), createBundle(), createProviderTier(), deleteBundle(), fetchPricingTiers() (+22 more)

### Community 10 - "components/webhooks (~40%)"

Cohesion: 0.12
Nodes (19): SESSION_TIMEOUT_OPTIONS, ROLE_VARIANT, User, LoadingSpinner(), LoadingSpinnerProps, SIZE_CLASSES, ActionButton(), Badge() (+11 more)

### Community 11 - "tests/unit (~37%)"

Cohesion: 0.09
Nodes (23): useAdminPasswordReset(), mockFetch, onError, onSuccess, responseBody, { result }, activateAdminUser(), createAdminUser() (+15 more)

### Community 12 - "components/shared (~37%)"

Cohesion: 0.1
Nodes (20): BillingStats, useBillingStats(), ConvertTrialParams, EndTrialParams, StartTrialParams, useConvertTrial(), useEndTrial(), useStartTrial() (+12 more)

### Community 13 - "app/(dashboard) (~56%)"

Cohesion: 0.09
Nodes (21): setLocaleAction(), SUPPORTED_LOCALES, SupportedLocale, cookieSet, revalidatePath, metadata, Theme, ThemeContext (+13 more)

### Community 14 - "components/security (~40%)"

Cohesion: 0.12
Nodes (12): SetupBanner(), SetupItem, BundleFormData, BundleFormDialogProps, EMPTY_BUNDLE_FORM, AccessDenied(), AccessDeniedProps, PageHeader() (+4 more)

### Community 15 - "components/queue (~50%)"

Cohesion: 0.11
Nodes (25): OptimalTimesParams, ScheduleSlotsParams, SchedulingRulesParams, useBulkCreateSchedules(), useCreateSchedule(), useOptimalTimes(), useScheduleSlots(), useSchedulingRules() (+17 more)

### Community 16 - "lib/api/types.ts"

Cohesion: 0.13
Nodes (20): AccountListFilters, AccountListItem, AccountListPagination, AccountListResponse, AccountProject, AccountSummary, AuditLog, AuditLogFilters (+12 more)

### Community 17 - "lib/api/clients"

Cohesion: 0.09
Nodes (17): useDashboardStats(), SecurityOverviewData, useSecurityOverview(), DashboardContent(), cached, err, failResponse, MOCK_STATS (+9 more)

### Community 18 - "components/compliance"

Cohesion: 0.09
Nodes (20): job1, job2, MOCK_JOBS_RESPONSE, MOCK_STATS_RESPONSE, mockFetch, onQueueUpdate, removeCall, { result } (+12 more)

### Community 19 - "hooks/api (~57%)"

Cohesion: 0.15
Nodes (15): MfaStatus, authClient, LoginCredentials, LoginResponse, healthClient, http(), BackupCodesResponse, mfaClient (+7 more)

### Community 20 - "components/subscriptions (~44%)"

Cohesion: 0.15
Nodes (18): SettingsPage(), deleteCredential(), fetchGroupSettings(), fetchSettingsStatus(), rotateEncryption(), settingsFetch(), testConnection(), updateGroupSettings() (+10 more)

### Community 21 - "hooks/api (~47%)"

Cohesion: 0.12
Nodes (15): AudienceInsight, DashboardInsightsData, EngagementSummary, HashtagPerformance, MediaPerformance, OptimalTiming, TimeSeriesPoint, TopEngagingPost (+7 more)

### Community 22 - "app/(dashboard) (~58%)"

Cohesion: 0.16
Nodes (13): AccountBillingPanel(), AccountBillingPanelProps, BillingData, useAccountBilling(), AccountSession, useAccountSessions(), useRevokeAccountSessions(), ALL_PROVIDERS (+5 more)

### Community 23 - "tests/unit/hooks/useWebhooks.test.tsx"

Cohesion: 0.14
Nodes (12): AccountsPageContent(), UpdateAccountData, UpdateAccountResponse, useAccounts(), useUpdateAccount(), ResetPasswordInput, useResetAccountPassword(), MOCK_ACCOUNTS (+4 more)

### Community 24 - "tests/unit/hooks/useContentLibrary.test.tsx"

Cohesion: 0.13
Nodes (8): CATEGORY_KEYS, PermissionGrid(), PermissionGridProps, RbacUser, ROLE_VARIANT, ActionButtonProps, SIZE_CLASSES, VARIANT_CLASSES

### Community 25 - "components/ui (~37%)"

Cohesion: 0.12
Nodes (12): calledUrl, created, dlq, event, events, metrics, mockFetch, page (+4 more)

### Community 26 - "hooks/api"

Cohesion: 0.15
Nodes (12): ContentLibraryPost, ListPostsResponse, useContentLibrary(), UseContentLibraryOptions, BASE_OPTIONS, cached, [calledUrl], MOCK_POSTS_RESPONSE (+4 more)

### Community 27 - "components/ui (~33%)"

Cohesion: 0.16
Nodes (10): AnalyticsDashboardData, AnalyticsOverview, PlatformMetrics, UniversalAnalyticsParams, useUniversalAnalytics(), MOCK_DASHBOARD, mockFetch, queryClient (+2 more)

### Community 28 - "tests/unit (~57%)"

Cohesion: 0.18
Nodes (10): useCreatePost(), useDeletePost(), usePosts(), MOCK_POSTS, mockCreatePost, mockDeletePost, mockListPosts, queryClient (+2 more)

### Community 29 - "tests/unit/hooks/usePosts.test.tsx"

Cohesion: 0.21
Nodes (6): AccountEditForm(), AccountEditFormProps, EditFormData, AccountStatusBadge(), exportAccountsToCSV(), AccountFilters

### Community 30 - "tests/unit/hooks/useDashboardStats.test.tsx"

Cohesion: 0.22
Nodes (9): NotificationItem, NotificationState, useNotificationStore, { addNotification }, makeItem(), { setNotifications }, { setNotifications, notifications, unreadCount }, state (+1 more)

### Community 31 - "tests/unit/hooks/useCompliance.test.tsx"

Cohesion: 0.2
Nodes (3): ErrorBoundary, ErrorBoundaryProps, ErrorBoundaryState

### Community 32 - "components/accounts"

Cohesion: 0.22
Nodes (6): useAuditLogs(), filters, MOCK_LOGS, mockGetLogs, queryClient, { result }

### Community 33 - "components/shared/ErrorBoundary.tsx"

Cohesion: 0.33
Nodes (6): useProviderForceMassReauth(), ForceMassReauthInput, MassReauthResult, providersAdminClient, AdminProviderMassReauthPage(), PROVIDERS

### Community 34 - "lib/stores/**tests**/notificationStore.test.ts"

Cohesion: 0.39
Nodes (5): useWebhookRotateSecret(), RotateWebhookSecretInput, webhooksAdminClient, WebhookSecretRotationResult, AdminWebhookRotateSecretPage()

### Community 35 - "app/(dashboard)/pricing/page.tsx"

Cohesion: 0.39
Nodes (5): useChannelForceReauth(), AdminForceReauthPage(), ChannelForceReauthInput, ChannelForceReauthResult, channelsAdminClient

### Community 36 - "components/settings (~55%)"

Cohesion: 0.39
Nodes (5): useOidcReplaceClientSecret(), oidcAdminClient, OidcClientSecretRotationResult, ReplaceOidcClientSecretInput, AdminOidcReplaceSecretPage()

### Community 37 - "lib/api (~44%)"

Cohesion: 0.39
Nodes (5): useApiKeyAdminRotate(), AdminApiKeyRotatePage(), ApiKeyAdminRotationResult, apiKeysAdminClient, RotateApiKeyAdminInput

### Community 38 - "lib/api (~50%)"

Cohesion: 0.29
Nodes (3): AccordionSectionProps, HelpSection, SECTION_KEYS

### Community 39 - "lib/api (~50%)"

Cohesion: 0.33
Nodes (5): srOnlyStyle, { container }, element, VisuallyHidden(), VisuallyHiddenProps

### Community 40 - "lib/api (~50%)"

Cohesion: 0.33
Nodes (5): container, labelSpan, spinner, spinnerDiv, wrapper

### Community 41 - "lib/api (~50%)"

Cohesion: 0.47
Nodes (4): ChangePasswordInput, useChangePassword(), ChangePasswordDialog(), ChangePasswordDialogProps

### Community 42 - "components/shared (~57%)"

Cohesion: 0.5
Nodes (3): A11yImpact, A11yOptions, expectPageToBeAccessible()

### Community 43 - "app/(dashboard)/help/page.tsx"

Cohesion: 0.5
Nodes (4): Announcement, AnnouncementsPage(), TYPE_VARIANTS, useAnnouncements()

### Community 46 - "hooks/api (~50%)"

Cohesion: 0.5
Nodes (3): config, nextConfig, withNextIntl

## Knowledge Gaps

- **355 isolated node(s):** `PUBLIC_PATHS`, `config`, `config`, `withNextIntl`, `nextConfig` (+350 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions

_Questions this graph is uniquely positioned to answer:_

- **Why does `LoginPage` connect `components/maintenance (~40%)` to `lib/api/clients`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Why does `AdminUsersContent()` connect `tests/unit (~37%)` to `lib/api/clients`, `components/security (~40%)`, `hooks/api/useGatewaySwitches`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Why does `ActionButton()` connect `components/webhooks (~40%)` to `hooks/api/useWebhooks`, `lib/auth (~46%)`, `hooks/api/useGatewaySwitches`, `hooks/api/usePricingTiers`, `lib/api (~50%)`, `app/(dashboard)/help/page.tsx`, `tests/unit/shared/LoadingSpinner.test.tsx`, `components/shared (~37%)`, `components/security (~40%)`, `app/(dashboard) (~58%)`, `tests/unit/hooks/useContentLibrary.test.tsx`, `tests/unit/hooks/usePosts.test.tsx`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **What connects `PUBLIC_PATHS`, `config`, `config` to the rest of the system?**
  _355 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `components/settings (~50%)` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `hooks/api/useWebhooks` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `components/charts (~46%)` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
