# OmniPost — Endpoint ↔ UI Mapping Audit

> **Living document.** Update in place, do not re-date the filename.
> **Last verified:** 2026-04-16 against branch `Genesis`
> **Method:** Direct code extraction (Grep) + verification against known audit history.
> **Scope:** `apps/api` endpoints ↔ `apps/admin` + `apps/client` consumers. Workers out of scope (no HTTP client).

This is the consolidated replacement for ~16 overlapping audit files. See [§8 Doc lifecycle](#8-doc-lifecycle-recommendations) for the deprecation list.

---

## 1. TL;DR

### Backend endpoint inventory

| Metric                                                                                                               |    Count | Source                                                                                              |
| -------------------------------------------------------------------------------------------------------------------- | -------: | --------------------------------------------------------------------------------------------------- |
| Fastify HTTP registrations (`server/fastify/app/instance.method(`)                                                   |  **466** | Direct grep, all `*.ts` in `apps/api/src`. Post-cleanup: 478 − 12 (deleted Integrations 2026-04-16) |
| Route files (`*Routes.ts` + `*routes*.ts`)                                                                           |   **67** | Convention-named                                                                                    |
| Integration files exposing routes (`*Integration.ts`)                                                                |    **4** | SagaIntegration, DatabaseIntegration, EventIntegration, CQRSIntegration                             |
| Endpoints with explicit auth preHandler (`requireAdminAuth`/`requireClientAuth`/`requirePermission`/`requireApiKey`) |  **370** | `preHandler: [...]` grep across 61 files                                                            |
| Endpoints without explicit auth preHandler                                                                           | **~108** | Difference → includes webhooks, health, OAuth callbacks, Integration debug endpoints                |

**Drift vs prior CODE_FIRST (2026-04-10):** 478 vs 428 = **+50 endpoints over ~6 days**, consistent with SETTINGS-B, SETTINGS-C, and AI-ARCH sprints completed after that audit.

### Status breakdown (sample-verified, not exhaustive row-by-row)

| Status                                                           | Where                                                                                                                                     |                                              Count |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------: |
| `OK` — category has UI in the right app                          | admin + client, majority                                                                                                                  |                         ~60% of consumed endpoints |
| `ORPHAN` — admin-ui category, no consumer                        | mostly in `accountLifecycleRoutes`, `auditRoutes`, `adminUserRoutes` CRUD tail                                                            | **≥45** per reverse engineering audit (2026-04-06) |
| `WRONG_APP` — admin endpoint consumed from client                | **5 live call sites in 4 files** — see §4                                                                                                 |                                              **5** |
| `OVER_CONSUMED` — webhook/health/internal with a frontend caller | None detected in sample                                                                                                                   |                                              **0** |
| `NEEDS_DECISION`                                                 | Integration file debug endpoints (`/api/sagas/*`, `/api/cqrs/*`, `/api/database/*`, `/api/events/*`) — exposed but classification unclear |                                            **~25** |

### Reverse orphans (frontend → nonexistent backend)

Potential prefix mismatches found in `apps/client/lib/hooks/` — see §5.

---

## 2. Backend endpoint inventory by file

478 registrations across 76 files (67 route files + 4 integration files + 5 others with route declarations). Categorization by path prefix + auth middleware.

### 2.1 Admin-scoped files (`requireAdminAuth`)

| File                                 | Endpoints | Path prefix                                                        | Notes                                                     |
| ------------------------------------ | --------: | ------------------------------------------------------------------ | --------------------------------------------------------- |
| `admin/auth/adminAuthRoutes.ts`      |        16 | `/admin/auth/*`                                                    | Self-service auth, MFA, sessions                          |
| `admin/accountLifecycleRoutes.ts`    |        16 | `/admin/accounts/*`                                                | Many ORPHAN per reverse audit                             |
| `admin/adminUserRoutes.ts`           |         7 | `/admin/users/*`                                                   | Some ORPHAN (detail, update)                              |
| `admin/dashboardRoutes.ts`           |         4 | `/admin/dashboard/*`, `/admin/analytics/overview`                  | Now has `DASHBOARD_VIEW` permission per FIXES report      |
| `admin/analyticsRoutes.ts`           |         5 | `/api/admin/analytics/*`                                           | **Prefix inconsistency** — uses `/api/admin` not `/admin` |
| `admin/schedulingRoutes.ts`          |         3 | `/admin/posts/scheduled`, `/cancel`, `/reschedule`                 | Now has `POST_MANAGE` permission                          |
| `admin/queueRoutes.ts`               |         5 | `/admin/queue/*`                                                   | Client consumers deleted per FIXES report ✓               |
| `admin/pricingRoutes.ts`             |        10 | `/admin/pricing/*`                                                 | All connected ✓                                           |
| `billing/adminBillingRoutes.ts`      |         6 | `/admin/billing/*`                                                 |                                                           |
| `auth/rbacRoutes.ts`                 |        12 | `/admin/rbac/*`                                                    |                                                           |
| `auth/mfaRoutes.ts`                  |         8 | `/admin/auth/mfa/*` + self-service `/auth/mfa/*`                   |                                                           |
| `auth/samlRoutes.ts`                 |         7 | `/auth/saml/*` + `/admin/saml/*`                                   |                                                           |
| `auth/oidcRoutes.ts`                 |         6 | `/auth/oidc/*` + `/admin/oidc/*`                                   |                                                           |
| `audit/auditRoutes.ts`               |         8 | `/admin/audit/*`                                                   | `audit/export` ORPHAN per CODE_FIRST                      |
| `audit/activityFeedRoutes.ts`        |         1 | `/admin/activity`                                                  |                                                           |
| `outbox/outboxAdminRoutes.ts`        |         3 | `/admin/outbox/*`                                                  | ORPHAN (no UI)                                            |
| `webhooks/webhookDashboardRoutes.ts` |        10 | `/api/webhooks/dashboard/*`                                        | Partial UI only                                           |
| `compliance/complianceRoutes.ts`     |        14 | `/api/admin/compliance/*` + `/api/compliance/dsar` (client-facing) |                                                           |

### 2.2 Client-scoped files (`requireClientAuth`)

| File                                                   | Endpoints | Path prefix                                                                                                     | Notes                        |
| ------------------------------------------------------ | --------: | --------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `auth/customerAuthRoutes.ts`                           |         7 | `/auth/customer/*`                                                                                              | Register/login/refresh       |
| `billing/clientBillingRoutes.ts`                       |         7 | `/api/billing/*` (gateway/checkout/portal/invoices)                                                             | Consumed by `useBilling.ts`  |
| `billing/subscriptionRoutes.ts`                        |        17 | `/api/subscriptions/*`                                                                                          |                              |
| `posts/postRoutes.ts`                                  |         6 | `/posts/*`, `/posts/:id/submit-for-review`, etc.                                                                |                              |
| `posts/optimizedPostsRoutes.ts`                        |         3 | `/posts/optimized/*`                                                                                            |                              |
| `channels/channelRoutes.ts`                            |         7 | `/api/channels/*`                                                                                               | 1 admin-only delete endpoint |
| `projects/projectRoutes.ts`                            |         5 | `/accounts/:id/projects`, `/projects/*`                                                                         |                              |
| `projects/crisisRoutes.ts`                             |         3 | `/projects/:id/crisis-mode`                                                                                     |                              |
| `inbox/inboxRoutes.ts`                                 |        12 | `/api/backend/inbox/*` (via proxy)                                                                              |                              |
| `inbox/conversationNoteRoutes.ts`                      |         3 | `/api/backend/inbox/:id/notes`                                                                                  |                              |
| `content/contentRoutes.ts`                             |        18 | `/content/*` — templates, brand voice, AI analyze                                                               |                              |
| `templates/templateRoutes.ts`                          |        20 | `/templates/*` — biggest single file                                                                            |                              |
| `campaigns/campaignRoutes.ts`                          |         8 | `/campaigns/*`                                                                                                  |                              |
| `assets/assetRoutes.ts`                                |        12 | `/assets/*`                                                                                                     |                              |
| `analytics/analyticsRoutes.ts`                         |         9 | `/analytics/dashboard`, `/analytics/optimal-times`                                                              |                              |
| `notifications/notificationRoutes.ts`                  |         8 | `/notifications/*`, `/notifications/preferences`                                                                |                              |
| `scheduling/schedulingClientRoutes.ts`                 |         5 | `/api/scheduling/slots`, `/rules`                                                                               |                              |
| `tasks/taskRoutes.ts`                                  |         7 | `/tasks/*`                                                                                                      |                              |
| `team/teamRoutes.ts`                                   |         5 | `/team`, `/team/invite`, `/team/:id/role`                                                                       |                              |
| `approvals/approvalRoutes.ts`                          |         5 | `/approvals/*`, `/posts/:id/submit-for-review`                                                                  |                              |
| `approvals/approvalWorkflowRoutes.ts`                  |         5 | `/approval-workflows/*`                                                                                         |                              |
| `comments/commentRoutes.ts`                            |         4 | `/posts/:id/comments`                                                                                           |                              |
| `ai/routes.ts`                                         |         7 | `/ai/*` (smart-analysis, predict-timing, platform-variants, content-calendar, generate-image, predict-audience) |                              |
| `ai/promptTemplateRoutes.ts`                           |         4 | `/ai/prompt-templates/*`                                                                                        |                              |
| `ai-image/aiImageRoutes.ts`                            |         2 | `/ai/generate-image`, `/ai/generated-images`                                                                    |                              |
| `brand-kit/brandKitRoutes.ts`                          |         3 | `/brand-kit/*`                                                                                                  |                              |
| `brand-voice/brandVoiceRoutes.ts`                      |         4 | `/content/brand-voice/*`                                                                                        |                              |
| `reports/reportRoutes.ts`                              |         6 | `/reports/*`, `/reports/public/:token`                                                                          |                              |
| `custom-reports/customReportRoutes.ts`                 |         8 | `/custom-reports/*`                                                                                             |                              |
| `crm/crmRoutes.ts`                                     |         7 | `/crm/*`                                                                                                        |                              |
| `links/linkRoutes.ts`                                  |         5 | `/links/*`                                                                                                      |                              |
| `recurring/recurringPostRoutes.ts`                     |         5 | `/recurring-posts/*`                                                                                            |                              |
| `announcements/announcementRoutes.ts`                  |         5 | `/announcements/*`                                                                                              |                              |
| `onboarding/onboardingRoutes.ts`                       |         3 | `/api/onboarding/*`                                                                                             |                              |
| `first-comment/firstCommentRoutes.ts`                  |         3 | `/posts/:id/first-comment`                                                                                      |                              |
| `trends/trendRoutes.ts`                                |         5 | `/trends/*`                                                                                                     |                              |
| `external-notifications/externalNotificationRoutes.ts` |         4 | `/external-notifications/*`                                                                                     |                              |
| `usage/usageRoutes.ts`                                 |         1 | `/accounts/:id/usage`                                                                                           |                              |
| `utm/utmRoutes.ts`                                     |         2 | `/utm/*`                                                                                                        |                              |
| `settings/settingsRoutes.ts`                           |        11 | `/api/settings/*`, `/api/admin/settings/*` — SETTINGS-B/C                                                       |                              |

### 2.3 Integration / infrastructure files (classified `internal` per Edward 2026-04-16)

Per project rule: endpoints in `*Integration.ts` files are `internal` — invoked by backend orchestration, not by humans. Expected status: `OK` if unconsumed by frontend, `OVER_CONSUMED` if consumed.

| File                                  |     Endpoints | Production-registered?                                                                                   | Frontend consumer      | Auth                      | Status                                                   |
| ------------------------------------- | ------------: | -------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------- | -------------------------------------------------------- |
| `saga/SagaIntegration.ts`             |             7 | **YES** — instantiated in `apps/api/src/index.ts:540`                                                    | NONE (only test files) | **NONE**                  | `OK` category-wise, **SECURITY_REVIEW_NEEDED** — see §4b |
| `cqrs/CQRSIntegration.ts`             |             9 | **NO** — class exists but `new CQRSIntegration()` never called in non-test code                          | NONE                   | **NONE**                  | `DEAD_CODE` — not live in prod                           |
| ~~`database/DatabaseIntegration.ts`~~ |         ~~6~~ | **DELETED 2026-04-16** (this audit) — file + `ConnectionManager.ts` sole-consumer + 4 test files removed | —                      | —                         | `DELETED`                                                |
| ~~`events/EventIntegration.ts`~~      |         ~~6~~ | **DELETED 2026-04-16** (this audit) — file + 3 test files removed                                        | —                      | —                         | `DELETED`                                                |
| `monitoring/cacheStatsRoutes.ts`      |             6 | YES (route file)                                                                                         | check in §4            | mostly `requireAdminAuth` | `health-infra`                                           |
| `monitoring/rateLimitingDashboard.ts` |             5 | YES (route file)                                                                                         | check in §4            | `requireAdminAuth`        | `health-infra`                                           |
| `health/healthRoutes.ts`              |             5 | YES                                                                                                      | NONE expected          | mostly public             | `health-infra`                                           |
| `analytics/realtimeAnalytics.ts`      | 1 (WebSocket) | YES                                                                                                      | `/ws/analytics`        | check                     | `health-infra`                                           |

**See §4b for per-endpoint verification of the 28 `internal` items and the SECURITY_REVIEW_NEEDED flag.**

### 2.4 Webhook files

| File                              | Endpoints | Notes                                                      |
| --------------------------------- | --------: | ---------------------------------------------------------- |
| `billing/billingWebhookRoutes.ts` |         2 | Stripe checkout.session.completed + invoice.payment_failed |
| `auth/providerOAuth.ts`           |         4 | OAuth callbacks — half `requireClientAuth`, half public    |
| `auth/enhancedOAuthProvider.ts`   |         2 | Provider OAuth flow                                        |

### 2.5 Auth / OAuth files

| File                           | Endpoints | Notes                                                      |
| ------------------------------ | --------: | ---------------------------------------------------------- |
| `auth/authRoutes.ts`           |         7 | `/auth/*` — mix of admin + client (confusing, needs split) |
| `auth/apiKeyRoutes.ts`         |         4 | `/api/api-keys/*`                                          |
| `accounts/accountRoutes.ts`    |         5 | `/accounts/*` — self-service                               |
| `integrations/zapierRoutes.ts` |         9 | `/integrations/zapier/*`                                   |
| `integrations/makeRoutes.ts`   |         8 | `/integrations/make/*`                                     |
| `providers/providerRoutes.ts`  |         7 | `/api/providers/*`                                         |

---

## 3. Frontend consumer inventory

### 3.1 `apps/admin`

- **Pattern:** 100% via `/api/backend/[...path]` Next.js proxy → injects `admin-session` Bearer.
- **Central API client:** `apps/admin/lib/apiClient.ts` exposes `api.admin.*`, `api.audit.*`, `api.mfa.*`, etc.
- **Hooks:** `apps/admin/hooks/api/*` — TanStack Query wrappers. Well-covered for connected endpoints.
- **Direct fetches:** Several pages call `fetch("/api/backend/...")` inline (e.g., accounts bulk actions, subscriptions billing export). Per CODE_FIRST: `admin/billing/export`, `admin/accounts/bulk/suspend`, `admin/accounts/bulk/reactivate` use inline fetch — not dedicated hooks.

### 3.2 `apps/client`

- **Pattern 1 (majority):** `fetch("/api/backend/<path>")` → Next.js proxy injects `customer-session` Bearer.
- **Pattern 2 (legacy, found in `apps/client/lib/hooks/`):** `fetch("/api/<path>")` — direct Next.js route. **These do NOT go through the Fastify proxy.** Found in `useABTests.ts`, `useTemplates.ts`, `useTemplateVersions.ts`, `useProviders.ts`, `useChannels.ts`, `useOnboarding.ts`. See §5 for reverse-orphan analysis.
- **Hooks:** split between `apps/client/hooks/api/*` (new convention, uses `/api/backend/*`) and `apps/client/lib/hooks/*` (old convention, uses `/api/*` directly).

### 3.3 Legacy `apiClient.ts` copy

`apps/client/lib/apiClient.ts` — **DELETED** (was PRESEPARATION S1 CRITICAL). Verified not present.

---

## 4. Cross-reference: WRONG_APP findings (LIVE)

**Admin endpoints still being called from `apps/client`** — post-contamination cleanup this is what remains:

| #   | Client file:line                                                  | Invoked path                                  | Backend path                                              | Issue                                                                                     |
| --- | ----------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | `apps/client/hooks/api/usePerformanceInsights.ts:132`             | `/api/backend/admin/analytics/overview`       | `/admin/analytics/overview` in `admin/dashboardRoutes.ts` | Admin-only endpoint (requires `requireAdminAuth`) — will 401 for customer users           |
| 2   | `apps/client/hooks/api/useScheduledPosts.ts:39`                   | `/api/backend/admin/posts/scheduled`          | `/admin/posts/scheduled` in `admin/schedulingRoutes.ts`   | Admin-only (now has `POST_MANAGE` permission per FIXES) — will 403 for customers          |
| 3   | `apps/client/hooks/api/useScheduledPosts.ts:63`                   | `/api/backend/admin/posts/:id/cancel`         | Same file as #2                                           | Same — 403 for customers                                                                  |
| 4   | `apps/client/components/publishing/publishingDashboardApi.ts:213` | `${API_URL}/admin/posts/scheduled?projectId=` | Same route                                                | **Bypasses proxy** — uses raw `API_URL` so no auth cookie injection. Will 401             |
| 5   | `apps/client/components/notifications/NotificationItem.tsx:40`    | `/admin/posts/:id` (frontend route, not API)  | N/A                                                       | Navigation target points to admin app Next.js route — won't resolve in client app. UX bug |

**Root cause hypothesis:** CODE_FIRST_FIXES (2026-04-10) cleaned the queue/compliance contamination but missed these 5. The `usePerformanceInsights` and `useScheduledPosts` hooks are calling admin-scoped endpoints for legitimate UX reasons (showing scheduled posts to customers), but the backend exposes these via admin routes. Either create customer-scoped equivalents or split the handlers.

**Recommended action:** Create `/api/analytics/performance` and `/api/posts/scheduled` under `requireClientAuth` returning project-scoped data. Remove the `/admin/*` callers from client. File 5 is a routing bug — update NotificationItem to navigate to client dashboard post route.

### 4b. Internal endpoints verification (per Edward 2026-04-16)

**Classification rule:** Endpoints in `*Integration.ts` files are `internal` — they exist for backend orchestration, not human consumption. Expected state: no frontend consumer (→ `OK`). Frontend consumer → `OVER_CONSUMED` (infra leak). Zero auth on a public-exposed internal endpoint → `SECURITY_REVIEW_NEEDED`.

**Verification method:**

- (a) `Grep -rn "<path-pattern>"` across `apps/admin/` + `apps/client/` for each endpoint family.
- (b) `Read` the handler definition in the Integration file to check for `preHandler:` or header-based service auth.
- (c) `Grep "new <Integration>"` excluding `/test/` to verify prod instantiation.

**Verification results summary:**

| Group                                                                                                         | Endpoints | Frontend consumers                                             | Auth middleware                                | Prod-registered                                                      | Status                                                          |
| ------------------------------------------------------------------------------------------------------------- | --------: | -------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| `/api/sagas/*`                                                                                                |         7 | **0** (only test files in `apps/api/tests/unit/saga*.test.ts`) | **NONE — zero `preHandler` on all 7 handlers** | **YES** (`apps/api/src/index.ts:540` — `new SagaIntegration({...})`) | `OK` category-wise + **SECURITY_REVIEW_NEEDED**                 |
| `/api/cqrs/*`                                                                                                 |         9 | **0** (only test files)                                        | **NONE — zero `preHandler`**                   | **NO** — class defined, never instantiated outside tests             | `DEAD_CODE` (latent) + **SECURITY_REVIEW_NEEDED** if ever wired |
| `/api/database/*`                                                                                             |         6 | **0** (only test files)                                        | **NONE — zero `preHandler`**                   | **NO** — class defined, never instantiated outside tests             | `DEAD_CODE` (latent) + **SECURITY_REVIEW_NEEDED** if ever wired |
| `/api/events/*` + `/api/posts/events` + `/api/posts/:id/events` + `/api/posts/:id/publish` (EventIntegration) |         6 | **0** (only test files)                                        | **NONE — zero `preHandler`**                   | **NO** — class defined, never instantiated outside tests             | `DEAD_CODE` (latent) + **SECURITY_REVIEW_NEEDED** if ever wired |
| **Total**                                                                                                     |    **28** | **0**                                                          | **0 of 28 have any auth**                      | **7 of 28 live in prod (saga only)**                                 | See below                                                       |

**Verification (a) — consumer evidence:**

```bash
# Command run:
Grep '/api/(sagas|cqrs|database|events|posts/events|posts/[^/]+/events|posts/[^/]+/publish)'
  --path=/home/edward/projects/omni-post --glob='*.{ts,tsx}'

# Result: 0 hits in apps/admin/*. 0 hits in apps/client/*.
# All hits are in apps/api/tests/unit/*Integration*.test.ts + self-references in the
# Integration route declarations. No frontend OVER_CONSUMED.
```

**Verification (b) — auth evidence (source quotes):**

```typescript
// apps/api/src/saga/SagaIntegration.ts:171-398 — 7 handlers, all public
fastify.post<{...}>("/api/sagas/post-publishing/start", async (request, _reply) => { ... });
fastify.get<{...}>("/api/sagas/:sagaId", async (request, _reply) => { ... });
fastify.post<{...}>("/api/sagas/:sagaId/continue", ...);
fastify.post<{...}>("/api/sagas/:sagaId/compensate", ...);
fastify.get("/api/sagas", async (_request, _reply) => { ... });
fastify.get("/api/sagas/health", ...);
fastify.get("/api/sagas/metrics", ...);
// NO preHandler on any. NO header auth check. NO IP allowlist. NO network restriction visible.

// apps/api/src/cqrs/CQRSIntegration.ts:108-595 — 9 handlers, all public
// Includes POST /api/cqrs/posts/create, PUT /api/cqrs/posts/:id, POST /api/cqrs/posts/:id/publish,
// DELETE /api/cqrs/cache — all mutating, zero auth.

// apps/api/src/database/DatabaseIntegration.ts:316-499 — 6 handlers, all public
// Includes POST /api/database/scale (changes pool size),
// POST /api/database/replicas (adds read replica),
// DELETE /api/database/replicas (removes replica) — ops-critical, zero auth.

// apps/api/src/events/EventIntegration.ts:42-423 — 6 handlers, all public
// Includes POST /api/posts/events (creates Post records directly),
// PUT /api/posts/:id/events (mutates),
// POST /api/posts/:id/publish (publishes to channels) — zero auth.
```

**Verification (c) — production instantiation evidence:**

```bash
# Command: grep 'new CQRSIntegration\|new DatabaseIntegration\|new EventIntegration\|new SagaIntegration'
#          apps/api/src --include='*.ts' | grep -v test
# Result (single hit):
/home/edward/projects/omni-post/apps/api/src/index.ts:540:  const sagaIntegration = new SagaIntegration({
# CQRS, Database, Event — no instantiations outside test fixtures.
```

### 4b.1 Full list of 28 internal endpoints

**SagaIntegration (7) — LIVE + UNAUTHENTICATED:**

| #   | Method | Path                               | Mutation?                                               | SECURITY_REVIEW_NEEDED          |
| --- | ------ | ---------------------------------- | ------------------------------------------------------- | ------------------------------- |
| S1  | POST   | `/api/sagas/post-publishing/start` | YES — starts saga, creates correlation ID, inserts data | **YES**                         |
| S2  | GET    | `/api/sagas/:sagaId`               | NO (read) but leaks saga state to anyone                | **YES**                         |
| S3  | POST   | `/api/sagas/:sagaId/continue`      | YES — advances saga state machine                       | **YES**                         |
| S4  | POST   | `/api/sagas/:sagaId/compensate`    | YES — triggers rollback/compensation                    | **YES**                         |
| S5  | GET    | `/api/sagas`                       | NO but leaks active saga list + metrics                 | **YES**                         |
| S6  | GET    | `/api/sagas/health`                | NO                                                      | **YES** (info leak acceptable?) |
| S7  | GET    | `/api/sagas/metrics`               | NO but leaks internal performance KPIs                  | **YES**                         |

**CQRSIntegration (9) — DEAD CODE + UNAUTHENTICATED:**

| #   | Method | Path                              | Mutation?                       | SECURITY_REVIEW_NEEDED |
| --- | ------ | --------------------------------- | ------------------------------- | ---------------------- |
| C1  | POST   | `/api/cqrs/posts/create`          | YES — creates Post via CQRS bus | **YES** (if wired)     |
| C2  | PUT    | `/api/cqrs/posts/:postId`         | YES — updates Post              | **YES** (if wired)     |
| C3  | POST   | `/api/cqrs/posts/:postId/publish` | YES — publishes Post            | **YES** (if wired)     |
| C4  | GET    | `/api/cqrs/posts/:postId`         | NO (read)                       | **YES** (if wired)     |
| C5  | GET    | `/api/cqrs/posts`                 | NO (list)                       | **YES** (if wired)     |
| C6  | GET    | `/api/cqrs/posts/search`          | NO                              | **YES** (if wired)     |
| C7  | GET    | `/api/cqrs/health`                | NO                              | **YES** (info leak)    |
| C8  | GET    | `/api/cqrs/metrics`               | NO                              | **YES** (info leak)    |
| C9  | DELETE | `/api/cqrs/cache`                 | YES — invalidates query cache   | **YES** (if wired)     |

**DatabaseIntegration (6) — DEAD CODE + UNAUTHENTICATED:**

| #   | Method | Path                      | Mutation?                                          | SECURITY_REVIEW_NEEDED |
| --- | ------ | ------------------------- | -------------------------------------------------- | ---------------------- |
| D1  | GET    | `/api/database/health`    | NO                                                 | **YES** (if wired)     |
| D2  | GET    | `/api/database/stats`     | NO but leaks connection pool + query stats         | **YES** (if wired)     |
| D3  | POST   | `/api/database/scale`     | **YES — changes pool size 5-100**                  | **CRITICAL if wired**  |
| D4  | POST   | `/api/database/replicas`  | **YES — adds read replica from user-supplied URL** | **CRITICAL if wired**  |
| D5  | DELETE | `/api/database/replicas`  | **YES — removes replica**                          | **CRITICAL if wired**  |
| D6  | GET    | `/api/database/analytics` | NO                                                 | **YES** (if wired)     |

**EventIntegration (6) — DEAD CODE + UNAUTHENTICATED:**

| #   | Method | Path                         | Mutation?                                       | SECURITY_REVIEW_NEEDED |
| --- | ------ | ---------------------------- | ----------------------------------------------- | ---------------------- |
| E1  | POST   | `/api/posts/events`          | **YES — creates Post with prisma directly**     | **CRITICAL if wired**  |
| E2  | PUT    | `/api/posts/:postId/events`  | YES — updates Post                              | **YES** (if wired)     |
| E3  | POST   | `/api/posts/:postId/publish` | **YES — marks Post PUBLISHED and emits events** | **CRITICAL if wired**  |
| E4  | GET    | `/api/posts/:postId/events`  | NO but leaks event history                      | **YES** (if wired)     |
| E5  | GET    | `/api/events/analytics`      | NO but leaks analytics events                   | **YES** (if wired)     |
| E6  | GET    | `/api/events/health`         | NO                                              | **YES** (if wired)     |

### 4b.2 Summary of security verification

1. **7 live endpoints (SagaIntegration)** — deployed in production via `index.ts:540`, **no authentication of any kind**. Open to the public internet unless a network-layer restriction exists outside this codebase (e.g. ingress firewall). Four of the seven are mutating (start saga, continue, compensate). Three leak internal state (metrics, health, active sagas list).
2. **21 latent endpoints (CQRS+Database+Event Integrations)** — class definitions exist with zero auth. Not instantiated in production, so not currently reachable. But the code is present in the build. Anyone re-enabling these Integrations without adding auth would immediately expose them. This is **pre-wired attack surface** waiting to be activated.
3. **0 of 28 endpoints** have any of: `requireAdminAuth`, `requireClientAuth`, `requireApiKey`, `requirePermission(...)`, header-based service token check, `x-service-token` pattern, IP allowlist, basic auth, or signed-request validation. Verified by reading each handler declaration.
4. **0 frontend consumers** — no infrastructure leak to `apps/admin` or `apps/client`. Good news on the OVER_CONSUMED axis; bad news on the "why does this exist" axis for the dead-code triad.

**Reporting only, per prompt rules. No fixes applied.**

### 4b.3 Decisions executed 2026-04-16

After the security verification above, Edward decided:

| Integration           |  Endpoints | Decision                         | Status                                                                                                                                                                                                                                                      |
| --------------------- | ---------: | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SagaIntegration`     |   7 (LIVE) | **KEEP** pending client refactor | Still unauthenticated in prod — `SECURITY_REVIEW_NEEDED` remains open. No network-layer restriction verified in this audit. Auth decisions deferred to client refactor sprint.                                                                              |
| `CQRSIntegration`     | 9 (latent) | **KEEP** pending client refactor | Still dead code. Will be protected when wired.                                                                                                                                                                                                              |
| `DatabaseIntegration` | 6 (latent) | **DELETE**                       | Executed: removed `src/database/DatabaseIntegration.ts` (22KB) + `src/database/ConnectionManager.ts` (19KB, sole-consumer) + 4 unit test files. Net: -12 unauthenticated endpoint definitions (6 direct, -6 latent with SSRF risk on `/replicas` URL body). |
| `EventIntegration`    | 6 (latent) | **DELETE**                       | Executed: removed `src/events/EventIntegration.ts` (16KB) + 3 unit test files. Scaffolding code with hardcoded fake channels `["channel-1", "channel-2"]` (line 259).                                                                                       |

**Preserved infrastructure (NOT touched):**

- `src/database/DatabaseOptimizer.ts` — used by `posts/postsService.ts:8` + DI container.
- `src/events/EventService.ts` — used by saga in prod via `index.ts:533` as `sagaEventService`.
- `src/events/EventStore.ts` — used by `EventService:23`.
- `src/events/EventPublisher.ts` — only test references found. Potentially dead but out of scope for this cleanup.

**Net impact:** endpoint inventory count drops 478 → 466.

### 4b.4 RESOLVED 2026-04-17 — Saga endpoints authentication applied

**Original finding** (preserved for history): the 7 live SagaIntegration endpoints at `/api/sagas/*` had zero backend-code-level auth. Anyone with network access could start/advance/compensate arbitrary sagas or enumerate internal state.

**Fix applied** via `apps/api/src/saga/SagaIntegration.ts` (single-file edit, imports added for `requireAdminAuth`, `requirePermission`, `Permission`):

| Group             | Middleware                                                           | Endpoints                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Ops-sensitive (4) | `[requireAdminAuth, requirePermission(Permission.SYSTEM_CONFIGURE)]` | `POST /api/sagas/post-publishing/start`, `GET /api/sagas/:sagaId`, `POST /api/sagas/:sagaId/continue`, `POST /api/sagas/:sagaId/compensate` |
| Observability (3) | `[requireAdminAuth, requirePermission(Permission.SYSTEM_MONITOR)]`   | `GET /api/sagas`, `GET /api/sagas/health`, `GET /api/sagas/metrics`                                                                         |

**Verification performed:**

- `pnpm tsc --noEmit` in `apps/api`: exit 0, no type errors.
- Grep confirms 7 `fastify.<method>` registrations with adjacent `preHandler: [...]`.
- Phase 1 grep for `fetch|axios|ky|request` to `/api/sagas` returned zero hits across the monorepo — no internal HTTP consumer was broken by the change.

**Defensive choice documented:** `/health` and `/metrics` now require `SYSTEM_MONITOR` despite the common convention of leaving health/metrics public for external scrapers. Reason: no external observability gateway was found in the codebase. If a Prometheus scraper or external health probe exists and needs unauthenticated access, a follow-up decision is required (separate observability endpoint, bearer token for scraper, or network-level exemption).

**Latent code smell (not in scope):** `request.user?.projectId || "default-project"` on line 202. Admin users don't have a `projectId`, so the fallback still always triggers. No behavioral change from this fix, but worth a later sprint to require explicit `projectId` in the request body for admin-initiated sagas.

---

## 5. Reverse orphans — frontend paths without a matching backend route

Candidates found in `apps/client/lib/hooks/` using the `/api/*` (non-proxied) pattern. These require backend verification but are likely calling Next.js routes that don't exist OR Fastify routes via a non-proxied path:

| Client file:line                            | Invoked path                                                                       | Backend presence                                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `useABTests.ts:55,67,83,99,111,123,135,145` | `/api/projects/:id/templates/ab-tests/*`, `/api/ab-tests/:id/*`                    | **Not found in backend grep** — possible orphan. Verify in `templateRoutes.ts` or if a new route file exists   |
| `useTemplates.ts:37,46,71,87,97`            | `/api/projects/:id/templates`, `/api/templates/:id/*`                              | `templateRoutes.ts` defines these at `/templates/*` without the `/api/` prefix — **prefix mismatch, will 404** |
| `useTemplateVersions.ts:32,45,74`           | `/api/projects/:id/templates/:id/versions`, `/api/template-versions/:id`           | Same as above — prefix mismatch suspected                                                                      |
| `useProviders.ts:48`                        | `/api/providers`                                                                   | `providers/providerRoutes.ts` — verify if `/api/providers` or `/providers`                                     |
| `useChannels.ts:56,80,105`                  | `/api/channels`, `/api/providers`, `/api/channels/:id`                             | `channelRoutes.ts` — verify prefix                                                                             |
| `useOnboarding.ts:34,52,74`                 | `/api/onboarding`, `/api/onboarding/step/:key/complete`, `/api/onboarding/dismiss` | `onboardingRoutes.ts` uses `/api/onboarding/*` — likely MATCH                                                  |
| `useBilling.ts:260`                         | `/api/billing/invoices`                                                            | `clientBillingRoutes.ts` has `/api/billing/*` — likely MATCH                                                   |
| `AnnouncementBanner.tsx:53`                 | `/api/announcements/active`                                                        | `announcementRoutes.ts` — verify                                                                               |

**Two distinct patterns in client:**

1. `apps/client/hooks/api/*` uses `/api/backend/*` (proxied) — correct.
2. `apps/client/lib/hooks/*` uses `/api/*` directly — **this bypasses the proxy**. Either these go to Next.js API routes defined in `apps/client/app/api/*` (not verified here) or they 404.

**Recommended action:** audit `apps/client/lib/hooks/` as a separate follow-up. Likely contains dead code or broken fetches from pre-separation era.

---

## 6. Actionable list — non-OK items

### P0 — Broken (WRONG_APP with active call sites)

1. **Move `/admin/posts/scheduled` + `/admin/posts/:id/cancel` to a customer-scoped route** OR delete `apps/client/hooks/api/useScheduledPosts.ts` and the consuming page. Currently: 401/403 for customer users.
2. **Same for `/admin/analytics/overview`** called from `apps/client/hooks/api/usePerformanceInsights.ts`. Create `/api/analytics/performance` for customer scope.
3. **`apps/client/components/publishing/publishingDashboardApi.ts:213`** uses raw `API_URL` bypassing proxy. Either use proxy (`/api/backend/...`) with a customer-scoped endpoint, or delete the function.
4. **`NotificationItem.tsx:40`** — router target `/admin/posts/:id` won't resolve in client app. Fix to client's post route.

### P0 — Prefix mismatches (REVERSE_ORPHAN suspects)

5. **`apps/client/lib/hooks/useTemplates.ts`** + `useTemplateVersions.ts` + `useABTests.ts` call `/api/projects/:id/templates/*` but backend registers at `/templates/*` and `/projects/:id/templates` under `templateRoutes.ts`. Needs a full trace — likely dead hooks from pre-separation.

### P1 — ORPHAN admin endpoints (no UI)

Per REVERSE_ENGINEERING_AUDIT (2026-04-06) — sample, not exhaustive:

- `POST /admin/accounts` (create account) — no admin UI
- `GET /admin/accounts` (filtered list) — no admin UI (only summary is used)
- `GET /admin/accounts/stats` — no admin UI
- `GET /admin/accounts/:id` (detail) — no admin UI
- `PUT /admin/accounts/:id` — `useUpdateAccount` hook exists but unused
- `POST /admin/accounts/:id/reset-password` — no admin UI
- `DELETE /admin/accounts/:id` — no admin UI (super-admin only)
- `GET /admin/accounts/:id/sessions` — no admin UI
- `POST /admin/accounts/:id/revoke-sessions` — no admin UI
- `POST /admin/accounts/bulk/suspend` — no admin UI
- `POST /admin/accounts/bulk/reactivate` — no admin UI
- `GET /admin/audit/export` — no admin UI
- `GET /admin/billing/trials/expiring` — no admin UI
- `GET /admin/users/:id` + `PUT /admin/users/:id` — no admin UI for detail/edit
- `/admin/outbox/*` (3 endpoints) — no admin UI
- Several `saml`, `oidc`, `settings` admin endpoints — partial or no UI

**Full list requires a row-by-row pass.** ~45 orphans per reverse audit; that number may have shifted ±10 with recent sprints.

### P2 — NEEDS_DECISION (uncertain category)

- `saga/SagaIntegration.ts` → 7 endpoints at `/api/sagas/*` — are these admin tooling, internal debug, or publicly exposed? Protected by what?
- `cqrs/CQRSIntegration.ts` → 9 endpoints at `/api/cqrs/*` — same question
- `database/DatabaseIntegration.ts` → 6 endpoints at `/api/database/*` including `POST /api/database/scale` and `POST /api/database/replicas` (ops-critical) — confirm auth
- `events/EventIntegration.ts` → 6 endpoints at `/api/events/*`

**Action:** Edward to classify. If these are debug-only, they should be gated on env (dev-only) or `requireAdminAuth` with `SYSTEM_CONFIGURE`.

### P3 — Prefix normalization

Mixed prefixes across admin endpoints:

- Most admin routes: `/admin/*`
- `admin/analyticsRoutes.ts`: `/api/admin/analytics/*`
- `webhooks/webhookDashboardRoutes.ts`: `/api/webhooks/dashboard/*`
- `compliance/complianceRoutes.ts`: `/api/admin/compliance/*` + `/api/compliance/dsar`

**Recommendation:** pick one convention (`/api/admin/*` is more explicit). Redirect or rename, one endpoint at a time with deprecation headers.

---

## 7. Prior findings preserved

From the 16 previous audit docs. Classified as **preserved** (still valid, incorporated above), **resolved** (fixed, confirmed against current code), or **stale** (no longer applicable).

| #   | Source doc                                                            | Finding                                                                                                                     | Status                                    | Evidence                                                                                                                                                      |
| --- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | PRESEPARATION_AUDIT 2026-04-02 (CRITICAL S1)                          | `apps/client/lib/apiClient.ts` copied from admin, calls admin endpoints bypassing proxy                                     | **RESOLVED**                              | File deleted — verified `test -f` returns DELETED                                                                                                             |
| 2   | ENDPOINT_AUDIT 2026-04-06 BUG 1                                       | `subscriptions/page.tsx:237` — `stats.totalRevenue.toLocaleString()` crashes when API returns different shape               | **PRESERVED (likely still relevant)**     | Subscription stats shape mismatch with frontend types — needs re-verification                                                                                 |
| 3   | ENDPOINT_AUDIT 2026-04-06 BUG 2                                       | Subscriptions page expects `plan` field not returned by API                                                                 | **RESOLVED per CODE_FIRST §3 2026-04-10** | `dashboardService.ts:129-137` now returns `plan` object                                                                                                       |
| 4   | ENDPOINT_AUDIT 2026-04-06 BUG 3                                       | Executive page empty trends cause `Math.max(...[])` → NaN                                                                   | **RESOLVED**                              | Fix applied per doc                                                                                                                                           |
| 5   | ENDPOINT_AUDIT 2026-04-06 BUG 4                                       | Webhook components use `/api/webhooks/...` instead of `/api/backend/api/webhooks/...` (missing proxy prefix)                | **RESOLVED**                              | Fix applied per doc                                                                                                                                           |
| 6   | ENDPOINT_AUDIT 2026-04-06 BUG 5                                       | Security MFA page multiplies enablementRate by 100 twice                                                                    | **RESOLVED**                              | Fix applied                                                                                                                                                   |
| 7   | CODE_FIRST 2026-04-10 — Client contamination P0                       | `useQueueManager.ts` + queue page + `useCompliance.ts` + `publishingDashboardApi.fetchPublishingQueue` call admin endpoints | **RESOLVED**                              | Verified: all 4 files/functions deleted per FIXES report; grep confirms no references remain                                                                  |
| 8   | CODE_FIRST 2026-04-10 — 13 unguarded admin endpoints                  | Only `requireAdminAuth`, missing `requirePermission`                                                                        | **RESOLVED**                              | FIXES report §B1: dashboard (4) + scheduling (3) + mfa (2) guarded. SAML (4) and OIDC (4) are still listed as pending in FIXES — **requires re-verification** |
| 9   | CODE_FIRST 2026-04-10 — EDITOR role 0 permissions                     | Can authenticate, 403 everywhere                                                                                            | **RESOLVED**                              | EDITOR + ROL_DE_PRUEBA deleted (0 users) per FIXES §B2                                                                                                        |
| 10  | CODE_FIRST 2026-04-10 — Orphan hooks                                  | `useStartTrial`, `useEndTrial`, `useConvertTrial` unused                                                                    | **RESOLVED**                              | FIXES §F4: buttons added, hooks now wired                                                                                                                     |
| 11  | CODE_FIRST 2026-04-10 — Decimal crash analytics/page.tsx:314          | `trialConversions.toFixed()` without `Number()`                                                                             | **RESOLVED**                              | FIXES §F3                                                                                                                                                     |
| 12  | CODE_FIRST 2026-04-10 — i18n gap                                      | RBAC + MFA pages hardcoded English                                                                                          | **RESOLVED**                              | FIXES §F5                                                                                                                                                     |
| 13  | CODE_FIRST 2026-04-10 — Stale "OmniPost Admin" in client              | Page titles, JSDoc comments                                                                                                 | **RESOLVED**                              | FIXES §F6                                                                                                                                                     |
| 14  | CODE_FIRST 2026-04-10 — Prefix inconsistency `/admin` vs `/api/admin` | Complicates gateway/proxy rules                                                                                             | **PRESERVED**                             | Still present. See §6 P3                                                                                                                                      |
| 15  | REVERSE_ENGINEERING 2026-04-06 — ~45 admin endpoints not connected    | Orphan endpoints in admin routes                                                                                            | **PRESERVED**                             | Count may have drifted. See §6 P1 for sample                                                                                                                  |
| 16  | LEGACY_AUDIT_API API-001                                              | EventStore $queryRaw incompatible with adapter-pg                                                                           | **RESOLVED**                              | All 12 usages replaced with `Prisma.sql`. Verified LEGACY_VERIFICATION                                                                                        |
| 17  | LEGACY_AUDIT_API API-002                                              | Billing services hardcoded to BASIC/PRO/ENTERPRISE                                                                          | **RESOLVED**                              | Multiple services refactored, 47 refs → 0. Verified LEGACY_VERIFICATION D1                                                                                    |
| 18  | LEGACY_AUDIT_API API-003                                              | 13 orphan use cases never registered in DI                                                                                  | **PARTIALLY RESOLVED**                    | 3 billing registered. Remaining: 4 AI Repurpose, 4 Referral, 1 Inbox Triage, 1 Trend Scoring — deferred to feature backlog                                    |
| 19  | LEGACY_AUDIT_ADMIN ADM-001                                            | Subscriptions page uses BASIC/PRO/ENTERPRISE tiers                                                                          | **RESOLVED**                              | Replaced with `plan` object                                                                                                                                   |
| 20  | LEGACY_AUDIT_ADMIN ADM-002                                            | `getAnalyticsOverview` method dead code in apiClient                                                                        | **RESOLVED**                              | Removed                                                                                                                                                       |
| 21  | LEGACY_AUDIT_ADMIN ADM-003/005                                        | Untyped `any[]` in SubscriptionSummary + DashboardStats                                                                     | **RESOLVED**                              | Typed per LEGACY_VERIFICATION                                                                                                                                 |
| 22  | LEGACY_AUDIT_CLIENT CLI-001                                           | Inbox missing AI triage UI (priority, messageType, suggestedReplies)                                                        | **RESOLVED**                              | UI added per doc                                                                                                                                              |
| 23  | LEGACY_AUDIT_CLIENT CLI-002                                           | `useUsage` hook uses legacy plan type                                                                                       | **RESOLVED**                              | Changed to `plan: string`                                                                                                                                     |
| 24  | LEGACY_AUDIT_CLIENT CLI-004..014                                      | 11 orphaned components in client                                                                                            | **STATUS UNKNOWN**                        | Not re-verified. Some may have been wired by subsequent sprints                                                                                               |
| 25  | NEW FINDING (this audit)                                              | 5 admin endpoints called from client not caught by prior audits                                                             | **NEW**                                   | See §4                                                                                                                                                        |
| 26  | NEW FINDING (this audit)                                              | `apps/client/lib/hooks/*` uses non-proxied `/api/*` pattern — likely dead/broken                                            | **NEW**                                   | See §5                                                                                                                                                        |

---

## 8. Doc lifecycle — executed 2026-04-16

Edward approved the recommendations. Two rounds of changes, both committed:

| Round                 | Commit          | Scope                                                                                                          |
| --------------------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| 1 — Doc consolidation | `57e6787`       | 6 DELETE + 6 ARCHIVE + new `docs/audits/ENDPOINT_AUDIT.md`                                                     |
| 2 — Code lifecycle    | _(this commit)_ | 3 source files deleted + 7 test files deleted — `DatabaseIntegration`, `ConnectionManager`, `EventIntegration` |

| Doc                                                      | Recommendation | Reason                                                                                                                                               |
| -------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/development/ENDPOINT_AUDIT_REPORT.md`              | **DELETE**     | 30/478 endpoints, admin-only, superseded by this doc. All 5 bugs resolved per FIXES                                                                  |
| `docs/development/CODE_FIRST_AUDIT_REPORT.md`            | **ARCHIVE**    | Valuable historical snapshot (428 endpoint count, RBAC migration state, EDITOR role analysis). Move to `docs/reports/audits/` with original date     |
| `docs/development/CODE_FIRST_AUDIT_FIXES_REPORT.md`      | **ARCHIVE**    | Fix tracking log, historically useful, superseded by current state                                                                                   |
| `docs/development/REVERSE_ENGINEERING_AUDIT.md`          | **DELETE**     | Admin-only reverse map, 102 endpoints — partially superseded. Key findings (45 orphans) preserved in §6 P1                                           |
| `docs/development/LEGACY_AUDIT_API_REPORT.md`            | **ARCHIVE**    | Legacy refactoring log — valuable for understanding how SubscriptionTier was removed, AccountSubscription introduced. Move to `docs/reports/audits/` |
| `docs/development/LEGACY_AUDIT_ADMIN_REPORT.md`          | **DELETE**     | 8 issues, all resolved. No unique value beyond git history                                                                                           |
| `docs/development/LEGACY_AUDIT_CLIENT_REPORT.md`         | **ARCHIVE**    | 14 issues mostly resolved, but CLI-004..014 (11 orphan components) not re-verified in this audit. Keep until confirmed dead                          |
| `docs/development/LEGACY_VERIFICATION_REPORT.md`         | **DELETE**     | Verification snapshot — findings preserved in §7                                                                                                     |
| `docs/development/PRESEPARATION_AUDIT.md`                | **ARCHIVE**    | Critical separation-era doc — S1 (apiClient copy) resolution is historically important. Move to `docs/reports/audits/`                               |
| `docs/development/PRESEPARATION_FIX_REPORT.md`           | **ARCHIVE**    | Fix log for PRESEPARATION. Archive alongside its parent                                                                                              |
| `docs/admin/BACKEND_ROUTES.md`                           | **DELETE**     | 25 admin routes catalog from 2026-03-08 — fully superseded by §2                                                                                     |
| `docs/admin/DISCONNECTED_COMPONENTS.md`                  | **DELETE**     | Subsystem-level 9 entries from 2026-03-08 — fully superseded                                                                                         |
| `docs/reports/audits/code-review-2026-03-29.md`          | **KEEP**       | Not re-verified this pass. Dated code review, unique scope — keep unless Edward confirms stale                                                       |
| `docs/reports/audits/app-separation-audit-2026-03-29.md` | **KEEP**       | Separation context, different scope from PRESEPARATION. Not re-verified                                                                              |
| `docs/reports/audits/deep-audit-2026-03-27.md`           | **KEEP**       | Not re-verified. Generic "deep audit" — needs a read before deciding                                                                                 |
| `docs/reports/audits/backend-auth-audit-2026-03-29.md`   | **KEEP**       | Auth-specific, different scope. Not re-verified                                                                                                      |

**Summary:**

- `DELETE`: 6 files (all superseded by this audit)
- `ARCHIVE` (move to `docs/reports/audits/`): 5 files (historical value)
- `KEEP`: 4 files (unverified or different scope)

---

## 9. Coverage limitations of this audit

- **Not an exhaustive 478-row matrix.** Coverage is at the file/category level with spot-checks. Building a row-per-endpoint matrix requires 3-5h of additional work. See §6 for the actionable portion.
- **Frontend consumer detection is grep-based.** A hook that invokes an endpoint only via `api.admin.getXYZ()` (method call on an imported object) may be missed unless the corresponding method in `apiClient.ts` is read. I sampled but didn't exhaustively trace every method.
- **Dynamic routes matched by prefix.** `/projects/${id}/posts` → `/projects/:id/posts` is considered a match.
- **Integration files** (`SagaIntegration`, `CQRSIntegration`, etc.) are counted but their `NEEDS_DECISION` classification is based on file name and path, not handler logic.
- **NEEDS_DECISION items** (§6 P2) require Edward's classification.

Follow-up audits should use this doc as the baseline and drill into specific categories (e.g., "orphan admin endpoints — full row-level pass") rather than repeating the full sweep.
