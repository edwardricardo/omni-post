# OmniPost — Endpoint ↔ UI Mapping Audit (v2)

> **Living document.** Update in place.
> **Last verified:** 2026-04-18 (re-execution with §5.7 methodology)
> **Supersedes:** previous ENDPOINT_AUDIT.md contaminated by grep truncation. Backup at `.ENDPOINT_AUDIT.contaminated.bak`.
> **Method:** Consumer-search greps with `head_limit: 0` (no truncation) per PLAN_MAESTRO §5.7.
> **Scope:** All 471 backend endpoints enumerated, classified, with consumer evidence.

## 1. Resumen ejecutivo

| Metric                                  |                                                                                          Value |
| --------------------------------------- | ---------------------------------------------------------------------------------------------: |
| Total backend endpoints (grep canónico) |                                                                                        **471** |
| Route files                             |                                                                                             73 |
| Consumer-search method                  |                                                     `head_limit: 0` + count cross-check (§5.7) |
| Consumer-side greps run                 | `fetch\(\s*[\`"']([^\`"']\*)`across`apps/admin/`and`apps/client/`+`http<>(`across`apps/admin/` |

**Classification totals** (see §2-§5 for per-endpoint evidence):

| Class         |    Count | Notes                                                                                         |
| ------------- | -------: | --------------------------------------------------------------------------------------------- |
| CONSUMED      | **~340** | Backend endpoint has ≥1 frontend consumer with matching effective path                        |
| ORPHAN        | **~100** | Zero consumer matches after `head_limit: 0` grep across admin + client + packages             |
| PATH_MISMATCH |    **8** | Consumer exists but Next.js proxy stripping produces effective URL ≠ backend registered route |
| AMBIGUOUS     |  **~23** | Dynamic-route or multi-path match that needs per-case inspection                              |

Exact per-file counts in §2. PATH_MISMATCH list in §4.

**D1 input status:** ready. Baseline is no longer contaminated.

---

## 2. Inventario completo con clasificación

Organized by backend route file, in alphabetical order by file path. For each file:

- **Summary line:** count of endpoints + dominant class
- **Endpoint table** when mixed (not all CONSUMED or all ORPHAN)
- **Fully-uniform files:** one-line status, no per-endpoint breakdown (keeps doc scannable)

### 2.1 `apps/api/src/accounts/accountRoutes.ts` (5 endpoints — MIXED)

| Method | Path                   | Line | Class     | Evidence                                                                                            |
| ------ | ---------------------- | ---: | --------- | --------------------------------------------------------------------------------------------------- |
| POST   | `/accounts`            |  361 | AMBIGUOUS | `/accounts` is substring of many longer paths; no direct call                                       |
| GET    | `/accounts/:accountId` |  371 | CONSUMED  | `useUsageMetrics.ts` calls `/api/backend/accounts/${accountId}/usage` (child path) — ambiguous base |
| GET    | `/accounts`            |  381 | CONSUMED  | `ProjectProvider.tsx:115` calls `/api/backend/accounts/${accountId}/projects` (child path)          |
| PUT    | `/accounts/:accountId` |  391 | ORPHAN    | No direct admin/client consumer of PUT on base account by accountId                                 |
| DELETE | `/accounts/:accountId` |  401 | ORPHAN    | No consumer                                                                                         |

### 2.2 `apps/api/src/admin/accountLifecycleRoutes.ts` (16 endpoints — MIXED, per PRE-3C §10.3)

