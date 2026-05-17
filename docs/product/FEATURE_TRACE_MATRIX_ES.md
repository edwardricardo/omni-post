# Matriz de rastreo de features en el código — OmniPost

> Cruce de las ~70 features del catálogo competitivo ([COMPETITIVE_ANALYSIS_ES.md §6](COMPETITIVE_ANALYSIS_ES.md)) contra el código y la documentación reales de OmniPost (`apps/`, `packages/`, `infra/prisma/schema.prisma`, `docs/`). Rastreo de mayo 2026 vía exploración paralela del repositorio.
>
> **Orden:** ascendente por necesidad — de ⬛ _Pérdida de tiempo_ (menos necesaria) hacia 🟥 _Obligatoria_ (más necesaria). Dentro de cada nivel, agrupado por categoría.
>
> **Estado de rastreo:**
>
> | Estado          | Significado                                        |
> | --------------- | -------------------------------------------------- |
> | ✅ IMPLEMENTADO | Código real funcional (use case + ruta + modelo)   |
> | 🟡 PARCIAL      | Modelo/infra/stub presente, no completo end-to-end |
> | 📐 CONTEMPLADO  | En docs de diseño/backlog/auditoría, no en código  |
> | 💬 MENCIÓN      | Nombre o comentario aislado, sin diseño ni código  |
> | ⛔ SIN RASTRO   | Nada en código ni docs de producto                 |
>
> **Nota de honestidad metodológica:** algunas features (voiceover, meme generator, blog→video, WordPress) solo aparecían como "evidencia" en el propio `COMPETITIVE_ANALYSIS_ES.md` que escribimos antes — esa es una referencia circular, **no** un rastro en el producto. Se marcan ⛔ SIN RASTRO con la salvedad indicada.

---

## ⬛ Nivel 1 — Pérdida de tiempo (necesidad mínima)

| Feature              | Categoría | Estado        | Evidencia / nota                                                                                                    |
| -------------------- | --------- | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| AI voiceover         | IA        | ⛔ SIN RASTRO | Solo en nuestro propio análisis competitivo (circular). Correcto: está clasificado como bloat, no debe construirse. |
| Meme generator       | IA        | ⛔ SIN RASTRO | Ídem. Coherente con la decisión de no invertir.                                                                     |
| Influencer marketing | Agencia   | ⛔ SIN RASTRO | Sin modelo ni ruta. Coherente: fuera de foco.                                                                       |

_Lectura: los tres ⬛ están correctamente ausentes del código. No hay deuda aquí — es alineación intencional._

---

## 🟦 Nivel 2 — Interesante (apuesta de diferenciación)

| Feature                                       | Categoría   | Estado          | Evidencia / nota                                                                                                                                                                 |
| --------------------------------------------- | ----------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contenido informado por analytics reales      | IA          | ✅ IMPLEMENTADO | `apps/api/src/application/ai/GetTopPerformersContextUseCase.ts:66`, `buildEnhancedSystemPrompt.ts` — inyecta top-performers en el prompt. **Diferenciador real, ya construido.** |
| IA multi-proveedor con routing                | IA          | ✅ IMPLEMENTADO | `apps/api/src/ai/orchestrator.ts:99`, `AIProviderFactory.ts:13` (OpenAI/Gemini/Perplexity/Anthropic + fallback).                                                                 |
| CRM integrado HubSpot/Salesforce              | Agencia     | ✅ IMPLEMENTADO | `infra/prisma/schema.prisma:2649,2669`, `apps/api/src/crm/crmRoutes.ts`.                                                                                                         |
| ROI reporting                                 | Analytics   | ✅ IMPLEMENTADO | `apps/api/src/analytics/roiCalculator.ts`, `docs/features/advanced-analytics.md:109`.                                                                                            |
| Funciones autónomas (repurpose/triage/trends) | IA          | 🟡 PARCIAL      | Colas definidas (`docs/technical/DEPENDENCIES.md:116`); `apps/api/src/repurpose/repurposeRoutes.ts` devuelve **501 NOT_IMPLEMENTED**. Andamiaje sin worker.                      |
| Generación de video IA                        | IA          | 🟡 PARCIAL      | `VideoProcessingJob` `schema.prisma:1279`, `videoProcessor.ts` — solo split/proceso de video, sin text-to-video.                                                                 |
| Triage/clasificación IA del mensaje           | Inbox       | 🟡 PARCIAL      | `apps/api/src/application/inbox/TriageInboxMessageUseCase.ts:1`, `schema.prisma:2134` (priority).                                                                                |
| Sugerencias de respuesta IA multi-tono        | Inbox       | 🟡 PARCIAL      | `schema.prisma:2135` (`suggestedReplies`), `TriageInboxMessageUseCase.ts:19`.                                                                                                    |
| Content discovery / curación                  | Agencia     | 🟡 PARCIAL      | `apps/api/src/trends/trendTypes.ts:4` — trend analysis con insights de descubrimiento.                                                                                           |
| RSS / blog auto-posting                       | Publicación | ⛔ SIN RASTRO   | Sin modelo de feed RSS ni auto-post.                                                                                                                                             |
| Image-to-caption                              | IA          | ⛔ SIN RASTRO   | Existe generación de imagen, no análisis imagen→caption.                                                                                                                         |
| Blog→video / blog→carousel                    | IA          | ⛔ SIN RASTRO   | Solo referencia circular en nuestro análisis.                                                                                                                                    |
| E-commerce product → post/video               | IA          | ⛔ SIN RASTRO   | Sin Shopify/WooCommerce ni feed de producto.                                                                                                                                     |
| Analytics de ads pagados                      | Analytics   | ⛔ SIN RASTRO   | Sin modelos/código de ad spend.                                                                                                                                                  |
| Audience targeting / sponsoring               | Publicación | 💬 MENCIÓN      | `schema.prisma:2230` (referencias a campaign), sin boosting/sponsoring.                                                                                                          |
| Employee advocacy                             | Agencia     | ⛔ SIN RASTRO   | Sin infra.                                                                                                                                                                       |

_Lectura: tus 4 apuestas más fuertes (contenido informado por analytics, IA multi-LLM, CRM, ROI) **ya están implementadas** — es tu narrativa de venta y es real. Las funciones autónomas (clave en el pitch de inversores) están solo en andamiaje (501) — gap entre la promesa y el código._

---

## 🟩 Nivel 3 — Bueno tenerla

