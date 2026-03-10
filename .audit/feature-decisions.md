# OmniPost — Feature Decisions

> Decisiones accionables por cada capability no implementada o parcialmente implementada.
> Fecha: 2026-03-08 | Alimenta el roadmap de producto.

---

## Classification Legend

| Clasificación  | Significado                                                   |
| -------------- | ------------------------------------------------------------- |
| **IMPLEMENT**  | Implementar — gap crítico, alto valor para usuarios           |
| **HOMOLOGATE** | Completar lo parcial — ya existe base, falta pulir            |
| **DECIDE**     | Requiere decisión de negocio antes de actuar                  |
| **DEFER**      | Diferir — bajo valor relativo o alta complejidad sin urgencia |
| **REMOVE**     | Eliminar código existente sin valor                           |

## Scope Legend

| Scope | Significado |
| ----- | ----------- |
| XS    | < 1 día     |
| S     | 1-3 días    |
| M     | 1-2 semanas |
| L     | 2-4 semanas |
| XL    | > 1 mes     |

---

## D1: Unified Composer

| #    | Capability              | Decision  | Scope | Rationale                                                                                          | Dependencies                    | Preguntas Abiertas        |
| ---- | ----------------------- | --------- | ----- | -------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------- |
| 1.6  | Link preview/unfurling  | IMPLEMENT | S     | Mejora UX del editor significativamente. Fetch OG tags server-side.                                | Backend endpoint para OG fetch  | ¿Cachear OG metadata?     |
| 1.8  | Emoji picker            | IMPLEMENT | XS    | Componente estándar, usar librería existente (emoji-mart o similar).                               | Ninguna                         | —                         |
| 1.9  | @mention autocomplete   | DEFER     | M     | Requiere Social Inbox (D4) primero — sin datos de usuarios/followers no hay qué autocompletar.     | D4 Social Inbox                 | —                         |
| 1.10 | Canva/Adobe integration | DEFER     | L     | Requiere partnership/API keys de terceros. Alto esfuerzo, valor marginal sin asset library madura. | D9 Asset Library, Canva API key | ¿Priorizar Canva o Adobe? |

---

## D2: Scheduling & Calendar

| #    | Capability                  | Decision    | Scope | Rationale                                                                                               | Dependencies                     | Preguntas Abiertas                |
| ---- | --------------------------- | ----------- | ----- | ------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------- |
| 2.4  | Bulk scheduling (completar) | HOMOLOGATE  | S     | Ya existe MultiPlatformScheduler. Falta UI batch upload (CSV/paste).                                    | —                                | ¿Formato CSV estándar?            |
| 2.5  | Timezone picker en UI       | HOMOLOGATE  | XS    | Timezone existe en modelo, falta selector en scheduler UI.                                              | —                                | —                                 |
| 2.7  | Recurring/evergreen posts   | IMPLEMENTED | M     | Cron-based templates with BullMQ repeatable jobs. Variable substitution, max occurrences, pause/resume. | Queue infrastructure (ya existe) | BullMQ repeatable jobs            |
| 2.9  | Holiday/event calendar      | DEFER       | S     | Nice-to-have. Overlay de holidays por país.                                                             | —                                | ¿Qué calendario de holidays usar? |
| 2.10 | Queue pause/resume          | HOMOLOGATE  | XS    | Queue manager existe. Agregar estado paused + UI toggle.                                                | —                                | —                                 |

---

## D3: Multi-Platform Publishing

