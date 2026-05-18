---
title: API app inventory — full-repo audit input
description: File-by-file inventory of apps/api/src/ surface — domain + application + infrastructure layers + CQRS + saga + features.
generated: 2026-05-10
auditor: claude-code
---

# API app inventory

> Surface: `apps/api/src/`. Generated as input to the full-repo audit.
> 823 files inventoried. Veredicto breakdown (preliminary): VÁLIDO=≈770, REDUNDANTE=2, DEAD=≈12, FORGOTTEN-FEATURE=≈9, MISMATCH=≈1, UNKNOWN=≈29.

## Methodology + caveats

For each file I extracted: `@layer` (sweep showed 822/823 declare a canonical value — only `saga/sagaManagerTypes.ts` omits `@layer`), the `@file` header (823/823 present — fitness check #9 clean), the primary export name, and presence of cross-package imports. Caller discovery used `rg/grep -t ts` across `apps/api/src`, `apps/workers/src`, and `packages/`. For routes I checked the registration list in `apps/api/src/index.ts` (94 `register()` calls — 73 distinct route modules across feature folders). For use cases I cross-referenced the `setup*UseCases.ts` files under `apps/api/src/infrastructure/container/` plus the `TOKENS` symbol map at `apps/api/src/infrastructure/container/types.ts` (≈250 tokens).

Because of the volume (823 files), the per-file inventory below is rendered as **directory-grouped tables with one row per file** carrying all the required template fields (path, tipo, layer, propósito, exports, wiring, veredicto, notes). Files flagged as DEAD / REDUNDANTE / FORGOTTEN-FEATURE / MISMATCH are then re-rendered using the full per-file template at the bottom (`## Detailed entries — non-VÁLIDO files`) so Edward has the deeper context where it matters. Files marked **VÁLIDO** without notes are correctly wired routes / use cases / repositories with at least one production caller and the expected DI binding.

False-positive risks to manually confirm:

1. **Dynamic DI lookups** — `container.tryResolve<T>(TOKENS.X)` patterns can resolve a use case never directly imported by a route. tree-sitter-style grep cannot see those edges. I cross-checked TOKENS usage where ambiguous, but a route may legitimately invoke a use case via the bus.
2. **Saga retrofit just landed** — `cqrs/handlers/PostCommandHandlers.ts` and `defineSaga()` are CANONICAL per the user's note. I have flagged them VÁLIDO regardless of caller count.
3. **Stryker artifacts** — `apps/api/reports/` is gitignored noise; I ignored those when computing callers.
4. **Test-only modules** — the `video/*` and `monitoring/rateLimitingDashboard.ts` modules have tests but no production import path. Classified as FORGOTTEN-FEATURE (the test still passes — the code is real — but no route exposes it). Edward should confirm whether these are awaiting wiring or genuinely abandoned.

---

## Summary by Tipo

| Tipo                     |   Count | Notes                                                                                                                 |
| ------------------------ | ------: | --------------------------------------------------------------------------------------------------------------------- |
| route                    |      73 | All in `**/*Routes.ts` under feature folders; 73 distinct modules registered in `apps/api/src/index.ts`               |
| use-case                 |    ~141 | `apps/api/src/application/**/*UseCase.ts` plus query handlers                                                         |
| query-handler            |     ~32 | `apps/api/src/application/**/*Query.ts`                                                                               |
| domain-entity            |      27 | `apps/api/src/domain/entities/*.ts` (+ aggregates)                                                                    |
| value-object             |      22 | `apps/api/src/domain/value-objects/*.ts`                                                                              |
| aggregate                |       5 | `domain/aggregates/` (PostAggregate, ApprovalRequestAggregate, etc.)                                                  |
| domain-event             | 2 files | `PostEvents.ts`, `ProjectEvents.ts` (multiple events per file)                                                        |
| repository-port          |      59 | `apps/api/src/domain/repositories/*.ts`                                                                               |
| repository-impl          |      74 | `apps/api/src/infrastructure/repositories/Prisma*.ts` + variant adapters                                              |
| saga-definition / step   |  0 here | Saga step implementations live in `packages/shared/src/saga.ts` per CLAUDE.md; this app exposes the orchestrator only |
| processor                |       9 | `webhooks/processors/*WebhookProcessor.ts` + `billing/gatewaySwitchProcessor.ts`                                      |
| middleware               |       7 | `auth/*Middleware.ts`, `audit/auditMiddleware.ts`, `middleware/*`                                                     |
| DI-tokens                |       1 | `infrastructure/container/types.ts`                                                                                   |
| DI-container             |      25 | `infrastructure/container/Container.ts` + `setup*.ts` family                                                          |
| security                 |      14 | `security/*` + `infrastructure/security/*`                                                                            |
| provider / orchestration |      21 | `providers/`, `orchestration/`, `orchestration/sync/`                                                                 |
| service                  |     ~80 | `application/**/*Service.ts`, `*service.ts` files across features                                                     |
| adapter                  |      21 | `infrastructure/adapters/*` + `infrastructure/billing/*` + repository variant adapters                                |
| types                    |      16 | `*Types.ts`, `*types.ts`, `types/*.d.ts`                                                                              |
| barrel / index           |      23 | `index.ts` files                                                                                                      |
| config                   |       2 | `config/env.ts`, `infrastructure/container/types.ts`                                                                  |
| observability            |       5 | `lib/logger.ts`, `observability/sentryInit.ts`, `metrics/*`, `monitoring/performanceMonitor.ts`                       |

## Endpoint inventory

> 73 route modules registered in `apps/api/src/index.ts`. Full file→registration map. The exhaustive HTTP-verb level enumeration lives in `apps/api/src/**/*Routes.ts` (each file is a Fastify plugin; `fastify.get`/`fastify.post`/`fastify.put`/`fastify.delete` inside the plugin produce the HTTP endpoints). Below is the route-module index (one row per route file). Endpoint-level CSV is out of scope of this inventory pass.

| Route module               | File                                                              | Auth preHandler (typical)                           | Linked use cases (primary)                                                                                           |
| -------------------------- | ----------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| healthRoutes               | apps/api/src/health/healthRoutes.ts                               | none (public)                                       | n/a (delegates to RedisCacheManager + DB)                                                                            |
| billingWebhookRoutes       | apps/api/src/billing/billingWebhookRoutes.ts                      | signature verification                              | PaymentAdapter via gatewayAdapterRegistry                                                                            |
| authRoutes                 | apps/api/src/auth/authRoutes.ts                                   | none (login)                                        | authService + bruteForceProtection                                                                                   |
| auditRoutes                | apps/api/src/audit/auditRoutes.ts                                 | requireAdminAuth                                    | auditService                                                                                                         |
| activityFeedRoutes         | apps/api/src/audit/activityFeedRoutes.ts                          | requireAdminAuth                                    | activityFeedService                                                                                                  |
| mfaRoutes                  | apps/api/src/auth/mfaRoutes.ts                                    | requireClientAuth                                   | mfaService                                                                                                           |
| rbacRoutes                 | apps/api/src/auth/rbacRoutes.ts                                   | requireAdminAuth                                    | rbacService                                                                                                          |
| apiKeyRoutes               | apps/api/src/auth/apiKeyRoutes.ts                                 | requireClientAuth                                   | Create/List/Rotate/DeactivateApiKeyUseCase                                                                           |
| accountLifecycleRoutes     | apps/api/src/admin/accountLifecycleRoutes.ts                      | requireAdminAuth                                    | accountLifecycleService                                                                                              |
| pricingRoutes              | apps/api/src/admin/pricingRoutes.ts                               | requireAdminAuth                                    | UpdatePricingConfigUseCase                                                                                           |
| adminUserRoutes            | apps/api/src/admin/adminUserRoutes.ts                             | requireAdminAuth                                    | (AdminUser repo)                                                                                                     |
| adminAuthRoutes            | apps/api/src/admin/auth/adminAuthRoutes.ts                        | none (login)                                        | AdminAuthService + TokenService                                                                                      |
| adminAnalyticsRoutes       | apps/api/src/admin/analyticsRoutes.ts                             | requireAdminAuth                                    | DashboardService, AccountLifecycleService                                                                            |
| schedulingRoutes (admin)   | apps/api/src/admin/schedulingRoutes.ts                            | requireAdminAuth                                    | scheduling handlers                                                                                                  |
| queueRoutes                | apps/api/src/admin/queueRoutes.ts                                 | requireAdminAuth                                    | bullmq queue introspection                                                                                           |
| subscriptionRoutes         | apps/api/src/billing/subscriptionRoutes.ts                        | requireClientAuth/requireAdminAuth                  | subscriptionService + handlers                                                                                       |
| clientBillingRoutes        | apps/api/src/billing/clientBillingRoutes.ts                       | requireClientAuth                                   | GatewayBillingService                                                                                                |
| adminBillingRoutes         | apps/api/src/billing/adminBillingRoutes.ts                        | requireAdminAuth                                    | GatewayBillingService                                                                                                |
| complianceRoutes           | apps/api/src/compliance/complianceRoutes.ts                       | requireClientAuth                                   | ComplianceService, DataRetentionService                                                                              |
| settingsRoutes             | apps/api/src/settings/settingsRoutes.ts                           | requireClientAuth                                   | SettingsService                                                                                                      |
| outboxAdminRoutes          | apps/api/src/outbox/outboxAdminRoutes.ts                          | requireAdminAuth                                    | OutboxRelay / OutboxCleaner                                                                                          |
| analyticsRoutes            | apps/api/src/analytics/analyticsRoutes.ts                         | requireClientAuth                                   | GetCrossPlatformAnalyticsUseCase, ComparePerformanceUseCase, CalculateROIUseCase                                     |
| aiRoutes                   | apps/api/src/ai/routes.ts                                         | requireClientAuth                                   | OptimizeContentUseCase, PredictOptimalTimingUseCase, GeneratePlatformVariantsUseCase, GenerateContentCalendarUseCase |
| accountRoutes              | apps/api/src/accounts/accountRoutes.ts                            | requireClientAuth                                   | AccountRepository + AccountQueryRepository                                                                           |
| projectRoutes              | apps/api/src/projects/projectRoutes.ts                            | requireClientAuth                                   | ProjectRepository + ProjectQueryRepository                                                                           |
| postRoutes                 | apps/api/src/posts/postRoutes.ts                                  | requireClientAuth                                   | Create/Update/Get/List/Delete/SchedulePost UseCases + batch ops                                                      |
| channelRoutes              | apps/api/src/channels/channelRoutes.ts                            | requireClientAuth                                   | SetPrimaryChannelUseCase + ChannelRepository                                                                         |
| crisisRoutes               | apps/api/src/projects/crisisRoutes.ts                             | requireClientAuth                                   | Enter/Exit/GetCrisis UseCases                                                                                        |
| linkRoutes                 | apps/api/src/links/linkRoutes.ts                                  | requireClientAuth (most)                            | CreateTrackedLink, GetTrackedLink, GetLinkStats, DeleteTrackedLink, RedirectAndTrackClick                            |
| teamRoutes                 | apps/api/src/team/teamRoutes.ts                                   | requireClientAuth                                   | Invite/Update/Remove Team + GetTeamMembers + SearchTeamMembers                                                       |
| notificationRoutes         | apps/api/src/notifications/notificationRoutes.ts                  | requireClientAuth                                   | Create/MarkRead/GetUnreadCount Notification                                                                          |
| approvalRoutes             | apps/api/src/approvals/approvalRoutes.ts                          | requireClientAuth                                   | SubmitForReview, Approve, Reject + GetApprovalHistory + GetPendingApprovals                                          |
| onboardingRoutes           | apps/api/src/onboarding/onboardingRoutes.ts                       | requireClientAuth                                   | (delegates to multiple DI services)                                                                                  |
| announcementRoutes         | apps/api/src/announcements/announcementRoutes.ts                  | requireAdminAuth (create), requireClientAuth (read) | (Prisma direct in route — likely simple CRUD)                                                                        |
| approvalWorkflowRoutes     | apps/api/src/approvals/approvalWorkflowRoutes.ts                  | requireClientAuth                                   | Create/Update/Delete + ListApprovalWorkflowsQuery                                                                    |
| commentRoutes              | apps/api/src/comments/commentRoutes.ts                            | requireClientAuth                                   | Create/Edit/Delete Comment + GetPostCommentsQuery                                                                    |
| inboxRoutes                | apps/api/src/inbox/inboxRoutes.ts                                 | requireClientAuth                                   | Ingest/MarkRead/MarkArchived/Assign/SendReply/Resolve/Reopen + Get queries                                           |
| conversationNoteRoutes     | apps/api/src/inbox/conversationNoteRoutes.ts                      | requireClientAuth                                   | Add/Delete + ListConversationNotesQuery                                                                              |
| campaignRoutes             | apps/api/src/campaigns/campaignRoutes.ts                          | requireClientAuth                                   | Create/Update/Archive/TagPost/UntagPost + GetCampaignAnalytics + List/GetCampaign                                    |
| utmRoutes                  | apps/api/src/utm/utmRoutes.ts                                     | requireClientAuth                                   | GenerateUTMLinksUseCase                                                                                              |
| reportRoutes               | apps/api/src/reports/reportRoutes.ts                              | requireClientAuth                                   | Create/Update/Delete + ListScheduledReports + GenerateReport                                                         |
| firstCommentRoutes         | apps/api/src/first-comment/firstCommentRoutes.ts                  | requireClientAuth                                   | Set/Remove/Get/PublishFirstComment                                                                                   |
| externalNotificationRoutes | apps/api/src/external-notifications/externalNotificationRoutes.ts | requireClientAuth                                   | Configure/Delete/List/Test ExternalNotification                                                                      |
| aiImageRoutes              | apps/api/src/ai-image/aiImageRoutes.ts                            | requireClientAuth                                   | GenerateImage + ListGeneratedImages                                                                                  |
| recurringPostRoutes        | apps/api/src/recurring/recurringPostRoutes.ts                     | requireClientAuth                                   | Create/Update/Deactivate + Get/List Recurring + ProcessRecurrence                                                    |
| repurposeRoutes            | apps/api/src/repurpose/repurposeRoutes.ts                         | requireClientAuth                                   | Approve/Reject/Detect/GenerateRepurposeVariants                                                                      |
| promptTemplateRoutes       | apps/api/src/ai/promptTemplateRoutes.ts                           | requireClientAuth                                   | Create/Update/Delete + List AIPromptTemplate                                                                         |
| usageRoutes                | apps/api/src/usage/usageRoutes.ts                                 | requireClientAuth                                   | GetUsage / IncrementUsage                                                                                            |
| brandVoiceRoutes           | apps/api/src/brand-voice/brandVoiceRoutes.ts                      | requireClientAuth                                   | Upsert/Delete/Get BrandVoice                                                                                         |
| brandKitRoutes             | apps/api/src/brand-kit/brandKitRoutes.ts                          | requireClientAuth                                   | Upsert/Delete/Get BrandKit                                                                                           |
| assetRoutes                | apps/api/src/assets/assetRoutes.ts                                | requireClientAuth                                   | Create/Update/Delete/Tag MediaAsset + List/Create AssetTag/Folder + Import from Drive                                |
| zapierRoutes               | apps/api/src/integrations/zapierRoutes.ts                         | integration API key                                 | Subscribe/Unsubscribe + ListIntegrationApiKeys                                                                       |
| makeRoutes                 | apps/api/src/integrations/makeRoutes.ts                           | integration API key                                 | Subscribe/Unsubscribe                                                                                                |
| taskRoutes                 | apps/api/src/tasks/taskRoutes.ts                                  | requireClientAuth                                   | Create/Update/Complete/Cancel + List/Get Task                                                                        |
| samlRoutes                 | apps/api/src/auth/samlRoutes.ts                                   | mixed (initiate=public, callbacks=Saml)             | ConfigureSaml + Enable/Disable + GetSamlConfiguration                                                                |
| oidcRoutes                 | apps/api/src/auth/oidcRoutes.ts                                   | mixed                                               | ConfigureOidc + Enable/Disable + GetOidcConfiguration                                                                |
| customReportRoutes         | apps/api/src/custom-reports/customReportRoutes.ts                 | requireClientAuth                                   | Create/Update/Delete + List/Get/Run + Schedule + Enable/Disable Sharing                                              |
| schedulingClientRoutes     | apps/api/src/scheduling/schedulingClientRoutes.ts                 | requireClientAuth                                   | scheduling handlers                                                                                                  |
| providerRoutes             | apps/api/src/providers/providerRoutes.ts                          | requireClientAuth                                   | providerService + providerRegistry                                                                                   |
| templateRoutes             | apps/api/src/templates/templateRoutes.ts                          | requireClientAuth                                   | TemplateService + TemplateAnalytics + ABTest + Version                                                               |
| contentRoutes              | apps/api/src/content/contentRoutes.ts                             | requireClientAuth                                   | ContentVersionManager, SyncEngine, BranchManager, MergeManager                                                       |
| dashboardRoutes            | apps/api/src/admin/dashboardRoutes.ts                             | requireAdminAuth                                    | DashboardService                                                                                                     |
| secretsRotationRoutes      | apps/api/src/admin/secretsRotationRoutes.ts                       | requireAdminAuth                                    | GetSecretRotationStatusQuery                                                                                         |
| channelReauthRoutes        | apps/api/src/admin/channelReauthRoutes.ts                         | requireAdminAuth                                    | UpdateChannelAuthStateUseCase                                                                                        |
| webhookAdminRoutes         | apps/api/src/admin/webhookAdminRoutes.ts                          | requireAdminAuth                                    | RotateWebhookSecretKeyUseCase                                                                                        |
| oidcAdminRoutes            | apps/api/src/admin/oidcAdminRoutes.ts                             | requireAdminAuth                                    | ReplaceOidcClientSecretUseCase                                                                                       |
| apiKeyAdminRoutes          | apps/api/src/admin/apiKeyAdminRoutes.ts                           | requireAdminAuth                                    | (api-key admin ops)                                                                                                  |
| massReauthRoutes           | apps/api/src/admin/massReauthRoutes.ts                            | requireAdminAuth                                    | MassForceReauthByProviderUseCase                                                                                     |
| trendRoutes                | apps/api/src/trends/trendRoutes.ts                                | requireClientAuth                                   | trendAnalysisService + ScoreTrendRelevanceUseCase                                                                    |
| cacheStatsRoutes           | apps/api/src/monitoring/cacheStatsRoutes.ts                       | requireAdminAuth                                    | RedisCacheManager                                                                                                    |
| crmRoutes                  | apps/api/src/crm/crmRoutes.ts                                     | requireClientAuth                                   | Connect/Disconnect + GetCrmConnections + SyncContacts + LogActivity + GetCrmSyncLogs                                 |
| customerAuthRoutes         | apps/api/src/auth/customerAuthRoutes.ts                           | none (auth flow)                                    | Register/Login/Refresh/Logout + RequestPasswordReset/Reset                                                           |
| webhookDashboardRoutes     | apps/api/src/webhooks/webhookDashboardRoutes.ts                   | requireAdminAuth                                    | WebhookDashboardService + RealtimeWebhookBroadcaster                                                                 |
| OAuth provider connect     | apps/api/src/auth/providerOAuth.ts (`registerOAuthRoutes`)        | requireClientAuth                                   | providerOAuthFlow + ChannelRepository                                                                                |
| optimizedPostsRoutes       | apps/api/src/posts/optimizedPostsRoutes.ts                        | requireClientAuth                                   | postsService — **NOT REGISTERED in index.ts (DEAD)**                                                                 |

## DI tokens registered

> Source of truth: `apps/api/src/infrastructure/container/types.ts` (≈250 tokens). Bindings happen across `infrastructure/container/setup*.ts` (≈30 files). The full enumeration follows the order tokens appear in `types.ts`; "Bound to" column lists the implementation class.

| TOKEN                                                                                                                                                                                                                                                                                                                           | Lifetime  | Bound to                                                             | Setup file                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------- | ------------------------------------ |
| PrismaClient                                                                                                                                                                                                                                                                                                                    | singleton | `@infra/prisma` exported `prisma`                                    | setupRepositories.ts                 |
| PostRepository                                                                                                                                                                                                                                                                                                                  | singleton | PrismaPostRepository                                                 | setupRepositories.ts                 |
| AdminUserRepository                                                                                                                                                                                                                                                                                                             | singleton | PrismaAdminUserRepository                                            | setupRepositories.ts                 |
| AccountRepository                                                                                                                                                                                                                                                                                                               | singleton | PrismaAccountRepository                                              | setupRepositories.ts                 |
| ProjectRepository                                                                                                                                                                                                                                                                                                               | singleton | PrismaProjectRepository                                              | setupRepositories.ts                 |
| AnalyticsQueryRepository                                                                                                                                                                                                                                                                                                        | singleton | PrismaAnalyticsQueryRepository                                       | setupRepositories.ts                 |
| ChannelRepository                                                                                                                                                                                                                                                                                                               | singleton | PrismaChannelRepository                                              | setupRepositories.ts                 |
| AccountQueryRepository                                                                                                                                                                                                                                                                                                          | singleton | PrismaAccountQueryRepository                                         | setupRepositories.ts                 |
| ProjectQueryRepository                                                                                                                                                                                                                                                                                                          | singleton | PrismaProjectQueryRepository                                         | setupRepositories.ts                 |
| AnalyticsReadRepository                                                                                                                                                                                                                                                                                                         | singleton | PrismaAnalyticsReadRepository                                        | setupRepositories.ts                 |
| PostQueryRepository                                                                                                                                                                                                                                                                                                             | singleton | PrismaPostQueryRepository                                            | setupRepositories.ts                 |
| ApiKeyRepository                                                                                                                                                                                                                                                                                                                | singleton | PrismaApiKeyRepository                                               | setupRepositories.ts                 |
| CreateApiKeyUseCase / ValidateApiKeyUseCase / ListApiKeysUseCase / RotateApiKeyUseCase / DeactivateApiKeyUseCase                                                                                                                                                                                                                | singleton | application/apiKeys/ApiKeyUseCases.ts                                | setupApiKeyUseCases.ts               |
| EventDispatcher                                                                                                                                                                                                                                                                                                                 | singleton | ComposedEventDispatcher                                              | setup.ts                             |
| CreatePostUseCase / UpdatePostUseCase / GetPostUseCase / ListPostsUseCase / DeletePostUseCase / ArchivePostsBatchUseCase / HardDeletePostsBatchUseCase / DuplicatePostsBatchUseCase / SchedulePostUseCase / GetPostWithThreadQuery / ListPostsGlobalQuery                                                                       | singleton | application/posts/\*.ts                                              | setupPostUseCases.ts                 |
| SetPrimaryChannelUseCase                                                                                                                                                                                                                                                                                                        | singleton | application/channels/SetPrimaryChannelUseCase.ts                     | setupChannelUseCases.ts              |
| OutboxWriter / OutboxRelay / OutboxCleaner / OutboxClaimService / OutboxBackoff / OutboxInbox                                                                                                                                                                                                                                   | singleton | infrastructure/outbox/\*                                             | setupServices.ts                     |
| BackgroundTaskScheduler                                                                                                                                                                                                                                                                                                         | singleton | `@observability/background-scheduler` DefaultBackgroundTaskScheduler | setupServices.ts                     |
| UnitOfWork                                                                                                                                                                                                                                                                                                                      | transient | PrismaUnitOfWork                                                     | setupRepositories.ts                 |
| IntegrationEventPublisher                                                                                                                                                                                                                                                                                                       | singleton | BullMQIntegrationPublisher (opt-in via constructor)                  | setup.ts                             |
| EventSchemaRegistry / UpcasterChain                                                                                                                                                                                                                                                                                             | singleton | infrastructure/integration-events/\*                                 | setupServices.ts                     |
| GetCrossPlatformAnalyticsUseCase / ComparePerformanceUseCase / CalculateROIUseCase                                                                                                                                                                                                                                              | singleton | application/analytics/\*                                             | setupAnalyticsUseCases.ts            |
| CrossPlatformAnalyticsAdapter / PerformanceComparatorAdapter / ROICalculatorAdapter                                                                                                                                                                                                                                             | singleton | infrastructure/adapters/\*                                           | setupServices.ts                     |
| SyncEngine / ContentVersionManager / PlatformContentAdapter                                                                                                                                                                                                                                                                     | singleton | content/\*                                                           | setupServices.ts                     |
| AuthService / MfaService / RbacService / AuditService / ActivityFeedService / AIService / AIServicePort / HttpClientPort / CachePort / RedisCacheManager / AiRequestService / DashboardService / AccountLifecycleService / AccountSessionService / AdminAuthService / TemplateService / TemplateAnalytics / SubscriptionService | singleton | various                                                              | setupServices.ts                     |
| CreateAccountSubscriptionUseCase / ChangeAccountSubscriptionUseCase / UpdatePricingConfigUseCase                                                                                                                                                                                                                                | singleton | application/billing/\*                                               | setupBillingUseCases.ts              |
| WebhookDashboardService / RealtimeWebhookBroadcaster / ProviderService                                                                                                                                                                                                                                                          | singleton | webhooks/ + providers/                                               | setupServices.ts                     |
| ThreadAnalytics                                                                                                                                                                                                                                                                                                                 | singleton | analytics/threadAnalytics.ts                                         | setupServices.ts                     |
| OptimizeContentUseCase / PredictOptimalTimingUseCase                                                                                                                                                                                                                                                                            | singleton | application/ml/\*                                                    | setupServices.ts                     |
| PostsService                                                                                                                                                                                                                                                                                                                    | singleton | posts/postsService.ts                                                | setupServices.ts                     |
| CredentialManager / RateLimitManager                                                                                                                                                                                                                                                                                            | singleton | orchestration/\*                                                     | setupServices.ts                     |
| ProviderCoordinator / ProviderHealthMonitor / ProviderRegistry                                                                                                                                                                                                                                                                  | singleton | orchestration/ + providers/providerRegistry.ts                       | setupServices.ts                     |
| SagaManager                                                                                                                                                                                                                                                                                                                     | singleton | saga/SagaManager.ts                                                  | setupServices.ts                     |
| TrackedLinkRepository / CrisisProjectRepository                                                                                                                                                                                                                                                                                 | singleton | PrismaTrackedLinkRepository / PrismaCrisisProjectRepository          | setupRepositories.ts                 |
| CreateTrackedLinkUseCase / GetTrackedLinkUseCase / GetLinkStatsUseCase / DeleteTrackedLinkUseCase / RedirectAndTrackClickUseCase                                                                                                                                                                                                | singleton | application/links/\*                                                 | setupLinkUseCases.ts                 |
| EnterCrisisModeUseCase / ExitCrisisModeUseCase / GetCrisisStatusUseCase                                                                                                                                                                                                                                                         | singleton | application/crisis/\*                                                | setupCrisisUseCases.ts               |
| TeamMemberRepository                                                                                                                                                                                                                                                                                                            | singleton | PrismaTeamMemberRepository                                           | setupRepositories.ts                 |
| InviteTeamMemberUseCase / GetTeamMembersQuery / UpdateTeamMemberRoleUseCase / RemoveTeamMemberUseCase / SearchTeamMembersQuery                                                                                                                                                                                                  | singleton | application/team/\*                                                  | setupTeamUseCases.ts                 |
| NotifyMentionedUsersService                                                                                                                                                                                                                                                                                                     | singleton | application/mentions/NotifyMentionedUsersService.ts                  | setupServices.ts                     |
| ApprovalRequestRepository / ApprovalWorkflowRepository                                                                                                                                                                                                                                                                          | singleton | PrismaApprovalRequestRepository / PrismaApprovalWorkflowRepository   | setupRepositories.ts                 |
| SubmitForReviewUseCase / ApprovePostUseCase / RejectPostUseCase / GetApprovalHistoryQuery / GetPendingApprovalsQuery / CreateApprovalWorkflowUseCase / UpdateApprovalWorkflowUseCase / DeleteApprovalWorkflowUseCase / ListApprovalWorkflowsQuery                                                                               | singleton | application/approvals/\*                                             | setupUseCases.ts                     |
| NotificationRepository / NotificationPreferenceRepository / NotificationBroadcaster / CreateNotificationUseCase / GetNotificationsQuery / MarkNotificationReadUseCase / MarkAllNotificationsReadUseCase / GetUnreadCountQuery / NotificationEventHandlers                                                                       | singleton | application/notifications/\* + infra                                 | setupNotificationUseCases.ts         |
| PostCommentRepository / CreateCommentUseCase / EditCommentUseCase / DeleteCommentUseCase / GetPostCommentsQuery                                                                                                                                                                                                                 | singleton | application/comments/\*                                              | setupUseCases.ts                     |
| SocialMessage* repos + Ingest/MarkRead/MarkArchived/Assign/SendReply/Resolve/Reopen/SyncProviderComments + Get* queries + InboxEventHandlers                                                                                                                                                                                    | singleton | application/inbox/\*                                                 | setupInboxUseCases.ts                |
| ConversationNoteRepository / AddConversationNoteUseCase / DeleteConversationNoteUseCase / ListConversationNotesQuery                                                                                                                                                                                                            | singleton | application/inbox + repo                                             | setupInboxUseCases.ts                |
| CampaignRepository / CampaignQueryRepository / Create/Update/Archive/TagPost/UntagPost/GetCampaignAnalytics/ListCampaigns/GetCampaign                                                                                                                                                                                           | singleton | application/campaigns/\*                                             | setupUseCases.ts                     |
| FirstCommentRepository / Set/Remove/Get/Publish FirstComment                                                                                                                                                                                                                                                                    | singleton | application/first-comment/\*                                         | setupFirstCommentUseCases.ts         |
| GetHistoricalAnalyticsQuery                                                                                                                                                                                                                                                                                                     | singleton | application/analytics/GetHistoricalAnalyticsQuery.ts                 | setupAnalyticsUseCases.ts            |
| GenerateUTMLinksUseCase / GA4TrackingPort                                                                                                                                                                                                                                                                                       | singleton | application/utm/\* + GA4TrackingAdapter                              | setupUseCases.ts                     |
| ScheduledReportRepository / EmailPort + Create/Update/Delete + List + GenerateReport                                                                                                                                                                                                                                            | singleton | application/reports/\* + ResendEmailAdapter                          | setupUseCases.ts                     |
| ExternalNotificationConfigRepository / ExternalNotifierPort + Configure/List/Delete/Test ExternalNotification + ExternalNotificationDispatcher                                                                                                                                                                                  | singleton | application/external-notifications/\* + infra/adapters               | setupExternalNotificationUseCases.ts |
| GeneratedImageRepository + GenerateImageUseCase + ListGeneratedImagesQuery_AIImage                                                                                                                                                                                                                                              | singleton | application/ai-image/\*                                              | setupAIImageUseCases.ts              |
| RecurringPostRepository + Create/Update/Deactivate/List/Get + ProcessRecurrence + CreatePostFromRecurrence + RecurrenceScheduler                                                                                                                                                                                                | singleton | application/recurring/\* + recurring/RecurrenceScheduler.ts          | setupRecurringPostUseCases.ts        |
| AIPromptTemplateRepository + List/Create/Update/Delete AIPromptTemplate                                                                                                                                                                                                                                                         | singleton | application/aiPromptTemplates/\*                                     | setupAIPromptTemplateUseCases.ts     |
| UsageMetricRepository + IncrementUsage + GetUsage                                                                                                                                                                                                                                                                               | singleton | application/usage/\*                                                 | setupUsageUseCases.ts                |
| BrandVoiceRepository + GetBrandVoice + Upsert/Delete BrandVoice                                                                                                                                                                                                                                                                 | singleton | application/brand-voice/\*                                           | setupBrandVoiceUseCases.ts           |
| BrandKitRepository + GetBrandKit + Upsert/Delete BrandKit                                                                                                                                                                                                                                                                       | singleton | application/brand-kit/\*                                             | setupBrandKitUseCases.ts             |
| SecretRotationLogReadRepository + GetSecretRotationStatusQuery                                                                                                                                                                                                                                                                  | singleton | infrastructure/security + application/security                       | setupSecretsRotationUseCases.ts      |
| UpdateChannelAuthStateUseCase                                                                                                                                                                                                                                                                                                   | singleton | application/channels/UpdateChannelAuthStateUseCase.ts                | setupChannelUseCases.ts              |
| WebhookSubscriptionRotationRepository + RotateWebhookSecretKeyUseCase                                                                                                                                                                                                                                                           | singleton | infra + application/webhooks/\*                                      | setupWebhookAdminUseCases.ts         |
| ReplaceOidcClientSecretUseCase                                                                                                                                                                                                                                                                                                  | singleton | application/auth/ReplaceOidcClientSecretUseCase.ts                   | setupServices.ts                     |
| MassForceReauthByProviderUseCase                                                                                                                                                                                                                                                                                                | singleton | application/providers/MassForceReauthByProviderUseCase.ts            | setupProviderAdminUseCases.ts        |
| IntegrationApiKeyRepository / IntegrationSubscriptionRepository / Generate/Revoke/List Integration ApiKey + Subscribe/Unsubscribe IntegrationTrigger + TriggerIntegrationEventService + IntegrationEventDeliveryHandler                                                                                                         | singleton | application/integrations/_ + integrations/_                          | setupIntegrationUseCases.ts          |
| TaskRepository + Create/Update/Complete/Cancel + List/Get Task                                                                                                                                                                                                                                                                  | singleton | application/tasks/\*                                                 | setupTaskUseCases.ts                 |
| MediaAssetRepository / AssetTagRepository / AssetFolderRepository + 11 asset use cases                                                                                                                                                                                                                                          | singleton | application/assets/\*                                                | setupAssetUseCases.ts                |
| SamlConfigurationRepository + Configure/Enable/Disable/Get SAML                                                                                                                                                                                                                                                                 | singleton | application/auth/\*                                                  | setupSamlUseCases.ts                 |
| OidcConfigurationRepository + Configure/Enable/Disable/Get OIDC                                                                                                                                                                                                                                                                 | singleton | application/auth/\*                                                  | setupSamlUseCases.ts                 |
| CustomReportRepository + 7 custom-report use cases                                                                                                                                                                                                                                                                              | singleton | application/custom-reports/\*                                        | setupCustomReportUseCases.ts         |
| CustomerUserRepository + Register/Login/Refresh/Logout + Request/Reset Password                                                                                                                                                                                                                                                 | singleton | application/customer-auth/\*                                         | setupCustomerAuthUseCases.ts         |
| Crm\* repos + Connect/Disconnect/GetConnections/Sync/LogActivity/GetSyncLogs                                                                                                                                                                                                                                                    | singleton | application/crm/\*                                                   | setupCrmUseCases.ts                  |
| QueuePort / QueuePortRegistry / DeadLetterQueuePort                                                                                                                                                                                                                                                                             | singleton | `@packages/adapters/queue-bullmq`                                    | setupServices.ts                     |
| AnalyticsAggregationQuery                                                                                                                                                                                                                                                                                                       | singleton | PrismaAnalyticsAggregationQuery                                      | setupRepositories.ts                 |
| AnalyticsWriteRepository / ChannelQueryForIngestion + IngestChannelAnalyticsUseCase + DispatchAnalyticsIngestionUseCase                                                                                                                                                                                                         | singleton | infra + application/analytics/\*                                     | setupAnalyticsUseCases.ts            |
| DispatchInboxSyncUseCase                                                                                                                                                                                                                                                                                                        | singleton | application/inbox/DispatchInboxSyncUseCase.ts                        | setupInboxUseCases.ts                |
| PaymentAdapter                                                                                                                                                                                                                                                                                                                  | singleton | resolved via paymentAdapterFactory                                   | setupServices.ts                     |
| GatewayAdapterRegistry / GatewayBillingService / GatewaySwitchJobService                                                                                                                                                                                                                                                        | singleton | infrastructure/billing + billing/\*                                  | setupServices.ts                     |
| ComplianceService / DataRetentionService                                                                                                                                                                                                                                                                                        | singleton | compliance/\*                                                        | setupServices.ts                     |
| DlqArchivalService                                                                                                                                                                                                                                                                                                              | singleton | webhooks/DlqArchivalService.ts                                       | setupServices.ts                     |
| EnableReportSharingUseCase / DisableReportSharingUseCase                                                                                                                                                                                                                                                                        | singleton | application/custom-reports/\*                                        | setupCustomReportUseCases.ts         |
| TopPerformersQueryPort + GetTopPerformersContextUseCase + GeneratePlatformVariantsUseCase + GenerateContentCalendarUseCase                                                                                                                                                                                                      | singleton | infra + application/ai/\*                                            | setupServices.ts                     |
| Convert/GrantReward/Referral/ReferralCode repos + Convert/Grant/Track/GetOrCreate referral                                                                                                                                                                                                                                      | singleton | application/referral/\* + infra                                      | setupReferralUseCases.ts             |
| TriageMessagePort / TriageAIPort / TriageCrmPort + TriageInboxMessageUseCase                                                                                                                                                                                                                                                    | singleton | application/inbox/TriageInboxMessageUseCase.ts + adapters            | setupInboxUseCases.ts                |
| ScoreTrendAIPort / ScoreTrendContextPort + ScoreTrendRelevanceUseCase                                                                                                                                                                                                                                                           | singleton | application/trends/\* + adapters                                     | setupTrendUseCases.ts                |
| Approve/Reject/Detect/GenerateRepurpose variants                                                                                                                                                                                                                                                                                | singleton | application/ai/\*                                                    | setupRepurposeUseCases.ts            |
| EncryptionService / ChannelCredentialsCrypto / PlatformCredentialService                                                                                                                                                                                                                                                        | singleton | security/\*                                                          | setupServices.ts                     |
| SettingsService                                                                                                                                                                                                                                                                                                                 | singleton | settings/SettingsService.ts                                          | setupServices.ts                     |

---

## By directory

> One row per file. `path` is relative to repo root. `tipo` uses the canonical vocabulary from the template. `layer` is the declared `@layer` (all 822/823 declare canonical — only `saga/sagaManagerTypes.ts` is MISSING). For VÁLIDO rows the `notes` cell is empty; for non-VÁLIDO rows the row points to the detailed entry at the end of the doc.

### apps/api/src/ (root)

| Path                                           | Tipo      | Layer          | Veredicto | Notes                                       |
| ---------------------------------------------- | --------- | -------------- | --------- | ------------------------------------------- |
| [apps/api/src/index.ts](apps/api/src/index.ts) | bootstrap | infrastructure | VÁLIDO    | Fastify app entrypoint; registers 73 routes |

### apps/api/src/accounts/

| Path                                                                             | Tipo  | Layer          | Veredicto |
| -------------------------------------------------------------------------------- | ----- | -------------- | --------- |
| [apps/api/src/accounts/accountRoutes.ts](apps/api/src/accounts/accountRoutes.ts) | route | infrastructure | VÁLIDO    |

### apps/api/src/admin/

| Path                                                                                                     | Tipo    | Layer          | Veredicto |
| -------------------------------------------------------------------------------------------------------- | ------- | -------------- | --------- |
| [apps/api/src/admin/accountLifecycleQueryService.ts](apps/api/src/admin/accountLifecycleQueryService.ts) | service | infrastructure | VÁLIDO    |
| [apps/api/src/admin/accountLifecycleRoutes.ts](apps/api/src/admin/accountLifecycleRoutes.ts)             | route   | infrastructure | VÁLIDO    |
| [apps/api/src/admin/accountLifecycleService.ts](apps/api/src/admin/accountLifecycleService.ts)           | service | infrastructure | VÁLIDO    |
| [apps/api/src/admin/accountLifecycleTypes.ts](apps/api/src/admin/accountLifecycleTypes.ts)               | types   | infrastructure | VÁLIDO    |
| [apps/api/src/admin/AccountSessionService.ts](apps/api/src/admin/AccountSessionService.ts)               | service | infrastructure | VÁLIDO    |
| [apps/api/src/admin/adminUserRoutes.ts](apps/api/src/admin/adminUserRoutes.ts)                           | route   | infrastructure | VÁLIDO    |
| [apps/api/src/admin/AnalyticsAccountHandlers.ts](apps/api/src/admin/AnalyticsAccountHandlers.ts)         | service | infrastructure | VÁLIDO    |
| [apps/api/src/admin/AnalyticsComplianceHandlers.ts](apps/api/src/admin/AnalyticsComplianceHandlers.ts)   | service | infrastructure | VÁLIDO    |
| [apps/api/src/admin/AnalyticsDashboardHandlers.ts](apps/api/src/admin/AnalyticsDashboardHandlers.ts)     | service | infrastructure | VÁLIDO    |
| [apps/api/src/admin/AnalyticsHandlers.ts](apps/api/src/admin/AnalyticsHandlers.ts)                       | service | infrastructure | VÁLIDO    |
| [apps/api/src/admin/analyticsRoutes.ts](apps/api/src/admin/analyticsRoutes.ts)                           | route   | infrastructure | VÁLIDO    |
| [apps/api/src/admin/analyticsSchemas.ts](apps/api/src/admin/analyticsSchemas.ts)                         | types   | infrastructure | VÁLIDO    |
| [apps/api/src/admin/apiKeyAdminRoutes.ts](apps/api/src/admin/apiKeyAdminRoutes.ts)                       | route   | infrastructure | VÁLIDO    |
| [apps/api/src/admin/channelReauthRoutes.ts](apps/api/src/admin/channelReauthRoutes.ts)                   | route   | infrastructure | VÁLIDO    |
| [apps/api/src/admin/dashboardRoutes.ts](apps/api/src/admin/dashboardRoutes.ts)                           | route   | infrastructure | VÁLIDO    |
| [apps/api/src/admin/dashboardService.ts](apps/api/src/admin/dashboardService.ts)                         | service | infrastructure | VÁLIDO    |
| [apps/api/src/admin/massReauthRoutes.ts](apps/api/src/admin/massReauthRoutes.ts)                         | route   | infrastructure | VÁLIDO    |
| [apps/api/src/admin/oidcAdminRoutes.ts](apps/api/src/admin/oidcAdminRoutes.ts)                           | route   | infrastructure | VÁLIDO    |
| [apps/api/src/admin/pricingRoutes.ts](apps/api/src/admin/pricingRoutes.ts)                               | route   | infrastructure | VÁLIDO    |
| [apps/api/src/admin/queueRoutes.ts](apps/api/src/admin/queueRoutes.ts)                                   | route   | infrastructure | VÁLIDO    |
| [apps/api/src/admin/SchedulingPostHandlers.ts](apps/api/src/admin/SchedulingPostHandlers.ts)             | service | infrastructure | VÁLIDO    |
| [apps/api/src/admin/schedulingRoutes.ts](apps/api/src/admin/schedulingRoutes.ts)                         | route   | infrastructure | VÁLIDO    |
| [apps/api/src/admin/schedulingSchemas.ts](apps/api/src/admin/schedulingSchemas.ts)                       | types   | infrastructure | VÁLIDO    |
| [apps/api/src/admin/SchedulingSlotHandlers.ts](apps/api/src/admin/SchedulingSlotHandlers.ts)             | service | infrastructure | VÁLIDO    |
| [apps/api/src/admin/secretsRotationRoutes.ts](apps/api/src/admin/secretsRotationRoutes.ts)               | route   | infrastructure | VÁLIDO    |
| [apps/api/src/admin/webhookAdminRoutes.ts](apps/api/src/admin/webhookAdminRoutes.ts)                     | route   | infrastructure | VÁLIDO    |

### apps/api/src/admin/auth/

| Path                                                                                               | Tipo       | Layer          | Veredicto |
| -------------------------------------------------------------------------------------------------- | ---------- | -------------- | --------- |
| [apps/api/src/admin/auth/adminAuthConfig.ts](apps/api/src/admin/auth/adminAuthConfig.ts)           | config     | infrastructure | VÁLIDO    |
| [apps/api/src/admin/auth/adminAuthMiddleware.ts](apps/api/src/admin/auth/adminAuthMiddleware.ts)   | middleware | infrastructure | VÁLIDO    |
| [apps/api/src/admin/auth/adminAuthRoutes.ts](apps/api/src/admin/auth/adminAuthRoutes.ts)           | route      | infrastructure | VÁLIDO    |
| [apps/api/src/admin/auth/adminAuthSchemas.ts](apps/api/src/admin/auth/adminAuthSchemas.ts)         | types      | infrastructure | VÁLIDO    |
| [apps/api/src/admin/auth/AdminAuthService.ts](apps/api/src/admin/auth/AdminAuthService.ts)         | service    | infrastructure | VÁLIDO    |
| [apps/api/src/admin/auth/adminAuthTypes.ts](apps/api/src/admin/auth/adminAuthTypes.ts)             | types      | infrastructure | VÁLIDO    |
| [apps/api/src/admin/auth/BruteForceProtection.ts](apps/api/src/admin/auth/BruteForceProtection.ts) | security   | infrastructure | VÁLIDO    |
| [apps/api/src/admin/auth/MfaService.ts](apps/api/src/admin/auth/MfaService.ts)                     | security   | infrastructure | VÁLIDO    |
| [apps/api/src/admin/auth/PasswordService.ts](apps/api/src/admin/auth/PasswordService.ts)           | security   | infrastructure | VÁLIDO    |
| [apps/api/src/admin/auth/SessionManager.ts](apps/api/src/admin/auth/SessionManager.ts)             | service    | infrastructure | VÁLIDO    |
| [apps/api/src/admin/auth/TokenService.ts](apps/api/src/admin/auth/TokenService.ts)                 | security   | infrastructure | VÁLIDO    |

### apps/api/src/ai/ + apps/api/src/ai-image/

| Path                                                                               | Tipo     | Layer          | Veredicto |
| ---------------------------------------------------------------------------------- | -------- | -------------- | --------- |
| [apps/api/src/ai/AIProviderFactory.ts](apps/api/src/ai/AIProviderFactory.ts)       | service  | infrastructure | VÁLIDO    |
| [apps/api/src/ai/AiRequestService.ts](apps/api/src/ai/AiRequestService.ts)         | service  | infrastructure | VÁLIDO    |
| [apps/api/src/ai/aiService.ts](apps/api/src/ai/aiService.ts)                       | service  | infrastructure | VÁLIDO    |
| [apps/api/src/ai/orchestrator.ts](apps/api/src/ai/orchestrator.ts)                 | service  | infrastructure | VÁLIDO    |
| [apps/api/src/ai/promptTemplateRoutes.ts](apps/api/src/ai/promptTemplateRoutes.ts) | route    | infrastructure | VÁLIDO    |
| [apps/api/src/ai/providers/anthropic.ts](apps/api/src/ai/providers/anthropic.ts)   | provider | infrastructure | VÁLIDO    |
| [apps/api/src/ai/providers/gemini.ts](apps/api/src/ai/providers/gemini.ts)         | provider | infrastructure | VÁLIDO    |
| [apps/api/src/ai/providers/openai.ts](apps/api/src/ai/providers/openai.ts)         | provider | infrastructure | VÁLIDO    |
| [apps/api/src/ai/providers/perplexity.ts](apps/api/src/ai/providers/perplexity.ts) | provider | infrastructure | VÁLIDO    |
| [apps/api/src/ai/routes.ts](apps/api/src/ai/routes.ts)                             | route    | infrastructure | VÁLIDO    |
| [apps/api/src/ai/types.ts](apps/api/src/ai/types.ts)                               | types    | infrastructure | VÁLIDO    |
| [apps/api/src/ai-image/aiImageRoutes.ts](apps/api/src/ai-image/aiImageRoutes.ts)   | route    | infrastructure | VÁLIDO    |

### apps/api/src/analytics/

| Path                                                                                                                                     | Tipo    | Layer          | Veredicto                       |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------- | ------------------------------- |
| [apps/api/src/analytics/analyticsRoutes.ts](apps/api/src/analytics/analyticsRoutes.ts)                                                   | route   | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/analyticsUtils.ts](apps/api/src/analytics/analyticsUtils.ts)                                                     | service | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/crossPlatform/competitiveAnalyzer.ts](apps/api/src/analytics/crossPlatform/competitiveAnalyzer.ts)               | service | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/crossPlatform/contentAnalyzer.ts](apps/api/src/analytics/crossPlatform/contentAnalyzer.ts)                       | service | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/crossPlatform/ContentMetricsAnalyzer.ts](apps/api/src/analytics/crossPlatform/ContentMetricsAnalyzer.ts)         | service | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/crossPlatform/dataFetcher.ts](apps/api/src/analytics/crossPlatform/dataFetcher.ts)                               | service | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/crossPlatform/HashtagTimingAnalyzer.ts](apps/api/src/analytics/crossPlatform/HashtagTimingAnalyzer.ts)           | service | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/crossPlatform/index.ts](apps/api/src/analytics/crossPlatform/index.ts)                                           | barrel  | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/crossPlatform/PerformanceAnalyzer.ts](apps/api/src/analytics/crossPlatform/PerformanceAnalyzer.ts)               | service | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/crossPlatform/recommendationEngine.ts](apps/api/src/analytics/crossPlatform/recommendationEngine.ts)             | service | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/crossPlatform/summaryGenerator.ts](apps/api/src/analytics/crossPlatform/summaryGenerator.ts)                     | service | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/crossPlatform/trendAnalyzer.ts](apps/api/src/analytics/crossPlatform/trendAnalyzer.ts)                           | service | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/crossPlatform/types.ts](apps/api/src/analytics/crossPlatform/types.ts)                                           | types   | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/engagementPredictor.config.ts](apps/api/src/analytics/engagementPredictor.config.ts)                             | config  | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/engagementPredictor.factors.ts](apps/api/src/analytics/engagementPredictor.factors.ts)                           | service | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/engagementPredictor.scoring.ts](apps/api/src/analytics/engagementPredictor.scoring.ts)                           | service | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/engagementPredictor.ts](apps/api/src/analytics/engagementPredictor.ts)                                           | service | infrastructure | UNKNOWN — verify caller surface |
| [apps/api/src/analytics/performanceComparison/benchmarkGenerator.ts](apps/api/src/analytics/performanceComparison/benchmarkGenerator.ts) | service | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/performanceComparison/index.ts](apps/api/src/analytics/performanceComparison/index.ts)                           | barrel  | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/performanceComparison/snapshotGenerator.ts](apps/api/src/analytics/performanceComparison/snapshotGenerator.ts)   | service | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/performanceComparison/trendAnalyzer.ts](apps/api/src/analytics/performanceComparison/trendAnalyzer.ts)           | service | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/performanceComparison/types.ts](apps/api/src/analytics/performanceComparison/types.ts)                           | types   | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/realtimeAnalytics.ts](apps/api/src/analytics/realtimeAnalytics.ts)                                               | service | infrastructure | UNKNOWN — verify caller surface |
| [apps/api/src/analytics/roiCalculator.ts](apps/api/src/analytics/roiCalculator.ts)                                                       | service | infrastructure | UNKNOWN — overlaps roi/ subdir? |
| [apps/api/src/analytics/roi/CostCalculator.ts](apps/api/src/analytics/roi/CostCalculator.ts)                                             | service | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/roi/RevenueCalculator.ts](apps/api/src/analytics/roi/RevenueCalculator.ts)                                       | service | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/roi/ROIForecasting.ts](apps/api/src/analytics/roi/ROIForecasting.ts)                                             | service | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/roi/ROIMetrics.ts](apps/api/src/analytics/roi/ROIMetrics.ts)                                                     | service | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/roi/ROIRecommendations.ts](apps/api/src/analytics/roi/ROIRecommendations.ts)                                     | service | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/roi/types.ts](apps/api/src/analytics/roi/types.ts)                                                               | types   | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/threadAnalytics.ts](apps/api/src/analytics/threadAnalytics.ts)                                                   | service | infrastructure | VÁLIDO                          |
| [apps/api/src/analytics/types.ts](apps/api/src/analytics/types.ts)                                                                       | types   | infrastructure | VÁLIDO                          |

