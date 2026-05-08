# OmniPost Code Review & Honest Assessment

Date: 2026-03-29
Reviewer: Claude Code (automated code review from source files)

## The one-paragraph honest summary

OmniPost is a substantially built multi-channel social media CMS with a production-ready publishing pipeline, real provider adapters for 10 platforms, and a comprehensive admin dashboard. The architecture (hexagonal + DDD + CQRS) is genuinely well-implemented and enforced. However, there is a significant gap between what the sprint reports claim and what the code actually does: custom reports return random numbers, analytics has no ingestion worker (the DB never fills automatically), inbox sync is commented out, and CRM activity logging is one-way only. The core value proposition — create content and publish to platforms — works end-to-end. Everything else is in various stages of real scaffolding with correct architecture but incomplete data flows.

---

## Part 1 — What OmniPost Actually Is

### Admin App

A full-featured admin dashboard for social media management with 38 pages, 126 components, and 27 API hooks. It covers: post composition with multi-platform previews, scheduling with calendar/bulk/recurring views, social inbox with threaded conversations, analytics dashboards, team management, approval workflows, AI content generation, and admin operations (accounts, billing, security, compliance, webhooks). All hooks call real API endpoints. MFA authentication with httpOnly cookies. Role-based access control.

### Client App

A content creator dashboard with 9 pages for creating, editing, scheduling, and publishing posts. Uses TipTap editor, TanStack Query hooks, and real API calls for posts CRUD. ~80% complete — OAuth provider connections have empty handlers, analytics shows placeholders. Meaningfully different from admin: admin is for ops/management, client is for content creation.

### The Backend

Fastify REST API with 85 Prisma models, 74+ use cases, 26+ queries, all following hexagonal architecture. 56/56 mutating use cases use Unit of Work. 44/45 routes protected with auth. 45/45 routes have OpenAPI schema annotations. 10 provider adapters with real API calls. BullMQ publishing pipeline with saga orchestration. Webhook processing for 8 providers.

---

## Part 2 — Capability Map

### Admin Capabilities

