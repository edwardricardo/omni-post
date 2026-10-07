# Non-features and support coverage

Every capability candidate the tree yields, and what covers it for support: the support page that documents it, the reason it needs none, or nothing yet. A ticket about a candidate listed under Pending has no support page to read.

## Non-features

| Candidate                                   | Why support needs no page                                                                                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin:help`                                | Renders static help text from the translation messages: it calls no API and stores nothing.                                                                                                  |
| `package:application`                       | The shared application layer (`UseCase.ts`, `hardDeletePolicy.ts`, `retryOnWriteConflict.ts`) that every feature builds on; a support page cites its own feature's use cases instead.        |
| `package:domain`                            | The shared domain layer, organised by type (entities, value objects, events, errors) rather than by feature; a support page cites the domain files of its own feature.                       |
| `package:referral`                          | Unreachable: its use cases are registered in the container, and no file outside `apps/api/src/infrastructure/container/` resolves their tokens, so no route, worker or processor reaches it. |
| `queue:failed-operations-dlq`               | No producer: nothing enqueues to it; `setupServices.ts` only gives it default job options and the Admin queue health panel lists it.                                                         |
| `route:monitoring/rateLimitingDashboard.ts` | Unwired: nothing but its own unit test imports `RateLimitingDashboard`, so its routes are never registered.                                                                                  |

## Pending

- `admin:accounts`
- `admin:analytics`
- `admin:announcements`
- `admin:billing`
- `admin:compliance`
- `admin:login`
- `admin:logs`
- `admin:maintenance`
- `admin:pricing`
- `admin:reset-password`
- `admin:security`
- `admin:settings`
- `admin:subscriptions`
- `admin:users`
- `admin:webhooks`
- `client:ai`
- `client:analytics`
- `client:approvals`
- `client:assets`
- `client:campaigns`
- `client:channels`
- `client:content`
- `client:inbox`
- `client:instagram`
- `client:integrations`
- `client:listening`
- `client:login`
- `client:posts`
- `client:register`
- `client:reports`
- `client:scheduling`
- `client:settings`
- `client:tasks`
- `client:templates`
- `package:accounts`
- `package:ai`
- `package:ai-image`
- `package:aiPromptTemplates`
- `package:analytics`
- `package:apiKeys`
- `package:approvals`
- `package:assets`
- `package:auth`
- `package:billing`
- `package:brand-kit`
- `package:brand-voice`
- `package:bulk-scheduling`
- `package:campaigns`
- `package:channels`
- `package:comments`
- `package:compliance`
- `package:crisis`
- `package:crm`
- `package:custom-reports`
- `package:customer-auth`
- `package:embeddings`
- `package:external-notifications`
- `package:first-comment`
- `package:glossary`
- `package:guardrails`
- `package:inbox`
- `package:integrations`
- `package:links`
- `package:listening`
- `package:mentions`
- `package:ml`
- `package:notifications`
- `package:posts`
- `package:projects`
- `package:providers`
- `package:recurring`
- `package:reports`
- `package:security`
- `package:settings`
- `package:style-guide`
- `package:tasks`
- `package:team`
- `package:threading`
- `package:trends`
- `package:usage`
- `package:utm`
- `package:webhooks`
- `queue:analytics-aggregation`
- `queue:auto-renewal`
- `queue:bulk-schedule`
- `queue:bulk-schedule-dead-letter`
- `queue:dead-letter-queue`
- `queue:detect-repurpose`
- `queue:gateway-switch`
- `queue:generate-repurpose`
- `queue:inbox-sync`
- `queue:integration-events`
- `queue:mention-ingest`
- `queue:publish`
- `queue:recurring-posts`
- `queue:report-generation`
- `queue:trend-radar`
- `queue:triage-inbox`
- `queue:webhook-dead-letter`
- `queue:webhook-processing`
- `route:accounts/accountRoutes.ts`
- `route:admin/accountLifecycleRoutes.ts`
- `route:admin/adminUserRoutes.ts`
- `route:admin/analyticsRoutes.ts`
- `route:admin/apiKeyAdminRoutes.ts`
- `route:admin/auth/adminAuthRoutes.ts`
- `route:admin/channelReauthRoutes.ts`
- `route:admin/dashboardRoutes.ts`
- `route:admin/massReauthRoutes.ts`
- `route:admin/oidcAdminRoutes.ts`
- `route:admin/pricingRoutes.ts`
- `route:admin/queueRoutes.ts`
- `route:admin/schedulingRoutes.ts`
- `route:admin/secretsRotationRoutes.ts`
- `route:admin/webhookAdminRoutes.ts`
- `route:ai-image/aiImageRoutes.ts`
- `route:ai/aiLocalizedRoutes.ts`
- `route:ai/promptTemplateRoutes.ts`
- `route:ai/routes.ts`
- `route:analytics/analyticsRoutes.ts`
- `route:announcements/announcementRoutes.ts`
- `route:approvals/approvalRoutes.ts`
- `route:approvals/approvalWorkflowRoutes.ts`
- `route:assets/assetRoutes.ts`
- `route:audit/activityFeedRoutes.ts`
- `route:audit/auditRoutes.ts`
- `route:auth/apiKeyRoutes.ts`
- `route:auth/authRoutes.ts`
- `route:auth/customerAuthRoutes.ts`
- `route:auth/mfaRoutes.ts`
- `route:auth/oidcRoutes.ts`
- `route:auth/providerOAuth.ts`
- `route:auth/rbacRoutes.ts`
- `route:auth/samlRoutes.ts`
- `route:billing/adminBillingRoutes.ts`
- `route:billing/billingWebhookRoutes.ts`
- `route:billing/clientBillingRoutes.ts`
- `route:billing/subscriptionRoutes.ts`
- `route:brand-kit/brandKitRoutes.ts`
- `route:brand-voice/brandVoiceRoutes.ts`
- `route:bulk-scheduling/bulkScheduleRoutes.ts`
- `route:campaigns/campaignRoutes.ts`
- `route:channels/channelRoutes.ts`
- `route:comments/commentRoutes.ts`
- `route:compliance/complianceRoutes.ts`
- `route:content/contentRoutes.ts`
- `route:crm/crmRoutes.ts`
- `route:custom-reports/customReportRoutes.ts`
- `route:external-notifications/externalNotificationRoutes.ts`
- `route:first-comment/firstCommentRoutes.ts`
- `route:health/healthRoutes.ts`
- `route:inbox/conversationNoteRoutes.ts`
- `route:inbox/inboxRoutes.ts`
- `route:index.ts`
- `route:integrations/makeRoutes.ts`
- `route:integrations/zapierRoutes.ts`
- `route:links/linkRoutes.ts`
- `route:listening/listeningRoutes.ts`
- `route:monitoring/cacheStatsRoutes.ts`
- `route:notifications/notificationRoutes.ts`
- `route:onboarding/onboardingRoutes.ts`
- `route:outbox/outboxAdminRoutes.ts`
- `route:posts/optimizedPostsRoutes.ts`
- `route:posts/postRoutes.ts`
- `route:projects/crisisRoutes.ts`
- `route:projects/projectRoutes.ts`
- `route:providers/providerRoutes.ts`
- `route:recurring/recurringPostRoutes.ts`
- `route:reports/reportRoutes.ts`
- `route:repurpose/repurposeRoutes.ts`
- `route:saga/SagaIntegration.ts`
- `route:scheduling/schedulingClientRoutes.ts`
- `route:settings/settingsRoutes.ts`
- `route:tasks/taskRoutes.ts`
- `route:team/teamRoutes.ts`
- `route:templates/templateRoutes.ts`
- `route:trends/trendRadarRoutes.ts`
- `route:trends/trendRoutes.ts`
- `route:usage/usageRoutes.ts`
- `route:utm/utmRoutes.ts`
- `route:webhooks/webhookDashboardRoutes.ts`
- `worker:mentionIngestWorker.ts`
- `worker:publishHandler.ts`
- `worker:publishWorker.ts`

## About this page

- **What a candidate is.** A file under `apps/api/src` named `*Routes.ts` or `routes.ts`, or one that registers a route with a path literal, comments ignored; a directory of `packages/core` that holds a `package.json`; a `*Worker.ts` or `*Handler.ts` file directly under `apps/workers/src`; a value of `QUEUE_NAMES` in `packages/adapters/queue-bullmq/src/constants.ts`; and a first route segment of the Admin and client apps under `app/[locale]`, where a route group and the client's `dashboard` segment open into their children.
- **How it is classified.** Each candidate has an entry in `docs/support/classification/non-features.json`: `documented` with the `doc` whose page describes it, `non-feature` with a note giving the reason, or `pending` until its page is written. `pendingBaseline` must equal the pending count, so it falls with every page written and a new candidate cannot land unclassified.
- **What is no candidate.** A middleware, a shared library or a page at an app root, such as a dashboard home: a support page that describes one names it in its `paths`.

> Generated by `scripts/support/non-features.mjs` from `derived candidates` (sha256 `89f8969d3679`) and `docs/support/classification/non-features.json` (sha256 `817f2a5a4866`); never edit it by hand. `pnpm support:index` regenerates it and `pnpm check:support` fails when it is stale.

## Summary

| Measure      | Count |
| ------------ | ----- |
| documented   | 0     |
| non-feature  | 6     |
| pending      | 184   |
| unclassified | 0     |

## Documented

| Support page | Candidates it documents |
| ------------ | ----------------------- |