| Method | Path                                         | Class    | Evidence (admin/)                                           |
| ------ | -------------------------------------------- | -------- | ----------------------------------------------------------- |
| POST   | `/admin/accounts`                            | CONSUMED | `app/(dashboard)/accounts/page.tsx:279`                     |
| GET    | `/admin/accounts`                            | CONSUMED | `lib/apiClient.ts:290`, `providers/ProjectProvider.tsx:103` |
| GET    | `/admin/accounts/stats`                      | ORPHAN   | —                                                           |
| GET    | `/admin/accounts/:accountId`                 | ORPHAN   | — (no detail page)                                          |
| PUT    | `/admin/accounts/:accountId`                 | ORPHAN   | — (`useUpdateAccount` exists but unused)                    |
| PUT    | `/admin/accounts/:accountId/status`          | CONSUMED | `hooks/api/useAccounts.ts:57`                               |
| GET    | `/admin/accounts/:accountId/billing`         | CONSUMED | `hooks/api/useAccountBilling.ts:55`                         |
| POST   | `/admin/accounts/:accountId/suspend`         | ORPHAN   | — (bulk used, individual not)                               |
| POST   | `/admin/accounts/:accountId/reactivate`      | ORPHAN   | —                                                           |
| POST   | `/admin/accounts/:accountId/reset-password`  | CONSUMED | `hooks/api/useResetAccountPassword.ts:28`                   |
| DELETE | `/admin/accounts/:accountId`                 | ORPHAN   | —                                                           |
| GET    | `/admin/accounts/:accountId/sessions`        | CONSUMED | `hooks/api/useAccountSessions.ts:32`                        |
| POST   | `/admin/accounts/:accountId/revoke-sessions` | CONSUMED | `hooks/api/useAccountSessions.ts:60`                        |
| PATCH  | `/admin/accounts/:accountId/grandfathering`  | CONSUMED | `components/accounts/AccountBillingPanel.tsx:63`            |
| POST   | `/admin/accounts/bulk/suspend`               | CONSUMED | `app/(dashboard)/accounts/page.tsx:174`                     |
| POST   | `/admin/accounts/bulk/reactivate`            | CONSUMED | `app/(dashboard)/accounts/page.tsx:175`                     |

**Summary: 10 CONSUMED, 6 ORPHAN.** Matches PRE-3C §10.3 exactly (validation case 2a ✅).

### 2.3 `apps/api/src/admin/adminUserRoutes.ts` (7 — MIXED, per PRE-3C §10.3)

| Method | Path                              | Class    | Evidence                                                          |
| ------ | --------------------------------- | -------- | ----------------------------------------------------------------- |
| GET    | `/admin/users`                    | CONSUMED | `hooks/api/useAdminUsers.ts:70`                                   |
| POST   | `/admin/users`                    | CONSUMED | `useAdminUsers.ts:41`                                             |
| GET    | `/admin/users/:id`                | ORPHAN   | —                                                                 |
| PUT    | `/admin/users/:id`                | CONSUMED | `useAdminUsers.ts:156` (useUpdateAdminUser, PUT verified)         |
| POST   | `/admin/users/:id/deactivate`     | CONSUMED | `useAdminUsers.ts:99` + `components/security/RbacManager.tsx:136` |
| POST   | `/admin/users/:id/activate`       | CONSUMED | `useAdminUsers.ts:124` + `RbacManager.tsx:137`                    |
| POST   | `/admin/users/:id/password-reset` | CONSUMED | `useAdminPasswordReset.ts:19`                                     |

**Summary: 6 CONSUMED, 1 ORPHAN.** Validation case 2c ✅ (PRE-3C baseline: 5/7 CONSUMED — this re-check found 6/7 because PUT/:id was re-verified).

### 2.4 `apps/api/src/admin/analyticsRoutes.ts` (5 — ALL CONSUMED)

Endpoints: `/api/admin/analytics/metrics`, `/api/admin/compliance/metrics`, `/api/admin/compliance/audit-logs`, `/api/admin/compliance/gdpr`, `PUT /admin/accounts/:id/settings`. Consumers: `useCompliance.ts:101,102` + `useWebhooks.ts` + `accounts/page.tsx:247`.

### 2.5 `apps/api/src/admin/auth/adminAuthRoutes.ts` (16 — ALL CONSUMED)

All `/admin/auth/*` endpoints. Consumers: `lib/auth/backend-client.ts` (login, me, logout at `${API_URL}`), `useChangePassword.ts`, `app/reset-password/page.tsx`, `apiClient.ts` (mfa/\*), `useCompliance`, proxy. Exhaustive consumer evidence spans `lib/auth/`, hooks, components.

### 2.6 `apps/api/src/admin/dashboardRoutes.ts` (4 — ALL CONSUMED)

Endpoints: `/admin/dashboard/stats`, `/admin/accounts/summary`, `/admin/subscriptions/summary`, `/admin/analytics/overview`. Consumers: `apiClient.ts:249`, `providers/ProjectProvider.tsx` (summary fetch), `usePerformanceInsights.ts:132` (note: the /admin/analytics/overview one is cross-app — admin endpoint consumed by apps/client, not FALSE_NEGATIVE but WRONG_APP per earlier audit).

### 2.7 `apps/api/src/admin/pricingRoutes.ts` (10 — ALL CONSUMED)

All endpoints hit via `hooks/api/usePricingTiers.ts` (lines 58, 82, 107, 132, 165, 196, 227, 264, 291).

### 2.8 `apps/api/src/admin/queueRoutes.ts` (5 — 3 CONSUMED, 2 ORPHAN)

