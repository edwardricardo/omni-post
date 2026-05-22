# Plan de Implementación — OmniPost (roadmap de gaps)

> Derivado de [FEATURE_TRACE_MATRIX_ES.md](FEATURE_TRACE_MATRIX_ES.md) §8.4 (orden) y §9 (canon 2026). Solo cubre **gaps** (🟡/📐/💬/⛔); lo ✅ no entra. Orden macro: **Bloqueantes compartidos → Fase 0 → Fase 1 → Fase 2 → Fase 3**.

## Cómo se trackea

- Estado por tarea en el checkbox: `[ ]` pendiente · `[~]` en progreso · `[x]` hecho · `[!]` bloqueado.
- **ID** estable por tarea: `<FASE>-<APP>-<n>` (no renumerar; las tareas nuevas usan el siguiente número libre).
- **Tamaño**: `[S]` ≤1 día · `[M]` 2-3 días. No hay `[L]`: si algo es más grande, se parte.
- **Dependencias**: `🔗 dep:<ID>` (no empezar hasta que esa esté `[x]`). `⛔ bloquea:<área>` marca un ítem cuya demora frena a otros — va aislado en su propia iteración.
- **DoD** = "Hecho cuando": criterio objetivo y verificable. Sin DoD cumplido no se marca `[x]`.
- App tags: **API** `apps/api` · **WRK** `apps/workers` · **CLI** `apps/client` · **ADM** `apps/admin`.
- Regla de orden intra-feature: **datos primero (WRK/API) → superficie después (CLI/ADM)**.
- Toda tarea con código respeta CLAUDE.md (UoW, Result, hexagonal, tests + JSDoc en el mismo sprint).

## Dashboard de progreso

| Bloque                       | Tareas | Hechas | Estado  |
| ---------------------------- | ------ | ------ | ------- |
| Bloqueantes compartidos (B)  | 5      | 5      | ✅      |
| Fase 0 — Funciones autónomas | 11     | 11     | ✅      |
| Fase 1 — Necesarias          | 16     | 7      | 🟦      |
| Fase 2 — Bueno tenerla       | 21     | 0      | ⬜      |
| Fase 3 — Interesantes        | 14     | 0      | ⬜      |
| **Total**                    | **67** | **23** | **34%** |

> Actualizar esta tabla al cerrar cada tarea. `Estado`: ⬜ no iniciado · 🟦 en progreso · ✅ completo.

---

## Bloque B — Bloqueantes compartidos (hacer primero, cada uno aislado)

> Estos 5 son independientes **entre sí** y cada uno desbloquea un set distinto. Pueden ejecutarse en paralelo en 5 tracks separados. Ninguna fase posterior arranca sin su bloqueante.

- [x] **B1** `[M]` **Decisión + spike orquestación de agentes (LangGraph vs propio)** — ⛔ bloquea: Fase 0 completa. Spike de LangGraph (grafo con estado, ReAct, evals de trayectoria) sobre 1 caso (repurpose). **DoD:** ADR en `docs/technical/` con decisión, PoC mínimo que ejecuta un grafo plan→act→reflect y un eval de trayectoria en CI.
- [x] **B2** `[M]` **Migración BullMQ repeatable jobs → Job Schedulers (`upsert`)** (API+WRK) — ⛔ bloquea: RSS, recycling, scheduled reports, scheduling tz. Repeatable deprecado desde 5.16.0. **DoD:** cero usos de `repeat:` legacy; todos los recurrentes vía Job Scheduler; tests verdes; sin jobs duplicados tras deploy.
- [x] **B3** `[M]` **Sustrato OAuth 2.1 + PKCE compartido** (API) — ⛔ bloquea: Canva, MCP, hardening connect. Helper único Auth Code + PKCE (S256), state server-side, refresh token rotation, tokens cifrados at-rest. **DoD:** módulo reutilizable + tests; redirect exact-match; un proveedor piloto migrado.
- [x] **B4** `[S]` **Decisión de producto: alcance multi-idioma** — ⛔ bloquea: Fase 1 multi-idioma. Decisión de negocio (locales objetivo LATAM, ¿UI + generación IA?). **DoD:** decisión registrada en `docs/product/` con locales y alcance (UI / contenido IA / ambos). → [MULTILINGUAL_SCOPE_ES.md](MULTILINGUAL_SCOPE_ES.md) (es/en, default es, alcance UI+IA, extensible).
- [x] **B5** `[M]` **Semantic layer mínimo (métricas/dims gobernadas)** (API) — ⛔ bloquea: custom report builder, Looker connector. Definición única de métricas (engagement rate, alcance…) que compila queries. **DoD:** capa con ≥10 métricas core, una métrica = una definición; consumida por al menos un reporte existente. → `MetricRegistry`/`DimensionRegistry` (dominio puro, 10 métricas, drift-guard); `RunCustomReportQuery` delega; catálogo honesto (fantasma fuera).