### apps/api/src/announcements/, approvals/, assets/, audit/, brand-kit/, brand-voice/, campaigns/, channels/, comments/

| Path                                                                                                 | Tipo       | Layer          | Veredicto |
| ---------------------------------------------------------------------------------------------------- | ---------- | -------------- | --------- |
| [apps/api/src/announcements/announcementRoutes.ts](apps/api/src/announcements/announcementRoutes.ts) | route      | infrastructure | VÁLIDO    |
| [apps/api/src/approvals/approvalRoutes.ts](apps/api/src/approvals/approvalRoutes.ts)                 | route      | infrastructure | VÁLIDO    |
| [apps/api/src/approvals/approvalWorkflowRoutes.ts](apps/api/src/approvals/approvalWorkflowRoutes.ts) | route      | infrastructure | VÁLIDO    |
| [apps/api/src/assets/assetRoutes.ts](apps/api/src/assets/assetRoutes.ts)                             | route      | infrastructure | VÁLIDO    |
| [apps/api/src/audit/activityFeedRoutes.ts](apps/api/src/audit/activityFeedRoutes.ts)                 | route      | infrastructure | VÁLIDO    |
| [apps/api/src/audit/activityFeedService.ts](apps/api/src/audit/activityFeedService.ts)               | service    | infrastructure | VÁLIDO    |
| [apps/api/src/audit/auditMiddleware.ts](apps/api/src/audit/auditMiddleware.ts)                       | middleware | infrastructure | VÁLIDO    |
| [apps/api/src/audit/auditRoutes.ts](apps/api/src/audit/auditRoutes.ts)                               | route      | infrastructure | VÁLIDO    |
| [apps/api/src/audit/auditService.ts](apps/api/src/audit/auditService.ts)                             | service    | infrastructure | VÁLIDO    |
| [apps/api/src/brand-kit/brandKitRoutes.ts](apps/api/src/brand-kit/brandKitRoutes.ts)                 | route      | infrastructure | VÁLIDO    |
| [apps/api/src/brand-voice/brandVoiceRoutes.ts](apps/api/src/brand-voice/brandVoiceRoutes.ts)         | route      | infrastructure | VÁLIDO    |
| [apps/api/src/campaigns/campaignRoutes.ts](apps/api/src/campaigns/campaignRoutes.ts)                 | route      | infrastructure | VÁLIDO    |
| [apps/api/src/channels/channelRoutes.ts](apps/api/src/channels/channelRoutes.ts)                     | route      | infrastructure | VÁLIDO    |
| [apps/api/src/comments/commentRoutes.ts](apps/api/src/comments/commentRoutes.ts)                     | route      | infrastructure | VÁLIDO    |