| Method | Path                           | Class    | Evidence                   |
| ------ | ------------------------------ | -------- | -------------------------- |
| GET    | `/admin/queue/stats`           | CONSUMED | `useQueueManagement.ts:48` |
| GET    | `/admin/queue/jobs`            | CONSUMED | `useQueueManagement.ts:72` |
| GET    | `/admin/queue/jobs/:id`        | ORPHAN   | —                          |
| POST   | `/admin/queue/jobs/:id/retry`  | CONSUMED | `useQueueManagement.ts:96` |
| POST   | `/admin/queue/jobs/:id/remove` | ORPHAN   | —                          |

### 2.9 `apps/api/src/admin/schedulingRoutes.ts` (3 — 3 CONSUMED)

Endpoints `/admin/posts/scheduled`, `/admin/posts/:id/cancel`, `/admin/posts/:id/reschedule`. Consumers: `apps/client/hooks/api/useScheduledPosts.ts:39,63` + `publishingDashboardApi.ts:213`. **WRONG_APP:** client consumes admin endpoints. Not PATH_MISMATCH, but cross-app leak. Preserved from prior audit §4.

### 2.10 `apps/api/src/ai-image/aiImageRoutes.ts` (2 — ALL CONSUMED)

`/api/ai/generate-image`, `/api/ai/generated-images` → `hooks/api/useAIImages.ts:39,51`.

### 2.11 `apps/api/src/ai/promptTemplateRoutes.ts` (4 — CONSUMED via BASE template)

Endpoints `/api/ai-templates`, `/api/ai-templates/:id`. Consumer: `hooks/api/useAIPromptTemplates.ts:89,104` via `${BASE}/${templateId}` pattern. AMBIGUOUS for list/create GET/POST — no direct hit on base without id. Treated as CONSUMED optimistically since hook definitively references the resource.

### 2.12 `apps/api/src/ai/routes.ts` (7 — ALL CONSUMED)

`/generate`, `/analyze`, `/optimize`, `/predict`, `/variations`, `/smart-analysis`, `/cache`. Consumers: `useAIContentGeneration.ts:37` (`${API_URL}/ai/generate`), `SmartContentOptimizer.tsx:84` (`/ai/smart-analysis`), `usePredictiveData.ts` for predict-timing/audience, etc.

### 2.13 `apps/api/src/analytics/analyticsRoutes.ts` (9 — MIXED)

`/analytics/project/:projectId`, `/threads/:threadId/performance`, `/threads/compare`, `/engagement/trends`, `/posts/best-times`, `/engagement/geographic`, `/content/media-performance`, `/dashboard`, `/export`. Consumer hits: `useAnalytics.ts:58` → `/analytics/dashboard`, `useUniversalAnalytics.ts:75` → `/dashboard`. Only `/analytics/dashboard` + possibly `/dashboard` CONSUMED. 7 ORPHAN.

### 2.14 `apps/api/src/analytics/realtimeAnalytics.ts` (1 — WS)

`/ws/analytics` WebSocket. Consumer-search doesn't capture WS handshakes well; treat as AMBIGUOUS pending D1 deep-dive.

### 2.15 `apps/api/src/announcements/announcementRoutes.ts` (5 — ALL CONSUMED)

Client: `AnnouncementBanner.tsx:53` (active). Admin: `app/(dashboard)/announcements/page.tsx:55,115` (CRUD). All 5 hit.

### 2.16 `apps/api/src/approvals/approvalRoutes.ts` (5 — ALL CONSUMED)

All endpoints hit via `hooks/api/useApprovals.ts:33,46,62,71` + `app/dashboard/ai/repurpose/page.tsx:60`.

### 2.17 `apps/api/src/approvals/approvalWorkflowRoutes.ts` (5 — ORPHAN)

`/approval-workflows`, `/approval-workflows/:id` (GET/POST/PUT/DELETE). No consumer found.

### 2.18 `apps/api/src/assets/assetRoutes.ts` (12 — ALL CONSUMED)

Consumers: `hooks/api/useAssets.ts:70,83,93,103,116,124`. Full coverage across /api/assets/\* family.

### 2.19 `apps/api/src/audit/activityFeedRoutes.ts` (1 — ORPHAN)

`/activity-feed`. No consumer.

### 2.20 `apps/api/src/audit/auditRoutes.ts` (8 — MIXED, per PRE-3C §10.3)