| #    | Capability                | Decision    | Scope | Rationale                                                                                       | Dependencies              | Preguntas Abiertas          |
| ---- | ------------------------- | ----------- | ----- | ----------------------------------------------------------------------------------------------- | ------------------------- | --------------------------- |
| 3.6  | LinkedIn provider         | IMPLEMENTED | L     | Posts API (REST), OAuth 2.0, versioned headers, 2-step media upload, personal + org posts.      | LinkedIn API approval     | Posts API (REST, versioned) |
| 3.7  | Pinterest provider        | IMPLEMENTED | M     | API v5, OAuth 2.0, pins + board management, 100 calls/s/user.                                   | Pinterest API access      | —                           |
| 3.8  | Bluesky provider          | IMPLEMENT   | M     | Crecimiento rápido, API abierta (AT Protocol), baja barrera de entrada.                         | —                         | —                           |
| 3.9  | Snapchat provider         | IMPLEMENTED | L     | Public Profile API, OAuth 2.0 with PKCE, Stories/Spotlight, 20 req/s.                           | Snapchat Business API     | —                           |
| 3.10 | Telegram provider         | IMPLEMENTED | M     | Bot API, bot token auth, channels/groups, 4096 chars, 30 msg/s.                                 | —                         | —                           |
| 3.14 | Post-publish verification | HOMOLOGATE  | S     | Webhook processors existen. Agregar verificación activa (poll post status).                     | —                         | ¿Polling interval?          |
| 3.15 | First comment scheduling  | IMPLEMENTED | S     | Auto-post first comment 5s after publish. Supported: X, Instagram, Facebook, YouTube, LinkedIn. | Comments API por provider | —                           |

---

## D4: Social Inbox

| #    | Capability                 | Decision  | Scope | Rationale                                                                            | Dependencies                                              | Preguntas Abiertas                       |
| ---- | -------------------------- | --------- | ----- | ------------------------------------------------------------------------------------ | --------------------------------------------------------- | ---------------------------------------- |
| 4.1  | Unified inbox              | IMPLEMENT | XL    | **Gap #1 de la plataforma.** Consolidar mensajes/comentarios de todos los providers. | Prisma models (Message, Conversation), webhook processors | ¿MVP con solo comentarios o también DMs? |
| 4.2  | Comment management         | IMPLEMENT | L     | Parte del MVP de inbox. CRUD de comentarios.                                         | 4.1 Unified inbox, Comments API por provider              | —                                        |
| 4.3  | DM management              | DECIDE    | L     | Requiere permisos especiales de cada provider API.                                   | 4.1 Unified inbox, DM API access                          | ¿Instagram/Facebook DM API access?       |
| 4.4  | Mention monitoring         | IMPLEMENT | M     | Requiere webhook inbound (ya existe para 5 providers). Filtrar mentions.             | 4.1 Unified inbox                                         | —                                        |
| 4.5  | Reply from dashboard       | IMPLEMENT | M     | Core de inbox. Enviar replies via provider API.                                      | 4.1, 4.2                                                  | —                                        |
| 4.6  | Conversation threading     | IMPLEMENT | M     | Agrupar messages por conversation.                                                   | 4.1                                                       | —                                        |
| 4.7  | Sentiment tagging          | DEFER     | M     | Requiere NLP. Implementar después del MVP de inbox.                                  | 4.1, D5 Sentiment analysis                                | —                                        |
| 4.8  | Auto-response rules        | DEFER     | M     | Feature avanzada. Después del MVP.                                                   | 4.1, 4.5                                                  | —                                        |
| 4.9  | Assignment to team members | IMPLEMENT | S     | Necesario para teams. Asignar conversación a un admin user.                          | 4.1, D8 Team workflows                                    | —                                        |
| 4.10 | SLA tracking               | DEFER     | M     | Feature enterprise.                                                                  | 4.1, 4.9                                                  | —                                        |

---

## D5: Social Listening & Monitoring

