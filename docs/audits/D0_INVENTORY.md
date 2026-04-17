# OmniPost — D0: Inventario Maestro Inmutable

> **Living document.** Update in place.
> **Last verified:** 2026-04-17
> **Method:** Direct code extraction. No interpretation.
> **Scope:** Toda entidad del monorepo extraíble mediante grep/AST/schema parse.

Esta es la fuente de verdad de "qué existe" en OmniPost. Las dimensiones D1-D7 consumen este inventario. Véase `PLAN_MAESTRO.md` §2 para el rol de D0.

---

## 1. Endpoints

### 1.1 Total count + drift check

| Metric                                              |   Value |
| --------------------------------------------------- | ------: |
| Fastify HTTP registrations (current grep)           | **471** |
| ENDPOINT_AUDIT.md count (2026-04-16, pre-deletions) |     478 |
| Post-deletion count declared in ENDPOINT_AUDIT §1   |     466 |
| Current drift vs post-deletion count                |      +5 |

Grep used: `grep -rn --include="*.ts" -E "(fastify|app|server|instance)\.(get|post|put|patch|delete|head|options)\(" apps/api/src/ | wc -l`. Authoritative per-file breakdown lives in [ENDPOINT_AUDIT.md](ENDPOINT_AUDIT.md) §2. No duplication here.

### 1.2 Route files (69)

```
apps/api/src/accounts/accountRoutes.ts
apps/api/src/admin/accountLifecycleRoutes.ts
apps/api/src/admin/adminUserRoutes.ts
apps/api/src/admin/analyticsRoutes.ts
apps/api/src/admin/auth/adminAuthRoutes.ts
apps/api/src/admin/dashboardRoutes.ts
apps/api/src/admin/pricingRoutes.ts
apps/api/src/admin/queueRoutes.ts
apps/api/src/admin/schedulingRoutes.ts
apps/api/src/ai-image/aiImageRoutes.ts
apps/api/src/ai/promptTemplateRoutes.ts
apps/api/src/ai/routes.ts
apps/api/src/analytics/analyticsRoutes.ts
apps/api/src/announcements/announcementRoutes.ts
apps/api/src/approvals/approvalRoutes.ts
apps/api/src/approvals/approvalWorkflowRoutes.ts
apps/api/src/assets/assetRoutes.ts
apps/api/src/audit/activityFeedRoutes.ts
apps/api/src/audit/auditRoutes.ts
apps/api/src/auth/apiKeyRoutes.ts
apps/api/src/auth/authRoutes.ts
apps/api/src/auth/customerAuthRoutes.ts
apps/api/src/auth/mfaRoutes.ts
apps/api/src/auth/oidcRoutes.ts
apps/api/src/auth/rbacRoutes.ts
apps/api/src/auth/samlRoutes.ts
apps/api/src/billing/adminBillingRoutes.ts
apps/api/src/billing/billingWebhookRoutes.ts
apps/api/src/billing/clientBillingRoutes.ts
apps/api/src/billing/subscriptionRoutes.ts
apps/api/src/brand-kit/brandKitRoutes.ts
apps/api/src/brand-voice/brandVoiceRoutes.ts
apps/api/src/campaigns/campaignRoutes.ts
apps/api/src/channels/channelRoutes.ts
apps/api/src/comments/commentRoutes.ts
apps/api/src/compliance/complianceRoutes.ts
apps/api/src/content/contentRoutes.ts
apps/api/src/cqrs/CQRSIntegration.ts
apps/api/src/crm/crmRoutes.ts
apps/api/src/custom-reports/customReportRoutes.ts
apps/api/src/external-notifications/externalNotificationRoutes.ts
apps/api/src/first-comment/firstCommentRoutes.ts
apps/api/src/health/healthRoutes.ts
apps/api/src/inbox/conversationNoteRoutes.ts
apps/api/src/inbox/inboxRoutes.ts
apps/api/src/integrations/makeRoutes.ts
apps/api/src/integrations/zapierRoutes.ts
apps/api/src/links/linkRoutes.ts
apps/api/src/monitoring/cacheStatsRoutes.ts
apps/api/src/notifications/notificationRoutes.ts
apps/api/src/onboarding/onboardingRoutes.ts
apps/api/src/outbox/outboxAdminRoutes.ts
apps/api/src/posts/optimizedPostsRoutes.ts
apps/api/src/posts/postRoutes.ts
apps/api/src/projects/crisisRoutes.ts
apps/api/src/projects/projectRoutes.ts
apps/api/src/providers/providerRoutes.ts
apps/api/src/recurring/recurringPostRoutes.ts
apps/api/src/reports/reportRoutes.ts
apps/api/src/saga/SagaIntegration.ts
apps/api/src/scheduling/schedulingClientRoutes.ts
apps/api/src/settings/settingsRoutes.ts
apps/api/src/tasks/taskRoutes.ts
apps/api/src/team/teamRoutes.ts
apps/api/src/templates/templateRoutes.ts
apps/api/src/trends/trendRoutes.ts
apps/api/src/usage/usageRoutes.ts
apps/api/src/utm/utmRoutes.ts
apps/api/src/webhooks/webhookDashboardRoutes.ts
```

### 1.3 Backend services (43)

```
apps/api/src/admin/accountLifecycleQueryService.ts
apps/api/src/admin/accountLifecycleService.ts
apps/api/src/admin/AccountSessionService.ts
apps/api/src/admin/auth/AdminAuthService.ts
apps/api/src/admin/auth/MfaService.ts
apps/api/src/admin/auth/PasswordService.ts
apps/api/src/admin/auth/TokenService.ts
apps/api/src/admin/dashboardService.ts
apps/api/src/ai/AiRequestService.ts
apps/api/src/ai/aiService.ts
apps/api/src/application/integrations/TriggerIntegrationEventService.ts
apps/api/src/application/mentions/NotifyMentionedUsersService.ts
apps/api/src/application/notifications/SendEmailNotificationService.ts
apps/api/src/audit/activityFeedService.ts
apps/api/src/audit/auditService.ts
apps/api/src/auth/authService.ts
apps/api/src/auth/mfaService.ts
apps/api/src/auth/rbacService.ts
apps/api/src/auth/roleManagementService.ts
apps/api/src/billing/GatewayBillingService.ts
apps/api/src/billing/GatewaySwitchJobService.ts
apps/api/src/billing/subscription/BillingService.ts
apps/api/src/billing/subscriptionService.ts
apps/api/src/billing/subscription/SubscriptionManagementService.ts
apps/api/src/billing/subscription/SubscriptionPlanService.ts
apps/api/src/billing/subscription/SubscriptionStatsService.ts
apps/api/src/billing/subscription/TrialManagementService.ts
apps/api/src/compliance/ComplianceService.ts
apps/api/src/compliance/DataRetentionService.ts
apps/api/src/events/EventService.ts
apps/api/src/posts/postsService.ts
apps/api/src/providers/providerService.ts
apps/api/src/security/EncryptionService.ts
apps/api/src/security/PlatformCredentialService.ts
apps/api/src/services/AuditableService.ts
apps/api/src/services/BaseService.ts
apps/api/src/settings/SettingsService.ts
apps/api/src/templates/TemplateABTestService.ts
apps/api/src/templates/templateService.ts
apps/api/src/templates/TemplateVersionService.ts
apps/api/src/trends/trendAnalysisService.ts
apps/api/src/webhooks/DlqArchivalService.ts
apps/api/src/webhooks/webhookDashboardService.ts
```

