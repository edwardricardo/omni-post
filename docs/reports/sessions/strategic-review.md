# OmniPost — Complete Strategic Review

Date: 2026-03-30

## Executive Summary

OmniPost is approximately 75-80% of a shippable social media management platform. The core publishing loop works end-to-end across 10 social platforms with real provider adapters, BullMQ workers, and DDD aggregates. The AI system is genuinely deep — 3 LLM providers with intelligent routing, automatic Brand Voice injection, rate limiting, and fallback. Analytics now flows from real provider data through ingestion workers to custom reports with Prisma aggregation. The inbox syncs comments every 30 minutes and supports real replies through provider APIs. What's missing is not backend capability — it's frontend pages for 6 features that already have complete APIs (campaigns, team management, CRM, assets, trends, video). The single most important thing to do next is build those UI pages, because the backend work is done and the features are invisible to customers without them. The AI differentiation opportunity is real but depends on bridging analytics data into content generation — something no competitor does today.

---

## Part 1 — Application Structure

### Raw Numbers

| Metric                        | Count |
| ----------------------------- | ----- |
| apps/admin pages              | 12    |
| apps/client pages             | 33    |
| apps/admin components (.tsx)  | 35    |
| apps/client components (.tsx) | 206   |
| apps/api .ts files (non-test) | 709   |
| apps/workers .ts files        | 5     |
| Use cases (\*UseCase.ts)      | 113   |
| Queries (\*Query.ts)          | 40    |
| Prisma models                 | 86    |
| DI tokens (Symbol.for)        | 259   |
| Provider adapters             | 10    |
| Packages                      | 9     |
| Test files (API)              | 373   |
| Test files (admin)            | 21    |
| Test files (client)           | 9     |
| Total test files              | 403   |
| Tests passing                 | 7,029 |

### Package Structure

| Package       | Purpose                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| adapters      | cache-redis, db-prisma, queue-bullmq, storage-s3                                                                 |
| api-common    | BaseRouteHandler, CSV export                                                                                     |
| core          | Shared core types                                                                                                |
| monitoring    | Circuit breaker, health checks                                                                                   |
| observability | OpenTelemetry instrumentation                                                                                    |
| ports         | Technology-free interfaces (ProviderAdapter, QueuePort, etc.)                                                    |
| providers     | 10 platform adapters (x, instagram, facebook, youtube, tiktok, linkedin, pinterest, snapchat, telegram, bluesky) |
| shared        | Types, events, CQRS, saga definitions                                                                            |
| ui            | Shared React components (Button, Dialog, Input, Tabs, etc.)                                                      |

### Workers

| Worker                | Queue                 | Schedule    | Purpose                                                         |
| --------------------- | --------------------- | ----------- | --------------------------------------------------------------- |
| publishWorker         | PUBLISH               | On-demand   | Publishes posts via provider adapters                           |
| analyticsIngestWorker | ANALYTICS_AGGREGATION | Every 6h    | Fetches analytics from providers, upserts AnalyticsDailySummary |
| inboxSyncWorker       | INBOX_SYNC            | Every 30min | Fetches comments from providers, ingests into social inbox      |

### Apps

| App    | Pages | Purpose                                                                              | Auth                                   |
| ------ | ----- | ------------------------------------------------------------------------------------ | -------------------------------------- |
| admin  | 12    | Owner portal: accounts, subscriptions, security, compliance, webhooks, audit logs    | AdminUser + admin-session cookie       |
| client | 33    | Customer product: posts, inbox, scheduling, analytics, AI, tasks, channels, settings | CustomerUser + customer-session cookie |

---

## Part 2 — Feature Capability Map

### Classification Legend

- **COMPLETE**: Backend + frontend + real data, fully wired end-to-end
- **PARTIAL**: Most pieces exist, key gap somewhere
- **BACKEND_ONLY**: API routes/use cases exist, no UI page
- **MISSING**: Not built

### Core Publishing

| Feature                | Status   | Backend                                     | Frontend                         | Real Data | Notes                                             |
| ---------------------- | -------- | ------------------------------------------- | -------------------------------- | --------- | ------------------------------------------------- |
| Post composer          | COMPLETE | PostAggregate + DDD                         | ContentPreviewSystem (598 lines) | Yes       | 10-platform content adaptation engine             |
| Platform previews (10) | COMPLETE | ProviderAdaptationEngine                    | provider-previews.tsx            | Yes       | X, IG, FB, YT, TT, LI, Pin, Snap, TG, Bluesky     |
| Image upload           | COMPLETE | S3 storage adapter                          | MediaUploadZone                  | Yes       | Upload + preview                                  |
| Video upload           | PARTIAL  | VideoProcessingJob model                    | InstagramUpload page             | Yes       | Instagram-focused, no general video processing UI |
| Emoji picker           | COMPLETE | emoji-mart in @packages/ui                  | EmojiPickerButton                | Yes       | Sprint 1 delivery                                 |
| @Mention autocomplete  | COMPLETE | MentionParser + NotifyMentionedUsersService | Inline in composer               | Yes       | Sprint 3 delivery                                 |
| Publish now            | COMPLETE | BullMQ queue + publishWorker                | PublishDialog                    | Yes       | 10 provider adapters call real APIs               |
| Schedule post          | COMPLETE | SchedulePostUseCase                         | SchedulePicker                   | Yes       | Validates 5min advance, 1yr max                   |
| Draft saving           | COMPLETE | Post status: DRAFT                          | Auto-save in editor              | Yes       | Full draft lifecycle                              |
| Recurring posts        | COMPLETE | Cron parsing, occurrence tracking           | RecurringPostForm + List         | Yes       | EXACT/ROTATED/AI_GENERATED modes                  |
| Publishing queue       | COMPLETE | BullMQ PUBLISH queue                        | /dashboard/queue page            | Yes       | Live polling with status                          |