| #   | Capability                  | Decision   | Scope | Rationale                                                                           | Dependencies                                                  | Preguntas Abiertas                        |
| --- | --------------------------- | ---------- | ----- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------- |
| 5.1 | Keyword monitoring          | DECIDE     | L     | Alto valor pero requiere APIs de search de cada provider o servicio externo.        | Provider search APIs o servicio externo (Brandwatch, Mention) | ¿Build vs buy?                            |
| 5.2 | Brand mention alerts        | IMPLEMENT  | M     | Basado en webhooks inbound existentes. Filtrar menciones y notificar.               | Notification system (D8.7), webhook processors                | —                                         |
| 5.3 | Sentiment analysis (NLP)    | DEFER      | L     | Requiere NLP pipeline (OpenAI o dedicated model). Diferir a post-MVP.               | AI providers (ya existen)                                     | ¿OpenAI para sentiment o modelo dedicado? |
| 5.4 | Competitor tracking         | DEFER      | XL    | Complejidad extrema. Requiere scraping o APIs especializadas.                       | —                                                             | —                                         |
| 5.5 | Trend analysis (completar)  | HOMOLOGATE | M     | Base existe. Conectar a fuentes de datos reales (Google Trends, provider APIs).     | External APIs                                                 | —                                         |
| 5.6 | Crisis detection automática | HOMOLOGATE | M     | Crisis mode manual existe. Agregar detección basada en spike de mentions negativas. | 5.2, 5.3                                                      | —                                         |
| 5.7 | Hashtag tracking            | IMPLEMENT  | S     | Tracking de rendimiento de hashtags usados. Analytics ya existen.                   | Analytics infrastructure                                      | —                                         |
| 5.8 | Influencer identification   | DEFER      | L     | Baja prioridad. Requiere datos de audiencia de providers.                           | —                                                             | —                                         |
| 5.9 | Share of voice reporting    | DEFER      | XL    | Requiere competitive data.                                                          | 5.1, 5.4                                                      | —                                         |

---

## D6: AI-Assisted Content Creation

| #    | Capability                   | Decision    | Scope | Rationale                                                                       | Dependencies                | Preguntas Abiertas                          |
| ---- | ---------------------------- | ----------- | ----- | ------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------- |
| 6.3  | AI image generation          | IMPLEMENTED | M     | DALL-E 3 via AIServicePort. Sizes: 1024x1024/1792/1024x1792. Stored in DB + S3. | OpenAI (ya integrado)       | DALL-E 3                                    |
| 6.4  | Prompt library (completar)   | HOMOLOGATE  | S     | Templates existen. Hacer editable/persistente en DB.                            | Prisma model para prompts   | —                                           |
| 6.5  | Brand voice training         | DECIDE      | L     | Requiere fine-tuning o system prompts per-account.                              | AI providers, Account model | ¿Fine-tuning vs system prompt con ejemplos? |
| 6.6  | Content repurposing          | IMPLEMENT   | M     | Blog→posts, long→short. Usar AI providers existentes.                           | AI providers (ya existen)   | —                                           |
| 6.7  | Caption generation for media | IMPLEMENT   | S     | Vision API de OpenAI/Gemini. Auto-caption de imágenes subidas.                  | AI providers con vision     | —                                           |
| 6.10 | Whiteboard/brainstorming     | DEFER       | L     | Feature de nicho. Baja prioridad.                                               | —                           | —                                           |

---

## D7: Analytics & Reporting

| #    | Capability                   | Decision  | Scope | Rationale                                                           | Dependencies                        | Preguntas Abiertas                       |
| ---- | ---------------------------- | --------- | ----- | ------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------- |
| 7.8  | 12-month historical tracking | IMPLEMENT | M     | Data retention policy + aggregation jobs.                           | DB storage strategy                 | ¿Aggregar datos antiguos o mantener raw? |
| 7.9  | GA4/UTM integration          | IMPLEMENT | M     | UTM builder + GA4 Measurement Protocol. Alto valor para marketers.  | TrackedLink model (ya existe)       | —                                        |
| 7.10 | Campaign tagging             | IMPLEMENT | M     | Nuevo modelo Campaign. Agrupar posts por campaña.                   | Prisma model Campaign               | —                                        |
| 7.11 | Scheduled reports            | IMPLEMENT | M     | BullMQ cron job + email/export. Infrastructure ya existe.           | Queue infrastructure, email service | ¿Email o descarga en dashboard?          |
| 7.12 | Custom dashboard builder     | DEFER     | L     | Alta complejidad UI. Dashboards estáticos son suficientes para MVP. | —                                   | —                                        |
| 7.13 | Benchmark data               | DEFER     | XL    | Requiere datos agregados de múltiples cuentas o fuentes externas.   | —                                   | —                                        |