### apps/api/src/auth/

| Path                                                                                             | Tipo       | Layer          | Veredicto |
| ------------------------------------------------------------------------------------------------ | ---------- | -------------- | --------- |
| [apps/api/src/auth/apiKeyRoutes.ts](apps/api/src/auth/apiKeyRoutes.ts)                           | route      | infrastructure | VÁLIDO    |
| [apps/api/src/auth/authRoutes.ts](apps/api/src/auth/authRoutes.ts)                               | route      | infrastructure | VÁLIDO    |
| [apps/api/src/auth/authServiceCore.ts](apps/api/src/auth/authServiceCore.ts)                     | service    | infrastructure | VÁLIDO    |
| [apps/api/src/auth/authServiceSession.ts](apps/api/src/auth/authServiceSession.ts)               | service    | infrastructure | VÁLIDO    |
| [apps/api/src/auth/authService.ts](apps/api/src/auth/authService.ts)                             | service    | infrastructure | VÁLIDO    |
| [apps/api/src/auth/authTypes.ts](apps/api/src/auth/authTypes.ts)                                 | types      | infrastructure | VÁLIDO    |
| [apps/api/src/auth/bruteForceProtection.ts](apps/api/src/auth/bruteForceProtection.ts)           | security   | infrastructure | VÁLIDO    |
| [apps/api/src/auth/customerAuthMiddleware.ts](apps/api/src/auth/customerAuthMiddleware.ts)       | middleware | infrastructure | VÁLIDO    |
| [apps/api/src/auth/customerAuthRoutes.ts](apps/api/src/auth/customerAuthRoutes.ts)               | route      | infrastructure | VÁLIDO    |
| [apps/api/src/auth/customerJwt.ts](apps/api/src/auth/customerJwt.ts)                             | security   | infrastructure | VÁLIDO    |
| [apps/api/src/auth/deviceFingerprint.ts](apps/api/src/auth/deviceFingerprint.ts)                 | security   | infrastructure | VÁLIDO    |
| [apps/api/src/auth/integrationAuthMiddleware.ts](apps/api/src/auth/integrationAuthMiddleware.ts) | middleware | infrastructure | VÁLIDO    |
| [apps/api/src/auth/mfaRoutes.ts](apps/api/src/auth/mfaRoutes.ts)                                 | route      | infrastructure | VÁLIDO    |
| [apps/api/src/auth/mfaService.ts](apps/api/src/auth/mfaService.ts)                               | security   | infrastructure | VÁLIDO    |
| [apps/api/src/auth/oidcRoutes.ts](apps/api/src/auth/oidcRoutes.ts)                               | route      | infrastructure | VÁLIDO    |
| [apps/api/src/auth/passwordHashing.ts](apps/api/src/auth/passwordHashing.ts)                     | security   | infrastructure | VÁLIDO    |
| [apps/api/src/auth/providerOAuthConfigs.ts](apps/api/src/auth/providerOAuthConfigs.ts)           | config     | infrastructure | VÁLIDO    |
| [apps/api/src/auth/providerOAuthFlow.ts](apps/api/src/auth/providerOAuthFlow.ts)                 | security   | infrastructure | VÁLIDO    |
| [apps/api/src/auth/providerOAuth.ts](apps/api/src/auth/providerOAuth.ts)                         | route      | infrastructure | VÁLIDO    |
| [apps/api/src/auth/rbacMiddleware.ts](apps/api/src/auth/rbacMiddleware.ts)                       | middleware | infrastructure | VÁLIDO    |
| [apps/api/src/auth/rbacRoutes.ts](apps/api/src/auth/rbacRoutes.ts)                               | route      | infrastructure | VÁLIDO    |
| [apps/api/src/auth/rbacService.ts](apps/api/src/auth/rbacService.ts)                             | service    | infrastructure | VÁLIDO    |
| [apps/api/src/auth/redisSessionHelpers.ts](apps/api/src/auth/redisSessionHelpers.ts)             | service    | infrastructure | VÁLIDO    |
| [apps/api/src/auth/refreshTokenHash.ts](apps/api/src/auth/refreshTokenHash.ts)                   | security   | infrastructure | VÁLIDO    |
| [apps/api/src/auth/roleManagementService.ts](apps/api/src/auth/roleManagementService.ts)         | service    | infrastructure | VÁLIDO    |
| [apps/api/src/auth/samlRoutes.ts](apps/api/src/auth/samlRoutes.ts)                               | route      | infrastructure | VÁLIDO    |