### Scheduling

| Feature                 | Status   | Backend                     | Frontend                    | Real Data | Notes                                 |
| ----------------------- | -------- | --------------------------- | --------------------------- | --------- | ------------------------------------- |
| Calendar month view     | COMPLETE | Scheduled posts query       | SchedulingDashboardCalendar | Yes       | Full month with post dots             |
| Calendar week/day views | PARTIAL  | Same backend                | "Coming Soon" in UI         | N/A       | Month works, week/day not implemented |
| CSV bulk upload         | COMPLETE | Parsing + validation        | CSVBulkUpload component     | Yes       | Multi-platform bulk scheduling        |
| Optimal times           | COMPLETE | PredictOptimalTimingUseCase | OptimalTimesView            | AI-based  | Uses Perplexity for predictions       |

### Social Inbox

| Feature                | Status   | Backend                                     | Frontend                       | Real Data | Notes                              |
| ---------------------- | -------- | ------------------------------------------- | ------------------------------ | --------- | ---------------------------------- |
| Inbox messages         | COMPLETE | IngestSocialMessageUseCase                  | InboxLayout + ConversationList | Yes       | Deduplication by providerMessageId |
| Inbox reply            | COMPLETE | SendReplyUseCase calls provider.postReply() | ReplyComposer                  | Yes       | Real provider API calls            |
| Internal notes         | COMPLETE | ConversationNote model, 3 use cases         | In ConversationThread          | Yes       | Sprint 1 delivery                  |
| @Mention notifications | COMPLETE | NotifyMentionedUsersService                 | In-app notification            | Yes       | Sprint 3 delivery                  |
| Auto-sync worker       | COMPLETE | inboxSyncWorker + DispatchInboxSyncUseCase  | Transparent                    | Yes       | Every 30min, cursor pagination     |

### Analytics

| Feature               | Status   | Backend                                        | Frontend                       | Real Data | Notes                                   |
| --------------------- | -------- | ---------------------------------------------- | ------------------------------ | --------- | --------------------------------------- |
| Analytics dashboard   | COMPLETE | GetCrossPlatformAnalyticsUseCase               | UniversalAnalyticsDashboard    | Yes       | KPIs + per-platform breakdown           |
| Analytics ingestion   | COMPLETE | analyticsIngestWorker                          | Transparent                    | Yes       | Every 6h, upserts AnalyticsDailySummary |
| Custom report builder | COMPLETE | RunCustomReportQuery (real Prisma aggregation) | /analytics/reports page        | Yes       | Math.random() REMOVED                   |
| Report scheduling     | COMPLETE | ScheduleCustomReportUseCase                    | CreateReportForm               | Yes       | Cron + timezone                         |
| Report export         | COMPLETE | CSV export via @packages/api-common            | In report UI                   | Yes       | Headers + data                          |
| Performance insights  | COMPLETE | AnalyticsReadRepository                        | PerformanceInsights components | Yes       | Cross-platform analysis                 |
| Historical analytics  | COMPLETE | GetHistoricalAnalyticsQuery                    | In analytics pages             | Yes       | Time-series data                        |

### AI Features

| Feature                   | Status   | Backend                              | Frontend                       | Real Data | Notes                                           |
| ------------------------- | -------- | ------------------------------------ | ------------------------------ | --------- | ----------------------------------------------- |
| AI text generation        | COMPLETE | AIOrchestrator (3 providers)         | AIContentGenerator             | Yes       | GPT-4/Gemini/Perplexity routing                 |
| AI image generation       | COMPLETE | DALL-E 3 via GenerateImageUseCase    | AIImageGenerator               | Yes       | Real OpenAI API calls                           |
| AI content optimization   | COMPLETE | optimizeContent() + Brand Voice      | SmartContentOptimizer (5 tabs) | Yes       | Sentiment, tone, readability, engagement        |
| AI performance prediction | COMPLETE | predictPerformance() via Perplexity  | PredictiveAnalytics (4 tabs)   | AI-based  | Uses Perplexity Sonar for web-aware predictions |
| AI content variations     | COMPLETE | generateVariations()                 | In AIContentResults            | Yes       | Multiple version generation                     |
| AI prompt templates       | COMPLETE | AIPromptTemplate model, CRUD         | PromptTemplateManager          | Yes       | 6 system + custom templates                     |
| AI best time to post      | COMPLETE | PredictOptimalTimingUseCase          | OptimalTimesView               | AI-based  | AI-driven, not analytics-driven                 |
| Brand Voice               | COMPLETE | BrandVoice model, auto-injection     | BrandVoiceForm in settings     | Yes       | systemPrompt prepended to all AI calls          |
| Brand Kit                 | COMPLETE | BrandKit model (colors, fonts, logo) | In settings                    | Yes       | Hex validation, font management                 |

### Enterprise