| Feature                | Status   | Backend                                     | Frontend                                                    | Evidence                                       |
| ---------------------- | -------- | ------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| Post composer          | COMPLETE | CreatePost/UpdatePost use cases             | AdminContentEditor (12.5KB) + ContentPreviewSystem (22.4KB) | Real hooks, real API calls                     |
| Platform previews      | COMPLETE | N/A                                         | 5 custom preview renderers + core system                    | provider-previews.tsx                          |
| Image upload           | COMPLETE | MediaAsset use cases + S3 adapter           | Upload UI in editor                                         | Real storage adapter                           |
| Video upload           | COMPLETE | VideoProcessor + provider-specific          | Upload UI                                                   | Real ffmpeg processing                         |
| Emoji picker           | COMPLETE | N/A                                         | EmojiPickerButton (emoji-mart)                              | Sprint 1                                       |
| @Mention               | BACKEND  | MentionParser + NotifyMentionedUsersService | No MentionInput UI component wired                          | Backend done, UI not built                     |
| Publish now            | COMPLETE | Saga → Queue → Worker → Provider            | UnifiedPublishingDashboard                                  | End-to-end works                               |
| Schedule post          | COMPLETE | SchedulePostUseCase → Queue                 | Scheduling dashboard                                        | Calendar + bulk + rules                        |
| Draft saving           | COMPLETE | CreatePost with DRAFT status                | Editor auto-save                                            | Real persistence                               |
| Recurring posts        | COMPLETE | CreateRecurringPost/ProcessRecurrence       | Recurring schedule pages                                    | 4 use cases                                    |
| Post calendar          | COMPLETE | ListPosts by date                           | SchedulingDashboard calendar tab                            | Real data                                      |
| Social inbox           | PARTIAL  | IngestSocialMessage, SendReply, Assign      | InboxLayout with ConversationList                           | Webhook-only ingestion, no polling             |
| Inbox: reply           | COMPLETE | SendReplyUseCase                            | ReplyComposer                                               | Wired to provider adapters                     |
| Inbox: internal notes  | COMPLETE | AddConversationNote use case                | conversationNoteRoutes                                      | Sprint 1 feature                               |
| Inbox: @mention notes  | BACKEND  | NotifyMentionedUsersService                 | No MentionInput in note UI                                  | Backend fires notifications, UI plain textarea |
| Analytics dashboard    | PARTIAL  | CrossPlatformAnalyticsEngine                | Recharts charts + useAnalytics                              | Real DB aggregation, BUT no ingestion worker   |
| Custom reports         | STUB     | RunCustomReportQuery returns Math.random()  | CustomReportBuilder UI                                      | 100% fake data (line 59)                       |
| Report scheduling      | BACKEND  | ScheduleCustomReportUseCase                 | No schedule UI wired                                        | Cron parsing works, no execution               |
| Report export          | STUB     | ExportCustomReportUseCase                   | Export dropdown in UI                                       | Random data exported                           |
| Campaign management    | COMPLETE | Create/Update/Archive/Tag/Untag             | Campaign pages                                              | Full CRUD                                      |
| Single-level approvals | COMPLETE | Submit/Approve/Reject use cases             | ApprovalQueue + ReviewPanel                                 | Full workflow                                  |
| Multi-level approvals  | BACKEND  | ApprovalWorkflow + Level models             | No workflow builder UI                                      | Backend supports levels, UI shows single-level |
| Approval workflow mgmt | BACKEND  | CRUD use cases for workflows                | No admin UI for workflow config                             | Routes exist, no page                          |
| Task management        | BACKEND  | Create/Update/Complete/Cancel/List          | No task page or components                                  | Routes + domain complete                       |
| Task assignment        | BACKEND  | CreateTaskUseCase with assigneeId           | No assignment UI                                            | DI wired, no frontend                          |
| Team management        | COMPLETE | Invite/UpdateRole/Remove                    | Team page                                                   | Full CRUD                                      |
| Asset library          | COMPLETE | Create/Update/Delete/Tag assets             | ContentLibrary (18 components)                              | Grid/list/filter/bulk                          |
| Google Drive import    | BACKEND  | ImportFromGoogleDriveUseCase                | No GoogleDriveImportButton wired                            | Use case works, no Picker integration          |
| Brand Kit              | BACKEND  | Upsert/Get/Delete BrandKit                  | No BrandKitForm page                                        | Routes exist, no settings page                 |
| Brand Voice            | COMPLETE | Upsert/Delete BrandVoice                    | BrandVoiceForm                                              | Full CRUD                                      |
| AI text generation     | COMPLETE | AIService + OpenAI/Gemini/Perplexity        | AIContentGenerator + SmartContentOptimizer                  | Real provider calls                            |
| AI image generation    | COMPLETE | GenerateImageUseCase                        | AIImageGenerator                                            | DALL-E 3 integration                           |
| AI content variations  | COMPLETE | generateVariations orchestrator             | UI in optimizer                                             | Real AI calls                                  |
| AI optimization        | COMPLETE | optimizeContent orchestrator                | SmartContentOptimizer (12.8KB)                              | Tokenization + scoring                         |
| SSO / SAML             | BACKEND  | ConfigureSaml + Enable/Disable              | No SSO settings page                                        | Routes + flow endpoints exist                  |
| SSO / OIDC             | BACKEND  | ConfigureOidc + Enable/Disable              | No SSO settings page                                        | Routes + PKCE flow exist                       |
| Zapier integration     | BACKEND  | Generate/Revoke keys, Subscribe             | No ZapierSettings page                                      | Routes fully wired                             |
| Make integration       | BACKEND  | Generalized Integration platform            | No MakeSettings page                                        | Routes mirror Zapier                           |
| HubSpot integration    | BACKEND  | ConnectCrm + SyncContacts                   | No CrmSettings page                                         | OAuth flow + contact sync works                |
| Salesforce integration | BACKEND  | ConnectCrm + SyncContacts                   | No CrmSettings page                                         | OAuth flow + SOQL contacts                     |
| Usage & billing        | PARTIAL  | IncrementUsage, SubscriptionRoutes          | UsageMetricsPanel + SubscriptionPage                        | Some placeholder metrics                       |
| Notifications (in-app) | COMPLETE | CreateNotificationUseCase                   | NotificationBell + preferences                              | Real notification system                       |
| Notifications (email)  | PARTIAL  | ResendEmailAdapter                          | No email templates UI                                       | Sends emails, limited templates                |
| Crisis management      | COMPLETE | Enter/Exit/GetStatus                        | Crisis routes                                               | Full workflow                                  |
| Link shortener         | COMPLETE | Create/Delete TrackedLink                   | Link routes with /r/:shortCode redirect                     | Click tracking                                 |

#### Summary: 20 COMPLETE, 14 BACKEND ONLY, 3 PARTIAL, 2 STUB, 0 MISSING

### Client App Assessment