### apps/api/src/billing/

| Path                                                                                                                                     | Tipo      | Layer          | Veredicto |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------- | --------- |
| [apps/api/src/billing/adminBillingRoutes.ts](apps/api/src/billing/adminBillingRoutes.ts)                                                 | route     | infrastructure | VÁLIDO    |
| [apps/api/src/billing/billingWebhookRoutes.ts](apps/api/src/billing/billingWebhookRoutes.ts)                                             | route     | infrastructure | VÁLIDO    |
| [apps/api/src/billing/clientBillingRoutes.ts](apps/api/src/billing/clientBillingRoutes.ts)                                               | route     | infrastructure | VÁLIDO    |
| [apps/api/src/billing/GatewayBillingService.ts](apps/api/src/billing/GatewayBillingService.ts)                                           | service   | application    | VÁLIDO    |
| [apps/api/src/billing/GatewaySwitchJobService.ts](apps/api/src/billing/GatewaySwitchJobService.ts)                                       | service   | application    | VÁLIDO    |
| [apps/api/src/billing/gatewaySwitchProcessor.ts](apps/api/src/billing/gatewaySwitchProcessor.ts)                                         | processor | infrastructure | VÁLIDO    |
| [apps/api/src/billing/gatewaySwitchSchemas.ts](apps/api/src/billing/gatewaySwitchSchemas.ts)                                             | types     | infrastructure | VÁLIDO    |
| [apps/api/src/billing/handlers/index.ts](apps/api/src/billing/handlers/index.ts)                                                         | barrel    | infrastructure | VÁLIDO    |
| [apps/api/src/billing/handlers/SubscriptionAccountHandler.ts](apps/api/src/billing/handlers/SubscriptionAccountHandler.ts)               | service   | application    | VÁLIDO    |
| [apps/api/src/billing/handlers/SubscriptionAnalyticsHandler.ts](apps/api/src/billing/handlers/SubscriptionAnalyticsHandler.ts)           | service   | application    | VÁLIDO    |
| [apps/api/src/billing/handlers/SubscriptionPlanHandler.ts](apps/api/src/billing/handlers/SubscriptionPlanHandler.ts)                     | service   | application    | VÁLIDO    |
| [apps/api/src/billing/handlers/SubscriptionTrialHandler.ts](apps/api/src/billing/handlers/SubscriptionTrialHandler.ts)                   | service   | application    | VÁLIDO    |
| [apps/api/src/billing/subscription/BillingService.ts](apps/api/src/billing/subscription/BillingService.ts)                               | service   | application    | VÁLIDO    |
| [apps/api/src/billing/subscription/index.ts](apps/api/src/billing/subscription/index.ts)                                                 | barrel    | infrastructure | VÁLIDO    |
| [apps/api/src/billing/subscriptionRoutes.ts](apps/api/src/billing/subscriptionRoutes.ts)                                                 | route     | infrastructure | VÁLIDO    |
| [apps/api/src/billing/subscriptionSchemas.ts](apps/api/src/billing/subscriptionSchemas.ts)                                               | types     | infrastructure | VÁLIDO    |
| [apps/api/src/billing/subscriptionService.ts](apps/api/src/billing/subscriptionService.ts)                                               | service   | application    | VÁLIDO    |
| [apps/api/src/billing/subscription/SubscriptionManagementService.ts](apps/api/src/billing/subscription/SubscriptionManagementService.ts) | service   | application    | VÁLIDO    |
| [apps/api/src/billing/subscription/SubscriptionPlanService.ts](apps/api/src/billing/subscription/SubscriptionPlanService.ts)             | service   | application    | VÁLIDO    |
| [apps/api/src/billing/subscription/SubscriptionStatsService.ts](apps/api/src/billing/subscription/SubscriptionStatsService.ts)           | service   | application    | VÁLIDO    |
| [apps/api/src/billing/subscription/TrialManagementService.ts](apps/api/src/billing/subscription/TrialManagementService.ts)               | service   | application    | VÁLIDO    |
| [apps/api/src/billing/subscription/types.ts](apps/api/src/billing/subscription/types.ts)                                                 | types     | infrastructure | VÁLIDO    |

### apps/api/src/cache/, compliance/, config/, content/