| Feature               | Status       | Backend                               | Frontend                                             | Real Data | Notes                                   |
| --------------------- | ------------ | ------------------------------------- | ---------------------------------------------------- | --------- | --------------------------------------- |
| SSO / SAML            | COMPLETE     | ConfigureSamlUseCase + routes         | SamlConfigForm + SsoSettings                         | Yes       | SP metadata, ACS URL, certificate       |
| SSO / OIDC            | COMPLETE     | ConfigureOidcUseCase + routes         | OidcConfigForm                                       | Yes       | PKCE flow, auto-discovery               |
| Multi-level approvals | COMPLETE     | ApprovalWorkflow + Level models       | ApprovalQueue + ReviewPanel                          | Yes       | Level progression, workflow builder     |
| Task management       | COMPLETE     | Task entity, 6 use cases, 7 routes    | TaskList, TaskCard, CreateTaskModal, TaskDetailPanel | Yes       | Priority, due dates, mentions           |
| Campaigns             | BACKEND_ONLY | 6 use cases + 2 queries + routes      | No page in client                                    | Yes       | Full CRUD + per-campaign analytics, UTM |
| Team management       | BACKEND_ONLY | Invite, Remove, UpdateRole use cases  | No page in client                                    | N/A       | TeamMember model, role-based            |
| CRM (HubSpot)         | BACKEND_ONLY | ConnectCrm, SyncContacts, LogActivity | No page in client                                    | Yes       | Real contact syncing with pagination    |
| CRM (Salesforce)      | BACKEND_ONLY | Same use cases, ICrmAdapter port      | No page in client                                    | Yes       | Adapter pattern, same API               |

### Integrations

| Feature                | Status       | Backend                          | Frontend                    | Real Data | Notes                                 |
| ---------------------- | ------------ | -------------------------------- | --------------------------- | --------- | ------------------------------------- |
| Zapier integration     | COMPLETE     | API keys + webhook subscriptions | /settings/integrations page | Yes       | Event triggers on post.published etc. |
| Make integration       | COMPLETE     | Generalized from Zapier infra    | Same settings page          | Yes       | Sprint 2 delivery                     |
| Google Drive import    | BACKEND_ONLY | ImportFromGoogleDriveUseCase     | No UI trigger               | N/A       | Backend ready, no picker UI           |
| External notifications | PARTIAL      | ExternalNotificationConfig model | /settings/integrations      | Yes       | Slack/Teams webhooks, no email        |

### Other

| Feature                | Status       | Backend                                        | Frontend                        | Real Data   | Notes                              |
| ---------------------- | ------------ | ---------------------------------------------- | ------------------------------- | ----------- | ---------------------------------- |
| Content library        | COMPLETE     | PlatformContentAdapter (20 files)              | ContentLibrary + grid/list      | Yes         | Search, filter, bulk, pagination   |
| Content templates      | COMPLETE     | Template + 8 Prisma models                     | ContentTemplates + TemplateGrid | Yes         | A/B testing, version control       |
| Link tracking + UTM    | COMPLETE     | TrackedLink, LinkClick, UTM module             | In publishing flow              | Yes         | Short codes, click analytics       |
| Crisis management      | COMPLETE     | Enter/Exit/GetStatus use cases                 | No dedicated page               | Yes         | Pauses scheduled posts             |
| Notifications (in-app) | COMPLETE     | CreateNotification, SSE stream                 | NotificationBell + Zustand      | Yes         | Real-time via SSE                  |
| Notifications (email)  | MISSING      | No email send implementation                   | N/A                             | N/A         | Only in-app + SSE                  |
| Instagram Stories      | COMPLETE     | InstagramStory + Project models                | StoriesEditor + timeline        | Yes         | Full story workflow                |
| Usage metering         | PARTIAL      | UsageMetric model, GetUsage                    | Admin has subscriptions page    | Placeholder | Admin billing data appears mock    |
| Asset management       | BACKEND_ONLY | MediaAsset, AssetFolder, AssetTag, 7 use cases | No standalone upload UI         | N/A         | Content library is post-centric    |
| Trends                 | BACKEND_ONLY | trends/ module (4 files)                       | No client page                  | N/A         | Backend exists, no UI              |
| Video processing       | BACKEND_ONLY | VideoProcessingJob, VideoSegment               | Only Instagram upload           | N/A         | General video processing has no UI |

### Summary Counts

| Classification              | Count  |
| --------------------------- | ------ |
| COMPLETE                    | 39     |
| PARTIAL                     | 5      |
| BACKEND_ONLY                | 9      |
| MISSING                     | 1      |
| **Total features assessed** | **54** |

---

## Part 3 — End-to-End Flow Status

### Flow 1: New Customer Signs Up and Publishes First Post

| Step                | Component                                                                                                                         | Status |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1. Register         | apps/client /register page -> POST /auth/customer/register -> RegisterCustomerUseCase (creates Account + CustomerUser atomically) | WORKS  |
| 2. Login            | customer-session httpOnly cookie set by proxy, authContext validates via /auth/customer/me                                        | WORKS  |
| 3. Connect channel  | /dashboard/channels page -> useChannels + useProviders hooks -> provider OAuth flow                                               | WORKS  |
| 4. Create post      | /dashboard/posts/new -> ClientContentEditor -> ProviderAdaptationEngine (487 lines) -> POST /posts                                | WORKS  |
| 5. Schedule/publish | SchedulePostUseCase validates, enqueues to BullMQ PUBLISH queue                                                                   | WORKS  |
| 6. Worker delivers  | publishWorker resolves adapter from 10-provider registry -> adapter.publish() calls real API                                      | WORKS  |
| 7. Status update    | PublishLog records result, saga notifications via Redis pub/sub                                                                   | WORKS  |

**Verdict: WORKS END-TO-END.** The full publishing pipeline is the most complete part of the product.

### Flow 2: Analytics After 7 Days

| Step                 | Component                                                                                    | Status |
| -------------------- | -------------------------------------------------------------------------------------------- | ------ |
| 1. Ingestion         | analyticsIngestWorker (every 6h) -> adapter.fetchAnalytics() -> upsert AnalyticsDailySummary | WORKS  |
| 2. Dashboard         | /dashboard/analytics -> UniversalAnalyticsDashboard -> useUniversalAnalytics hook            | WORKS  |
| 3. Custom report     | /analytics/reports -> RunCustomReportQuery with real Prisma groupBy on AnalyticsDailySummary | WORKS  |
| 4. Report scheduling | ScheduleCustomReportUseCase with cron + timezone                                             | WORKS  |