| Feature                                | Categoría     | Estado          | Evidencia / nota                                                                                  |
| -------------------------------------- | ------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| Brand kit / asset library              | IA            | ✅ IMPLEMENTADO | `schema.prisma:2475` (`BrandKit`), `2753` (`MediaAsset`/`AssetFolder`/`AssetTag`).                |
| Análisis de sentimiento                | Inbox         | ✅ IMPLEMENTADO | `schema.prisma:2138` (`sentimentScore`), `aiService.test.ts:263`.                                 |
| Reportes personalizables / plantillas  | Analytics     | ✅ IMPLEMENTADO | `apps/api/src/custom-reports/customReportRoutes.ts`, `schema.prisma:2599` (`CustomReport`).       |
| Audit logs                             | Enterprise    | ✅ IMPLEMENTADO | `schema.prisma:200` (`AuditLog`), `apps/admin/app/(dashboard)/logs/page.tsx`.                     |
| Zapier / Make                          | Integraciones | ✅ IMPLEMENTADO | `apps/api/src/integrations/zapierRoutes.ts`, `makeRoutes.ts`.                                     |
| Benchmarking de competidores           | Analytics     | 🟡 PARCIAL      | `apps/api/src/analytics/crossPlatform/competitiveAnalyzer.ts:32`.                                 |
| Link-in-bio                            | Publicación   | 🟡 PARCIAL      | `schema.prisma:782,2245`, `CreateTrackedLinkUseCase.ts`.                                          |
| Carruseles IA                          | IA            | 🟡 PARCIAL      | `provider-capabilities.md` (capability "10 carousel"), sin servicio de generación.                |
| API pública / MCP                      | Integraciones | 🟡 PARCIAL      | `apps/api/src/auth/integrationAuthMiddleware.ts` (API keys); sin MCP.                             |
| AI alt-text                            | IA            | 💬 MENCIÓN      | `docs/features/platform-expansion.md` (alt text como metadata), sin implementación.               |
| Recycling / colas evergreen            | Publicación   | ⛔ SIN RASTRO   | Sin recurring posts ni cola evergreen.                                                            |
| Detección de colisión                  | Inbox         | ⛔ SIN RASTRO   | Sin reply-collision.                                                                              |
| Gestión de reseñas                     | Inbox         | ⛔ SIN RASTRO   | Solo `FirstComment` (`schema.prisma:2360`), no es review management. **Gap de venta confirmado.** |
| Reglas de moderación / automatización  | Inbox         | ⛔ SIN RASTRO   | Sin auto-moderación.                                                                              |
| White-label de plataforma              | Agencia       | ⛔ SIN RASTRO   | Solo white-label de reportes implícito; sin branding/dominio de plataforma.                       |
| Conector Looker Studio / API analytics | Analytics     | ⛔ SIN RASTRO   | Sin conector Looker.                                                                              |

---

## 🟨 Nivel 4 — Corriente (commodity de higiene)

| Feature                         | Categoría     | Estado          | Evidencia / nota                                                                                        |
| ------------------------------- | ------------- | --------------- | ------------------------------------------------------------------------------------------------------- |
| Mejor hora para publicar        | Publicación   | ✅ IMPLEMENTADO | `apps/api/src/admin/SchedulingSlotHandlers.ts:18`, `schema.prisma:1441` (`SchedulingRule`).             |
| Primer comentario programado    | Publicación   | ✅ IMPLEMENTADO | `schema.prisma:520`, `SetFirstCommentUseCase.ts`.                                                       |
| Post templates                  | Publicación   | ✅ IMPLEMENTADO | `schema.prisma:930` (`ContentTemplate`), `docs/features/templates.md`.                                  |
| Generación de imagen IA         | IA            | ✅ IMPLEMENTADO | `apps/api/src/ai-image/aiImageRoutes.ts:59`, `schema.prisma:2374` (`GeneratedImage`).                   |
| Scheduled email reports         | Analytics     | ✅ IMPLEMENTADO | `schema.prisma:2629` (`ReportSchedule`), `reportRoutes.ts:16`.                                          |
| Comentarios internos / notas    | Agencia       | ✅ IMPLEMENTADO | `schema.prisma:520` (`PostComment`), `2190` (`ConversationNote`).                                       |
| Notificaciones Slack/Teams      | Agencia       | ✅ IMPLEMENTADO | `schema.prisma:2337`, `externalNotificationRoutes.ts`.                                                  |
| Bitly / acortador + UTM         | Integraciones | ✅ IMPLEMENTADO | `schema.prisma:782` (`TrackedLink`), `GenerateUTMLinksUseCase.ts`.                                      |
| Hashtag / audience demographics | Analytics     | 🟡 PARCIAL      | `apps/api/src/analytics/crossPlatform/HashtagTimingAnalyzer.ts`.                                        |
| Hashtag manager/generator       | IA            | 📐 CONTEMPLADO  | `apps/api/src/trends/TrendReportBuilder.ts` (`generateHashtagRecommendations`), sin manager standalone. |
| Google Drive / Dropbox          | Integraciones | 🟡 PARCIAL      | `ImportFromGoogleDriveUseCase.ts` — solo Google Drive, sin Dropbox.                                     |

_Lectura: el commodity de higiene está casi todo cubierto ✅ — bien, su ausencia te eliminaría por checklist. Único faltante real: Dropbox (menor)._

---

## 🟧 Nivel 5 — Necesaria (objeción de venta si falta)

| Feature                            | Categoría     | Estado          | Evidencia / nota                                                                                                                                                           |
| ---------------------------------- | ------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview/mockup por canal           | Publicación   | ✅ IMPLEMENTADO | `apps/client/components/editor/PlatformPreview.tsx`, `TwitterPreview.tsx`, `FacebookPreview.tsx`.                                                                          |
| Brand Voice automático             | IA            | ✅ IMPLEMENTADO | `schema.prisma:2459` (`BrandVoice`), `ai/routes.ts:104` (`resolveBrandVoicePrompt`), `UpsertBrandVoiceUseCase.ts`.                                                         |
| Reportes exportables PDF/PPT       | Analytics     | ✅ IMPLEMENTADO | `schema.prisma:2416` (`ReportFormat`), `docs/features/analytics.md:100`.                                                                                                   |
| Inbox unificado                    | Inbox         | ✅ IMPLEMENTADO | `schema.prisma:2113` (`SocialMessage`/`SocialConversation`), `docs/features/social-inbox.md`.                                                                              |
| Asignación / tagging de mensajes   | Inbox         | ✅ IMPLEMENTADO | `schema.prisma:2132`, `AssignMessageUseCase.ts`.                                                                                                                           |
| RBAC / roles y permisos            | Enterprise    | ✅ IMPLEMENTADO | `schema.prisma:94,110,236`, `apps/admin/components/security/RbacManager.tsx`.                                                                                              |
| Onboarding sin compartir passwords | Agencia       | ✅ IMPLEMENTADO | `schema.prisma:3350` (cifrado de tokens OAuth), flujo connect del cliente.                                                                                                 |
| SSO SAML/OIDC                      | Enterprise    | ✅ IMPLEMENTADO | `schema.prisma:2539,2567`, `apps/api/src/auth/samlRoutes.ts`, `oidcRoutes.ts`.                                                                                             |
| Bulk / CSV scheduling              | Publicación   | 🟡 PARCIAL      | `apps/api/src/admin/schedulingSchemas.ts`, `schema.prisma:1034` — schema sí, flujo CSV incompleto.                                                                         |
| Generación multi-idioma            | IA            | 📐 CONTEMPLADO  | `docs/development/ADMIN_TO_CLIENT_MIGRATION_GUIDE.md`, auditoría T5-I (bloqueado por decisión de producto). Existe `locale` (es\|en) en Post, no en la capa de generación. |
| Social listening real              | Agencia       | 💬 MENCIÓN      | Diferido como baja prioridad en `docs/reports/audits/`. **Objeción #1 de venta — gap confirmado.**                                                                         |
| Mobile app                         | Agencia       | 💬 MENCIÓN      | `docs/client/editor.md:6` (React Native en roadmap); sin código de app.                                                                                                    |
| Canva / herramientas de diseño     | Integraciones | ⛔ SIN RASTRO   | Sin integración Canva (solo `<canvas>` HTML). **Gap esperable.**                                                                                                           |