---

## Fase 0 — Funciones autónomas (cerrar brecha pitch↔código) 🔴

> Se vende a inversores y devuelve `501`. Tres slices verticales **independientes entre sí** (repurpose / triage / trends): pueden ir en paralelo. Cada slice: WRK → API → CLI. Todas 🔗 dep:B1.

### Slice A — Repurposing

- [x] **F0-WRK-1** `[M]` Worker consumidor de `DETECT_REPURPOSE`/`GENERATE_REPURPOSE` con grafo de agente (canon §9.1). 🔗 dep:B1. **DoD:** worker procesa un job real end-to-end con mock de LLM determinista; idempotente (inbox dedupe). → consumers `GENERATE_REPURPOSE` (grafo B1, interrupt HITL → variante PENDING) y `DETECT_REPURPOSE` (high-performers → proposals → encola GENERATE) hospedados en apps/api + coordinador diario `DispatchDetectRepurposeUseCase`; idempotentes; tests deterministas.
- [x] **F0-API-1** `[S]` Retirar `501` de `repurposeRoutes.ts`, exponer endpoints + DTOs + UoW. 🔗 dep:F0-WRK-1. **DoD:** endpoint responde 2xx, encola job, integration test verde. → `GET /repurpose/proposals` (CQRS read-side propio: `RepurposeProposalQueryRepository` + `ListRepurposeProposalsQuery` + adapter Prisma, Decimal→Number) y `POST /repurpose/detect` (client-auth scoped al JWT, corrige el framing admin equivocado; invoca `DetectRepurposeCandidatesUseCase` ya UoW/idempotente, encola GENERATE); unit + integration tests (fail-loud).
- [x] **F0-CLI-1** `[M]` UI de control de repurpose en client. 🔗 dep:F0-API-1. **DoD:** usuario dispara/ve resultado; test de componente. → `apps/client` `/dashboard/ai/repurpose` reescrita al contrato real (hook dedicado `useRepurpose` espejo de `useReports`): lista proposals (DTO real) + botón "Detect now" (POST /repurpose/detect, toast con counts + refetch); banner 501 muerto retirado; integration test de componente (lista/vacío/error/detect). Scope list+detect; approve/reject variantes + nav IA → backlog vivo (SMELL-3/4). Cierra slice A (WRK+API+CLI).

### Slice B — Inbox triage

- [x] **F0-WRK-2** `[M]` Worker `TRIAGE_INBOX`: clasificación intent/sentimiento con **structured outputs** + few-shot (canon §9.1). 🔗 dep:B1. **DoD:** clasifica mensaje a schema fijo; eval set de consistencia en CI. → `TriageInboxMessageUseCase` migrado a `AIServicePort.generateStructured` con `triageSpec` (zod: priority enum + sentimentScore en [-1,1] + suggestedReplies length=3) + few-shot embebido en messages; `TriageAIPort` retirado (wrapper 1:1 sin valor); nuevo `TriageDispatchEventHandler` (infra, mirror `IntegrationEventDeliveryHandler`) suscrito al `EventDispatcher` para `SocialMessageReceived`, encola `TRIAGE_INBOX` dedupeKey por messageId; consumer `triageInboxHandler` en apps/api wireado en `index.ts` (BullMQ subscribe + shutdown close); eval set vitest determinista (3 archivos / 28 tests). Cobertura sync (inboxSyncWorker bypass) reconocida como gap → SMELL-11 backlog.
- [x] **F0-API-2** `[S]` Endpoints de triage + persistencia (`priority`, `suggestedReplies`, `sentimentScore`). 🔗 dep:F0-WRK-2. **DoD:** integration test; campos poblados. → `SocialMessageDTO` extendido con 5 triage fields (`priority`, `sentimentScore` con `Decimal→Number`, `suggestedReplies`, `aiProcessedAt`, `crmContactId`); los 3 endpoints existentes (`GET /inbox`, `/inbox/mentions`, `/inbox/conversations/:id/messages`) los exponen automáticamente vía `toDTO()` en `PrismaSocialMessageQueryRepository`. Bug pre-existente del accessor (`request.user` → `request.customerUser`, mismo anti-pattern que SMELL-2) corregido en `inboxRoutes.ts` (14 sitios) para que el customer JWT path funcione end-to-end. Integration test fail-loud (5 casos: 3 endpoints + cross-tenant + 401).
- [x] **F0-CLI-2** `[M]` Vista de triage en la bandeja (prioridad/sentimiento/sugerencias). 🔗 dep:F0-API-2. **DoD:** bandeja muestra clasificación; test componente. → Rewrite completo del cliente inbox alineado al backend canon (regla durable: frontend acopla a backend). Types client mirror server DTOs 1:1 (`InboxMessage`/`InboxMessagesPage`/`InboxConversation`); hooks renombrados (`useInboxMessages`); 7 components reescritos para consumir flat `SocialMessageDTO` (priority badge URGENT/HIGH, sentiment label negative/neutral/positive, message-type badge, In-CRM badge, suggested-reply chips click → composer). Integration test 5/5 (empty, render con triage, abre thread on click, chip → pre-fill composer, error state). 4 smells localizados al backlog (SMELL-12..15). Cierra slice B.