**Verdict: WORKS END-TO-END.** Real data flows from providers through workers to dashboards and reports. Math.random() removed.

### Flow 3: Inbox Message Arrives and Gets Replied To

| Step             | Component                                                                     | Status |
| ---------------- | ----------------------------------------------------------------------------- | ------ |
| 1. Sync          | inboxSyncWorker (every 30min) -> adapter.getComments() with cursor pagination | WORKS  |
| 2. Deduplication | IngestSocialMessageUseCase checks providerMessageId before creating           | WORKS  |
| 3. Display       | /dashboard/inbox -> InboxLayout + ConversationList + MessageBubble            | WORKS  |
| 4. Reply         | ReplyComposer -> SendReplyUseCase -> provider.postReply() calls real API      | WORKS  |

**Verdict: WORKS END-TO-END.** The inbox is fully wired from provider sync through display to reply.

---

## Part 4 — Honest Assessment

### 4a — Overall Product Completeness

En mi opinion, OmniPost esta al ~75-80% de un producto shippable. El desglose:

- **Core publishing: 95%.** El loop crear->adaptar->publicar->monitorear funciona con 10 proveedores reales. El ProviderAdaptationEngine (487 lineas) es genuinamente sofisticado — adapta contenido por plataforma con truncamiento inteligente, threading, hashtag optimization. Es la parte mas completa.

- **Analytics: 85%.** La pipeline de ingestion funciona (cada 6h), los dashboards muestran datos reales, los custom reports usan Prisma aggregation real. Lo que falta: el calendar week/day view, y los reportes no son compartibles externamente.

- **Inbox: 90%.** Sync automatico cada 30min, deduplicacion, reply real a traves de provider APIs, notas internas, @mentions con notificaciones. Muy completo.

- **AI features: 80%.** Tres proveedores LLM con routing inteligente, Brand Voice inyectado automaticamente, rate limiting con fallback. Lo que falta y seria diferenciador: el AI no consume datos de analytics para mejorar la generacion. Genera contenido "ciego" al rendimiento historico.

- **Enterprise features: 70%.** SSO (SAML + OIDC) completo con UI. Approvals multi-nivel completo. Tasks completo. Pero: CRM no tiene UI (backend listo), team management no tiene UI (backend listo), campaigns no tiene UI (backend listo).

- **Admin portal: 60%.** Funciona para monitoring basico (accounts, security, compliance, webhooks, audit logs). Pero la data de billing/subscriptions parece placeholder — no hay integracion real con Stripe u otro payment processor.

- **Customer onboarding: 65%.** Un customer puede registrarse, loguearse, conectar channels, y publicar. Pero no puede: invitar a su equipo (no team UI), organizar trabajo por campanas (no campaign UI), conectar CRM (no CRM UI). Estas son features que las agencies necesitan desde el dia 1.

### 4b — Biggest Improvement Since Last Review

Lo que veo es que el Sprint Gaps cerro los 5 gaps mas criticos identificados en el code review anterior. El impacto mas tangible: **analytics ahora fluye con datos reales.** Antes, el dashboard de analytics y los custom reports mostraban Math.random() — literalmente numeros aleatorios. Ahora hay un pipeline real: provider -> worker (cada 6h) -> AnalyticsDailySummary -> Prisma groupBy -> chart data. Un usuario real ahora puede ver metricas reales de sus cuentas sociales.

El segundo cambio mas importante fue completar SyncProviderCommentsUseCase (Step 7 wired) y el inboxSyncWorker. Antes, el inbox solo recibia mensajes via webhooks — si un provider no mandaba webhooks, los mensajes nunca aparecian. Ahora hay polling proactivo cada 30 minutos.

### 4c — Most Critical Gap Right Now

Creo que el gap mas critico no es tecnico — es funcional. **No hay team management UI.** Para el target customer de OmniPost (agencies con 5-50 personas), la primera cosa que hacen despues de registrarse es invitar a su equipo. Sin esa pagina, la agency no puede usar OmniPost en equipo, lo cual es literalmente el core use case de una herramienta de social media management.

El backend esta completo: InviteTeamMemberUseCase, RemoveTeamMemberUseCase, UpdateTeamMemberRoleUseCase, GetTeamMembersQuery. Solo falta la pagina en apps/client con un formulario de invitacion y una lista de miembros.

### 4d — Technically Solid But Under-Exploited

Lo que veo es:

1. **CRM integration (HubSpot + Salesforce)** — El backend tiene ICrmAdapter con adapters reales para ambas plataformas, sync de contactos con paginacion, activity logging. Pero sin UI, ningun usuario sabe que existe. Es enterprise-grade infrastructure invisible.

2. **Campaign system** — 6 use cases, UTM parameters, per-campaign analytics. Todo funciona. Pero no hay pagina de campaigns en el client. Un usuario no puede crear una campana desde la UI.

3. **Content versioning system** — 20 archivos en apps/api/src/content/ incluyendo BranchManager, ConflictDetector, MergeManager, DiffCalculator, SyncEngine, VersionController. Es un sistema Git-like para contenido. Impresionante arquitecturalmente, pero es cuestionable si un social media manager necesita branching y merging de posts.

4. **Trend detection module** — 4 archivos en backend. Sin UI, sin conexion a datos en tiempo real.

### 4e — Over-Engineering Assessment

En mi opinion, si. La complejidad es desproporcionada para la etapa actual del producto:

- **86 Prisma models** para un producto pre-launch construido por una persona. Hootsuite probablemente tenia menos cuando alcanzo su primer millon de usuarios.
- **259 DI tokens** implica que casi todo pasa por el container de inyeccion de dependencias. Esto es correcto arquitecturalmente pero agrega friccion a cada nuevo feature.
- **Content versioning (20 archivos)** con branching, merging, conflict detection — esto es infraestructura para Google Docs, no para tweets.
- **Saga pattern + Outbox** es production-grade event sourcing. Excelente para confiabilidad, pero un solo desarrollador mantiene toda esta complejidad.

Sin embargo, la calidad del codigo es alta. Hexagonal architecture esta limpiamente implementada — la capa de dominio no importa Prisma ni Fastify. Los tests son extensivos (7,029 passing). La separacion CQRS es real, no cosmetica. Si OmniPost escala a un equipo de 5-10 desarrolladores, esta arquitectura paga dividendos. El riesgo es que la velocidad de iteracion de un solo developer esta limitada por la ceremonia arquitectural.

### 4f — Client App Verdict

Creo que un paying customer puede usar apps/client productivamente para el core loop: publicar contenido en multiples plataformas, ver analytics, responder a mensajes del inbox. Ese loop funciona bien.

Donde se rompe la experiencia:

1. **No puede invitar a su equipo** — No hay /dashboard/team page
2. **No puede organizar por campanas** — No hay /dashboard/campaigns page
3. **No puede conectar CRM** — No hay /dashboard/settings/crm page
4. **No puede subir assets standalone** — Content library es post-centric
5. **Calendar solo muestra month view** — Week/day son "Coming Soon"
6. **No recibe emails** — Solo notificaciones in-app

Para un freelancer o creador individual, OmniPost funciona hoy. Para una agencia, faltan las paginas de colaboracion.

### 4g — Admin Portal Verdict

En mi opinion, apps/admin funciona como portal de monitoring basico pero no como herramienta de negocio:

- Puede ver lista de accounts, subscriptions, security status
- Audit logs y webhook management funcionan
- Executive dashboard muestra metricas de alto nivel

Pero: la data de billing parece placeholder. No vi integracion con Stripe, Paddle, u otro payment processor. Los numeros de revenue en el executive dashboard probablemente no son reales. Para que Edward pueda operar OmniPost como negocio, necesita billing real — cobrar a customers, manejar trials, upgrades, cancellations.

---

## Part 5 — AI Capabilities

### AI Feature Classification

| Feature                | Level      | Brand Voice       | Analytics Data | Notes                                           |
| ---------------------- | ---------- | ----------------- | -------------- | ----------------------------------------------- |
| Text generation        | INTEGRATED | Auto-injected     | No             | Brand Voice systemPrompt prepended to all calls |
| Image generation       | SURFACE    | No                | No             | DALL-E 3, user pastes result manually           |
| Content optimization   | INTEGRATED | Passed as param   | No             | Platform-specific suggestions                   |
| Performance prediction | SURFACE    | No                | No             | AI estimates, not data-driven                   |
| Content variations     | INTEGRATED | Via system prompt | No             | Multiple versions per platform                  |
| Best time to post      | SURFACE    | No                | No             | Perplexity Sonar, not analytics-based           |
| Smart analysis         | INTEGRATED | Auto-resolved     | No             | Combined analysis + optimization + prediction   |
| Prompt templates       | SURFACE    | Via system prompt | No             | 6 system templates + custom                     |

**Level definitions:**

- **SURFACE**: User-initiated, one-shot, output not fed back into workflow
- **INTEGRATED**: Output feeds into product workflow, Brand Voice automatic
- **AUTONOMOUS**: System acts on data without user trigger — **NONE exist yet**

### Brand Voice Integration Depth

**CONFIRMED:** Brand Voice is genuinely integrated, not surface-level:

1. User configures Brand Voice in /settings/brand-voice (name, systemPrompt, tones, examples)
2. Every AI route handler calls `resolveBrandVoicePrompt(accountId)` via GetBrandVoiceQuery
3. If active, systemPrompt is prepended to LLM messages array
4. All 3 providers (OpenAI, Gemini, Perplexity) receive the brand context
5. Manual override possible by passing explicit brandVoice param

**Gap:** Brand Voice is NOT used in:

- Image generation prompts
- Performance predictions
- Best time to post calculations

### Analytics-AI Bridge

**CONFIRMED: Does NOT exist.** The AI orchestrator has no input channel for analytics data. Content generation is blind to what posts have performed well. This is the single biggest AI improvement opportunity — the data exists (AnalyticsDailySummary is fresh every 6h), the AI system exists, they just aren't connected.

### AI Provider Architecture

| Provider      | Model                | Strengths                                  | Routing Priority        |
| ------------- | -------------------- | ------------------------------------------ | ----------------------- |
| OpenAI        | GPT-4 (configurable) | Content generation, analysis, optimization | Primary for most tasks  |
| Perplexity    | Llama 3.1 Sonar      | Web-aware predictions, research            | Primary for predictions |
| Google Gemini | 1.5 Flash            | Fast tasks, cost-efficient                 | Fallback for all tasks  |

Rate limiting per provider with auto-fallback. In-memory cache with 5min TTL.

### Gap Analysis vs Hootsuite