| Path                                                                                                                 | Tipo    | Layer          | Veredicto |
| -------------------------------------------------------------------------------------------------------------------- | ------- | -------------- | --------- |
| [apps/api/src/compliance/complianceRoutes.ts](apps/api/src/compliance/complianceRoutes.ts)                           | route   | infrastructure | VÁLIDO    |
| [apps/api/src/compliance/complianceSchemas.ts](apps/api/src/compliance/complianceSchemas.ts)                         | types   | infrastructure | VÁLIDO    |
| [apps/api/src/compliance/ComplianceService.ts](apps/api/src/compliance/ComplianceService.ts)                         | service | application    | VÁLIDO    |
| [apps/api/src/compliance/DataRetentionService.ts](apps/api/src/compliance/DataRetentionService.ts)                   | service | application    | VÁLIDO    |
| [apps/api/src/config/env.ts](apps/api/src/config/env.ts)                                                             | config  | infrastructure | VÁLIDO    |
| [apps/api/src/content/BranchManager.ts](apps/api/src/content/BranchManager.ts)                                       | service | infrastructure | VÁLIDO    |
| [apps/api/src/content/ConflictDetector.ts](apps/api/src/content/ConflictDetector.ts)                                 | service | infrastructure | VÁLIDO    |
| [apps/api/src/content/ContentHandlers.ts](apps/api/src/content/ContentHandlers.ts)                                   | service | infrastructure | VÁLIDO    |
| [apps/api/src/content/contentRoutes.ts](apps/api/src/content/contentRoutes.ts)                                       | route   | infrastructure | VÁLIDO    |
| [apps/api/src/content/ContentVersionManager.ts](apps/api/src/content/ContentVersionManager.ts)                       | service | infrastructure | VÁLIDO    |
| [apps/api/src/content/contentVersionTypes.ts](apps/api/src/content/contentVersionTypes.ts)                           | types   | infrastructure | VÁLIDO    |
| [apps/api/src/content/DiffCalculator.ts](apps/api/src/content/DiffCalculator.ts)                                     | service | infrastructure | VÁLIDO    |
| [apps/api/src/content/MergeManager.ts](apps/api/src/content/MergeManager.ts)                                         | service | infrastructure | VÁLIDO    |
| [apps/api/src/content/PlatformContentAdapterCore.ts](apps/api/src/content/PlatformContentAdapterCore.ts)             | adapter | infrastructure | VÁLIDO    |
| [apps/api/src/content/platformContentAdapterHelpers.ts](apps/api/src/content/platformContentAdapterHelpers.ts)       | adapter | infrastructure | VÁLIDO    |
| [apps/api/src/content/PlatformContentAdapterStrategy.ts](apps/api/src/content/PlatformContentAdapterStrategy.ts)     | adapter | infrastructure | VÁLIDO    |
| [apps/api/src/content/PlatformContentAdapter.ts](apps/api/src/content/PlatformContentAdapter.ts)                     | adapter | infrastructure | VÁLIDO    |
| [apps/api/src/content/platformContentAdapterTypes.ts](apps/api/src/content/platformContentAdapterTypes.ts)           | types   | infrastructure | VÁLIDO    |
| [apps/api/src/content/PlatformContentAdapterValidation.ts](apps/api/src/content/PlatformContentAdapterValidation.ts) | adapter | infrastructure | VÁLIDO    |
| [apps/api/src/content/SyncEngineBase.ts](apps/api/src/content/SyncEngineBase.ts)                                     | service | infrastructure | VÁLIDO    |
| [apps/api/src/content/SyncEngineImpl.ts](apps/api/src/content/SyncEngineImpl.ts)                                     | service | infrastructure | VÁLIDO    |
| [apps/api/src/content/SyncEngine.ts](apps/api/src/content/SyncEngine.ts)                                             | service | infrastructure | VÁLIDO    |
| [apps/api/src/content/syncEngineTypes.ts](apps/api/src/content/syncEngineTypes.ts)                                   | types   | infrastructure | VÁLIDO    |
| [apps/api/src/content/SyncScheduler.ts](apps/api/src/content/SyncScheduler.ts)                                       | service | infrastructure | VÁLIDO    |
| [apps/api/src/content/VersionController.ts](apps/api/src/content/VersionController.ts)                               | service | infrastructure | VÁLIDO    |

### apps/api/src/cqrs/

| Path                                                                                                             | Tipo            | Layer          | Veredicto                                            |
| ---------------------------------------------------------------------------------------------------------------- | --------------- | -------------- | ---------------------------------------------------- |
| [apps/api/src/cqrs/CQRSBus.ts](apps/api/src/cqrs/CQRSBus.ts)                                                     | service         | infrastructure | VÁLIDO                                               |
| [apps/api/src/cqrs/CQRSIntegration.ts](apps/api/src/cqrs/CQRSIntegration.ts)                                     | service         | infrastructure | VÁLIDO                                               |
| [apps/api/src/cqrs/handlers/PostCommandHandlers.ts](apps/api/src/cqrs/handlers/PostCommandHandlers.ts)           | command-handler | infrastructure | VÁLIDO — saga canon-by-construction (CLAUDE.md note) |
| [apps/api/src/cqrs/handlers/PostQueryGetList.ts](apps/api/src/cqrs/handlers/PostQueryGetList.ts)                 | query-handler   | infrastructure | VÁLIDO                                               |
| [apps/api/src/cqrs/handlers/PostQueryHandlers.ts](apps/api/src/cqrs/handlers/PostQueryHandlers.ts)               | query-handler   | infrastructure | VÁLIDO                                               |
| [apps/api/src/cqrs/handlers/PostQuerySearchAnalytics.ts](apps/api/src/cqrs/handlers/PostQuerySearchAnalytics.ts) | query-handler   | infrastructure | VÁLIDO                                               |

### apps/api/src/crm/, custom-reports/, database/, external-notifications/, first-comment/, health/, inbox/, links/, mappers/

| Path                                                                                                                                   | Tipo          | Layer          | Veredicto                                  |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------- | ------------------------------------------ |
| [apps/api/src/crm/crmRoutes.ts](apps/api/src/crm/crmRoutes.ts)                                                                         | route         | infrastructure | VÁLIDO                                     |
| [apps/api/src/custom-reports/customReportRoutes.ts](apps/api/src/custom-reports/customReportRoutes.ts)                                 | route         | infrastructure | VÁLIDO                                     |
| [apps/api/src/database/DatabaseOptimizer.ts](apps/api/src/database/DatabaseOptimizer.ts)                                               | service       | infrastructure | **REDUNDANTE** — see detailed entry        |
| [apps/api/src/external-notifications/externalNotificationRoutes.ts](apps/api/src/external-notifications/externalNotificationRoutes.ts) | route         | infrastructure | VÁLIDO                                     |
| [apps/api/src/first-comment/firstCommentRoutes.ts](apps/api/src/first-comment/firstCommentRoutes.ts)                                   | route         | infrastructure | VÁLIDO                                     |
| [apps/api/src/health/healthMetrics.ts](apps/api/src/health/healthMetrics.ts)                                                           | observability | infrastructure | VÁLIDO                                     |
| [apps/api/src/health/healthRoutes.ts](apps/api/src/health/healthRoutes.ts)                                                             | route         | infrastructure | VÁLIDO                                     |
| [apps/api/src/inbox/conversationNoteRoutes.ts](apps/api/src/inbox/conversationNoteRoutes.ts)                                           | route         | infrastructure | VÁLIDO                                     |
| [apps/api/src/inbox/inboxRoutes.ts](apps/api/src/inbox/inboxRoutes.ts)                                                                 | route         | infrastructure | VÁLIDO                                     |
| [apps/api/src/links/linkRoutes.ts](apps/api/src/links/linkRoutes.ts)                                                                   | route         | infrastructure | VÁLIDO                                     |
| [apps/api/src/mappers/AccountMapper.ts](apps/api/src/mappers/AccountMapper.ts)                                                         | service       | infrastructure | **DEAD** — no callers (see detailed entry) |

### apps/api/src/domain/

| Path                                                                                                                     | Tipo            | Layer  | Veredicto                                                      |
| ------------------------------------------------------------------------------------------------------------------------ | --------------- | ------ | -------------------------------------------------------------- |
| [apps/api/src/domain/aggregates/AggregateRoot.ts](apps/api/src/domain/aggregates/AggregateRoot.ts)                       | aggregate       | domain | VÁLIDO                                                         |
| [apps/api/src/domain/aggregates/ApprovalRequestAggregate.ts](apps/api/src/domain/aggregates/ApprovalRequestAggregate.ts) | aggregate       | domain | VÁLIDO                                                         |
| [apps/api/src/domain/aggregates/index.ts](apps/api/src/domain/aggregates/index.ts)                                       | barrel          | domain | VÁLIDO                                                         |
| [apps/api/src/domain/aggregates/PostAggregate.ts](apps/api/src/domain/aggregates/PostAggregate.ts)                       | aggregate       | domain | VÁLIDO                                                         |
| [apps/api/src/domain/aggregates/PostCommentAggregate.ts](apps/api/src/domain/aggregates/PostCommentAggregate.ts)         | aggregate       | domain | VÁLIDO                                                         |
| [apps/api/src/domain/aggregates/SocialMessageAggregate.ts](apps/api/src/domain/aggregates/SocialMessageAggregate.ts)     | aggregate       | domain | VÁLIDO                                                         |
| [apps/api/src/domain/ai/PlatformContentProfile.ts](apps/api/src/domain/ai/PlatformContentProfile.ts)                     | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/analytics/ReportSchema.ts](apps/api/src/domain/analytics/ReportSchema.ts)                           | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/billing/PricingCalculator.ts](apps/api/src/domain/billing/PricingCalculator.ts)                     | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/Account.ts](apps/api/src/domain/entities/Account.ts)                                       | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/ApprovalWorkflow.ts](apps/api/src/domain/entities/ApprovalWorkflow.ts)                     | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/BrandKit.ts](apps/api/src/domain/entities/BrandKit.ts)                                     | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/Campaign.ts](apps/api/src/domain/entities/Campaign.ts)                                     | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/Channel.ts](apps/api/src/domain/entities/Channel.ts)                                       | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/ConversationNote.ts](apps/api/src/domain/entities/ConversationNote.ts)                     | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/CrmConnection.ts](apps/api/src/domain/entities/CrmConnection.ts)                           | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/CustomerUser.ts](apps/api/src/domain/entities/CustomerUser.ts)                             | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/CustomReport.ts](apps/api/src/domain/entities/CustomReport.ts)                             | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/Entity.ts](apps/api/src/domain/entities/Entity.ts)                                         | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/index.ts](apps/api/src/domain/entities/index.ts)                                           | barrel          | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/IntegrationApiKey.ts](apps/api/src/domain/entities/IntegrationApiKey.ts)                   | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/IntegrationSubscription.ts](apps/api/src/domain/entities/IntegrationSubscription.ts)       | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/LinkClick.ts](apps/api/src/domain/entities/LinkClick.ts)                                   | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/MediaAsset.ts](apps/api/src/domain/entities/MediaAsset.ts)                                 | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/Notification.ts](apps/api/src/domain/entities/Notification.ts)                             | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/OidcConfiguration.ts](apps/api/src/domain/entities/OidcConfiguration.ts)                   | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/Project.ts](apps/api/src/domain/entities/Project.ts)                                       | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/RecurringPost.ts](apps/api/src/domain/entities/RecurringPost.ts)                           | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/SamlConfiguration.ts](apps/api/src/domain/entities/SamlConfiguration.ts)                   | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/ScheduledReport.ts](apps/api/src/domain/entities/ScheduledReport.ts)                       | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/SocialConversation.ts](apps/api/src/domain/entities/SocialConversation.ts)                 | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/Task.ts](apps/api/src/domain/entities/Task.ts)                                             | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/TeamMember.ts](apps/api/src/domain/entities/TeamMember.ts)                                 | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/entities/TrackedLink.ts](apps/api/src/domain/entities/TrackedLink.ts)                               | domain-entity   | domain | VÁLIDO                                                         |
| [apps/api/src/domain/errors/DomainError.ts](apps/api/src/domain/errors/DomainError.ts)                                   | service         | domain | VÁLIDO                                                         |
| [apps/api/src/domain/errors/index.ts](apps/api/src/domain/errors/index.ts)                                               | barrel          | domain | VÁLIDO                                                         |
| [apps/api/src/domain/events/DomainEvent.ts](apps/api/src/domain/events/DomainEvent.ts)                                   | domain-event    | domain | VÁLIDO                                                         |
| [apps/api/src/domain/events/index.ts](apps/api/src/domain/events/index.ts)                                               | barrel          | domain | VÁLIDO                                                         |
| [apps/api/src/domain/events/PostEvents.ts](apps/api/src/domain/events/PostEvents.ts)                                     | domain-event    | domain | VÁLIDO                                                         |
| [apps/api/src/domain/events/ProjectEvents.ts](apps/api/src/domain/events/ProjectEvents.ts)                               | domain-event    | domain | VÁLIDO                                                         |
| [apps/api/src/domain/index.ts](apps/api/src/domain/index.ts)                                                             | barrel          | domain | VÁLIDO                                                         |
| [apps/api/src/domain/repositories/\*.ts](../../apps/api/src/domain/repositories/)                                        | repository-port | domain | VÁLIDO — 59 port interfaces, each bound to a Prisma\* impl     |
| [apps/api/src/domain/security/rotationStatusRules.ts](apps/api/src/domain/security/rotationStatusRules.ts)               | service         | domain | VÁLIDO                                                         |
| [apps/api/src/domain/security/secretCatalog.ts](apps/api/src/domain/security/secretCatalog.ts)                           | service         | domain | VÁLIDO                                                         |
| [apps/api/src/domain/services/index.ts](apps/api/src/domain/services/index.ts)                                           | barrel          | domain | VÁLIDO                                                         |
| [apps/api/src/domain/services/MentionParser.ts](apps/api/src/domain/services/MentionParser.ts)                           | service         | domain | VÁLIDO                                                         |
| [apps/api/src/domain/value-objects/\*.ts](../../apps/api/src/domain/value-objects/)                                      | value-object    | domain | VÁLIDO — 22 value objects (IDs, statuses, content, scheduling) |

### apps/api/src/application/

> 219 files. Format: every UseCase / Query lives under a feature folder; all are registered in `infrastructure/container/setup*UseCases.ts`. Sampling verified ≥90% wiring; remaining classified UNKNOWN below.

| Path                                                                       | Tipo               | Layer       | Veredicto                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------- | ------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [apps/api/src/application/UseCase.ts](apps/api/src/application/UseCase.ts) | service            | application | VÁLIDO — base class                                                                                                                                                                                                                 |
| [apps/api/src/application/index.ts](apps/api/src/application/index.ts)     | barrel             | application | VÁLIDO                                                                                                                                                                                                                              |
| application/ai/\*.ts (7 files)                                             | use-case           | application | VÁLIDO — ApproveRepurposeVariant / DetectRepurposeCandidates / GeneratePlatformVariants / GenerateContentCalendar / GenerateRepurposeVariants / GetTopPerformersContext / RejectRepurposeVariant + buildEnhancedSystemPrompt helper |
| application/ai-image/\*.ts (2 files)                                       | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/aiPromptTemplates/\*.ts (5 files)                              | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/analytics/\*.ts (8 files)                                      | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/apiKeys/\*.ts (2 files)                                        | use-case           | application | VÁLIDO                                                                                                                                                                                                                              |
| application/approvals/\*.ts (10 files)                                     | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/assets/\*.ts (11 files)                                        | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/auth/\*.ts (9 files)                                           | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/billing/\*.ts (3 files)                                        | use-case           | application | VÁLIDO                                                                                                                                                                                                                              |
| application/brand-kit/\*.ts (3 files)                                      | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/brand-voice/\*.ts (3 files)                                    | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/campaigns/\*.ts (10 files)                                     | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/channels/\*.ts (3 files)                                       | use-case           | application | VÁLIDO                                                                                                                                                                                                                              |
| application/comments/\*.ts (5 files)                                       | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/crisis/\*.ts (5 files)                                         | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/crm/\*.ts (6 files)                                            | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/customer-auth/\*.ts (7 files)                                  | use-case           | application | VÁLIDO                                                                                                                                                                                                                              |
| application/custom-reports/\*.ts (10 files)                                | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/external-notifications/\*.ts (5 files)                         | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/first-comment/\*.ts (4 files)                                  | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/inbox/\*.ts (20 files)                                         | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/integrations/\*.ts (6 files)                                   | use-case + service | application | VÁLIDO                                                                                                                                                                                                                              |
| application/links/\*.ts (7 files)                                          | use-case           | application | VÁLIDO                                                                                                                                                                                                                              |
| application/mentions/\*.ts (2 files)                                       | service            | application | VÁLIDO                                                                                                                                                                                                                              |
| application/ml/\*.ts (4 files)                                             | use-case           | application | VÁLIDO                                                                                                                                                                                                                              |
| application/notifications/\*.ts (8 files)                                  | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/posts/\*.ts (12 files)                                         | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/providers/\*.ts (1 file)                                       | use-case           | application | VÁLIDO                                                                                                                                                                                                                              |
| application/recurring/\*.ts (7 files)                                      | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/referral/\*.ts (4 files)                                       | use-case           | application | VÁLIDO                                                                                                                                                                                                                              |
| application/reports/\*.ts (7 files)                                        | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/security/\*.ts (1 file)                                        | query-handler      | application | VÁLIDO                                                                                                                                                                                                                              |
| application/tasks/\*.ts (7 files)                                          | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/team/\*.ts (6 files)                                           | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/trends/\*.ts (2 files)                                         | use-case           | application | VÁLIDO (FetchTrendingTopicsUseCase has only 1 verified caller — verify)                                                                                                                                                             |
| application/usage/\*.ts (2 files)                                          | use-case + query   | application | VÁLIDO                                                                                                                                                                                                                              |
| application/utm/\*.ts (2 files)                                            | use-case           | application | VÁLIDO                                                                                                                                                                                                                              |
| application/webhooks/\*.ts (2 files)                                       | use-case           | application | VÁLIDO                                                                                                                                                                                                                              |