---

## D8: Team Collaboration & Approval Workflows

| #    | Capability                  | Decision  | Scope | Rationale                                                                                             | Dependencies                              | Preguntas Abiertas              |
| ---- | --------------------------- | --------- | ----- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------- |
| 8.4  | Content approval workflow   | IMPLEMENT | M     | **Sprint 1 priority.** Ya tiene RBAC + audit log. Agregar states: DRAFT→IN_REVIEW→APPROVED→SCHEDULED. | Post model (agregar approvalStatus), RBAC | ¿Cuántos niveles de aprobación? |
| 8.5  | In-context comments         | IMPLEMENT | M     | Comments en content versions. UI de annotaciones.                                                     | ContentVersion model                      | —                               |
| 8.6  | Task assignment             | DECIDE    | M     | ¿Integrar con tool externo (Linear, Jira) o build interno?                                            | —                                         | ¿Build vs integrate?            |
| 8.7  | Notification system         | IMPLEMENT | M     | Necesario para inbox, approvals, mentions. WebSocket o SSE.                                           | —                                         | ¿WebSocket (Socket.io) o SSE?   |
| 8.8  | Activity feed               | IMPLEMENT | S     | Basado en audit log existente. Transformar a feed legible.                                            | AuditLog model (ya existe)                | —                               |
| 8.10 | Multi-level approval chains | DEFER     | M     | Feature enterprise. Primero implementar approval simple (8.4).                                        | 8.4                                       | —                               |

---

## D9: Asset Library & Brand Kit

| #   | Capability               | Decision   | Scope | Rationale                                                          | Dependencies                 | Preguntas Abiertas                        |
| --- | ------------------------ | ---------- | ----- | ------------------------------------------------------------------ | ---------------------------- | ----------------------------------------- |
| 9.2 | Folder/tag organization  | IMPLEMENT  | M     | Necesario para escalar la media library. Modelo Folder + Tag.      | Prisma models                | —                                         |
| 9.3 | Search (text + visual)   | IMPLEMENT  | M     | Full-text search en metadata. Visual search es DEFER.              | PostgreSQL FTS o Meilisearch | ¿PostgreSQL FTS o search service externo? |
| 9.4 | Brand colors/fonts/logos | IMPLEMENT  | S     | Modelo BrandKit per account. UI de configuración.                  | Prisma model BrandKit        | —                                         |
| 9.5 | Brand guidelines storage | HOMOLOGATE | S     | Extensión de BrandKit. Documento markdown/PDF storage.             | 9.4, S3 (ya existe)          | —                                         |
| 9.7 | Image editing            | DEFER      | L     | Alta complejidad UI. Usar integración con Canva/Figma en su lugar. | 1.10 Canva integration       | —                                         |
| 9.8 | Usage rights tracking    | DEFER      | M     | Feature de nicho.                                                  | —                            | —                                         |

---

## D10: Employee Advocacy

| #         | Capability      | Decision | Scope | Rationale                                                                                                                                    | Dependencies      | Preguntas Abiertas                  |
| --------- | --------------- | -------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------- |
| 10.1-10.5 | Todo el dominio | DECIDE   | XL    | **¿Es prioridad para nuestro target?** Si target es agencies/SMBs, este dominio es irrelevante. Si target incluye enterprise, es importante. | D8 Team workflows | ¿Quién es nuestro target principal? |

---

## D11: Social Advertising