### Slice C — Trend radar

- [x] **F0-WRK-3** `[L]` Worker `TREND_RADAR` (detección de tendencias del nicho, multi-source con provenance). 🔗 dep:B1. **DoD:** genera trend report desde datos reales; idempotente. → Originalmente `[M]`, expandido a `[L]` por decisión de Edward (multi-source completo desde día 1). Schema `TrendRadarResult` extendido con `source` (`TrendSource` enum: `PERPLEXITY_WEB` / `ACCOUNT_ANALYTICS` / `INBOX_MENTIONS`) + `sourceUrl`; migración `20260520024657_add_trendradar_source_provenance`. `ScoreTrendRelevanceUseCase` migrado a `AIServicePort.generateStructured` (drop wrapper `ScoreTrendAIPort`, canon B1) con nuevo `trendScoringSpec` y `trendDiscoverySpec`. `TrendingDataPort` rediseñado con provenance por trend; 3 adapters (`PerplexityTrendingAdapter` via Sonar — canon INVESTOR_EN.md:231, `AccountAnalyticsTrendingAdapter` via `AnalyticsDailySummary`+`PostContent.tags`, `InboxMentionsTrendingAdapter` via regex Unicode sobre `SocialMessage.body`) compuestos por `MultiSourceTrendingDataAdapter` (Promise.allSettled, fail-soft). `DetectTrendsUseCase` orquesta fetch→score→persist con normalización `Provider` enum + idempotent upsert día-bucketed via `PrismaTrendRadarResultAdapter`. `DispatchDetectTrendsUseCase` coordinator (mirror `DispatchDetectRepurposeUseCase`, dedupeKey `trend-radar-${accountId}-${day}`). Consumer `trendRadarHandler` wireado en `apps/api/src/index.ts` + scheduler 24h. Tests vitest deterministas (9 archivos / 64 tests: handler, dispatcher, orchestrator, fetch+score, TrendRadarResultPort + 5 adapters Perplexity/AccountAnalytics/InboxMentions/MultiSource/PrismaTrendRadarResult). 2 SMELLs nuevos al backlog: gating Perplexity plan-tier / on-demand (SMELL-16); citation surface gap en `AIServicePort` (SMELL-17).
- [x] **F0-API-3** `[S]` Endpoints trend radar + DTOs. 🔗 dep:F0-WRK-3. **DoD:** integration test verde. → `GET /trends/radar` (account-scoped, JWT-authed, cross-tenant guard 403 si `accountId` query param ≠ JWT account). CQRS read-side: `TrendRadarQueryRepository` port (domain) + `ScoredTrendDTO` (10 fields: topic, platform, source, sourceUrl, relevanceScore, postIdea, bestPlatform, urgency, volume, fetchedAt) + `GetTrendRadarQuery` use case (limit clamped [1,50], default 20) + `PrismaTrendRadarQueryAdapter` (filtra `expiresAt > now`, order by relevanceScore desc + fetchedAt desc, Decimal→Number). Plugin Fastify nuevo `trendRadarRoutes.ts` registrado en `index.ts` después del legacy. DI: 2 nuevos tokens (`TrendRadarQueryRepository`, `GetTrendRadarQuery`). Tests vitest (4 archivos / 28 tests: port contract + use case + adapter + route plugin via Fastify inject) + integration fail-loud `tests/integration/trendRadarRoutes.test.ts` (5 casos: happy path con provenance + expiresAt filter + 401 + 403 cross-tenant + cross-tenant data isolation). Sistema legacy `/trends/{analysis,viral,opportunities,predictions,report}` deliberadamente intacto → SMELL-18 backlog (chain-delete requiere audit propio).
- [x] **F0-CLI-3** `[M]` UI trend radar. 🔗 dep:F0-API-3. **DoD:** panel renderiza tendencias; test componente. → Rewrite completo de `apps/client/app/dashboard/ai/trends/page.tsx` (133 LOC → 181 LOC): drop `useState/useEffect/fetch` raw → `useTrendRadar` (TanStack Query canon, mirror `useRepurpose`). Provenance badge per trend (`PERPLEXITY_WEB`/`ACCOUNT_ANALYTICS`/`INBOX_MENTIONS`), `sourceUrl` external link cuando present (target `_blank` + `rel noopener noreferrer`), urgency grouping (NOW/TODAY/THIS_WEEK), 4 estados (loading/error/empty/populated) con a11y roles. **SMELL-4 cerrado**: sidebar AI sub-menu colapsable con 6 entries (Generate/Trends/Repurpose/Optimizer/Templates/AI Analytics), auto-expand cuando `/dashboard/ai/*`, aria-expanded toggle. Tests con MSW v2 canon (`tests/mocks/handlers/trendRadar.ts` registrado en barrel): hook (6 tests, success + 5 error/edge cases), page (7 tests, los 4 estados + provenance + sourceUrl + urgency grouping), layout sub-menu (5 tests, auto-expand + toggle + 6 sub-entries hrefs). **Bonus crítico (SMELL-19)**: durante smoke test E2E descubrí que `apps/client/next.config.mjs` tenía un rewrite global `/api/:path*` que confiscaba TODAS las llamadas `/api/backend/*` antes de llegar al route handler, generando 404 en runtime — bug latente desde F0-CLI-1 que rompía repurpose, inbox, billing, posts. Removido el rewrite (route handler es ahora el único proxy canónico).