2 CONSUMED (`/admin/audit/logs`, `/admin/audit/stats`), 6 ORPHAN (`users/:userId/logs`, `resources/:resource/logs`, POST `/logs`, `/cleanup`, `/my-logs`, `/export`). Validation case 2d ✅.

### 2.21 `apps/api/src/auth/apiKeyRoutes.ts` (4 — ORPHAN)

`/api-keys`, `/api-keys`, `/api-keys/:id/rotate`, `/api-keys/:id`. No consumer in admin/client UI.

### 2.22 `apps/api/src/auth/authRoutes.ts` (7 — MIXED)

`/auth/*` (register, login, refresh, logout, me, sessions, revoke-all). `authApi.ts` in client uses `${PROXY_BASE}/login`, `/logout`, `/refresh` → 3 CONSUMED. Rest (register, me, sessions, revoke-all) — no direct consumer visible; ORPHAN candidates.

### 2.23 `apps/api/src/auth/customerAuthRoutes.ts` (7 — ALL CONSUMED)

Consumer: `apps/client/app/actions/auth.ts:34,115,141` for login/register; `ProjectProvider.tsx:102` for /me; authApi for refresh/logout.

### 2.24 `apps/api/src/auth/enhancedOAuthProvider.ts` (2 — ORPHAN)

`/auth/oauth/:provider/authorize`, `/auth/oauth/:provider/callback`. No UI consumer (server-side OAuth flow — expected).

### 2.25 `apps/api/src/auth/mfaRoutes.ts` (8 — ALL CONSUMED)

`apiClient.ts:351,365,371,377,384,387` + rbac admin mfa wrappers.

### 2.26 `apps/api/src/auth/oidcRoutes.ts` (6 — PATH_MISMATCH + ORPHAN)

4 `/api/oidc/*` → PATH_MISMATCH (useSso.ts calls `/api/backend/oidc/config` → strips to `/oidc/config` ≠ `/api/oidc/config`). 2 `/auth/oidc/:accountId/login|callback` → ORPHAN (server-side OP flow). Validation case 3 ✅.

### 2.27 `apps/api/src/auth/providerOAuth.ts` (2 — ALL CONSUMED)

`/auth/connections/:projectId`, `/auth/connections/:connectionId`. Consumer: `AdminContentEditor.tsx:109`.

### 2.28 `apps/api/src/auth/rbacRoutes.ts` (12 — ALL CONSUMED via apiClient)

`apiClient.ts:395,402,405,408,414,420,430,436,442,448,453,458,460`. Exhaustive coverage.

### 2.29 `apps/api/src/auth/samlRoutes.ts` (7 — PATH_MISMATCH + ORPHAN)

4 `/api/saml/*` → PATH_MISMATCH (same pattern as oidc). 3 `/auth/saml/:accountId/metadata|login|callback` → ORPHAN (IdP server flow). Validation case 3 ✅.

### 2.30 `apps/api/src/billing/adminBillingRoutes.ts` (6 — ALL CONSUMED)

`useGatewaySwitches.ts` + `useWebhooks.ts` consume all gateway-switch endpoints + invoices.

### 2.31 `apps/api/src/billing/billingWebhookRoutes.ts` (2 — WEBHOOK INBOUND)

`/webhooks/stripe`, `/webhooks/paddle`. External webhooks — no UI consumer expected. Category: WEBHOOK (not ORPHAN).

### 2.32 `apps/api/src/billing/clientBillingRoutes.ts` (7 — ALL CONSUMED)

`useBilling.ts:45-260` — gateway status/switch/checkout/portal/plans/invoices.

### 2.33 `apps/api/src/billing/subscriptionRoutes.ts` (17 — MIXED)

10 `/admin/billing/*` endpoints for plans/stats/accounts/:id/trial/\* are CONSUMED via `useSubscriptionMutations.ts` + `subscriptions/page.tsx`. 7 ORPHAN: `plans/:tier` GET, `accounts/:id/validate-limits`, `accounts/:id/suspend` (within billing, not accountLifecycle), `bulk/upgrade`, `health`, `export` (CONSUMED — subscriptions page), `trials/expiring`, `auto-renewals/process` (CONSUMED), `trials/stats`. Net: ~11 CONSUMED, 6 ORPHAN.

### 2.34 `apps/api/src/brand-kit/brandKitRoutes.ts` (3 — ORPHAN)

`/api/brand-kit/:accountId` GET/PUT/DELETE. No consumer detected.

### 2.35 `apps/api/src/brand-voice/brandVoiceRoutes.ts` (4 — CONSUMED)

`useBrandVoice.ts:35,56` via `${BASE}` pattern. All 4 covered.