_Lectura: la mayoría de lo Necesario está ✅. Los gaps que costarán deals: **social listening** (mención), **Canva** (sin rastro), **mobile app** (roadmap), **multi-idioma** (bloqueado por decisión — crítico para LATAM), **bulk CSV** (a medias)._

---

## 🟥 Nivel 6 — Obligatoria (deal-breaker si falta)

| Feature                            | Categoría   | Estado          | Evidencia / nota                                                                                                         |
| ---------------------------------- | ----------- | --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Scheduling ilimitado + calendario  | Publicación | ✅ IMPLEMENTADO | `schema.prisma:981,1427`, `SchedulingSlotHandlers.ts:40`.                                                                |
| Publicación nativa por red         | Publicación | ✅ IMPLEMENTADO | `apps/api/src/content/platformContentAdapterTypes.ts:16`, `schema.prisma:1010`, 12 adaptadores en `packages/providers/`. |
| IA de texto/caption                | IA          | ✅ IMPLEMENTADO | `apps/api/src/ai/routes.ts:132`, `useAIContentGenerator.ts`.                                                             |
| Analytics cross-platform           | Analytics   | ✅ IMPLEMENTADO | `apps/api/src/analytics/crossPlatform/index.ts`, `docs/features/advanced-analytics.md:41`.                               |
| Workflows de aprobación multinivel | Agencia     | ✅ IMPLEMENTADO | `schema.prisma:405,423,439,461`, `apps/api/src/approvals/approvalWorkflowRoutes.ts`.                                     |
| Dashboards / espacios por cliente  | Agencia     | ✅ IMPLEMENTADO | `schema.prisma:11,584,339` (multi-tenant nativo). **Tu ventaja arquitectural.**                                          |
| 2FA / seguridad de cuenta          | Enterprise  | ✅ IMPLEMENTADO | `schema.prisma:3131` (`require2FA`), `apps/api/tests/mfa.test.ts`, `MfaManager.tsx`.                                     |

_Lectura: **el 100% de lo Obligatorio está implementado.** La base es sólida — no hay deuda existencial. Comunicar como "lo damos por hecho", no como diferenciador._

---

## 7. Capacidades en el código que NO estaban en la lista de competidores

Durante el rastreo aparecieron features/infra **construidas en OmniPost que ningún competidor de la lista expone** — varias son diferenciadores no aprovechados en el material de marketing/inversores:

| Capacidad                                    | Evidencia                                                                                                  | Por qué importa                                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Control de versiones de contenido**        | `ContentVersion` `schema.prisma:1065`                                                                      | Historial/rollback de posts — ningún competidor lo tiene como tal.                                                           |
| **Versionado tipo Git de plantillas**        | `TemplateVersion:1779`, `TemplateCommit:1924`, `TemplateCollaboration:1946`, `TemplateComponent:1886`      | "Commits" y colaboración sobre plantillas — único en el mercado. Diferenciador fuerte para agencias.                         |
| **A/B testing nativo**                       | `ABTest` `schema.prisma:1815`, `TemplateUsageEvent`                                                        | Test A/B de contenido integrado — Predis lo insinúa, nadie lo tiene tan formal.                                              |
| **Instagram Stories como proyecto**          | `InstagramStoryProject:1175`, `InstagramStory:1226`                                                        | Flujo dedicado de Stories multi-slide.                                                                                       |
| **Procesamiento/segmentación de video**      | `VideoProcessingJob:1279`, `VideoSegment:1335`, `apps/api/src/video/videoProcessor.ts`                     | Pipeline de video propio (split, segmentos).                                                                                 |
| **Gestión de crisis**                        | `apps/api/src/application/crisis/EnterCrisisModeUseCase.ts`, `crisisRoutes.ts`, evento `CrisisModeEntered` | Modo crisis con workflow — feature enterprise que Sprout/Hootsuite cobran caro; aquí es nativo.                              |
| **Gestión de tareas**                        | `Task` `schema.prisma:491`                                                                                 | Task management integrado al flujo editorial.                                                                                |
| **Composer de hilos (X/Threads)**            | `Thread:868`, `Tweet:883`                                                                                  | Composición nativa de hilos.                                                                                                 |
| **Webhooks salientes + dead-letter**         | `WebhookSubscription:1528`, `WebhookEvent:1475`, `WebhookDeadLetter:1573`, `apps/api/src/webhooks/`        | Webhooks de plataforma con reintentos — infra de integración madura.                                                         |
| **Notificaciones in-app + preferencias**     | `Notification:360`, `NotificationPreference:381`                                                           | Centro de notificaciones propio.                                                                                             |
| **Doble pasarela de pago (Stripe + Paddle)** | `apps/api/src/infrastructure/billing/PaddlePaymentAdapter.ts`, `GatewayAdapterRegistry.ts`, `billing/`     | Conmutación de gateway por env — relevante para expansión LATAM (lo destaca el doc de inversores).                           |
| **Saga / Outbox / Inbox transaccional**      | `SagaInstance:2062`, `OutboxEvent:2029`                                                                    | Consistencia distribuida — no es feature de usuario pero es el argumento de "arquitectura que habilita velocidad" del pitch. |
| **Rotación de secretos auditada**            | `SecretRotationLog:223`                                                                                    | Seguridad operacional — argumento enterprise.                                                                                |

**Conclusión:** OmniPost tiene **al menos 5 diferenciadores construidos y no comunicados** — versionado tipo Git de plantillas, A/B testing nativo, modo crisis, control de versiones de contenido y task management integrado. El [INVESTOR_ES.md](INVESTOR_ES.md) no los menciona; deberían entrar en la narrativa porque son defendibles y ningún competidor de la lista los ofrece. Inversamente, los gaps confirmados (social listening, Canva, gestión de reseñas, multi-idioma bloqueado, funciones autónomas en 501) deben priorizarse en roadmap antes de comunicarlos como existentes.

---

## 8. Mapa por aplicación y orden de implementación

### 8.1 Convención de apps