### Transversal de fase

- [x] **F0-API-4** `[M]` Guardrails pre/post acción + telemetría de tasa-de-fallo (canon §9.1). 🔗 dep:F0-API-1. **DoD:** acción irreversible pasa por guardrail; métrica de fallo expuesta. → Nuevo `GuardrailPort` (domain) + `GuardrailRegistry` composer (application, cascade fail-fast con Prometheus instrumentation) + dos adapters concretos en infrastructure (`ContentPolicyGuardrail` rules-based max length + banned terms; `PIIRedactionGuardrail` regex sobre email/phone/SSN + Luhn check para credit-card). DI registrado via `setupGuardrailUseCases.ts`. Wire en `SendReplyUseCase` pre-acción (rechaza con `GUARDRAIL_REJECTED` antes de cualquier persistencia/provider call; mapping a HTTP 422 en `inboxRoutes.ts`) y `TriageInboxMessageUseCase` post-AI (filtra `suggestedReplies` AI-generated, drop silencioso de cualquier item bloqueado — graceful degradation). Métricas Prometheus expuestas en `/metrics`: `omnipost_guardrail_evaluations_total{guardrail,action,decision}` counter + `omnipost_guardrail_duration_seconds{guardrail,action}` histogram (registro singleton-safe via `getSingleMetric`). Nuevo error code `GUARDRAIL_REJECTED` en `USE_CASE_ERRORS`. Tests: 38 unit (port contract + 2 guardrails + composer + métricas + DI setup + wire SendReply) + 2 integration fail-loud (HTTP 422 + counter incremento verificado en `/metrics`). Coverage: ambos paths canon (pre y post acción).
- [x] **F0-API-5** `[S]` Evals de trayectoria en CI (mocks deterministas) para los 3 slices. 🔗 dep:F0-WRK-1,F0-WRK-2,F0-WRK-3. **DoD:** CI falla si la trayectoria/coste se degrada. → Nueva suite dedicada `apps/api/tests/eval/`: `repurposeTrajectory.eval.test.ts` (4 tests — node order plan→act→reflect, upper-bound de tokenCost via `TrajectoryRecorder.snapshot()`, HITL `interrupt()` después de reflect, resume to terminal), `triageTrajectory.eval.test.ts` (5 tests — call order loadMessage→generateStructured→updateMessageTriage via vi.fn() ordering, MAX_TRIAGE_AI_CALLS=1, suggestedReplies cardinality=3, sentimentScore range, priority enum), `trendsTrajectory.eval.test.ts` (5 tests — pipeline stage order fetch→score→persist, MAX_TRENDS_AI_CALLS=1, relevance threshold ≥6 policy, short-circuit on empty fetch, provenance source propagation). Todos los runs son deterministas (mocks de `AIServicePort`, `TrendingDataPort`, etc. — sin red, sin Prisma, sin Redis). Nuevo `test:eval` script en `apps/api/package.json`. Nuevo workflow `.github/workflows/eval.yml` corre el job en push/PR; falla del eval bloquea merge.