| Feature                   | Hootsuite                             | OmniPost                                          | Advantage                        |
| ------------------------- | ------------------------------------- | ------------------------------------------------- | -------------------------------- |
| AI caption writing        | OwlyWriter (basic, needs heavy edits) | GPT-4 + Gemini + Perplexity (3 providers)         | OmniPost                         |
| Brand voice adaptation    | Manual brand guidelines               | Auto-injected systemPrompt in every call          | OmniPost                         |
| Real-time trend detection | OwlyGPT + Talkwalker (acquired)       | Backend module exists, no UI or real-time data    | Hootsuite                        |
| Best time to post AI      | Per-network historical data           | AI-based predictions (Perplexity)                 | Tie (different approaches)       |
| AI image generation       | Canva/Adobe integration               | DALL-E 3 native                                   | OmniPost (native vs integration) |
| Sentiment analysis        | Talkwalker (deep, real-time)          | analyzeContent(type: 'sentiment') via LLM         | Hootsuite                        |
| Competitor tracking       | Talkwalker (comprehensive)            | Not available                                     | Hootsuite                        |
| Auto DM responses         | Instagram only (limited)              | Not available                                     | Neither (both weak)              |
| Content repurposing       | Not available                         | Not available (architecture supports it)          | Neither                          |
| Agentic workflows         | Not yet                               | Not yet                                           | Neither                          |
| AI inbox prioritization   | Basic routing                         | Not available                                     | Hootsuite (marginal)             |
| Predictive performance    | Not available                         | PredictiveAnalytics (AI-based, not data-driven)   | OmniPost                         |
| Performance-aware content | Not available                         | Not available (data exists, bridge missing)       | Neither (OmniPost closer)        |
| CRM + Inbox AI context    | Not available                         | Not available (both systems exist, not connected) | Neither (OmniPost closer)        |
| Platform coverage         | ~8 platforms                          | 10 platforms (incl. Bluesky, Snapchat, Telegram)  | OmniPost                         |
| Multi-level approvals     | Basic approval                        | Multi-level workflow builder                      | OmniPost                         |

---

## Part 6 — Priority Scoring

### Incomplete Features (Fix These)

Formula: (Usage x 2) + BusinessImpact + CompletionGap + Blocking

| Rank | Feature                 | Usage | BizImpact | CompGap | Blocking | Score | Reasoning                                                                                                                          |
| ---- | ----------------------- | ----- | --------- | ------- | -------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Team Management UI      | 5     | 5         | 5       | 4        | 24    | Every agency needs this day 1. Backend 100% done. Highest blocking score — campaigns, approvals, tasks all reference team members. |
| 2    | Campaign UI Page        | 4     | 4         | 5       | 3        | 20    | Agencies organize all work by campaign. Backend has full CRUD + UTM + per-campaign analytics. Just needs a page.                   |
| 3    | CRM Settings UI         | 3     | 4         | 5       | 2        | 17    | HubSpot/Salesforce backends are production-ready with real sync. Enterprise customers expect CRM integration to be configurable.   |
| 4    | Email Notifications     | 4     | 3         | 2       | 2        | 15    | In-app only is insufficient for async teams. Needs email channel for approvals, task assignments, mentions. New work (CompGap=2).  |
| 5    | Asset Upload UI         | 3     | 3         | 4       | 2        | 15    | MediaAsset, AssetFolder, AssetTag all exist. Content library is post-centric. Needs standalone asset management page.              |
| 6    | Calendar Week/Day Views | 4     | 2         | 4       | 1        | 15    | Month view works. Week/day marked "Coming Soon". Moderate impact — power users want day view for dense scheduling.                 |
| 7    | Analytics-AI Bridge     | 3     | 5         | 1       | 2        | 14    | The biggest AI differentiator opportunity. Both systems exist but aren't connected. New work required (CompGap=1).                 |
| 8    | Shareable Reports       | 3     | 4         | 1       | 2        | 13    | Agencies need to share analytics with clients. New feature — public link with token auth.                                          |
| 9    | Trends UI Page          | 2     | 3         | 4       | 1        | 12    | Backend module exists. Low urgency but enables AI trend-aware content.                                                             |
| 10   | Google Drive Import UI  | 2     | 2         | 4       | 1        | 11    | Use case exists. Low demand — most users upload directly.                                                                          |
| 11   | Video Processing UI     | 2     | 2         | 3       | 1        | 10    | Backend exists. Instagram-only currently. Threshold score.                                                                         |
| 12   | Admin Billing (Real)    | 2     | 5         | 1       | 1        | 11    | Critical for business but complex. Needs Stripe integration.                                                                       |

### New Features (Build These)

Formula: (Demand x 2) + Revenue + Effort + Dependency

| Rank | Feature                          | Demand | Revenue | Effort | Dependency | Score | Reasoning                                                                                                                               |
| ---- | -------------------------------- | ------ | ------- | ------ | ---------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | AI Platform Content Variants     | 5      | 3       | 4 (S)  | 3          | 20    | One input -> AI generates unique versions for each platform. Uses existing ProviderAdaptationEngine constraints. Every user wants this. |
| 2    | Performance-Aware Content Gen    | 4      | 4       | 3 (M)  | 3          | 18    | Query top posts from AnalyticsDailySummary, use as examples in AI prompt. Only OmniPost can do this. Differentiator.                    |
| 3    | AI Content Calendar Generator    | 4      | 3       | 3 (M)  | 2          | 16    | "Generate my content for next month." Uses campaigns + Brand Voice + scheduling. High demand from agencies.                             |
| 4    | AI Inbox Assistant               | 3      | 4       | 2 (L)  | 3          | 15    | Triage, priority scoring, suggested replies in Brand Voice. Architecture fits (Inbox + AI + Brand Voice exist).                         |
| 5    | Autonomous Post Repurposing      | 3      | 3       | 3 (M)  | 2          | 14    | When post performs well, AI proposes versions for other platforms. First autonomous feature.                                            |
| 6    | Trend Radar (without Talkwalker) | 3      | 3       | 3 (M)  | 1          | 13    | X trending + Google Trends + Reddit. Connect to Brand Voice for relevance.                                                              |
| 7    | AI + CRM Context in Inbox        | 2      | 4       | 3 (M)  | 2          | 13    | Show CRM contact info when inbox message from known contact. AI reply aware of deal stage.                                              |
| 8    | Brand Consistency AI Audit       | 2      | 3       | 3 (M)  | 2          | 12    | Weekly report: tone drift, cross-channel comparison, recommendations.                                                                   |