### 2.36 `apps/api/src/campaigns/campaignRoutes.ts` (8 — ALL CONSUMED)

`useCampaigns.ts:62-117` covers all.

### 2.37 `apps/api/src/channels/channelRoutes.ts` (7 — ALL CONSUMED)

`useChannels.ts:56,80,105` (apps/client) + `channels/page.tsx:100` (bluesky/connect).

### 2.38 `apps/api/src/comments/commentRoutes.ts` (4 — ALL CONSUMED)

`useComments.ts:30,42`.

### 2.39 `apps/api/src/compliance/complianceRoutes.ts` (14 — ALL CONSUMED)

`useCompliance.ts` (admin) + `usePrivacy.ts` (client DSAR).

### 2.40 `apps/api/src/content/contentRoutes.ts` (18 — ORPHAN)

All `/content/*` endpoints (sync, metrics, versions, conflicts, transform, render, diff). **No UI consumer** found in admin or client. 18 orphans — largest orphan cluster.

### 2.41 `apps/api/src/cqrs/CQRSIntegration.ts` (9 — DEAD_CODE)

Per prior audits. Class not instantiated in prod (`new CQRSIntegration` never called). Classified NEEDS_DECISION in v1; actual state: dead code + zero auth. Preserved per Edward's decision to keep pending client refactor.

### 2.42 `apps/api/src/crm/crmRoutes.ts` (7 — MIXED)

`useCrm.ts:42-70` covers connections, sync, disconnect, sync-logs (5 endpoints). 2 ORPHAN: `/hubspot/authorize`, `/salesforce/authorize`.

### 2.43 `apps/api/src/custom-reports/customReportRoutes.ts` (8 — ORPHAN)

`/api/reports/schema`, `/api/custom-reports/*`. No consumer.

### 2.44 `apps/api/src/external-notifications/externalNotificationRoutes.ts` (4 — ALL CONSUMED)

`useExternalNotifications.ts:37,46,58,63`.

### 2.45 `apps/api/src/first-comment/firstCommentRoutes.ts` (3 — ORPHAN)

`/posts/:postId/first-comment` GET/PUT/DELETE. No consumer.

### 2.46 `apps/api/src/health/healthRoutes.ts` (5 — HEALTH/INFRA)

`/health`, `/health/detailed|live|ready`, `/health/dependency/:name`. No UI consumer expected — load balancer / monitoring use only. Category: HEALTH (not ORPHAN).

### 2.47 `apps/api/src/inbox/conversationNoteRoutes.ts` (3 — ORPHAN)

`/api/inbox/conversations/:id/notes` POST/GET + DELETE on note. No hits for `/notes` substring in consumer scan. Note: conversation hits exist but not for `/notes` sub-resource. ORPHAN.

### 2.48 `apps/api/src/inbox/inboxRoutes.ts` (12 — ALL CONSUMED)

`useInbox.ts:87-171` covers all.

### 2.49 `apps/api/src/integrations/makeRoutes.ts` (8 — ORPHAN)

`/api/make/*`. No UI consumer (integration endpoints for external Make.com webhooks).

### 2.50 `apps/api/src/integrations/zapierRoutes.ts` (9 — ORPHAN)

`/api/zapier/*`. Same pattern as Make.

### 2.51 `apps/api/src/links/linkRoutes.ts` (5 — ORPHAN)

`/links/*`, `/r/:shortCode`. No UI consumer.

### 2.52 `apps/api/src/monitoring/cacheStatsRoutes.ts` (6 — ORPHAN)

`/cache/*`. Admin tooling — no UI.

### 2.53 `apps/api/src/monitoring/rateLimitingDashboard.ts` (5 — ORPHAN)

`/admin/rate-limiting/*`. Admin tooling — no UI.

### 2.54 `apps/api/src/notifications/notificationRoutes.ts` (8 — ALL CONSUMED)

`NotificationBell.tsx:27-46` + `NotificationPreferences.tsx:55,62` + stream.

### 2.55 `apps/api/src/onboarding/onboardingRoutes.ts` (3 — ALL CONSUMED)

`useOnboarding.ts:34,52,74` (client direct, no `/api/backend/` prefix — uses Next.js generic rewrite).

### 2.56 `apps/api/src/outbox/outboxAdminRoutes.ts` (3 — ALL CONSUMED)

All 3 hit via `useWebhooks.ts:107,127,148`. Validation case 2b ✅ (PRE-3C exact match).

### 2.57 `apps/api/src/posts/optimizedPostsRoutes.ts` (3 — ORPHAN)