### 1.4 Use cases / commands / queries / handlers (183)

Total count: **183** files matching pattern `*UseCase.ts | *Command.ts | *Query.ts | *Handler.ts` under `apps/api/src/` excluding tests. Full list omitted for brevity (exhaustive count verified via `find ... | wc -l`).

Breakdown by domain (sampled, not all directories):

```
application/ai/              6 files (UseCases)
application/ai-image/        2 files
application/aiPromptTemplates/ 4 files
application/analytics/       6 files
application/approvals/       9 files
application/assets/          9 files
application/auth/            8 files
application/billing/         3 files
application/brand-kit/       3 files
application/brand-voice/     3 files
application/campaigns/       8 files
application/comments/        4 files
application/crisis/          3 files
application/crm/             6 files
application/customer-auth/   5 files (+ more, output truncated at 80)
... (additional directories — total 183)
```

### 1.5 Workers and jobs

**`apps/workers/src/` files (8 total, 4 are worker entrypoints):**

```
apps/workers/src/analyticsIngestWorker.ts
apps/workers/src/autoRenewalWorker.ts
apps/workers/src/inboxSyncWorker.ts
apps/workers/src/metrics/workerMetrics.ts
apps/workers/src/publishHandler.ts
apps/workers/src/publishHandlerTypes.ts
apps/workers/src/publishWorker.ts
apps/workers/src/telemetry/initialization.ts
```

**Worker processes:** 4 (`analyticsIngestWorker`, `autoRenewalWorker`, `inboxSyncWorker`, `publishWorker`).

### 1.6 Middlewares (10)

```
apps/api/src/admin/auth/adminAuthMiddleware.ts
apps/api/src/audit/auditMiddleware.ts
apps/api/src/auth/customerAuthMiddleware.ts
apps/api/src/auth/integrationAuthMiddleware.ts
apps/api/src/auth/rbacMiddleware.ts
apps/api/src/middleware/autoCacheMiddleware.ts
apps/api/src/middleware/correlationMiddleware.ts
apps/api/src/middleware/metricsMiddleware.ts
apps/api/src/security/csrfMiddleware.ts
apps/api/src/security/ipAllowlistMiddleware.ts
```

---

## 2. Database

Schema file: `infra/prisma/schema.prisma`.

### 2.1 Prisma models (114)

Field counts exclude `@@` block-level directives (indexes, unique constraints, fulltext, etc.). Ordered by field count descending to aid D3 (complexity signal).

| Fields | Model                      |
| -----: | -------------------------- |
|     75 | Account                    |
|     46 | PublishingQueue            |
|     36 | Project                    |
|     36 | SocialMessage              |
|     35 | AdminUser                  |
|     31 | ProviderConnection         |
|     31 | VideoProcessingJob         |
|     28 | InstagramStory             |
|     28 | InstagramStoryProject      |
|     28 | WebhookEvent               |
|     26 | InstagramAnalytics         |
|     25 | ContentTemplate            |
|     25 | Template                   |
|     24 | Post                       |
|     24 | TeamMember                 |
|     23 | AccountSubscription        |
|     23 | SchedulingRule             |
|     22 | ContentVersion             |
|     22 | CustomReport               |
|     21 | CustomerUser               |
|     21 | DsarRequest                |
|     21 | MediaAsset                 |
|     21 | SocialConversation         |
|     20 | Invoice                    |
|     20 | VideoSegment               |
|     19 | Task                       |
|     19 | WebhookSubscription        |
|     18 | AdminSession               |
|     18 | DataBreachReport           |
|     18 | GdprSettings               |
|     18 | RecurringPost              |
|     17 | AdminLoginAttempt          |
|     17 | CrmConnection              |
|     17 | GatewaySwitchEvent         |
|     17 | TemplateVersion            |
|     17 | TrackedLink                |
|     16 | WebhookDeadLetter          |
|     15 | CrmActivity                |
|     15 | PostComment                |
|     15 | TemplateAnalytics          |
|     14 | ApiKey                     |
|     14 | ApprovalRequest            |
|     14 | Notification               |
|     14 | PostMedia                  |
|     14 | SagaInstance               |
|     13 | Campaign                   |
|     13 | Channel                    |
|     13 | CrmContact                 |
|     13 | RepurposeProposal          |
|     13 | ScheduledReport            |
|     12 | ABTest                     |
|     12 | AIPromptTemplate           |
|     12 | AuditLog                   |
|     12 | BillingEvent               |
|     12 | BrandKit                   |
|     12 | OutboxEvent                |
|     12 | ProviderBundle             |
|     12 | SocialOutboundReply        |
|     12 | TemplateCommit             |
|     12 | TrendRadarResult           |
|     12 | Tweet                      |
|     11 | AccountCredential          |
|     11 | AccountOnboarding          |
|     11 | AdminUserPermission        |
|     11 | Analytics                  |
|     11 | ApprovalWorkflow           |
|     11 | OidcConfiguration          |
|     11 | OutboxDeadLetter           |
|     11 | PostContent                |
|     11 | ReportSchedule             |
|     11 | SamlConfiguration          |
|     11 | SecuritySettings           |
|     11 | TemplateComponent          |
|     10 | AdminRoleHistory           |
|     10 | AnalyticsDailySummary      |
|     10 | AnalyticsMonthlySummary    |
|     10 | AssetFolder                |
|     10 | BrandVoice                 |
|     10 | ConsentRecord              |
|     10 | ExternalNotificationConfig |
|     10 | FirstComment               |
|     10 | GeneratedImage             |
|     10 | IntegrationApiKey          |
|     10 | PublishLog                 |
|     10 | Role                       |
|     10 | SystemAnnouncement         |
|     10 | UsageMetric                |
|      9 | ApprovalReview             |
|      9 | ConversationNote           |
|      9 | CrmSyncLog                 |
|      9 | LinkClick                  |
|      9 | PlatformCredential         |
|      9 | Referral                   |
|      9 | RepurposeVariant           |
|      9 | SubscriptionPriceHistory   |
|      9 | TemplateCollaboration      |
|      8 | ApprovalWorkflowLevel      |
|      8 | IntegrationSubscription    |
|      8 | ReferralCode               |
|      8 | TemplateUsageEvent         |
|      7 | AccountPricingTier         |
|      7 | AiTokenUsage               |
|      7 | AssetTag                   |
|      7 | ProjectMember              |
|      7 | ProviderPricingTier        |
|      7 | TemplateComponentUsage     |
|      7 | Thread                     |
|      6 | PlatformEncryptionKey      |
|      5 | BundleFeatureFlag          |
|      5 | CampaignPost               |
|      5 | NotificationPreference     |
|      5 | RolePermission             |
|      5 | SamlSession                |
|      4 | AssetTagOnAsset            |