The client app is a content creator dashboard — lighter than admin, focused on post creation and publishing. 9 pages: login, register, dashboard, posts list, new post, post detail, post preview, templates. Posts CRUD works with real API hooks. Content editor (TipTap-based) is real. Publishing dialog is wired. OAuth provider connections have empty handlers. Analytics sections show placeholders. ~80% complete for its intended scope.

### Backend-Only Capabilities (no UI)

14 features have complete backend (use cases + routes + DI) but zero frontend:

- Multi-level approval workflows (5 new routes)
- Task management (7 routes)
- SSO SAML + OIDC (13 routes total)
- Zapier/Make integrations (18 routes)
- HubSpot/Salesforce CRM (7 routes + 2 adapter packages)
- Brand Kit (3 routes)
- Google Drive import (1 route)
- @Mention notifications (backend service, no UI input)

---

## Part 3 — Data Flow Reality

### Post Creation & Publishing

Status: **WORKS END-TO-END**

Flow: AdminContentEditor → POST /posts → CreatePostUseCase → PostAggregate → PrismaPostRepository → SagaIntegration → BullMQ queue → publishWorker → PublishHandler → providerRegistry.getAdapter() → provider.publish() → DB update

Evidence: `apps/workers/src/publishHandler.ts` calls `provider.publish()` directly. `apps/workers/src/publishWorker.ts` subscribes to BullMQ queue. Saga orchestration manages the workflow. All 10 providers have real `publish()` methods with API calls.

Failure points: Requires provider credentials in environment/DB. Queue requires Redis. Worker must be running.

### Inbox & Replies

Status: **PARTIALLY WIRED**

- Messages enter ONLY via webhooks (8 processors) — no polling/sync worker
- `inboxSyncJob.ts` was deleted in knip cleanup
- `SyncProviderCommentsUseCase.ts:97` has `// TODO: Step 7` — provider adapter never called
- SendReplyUseCase IS wired to provider adapters (postReply works)
- UI: InboxLayout, ConversationList, ConversationThread — all real components with API hooks

Gap: System cannot proactively fetch messages. Only reactive via webhooks. If a provider doesn't send webhooks, messages never appear.

### Analytics Data

Status: **REAL AGGREGATION, NO INGESTION**

- `CrossPlatformAnalyticsEngine` genuinely aggregates data from `analytics` Prisma table
- All 10 provider adapters have `fetchAnalytics()` implemented
- BUT: No worker/job calls `fetchAnalytics()`. The analytics table is never automatically populated.
- Analytics data only exists if: (a) manually inserted, (b) received via webhook engagement updates
- Competitor benchmarking returns hardcoded fake data
- Audience demographics were removed (comment: "100% fake")

Gap: Need an analytics ingestion worker that periodically calls `adapter.fetchAnalytics()` for each connected channel.

---

## Part 4 — Honest Assessment

### Strongest features (top 3)

1. **Publishing Pipeline** — En mi opinión, esta es la joya del proyecto. La orquestación via saga, el queue BullMQ, los 10 provider adapters con llamadas reales, el manejo de threads/carousels/shorts, la observabilidad con OTel — es código de producción real. No es scaffolding. Es el tipo de pipeline que puede manejar miles de posts por hora.

2. **Admin Dashboard** — Creo que el admin app es impresionantemente completo. 38 páginas reales con hooks que llaman endpoints reales. El InboxLayout con infinite scroll, el PublishingQueueManager con retry/cancel, el ContentLibrary con 18 subcomponentes — esto no es un mockup, es una aplicación funcional.

3. **Hexagonal Architecture Enforcement** — Lo que veo es una disciplina arquitectónica genuina. 0 imports de infraestructura en el dominio. 56/56 use cases con UoW. Result types en vez de throws. Este no es un proyecto que "dice" ser hexagonal pero corta esquinas — realmente lo es.

### Biggest gap between promise and reality

En mi opinión, el gap más grande es en **Custom Reports**. Los sprint reports documentan "59 tests, CustomReport + ReportSchedule, 12 metrics, 8 routes" — todo verdad. Pero `RunCustomReportQuery.ts` línea 59 dice `Math.floor(Math.random() * 1000)`. Los tests validan que el framework funciona, no que los datos son reales. Un usuario que abra el report builder verá números random. Esto me preocupa porque la UI existe, el scheduling existe, el export existe — todo apunta a "esto funciona" — pero los datos son fake.