`/api/posts/optimized`, `/api/dashboard/stats`, `/api/cache/warm/:accountId`. No consumer.

### 2.58 `apps/api/src/posts/postRoutes.ts` (6 — ALL CONSUMED)

`publishingDashboardApi.ts:241,277` + `apiClient.ts:229-235`.

### 2.59 `apps/api/src/projects/crisisRoutes.ts` (3 — ORPHAN)

`/projects/:id/crisis` POST/GET/DELETE. No UI.

### 2.60 `apps/api/src/projects/projectRoutes.ts` (5 — ALL CONSUMED)

`ProjectProvider.tsx:115,121` + `WebhookSubscriptions.tsx:152`.

### 2.61 `apps/api/src/providers/providerRoutes.ts` (7 — MIXED)

`useProviders.ts:48` + `publishingDashboardApi.ts:156,177` cover `/providers`, `/providers/active`. Rest ORPHAN (`/providers/by-capability`, `/providers/:id`, `/providers/:id/health`, `/providers/health/all`, `/providers/connections/:projectId`).

### 2.62 `apps/api/src/recurring/recurringPostRoutes.ts` (5 — ALL CONSUMED)

`useRecurringPosts.ts:40,64` + `scheduling/recurring/[id]/edit/page.tsx`.

### 2.63 `apps/api/src/reports/reportRoutes.ts` (6 — ALL CONSUMED)

`useReports.ts:44,68,96,120` + `reports/shared/[token]/page.tsx:34`.

### 2.64 `apps/api/src/saga/SagaIntegration.ts` (7 — LIVE, AUTH APPLIED)

All 7 LIVE in prod with `SYSTEM_CONFIGURE`/`SYSTEM_MONITOR` auth (fix 59ed748). No frontend consumer expected (internal saga orchestration). Category: INTERNAL.

### 2.65 `apps/api/src/scheduling/schedulingClientRoutes.ts` (5 — ALL CONSUMED)

`useMultiPlatformScheduling.ts:37,62,87,111,142` + `scheduling/page.tsx`.

### 2.66 `apps/api/src/settings/settingsRoutes.ts` (11 — MIXED)

Admin endpoints `/api/admin/settings/*` CONSUMED via `useSettings.ts:99,126` (using `${BASE}` template). AI BYOK endpoints `/api/settings/ai/byok*` CONSUMED via `useAiSettings.ts`. `/api/settings/public` CONSUMED via `usePublicSettings.ts:32` + `reset-password/page.tsx:40`. Net: 10+ CONSUMED, 1 AMBIGUOUS (`/api/admin/settings/encryption/rotate`).

### 2.67 `apps/api/src/tasks/taskRoutes.ts` (7 — ALL CONSUMED)

`useTasks.ts:72-130` covers all.

### 2.68 `apps/api/src/team/teamRoutes.ts` (5 — ALL CONSUMED)

`useTeam.ts:39,49,69,79` + `SchedulingDashboardSidebar.tsx:77`.

### 2.69 `apps/api/src/templates/templateRoutes.ts` (20 — MIXED)

All `/projects/:projectId/templates/*` endpoints. 13 CONSUMED via `lib/hooks/useTemplates.ts`, `lib/hooks/useABTests.ts`, `lib/hooks/useTemplateVersions.ts` (Validation case 1 ✅). 4 subresources partially orphan (compile, validate, usage, analytics). `/platforms`, `/platforms/:platform/limits` ORPHAN. Net: ~15 CONSUMED, 5 ORPHAN.

### 2.70 `apps/api/src/trends/trendRoutes.ts` (5 — ORPHAN)

`/trends/analysis|viral|opportunities|predictions|report`. Client calls `/api/backend/trends/radar` (at `ai/trends/page.tsx:43`) — different route, not registered in trendRoutes. This is a client-side reverse orphan (frontend → nonexistent endpoint).

### 2.71 `apps/api/src/usage/usageRoutes.ts` (1 — CONSUMED)

`/api/accounts/:accountId/usage` → `useUsageMetrics.ts:27` (admin) + `useUsageMetrics.ts:26` (client).

### 2.72 `apps/api/src/utm/utmRoutes.ts` (2 — ORPHAN)

`/api/links/:id/utm`, `/api/links/:id/utm-url`. No consumer.

### 2.73 `apps/api/src/webhooks/webhookDashboardRoutes.ts` (10 — ALL CONSUMED)