---

## Fase 1 — Necesarias (se pierden deals sin esto)

> Tracks independientes entre sí: Multi-idioma · Social listening · Bulk CSV · Canva · Mobile (decisión).

### Multi-idioma 🔗 dep:B4

- [x] **F1-API-1** `[L]` Generación IA **nativa por locale** + RAG vectorial (pgvector + embeddings multi-provider + retrieval semántico) sobre glosario/style-guide por locale (canon §9.1). 🔗 dep:B4. **DoD:** generación produce contenido nativo por locale objetivo; test por locale.
- [x] **F1-CLI-1** `[L]` `next-intl` App Router: segmento `[locale]`, proxy (Next 16), ICU MessageFormat (canon §9.5). 🔗 dep:B4. **DoD:** UI client conmuta locale; `generateStaticParams` por locale; sin strings concatenados. _(Alcance ampliado: migración completa de ~2164 claves es/en + remediación React 19 de recharts/react-diff-viewer.)_
- [x] **F1-CLI-2** `[S]` Migrar catálogos de strings a ICU + revisar pluralización. 🔗 dep:F1-CLI-1. **DoD:** catálogos ICU-válidos; lint de i18n verde. _(type-safe messages vía `global.ts` AppConfig + `i18n:lint` script: ICU + paridad de claves/args es↔en; residuales capturados.)_

### Social listening (webhook-first)

- [x] **F1-WRK-1** `[M]` Worker de ingesta fan-in (webhook + polling backfill), normalización a schema canónico (canon §9.2). **DoD:** menciones aterrizan normalizadas; idempotente; fetch-before-process. → capability `searchMentions`/`fetchMentionById` en el port (X/Bluesky search + IG/FB webhook fetch), modelos `Mention`+`TrackedTerm`, `mentionIngestWorker`, coordinador `DispatchMentionSearchUseCase` (search + reconcile 48-72h).
- [x] **F1-API-1b** `[M]` Modelo de menciones + queries de Share of Voice sobre read model. 🔗 dep:F1-WRK-1. **DoD:** SoV calculado desde corpus normalizado; test. → read-side CQRS: `MentionQueryRepository` + `PrismaMentionQueryRepository` (SoV vía count/groupBy consistente, `sov = marca/mercado`), use cases `GetShareOfVoiceQuery` + `ListMentionsQuery`, rutas `GET /listening/share-of-voice` + `/listening/mentions` (multi-tenant por token).
- [x] **F1-CLI-3** `[M]` Dashboard de listening (menciones, sentimiento, SoV). 🔗 dep:F1-API-1b. **DoD:** dashboard renderiza datos reales; test componente. → `app/[locale]/dashboard/listening` (page + `ListeningDashboard` con selector de ventana + tarjetas SoV + charts recharts + feed), hooks `useShareOfVoice`/`useMentions` (acoplados a los DTOs del API vía proxy), i18n es/en, tests vitest+MSW (7) + smoke proxy (401). _Cierra el track de Social listening 3/3._

### Bulk / CSV scheduling (completar 🟡)

- [x] **F1-API-2** `[S]` Parser CSV + validación Zod por fila. **DoD:** CSV inválido reporta errores por fila; tests. → `parseSchedulingCsv` (`application/bulk-scheduling/schedulingCsv.ts`) con `csv-parse/sync` (canon server-side, no papaparse) + Zod por fila + VOs `Provider`/`ScheduledTime`; errores por fila (1-based, 0=header/parse); 13 tests. Lo consume F1-API-3.
- [ ] **F1-API-3** `[M]` FlowProducer parent+children con `continueParentOnFailure: true` + DLQ (canon §9.3). 🔗 dep:F1-API-2. **DoD:** una fila mala no aborta el batch; manifiesto por fila.
- [ ] **F1-CLI-4** `[M]` UI de carga CSV + reporte de resultado por fila. 🔗 dep:F1-API-3. **DoD:** usuario sube CSV y ve outcome por fila; test componente.