| Código  | App            | Rol                                                                                                                                                   | Verificado en                                          |
| ------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **API** | `apps/api`     | Backbone Fastify — toda feature con lógica/datos pasa por aquí                                                                                        | siempre                                                |
| **CLI** | `apps/client`  | Superficie del usuario final (agencia/creador): composer, IA, inbox, analytics, reports                                                               | `app/{dashboard,reports}`                              |
| **ADM** | `apps/admin`   | Gobierno/operación: RBAC, audit, billing, webhooks, pricing, seguridad, slots                                                                         | `app/(dashboard)/{security,logs,billing,webhooks,...}` |
| **WRK** | `apps/workers` | Async BullMQ. Workers **activos hoy**: `publishWorker`, `analyticsIngestWorker`, `inboxSyncWorker`, `autoRenewalWorker`, `instagram/publishingWorker` | `apps/workers/src/`                                    |

> Hallazgo crítico de infra: solo existen **4 workers activos**. Las colas `DETECT_REPURPOSE / GENERATE_REPURPOSE / TRIAGE_INBOX / TREND_RADAR` están definidas pero **no tienen worker que las consuma** → confirma por qué las funciones autónomas devuelven 501.

### 8.2 Qué posee cada app hoy (features ✅/🟡)

- **API (backbone):** todas. Único-API: Zapier/Make, API pública, Looker (futuro), IA multi-LLM routing.
- **CLI:** composer + preview por canal, IA texto/imagen, Brand Voice, brand kit, templates, inbox, asignación, analytics cross-platform, reportes/custom reports, ROI, CRM, bitly/UTM, comentarios internos, onboarding connect, link-in-bio (🟡).
- **ADM:** RBAC, audit logs, MFA/2FA, scheduling slots (mejor-hora), billing admin, webhooks config, pricing, multi-tenant governance.
- **WRK:** publicación (scheduling + nativa por red + primer comentario), ingesta de analytics, sync de inbox (+ sentimiento), reportes programados, notificaciones Slack/Teams, auto-renovación billing.

### 8.3 Matriz feature → combinación de apps

| Feature                                                 | Nivel | Estado   | Combinación de apps                |
| ------------------------------------------------------- | ----- | -------- | ---------------------------------- |
| Scheduling + calendario                                 | 🟥    | ✅       | API + CLI + WRK                    |
| Publicación nativa por red                              | 🟥    | ✅       | API + WRK (+ `packages/providers`) |
| IA texto/caption                                        | 🟥    | ✅       | API + CLI                          |
| Analytics cross-platform                                | 🟥    | ✅       | API + WRK + CLI                    |
| Aprobación multinivel                                   | 🟥    | ✅       | API + CLI                          |
| Dashboards por cliente                                  | 🟥    | ✅       | API + CLI + ADM                    |
| 2FA / seguridad                                         | 🟥    | ✅       | API + ADM + CLI                    |
| Preview/mockup por canal                                | 🟧    | ✅       | CLI + API                          |
| Brand Voice automático                                  | 🟧    | ✅       | API + CLI                          |
| Reportes PDF/PPT                                        | 🟧    | ✅       | API + WRK + CLI                    |
| Inbox unificado                                         | 🟧    | ✅       | API + WRK + CLI                    |
| Asignación/tagging mensajes                             | 🟧    | ✅       | API + CLI                          |
| RBAC / roles                                            | 🟧    | ✅       | API + ADM                          |
| Onboarding sin passwords                                | 🟧    | ✅       | API + CLI                          |
| SSO SAML/OIDC                                           | 🟧    | ✅       | API + ADM + CLI                    |
| **Bulk/CSV scheduling**                                 | 🟧    | 🟡       | API + CLI + WRK                    |
| **Generación multi-idioma**                             | 🟧    | 📐       | API + CLI                          |
| **Social listening real**                               | 🟧    | 💬       | API + WRK + CLI                    |
| **Canva**                                               | 🟧    | ⛔       | CLI + API                          |
| **Mobile app**                                          | 🟧    | 💬       | (nueva app móvil) + API            |
| Mejor hora para publicar                                | 🟨    | ✅       | API + ADM + CLI                    |
| Primer comentario                                       | 🟨    | ✅       | API + WRK + CLI                    |
| Post templates                                          | 🟨    | ✅       | API + CLI                          |
| Generación imagen IA                                    | 🟨    | ✅       | API + CLI                          |
| Scheduled email reports                                 | 🟨    | ✅       | API + WRK                          |
| Comentarios internos/notas                              | 🟨    | ✅       | API + CLI                          |
| Notificaciones Slack/Teams                              | 🟨    | ✅       | API + WRK                          |
| Bitly / UTM                                             | 🟨    | ✅       | API + CLI                          |
| Hashtag/audience demographics                           | 🟨    | 🟡       | API + WRK + CLI                    |
| Hashtag manager                                         | 🟨    | 📐       | API + CLI                          |
| Google Drive / Dropbox                                  | 🟨    | 🟡       | CLI + API                          |
| Brand kit / asset library                               | 🟩    | ✅       | API + CLI                          |
| Análisis de sentimiento                                 | 🟩    | ✅       | API + WRK                          |
| Reportes personalizables                                | 🟩    | ✅       | API + CLI                          |
| Audit logs                                              | 🟩    | ✅       | API + ADM                          |
| Zapier / Make                                           | 🟩    | ✅       | API                                |
| Benchmarking competidores                               | 🟩    | 🟡       | API + WRK + CLI                    |
| Link-in-bio                                             | 🟩    | 🟡       | API + CLI                          |
| Carruseles IA                                           | 🟩    | 🟡       | API + CLI                          |
| API pública / MCP                                       | 🟩    | 🟡       | API                                |
| **Recycling / evergreen**                               | 🟩    | ⛔       | API + WRK + CLI                    |
| **Detección de colisión**                               | 🟩    | ⛔       | API + CLI                          |
| **Gestión de reseñas**                                  | 🟩    | ⛔       | API + WRK + CLI                    |
| **Reglas de moderación**                                | 🟩    | ⛔       | API + WRK + CLI                    |
| **White-label de plataforma**                           | 🟩    | ⛔       | API + ADM + CLI                    |
| **Looker Studio connector**                             | 🟩    | ⛔       | API                                |
| AI alt-text                                             | 🟩    | 💬       | API + CLI                          |
| Contenido informado por analytics                       | 🟦    | ✅       | API + CLI (← datos de WRK)         |
| IA multi-LLM routing                                    | 🟦    | ✅       | API                                |
| CRM HubSpot/Salesforce                                  | 🟦    | ✅       | API + CLI                          |
| ROI reporting                                           | 🟦    | ✅       | API + CLI                          |
| **Funciones autónomas**                                 | 🟦    | 🟡 (501) | **WRK + API + CLI**                |
| **Generación video IA (real)**                          | 🟦    | 🟡       | WRK + API + CLI                    |
| **Triage IA mensaje**                                   | 🟦    | 🟡       | API + WRK + CLI                    |
| **Sugerencias respuesta multi-tono**                    | 🟦    | 🟡       | API + CLI                          |
| **Content discovery**                                   | 🟦    | 🟡       | API + WRK + CLI                    |
| **RSS auto-posting**                                    | 🟦    | ⛔       | WRK + API + CLI                    |
| **Image-to-caption**                                    | 🟦    | ⛔       | API + CLI                          |
| **Analytics ads pagados**                               | 🟦    | ⛔       | WRK + API + CLI                    |
| Audience targeting/sponsoring                           | 🟦    | 💬       | API + CLI                          |
| Employee advocacy                                       | 🟦    | ⛔       | API + CLI                          |
| voiceover / meme / influencer / blog→video / e-commerce | ⬛    | ⛔       | — (no implementar)                 |