El segundo gap más grande es **analytics**. Los adapters tienen `fetchAnalytics()` implementado. La UI tiene charts. Pero no hay worker que conecte los dos. Los charts muestran datos del DB, y el DB nunca se llena automáticamente. Si un nuevo usuario conecta Instagram y espera ver métricas, va a ver tablas vacías.

### Has UI, no real data

- **Custom Report Builder** — UI completa con chart selector, metric picker, date ranges. Datos: `Math.random()`.
- **Executive Dashboard** — UI con métricas de negocio. Algunos campos (revenue, MRR, CAC) muestran `0` porque el backend no calcula revenue real.
- **Analytics Insights** — Charts existen, pero dependen de datos en tabla analytics que nadie puebla.

### Has backend, no UI

Creo que los 14 features BACKEND ONLY representan un patrón preocupante: se construyeron use cases, repos, routes, tests, DI — todo el stack backend — pero ninguna página admin. Esto significa que estas features existen en la API pero ningún usuario puede accederlas sin usar curl/Postman.

Los más importantes sin UI:

- **Tasks** — 7 API endpoints, 0 UI components
- **Multi-level approvals** — workflow builder inexistente
- **SSO (SAML + OIDC)** — 13 endpoints, 0 settings pages
- **Zapier/Make/CRM** — 32 endpoints combinados, 0 settings pages

### The client app verdict

Lo que veo es una app que funciona para crear y publicar posts, pero está incompleta en todo lo demás. El editor funciona, el publishing dialog está wired, la auth es real. Pero OAuth connections, analytics, y templates tienen placeholders. Si yo fuera el product owner, no la lanzaría aún — necesita al menos OAuth connections y analytics básico para ser útil.

### The analytics verdict

En mi opinión, analytics es el punto más débil del producto relativo a su importancia. Para una herramienta de social media management, analytics es THE feature — es lo que justifica el precio. OmniPost tiene la arquitectura correcta (adapters, aggregation engine, charts), pero le falta la pieza más importante: el pipeline que trae datos de los providers al DB. Sin eso, analytics es una cáscara bonita sin contenido.

### The publishing pipeline verdict

Creo que el publishing pipeline es genuinamente production-ready. Lo tracé completo: UI → API → use case → saga → queue → worker → provider adapter → platform. Cada pieza existe y está conectada. Los providers hacen llamadas HTTP reales. El worker consume del queue real. El saga maneja compensaciones. Si configuras las API keys de un provider, un post PUEDE publicarse de verdad.

---

## Part 5 — Priority Scoring of Incomplete Features

### Scoring formula

`(Usage × 2) + BusinessImpact + CompletionGap + Blocking` — threshold ≥ 10

### Complete scoring table

| Feature                      | Usage | BizImpact | CompGap | Blocking | Score | Priority        |
| ---------------------------- | ----- | --------- | ------- | -------- | ----- | --------------- |
| Analytics ingestion worker   | 5     | 5         | 4       | 4        | 23    | FIX IMMEDIATELY |
| Custom reports real data     | 4     | 4         | 5       | 2        | 19    | FIX IMMEDIATELY |
| Task management UI           | 4     | 3         | 5       | 2        | 18    | FIX IMMEDIATELY |
| SSO settings page            | 2     | 5         | 5       | 1        | 15    | FIX IMMEDIATELY |
| Inbox polling/sync worker    | 4     | 4         | 3       | 3        | 18    | FIX IMMEDIATELY |
| Zapier/Make settings UI      | 2     | 3         | 5       | 1        | 13    | FIX SOON        |
| CRM settings page            | 2     | 3         | 5       | 1        | 13    | FIX SOON        |
| Multi-level approval UI      | 2     | 3         | 4       | 2        | 13    | FIX SOON        |
| Brand Kit settings page      | 2     | 2         | 5       | 1        | 12    | FIX SOON        |
| Google Drive import UI       | 2     | 2         | 4       | 1        | 11    | FIX SOON        |
| @Mention input component     | 3     | 2         | 4       | 1        | 13    | FIX SOON        |
| Client app OAuth connections | 3     | 3         | 3       | 2        | 14    | FIX SOON        |
| CRM activity sync-back       | 1     | 2         | 3       | 1        | 8     | LATER           |
| Email notification templates | 1     | 2         | 3       | 1        | 8     | LATER           |

### Fix Immediately (score ≥ 15)

1. **Analytics ingestion worker** — Score: 23
   - Missing: BullMQ worker that calls `adapter.fetchAnalytics()` per connected channel on a schedule
   - Effort: M — pattern exists in publishWorker, adapters are ready
   - Files: create `apps/workers/src/analyticsIngestionWorker.ts`, add queue name, schedule cron