### Canva 🔗 dep:B3

- [ ] **F1-API-4** `[M]` Integración Canva Connect (OAuth backend, tokens cifrados, refresh rotation) reusando B3. 🔗 dep:B3. **DoD:** flujo OAuth completo server-side; test.
- [ ] **F1-CLI-5** `[M]` Embed de Canva en el composer. 🔗 dep:F1-API-4. **DoD:** usuario crea/edita visual sin salir; test componente.

### Mobile (solo decisión en esta fase)

- [ ] **F1-DEC-1** `[S]` Decisión + spike: Expo (RN universal) vs PWA (canon §9.5). **DoD:** ADR en `docs/technical/` con decisión y alcance; build no se compromete hasta cerrar Fase 1. _(Candidato a diferir post-Fase 1.)_

---

## Fase 2 — Bueno tenerla (objeciones de agencia)

> Tracks independientes: Reseñas · White-label · Recycling · Moderación · Colisión · Completar-parciales.

### Gestión de reseñas

- [ ] **F2-WRK-1** `[M]` Adaptadores Google Business Profile / Yelp / Trustpilot, polling rate-limit-aware, upsert idempotente `(source,externalReviewId)` (canon §9.2). **DoD:** reseñas se ingieren sin duplicar; evento `ReviewIngested`.
- [ ] **F2-API-1** `[S]` Modelo de reseñas + alertas low-star desde el evento. 🔗 dep:F2-WRK-1. **DoD:** alerta dispara por evento, no por poll; test.
- [ ] **F2-CLI-1** `[M]` Bandeja de reseñas + respuesta. 🔗 dep:F2-API-1. **DoD:** responder reseña desde UI; test componente.

### White-label de plataforma

- [ ] **F2-API-2** `[M]` Resolución tenant por hostname en middleware + branding por tenant (canon §9.5). **DoD:** request mapea a tenant por host; lookup cacheado; test.
- [ ] **F2-ADM-1** `[S]` Config de branding/dominio por tenant en admin. 🔗 dep:F2-API-2. **DoD:** admin define logo/colores/dominio; persistido.
- [ ] **F2-CLI-2** `[M]` Theming runtime por CSS custom properties. 🔗 dep:F2-API-2. **DoD:** un deploy sirve N marcas; sin build por tenant; test visual.

### Recycling / evergreen 🔗 dep:B2

- [ ] **F2-API-3** `[S]` Modelo de recurrencia + guard "tiempo mínimo de reciclaje". 🔗 dep:B2. **DoD:** entidad de rotación con cooldown; test.
- [ ] **F2-WRK-2** `[M]` Re-encolado en evento `completed` con slot recalculado (canon §9.3). 🔗 dep:F2-API-3. **DoD:** post evergreen rota sin repeatable estático; test.
- [ ] **F2-CLI-3** `[S]` UI de colas evergreen por categoría. 🔗 dep:F2-API-3. **DoD:** usuario gestiona cola; test componente.

### Reglas de moderación

- [ ] **F2-API-4** `[M]` Engine en cascada: reglas deterministas → LLM juez policy-as-prompt (canon §9.2). **DoD:** reglas configurables como datos; LLM solo en escalación; test.
- [ ] **F2-WRK-3** `[S]` Aplicar moderación en el sync de inbox. 🔗 dep:F2-API-4. **DoD:** mensaje moderado en ingesta; auditado.
- [ ] **F2-CLI-4** `[S]` UI de configuración de reglas. 🔗 dep:F2-API-4. **DoD:** admin/usuario edita reglas; test.

### Detección de colisión

- [ ] **F2-API-5** `[M]` Lease corto-TTL por conversación + chequeo de concurrencia optimista en el send (canon §9.2). **DoD:** segundo send con versión stale es rechazado; test.
- [ ] **F2-CLI-5** `[S]` Indicador de presence "Agente X respondiendo" (WebSocket). 🔗 dep:F2-API-5. **DoD:** UI muestra presence; test componente.

### Completar parciales