### 8.4 Orden de implementación recomendado

> Solo se secuencian los **gaps** (🟡/📐/💬/⛔). Lo ✅ no entra en roadmap. Dentro de cada feature, el orden de apps respeta dependencias: **datos primero (WRK/API) → superficie después (CLI/ADM)**.

#### Fase 0 — Cerrar la brecha pitch↔código _(urgente: se vende a inversores y devuelve 501)_

| #   | Feature                                           | Secuencia de apps                                                                                                                              | Por qué este orden                                                                                                                                                     |
| --- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | **Funciones autónomas** (repurpose/triage/trends) | **WRK** (crear los 4 workers para las colas ya definidas) → **API** (retirar `501` de `repurposeRoutes.ts`, exponer) → **CLI** (UI de control) | Riesgo de credibilidad: el [INVESTOR_ES.md](INVESTOR_ES.md) lo vende como diferenciador central y no existe. Las colas ya están declaradas — solo falta el consumidor. |

#### Fase 1 — Necesarias (pierden deals si faltan)

| #   | Feature                                | Secuencia de apps                                                                           | Dependencia / nota                                                                                  |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | **Generación multi-idioma**            | _Decisión de producto_ → **API** (i18n en capa IA) → **CLI** (UI i18n)                      | Bloqueada por decisión pendiente (auditoría T5-I). Crítico para el ICP LATAM — desbloquear primero. |
| 2   | **Social listening real**              | **WRK** (worker de ingesta de menciones) → **API** (modelo + queries) → **CLI** (dashboard) | Objeción de venta #1. Reutiliza patrón de `analyticsIngestWorker`.                                  |
| 3   | **Bulk/CSV scheduling** (completar 🟡) | **API** (parser CSV) → **CLI** (carga) → WRK (batch ya existe)                              | Andamiaje parcial; bajo esfuerzo, alto valor agencia.                                               |
| 4   | **Canva**                              | **API** (OAuth/proxy) → **CLI** (embed en composer)                                         | Sin rastro; integración acotada.                                                                    |
| 5   | **Mobile app**                         | proyecto aparte + **API** (ya expone REST)                                                  | Mayor esfuerzo. Decidir scope (PWA vs. nativa) antes de comprometer — candidato a diferir.          |

#### Fase 2 — Bueno tenerla (objeciones de agencia)

| #   | Feature                                                                                                           | Secuencia de apps                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 6   | **Gestión de reseñas**                                                                                            | **WRK** (sync reseñas, extender `inboxSyncWorker`) → **API** → **CLI** |
| 7   | **White-label de plataforma**                                                                                     | **API** (branding por tenant) → **ADM** (config) → **CLI** (theming)   |
| 8   | **Recycling / colas evergreen**                                                                                   | **API** (modelo de recurrencia) → **WRK** (re-encolado) → **CLI**      |
| 9   | **Reglas de moderación**                                                                                          | **API** (engine) → **WRK** (aplicar en sync de inbox) → **CLI**        |
| 10  | **Detección de colisión**                                                                                         | **API** (lock por conversación) → **CLI** (indicador en bandeja)       |
| 11  | Completar 🟡: benchmarking competidores, link-in-bio, carruseles IA, API/MCP, hashtag analytics, Looker connector | **API** → **CLI** (según cada una)                                     |

#### Fase 3 — Interesantes (diferenciación, tras cerrar gaps)

| #   | Feature                                                                                     | Secuencia de apps                                               |
| --- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 12  | Completar **triage IA + sugerencias multi-tono** (🟡→full)                                  | **API** → **WRK** (en sync inbox) → **CLI**                     |
| 13  | **Generación de video IA real** (text-to-video)                                             | **WRK** (pipeline, ya hay `videoProcessor`) → **API** → **CLI** |
| 14  | **Content discovery**                                                                       | **API** → **WRK** (feed) → **CLI**                              |
| 15  | **RSS auto-posting**                                                                        | **WRK** (poller) → **API** → **CLI**                            |
| 16  | image-to-caption, AI alt-text, audience targeting, analytics ads pagados, employee advocacy | **API** → **CLI** (+ WRK donde aplique)                         |

#### Nunca (salvo pivot de ICP)

`AI voiceover`, `meme generator`, `influencer marketing`, `blog→video`, `e-commerce product→post`. No asignar recursos — bloat confirmado en §6.

### 8.5 Resumen del roadmap

- **Esfuerzo concentrado en WRK:** 7 de los gaps prioritarios (autónomas, listening, reseñas, recycling, moderación, video IA, RSS) requieren **workers nuevos o extendidos** — el cuello de botella real está en `apps/workers`, no en el frontend.
- **CLI casi siempre va último** dentro de cada feature: la superficie de usuario depende de datos que produce WRK/API. Planificar sprints de backend-primero.
- **ADM solo aparece en 3 gaps** (white-label, y soporte de RBAC/audit ya hechos) — el panel admin está maduro; no es prioridad de roadmap.
- **Orden macro:** Fase 0 (credibilidad) → Fase 1 (no perder deals) → Fase 2 (ganar agencia) → Fase 3 (diferenciar). No saltar a Fase 3 con gaps de Fase 1 abiertos.

---

## 9. Canon de implementación moderno (2026) por feature

> Investigación web de mayo 2026: para cada feature, el enfoque canónico actual, la mejor práctica clave y el anti-patrón a evitar. Agrupado por **dominio de implementación** (features que comparten canon). Aplicar especialmente a los gaps del roadmap §8.4.

### 9.1 IA y generación de contenido