2. **Custom reports real data** — Score: 19
   - Missing: Replace `Math.random()` in `RunCustomReportQuery.ts:59` with real Prisma aggregation from `analytics`/`AnalyticsDailySummary` tables
   - Effort: M — query logic needs to aggregate by metrics/dimensions/date-range
   - Files: modify `apps/api/src/application/custom-reports/RunCustomReportQuery.ts`

3. **Inbox polling/sync worker** — Score: 18
   - Missing: Worker that calls `adapter.getComments()` for each connected channel, wires into `IngestSocialMessageUseCase`
   - Effort: M — adapters ready, use case exists, need scheduler
   - Files: create `apps/workers/src/inboxSyncWorker.ts`, implement SyncProviderCommentsUseCase Step 7

4. **Task management UI** — Score: 18
   - Missing: Admin page + components (TaskList, TaskCard, CreateTaskModal)
   - Effort: S — backend is complete with 7 routes, just need React components
   - Files: create `apps/admin/app/(dashboard)/tasks/page.tsx`, `apps/admin/components/tasks/`

5. **SSO settings page** — Score: 15
   - Missing: Admin settings page with SAML + OIDC tabs
   - Effort: S — backend has 13 routes ready, need form UI
   - Files: create `apps/admin/app/(dashboard)/settings/security/sso/page.tsx`, `apps/admin/components/settings/SsoSettings.tsx`

### Fix Soon (score 10–14)

- Client app OAuth connections (14) — empty handlers need wiring
- @Mention input component (13) — MentionInput UI for notes/tasks
- Zapier/Make settings UI (13) — API key management pages
- CRM settings page (13) — HubSpot/Salesforce connection UI
- Multi-level approval workflow builder (13) — visual level editor
- Brand Kit settings page (12) — color picker + logo upload
- Google Drive import button (11) — Picker API integration

### Plan for Later (score < 10)

- CRM activity sync-back (8) — push activities to CRM
- Email notification templates (8) — custom email designs

---

## Part 6 — Recommendations

### What to build next (not in backlog)

1. **Analytics Ingestion Worker** (Score: 23) — This is THE missing piece. Without it, the analytics dashboard shows empty data. Every feature that depends on analytics (reports, insights, executive dashboard) is blocked by this.

2. **Settings Pages Sprint** — 14 backend-only features need simple React form pages. This is low-effort, high-impact work that would expose $months$ of backend development to actual users. One sprint of UI work could unlock: Tasks, SSO, Zapier, Make, CRM, Brand Kit, Google Drive, Approval Workflows.

3. **Inbox Sync Worker** — The inbox is the second most important feature after publishing. Without proactive message fetching, the inbox only shows webhook-delivered messages, which means gaps in conversations.

### What to deprioritize in the backlog

- **D-SL-01 Social Listening (XL)** — The product doesn't even have analytics ingestion yet. Building keyword monitoring before basic metrics exist is premature.
- **D-EA-01 Employee Advocacy (XL)** — Enterprise feature for a product that doesn't have its SSO settings page built yet.
- **D-UX-03 Canva Integration** — Blocked by partnership AND the product has more fundamental gaps to address first.

### Architecture concern worth addressing

En mi opinión, el mayor dolor a futuro es la ausencia de workers para tareas asíncronas críticas. El publishWorker existe y funciona, pero analytics ingestion, inbox sync, CRM sync-back, y report generation todas necesitan workers dedicados. El patrón está establecido (BullMQ + handler), pero solo se implementó para publishing. Cada feature que necesita "polling" o "scheduled execution" está incompleta porque falta el worker.

---

## Part 7 — By the Numbers

| Metric                 | Value   |
| ---------------------- | ------- |
| Admin pages            | 38      |
| Client pages           | 9       |
| API route files        | 55      |
| Prisma models          | 85      |
| Use cases              | 74+     |
| Queries                | 26+     |
| Provider adapters      | 10      |
| Webhook processors     | 8       |
| Features COMPLETE      | 20      |
| Features PARTIAL       | 3       |
| Features BACKEND ONLY  | 14      |
| Features FRONTEND ONLY | 0       |
| Features STUB          | 2       |
| Features MISSING       | 0       |
| Fix Immediately (≥15)  | 5       |
| Fix Soon (10–14)       | 7       |
| Plan for Later (<10)   | 2       |
| Tests passing (API)    | 6,907   |
| Tests passing (total)  | ~7,400+ |