| #                     | Capability             | Decision   | Scope | Rationale                                                      | Dependencies                              | Preguntas Abiertas                           |
| --------------------- | ---------------------- | ---------- | ----- | -------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------- |
| 11.1                  | Meta Ads Manager       | DECIDE     | XL    | Alto esfuerzo. Requiere Facebook Marketing API approval.       | Facebook provider (ya existe)             | ¿Es ad management parte de nuestro MVP?      |
| 11.2                  | TikTok Ads (completar) | HOMOLOGATE | L     | Placeholder existe. Conectar a real API.                       | TikTok Marketing API (placeholder existe) | —                                            |
| 11.5                  | Post boosting          | DECIDE     | M     | Menor scope que ad manager completo. "Boost this post" button. | Meta/TikTok ads API                       | ¿Empezar con boost antes de full ad manager? |
| 11.3, 11.4, 11.6-11.8 | Resto                  | DEFER      | XL    | Full ad management es scope enorme. Diferir post-launch.       | —                                         | —                                            |

---

## D12: Multi-Tenant Account Management

| #    | Capability                  | Decision   | Scope | Rationale                                                                           | Dependencies                     | Preguntas Abiertas                      |
| ---- | --------------------------- | ---------- | ----- | ----------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------- |
| 12.6 | SSO (SAML/OIDC)             | IMPLEMENT  | L     | Requisito enterprise. OIDC con Keycloak o Auth0.                                    | —                                | ¿Self-hosted (Keycloak) o SaaS (Auth0)? |
| 12.7 | White-label/custom branding | DEFER      | L     | Feature enterprise premium.                                                         | —                                | —                                       |
| 12.8 | Usage metering (completar)  | HOMOLOGATE | M     | Rate limiting existe. Agregar metering detallado (posts/month, API calls, storage). | Prisma model UsageMetric, BullMQ | —                                       |

---

## D13: Integrations & Extensibility

| #     | Capability                      | Decision    | Scope | Rationale                                                                                         | Dependencies                 | Preguntas Abiertas            |
| ----- | ------------------------------- | ----------- | ----- | ------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------- |
| 13.4  | Canva integration               | DECIDE      | M     | Depende de si Canva ofrece embed SDK gratis para SaaS.                                            | Canva Connect API            | ¿API cost?                    |
| 13.5  | Google Drive/Dropbox            | IMPLEMENT   | M     | Media import desde cloud storage. Google Drive API + Dropbox API.                                 | OAuth for Google/Dropbox     | ¿Solo import o bidireccional? |
| 13.6  | CRM integration                 | DEFER       | L     | Feature enterprise. Bajo valor para MVP.                                                          | —                            | —                             |
| 13.7  | Slack/Teams notifications       | IMPLEMENTED | S     | Webhook-based outbound notifications. Slack Block Kit + Teams Adaptive Cards. Retry with backoff. | Webhook system (ya existe)   | —                             |
| 13.8  | Zapier/Make connector           | DECIDE      | M     | Multiplica integraciones sin desarrollo. Requiere publicar connector.                             | Public API (ya existe)       | ¿Zapier o Make primero?       |
| 13.9  | SDK/client library              | IMPLEMENT   | M     | TypeScript SDK auto-generado desde OpenAPI spec.                                                  | 13.10 API docs               | —                             |
| 13.10 | API documentation (interactive) | IMPLEMENT   | M     | Swagger/Scalar UI. Pre-requisito para SDK y developer adoption.                                   | OpenAPI spec generation      | ¿Swagger UI o Scalar?         |
| 13.12 | Integration marketplace         | DEFER       | XL    | Feature de plataforma madura. Post-launch.                                                        | Muchas integraciones primero | —                             |

---

## Dead Weight — Candidatos a REMOVE