| Feature                                       | Canon 2026                                                                                                                                                                                            | Mejor práctica clave                                                                                                                  | Anti-patrón                                                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| IA multi-LLM routing                          | Gateway con interfaz OpenAI-compatible; routing **semántico** (modelo barato para intents simples, frontier para razonamiento), retries con backoff+jitter, cadenas de fallback cross-provider        | Testear el fallback en CI (simular timeout/quota) — el router solo vale si se prueba degradado                                        | Proveedor único hardcodeado sin fallback; confiar en supply-chain del gateway sin pinear versión (compromiso LiteLLM mar-2026) |
| Contenido informado por analytics (RAG)       | Retrieval híbrido (vector denso + BM25) sobre top-performers → **rerank a top-5** → inyectar como contexto grounded. "RAG vs fine-tune" está muerto: RAG para datos volátiles                         | Añadir reranker (cross-encoder/Cohere): mejor ratio calidad/coste (~10-20% NDCG)                                                      | Vector-only sin rerank; volcar raw top-50 al contexto                                                                          |
| Brand Voice automático                        | Persona específica + style guide + **few-shot exemplars** en system prompt; bloque estable primero para **prompt caching** (−90% coste). Guardrail de salida off-brand                                | Few-shot es el mecanismo _primario_ de estilo, no un fallback                                                                         | "Sé on-brand" vago sin exemplars                                                                                               |
| Funciones autónomas (repurpose/triage/trends) | Orquestación de grafo con estado (**LangGraph** estable) ReAct plan→act→reflect→recover; Orchestrator-Worker + Reflection; Tool Search Tool (−95% contexto) + Programmatic Tool Calling (−37% tokens) | Evals de **trayectoria completa** (elección de tool, args, coste, política) con mocks deterministas en CI; guardrails pre/post acción | Cargar todos los tools upfront; humano fuera del loop en acciones irreversibles                                                |
| Triage/clasificación + sentimiento            | LLM con **structured outputs** (JSON con grammar/constrained decoding) + few-shot por clase. 5-shot frontier ≈ BERT fine-tuned                                                                        | Few-shot + decoding restringido por schema para que intent/sentiment no driftee                                                       | Parsear texto libre y regexear la etiqueta; sin eval set de consistencia                                                       |
| Sugerencias de respuesta multi-tono           | **Una** llamada → array estructurado tono-etiquetado, grounded con hilo + brand voice (RAG); loop de auto-corrección antes de exponer                                                                 | Self-correction en la salida (revisar in-flight, no devolver fallos)                                                                  | N llamadas (una por tono); sugerencias sin paso humano en intents sensibles                                                    |
| Generación de imagen IA                       | Routing por caso detrás de una API: GPT Image 1.5 (texto-en-imagen ~95%), Imagen 4 Ultra/Flux 2 Max (fotorrealismo), modelo rápido para prototipo                                                     | "No hay mejor modelo" — rutear por tarea                                                                                              | Un modelo para todo trabajo de imagen                                                                                          |
| Generación de video IA                        | Routing entre Veo 3.1 (audio nativo, 4K), Kling 3.0, Seedance 2.0, Runway Gen-4.5; **pipeline async job + webhook** (genera en minutos). ⚠️ **Sora 2 se descontinúa** (API fin sep-2026)              | Modelos con audio nativo + job async, no acoplarse a Sora 2                                                                           | TTS/audio post separado cuando el modelo lo hace en un pase                                                                    |
| Hashtag/caption + image-to-caption            | LLM **multimodal** (imagen + persona + entidades del usuario) → caption + hashtags rankeados en una llamada estructurada                                                                              | Condicionar por personalidad de marca + entidades inyectables                                                                         | Captioning genérico solo-imagen sin grounding de marca                                                                         |
| Generación multi-idioma                       | Generación **nativa por locale** (no EN→traducir), routing por idioma; RAG sobre translation memory + glosario + style guide por locale; humano revisa el draft                                       | Grounding en TM/glosario aprobado para terminología consistente                                                                       | Pivot-traducir desde master EN sin glosario por locale                                                                         |