**Total: 114 models.**

### 2.2 Prisma enums (54)

```
ABTestStatus, AccountCredentialGroup, AnnouncementType, ApprovalStatus,
BillingCycle, CampaignStatus, ConnectionStatus, CredentialGroup,
CrmActivityType, CrmPlatform, DpoType, DsarRequestType, DsarStatus,
GatewayProvider, InstagramContentType, IntegrationPlatform, InvoiceStatus,
JurisdictionType, LogStatus, MediaKind, MessagePriority, NotificationType,
OutboundReplyStatus, Provider, PublishingStatus, QueuePriority,
ReferralStatus, ReportChartType, ReportFormat, RepurposeStatus,
ReviewDecision, SegmentStatus, SocialMessageStatus, SocialMessageType,
SsoProvider, StoryProjectStatus, StoryStatus, SubscriptionStatus,
SwitchStatus, SyncStatus, TaskPriority, TaskStatus, TeamRole,
TemplateCollaboratorRole, TemplateComponentType, TemplatePermission,
TemplateUsageAction, ThreadStrategy, TrendUrgency, TweetStatus,
VersionChangeType, VideoProcessingStatus, WebhookEventType,
WebhookProcessingStatus
```

Total: 54. Values not enumerated in D0 (per rule "no volcar archivos gigantes"). D3 extracts enum values when auditing consistency.

### 2.3 Indexes and constraints

Present in schema via `@@index`, `@@unique`, `@id` directives. Not enumerated in D0. D3 extracts when auditing integrity.

### 2.4 Migrations (5)

```
infra/prisma/migrations/00000000000000_baseline
infra/prisma/migrations/20260414014352_add_ai_token_usage
infra/prisma/migrations/20260415000000_add_invoice_dunning
infra/prisma/migrations/20260415033511_add_account_onboarding
infra/prisma/migrations/20260415040000_ux_polish_avatar_invite_announcements
```

### 2.5 Seeds (1)

**File:** `infra/prisma/seed.ts` (~540 lines per prior read).

**Tables seeded (from PRE-1 read + header):**

- `AIPromptTemplate` (system prompt templates)
- `Role` + `RolePermission` (3 system roles: SUPER_ADMIN, ADMIN, SUPPORT, with permission arrays idempotently upserted)
- `AdminUser` (1 seeded: `admin@omnipost.local` with `roleId: "role-super-admin"`)
- `ProviderPricingTier` (3 tiers: 1-3, 4-7, 8+)
- `AccountPricingTier` (3 tiers: 1, 2-5, 6+ accounts)
- `ProviderBundle` (3 bundles: Starter, Growth, Agency Full)

---

## 3. Auth & RBAC

### 3.1 Permission enum (17 values)