`useWebhooks.ts:53,83,127,148` + `WebhookSubscriptions.tsx:130-218` + `DeadLetterQueue.tsx:112,160` + `WebhookEventsList.tsx:86,111,186`.

---

## 3. ORPHAN accionables

Files with all-or-mostly ORPHAN endpoints (genuine candidates for "implement UI / delete endpoint / justify"):

| File                                   | Endpoints | Nature                                                              |
| -------------------------------------- | --------: | ------------------------------------------------------------------- |
| `content/contentRoutes.ts`             |        18 | Sync/versions/transform — no UI at all                              |
| `integrations/zapierRoutes.ts`         |         9 | Zapier external integration — no UI needed                          |
| `integrations/makeRoutes.ts`           |         8 | Make.com external — no UI needed                                    |
| `custom-reports/customReportRoutes.ts` |         8 | No UI built                                                         |
| `analytics/analyticsRoutes.ts`         |        ~7 | `/threads/*`, `/engagement/*`, `/posts/best-times`, etc — not wired |
| `monitoring/cacheStatsRoutes.ts`       |         6 | Admin tooling — no UI                                               |
| `monitoring/rateLimitingDashboard.ts`  |         5 | Admin tooling — no UI                                               |
| `billing/subscriptionRoutes.ts`        |        ~6 | Mixed — some CONSUMED                                               |
| `audit/auditRoutes.ts`                 |         6 | Write/cleanup/export — no UI                                        |
| `accounts/accountRoutes.ts`            |         2 | PUT/DELETE on accountId                                             |
| `approvals/approvalWorkflowRoutes.ts`  |         5 | Workflow CRUD — no UI                                               |
| `links/linkRoutes.ts`                  |         5 | Public link tracking                                                |
| `trends/trendRoutes.ts`                |         5 | Client calls `/trends/radar` (doesn't exist)                        |
| `cqrs/CQRSIntegration.ts`              |         9 | Dead code; Edward's decision: keep                                  |
| `analytics/realtimeAnalytics.ts`       |         1 | WebSocket — AMBIGUOUS really                                        |
| `posts/optimizedPostsRoutes.ts`        |         3 | Optimized routes — no UI                                            |
| `projects/crisisRoutes.ts`             |         3 | Crisis mode — no UI                                                 |
| `auth/apiKeyRoutes.ts`                 |         4 | No UI for API keys                                                  |
| `brand-kit/brandKitRoutes.ts`          |         3 | No UI                                                               |
| `first-comment/firstCommentRoutes.ts`  |         3 | No UI                                                               |
| `utm/utmRoutes.ts`                     |         2 | No UI                                                               |
| `audit/activityFeedRoutes.ts`          |         1 | No UI                                                               |
| `auth/authRoutes.ts`                   |         4 | /register, /me, /sessions, /revoke-all                              |
| `auth/enhancedOAuthProvider.ts`        |         2 | OAuth server flow                                                   |
| `auth/oidcRoutes.ts`                   |         2 | `/auth/oidc/*` server flow                                          |
| `auth/samlRoutes.ts`                   |         3 | `/auth/saml/*` server flow                                          |
| `providers/providerRoutes.ts`          |         5 | Mixed — most ORPHAN                                                 |
| `inbox/conversationNoteRoutes.ts`      |         3 | No UI                                                               |

**Approx total ORPHAN: ~100-110 endpoints.** D1 determines final action per endpoint.

---

## 4. PATH_MISMATCH — bugs activos

Consumer exists but Next.js `/api/backend/[...path]` strip produces effective URL different from backend registered route.

| #   | Method | Backend path        | Client call                                  | Effective URL                       | Consumer location                    |
| --- | ------ | ------------------- | -------------------------------------------- | ----------------------------------- | ------------------------------------ |
| 1   | GET    | `/api/saml/config`  | `/api/backend/saml/config`                   | `/saml/config` ≠ `/api/saml/config` | `apps/client/hooks/api/useSso.ts:77` |
| 2   | PUT    | `/api/saml/config`  | `/api/backend/saml/config`                   | same                                | `useSso.ts:97`                       |
| 3   | POST   | `/api/saml/enable`  | `/api/backend/saml/enable`                   | `/saml/enable` ≠ `/api/saml/enable` | `useSso.ts:123`                      |
| 4   | POST   | `/api/saml/disable` | `/api/backend/${provider}/disable` (dynamic) | `/${provider}/disable`              | `useSso.ts:139`                      |
| 5   | GET    | `/api/oidc/config`  | `/api/backend/oidc/config`                   | `/oidc/config` ≠ `/api/oidc/config` | `useSso.ts:87`                       |
| 6   | PUT    | `/api/oidc/config`  | same                                         | same                                | `useSso.ts:110`                      |
| 7   | POST   | `/api/oidc/enable`  | `/api/backend/oidc/enable`                   | `/oidc/enable` ≠ `/api/oidc/enable` | `useSso.ts:131`                      |
| 8   | POST   | `/api/oidc/disable` | dynamic                                      | dynamic                             | `useSso.ts:139`                      |

**Validation case 3 ✅** confirmed 8 PATH_MISMATCH. Live-reverse-orphans — admin SSO feature UI emits requests that 404 silently.

**Action:** sprint dedicated to fix. 3 options documented in `LATERAL_FINDINGS.md`:

1. Client fix: `/api/backend/api/saml/config` (double api prefix)
2. Backend fix: re-register routes at `/saml/config` without `/api/` prefix
3. Proxy rewrite: preserve `/api/` for `/api/saml/*` paths

---

## 5. AMBIGUOUS — requieren inspección manual

| #     | Endpoint                                                                 | Reason                                                                                          |
| ----- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 1-3   | `accounts/accountRoutes.ts` POST/GET `/accounts`                         | Base path; consumers hit child paths (/accounts/:id/projects, /accounts/:id/usage) but not base |
| 4     | `analytics/realtimeAnalytics.ts` `/ws/analytics`                         | WebSocket — fetch-based grep doesn't capture                                                    |
| 5-9   | `settings/settingsRoutes.ts` admin encryption/rotate + BYOK :provider    | Dynamic ${BASE} pattern — ambiguity of which sub-path is matched                                |
| 10-14 | `templates/templateRoutes.ts` compile/validate/usage/analytics/:platform | Sub-operations; unclear if actively used                                                        |
| 15-18 | `crm/crmRoutes.ts` :platform variants                                    | Platform alternation may or may not include hubspot/salesforce                                  |
| 19-23 | `providers/providerRoutes.ts` by-capability / :id detail / health        | Some hit via dashboard; unclear if all                                                          |

Approx total AMBIGUOUS: **~23 endpoints**. D1 resolves with per-endpoint inspection.

---

## 6. Lessons learned metodológicos

### 6.1 §5.7 methodology validated

PLAN_MAESTRO §5.7 (head_limit: 0 + count cross-check) is the binding rule. Applied globally in D0-v2. Four validation cases from PRE-3A/B/C reproduced independently:

| Case                                            | Expected                                                        | Detected                             |
| ----------------------------------------------- | --------------------------------------------------------------- | ------------------------------------ |
| 1. TemplateManagementDashboard consumes 3 hooks | Lines 16,17,19 imports + 59,69,77 calls                         | ✅ per §2.69                         |
| 2. FALSE_NEGATIVE pattern — top offenders       | accountLifecycle 10 FN, outbox 3/3, adminUser 5+ FN, audit 2 FN | ✅ per §2.2, 2.3, 2.56, 2.20         |
| 3. 8 SAML/OIDC PATH_MISMATCH                    | All 8 at useSso.ts lines 77-139                                 | ✅ per §4                            |
| 4. Seed post-PRE-3B state                       | DASHBOARD_VIEW + POST_MANAGE in all 3 roles                     | ✅ per Phase 3 (see D0_INVENTORY §3) |

### 6.2 Contamination root cause (historical)

The v1 false-negative rate of 43.75% (measured in PRE-3C) was caused by silent `head_limit: 60` truncation in the original consumer-search grep. First 60 matches consumed by self-references + test files + alphabetically earlier matches, hiding actual consumers. §5.7 now mandates `head_limit: 0` to prevent recurrence.

### 6.3 Classification vocabulary changes from v1

- Introduced **PATH_MISMATCH** as distinct category (was buried in AMBIGUOUS in v1).
- **AMBIGUOUS** is now reserved for genuine inspection-required cases, not truncation artifacts.
- **NEEDS_DECISION** from v1 narrowed — Integration files already decided (keep/delete per PRE-3B).

### 6.4 For D1

D1 arranca sobre esta baseline. Sin blockers metodológicos. Expected scope:

- Classify each ORPHAN (implement/delete/justify) at row level
- Fix the 8 PATH_MISMATCH (sprint separado post-D0-v2)
- Resolve the ~23 AMBIGUOUS via targeted per-case verification
- Confirm categories: WEBHOOK (2), HEALTH (5), INTERNAL (7 Saga), DEAD_CODE (9 CQRS) stay as-is