_Fuentes: [Anthropic advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use), [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [RAG Production 2026](https://lushbinary.com/blog/rag-retrieval-augmented-generation-production-guide/), [Agentic Patterns 2026](https://www.sitepoint.com/the-definitive-guide-to-agentic-design-patterns-in-2026/), [AI Video 2026](https://lushbinary.com/blog/ai-video-generation-sora-veo-kling-seedance-comparison/), [LLM translation 2026](https://lingvanex.com/blog/what-is-the-best-llm-for-translation-in-2026/)._

### 9.2 Datos sociales: listening, inbox, reseñas, moderación

| Feature                          | Canon 2026                                                                                                                                                                                                                          | Mejor práctica clave                                                                               | Anti-patrón                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Social listening                 | Pipeline fan-in: push (webhooks Meta/X stream) + polling para fuentes sin push → stream durable → enriquecimiento NLP/sentimiento → read model con ventanas. SoV = `mentions_marca / mentions_mercado` desde el corpus normalizado  | Desacoplar ingesta de enriquecimiento; normalizar a un schema canónico antes de sentimiento/SoV    | SoV desde queries por-plataforma inconsistentes; sentimiento LLM bloqueante en la ingesta |
| Inbox unificado (sync)           | **Webhook-first** (Meta Graph DMs/comments/mentions, X, LinkedIn) + polling de backfill; normalizar a modelo conversación/mensaje por external ID estable; inbox table antes del ack (at-least-once + dedupe). Respetar ventana 24h | **Webhooks son notificaciones, no datos**: fetch-before-process (releer estado del API al recibir) | Procesar síncrono dentro del handler del webhook (timeouts → retry storm)                 |
| Gestión de reseñas               | Adaptadores por fuente (Google Business Profile API, Yelp/Trustpilot oficiales), polling rate-limit-aware; upsert idempotente por `(source, externalReviewId)` + content hash; evento `ReviewIngested`                              | Upsert idempotente por clave natural compuesta; alertas low-star desde el evento, no el poll       | Scraping HTML de Google/Yelp; re-import completo cada poll                                |
| Detección de colisión            | Lease distribuido corto-TTL por conversación (Redis/DB con expiry) auto-renovado, broadcast por WebSocket presence + **chequeo de concurrencia optimista** (versión) en el send                                                     | Defensa en profundidad: presence (UX) + escritura condicional server-side (versión) en el send     | Solo "is typing" sin guard server-side; locks permanentes sin TTL                         |
| Reglas de moderación             | Pipeline en cascada: reglas deterministas rápidas (<50ms) para el grueso → LLM juez con **policy-as-prompt** solo sobre el slice que escala → humano en alta incertidumbre. Reglas configurables como datos                         | Routing por niveles (coste/latencia): clasificador barato primero, LLM solo en la escalación       | Una llamada LLM en _cada_ ítem como única capa                                            |
| Webhook vs polling / rate limits | Híbrido: webhooks para "ahora", polling para completitud/backfill. **Queue-first**: validar+encolar+200 inmediato, procesar async. Token-bucket por tenant/endpoint; en 429 backoff+jitter; job de reconciliación 24-72h            | Ingesta queue-first con ack rápido; reconciliar ventana reciente como red de seguridad             | Procesar síncrono en el webhook; backoff sin jitter (thundering herd)                     |
| Consumidores idempotentes        | No existe exactly-once: at-least-once + consumidor idempotente. **Patrón Inbox**: persistir por message-ID único (constraint DB) antes del ack; Outbox en la misma transacción; `SELECT FOR UPDATE SKIP LOCKED`                     | Dedupe por message-ID estable del proveedor con unique constraint dentro de la transacción         | Asumir exactly-once del broker y saltar el dedupe store                                   |

_Fuentes: [Meta IG Webhooks](https://developers.facebook.com/docs/instagram-platform/webhooks/), [Hookdeck webhooks at scale](https://hookdeck.com/blog/webhooks-at-scale), [Google Business Profile API](https://developers.google.com/my-business/content/review-data), [Policy-as-Prompt arXiv](https://arxiv.org/html/2502.18695v1), [event-driven.io Outbox/Inbox](https://event-driven.io/en/outbox_inbox_patterns_and_delivery_guarantees_explained/)._

### 9.3 Colas, scheduling y publicación (BullMQ + PostgreSQL)

| Feature                          | Canon 2026                                                                                                                                                                            | Mejor práctica clave                                                          | Anti-patrón                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Publicación programada confiable | Job **delayed** con `jobId` determinista (`publish:{postId}:{rev}`) + deduplication; handler **idempotente** contra el proveedor (persistir provider post ID, short-circuit en retry) | Handler idempotente independiente del dedup; dedup es defensa, no la garantía | Confiar en "exactly-once" de BullMQ con POST no idempotente         |
| Bulk/CSV scheduling              | Validar todo el CSV upfront (Zod por fila) → `addBulk()` o **FlowProducer** parent + children por fila, **`continueParentOnFailure: true`**; filas fallidas → DLQ                     | Aislamiento de job por fila + manifiesto de resultado por fila                | Un job gigante que itera el CSV (un fallo pierde todo)              |
| Recycling / evergreen            | Cola de rotación por categoría; al publicar **re-encolar a la cola** con próximo slot calculado (no repeatable estático); guard de "tiempo mínimo de reciclaje"                       | Re-encolar en el evento _completed_ con delay recalculado                     | Tratar recurrentes como un repeatable infinito                      |
| RSS auto-posting                 | Poll con **Job Scheduler**; enviar `If-None-Match`(ETag)/`If-Modified-Since`, tratar 304 como no-op; dedupe por GUID/`<id>` estable persistido                                        | Guardar ETag/Last-Modified tal cual se recibieron; conditional GET            | Re-fetch completo sin headers condicionales; dedupe solo por URL    |
| Scheduled email reports          | Job Scheduler (cron) fan-out por cuenta; render PDF vía **Chromium headless pooled**; job de entrega separado                                                                         | Desacoplar generación de entrega (jobs idempotentes separados) + browser pool | Lanzar Chromium nuevo por reporte en un mega-job                    |
| Scheduling timezone-correcto     | Guardar **zona IANA** (no offset); calcular próximo instante UTC en esa zona y encolar delayed job; recalcular cada ciclo (DST se auto-corrige)                                       | Persistir IANA tz + recomputar por ocurrencia                                 | Offsets UTC fijos o timestamps locales naive (drift en DST)         |
| Outbox → publicación             | Evento al outbox **en la misma transacción** que la mutación; **relay separado** (no en cada réplica API) con `SELECT FOR UPDATE SKIP LOCKED` → BullMQ → marcar processed             | Relay como un deployment independiente de baja réplica                        | Relay embebido en cada instancia API escalada (contención de locks) |

_Fuentes: [BullMQ deduplication](https://docs.bullmq.io/guide/jobs/deduplication), [BullMQ flows](https://docs.bullmq.io/guide/flows), [BullMQ job schedulers](https://docs.bullmq.io/guide/job-schedulers/repeat-strategies), [Transactional Outbox 2025](https://www.npiontko.pro/2025/05/19/outbox-pattern)._

### 9.4 Analytics, reporting y BI

| Feature                           | Canon 2026                                                                                                                                                                                                                                                 | Mejor práctica clave                                                                              | Anti-patrón                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Modelado analytics cross-platform | ELT → **star schema en OLAP columnar** (BigQuery/ClickHouse): `fact_post_metrics` grano diario por `tenant_id` + dims conformadas; **rollups pre-agregados** como vistas materializadas; aislamiento por `tenant_id` (shared-schema, no schema-per-tenant) | Rollups diarios como modelos incrementales first-class; partition/cluster por `(tenant_id, date)` | Agregaciones ad-hoc sobre el Postgres transaccional; schema-per-tenant para analytics |
| ROI reporting / atribución        | **GA4 Data API** por `sessionSource/Medium/Campaign` (links UTM) + cost import; **atribución data-driven**; reporte de atribución GA4 feb-2026 (no last-click)                                                                                             | Gobernanza UTM estricta + settings de atribución por conversión                                   | Last-click para social; confiar en conversiones self-reported del platform            |
| Benchmarking competidores         | Share of Voice derivado sobre rollups del set competitivo versionado; API pública + listening (menciones no-tagged/visuales)                                                                                                                               | Versionar el set competitivo por tenant como dimensión (SoV histórico comparable)                 | Solo followers/engagement públicos; lista global fija de competidores                 |
| Analytics de ads pagados          | Conectores ELT por fuente (Meta Insights, Google Ads → **Data Manager API** end-2026) al mismo star schema que orgánico; ⚠️ Meta deprecó ventanas 7/28-day view ene-2026                                                                                   | Persistir ventana de atribución + versión API con cada fila de métrica                            | Tratar Meta Insights como completo sin metadata; ventanas hardcodeadas                |
| Reportes programados PDF/PPT      | **Job async**: API encola → worker renderiza off-request → artefacto a **object storage** → **signed URL V4** TTL corto                                                                                                                                    | Signed URL corto; render desacoplado del request                                                  | PDF síncrono en el request; links de storage públicos/long-lived                      |
| Custom report builder             | Builder apunta a un **semantic layer gobernado** (métricas/dims curadas), no SQL crudo; el layer compila la query                                                                                                                                          | Todas las métricas definidas una vez en el semantic layer (single source of truth)                | Permitir SQL arbitrario (o IA generándolo) → métricas inconsistentes                  |
| Looker Studio / BI API            | **Community Connector** (Apps Script) sobre una **API BI externa versionada** que lee el semantic layer (headless BI)                                                                                                                                      | Connector devuelve métricas gobernadas vía contrato API estable, no DB directa                    | Apuntar el connector al warehouse/DB transaccional                                    |
| Hashtag tracking + demografía     | **Instagram Graph API v21** (hashtag string→ID, cap 30/7-días); demografía vía `/insights` (`audience_*`); guardar como time-series en el rollup                                                                                                           | Cachear resolución hashtag-ID y presupuestar la cuota 30/7d; pinear versión API                   | Métricas v21 deprecadas; re-resolver hashtag IDs cada poll (agota cuota)              |

_Fuentes: [Multi-tenant data modeling](https://www.flightcontrol.dev/blog/ultimate-guide-to-multi-tenant-saas-data-modeling), [GA4 atribución 2026](https://almcorp.com/blog/ga4-attribution-model-restructure-april-2026/), [Looker Studio Connector](https://developers.google.com/looker-studio/connector), [Instagram Graph API 2026](https://elfsight.com/blog/instagram-graph-api-complete-developer-guide-for-2026/)._

### 9.5 Plataforma e integraciones

| Feature                  | Canon 2026                                                                                                                                                                                  | Mejor práctica clave                                                                                             | Anti-patrón                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| API pública + MCP        | **MCP server sobre Streamable HTTP**, **stateless** y horizontalmente escalable; metadata `.well-known`; tools protegidos con **OAuth 2.1**; MCP como fachada fina sobre el REST API        | Diseñar stateless desde día 1; cada tool read-only primero, write tras observar uso real                         | Estado por-sesión en el proceso (pelea con el load balancer)                          |
| Canva                    | **OAuth 2.0 Auth Code + PKCE (S256)**, cliente confidencial; intercambio de token en backend; tokens cifrados at rest; validar `state` server-side                                          | Refresh tokens single-use con rotación (persistir el nuevo en cada refresh)                                      | Intercambio de token desde el browser; exponer `code_verifier`                        |
| Zapier / Make            | **REST Hook trigger** (subscribe/unsubscribe push), no polling; fallback de polling solo sin emisión de eventos                                                                             | REST Hooks (instantáneo, evita el cap de dedup de 100); gestionar subscripciones vía tu API                      | Polling para eventos time-sensitive (latencia 1-15 min, drops)                        |
| Connect sin passwords    | **OAuth 2.1 delegado con PKCE obligatorio**; sin grant implícito; redirect exact-match; **rotación de refresh token**; solo tokens scoped/revocables                                        | Aislamiento de token por tenant + rotación + scopes mínimos, cifrado                                             | Grant implícito; redirect wildcard; recolectar credenciales ("password anti-pattern") |
| Webhooks salientes       | Spec **Standard Webhooks**: headers `webhook-id/timestamp/signature`, HMAC-SHA256 firmando `msg_id.timestamp.payload`, prefijo `v1,`; tolerancia de timestamp (anti-replay)                 | Backoff exponencial + jitter multi-día; DLQ con payload completo; auto-disable de endpoint que falla persistente | HMAC ad-hoc sin anti-replay; reintentos solo inmediatos                               |
| White-label multi-tenant | **Edge middleware de Next.js resuelve el tenant por hostname**; dominios vía wildcard DNS + TLS automático; branding por **CSS custom properties** runtime, no builds por tenant            | Resolución hostname→tenant en middleware con lookup cacheado; theming por CSS vars                               | Forkear/rebuildear por tenant; lógica de tenant en páginas                            |
| i18n (incl. IA)          | **next-intl en App Router**: segmento `[locale]`, middleware de negociación, `localePrefix:'as-needed'`, `setRequestLocale()` + `generateStaticParams()`; mensajes en **ICU MessageFormat** | ICU skeletons para números/fechas locale-aware; `generateStaticParams` para todos los locales                    | Concatenar strings/pluralización manual; omitir `setRequestLocale`                    |
| Mobile app               | **Expo + React Native + Expo Router** (iOS/Android/web de un código), EAS + **OTA updates**; PWA como tier MVP/desktop. No es "PWA vs nativa", es Expo como plataforma convergente          | Expo con OTA para ciclos rápidos; PWA para bajo presupuesto/SEO                                                  | Tratar PWA vs nativa como binario; mantener código nativo + web separados             |
| Link-in-bio + UTM        | **Bitly API** (Connections Platform) para short links branded, UTM programático, scan-data; añadir UTM **antes** de acortar; taxonomía lowercase consistente                                | Taxonomía UTM centralizada lowercase aplicada programáticamente (GA es case-sensitive)                           | UTMs ad-hoc mixed-case; acortar antes de añadir parámetros                            |

_Fuentes: [MCP roadmap 2026](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/), [Canva Connect auth](https://www.canva.dev/docs/connect/authentication/), [OAuth 2.1](https://oauth.net/2.1/), [Standard Webhooks spec](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md), [Vercel multi-tenant](https://vercel.com/guides/nextjs-multi-tenant-application), [next-intl App Router](https://next-intl.dev/docs/getting-started/app-router), [Expo](https://docs.expo.dev/)._

### 9.6 Canon transversal y alineación con la arquitectura actual

**Canon transversal IA (aplica a toda feature con LLM):** structured outputs siempre que haya clasificación/extracción; prompt caching en prefijos estables; few-shot como mecanismo primario de estilo; guardrails pre/post con telemetría de tasa-de-fallo; evals de trayectoria con mocks deterministas en CI; routing semántico detrás de un gateway como arquitectura por defecto.

**Buena noticia — el canon NO contradice [CLAUDE.md](../../CLAUDE.md):** los dominios 9.2 y 9.3 mapean directo a primitivas que el repo ya tiene: relay Outbox con `SELECT FOR UPDATE SKIP LOCKED`, `dedupeKey` determinista (`cmd-${sagaId}-${stepId}`, nunca `randomUUID`), Unit of Work con dispatch transaccional, `BackgroundTaskScheduler` para polls/reconciliación, patrón Saga canon-aligned. **Los adaptadores sociales nuevos deben reutilizar inbox/outbox + UoW + scheduler, no crear caminos paralelos.**

**Upgrades concretos a adoptar (deuda técnica identificada):**

1. **BullMQ: migrar repeatable jobs → Job Schedulers (`upsert`)** — los repeatable jobs están deprecados desde BullMQ 5.16.0. Afecta scheduling recurrente y RSS poller.
2. **Añadir `continueParentOnFailure: true`** a los flows de bulk/CSV (gap §8.4 Fase 1 #3) para fallo parcial por fila.
3. **Funciones autónomas (Fase 0):** implementar con **LangGraph** (grafo con estado) + Tool Search Tool + evals de trayectoria — no como un simple consumidor BullMQ que llama a un LLM.
4. **Social listening / inbox (Fase 1-2):** **webhook-first + fetch-before-process**, no polling-only. Reusar el patrón de `analyticsIngestWorker`/`inboxSyncWorker` existentes.
5. **Reportes y video IA:** patrón **job async → object storage → signed URL corto**; nunca render síncrono en el request.
6. **Multi-idioma:** `next-intl` App Router + ICU; generación IA **nativa por locale** con RAG sobre glosario — la decisión de producto bloqueante (§8.4 #1) debe incluir esta arquitectura.
7. **Connect de cuentas / Canva / MCP:** sustrato común **OAuth 2.1 + PKCE**; webhooks salientes a **Standard Webhooks** (el repo ya tiene `WebhookSubscription/WebhookDeadLetter` — alinear el firmado al spec).

---

_Rastreo realizado sobre el árbol de código en HEAD (mayo 2026). Los números de línea de `schema.prisma` corresponden al estado actual; reverificar tras migraciones. La atribución por app se verificó contra `apps/workers/src/`, `apps/admin/app/(dashboard)/`, `apps/client/app/` y las rutas/use-cases citadas en §1-7. El canon de §9 proviene de investigación web de mayo 2026 (docs oficiales + artículos de mejores prácticas citados por dominio); reverificar antes de decisiones de arquitectura — el panorama de modelos/APIs cambia rápido._