- [ ] **F2-API-6** `[S]` Completar benchmarking de competidores (set versionado por tenant). **DoD:** SoV histórico comparable; test.
- [ ] **F2-API-7** `[S]` Completar link-in-bio (página pública). **DoD:** página live con links; test.
- [ ] **F2-API-8** `[M]` Carruseles IA (generación multi-slide estilo consistente). 🔗 dep:F0-API-1. **DoD:** genera carrusel coherente; test.
- [ ] **F2-API-9** `[M]` MCP server stateless sobre el REST API (canon §9.5). 🔗 dep:B3. **DoD:** server MCP read-only sirve tools; `.well-known`; test.
- [ ] **F2-API-10** `[S]` Looker Studio Community Connector sobre semantic layer. 🔗 dep:B5. **DoD:** connector lee métricas gobernadas vía API; smoke test.
- [ ] **F2-API-11** `[S]` Custom report builder sobre semantic layer. 🔗 dep:B5. **DoD:** template de usuario compila vía semantic layer; test.

---

## Fase 3 — Interesantes (diferenciación, tras cerrar gaps)

> No iniciar mientras queden tareas Fase 1 abiertas (regla §8.5).

- [ ] **F3-API-1** `[M]` Triage IA full: completar sugerencias multi-tono (1 llamada, array tono-etiquetado) + self-correction (canon §9.1). 🔗 dep:F0-API-2. **DoD:** 3 tonos en una llamada; loop de auto-corrección; test.
- [ ] **F3-WRK-1** `[M]` Pipeline video IA real (text-to-video, job async + webhook, modelo con audio nativo; no Sora 2) (canon §9.1/§9.4). **DoD:** genera video vía job async; artefacto a object storage + signed URL.
- [ ] **F3-API-2** `[S]` Endpoints video IA. 🔗 dep:F3-WRK-1. **DoD:** integration test.
- [ ] **F3-CLI-1** `[M]` UI generación de video. 🔗 dep:F3-API-2. **DoD:** usuario genera/previsualiza; test componente.
- [ ] **F3-API-3** `[M]` Content discovery (feeds por tópico/keyword). **DoD:** feed de descubrimiento por nicho; test.
- [ ] **F3-WRK-2** `[S]` Worker de discovery (ingesta de fuentes). 🔗 dep:F3-API-3. **DoD:** fuentes ingieren; idempotente.
- [ ] **F3-CLI-2** `[S]` UI de content discovery + curación. 🔗 dep:F3-API-3. **DoD:** curar→distribuir; test componente.
- [ ] **F3-WRK-3** `[M]` RSS auto-posting (Job Scheduler + conditional GET ETag, dedupe GUID) (canon §9.3). 🔗 dep:B2. **DoD:** 304 = no-op; sin reposts; test.
- [ ] **F3-API-4** `[S]` Config de feeds RSS por cuenta. 🔗 dep:F3-WRK-3. **DoD:** alta/baja de feed; test.
- [ ] **F3-CLI-3** `[S]` UI gestión de feeds RSS. 🔗 dep:F3-API-4. **DoD:** test componente.
- [ ] **F3-API-5** `[S]` Image-to-caption (LLM multimodal, grounding de marca) (canon §9.1). 🔗 dep:F0-API-1. **DoD:** caption desde imagen + persona; test.
- [ ] **F3-API-6** `[S]` AI alt-text generation. 🔗 dep:F0-API-1. **DoD:** alt-text accesible auto; test.
- [ ] **F3-API-7** `[M]` Analytics de ads pagados (conectores Meta/Google al star schema; persistir ventana atribución) (canon §9.4). **DoD:** métricas paid junto a orgánico; test.
- [ ] **F3-API-8** `[S]` Audience targeting / sponsoring desde la herramienta. **DoD:** segmentación/boost básico; test.

---

## Nunca (salvo pivot de ICP)

`AI voiceover` · `meme generator` · `influencer marketing` · `blog→video` · `e-commerce product→post`. Bloat confirmado en §6 — sin tareas.

---

_Plan derivado de [FEATURE_TRACE_MATRIX_ES.md](FEATURE_TRACE_MATRIX_ES.md) (rastreo + canon mayo 2026). Estimaciones S/M son tamaño de iteración, no compromiso de fecha. Reverificar canon §9 antes de cada track (modelos/APIs cambian rápido). Actualizar el Dashboard de progreso al cerrar cada tarea._