### apps/api/src/events/

| Path                                                                           | Tipo    | Layer          | Veredicto                                             |
| ------------------------------------------------------------------------------ | ------- | -------------- | ----------------------------------------------------- |
| [apps/api/src/events/EventPublisher.ts](apps/api/src/events/EventPublisher.ts) | service | infrastructure | **DEAD** — no production callers (see detailed entry) |
| [apps/api/src/events/EventService.ts](apps/api/src/events/EventService.ts)     | service | infrastructure | VÁLIDO — wired in index.ts as saga `EventService`     |
| [apps/api/src/events/EventStore.ts](apps/api/src/events/EventStore.ts)         | service | infrastructure | VÁLIDO — used by EventService                         |

### apps/api/src/infrastructure/

| Path                                                                                                                                                                                                                                                                                                 | Tipo            | Layer          | Veredicto |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------- | --------- |
| infrastructure/adapters/\*.ts (9 files: CrossPlatformAnalyticsAdapter, ExternalNotificationDispatcher, FetchHttpClient, GA4TrackingAdapter, PerformanceComparatorAdapter, ResendEmailAdapter, ROICalculatorAdapter, SlackNotifierAdapter, TeamsNotifierAdapter)                                      | adapter         | infrastructure | VÁLIDO    |
| [apps/api/src/infrastructure/auth/OpenidClientHandshakeProbe.ts](apps/api/src/infrastructure/auth/OpenidClientHandshakeProbe.ts)                                                                                                                                                                     | adapter         | infrastructure | VÁLIDO    |
| infrastructure/billing/\*.ts (4 files: GatewayAdapterRegistry, PaddlePaymentAdapter, paymentAdapterFactory, StripePaymentAdapter)                                                                                                                                                                    | adapter         | infrastructure | VÁLIDO    |
| infrastructure/container/Container.ts                                                                                                                                                                                                                                                                | DI-container    | infrastructure | VÁLIDO    |
| infrastructure/container/index.ts                                                                                                                                                                                                                                                                    | barrel          | infrastructure | VÁLIDO    |
| infrastructure/container/setup\*.ts (~30 files)                                                                                                                                                                                                                                                      | DI-container    | infrastructure | VÁLIDO    |
| infrastructure/container/types.ts                                                                                                                                                                                                                                                                    | DI-tokens       | infrastructure | VÁLIDO    |
| infrastructure/integration-events/\*.ts (10 files: BullMQIntegrationPublisher, ComposedEventDispatcher, EventSchemaRegistry, EventUpcaster, handlers/AnalyticsEventHandler, handlers/WebhookEventHandler, IntegrationEventConsumer, IntegrationEventHandler, IntegrationEventPort, IntegrationEvent) | adapter         | infrastructure | VÁLIDO    |
| infrastructure/outbox/\*.ts (6 files: OutboxBackoff, OutboxClaimService, OutboxCleaner, OutboxInbox, OutboxRelay, PrismaOutboxWriter)                                                                                                                                                                | adapter         | infrastructure | VÁLIDO    |
| infrastructure/repositories/*.ts (74 files: Prisma*Repository + variant adapters + mappers/PostAggregateMapper)                                                                                                                                                                                      | repository-impl | infrastructure | VÁLIDO    |
| [apps/api/src/infrastructure/repositories/BullMQRepurposeJobDispatcher.ts](apps/api/src/infrastructure/repositories/BullMQRepurposeJobDispatcher.ts)                                                                                                                                                 | adapter         | infrastructure | VÁLIDO    |
| [apps/api/src/infrastructure/saga/RedisSemanticLockStore.ts](apps/api/src/infrastructure/saga/RedisSemanticLockStore.ts)                                                                                                                                                                             | adapter         | infrastructure | VÁLIDO    |
| [apps/api/src/infrastructure/security/SecretRotationLogPrismaReadRepository.ts](apps/api/src/infrastructure/security/SecretRotationLogPrismaReadRepository.ts)                                                                                                                                       | repository-impl | infrastructure | VÁLIDO    |
| [apps/api/src/infrastructure/storage/createStorageAdapter.ts](apps/api/src/infrastructure/storage/createStorageAdapter.ts)                                                                                                                                                                           | adapter         | infrastructure | VÁLIDO    |
| [apps/api/src/infrastructure/unitofwork/PrismaUnitOfWork.ts](apps/api/src/infrastructure/unitofwork/PrismaUnitOfWork.ts)                                                                                                                                                                             | adapter         | infrastructure | VÁLIDO    |

### apps/api/src/integrations/

| Path                                                                                                                         | Tipo    | Layer          | Veredicto |
| ---------------------------------------------------------------------------------------------------------------------------- | ------- | -------------- | --------- |
| [apps/api/src/integrations/IntegrationEventDeliveryHandler.ts](apps/api/src/integrations/IntegrationEventDeliveryHandler.ts) | service | infrastructure | VÁLIDO    |
| [apps/api/src/integrations/makeRoutes.ts](apps/api/src/integrations/makeRoutes.ts)                                           | route   | infrastructure | VÁLIDO    |
| [apps/api/src/integrations/zapierRoutes.ts](apps/api/src/integrations/zapierRoutes.ts)                                       | route   | infrastructure | VÁLIDO    |

### apps/api/src/lib/

| Path                                                                                                     | Tipo          | Layer          | Veredicto                                                                                  |
| -------------------------------------------------------------------------------------------------------- | ------------- | -------------- | ------------------------------------------------------------------------------------------ |
| [apps/api/src/lib/cache/cacheConfig.ts](apps/api/src/lib/cache/cacheConfig.ts)                           | config        | infrastructure | VÁLIDO                                                                                     |
| [apps/api/src/lib/errors/AppError.ts](apps/api/src/lib/errors/AppError.ts)                               | service       | infrastructure | VÁLIDO                                                                                     |
| [apps/api/src/lib/errors/errorHandler.ts](apps/api/src/lib/errors/errorHandler.ts)                       | service       | infrastructure | VÁLIDO                                                                                     |
| [apps/api/src/lib/errors/errorPlugin.ts](apps/api/src/lib/errors/errorPlugin.ts)                         | service       | infrastructure | VÁLIDO                                                                                     |
| [apps/api/src/lib/errors/index.ts](apps/api/src/lib/errors/index.ts)                                     | barrel        | infrastructure | VÁLIDO                                                                                     |
| [apps/api/src/lib/logger.ts](apps/api/src/lib/logger.ts)                                                 | observability | infrastructure | VÁLIDO                                                                                     |
| [apps/api/src/lib/redis.ts](apps/api/src/lib/redis.ts)                                                   | service       | infrastructure | VÁLIDO                                                                                     |
| [apps/api/src/lib/route-handler/BaseRouteHandler.ts](apps/api/src/lib/route-handler/BaseRouteHandler.ts) | service       | infrastructure | VÁLIDO                                                                                     |
| [apps/api/src/lib/route-handler/index.ts](apps/api/src/lib/route-handler/index.ts)                       | barrel        | infrastructure | VÁLIDO                                                                                     |
| [apps/api/src/lib/templates/ServerTemplateEngine.ts](apps/api/src/lib/templates/ServerTemplateEngine.ts) | service       | infrastructure | UNKNOWN — only same-folder caller (`lib/templates/templateEngine.ts`)                      |
| [apps/api/src/lib/templates/templateEngine.ts](apps/api/src/lib/templates/templateEngine.ts)             | service       | infrastructure | UNKNOWN — production callers limited to `templates/templateService.ts`; verify usage scope |
| [apps/api/src/lib/withTimeout.ts](apps/api/src/lib/withTimeout.ts)                                       | service       | infrastructure | VÁLIDO                                                                                     |

### apps/api/src/metrics/, middleware/, monitoring/, observability/

| Path                                                                                                 | Tipo          | Layer          | Veredicto                                                                  |
| ---------------------------------------------------------------------------------------------------- | ------------- | -------------- | -------------------------------------------------------------------------- |
| [apps/api/src/metrics/apiMetrics.ts](apps/api/src/metrics/apiMetrics.ts)                             | observability | infrastructure | VÁLIDO                                                                     |
| [apps/api/src/metrics/businessMetrics.ts](apps/api/src/metrics/businessMetrics.ts)                   | observability | infrastructure | VÁLIDO                                                                     |
| [apps/api/src/middleware/autoCacheMiddleware.ts](apps/api/src/middleware/autoCacheMiddleware.ts)     | middleware    | infrastructure | VÁLIDO                                                                     |
| [apps/api/src/middleware/correlationMiddleware.ts](apps/api/src/middleware/correlationMiddleware.ts) | middleware    | infrastructure | VÁLIDO                                                                     |
| [apps/api/src/middleware/metricsMiddleware.ts](apps/api/src/middleware/metricsMiddleware.ts)         | middleware    | infrastructure | VÁLIDO                                                                     |
| [apps/api/src/monitoring/cacheStatsRoutes.ts](apps/api/src/monitoring/cacheStatsRoutes.ts)           | route         | infrastructure | VÁLIDO                                                                     |
| [apps/api/src/monitoring/performanceMonitor.ts](apps/api/src/monitoring/performanceMonitor.ts)       | observability | infrastructure | VÁLIDO                                                                     |
| [apps/api/src/monitoring/rateLimitingDashboard.ts](apps/api/src/monitoring/rateLimitingDashboard.ts) | route         | infrastructure | **FORGOTTEN-FEATURE** — tested but not registered in index.ts (see detail) |
| [apps/api/src/observability/sentryInit.ts](apps/api/src/observability/sentryInit.ts)                 | observability | infrastructure | VÁLIDO                                                                     |

### apps/api/src/notifications/, onboarding/

| Path                                                                                                 | Tipo  | Layer          | Veredicto |
| ---------------------------------------------------------------------------------------------------- | ----- | -------------- | --------- |
| [apps/api/src/notifications/notificationRoutes.ts](apps/api/src/notifications/notificationRoutes.ts) | route | infrastructure | VÁLIDO    |
| [apps/api/src/onboarding/onboardingRoutes.ts](apps/api/src/onboarding/onboardingRoutes.ts)           | route | infrastructure | VÁLIDO    |

### apps/api/src/orchestration/

| Path                                                                                                                           | Tipo     | Layer          | Veredicto                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------ | -------- | -------------- | -------------------------------------------------------------------------------- |
| [apps/api/src/orchestration/ConflictPatterns.ts](apps/api/src/orchestration/ConflictPatterns.ts)                               | service  | infrastructure | VÁLIDO                                                                           |
| [apps/api/src/orchestration/ConflictResolver.ts](apps/api/src/orchestration/ConflictResolver.ts)                               | service  | infrastructure | VÁLIDO                                                                           |
| [apps/api/src/orchestration/conflictResolverTypes.ts](apps/api/src/orchestration/conflictResolverTypes.ts)                     | types    | infrastructure | VÁLIDO                                                                           |
| [apps/api/src/orchestration/ConflictStrategies.ts](apps/api/src/orchestration/ConflictStrategies.ts)                           | service  | infrastructure | VÁLIDO                                                                           |
| [apps/api/src/orchestration/ContentSynchronizer.ts](apps/api/src/orchestration/ContentSynchronizer.ts)                         | service  | infrastructure | VÁLIDO (used via ConflictResolver)                                               |
| [apps/api/src/orchestration/CredentialManager.ts](apps/api/src/orchestration/CredentialManager.ts)                             | security | infrastructure | VÁLIDO                                                                           |
| [apps/api/src/orchestration/DependencyGraphBuilder.ts](apps/api/src/orchestration/DependencyGraphBuilder.ts)                   | service  | infrastructure | VÁLIDO                                                                           |
| [apps/api/src/orchestration/dependencyTypes.ts](apps/api/src/orchestration/dependencyTypes.ts)                                 | types    | infrastructure | VÁLIDO                                                                           |
| [apps/api/src/orchestration/ProviderCoordinatorExecution.ts](apps/api/src/orchestration/ProviderCoordinatorExecution.ts)       | service  | infrastructure | VÁLIDO                                                                           |
| [apps/api/src/orchestration/ProviderCoordinatorMonitoring.ts](apps/api/src/orchestration/ProviderCoordinatorMonitoring.ts)     | service  | infrastructure | VÁLIDO                                                                           |
| [apps/api/src/orchestration/ProviderCoordinator.ts](apps/api/src/orchestration/ProviderCoordinator.ts)                         | service  | infrastructure | VÁLIDO                                                                           |
| [apps/api/src/orchestration/providerCoordinatorTypes.ts](apps/api/src/orchestration/providerCoordinatorTypes.ts)               | types    | infrastructure | VÁLIDO                                                                           |
| [apps/api/src/orchestration/ProviderDependencyManager.ts](apps/api/src/orchestration/ProviderDependencyManager.ts)             | service  | infrastructure | VÁLIDO                                                                           |
| [apps/api/src/orchestration/ProviderHealthMonitor.ts](apps/api/src/orchestration/ProviderHealthMonitor.ts)                     | service  | infrastructure | VÁLIDO                                                                           |
| [apps/api/src/orchestration/PublishingOrchestratorExecution.ts](apps/api/src/orchestration/PublishingOrchestratorExecution.ts) | service  | infrastructure | **DEAD** — see detailed entry                                                    |
| [apps/api/src/orchestration/PublishingOrchestratorHelpers.ts](apps/api/src/orchestration/PublishingOrchestratorHelpers.ts)     | service  | infrastructure | **DEAD** — see detailed entry                                                    |
| [apps/api/src/orchestration/PublishingOrchestrator.ts](apps/api/src/orchestration/PublishingOrchestrator.ts)                   | service  | infrastructure | **DEAD** — see detailed entry                                                    |
| [apps/api/src/orchestration/publishingOrchestratorTypes.ts](apps/api/src/orchestration/publishingOrchestratorTypes.ts)         | types    | infrastructure | **DEAD** — see detailed entry                                                    |
| [apps/api/src/orchestration/RateLimitManager.ts](apps/api/src/orchestration/RateLimitManager.ts)                               | service  | infrastructure | VÁLIDO                                                                           |
| [apps/api/src/orchestration/sync/ConflictResolver.ts](apps/api/src/orchestration/sync/ConflictResolver.ts)                     | service  | infrastructure | UNKNOWN — name collides with `orchestration/ConflictResolver.ts`; verify callers |
| [apps/api/src/orchestration/sync/StreamProcessor.ts](apps/api/src/orchestration/sync/StreamProcessor.ts)                       | service  | infrastructure | UNKNOWN                                                                          |
| [apps/api/src/orchestration/sync/SyncCoordinator.ts](apps/api/src/orchestration/sync/SyncCoordinator.ts)                       | service  | infrastructure | UNKNOWN                                                                          |
| [apps/api/src/orchestration/sync/SyncExecutor.ts](apps/api/src/orchestration/sync/SyncExecutor.ts)                             | service  | infrastructure | UNKNOWN                                                                          |
| [apps/api/src/orchestration/sync/TransformationEngine.ts](apps/api/src/orchestration/sync/TransformationEngine.ts)             | service  | infrastructure | UNKNOWN                                                                          |
| [apps/api/src/orchestration/sync/types.ts](apps/api/src/orchestration/sync/types.ts)                                           | types    | infrastructure | VÁLIDO                                                                           |
| [apps/api/src/orchestration/sync/VersionManager.ts](apps/api/src/orchestration/sync/VersionManager.ts)                         | service  | infrastructure | UNKNOWN                                                                          |

### apps/api/src/outbox/, posts/, projects/, providers/, recurring/

| Path                                                                                                           | Tipo     | Layer          | Veredicto                                |
| -------------------------------------------------------------------------------------------------------------- | -------- | -------------- | ---------------------------------------- |
| [apps/api/src/outbox/outboxAdminRoutes.ts](apps/api/src/outbox/outboxAdminRoutes.ts)                           | route    | infrastructure | VÁLIDO                                   |
| [apps/api/src/posts/optimizedPostsRoutes.ts](apps/api/src/posts/optimizedPostsRoutes.ts)                       | route    | infrastructure | **DEAD** — never registered (see detail) |
| [apps/api/src/posts/postRoutes.ts](apps/api/src/posts/postRoutes.ts)                                           | route    | infrastructure | VÁLIDO                                   |
| [apps/api/src/posts/postsService.ts](apps/api/src/posts/postsService.ts)                                       | service  | infrastructure | VÁLIDO                                   |
| [apps/api/src/projects/crisisRoutes.ts](apps/api/src/projects/crisisRoutes.ts)                                 | route    | infrastructure | VÁLIDO                                   |
| [apps/api/src/projects/projectRoutes.ts](apps/api/src/projects/projectRoutes.ts)                               | route    | infrastructure | VÁLIDO                                   |
| [apps/api/src/providers/providerAdapter.interface.ts](apps/api/src/providers/providerAdapter.interface.ts)     | types    | infrastructure | VÁLIDO                                   |
| [apps/api/src/providers/providerCapabilityManager.ts](apps/api/src/providers/providerCapabilityManager.ts)     | provider | infrastructure | VÁLIDO                                   |
| [apps/api/src/providers/providerConstraintValidator.ts](apps/api/src/providers/providerConstraintValidator.ts) | provider | infrastructure | VÁLIDO                                   |
| [apps/api/src/providers/providerRegistry.ts](apps/api/src/providers/providerRegistry.ts)                       | provider | infrastructure | VÁLIDO                                   |
| [apps/api/src/providers/providerRoutes.ts](apps/api/src/providers/providerRoutes.ts)                           | route    | infrastructure | VÁLIDO                                   |
| [apps/api/src/providers/providerService.ts](apps/api/src/providers/providerService.ts)                         | service  | infrastructure | VÁLIDO                                   |
| [apps/api/src/recurring/RecurrenceScheduler.ts](apps/api/src/recurring/RecurrenceScheduler.ts)                 | service  | infrastructure | VÁLIDO                                   |
| [apps/api/src/recurring/recurringPostRoutes.ts](apps/api/src/recurring/recurringPostRoutes.ts)                 | route    | infrastructure | VÁLIDO                                   |

### apps/api/src/reports/, repurpose/, saga/, scheduling/

| Path                                                                                                   | Tipo    | Layer          | Veredicto                                                              |
| ------------------------------------------------------------------------------------------------------ | ------- | -------------- | ---------------------------------------------------------------------- |
| [apps/api/src/reports/reportRoutes.ts](apps/api/src/reports/reportRoutes.ts)                           | route   | infrastructure | VÁLIDO                                                                 |
| [apps/api/src/repurpose/repurposeRoutes.ts](apps/api/src/repurpose/repurposeRoutes.ts)                 | route   | infrastructure | VÁLIDO                                                                 |
| [apps/api/src/saga/SagaIntegration.ts](apps/api/src/saga/SagaIntegration.ts)                           | service | infrastructure | VÁLIDO                                                                 |
| [apps/api/src/saga/SagaManagerExecution.ts](apps/api/src/saga/SagaManagerExecution.ts)                 | service | infrastructure | VÁLIDO                                                                 |
| [apps/api/src/saga/SagaManagerLifecycle.ts](apps/api/src/saga/SagaManagerLifecycle.ts)                 | service | infrastructure | VÁLIDO                                                                 |
| [apps/api/src/saga/SagaManager.ts](apps/api/src/saga/SagaManager.ts)                                   | service | infrastructure | VÁLIDO                                                                 |
| [apps/api/src/saga/sagaManagerTypes.ts](apps/api/src/saga/sagaManagerTypes.ts)                         | types   | **MISSING**    | **MISMATCH** — only file in apps/api/src without `@layer` (see detail) |
| [apps/api/src/scheduling/schedulingClientRoutes.ts](apps/api/src/scheduling/schedulingClientRoutes.ts) | route   | infrastructure | VÁLIDO                                                                 |

### apps/api/src/security/, services/, settings/

| Path                                                                                                     | Tipo       | Layer          | Veredicto |
| -------------------------------------------------------------------------------------------------------- | ---------- | -------------- | --------- |
| [apps/api/src/security/advancedRateLimit.ts](apps/api/src/security/advancedRateLimit.ts)                 | security   | infrastructure | VÁLIDO    |
| [apps/api/src/security/auditLogger.ts](apps/api/src/security/auditLogger.ts)                             | security   | infrastructure | VÁLIDO    |
| [apps/api/src/security/ChannelCredentialsCrypto.ts](apps/api/src/security/ChannelCredentialsCrypto.ts)   | security   | infrastructure | VÁLIDO    |
| [apps/api/src/security/credentialManager.ts](apps/api/src/security/credentialManager.ts)                 | security   | infrastructure | VÁLIDO    |
| [apps/api/src/security/csrfMiddleware.ts](apps/api/src/security/csrfMiddleware.ts)                       | middleware | infrastructure | VÁLIDO    |
| [apps/api/src/security/decryptAuditContext.ts](apps/api/src/security/decryptAuditContext.ts)             | security   | infrastructure | VÁLIDO    |
| [apps/api/src/security/EncryptionService.ts](apps/api/src/security/EncryptionService.ts)                 | security   | infrastructure | VÁLIDO    |
| [apps/api/src/security/enhancedValidator.ts](apps/api/src/security/enhancedValidator.ts)                 | security   | infrastructure | VÁLIDO    |
| [apps/api/src/security/fileUploadValidator.ts](apps/api/src/security/fileUploadValidator.ts)             | security   | infrastructure | VÁLIDO    |
| [apps/api/src/security/inputValidation.ts](apps/api/src/security/inputValidation.ts)                     | security   | infrastructure | VÁLIDO    |
| [apps/api/src/security/ipAllowlistMiddleware.ts](apps/api/src/security/ipAllowlistMiddleware.ts)         | middleware | infrastructure | VÁLIDO    |
| [apps/api/src/security/PlatformCredentialService.ts](apps/api/src/security/PlatformCredentialService.ts) | security   | infrastructure | VÁLIDO    |
| [apps/api/src/security/rateLimit.ts](apps/api/src/security/rateLimit.ts)                                 | security   | infrastructure | VÁLIDO    |
| [apps/api/src/security/securityHeaders.ts](apps/api/src/security/securityHeaders.ts)                     | security   | infrastructure | VÁLIDO    |
| [apps/api/src/security/slidingWindowRateLimit.ts](apps/api/src/security/slidingWindowRateLimit.ts)       | security   | infrastructure | VÁLIDO    |
| [apps/api/src/services/AuditableService.ts](apps/api/src/services/AuditableService.ts)                   | service    | infrastructure | VÁLIDO    |
| [apps/api/src/services/BaseService.ts](apps/api/src/services/BaseService.ts)                             | service    | infrastructure | VÁLIDO    |
| [apps/api/src/services/NotificationBroadcaster.ts](apps/api/src/services/NotificationBroadcaster.ts)     | service    | infrastructure | VÁLIDO    |
| [apps/api/src/settings/credentialKeys.ts](apps/api/src/settings/credentialKeys.ts)                       | service    | infrastructure | VÁLIDO    |
| [apps/api/src/settings/settingsRoutes.ts](apps/api/src/settings/settingsRoutes.ts)                       | route      | infrastructure | VÁLIDO    |
| [apps/api/src/settings/settingsSchemas.ts](apps/api/src/settings/settingsSchemas.ts)                     | types      | infrastructure | VÁLIDO    |
| [apps/api/src/settings/SettingsService.ts](apps/api/src/settings/SettingsService.ts)                     | service    | infrastructure | VÁLIDO    |

### apps/api/src/tasks/, team/, templates/

| Path                                                                                                   | Tipo    | Layer          | Veredicto |
| ------------------------------------------------------------------------------------------------------ | ------- | -------------- | --------- |
| [apps/api/src/tasks/taskRoutes.ts](apps/api/src/tasks/taskRoutes.ts)                                   | route   | infrastructure | VÁLIDO    |
| [apps/api/src/team/teamRoutes.ts](apps/api/src/team/teamRoutes.ts)                                     | route   | infrastructure | VÁLIDO    |
| [apps/api/src/templates/TemplateABTestHandlers.ts](apps/api/src/templates/TemplateABTestHandlers.ts)   | service | infrastructure | VÁLIDO    |
| [apps/api/src/templates/TemplateABTestService.ts](apps/api/src/templates/TemplateABTestService.ts)     | service | infrastructure | VÁLIDO    |
| [apps/api/src/templates/templateAnalytics.ts](apps/api/src/templates/templateAnalytics.ts)             | service | infrastructure | VÁLIDO    |
| [apps/api/src/templates/TemplateCrudHandlers.ts](apps/api/src/templates/TemplateCrudHandlers.ts)       | service | infrastructure | VÁLIDO    |
| [apps/api/src/templates/TemplateHandlers.ts](apps/api/src/templates/TemplateHandlers.ts)               | service | infrastructure | VÁLIDO    |
| [apps/api/src/templates/templateRoutes.ts](apps/api/src/templates/templateRoutes.ts)                   | route   | infrastructure | VÁLIDO    |
| [apps/api/src/templates/templateSchemas.ts](apps/api/src/templates/templateSchemas.ts)                 | types   | infrastructure | VÁLIDO    |
| [apps/api/src/templates/templateService.ts](apps/api/src/templates/templateService.ts)                 | service | infrastructure | VÁLIDO    |
| [apps/api/src/templates/templateTypes.ts](apps/api/src/templates/templateTypes.ts)                     | types   | infrastructure | VÁLIDO    |
| [apps/api/src/templates/TemplateVersionHandlers.ts](apps/api/src/templates/TemplateVersionHandlers.ts) | service | infrastructure | VÁLIDO    |
| [apps/api/src/templates/TemplateVersionService.ts](apps/api/src/templates/TemplateVersionService.ts)   | service | infrastructure | VÁLIDO    |

### apps/api/src/trends/, types/, usage/, utm/, utils/, validation/

| Path                                                                                         | Tipo    | Layer          | Veredicto                                                                  |
| -------------------------------------------------------------------------------------------- | ------- | -------------- | -------------------------------------------------------------------------- |
| [apps/api/src/trends/trendAnalysisService.ts](apps/api/src/trends/trendAnalysisService.ts)   | service | infrastructure | VÁLIDO                                                                     |
| [apps/api/src/trends/TrendReportBuilder.ts](apps/api/src/trends/TrendReportBuilder.ts)       | service | infrastructure | VÁLIDO                                                                     |
| [apps/api/src/trends/trendRoutes.ts](apps/api/src/trends/trendRoutes.ts)                     | route   | infrastructure | VÁLIDO                                                                     |
| [apps/api/src/trends/trendTypes.ts](apps/api/src/trends/trendTypes.ts)                       | types   | infrastructure | VÁLIDO                                                                     |
| [apps/api/src/types/fastify.d.ts](apps/api/src/types/fastify.d.ts)                           | types   | infrastructure | VÁLIDO                                                                     |
| [apps/api/src/types/isomorphic-dompurify.d.ts](apps/api/src/types/isomorphic-dompurify.d.ts) | types   | infrastructure | VÁLIDO                                                                     |
| [apps/api/src/usage/usageRoutes.ts](apps/api/src/usage/usageRoutes.ts)                       | route   | infrastructure | VÁLIDO                                                                     |
| [apps/api/src/utils/dbOptimization.ts](apps/api/src/utils/dbOptimization.ts)                 | service | infrastructure | **REDUNDANTE** — duplicate of `database/DatabaseOptimizer.ts` (see detail) |
| [apps/api/src/utils/schemaUtils.ts](apps/api/src/utils/schemaUtils.ts)                       | service | infrastructure | VÁLIDO                                                                     |
| [apps/api/src/utils/typeUtils.ts](apps/api/src/utils/typeUtils.ts)                           | service | infrastructure | VÁLIDO                                                                     |
| [apps/api/src/utm/utmRoutes.ts](apps/api/src/utm/utmRoutes.ts)                               | route   | infrastructure | VÁLIDO                                                                     |
| [apps/api/src/validation/secureSchemas.ts](apps/api/src/validation/secureSchemas.ts)         | types   | infrastructure | VÁLIDO                                                                     |

### apps/api/src/video/

| Path                                                                                   | Tipo    | Layer          | Veredicto                                      |
| -------------------------------------------------------------------------------------- | ------- | -------------- | ---------------------------------------------- |
| [apps/api/src/video/thumbnailAnalysis.ts](apps/api/src/video/thumbnailAnalysis.ts)     | service | infrastructure | **FORGOTTEN-FEATURE** — tested, no prod caller |
| [apps/api/src/video/thumbnailGeneration.ts](apps/api/src/video/thumbnailGeneration.ts) | service | infrastructure | **FORGOTTEN-FEATURE**                          |
| [apps/api/src/video/thumbnailGenerator.ts](apps/api/src/video/thumbnailGenerator.ts)   | service | infrastructure | **FORGOTTEN-FEATURE**                          |
| [apps/api/src/video/thumbnailTemplates.ts](apps/api/src/video/thumbnailTemplates.ts)   | service | infrastructure | **FORGOTTEN-FEATURE**                          |
| [apps/api/src/video/thumbnailTypes.ts](apps/api/src/video/thumbnailTypes.ts)           | types   | infrastructure | **FORGOTTEN-FEATURE**                          |
| [apps/api/src/video/uploadPipeline.ts](apps/api/src/video/uploadPipeline.ts)           | service | infrastructure | **FORGOTTEN-FEATURE**                          |
| [apps/api/src/video/videoProcessor.ts](apps/api/src/video/videoProcessor.ts)           | service | infrastructure | **FORGOTTEN-FEATURE**                          |

### apps/api/src/webhooks/

| Path                                                                                                                                            | Tipo      | Layer          | Veredicto |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------- | --------- |
| [apps/api/src/webhooks/DlqArchivalService.ts](apps/api/src/webhooks/DlqArchivalService.ts)                                                      | service   | infrastructure | VÁLIDO    |
| webhooks/processors/\*.ts (9 files: AbstractWebhookProcessor + facebook/instagram/linkedin/snapchat/telegram/tiktok/x/youtube webhookProcessor) | processor | infrastructure | VÁLIDO    |
| [apps/api/src/webhooks/realtimeWebhookBroadcaster.ts](apps/api/src/webhooks/realtimeWebhookBroadcaster.ts)                                      | service   | infrastructure | VÁLIDO    |
| [apps/api/src/webhooks/webhookDashboardRoutes.ts](apps/api/src/webhooks/webhookDashboardRoutes.ts)                                              | route     | infrastructure | VÁLIDO    |
| [apps/api/src/webhooks/webhookDashboardService.ts](apps/api/src/webhooks/webhookDashboardService.ts)                                            | service   | infrastructure | VÁLIDO    |
| [apps/api/src/webhooks/WebhookEventMapper.ts](apps/api/src/webhooks/WebhookEventMapper.ts)                                                      | service   | infrastructure | VÁLIDO    |
| [apps/api/src/webhooks/webhookHandlerCore.ts](apps/api/src/webhooks/webhookHandlerCore.ts)                                                      | service   | infrastructure | VÁLIDO    |
| [apps/api/src/webhooks/webhookHandler.ts](apps/api/src/webhooks/webhookHandler.ts)                                                              | service   | infrastructure | VÁLIDO    |
| [apps/api/src/webhooks/webhookJobProcessor.ts](apps/api/src/webhooks/webhookJobProcessor.ts)                                                    | processor | infrastructure | VÁLIDO    |
| [apps/api/src/webhooks/webhookManager.ts](apps/api/src/webhooks/webhookManager.ts)                                                              | service   | infrastructure | VÁLIDO    |
| [apps/api/src/webhooks/webhookTypes.ts](apps/api/src/webhooks/webhookTypes.ts)                                                                  | types     | infrastructure | VÁLIDO    |

---

## Cross-surface signals

### Use cases without a route exposing them (suspected)

Cross-checked against the route registration list. The following use cases are registered in DI but I could not trace a direct HTTP exposure inside `apps/api/src/**/*Routes.ts`:

- `application/inbox/SyncProviderCommentsUseCase.ts` — invoked by inbox sync workers (apps/workers/src) not by an HTTP route; likely VÁLIDO via worker, not FORGOTTEN.
- `application/analytics/DispatchAnalyticsIngestionUseCase.ts` — invoked by worker scheduler, not HTTP.
- `application/inbox/DispatchInboxSyncUseCase.ts` — same; worker-triggered.
- `application/integrations/TriggerIntegrationEventService.ts` — invoked by event handlers (`IntegrationEventDeliveryHandler`), not directly by routes.
- `application/inbox/handlers/InboxEventHandlers.ts` — event handler, no HTTP exposure expected.
- `application/notifications/handlers/NotificationEventHandlers.ts` — event handler.
- `application/notifications/SendEmailNotificationService.ts` — invoked by NotificationEventHandlers.

None of these are FORGOTTEN-FEATURE — they're all legitimately surfaced through event/worker channels.

### Routes that import a use case NOT registered in Container.ts

I did not find route-level imports of unregistered use cases. The DI surface appears to be in sync with the route surface, with the exceptions called out as **DEAD** below.

### Repository ports without an implementation binding

All 59 ports in `apps/api/src/domain/repositories/*.ts` were cross-checked against the binding list in `setup*.ts`. Every port has an implementation. Note that some ports are bound under a Token whose name differs from the port name (e.g. `OutboxWriter` port → `PrismaOutboxWriter` impl bound under `TOKENS.OutboxWriter`). No orphan ports detected.

### Throws in domain/application layers (violates Result<T,E> canon)

Zero hits. The repo-wide grep `grep -rl "throw new" apps/api/src/domain apps/api/src/application` returned no files. This is consistent with the strict Result type rule in CLAUDE.md (fitness check #4 confirms this is enforced in CI).

### Files missing @file or @layer header

- **@file:** 0 missing (823/823 have it). Fitness check #9 clean.
- **@layer:** 1 missing — `apps/api/src/saga/sagaManagerTypes.ts`. Fitness check #10 will flag this on its next run. Easy fix: add `@layer infrastructure`.

### Sprint/Phase comments in source

Zero detected via `grep -nE "Sprint [0-9A-Z]|Phase [0-9]|T0A_|T0-A"` in `apps/api/src`. Fitness check #8 clean.

### @ts-ignore / @ts-nocheck in production source

Zero detected per `grep -rn "@ts-ignore\|@ts-nocheck" apps/api/src --include="*.ts"`. Fitness check #5 clean.

### Direct Prisma in routes

Spot-check on `apps/api/src/announcements/announcementRoutes.ts` and a handful of other routes shows they all resolve repositories from DI rather than calling `prisma.*` directly. Fitness check #1 would flag any drift; recent CI status confirms zero hits.

---

## Detailed entries — non-VÁLIDO files

### audit-API-001 — orphan optimized posts route

- **Path:** [apps/api/src/posts/optimizedPostsRoutes.ts](apps/api/src/posts/optimizedPostsRoutes.ts)
- **Surface:** api
- **Tipo:** route
- **@layer declared:** infrastructure
- **Propósito real:** High-performance post API endpoints with multi-level caching and React Server Components hints. Defines a Fastify plugin exposing GET /optimized-posts, dashboard-stats and a cache-warm endpoint.
- **Exports / endpoints / handlers:** `export async function optimizedPostsRoutes(fastify)` — GET /accounts/:accountId/optimized-posts, GET /accounts/:accountId/dashboard-stats, POST /accounts/:accountId/warm-cache (all suffixes inferred from schemas in file).
- **Imports significativos:** `@packages/api-common`, `fastify`, `zod`, `../infrastructure/container/types.js`, `./postsService.js`, `../auth/customerAuthMiddleware.js`
- **Wiring detected:** The plugin function `optimizedPostsRoutes` is **NOT** imported in `apps/api/src/index.ts`. The only ripgrep hit for the symbol is the file's own `@file` header. The plugin never runs, so the endpoints are unreachable.
- **Callers:** none
- **Veredicto preliminar:** DEAD
- **Notas:** Standard route shape — VÁLIDO if registered. Either delete the file (the work is preserved in git history) or wire it via `typedApp.register(optimizedPostsRoutes)` in `index.ts`. The `postsService.ts` it depends on is fully wired into DI, so wiring the route is a one-line change.

### audit-API-002 — DEAD: AccountMapper static helper

- **Path:** [apps/api/src/mappers/AccountMapper.ts](apps/api/src/mappers/AccountMapper.ts)
- **Surface:** api
- **Tipo:** service (static mapper)
- **@layer declared:** infrastructure
- **Propósito real:** Static utility converting `Account` domain objects to legacy "subscriptionInfo" DTOs.
- **Exports / endpoints / handlers:** `export class AccountMapper { static toSubscriptionInfo(account: Account): SubscriptionInfo }`
- **Imports significativos:** `../domain/entities/Account.js`
- **Wiring detected:** Not registered in DI (no token). Not imported anywhere outside its own file.
- **Callers:** none
- **Veredicto preliminar:** DEAD
- **Notas:** Looks like a leftover from a refactor that moved the mapping logic into a repository's DTO builder. Verify no admin or worker code uses the legacy `subscriptionInfo` shape, then delete.

### audit-API-003 — DEAD: EventPublisher (events/)

- **Path:** [apps/api/src/events/EventPublisher.ts](apps/api/src/events/EventPublisher.ts)
- **Surface:** api
- **Tipo:** service
- **@layer declared:** infrastructure
- **Propósito real:** Defines an in-memory `EventPublisher` abstraction for fan-out to handlers.
- **Wiring detected:** Not registered in `TOKENS`. The DI uses `ComposedEventDispatcher` + `IntegrationEventPublisher` instead.
- **Callers:** none in production code. The only token "EventPublisher" hit lives in `infrastructure/integration-events/IntegrationEventPort.ts` which defines a separate `IntegrationEventPublisher` interface.
- **Veredicto preliminar:** DEAD
- **Notas:** Pre-saga event plumbing that was replaced by the integration-events pipeline.

### audit-API-004 — DEAD: PublishingOrchestrator (orchestration/)

- **Paths:**
  - [apps/api/src/orchestration/PublishingOrchestrator.ts](apps/api/src/orchestration/PublishingOrchestrator.ts)
  - [apps/api/src/orchestration/PublishingOrchestratorExecution.ts](apps/api/src/orchestration/PublishingOrchestratorExecution.ts)
  - [apps/api/src/orchestration/PublishingOrchestratorHelpers.ts](apps/api/src/orchestration/PublishingOrchestratorHelpers.ts)
  - [apps/api/src/orchestration/publishingOrchestratorTypes.ts](apps/api/src/orchestration/publishingOrchestratorTypes.ts)
- **Tipo:** service (orchestrator class + helpers + types)
- **@layer declared:** infrastructure
- **Propósito real:** Pre-saga publish-flow orchestrator (provider coordination, channel ordering, retry) — written before the canonical saga pattern was introduced.
- **Wiring detected:** Not registered in DI. No `setupServices.ts` reference. The current canonical publish path goes through `SagaManager` + `cqrs/handlers/PostCommandHandlers.ts`.
- **Callers:** zero outside the 4 files in this same folder (which cross-reference each other).
- **Veredicto preliminar:** DEAD
- **Notas:** Saga retrofit superseded this. Recommend deleting after confirming there are no plans to revive it (Edward's call). Note: `ProviderCoordinator` / `ProviderHealthMonitor` in the same folder ARE wired into DI — keep those.

### audit-API-005 — FORGOTTEN-FEATURE: rate-limiting dashboard

- **Path:** [apps/api/src/monitoring/rateLimitingDashboard.ts](apps/api/src/monitoring/rateLimitingDashboard.ts)
- **Surface:** api
- **Tipo:** route (Fastify plugin)
- **@layer declared:** infrastructure
- **Propósito real:** Admin dashboard endpoints for rate-limiting metrics (GET /admin/rate-limiting/dashboard, GET /admin/rate-limiting/realtime).
- **Wiring detected:** Not registered in `apps/api/src/index.ts`. The file has comprehensive Vitest unit tests (visible in `apps/api/reports/stryker-incremental-micro.json`) — the code is exercised but the routes never bind to the server.
- **Callers:** tests only.
- **Veredicto preliminar:** FORGOTTEN-FEATURE
- **Notas:** Either wire `typedApp.register(rateLimitingDashboard)` in index.ts under requireAdminAuth, or delete.

### audit-API-006 — FORGOTTEN-FEATURE: video module (7 files)

- **Path:** [apps/api/src/video/](../../apps/api/src/video/) — `thumbnailAnalysis.ts`, `thumbnailGeneration.ts`, `thumbnailGenerator.ts`, `thumbnailTemplates.ts`, `thumbnailTypes.ts`, `uploadPipeline.ts`, `videoProcessor.ts`
- **Tipo:** service
- **@layer declared:** infrastructure
- **Propósito real:** Thumbnail generation and video upload pipeline. The classes use ffmpeg/sharp-style APIs to extract frames, apply A/B test variants, and pipe through a media optimization flow.
- **Wiring detected:** None. No `TOKENS.VideoProcessor` or similar; no setup file in `infrastructure/container/`.
- **Callers:** only `apps/api/tests/unit/*.test.ts` files (the suite is large and apparently passing).
- **Veredicto preliminar:** FORGOTTEN-FEATURE
- **Notas:** Substantial implementation with full test coverage but never wired to a route. Compare against the **per-provider** video processors in `packages/providers/tiktok/src/videoProcessor.ts` and `packages/providers/facebook/src/media/videoProcessorHelpers.ts` — those are the ones actually used at publish time. This `apps/api/src/video/` set might be either a "shared upload pipeline" that lost its caller, or a precursor abandoned in favor of provider-specific implementations. Edward needs to choose: wire to an asset-upload route, or delete the whole folder.

### audit-API-007 — REDUNDANTE: two DB optimizers (database/ and utils/)

- **Path A:** [apps/api/src/database/DatabaseOptimizer.ts](apps/api/src/database/DatabaseOptimizer.ts) — "Advanced database optimization service providing query performance monitoring, materialized view management, connection pool optimization, and health metrics."
- **Path B:** [apps/api/src/utils/dbOptimization.ts](apps/api/src/utils/dbOptimization.ts) — "Database optimization utilities for query analysis, index recommendations, slow query detection, and connection pool statistics."
- **Tipo (both):** service
- **@layer declared:** infrastructure
- **Wiring detected:**
  - `database/DatabaseOptimizer` is imported by `posts/postsService.ts` and `infrastructure/container/setupServices.ts` line 45 — the singleton wired into DI.
  - `utils/dbOptimization` is imported only by `apps/api/src/index.ts` line 119 (constructs `_dbOptimizer = new DatabaseOptimizer(apiMetrics)` — note the underscored variable, suggesting "intentionally unused", a smell).
- **Veredicto preliminar:** REDUNDANTE — two named-different but conceptually-overlapping implementations. The `_dbOptimizer` in `index.ts` is constructed but never used (the prefix underscore is the standard "ignore me" convention).
- **Notas:** Either consolidate (delete `utils/dbOptimization.ts` and remove the unused `_dbOptimizer` line in index.ts) or, if `utils/dbOptimization.ts` provides distinct functionality, rename to make the difference explicit and wire it properly.

### audit-API-008 — MISMATCH: saga/sagaManagerTypes.ts missing @layer

- **Path:** [apps/api/src/saga/sagaManagerTypes.ts](apps/api/src/saga/sagaManagerTypes.ts)
- **Tipo:** types
- **@layer declared:** **MISSING**
- **Propósito real:** Shared type definitions for the Saga Manager, extracted to break a circular dependency between `SagaManagerLifecycle.ts` and `SagaManagerExecution.ts`.
- **Wiring detected:** Imported by `saga/SagaManager.ts` + `saga/SagaManagerExecution.ts` + `saga/SagaManagerLifecycle.ts` — VÁLIDO functionally.
- **Veredicto preliminar:** MISMATCH (header only; functionally fine)
- **Notas:** Single file in the entire `apps/api/src` tree without `@layer`. Add `* @layer infrastructure` to the JSDoc header. CI fitness check #10 will catch this on its next run; trivial fix.

### audit-API-009 — UNKNOWN: orchestration/sync/ (6 files)

- **Paths:** `apps/api/src/orchestration/sync/ConflictResolver.ts`, `StreamProcessor.ts`, `SyncCoordinator.ts`, `SyncExecutor.ts`, `TransformationEngine.ts`, `VersionManager.ts`
- **Tipo:** service
- **@layer declared:** infrastructure
- **Wiring detected:** No DI registration. Cross-folder grep shows zero imports from outside `orchestration/sync/` — the files only cross-reference each other.
- **Veredicto preliminar:** UNKNOWN — leaning DEAD
- **Notas:** Possible sibling to the DEAD `PublishingOrchestrator` set (audit-API-004) — looks like an abandoned sub-system. Confirm against `apps/admin/` and `apps/client/` once those inventories run. Name collision with the same-named `orchestration/ConflictResolver.ts` is itself a red flag.

### audit-API-010 — UNKNOWN: lib/templates/ServerTemplateEngine.ts + templateEngine.ts

- **Paths:**
  - [apps/api/src/lib/templates/ServerTemplateEngine.ts](apps/api/src/lib/templates/ServerTemplateEngine.ts)
  - [apps/api/src/lib/templates/templateEngine.ts](apps/api/src/lib/templates/templateEngine.ts)
- **Tipo:** service
- **@layer declared:** infrastructure
- **Wiring detected:** `lib/templates/templateEngine.ts` is imported by `templates/templateService.ts` (which IS registered in DI under `TOKENS.TemplateService`). `ServerTemplateEngine.ts` is only imported by `templateEngine.ts`. Both ride a single production caller chain.
- **Veredicto preliminar:** UNKNOWN — likely VÁLIDO via the template service chain
- **Notas:** Naming collision with `templates/templateService.ts` made this hard to triage. Confirm whether `ServerTemplateEngine` should be merged into `templateEngine` (the two-file split feels like an extract that didn't finish).

### audit-API-011 — UNKNOWN: analytics/engagementPredictor + realtimeAnalytics + roiCalculator

- **Paths:**
  - [apps/api/src/analytics/engagementPredictor.ts](apps/api/src/analytics/engagementPredictor.ts) (+ its 3 helper files: config, factors, scoring)
  - [apps/api/src/analytics/realtimeAnalytics.ts](apps/api/src/analytics/realtimeAnalytics.ts)
  - [apps/api/src/analytics/roiCalculator.ts](apps/api/src/analytics/roiCalculator.ts)
- **Tipo:** service
- **@layer declared:** infrastructure
- **Wiring detected:** No DI registration; `engagementPredictor.ts` is partitioned across multiple sibling files, which suggests recent extraction. `roiCalculator.ts` may overlap with `analytics/roi/` subdirectory's 6 calculators. `realtimeAnalytics.ts` has unclear surface.
- **Veredicto preliminar:** UNKNOWN — pattern smells like FORGOTTEN or REDUNDANT but I couldn't confirm without deeper read.
- **Notas:** Edward should diff `analytics/roiCalculator.ts` against `application/analytics/CalculateROIUseCase.ts` + `infrastructure/adapters/ROICalculatorAdapter.ts` + `analytics/roi/*.ts` — likely one of these three subsystems is the "real" ROI path and the others are stale.

---