| Archivo/Módulo                                                  | Decision   | Rationale                                                        |
| --------------------------------------------------------------- | ---------- | ---------------------------------------------------------------- |
| `apps/api/src/application/ml/PredictAudienceResponseUseCase.ts` | REMOVE     | Heurística sin valor real. Sin frontend que la consuma.          |
| `apps/api/src/application/ml/PredictOptimalTimingUseCase.ts`    | DECIDE     | Podría tener valor si se alimenta con datos reales de analytics. |
| `apps/api/src/application/ml/OptimizeContentUseCase.ts`         | DECIDE     | Similar — podría conectarse a AI providers reales.               |
| `apps/api/src/analytics/performanceComparison/`                 | HOMOLOGATE | Tiene valor conceptual. Conectar a datos reales.                 |

---

## Resumen por Clasificación

| Clasificación   | Count | Capabilities                                                                                                                                                                                         |
| --------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IMPLEMENTED** | 7     | D2: 2.7 / D3: 3.6, 3.7, 3.9, 3.10, 3.15 / D6: 6.3 / D13: 13.7                                                                                                                                        |
| **IMPLEMENT**   | 21    | D1: 1.6, 1.8 / D3: 3.8 / D4: 4.1, 4.2, 4.4, 4.5, 4.6, 4.9 / D5: 5.2, 5.7 / D6: 6.6, 6.7 / D7: 7.8, 7.9, 7.10, 7.11 / D8: 8.4, 8.5, 8.7, 8.8 / D9: 9.2, 9.3, 9.4 / D12: 12.6 / D13: 13.5, 13.9, 13.10 |
| **HOMOLOGATE**  | 10    | D2: 2.4, 2.5, 2.10 / D3: 3.14 / D5: 5.5, 5.6 / D6: 6.4 / D9: 9.5 / D11: 11.2 / D12: 12.8                                                                                                             |
| **DECIDE**      | 10    | D4: 4.3 / D5: 5.1 / D6: 6.5 / D8: 8.6 / D10: 10.x / D11: 11.1, 11.5 / D13: 13.4, 13.8                                                                                                                |
| **DEFER**       | 17    | D1: 1.9, 1.10 / D2: 2.9 / D4: 4.7, 4.8, 4.10 / D5: 5.3, 5.4, 5.8, 5.9 / D6: 6.10 / D7: 7.12, 7.13 / D8: 8.10 / D9: 9.7, 9.8 / D11: 11.3-11.8 / D12: 12.7 / D13: 13.6, 13.12                          |
| **REMOVE**      | 1     | PredictAudienceResponseUseCase                                                                                                                                                                       |

---

## Top 10 IMPLEMENT por Prioridad

| Prioridad | Capability                         | Dominio | Scope | Justificación                                                              |
| --------- | ---------------------------------- | ------- | ----- | -------------------------------------------------------------------------- |
| 1         | Content approval workflow (8.4)    | D8      | M     | Highest ROI — ya tiene RBAC/audit como base, desbloquea team workflows     |
| 2         | Notification system (8.7)          | D8      | M     | Pre-requisito para inbox, approvals, mentions. Infraestructura transversal |
| 3         | Unified inbox MVP (4.1)            | D4      | XL    | Gap #1 de la plataforma. Inicia con comentarios de 9 providers             |
| 4         | Comment management (4.2)           | D4      | L     | Parte del inbox MVP                                                        |
| 5         | API documentation (13.10)          | D13     | M     | Desbloquea developer adoption, SDK generation                              |
| 6         | Campaign tagging (7.10)            | D7      | M     | Organiza analytics, alto valor para marketers                              |
| 7         | Bluesky provider (3.8)             | D3      | M     | API abierta, growing platform, baja barrera                                |
| 8         | Content repurposing (6.6)          | D6      | M     | Blog→posts, long→short. AI providers ya integrados                         |
| 9         | Caption generation for media (6.7) | D6      | S     | Vision API, auto-caption de imágenes subidas                               |
| 10        | SSO SAML/OIDC (12.6)               | D12     | L     | Requisito enterprise, desbloquea adopción corporativa                      |

> Items completed in Phase 4 and removed from this list: LinkedIn provider (3.6), AI image generation (6.3), Slack/Teams notifications (13.7).