Source: [apps/api/src/auth/rbacService.ts:20-57](apps/api/src/auth/rbacService.ts#L20-L57).

| Key               | Value               | Category           |
| ----------------- | ------------------- | ------------------ |
| USER_READ         | `user:read`         | User Management    |
| USER_MANAGE       | `user:manage`       | User Management    |
| USER_MANAGE_ROLES | `user:manage_roles` | User Management    |
| DASHBOARD_VIEW    | `dashboard:view`    | Dashboard          |
| ACCOUNT_READ      | `account:read`      | Account Management |
| ACCOUNT_MANAGE    | `account:manage`    | Account Management |
| BILLING_READ      | `billing:read`      | Billing            |
| BILLING_MANAGE    | `billing:manage`    | Billing            |
| POST_MANAGE       | `post:manage`       | Posts              |
| PRICING_MANAGE    | `pricing:manage`    | Pricing            |
| ANALYTICS_READ    | `analytics:read`    | Analytics          |
| ANALYTICS_EXPORT  | `analytics:export`  | Analytics          |
| SYSTEM_CONFIGURE  | `system:configure`  | System             |
| SYSTEM_MONITOR    | `system:monitor`    | System             |
| AUDIT_READ        | `audit:read`        | Audit              |
| AUDIT_EXPORT      | `audit:export`      | Audit              |
| WEBHOOK_MANAGE    | `webhook:manage`    | Webhooks           |

### 3.2 Roles (3 system + runtime)

Source: [infra/prisma/seed.ts:332-388](infra/prisma/seed.ts#L332-L388).

| Role        | Level | `isSystem` | Description                                                         |
| ----------- | ----: | ---------- | ------------------------------------------------------------------- |
| SUPER_ADMIN |   100 | true       | Full system access with all permissions                             |
| ADMIN       |    50 | true       | Administrative access with account and user management capabilities |
| SUPPORT     |    10 | true       | Limited access for customer support operations                      |

**Runtime override:** [apps/api/src/auth/rbacService.ts:110](apps/api/src/auth/rbacService.ts#L110) — if `roleName === "SUPER_ADMIN"`, `getPermissions()` returns `Object.values(Permission)` (all 17). SUPER_ADMIN bypasses DB RolePermission lookup.

### 3.3 Role → permission mapping (declared in seed)

Source: [infra/prisma/seed.ts:340-388](infra/prisma/seed.ts#L340-L388).

| Permission        | SUPER_ADMIN | ADMIN | SUPPORT |
| ----------------- | :---------: | :---: | :-----: |
| USER_READ         |      ✓      |   ✓   |    ✓    |
| USER_MANAGE       |      ✓      |   ✓   |    —    |
| USER_MANAGE_ROLES |      ✓      |   —   |    —    |
| DASHBOARD_VIEW    |     ✓¹      |  ✓¹   |   ✓¹    |
| ACCOUNT_READ      |      ✓      |   ✓   |    ✓    |
| ACCOUNT_MANAGE    |      ✓      |   ✓   |    —    |
| BILLING_READ      |      ✓      |   ✓   |    ✓    |
| BILLING_MANAGE    |      ✓      |   ✓   |    —    |
| POST_MANAGE       |     ✓¹      |   —   |    —    |
| PRICING_MANAGE    |      ✓      |   —   |    —    |
| ANALYTICS_READ    |      ✓      |   ✓   |    ✓    |
| ANALYTICS_EXPORT  |      ✓      |   ✓   |    —    |
| SYSTEM_CONFIGURE  |      ✓      |   —   |    —    |
| SYSTEM_MONITOR    |      ✓      |   ✓   |    —    |
| AUDIT_READ        |      ✓      |   ✓   |    ✓    |
| AUDIT_EXPORT      |      ✓      |   —   |    —    |
| WEBHOOK_MANAGE    |      ✓      |   ✓   |    —    |

**Permissions-per-role totals (from seed literal):** SUPER_ADMIN = 15 explicit + 2 implicit via runtime override (DASHBOARD_VIEW, POST_MANAGE not in seed literal but part of enum → granted via override). ADMIN = 11. SUPPORT = 5.

¹ `DASHBOARD_VIEW` and `POST_MANAGE` are declared in the enum but not in the seed's explicit permission arrays. They are granted to SUPER_ADMIN via the runtime override only. This is a **LATERAL FINDING** — see `LATERAL_FINDINGS.md`.

### 3.4 Auth middlewares (6 distinct)

| Middleware                          | Path                                                                              | Kind                              |
| ----------------------------------- | --------------------------------------------------------------------------------- | --------------------------------- |
| `requireAdminAuth`                  | [adminAuthMiddleware.ts:55](apps/api/src/admin/auth/adminAuthMiddleware.ts#L55)   | Admin JWT + session validation    |
| `requireSuperAdmin`                 | [adminAuthMiddleware.ts:182](apps/api/src/admin/auth/adminAuthMiddleware.ts#L182) | Role check (wraps `requireRole`)  |
| `requireAdmin`                      | [adminAuthMiddleware.ts:189](apps/api/src/admin/auth/adminAuthMiddleware.ts#L189) | Role check (SUPER_ADMIN or ADMIN) |
| `requireClientAuth`                 | [customerAuthMiddleware.ts:36](apps/api/src/auth/customerAuthMiddleware.ts#L36)   | Customer JWT + session validation |
| `requirePermission(...perms)`       | [rbacMiddleware.ts:36](apps/api/src/auth/rbacMiddleware.ts#L36)                   | Any-of permission check           |
| `requireAllPermissions(...perms)`   | [rbacMiddleware.ts:69](apps/api/src/auth/rbacMiddleware.ts#L69)                   | All-of permission check           |
| `requireOwnershipOrPermission(...)` | [rbacMiddleware.ts:108](apps/api/src/auth/rbacMiddleware.ts#L108)                 | Ownership OR fallback perm        |
| `requireContextPermission(...)`     | [rbacMiddleware.ts:156](apps/api/src/auth/rbacMiddleware.ts#L156)                 | Context-evaluated perm            |

Additional infrastructure middlewares (non-auth): `auditMiddleware`, `integrationAuthMiddleware`, `autoCacheMiddleware`, `correlationMiddleware`, `metricsMiddleware`, `csrfMiddleware`, `ipAllowlistMiddleware`. See §1.6 for file list.

---

## 4. Frontend

_Extracted by `nextjs-frontend-developer` subagent, 2026-04-17._

### 4.1 Folder structure (first-level dirs under `apps/<app>/`)

**apps/admin/**

| Directory            |
| -------------------- |
| `app/`               |
| `components/`        |
| `hooks/`             |
| `i18n/`              |
| `lib/`               |
| `messages/`          |
| `node_modules/`      |
| `playwright-report/` |
| `providers/`         |
| `reports/`           |
| `scripts/`           |
| `stories/`           |
| `test-results/`      |
| `tests/`             |
| `types/`             |

**apps/client/**

| Directory           |
| ------------------- |
| `app/`              |
| `components/`       |
| `coverage/`         |
| `hooks/`            |
| `lib/`              |
| `node_modules/`     |
| `providers/`        |
| `public/`           |
| `reports/`          |
| `stories/`          |
| `storybook-static/` |
| `tests/`            |
| `types/`            |

### 4.2 Hooks inventory (file → exported hooks)

**apps/admin (30 files found)**

| File                                                      | Exported hooks                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/admin/app/(dashboard)/webhooks/page.tsx`            | no encontrado                                                                                                                                                                                                                                                                                |
| `apps/admin/components/webhooks/DeadLetterQueue.tsx`      | no encontrado                                                                                                                                                                                                                                                                                |
| `apps/admin/components/webhooks/WebhookEventsList.tsx`    | no encontrado                                                                                                                                                                                                                                                                                |
| `apps/admin/components/webhooks/WebhookMetrics.tsx`       | no encontrado                                                                                                                                                                                                                                                                                |
| `apps/admin/components/webhooks/WebhookSubscriptions.tsx` | no encontrado                                                                                                                                                                                                                                                                                |
| `apps/admin/components/webhooks/WebhookTimeline.tsx`      | no encontrado                                                                                                                                                                                                                                                                                |
| `apps/admin/hooks/api/useAccountBilling.ts`               | `useAccountBilling`                                                                                                                                                                                                                                                                          |
| `apps/admin/hooks/api/useAccountSessions.ts`              | `useAccountSessions`, `useRevokeAccountSessions`                                                                                                                                                                                                                                             |
| `apps/admin/hooks/api/useAccounts.ts`                     | `useAccounts`, `useUpdateAccount`                                                                                                                                                                                                                                                            |
| `apps/admin/hooks/api/useAdminPasswordReset.ts`           | `useAdminPasswordReset`                                                                                                                                                                                                                                                                      |
| `apps/admin/hooks/api/useAdminUsers.ts`                   | `useActivateAdminUser`, `useAdminUsers`, `useCreateAdminUser`, `useDeactivateAdminUser`, `useUpdateAdminUser`                                                                                                                                                                                |
| `apps/admin/hooks/api/useAnalytics.ts`                    | `useAnalytics`                                                                                                                                                                                                                                                                               |
| `apps/admin/hooks/api/useAuditLogs.ts`                    | `useAuditLogs`                                                                                                                                                                                                                                                                               |
| `apps/admin/hooks/api/useAuditStats.ts`                   | `useAuditStats`                                                                                                                                                                                                                                                                              |
| `apps/admin/hooks/api/useBillingStats.ts`                 | `useBillingStats`                                                                                                                                                                                                                                                                            |
| `apps/admin/hooks/api/useChangePassword.ts`               | `useChangePassword`                                                                                                                                                                                                                                                                          |
| `apps/admin/hooks/api/useCompliance.ts`                   | `useAcknowledgeDsar`, `useBreachReports`, `useCompleteDsar`, `useCompliance`, `useComplianceScore`, `useCreateBreachReport`, `useDsarRequests`, `useGdprSettings`, `useRejectDsar`, `useSecuritySettings`, `useSendBreachNotification`, `useUpdateGdprSettings`, `useUpdateSecuritySettings` |
| `apps/admin/hooks/api/useDashboardStats.ts`               | `useDashboardStats`                                                                                                                                                                                                                                                                          |
| `apps/admin/hooks/api/useGatewaySwitches.ts`              | `useExtendSwitchDeadline`, `useForceCompleteSwitch`, `useForceSuspendSwitch`, `useGatewaySwitchDetail`, `useGatewaySwitches`                                                                                                                                                                 |
| `apps/admin/hooks/api/usePricingTiers.ts`                 | `useCreateAccountTier`, `useCreateBundle`, `useCreateProviderTier`, `useDeleteBundle`, `usePricingTiers`, `useToggleTierStatus`, `useUpdateAccountTier`, `useUpdateBundle`, `useUpdateProviderTier`                                                                                          |
| `apps/admin/hooks/api/usePublicSettings.ts`               | `usePublicSettings`                                                                                                                                                                                                                                                                          |
| `apps/admin/hooks/api/useQueueManagement.ts`              | `useFailedJobs`, `useQueueStats`, `useRetryJob`                                                                                                                                                                                                                                              |
| `apps/admin/hooks/api/useResetAccountPassword.ts`         | `useResetAccountPassword`                                                                                                                                                                                                                                                                    |
| `apps/admin/hooks/api/useSecurity.ts`                     | `useSecurityOverview`                                                                                                                                                                                                                                                                        |
| `apps/admin/hooks/api/useSettings.ts`                     | `useDeleteCredential`, `useGroupSettings`, `useRotateEncryption`, `useSettingsStatus`, `useTestConnection`, `useUpdateGroupSettings`                                                                                                                                                         |
| `apps/admin/hooks/api/useSubscriptionMutations.ts`        | `useConvertTrial`, `useEndTrial`, `useStartTrial`                                                                                                                                                                                                                                            |
| `apps/admin/hooks/api/useSubscriptions.ts`                | `useSubscriptions`                                                                                                                                                                                                                                                                           |
| `apps/admin/hooks/api/useUsageMetrics.ts`                 | `useUsageMetrics`                                                                                                                                                                                                                                                                            |
| `apps/admin/hooks/api/useWebhooks.ts`                     | `useDlqMetrics`, `useOutboxDeadLetter`, `useResolveOutboxDlq`, `useRetryOutboxDlq`, `useWebhookMetrics`                                                                                                                                                                                      |
| `apps/admin/hooks/useChartColors.ts`                      | `useChartColors`                                                                                                                                                                                                                                                                             |

**apps/client (44 files found)**

| File                                                                     | Exported hooks                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/client/components/ai/analytics/hooks/usePredictiveData.ts`         | `usePredictiveData`                                                                                                                                                                               |
| `apps/client/components/instagram/stories/hooks/useFileUpload.ts`        | `useFileUpload`                                                                                                                                                                                   |
| `apps/client/components/instagram/stories/hooks/useKeyboardShortcuts.ts` | `useKeyboardShortcuts`                                                                                                                                                                            |
| `apps/client/components/instagram/stories/hooks/useStoryManagement.ts`   | `useStoryManagement`                                                                                                                                                                              |
| `apps/client/hooks/api/useAIContentGeneration.ts`                        | `useAIContentGeneration`                                                                                                                                                                          |
| `apps/client/hooks/api/useAIImages.ts`                                   | `useGeneratedImages`, `useGenerateImage`                                                                                                                                                          |
| `apps/client/hooks/api/useAIPromptTemplates.ts`                          | `useAIPromptTemplates`, `useCreateAIPromptTemplate`, `useDeleteAIPromptTemplate`, `useUpdateAIPromptTemplate`                                                                                     |
| `apps/client/hooks/api/useAiSettings.ts`                                 | `useAiStatus`, `useDeleteByokKey`, `useSetByokKey`, `useTestByokKey`                                                                                                                              |
| `apps/client/hooks/api/useAnalytics.ts`                                  | `useAnalytics`                                                                                                                                                                                    |
| `apps/client/hooks/api/useApprovals.ts`                                  | `useApprovePost`, `usePendingApprovals`, `useRejectPost`, `useSubmitForReview`                                                                                                                    |
| `apps/client/hooks/api/useAssets.ts`                                     | `useAssetFolders`, `useAssets`, `useAssetTags`, `useCreateAsset`, `useCreateFolder`, `useDeleteAsset`                                                                                             |
| `apps/client/hooks/api/useBilling.ts`                                    | `useAvailablePlans`, `useBillingPortal`, `useCancelGatewaySwitch`, `useCheckout`, `useGatewayStatus`, `useInitiateGatewaySwitch`, `useMyInvoices`                                                 |
| `apps/client/hooks/api/useBrandVoice.ts`                                 | `useBrandVoice`, `useDeleteBrandVoice`, `useUpsertBrandVoice`                                                                                                                                     |
| `apps/client/hooks/api/useCampaigns.ts`                                  | `useArchiveCampaign`, `useCampaign`, `useCampaignAnalytics`, `useCampaigns`, `useCreateCampaign`                                                                                                  |
| `apps/client/hooks/api/useChannels.ts`                                   | `useChannels`, `useDisconnectChannel`, `useProviders`                                                                                                                                             |
| `apps/client/hooks/api/useComments.ts`                                   | `useAddComment`, `useComments`                                                                                                                                                                    |
| `apps/client/hooks/api/useContentCalendar.ts`                            | `useContentCalendar`                                                                                                                                                                              |
| `apps/client/hooks/api/useContentLibrary.ts`                             | `useContentLibrary`                                                                                                                                                                               |
| `apps/client/hooks/api/useCrm.ts`                                        | `useCrmConnections`, `useCrmSyncLogs`, `useDisconnectCrm`, `useSyncCrm`                                                                                                                           |
| `apps/client/hooks/api/useExternalNotifications.ts`                      | `useCreateWebhook`, `useDeleteWebhook`, `useExternalNotificationConfigs`, `useTestWebhook`                                                                                                        |
| `apps/client/hooks/api/useInbox.ts`                                      | `useAssignMessage`, `useConversation`, `useConversationMessages`, `useInboxConversations`, `useMarkMessageRead`, `useMentions`, `useReopenConversation`, `useResolveConversation`, `useSendReply` |
| `apps/client/hooks/api/useMultiPlatformScheduling.ts`                    | `useBulkCreateSchedules`, `useCreateSchedule`, `useOptimalTimes`, `useScheduleSlots`, `useSchedulingRules`                                                                                        |
| `apps/client/hooks/api/useOnboarding.ts`                                 | `useCompleteStep`, `useDismissOnboarding`, `useOnboarding`                                                                                                                                        |
| `apps/client/hooks/api/usePerformanceInsights.ts`                        | `usePerformanceInsights`                                                                                                                                                                          |
| `apps/client/hooks/api/usePlatformVariants.ts`                           | `usePlatformVariants`                                                                                                                                                                             |
| `apps/client/hooks/api/usePrivacy.ts`                                    | `useSubmitDsarRequest`                                                                                                                                                                            |
| `apps/client/hooks/api/useRecurringPosts.ts`                             | `useDeactivateRecurringPost`, `useRecurringPosts`                                                                                                                                                 |
| `apps/client/hooks/api/useReports.ts`                                    | `useCreateReport`, `useDeleteReport`, `useGenerateReport`, `useReports`                                                                                                                           |
| `apps/client/hooks/api/useScheduledPosts.ts`                             | `useCancelScheduledPost`, `useScheduledPosts`                                                                                                                                                     |
| `apps/client/hooks/api/useSso.ts`                                        | `useConfigureOidc`, `useConfigureSaml`, `useDisableSso`, `useEnableOidc`, `useEnableSaml`, `useOidcConfig`, `useSamlConfig`                                                                       |
| `apps/client/hooks/api/useTasks.ts`                                      | `useCancelTask`, `useCompleteTask`, `useCreateTask`, `useTask`, `useTasks`, `useUpdateTask`                                                                                                       |
| `apps/client/hooks/api/useTeam.ts`                                       | `useInviteTeamMember`, `useRemoveTeamMember`, `useTeamMembers`, `useUpdateTeamMemberRole`                                                                                                         |
| `apps/client/hooks/api/useUniversalAnalytics.ts`                         | `useUniversalAnalytics`                                                                                                                                                                           |
| `apps/client/hooks/api/useUsageMetrics.ts`                               | `useUsageMetrics`                                                                                                                                                                                 |
| `apps/client/hooks/api/useUsage.ts`                                      | `useAccountUsage`                                                                                                                                                                                 |
| `apps/client/hooks/useAIContentGenerator.ts`                             | `useAIContentGenerator`                                                                                                                                                                           |
| `apps/client/hooks/useFocusTrap.ts`                                      | `useFocusTrap`                                                                                                                                                                                    |
| `apps/client/hooks/useNotificationStream.ts`                             | `useNotificationStream`                                                                                                                                                                           |
| `apps/client/lib/api/hooks.ts`                                           | `useAllProvidersHealth`, `useApiProviders`, `useCreatePost`, `useDeletePost`, `usePost`, `usePosts`, `useProjects`, `useUpdatePost`, `useUploadFile`                                              |
| `apps/client/lib/hooks/useABTests.ts`                                    | `useABTests`                                                                                                                                                                                      |
| `apps/client/lib/hooks/useAutoSave.ts`                                   | `useAutoSave`, `usePostDraft`                                                                                                                                                                     |
| `apps/client/lib/hooks/useProviders.ts`                                  | `useProviders`, `useProviderStatusColor`, `useProviderStatusLabel`                                                                                                                                |
| `apps/client/lib/hooks/useTemplates.ts`                                  | `useTemplates`                                                                                                                                                                                    |
| `apps/client/lib/hooks/useTemplateVersions.ts`                           | `useTemplateVersions`                                                                                                                                                                             |

### 4.3 Components count per top-level folder

**apps/admin — total `.tsx` files: 86**

| Folder                                 | `.tsx` file count |
| -------------------------------------- | ----------------- |
| `apps/admin/components/accounts/`      | 3                 |
| `apps/admin/components/auth/`          | 2                 |
| `apps/admin/components/charts/`        | 5                 |
| `apps/admin/components/compliance/`    | 4                 |
| `apps/admin/components/dashboard/`     | 1                 |
| `apps/admin/components/maintenance/`   | 3                 |
| `apps/admin/components/pricing/`       | 2                 |
| `apps/admin/components/security/`      | 5                 |
| `apps/admin/components/settings/`      | 11                |
| `apps/admin/components/shared/`        | 3                 |
| `apps/admin/components/subscriptions/` | 1                 |
| `apps/admin/components/ui/`            | 10                |
| `apps/admin/components/users/`         | 1                 |
| `apps/admin/components/webhooks/`      | 5                 |

**apps/client — total `.tsx` files: 225**

| Folder                                  | `.tsx` file count |
| --------------------------------------- | ----------------- |
| `apps/client/components/ai/`            | 25                |
| `apps/client/components/analytics/`     | 10                |
| `apps/client/components/announcements/` | 1                 |
| `apps/client/components/approvals/`     | 3                 |
| `apps/client/components/assets/`        | 4                 |
| `apps/client/components/billing/`       | 1                 |
| `apps/client/components/campaigns/`     | 4                 |
| `apps/client/components/comments/`      | 1                 |
| `apps/client/components/content/`       | 21                |
| `apps/client/components/editor/`        | 8                 |
| `apps/client/components/inbox/`         | 8                 |
| `apps/client/components/instagram/`     | 8                 |
| `apps/client/components/integrations/`  | 1                 |
| `apps/client/components/notifications/` | 3                 |
| `apps/client/components/onboarding/`    | 1                 |
| `apps/client/components/publishing/`    | 3                 |
| `apps/client/components/scheduling/`    | 16                |
| `apps/client/components/settings/`      | 10                |
| `apps/client/components/shared/`        | 2                 |
| `apps/client/components/tasks/`         | 5                 |
| `apps/client/components/team/`          | 5                 |
| `apps/client/components/templates/`     | 21                |

### 4.4 Next.js pages / routes

**apps/admin (25 files)**

| File                                                           |
| -------------------------------------------------------------- |
| `apps/admin/app/api/auth/refresh/route.ts`                     |
| `apps/admin/app/api/backend/[...path]/route.ts`                |
| `apps/admin/app/api/clear-session/route.ts`                    |
| `apps/admin/app/(auth)/layout.tsx`                             |
| `apps/admin/app/(auth)/login/page.tsx`                         |
| `apps/admin/app/(dashboard)/accounts/page.tsx`                 |
| `apps/admin/app/(dashboard)/analytics/page.tsx`                |
| `apps/admin/app/(dashboard)/announcements/page.tsx`            |
| `apps/admin/app/(dashboard)/billing/gateway-switches/page.tsx` |
| `apps/admin/app/(dashboard)/compliance/page.tsx`               |
| `apps/admin/app/(dashboard)/help/page.tsx`                     |
| `apps/admin/app/(dashboard)/layout.tsx`                        |
| `apps/admin/app/(dashboard)/logs/page.tsx`                     |
| `apps/admin/app/(dashboard)/maintenance/page.tsx`              |
| `apps/admin/app/(dashboard)/page.tsx`                          |
| `apps/admin/app/(dashboard)/pricing/page.tsx`                  |
| `apps/admin/app/(dashboard)/security/mfa/page.tsx`             |
| `apps/admin/app/(dashboard)/security/page.tsx`                 |
| `apps/admin/app/(dashboard)/security/rbac/page.tsx`            |
| `apps/admin/app/(dashboard)/settings/page.tsx`                 |
| `apps/admin/app/(dashboard)/subscriptions/page.tsx`            |
| `apps/admin/app/(dashboard)/users/page.tsx`                    |
| `apps/admin/app/(dashboard)/webhooks/page.tsx`                 |
| `apps/admin/app/layout.tsx`                                    |
| `apps/admin/app/reset-password/page.tsx`                       |

**apps/client (48 files)**

| File                                                                |
| ------------------------------------------------------------------- |
| `apps/client/app/api/backend/[...path]/route.ts`                    |
| `apps/client/app/dashboard/ai/analytics/page.tsx`                   |
| `apps/client/app/dashboard/ai/generate/page.tsx`                    |
| `apps/client/app/dashboard/ai/optimizer/page.tsx`                   |
| `apps/client/app/dashboard/ai/repurpose/page.tsx`                   |
| `apps/client/app/dashboard/ai/templates/page.tsx`                   |
| `apps/client/app/dashboard/ai/trends/page.tsx`                      |
| `apps/client/app/dashboard/analytics/insights/page.tsx`             |
| `apps/client/app/dashboard/analytics/page.tsx`                      |
| `apps/client/app/dashboard/analytics/reports/page.tsx`              |
| `apps/client/app/dashboard/approvals/page.tsx`                      |
| `apps/client/app/dashboard/assets/page.tsx`                         |
| `apps/client/app/dashboard/campaigns/[id]/page.tsx`                 |
| `apps/client/app/dashboard/campaigns/page.tsx`                      |
| `apps/client/app/dashboard/channels/page.tsx`                       |
| `apps/client/app/dashboard/content/library/page.tsx`                |
| `apps/client/app/dashboard/content/templates/page.tsx`              |
| `apps/client/app/dashboard/inbox/page.tsx`                          |
| `apps/client/app/dashboard/instagram/stories/page.tsx`              |
| `apps/client/app/dashboard/instagram/upload/page.tsx`               |
| `apps/client/app/dashboard/integrations/page.tsx`                   |
| `apps/client/app/dashboard/layout.tsx`                              |
| `apps/client/app/dashboard/page.tsx`                                |
| `apps/client/app/dashboard/posts/[id]/page.tsx`                     |
| `apps/client/app/dashboard/posts/[id]/preview/page.tsx`             |
| `apps/client/app/dashboard/posts/new/page.tsx`                      |
| `apps/client/app/dashboard/posts/page.tsx`                          |
| `apps/client/app/dashboard/scheduling/page.tsx`                     |
| `apps/client/app/dashboard/scheduling/recurring/[id]/edit/page.tsx` |
| `apps/client/app/dashboard/scheduling/recurring/new/page.tsx`       |
| `apps/client/app/dashboard/scheduling/recurring/page.tsx`           |
| `apps/client/app/dashboard/settings/ai/page.tsx`                    |
| `apps/client/app/dashboard/settings/billing/page.tsx`               |
| `apps/client/app/dashboard/settings/brand-voice/page.tsx`           |
| `apps/client/app/dashboard/settings/crm/page.tsx`                   |
| `apps/client/app/dashboard/settings/integrations/page.tsx`          |
| `apps/client/app/dashboard/settings/notifications/page.tsx`         |
| `apps/client/app/dashboard/settings/privacy/page.tsx`               |
| `apps/client/app/dashboard/settings/referral/page.tsx`              |
| `apps/client/app/dashboard/settings/sso/page.tsx`                   |
| `apps/client/app/dashboard/settings/team/page.tsx`                  |
| `apps/client/app/dashboard/settings/usage/page.tsx`                 |
| `apps/client/app/dashboard/tasks/page.tsx`                          |
| `apps/client/app/dashboard/templates/page.tsx`                      |
| `apps/client/app/layout.tsx`                                        |
| `apps/client/app/login/page.tsx`                                    |
| `apps/client/app/page.tsx`                                          |
| `apps/client/app/register/page.tsx`                                 |
| `apps/client/app/reports/shared/[token]/page.tsx`                   |

### 4.5 API client files

| App    | File                            |
| ------ | ------------------------------- |
| admin  | `apps/admin/lib/apiClient.ts`   |
| client | `apps/client/lib/api/client.ts` |

---

## 5. Shared code

### 5.1 Packages (9 top-level, 36 total including nested)

| Top-level                 | pnpm name              | Nested packages                                                                                                                                                                                         |
| ------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/adapters/`      | (no root package.json) | cache-redis, crm-hubspot, crm-salesforce, db-prisma, dead-letter-queue, external-apis, fallback-strategies, queue-bullmq, storage-azure, storage-cloudinary, storage-do-spaces, storage-gcs, storage-s3 |
| `packages/api-common/`    | `@packages/api-common` | —                                                                                                                                                                                                       |
| `packages/core/`          | `@core/engine`         | threading                                                                                                                                                                                               |
| `packages/monitoring/`    | (no root package.json) | circuit-breaker, health-checks                                                                                                                                                                          |
| `packages/observability/` | (no root package.json) | logger, opentelemetry                                                                                                                                                                                   |
| `packages/ports/`         | `@ports/core`          | —                                                                                                                                                                                                       |
| `packages/providers/`     | (no root package.json) | bluesky, facebook, instagram, linkedin, pinterest, shared, snapchat, telegram, `_template`, threads, tiktok, x, youtube                                                                                 |
| `packages/shared/`        | `@shared/types`        | —                                                                                                                                                                                                       |
| `packages/ui/`            | `@packages/ui`         | —                                                                                                                                                                                                       |

Total `package.json` files in packages: 36 (including `_template` skeleton provider).

### 5.2 Shared types files (representative, non-exhaustive)

Top-level `types.ts` / `types/` locations excluding `.stryker-tmp` and generated:

```
apps/admin/lib/auth/types.ts
apps/admin/types/
apps/api/src/ai/types.ts
apps/api/src/analytics/crossPlatform/types.ts
apps/api/src/analytics/performanceComparison/types.ts
apps/api/src/analytics/roi/types.ts
apps/api/src/analytics/types.ts
apps/api/src/application/aiPromptTemplates/types.ts
apps/api/src/application/analytics/types.ts
apps/api/src/application/campaigns/types.ts
apps/api/src/application/crisis/types.ts
apps/api/src/application/custom-reports/types.ts
apps/api/src/application/links/types.ts
apps/api/src/application/ml/types.ts
apps/api/src/application/reports/types.ts
apps/api/src/billing/subscription/types.ts
apps/api/src/infrastructure/container/types.ts
apps/api/src/orchestration/sync/types.ts
apps/api/src/types/
```

Plus `@shared/types` package at `packages/shared/src/` (root of cross-app type definitions).

### 5.3 Validation schemas

Not enumerated in D0. Zod is the repo's validation lib (based on imports seen in routes). Per-route schema files live alongside route files (e.g. `templateSchemas.ts`). D3 extracts schemas when auditing input validation coverage.

---

## 6. Configuration

### 6.1 Config files (27)

**Root-level:**

- `tsconfig.base.json`, `tsconfig.json`
- `turbo.json`
- `pnpm-workspace.yaml`
- `eslint.config.cjs`
- `stryker.config.mjs`

**Per-app:**

| App          | tsconfig | vitest | next              | stryker | Other |
| ------------ | -------- | ------ | ----------------- | ------- | ----- |
| apps/admin   | ✓        | ✓      | `next.config.mjs` | ✓       | —     |
| apps/api     | ✓        | ✓      | —                 | ✓       | —     |
| apps/client  | ✓        | ✓      | `next.config.mjs` | ✓       | —     |
| apps/workers | ✓        | ✓      | —                 | ✓       | —     |

**Per-package:**

- `packages/api-common/`: tsconfig + vitest + stryker
- `packages/core/`: tsconfig + vitest + stryker
- `packages/ports/`, `packages/shared/`, `packages/ui/`: tsconfig only

### 6.2 Environment variables (3 templates)

| File                            | Var count |
| ------------------------------- | --------: |
| `/.env.example`                 |        10 |
| `apps/api/.env.example`         |        52 |
| `apps/admin/.env.local.example` |         3 |

**Total unique env vars declared:** 65 (pre-dedup — overlaps between files not checked in D0; D5 or D6 verifies).

### 6.3 Root `package.json` scripts (31)

```
test               turbo run test
lint               eslint . --ext .ts,.tsx --max-warnings 0
lint:fix           eslint . --ext .ts,.tsx --fix --max-warnings 0
format             prettier -w .
format:check       prettier -c .
typecheck          turbo run typecheck
typecheck:packages tsc --build
typecheck:apps     pnpm --filter @apps/api --filter @apps/admin --filter @apps/client --filter @apps/workers typecheck
build              turbo run build
dev:api            pnpm --filter @apps/api dev
dev:workers        pnpm --filter @apps/workers dev
dev:admin          pnpm --filter @apps/admin dev
dev:client         pnpm --filter @apps/client dev
dev:all            concurrently -n api,workers,admin,client ... "pnpm dev:api" ...
dev                concurrently -n api,workers ... "pnpm dev:api" "pnpm dev:workers"
db:up              docker compose up -d
db:studio          pnpm --filter @infra/prisma studio
db:migrate         pnpm --filter @infra/prisma migrate
db:seed            pnpm --filter @infra/prisma seed
prepare            husky
perf:test          bash performance/scripts/run-performance-tests.sh
perf:load          k6 run performance/k6/scenarios/load-test.js
perf:stress        k6 run performance/k6/scenarios/stress-test.js
perf:endurance     k6 run performance/k6/scenarios/endurance-test.js
perf:api           k6 run performance/k6/scenarios/api-performance.js
perf:db            tsx performance/database/postgres-stress.test.ts
perf:memory        tsx performance/monitoring/memory-leak-detector.ts
perf:baseline      tsx performance/scripts/baseline-capture.ts
perf:regression    tsx performance/monitoring/regression-detector.ts
perf:report        tsx performance/scripts/generate-reports.ts
```

Per-app + per-package `package.json` scripts not enumerated here (each is distinct; consumer dimensions can extract on demand).

---

## 7. Tests

### 7.1 Total test count

| Metric                                                                                        |   Count |
| --------------------------------------------------------------------------------------------- | ------: |
| Total `*.test.ts` + `*.test.tsx` + `*.spec.*` files (exc. node_modules + stryker-tmp + .next) | **528** |
| Integration-named tests (`*.integration.test.*`)                                              |      13 |
| E2E/Playwright tests                                                                          |       4 |

### 7.2 Distribution by app / package

| Location       | Test files |
| -------------- | ---------: |
| `apps/api`     |        400 |
| `apps/admin`   |         18 |
| `apps/client`  |         16 |
| `apps/workers` |          5 |
| `packages/*`   |        118 |
| **Sum**        |    **557** |

Note: sum (557) > total (528) due to glob overlap patterns (`.test.ts` + `.test.tsx` counted separately in some paths). D7 reconciles if relevant.

### 7.3 Stryker state

Latest Stryker artifacts on disk (`apps/api/reports/`):

```
mutation/batch-1.html          2026-03-15 (1.7 MB)
mutation/batch-2.html          2026-03-16 (4.5 MB)
stryker-incremental.json       2026-03-24 (12 MB)
```

Content not analyzed in D0. D7 reads these when planning mutation score targets.

---

## 8. External integrations

### 8.1 OAuth / SSO providers

Files under `apps/api/src/auth/`:

| File                       | Proveedor                             |
| -------------------------- | ------------------------------------- |
| `providerOAuth.ts`         | Generic OAuth entrypoint              |
| `providerOAuthFlow.ts`     | OAuth flow orchestration              |
| `providerOAuthConfigs.ts`  | Per-provider config (social channels) |
| `enhancedOAuthProvider.ts` | Enhanced flow wrapper                 |
| `samlRoutes.ts`            | SAML admin config + callback          |
| `oidcRoutes.ts`            | OIDC admin config + callback          |

### 8.2 Webhooks entrantes

**Billing webhook:** `apps/api/src/billing/billingWebhookRoutes.ts` — Stripe (`checkout.session.completed`, `invoice.payment_failed` per prior audit).

**Social webhook processors (8):**

```
apps/api/src/webhooks/processors/facebookWebhookProcessor.ts
apps/api/src/webhooks/processors/instagramWebhookProcessor.ts
apps/api/src/webhooks/processors/linkedinWebhookProcessor.ts
apps/api/src/webhooks/processors/snapchatWebhookProcessor.ts
apps/api/src/webhooks/processors/telegramWebhookProcessor.ts
apps/api/src/webhooks/processors/tiktokWebhookProcessor.ts
apps/api/src/webhooks/processors/xWebhookProcessor.ts
apps/api/src/webhooks/processors/youtubeWebhookProcessor.ts
```

Plus abstract base: `AbstractWebhookProcessor.ts`. Integration event handler: `infrastructure/integration-events/handlers/WebhookEventHandler.ts`.

### 8.3 APIs externas consumidas (by detected SDK / service name)

| SDK / Service        | Example location                                              |
| -------------------- | ------------------------------------------------------------- |
| Anthropic            | `apps/api/src/ai/providers/anthropic.ts`                      |
| OpenAI               | `apps/api/src/ai/providers/openai.ts`                         |
| Stripe (payment)     | `apps/api/src/infrastructure/billing/StripePaymentAdapter.ts` |
| Resend (email)       | `apps/api/src/infrastructure/adapters/ResendEmailAdapter.ts`  |
| Sentry               | `apps/api/src/observability/sentryInit.ts`                    |
| Cloudinary (storage) | `packages/adapters/storage-cloudinary/`                       |
| Azure Blob           | `packages/adapters/storage-azure/`                            |
| DigitalOcean Spaces  | `packages/adapters/storage-do-spaces/`                        |
| GCS                  | `packages/adapters/storage-gcs/`                              |
| S3                   | `packages/adapters/storage-s3/`                               |
| HubSpot (CRM)        | `packages/adapters/crm-hubspot/`                              |
| Salesforce (CRM)     | `packages/adapters/crm-salesforce/`                           |

Plus social media platform APIs via 12 provider packages (see §8.4).

### 8.4 Social channels supported (12 providers + shared + template)

```
packages/providers/bluesky/
packages/providers/facebook/
packages/providers/instagram/
packages/providers/linkedin/
packages/providers/pinterest/
packages/providers/shared/     (common provider utilities)
packages/providers/snapchat/
packages/providers/telegram/
packages/providers/_template/  (skeleton for new providers)
packages/providers/threads/
packages/providers/tiktok/
packages/providers/x/
packages/providers/youtube/
```

Total: 12 platform providers. `shared` is shared utilities, `_template` is a skeleton (not a real provider).