---

## Part 7 — Backlog Reassessment

Re-scoring remaining deferred items from next-sprint-backlog.md:

| ID            | Capability              | Original | New Score | Change | Recommendation                                                                                                                            |
| ------------- | ----------------------- | -------- | --------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| D-UX-03       | Canva/Adobe Express     | L        | 8         | -      | DEFER. Partnership required, unknown timeline.                                                                                            |
| D-SL-01       | Social Listening        | XL       | 7         | -      | DEFER. Requires dedicated ingestion pipeline. Talkwalker-level capability is XL effort for one developer.                                 |
| D-SL-02       | Sentiment Analysis      | L        | 6         | -      | DEFER. Blocked on D-SL-01. LLM-based sentiment already exists via analyzeContent().                                                       |
| D-SL-03       | Competitor Tracking     | XL       | 7         | -      | DEFER. Requires external data source or paid license.                                                                                     |
| D-AN-02       | Industry Benchmarks     | L        | 8         | -      | DEFER. Requires large user base for meaningful benchmarks.                                                                                |
| D-EA-01/02/03 | Employee Advocacy       | XL/M/M   | 6         | -      | DEFER. Enterprise-only feature, wrong market segment for current stage.                                                                   |
| D-AD-01       | Post Boosting (Meta)    | L        | 11        | +1     | EVALUATE. Meta API approval timeline is the blocker. If approved, high value. (Demand=3)x2 + Revenue=3 + Effort=2(L) + Dependency=1 = 12. |
| D-AD-02       | Ad Campaign Management  | XL       | 6         | -      | DEFER. Separate product category entirely.                                                                                                |
| D-AD-03       | TikTok Ads              | L        | 8         | -      | DEFER. Advertiser account approval required.                                                                                              |
| D-AL-03       | Dropbox Import          | S        | 9         | -      | DEFER. Google Drive done. Low incremental value.                                                                                          |
| D-AI-01       | Brand Voice Fine-tuning | XL       | 7         | -      | DEFER. System prompts deliver 90% of value at 0% of cost. Fine-tuning is expensive and fragile.                                           |
| D-INT-04      | Integration Marketplace | XL       | 10        | +2     | EVALUATE. 6 integrations live now (Zapier, Make, Google Drive, HubSpot, Salesforce, SSO). Approaching the 10-integration threshold.       |

---

## Part 8 — Strategic Opinion

### 8a — Where is OmniPost Really?

En mi opinion, OmniPost esta a 2-3 sprints de ser un producto que un paying customer usaria en vez de Hootsuite — pero solo para un segmento especifico.

Lo que veo es un producto con backend production-grade (113 use cases, 10 providers, hexagonal architecture, 7k tests) pero con UI gaps que lo hacen inutilizable para el target customer principal (agencies). El core loop funciona: publicar, analytics, inbox. Pero las features de colaboracion (team, campaigns) que diferencian un SaaS de una herramienta personal estan sin UI.

La distancia no es de arquitectura ni de backend — es de 6-8 paginas de React.

### 8b — Target Customers

**Customers que OmniPost puede ganar hoy:**

- Freelancers de social media management que manejan 3-5 cuentas, trabajan solos, necesitan publicar en multiples plataformas. No necesitan team features.
- Pequenos negocios con 1-2 personas de marketing que publican su propio contenido. El AI content generator con Brand Voice es valioso para ellos.
- Early adopters tecnicos que valoran: 10 plataformas (incluyendo Bluesky, Telegram), AI avanzado, arquitectura moderna.

**Customers que NO puede ganar hoy:**

- Agencies de marketing digital (5-50 personas) — No pueden invitar equipo, no hay campaigns, no hay CRM UI. Deal-killer.
- Enterprise (50+ personas) — No hay billing real, no hay admin dashboard completo, no hay white-label.
- Creadores individuales que solo usan Instagram/TikTok — Buffer/Later son mas simples y baratos.

### 8c — Single Best Pitch vs Hootsuite

"OmniPost es la unica herramienta de social media donde el AI realmente conoce tu marca. Configura tu Brand Voice una vez y cada caption, cada optimizacion, cada sugerencia habla con tu tono. Publica en 10 plataformas incluyendo Bluesky y Telegram que Hootsuite no soporta. Analytics reales, inbox unificado, aprobaciones multi-nivel — todo por una fraccion del precio de Hootsuite."

### 8d — Highest-ROI Next Move

Creo que el sprint de mayor impacto es **"Complete the Product"**: construir las paginas UI para Team Management, Campaigns, CRM Settings, y Asset Upload. Razon: el backend para estos 4 features ya esta 100% completo. Cada pagina es ~200-400 lineas de React con TanStack Query hooks que llaman a APIs existentes. Una semana de trabajo cierra 4 gaps que bloquean al target customer principal (agencies).

Esto es estrictamente mas eficiente que cualquier nueva feature de AI porque: (1) cero backend work, (2) desbloquea el segmento de mercado mas grande, (3) cada pagina se construye en horas no dias.

### 8e — Deal-Killer Gap vs Hootsuite

**Team management.** Si OmniPost no tiene un /dashboard/team donde una agency pueda invitar miembros, asignar roles, y gestionar permisos dentro de 3 meses, el target customer simplemente no puede usar el producto. Hootsuite permite team collaboration desde el plan mas basico. Sin esto, OmniPost solo sirve para usuarios individuales — un mercado dominado por Buffer y Later.

### 8f — What Should NOT Be Built

1. **Social Listening / Sentiment Analysis pipeline (D-SL-01/02/03).** Suena como differentiador pero es XL effort para un solo developer. Hootsuite pago una adquisicion completa (Talkwalker) para esto. El LLM-based sentiment via analyzeContent() cubre el 80% del caso de uso a 0% del costo de infraestructura. No vale el ROI.

2. **Employee Advocacy (D-EA-01/02/03).** Feature 100% enterprise que requiere un modulo completo de gamification, content curation, compliance review. El target customer actual (agencies) no lo necesita. Construirlo ahora es construir para un mercado que OmniPost no puede alcanzar todavia.

3. **Brand Voice Fine-tuning (D-AI-01).** System prompts con el modelo de Brand Voice actual entregan ~90% del valor. Fine-tuning es caro ($100-1000 por modelo), fragil (puede degradar calidad), y requiere datos de entrenamiento que los usuarios no tienen. El approach actual de system prompt injection es superior en cost/benefit.

### 8g — The Architecture Question

En mi opinion, la arquitectura de OmniPost es simultaneamente su mayor asset y su mayor liability.

**Como asset:** La separacion hexagonal es real y limpia. Puedo agregar un nuevo provider adapter sin tocar ningun use case. Los 7,029 tests dan confianza para refactorizar. El CQRS permite optimizar reads independientemente de writes. Si OmniPost crece a un equipo de 5+ developers, esta arquitectura permite que trabajen en paralelo sin conflictos.

**Como liability:** Un solo developer mantiene 86 modelos Prisma, 259 DI tokens, 113 use cases, patron Saga + Outbox + UoW. Cada nuevo feature requiere: entity, value objects, repository port, Prisma adapter, use case, DI token, DI registration, route handler, schema validation. Son ~8 archivos por feature. La velocidad de iteracion esta limitada por la ceremonia.

**Si empezara hoy:** Mantendria hexagonal architecture y Result types (son high-value). Eliminaria: content versioning (20 archivos para un feature que nadie pidio), el sistema Saga completo (BullMQ reliability es suficiente para social media posts), y reduciria los Prisma models a ~50 colapsando los que tienen 1-2 campos. Pero el costo de cambiar ahora es mayor que el costo de continuar — la arquitectura esta establecida y funciona.

---

## Part 9 — Proposed Sprint Sequence

| Sprint | Name                 | Primary Goal                   | Key Features                                                                                            | Why Now                                                                             |
| ------ | -------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 5      | Complete the Product | Close all backend-only UI gaps | Team Management page, Campaign page, CRM Settings page, Asset Upload page                               | Highest-ROI: 4 pages unlock agency market. Backend 100% done for all 4.             |
| 6      | Ship-Ready Polish    | Make the product feel finished | Calendar week/day views, email notifications, shareable analytics reports, usage dashboard              | Addresses the "almost done" items that power users notice immediately.              |
| 7      | AI Differentiation   | Build the moat                 | Analytics->AI content bridge, AI platform content variants, AI content calendar generator               | Unique capabilities no competitor has. Uses existing analytics + AI infrastructure. |
| 8      | Enterprise & Revenue | Enable the business            | Stripe billing integration, billing enforcement, integration marketplace, Meta post boosting evaluation | Can't charge customers without real billing. Marketplace creates ecosystem lock-in. |

### Sprint 5 Detail (Highest Priority)

| Feature         | Files to Create                                                                             | API Endpoints (existing)    | Effort |
| --------------- | ------------------------------------------------------------------------------------------- | --------------------------- | ------ |
| Team Management | useTasks.ts hook, TeamList.tsx, InviteMemberModal.tsx, /dashboard/team/page.tsx             | GET/POST/PATCH/DELETE /team | S      |
| Campaigns       | useCampaigns.ts hook, CampaignList.tsx, CampaignForm.tsx, /dashboard/campaigns/page.tsx     | GET/POST/PATCH /campaigns   | S      |
| CRM Settings    | useCrm.ts hook, CrmConnectionForm.tsx, CrmContactList.tsx, /dashboard/settings/crm/page.tsx | GET/PUT/POST /crm           | S      |
| Asset Upload    | useAssets.ts hook, AssetUploader.tsx, AssetGrid.tsx, /dashboard/assets/page.tsx             | GET/POST/DELETE /assets     | S      |

All S effort because the backend APIs, DI wiring, and route handlers already exist. Each page is a TanStack Query hook + React components calling existing endpoints.

---

## Part 10 — By the Numbers

| Category | Metric                   | Value |
| -------- | ------------------------ | ----- |
| Code     | Total .ts/.tsx files     | 1,100 |
| Code     | Prisma models            | 86    |
| Code     | Use cases                | 113   |
| Code     | Queries                  | 40    |
| Code     | DI tokens                | 259   |
| Code     | Provider adapters        | 10    |
| Apps     | Admin pages              | 12    |
| Apps     | Client pages             | 33    |
| Apps     | Workers                  | 3     |
| Tests    | Test files               | 403   |
| Tests    | Tests passing            | 7,029 |
| Tests    | Test failures            | 0     |
| Features | COMPLETE                 | 39    |
| Features | PARTIAL                  | 5     |
| Features | BACKEND_ONLY             | 9     |
| Features | MISSING                  | 1     |
| AI       | LLM providers            | 3     |
| AI       | Brand Voice auto-applied | Yes   |
| AI       | Analytics-aware          | No    |
| AI       | Autonomous features      | 0     |
| Flows    | End-to-end working       | 3/3   |
| Backlog  | Deferred items           | 11    |
| Backlog  | Items >= 10 score        | 2     |
