# OmniPost — D1: Endpoint ↔ UI Mapping (decisiones finales)

> **Living document.** Update in place.
> **Executed:** 2026-04-18 (initial) + **Revised 2026-04-18** post feature-intent deep analysis + product input de Edward.
> **Input:** `ENDPOINT_AUDIT.md` v2 classified inventory (post PRE-D1B).
> **Methodology:** `PLAN_MAESTRO.md §5.7 v3` (literal + template literal + BASE consts + count cross-check + spot-check tras block-check).
> **Output:** Sprint 2 actionable backlog + cleanup candidates + validated KEEP_AS_INTERNAL list + PLANNED roadmap expandido.

---

## 1. Resumen ejecutivo

### 1.1 Decisiones aplicadas (revisadas)

**Nota sobre conteos:** §1 de `ENDPOINT_AUDIT.md` aproxima ORPHAN a `~81`. El conteo real de filas ORPHAN en §2 (desglose por archivo) es **109** endpoints (algunos archivos tienen múltiples endpoints listados individualmente). D1 decidió sobre el conjunto completo.

**Revisión 2026-04-18:** tras análisis arquitectónico profundo feature-by-feature + input de Edward, 19 endpoints se movieron de DELETE a BUILD_UI/PLANNED. La lección de `content/` aplicó: si algo fue concebido y construido, hay razón.

| Decisión                                | N (D1 inicial) | N (D1 revisado) |   Δ |
| --------------------------------------- | -------------: | --------------: | --: |
| **BUILD_UI** (Sprint 2 backlog)         |             35 |          **42** |  +7 |
| **DELETE** (cleanup sprint)             |             24 |          **10** | -14 |
| **KEEP_AS_INTERNAL** (validados sin UI) |             37 |          **40** |  +3 |
| **RECLASSIFY_TO_PLANNED** (roadmap)     |              5 |          **12** |  +7 |
| **INVESTIGATE** (pendiente Edward)      |              3 |           **0** |  -3 |
| **Total**                               |            104 |         **104** |   — |

Tasa INVESTIGATE = 0% (todas resueltas).

### 1.2 Validaciones de categorías especiales (Fase 3)

| Categoría                                   | Endpoints | Validación                                                                                                      | Conclusión                                            |
| ------------------------------------------- | --------: | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| HEALTH (`health/healthRoutes.ts`)           |         5 | 5 routes registradas (L103/134/187/207/244)                                                                     | KEEP_AS_INTERNAL — load balancer + monitoring externo |
| WEBHOOK (`billing/billingWebhookRoutes.ts`) |         2 | Firma validada via `adapter.parseWebhookEvent({payload: rawBody, signature})` Stripe L182-189 + Paddle L231-238 | KEEP_AS_INTERNAL — signature validation OK            |
| INTERNAL saga (`saga/SagaIntegration.ts`)   |         7 | 7 hits `SYSTEM_CONFIGURE\|SYSTEM_MONITOR`                                                                       | KEEP_AS_INTERNAL — auth intacta desde PRE-3B          |
| PLANNED (`content/*`)                       |        18 | Clasificación sigue correcta en §2.40 + §3.5                                                                    | PLANNED — roadmap producto                            |

Ninguna categoría requiere re-acción.

### 1.3 PATH_MISMATCH nuevo detectado post-D1

Durante análisis arquitectónico (2026-04-18) se detectó un PATH_MISMATCH adicional no capturado en §4 original:

- **`/trends/radar`**: `apps/client/app/dashboard/ai/trends/page.tsx:43` llama `/api/backend/trends/radar?accountId=${accountId}`, backend NO registra esa ruta (solo `/trends/{analysis,viral,opportunities,predictions,report}`). Feature con UI construida + demanda de producto → resolver implementando backend, no eliminando UI.

Registrado en `ENDPOINT_AUDIT.md §4` (PATH_MISMATCH count: 8 → 9 con el nuevo).

---

## 2. BUILD_UI backlog — priorizado para Sprint 2

**Total: 42 endpoints** agrupados en 11 grupos funcionales.

### 2.1 Admin Monitoring & Ops Tooling (P1 — ops-critical)

| #   | Endpoints | Archivo backend                       | Notas                                                                                                    |
| --- | --------: | ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   |         6 | `monitoring/cacheStatsRoutes.ts`      | `/cache/stats*` + `/cache/invalidate` + `/cache/clear` — dashboard L1/L2/hot keys/memory                 |
| 2   |         5 | `monitoring/rateLimitingDashboard.ts` | `/admin/rate-limiting/*` — métricas distribuidas + alerts + emergency mode                               |
| 3   |         4 | `auth/apiKeyRoutes.ts`                | `/api-keys/*` — M2M auth admin panel                                                                     |
| 4   |         2 | `billing/subscriptionRoutes.ts`       | `/admin/billing/health` (SaaS metrics MRR/churn) + `/admin/billing/trials/expiring` (retention ops list) |
| 5   |         1 | `billing/subscriptionRoutes.ts`       | `/admin/billing/plans/:tier` (plan detail view)                                                          |

**Subtotal P1: 18 endpoints.**

### 2.2 Marketing Analytics (P1 — endorsado por producto 2026-04-18)

Edward: "me parece interesante saber de donde te consumen más, serviría para armar campañas de marketing".

| #   | Endpoints | Archivo backend                | Notas                                                                                                                                                                        |
| --- | --------: | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   |         3 | `analytics/analyticsRoutes.ts` | `/threads/compare` (A/B de contenido), `/engagement/geographic` (origen de audiencia), `/content/media-performance` (video vs imagen vs texto)                               |
| 7   |         2 | `analytics/analyticsRoutes.ts` | `/engagement/trends` (engagement over time) + `/posts/best-times` (scheduling optimization) — confirmado por producto 2026-04-18 "bueno para el negocio" (familia marketing) |

**Subtotal P1-marketing: 5 endpoints.**

### 2.3 Reporting & Config (P2 — feature value)

| #   | Endpoints | Archivo backend                        | Notas                                                            |
| --- | --------: | -------------------------------------- | ---------------------------------------------------------------- |
| 8   |         8 | `custom-reports/customReportRoutes.ts` | Report builder + scheduler + schema de métricas/dimensiones      |
| 9   |         4 | `links/linkRoutes.ts`                  | Tracked links CRUD + stats (`/r/:shortCode` es KEEP_AS_INTERNAL) |
| 10  |         3 | `brand-kit/brandKitRoutes.ts`          | Brand customization (colores/logos)                              |
| 11  |         3 | `projects/crisisRoutes.ts`             | Crisis mode toggle + badge                                       |

**Subtotal P2: 18 endpoints.**

### 2.4 Automation & Inbox (P3 — nice-to-have)

| #   | Endpoints | Archivo backend                       | Notas                                            |
| --- | --------: | ------------------------------------- | ------------------------------------------------ |
| 12  |         3 | `inbox/conversationNoteRoutes.ts`     | Notas inline en threads inbox                    |
| 13  |         3 | `first-comment/firstCommentRoutes.ts` | First comment automation                         |
| 14  |         1 | `audit/auditRoutes.ts`                | `/audit/my-logs` — personal audit logs dashboard |

**Subtotal P3: 7 endpoints.**

### 2.5 Totales por prioridad

| Prioridad          |                N endpoints | Grupos principales                                           |
| ------------------ | -------------------------: | ------------------------------------------------------------ |
| P0                 |                          0 | —                                                            |
| P1                 |                         23 | Admin monitoring, API keys, billing ops, marketing analytics |
| P2                 |                         18 | Custom reports, links, brand kit, crisis mode                |
| P3                 |                          7 | Inbox notes, first comment, audit my-logs                    |
| **TOTAL BUILD_UI** | **42 (+ 7 vs D1 inicial)** | —                                                            |

---

## 3. DELETE candidatos — cleanup sprint dedicado

**Total: 10 endpoints, ~260 LOC removible.** 4 archivos borrables completos.

**Reducción vs D1 inicial (-14):** 7 endpoints de analytics (rescatados: 3 BUILD_UI marketing + 2 PLANNED ThreadAnalytics core + 2 BUILD_UI pendiente confirmación), 5 trends (rescatados a PLANNED — feature con UI parcial + mismatch a resolver), 2 billing (rescatados a BUILD_UI — business value).

### 3.1 Experimental POCs nunca integrados

| Archivo                         | Endpoints | LOC | Rationale                                                                                      |
| ------------------------------- | --------: | --: | ---------------------------------------------------------------------------------------------- |
| `posts/optimizedPostsRoutes.ts` |         3 | ~80 | `/posts/optimized`, `/dashboard/stats`, `/cache/warm/:id` — EXPERIMENTAL_POC, cero integration |
| `audit/activityFeedRoutes.ts`   |         1 | ~20 | `/activity-feed` — TRIVIAL CRUD sin consumers                                                  |

### 3.2 Duplicates / legacy

| Archivo                              | Endpoints | LOC | Rationale                                                                                                |
| ------------------------------------ | --------: | --: | -------------------------------------------------------------------------------------------------------- |
| `accounts/accountRoutes.ts` (subset) |         2 | ~80 | PUT/DELETE `/accounts/:id` — duplicados de `/admin/accounts/:id` lifecycle (el segundo SÍ está CONSUMED) |
| `utm/utmRoutes.ts`                   |         2 | ~40 | Subsumido por `/links/:id`                                                                               |

### 3.3 Admin housekeeping low-value sin UI

| Archivo                         | Endpoints | LOC | Rationale                                                                               |
| ------------------------------- | --------: | --: | --------------------------------------------------------------------------------------- |
| `audit/auditRoutes.ts` (subset) |         2 | ~40 | POST `/audit/logs` (auto-generated), POST `/audit/cleanup` (low-freq, admin CLI-viable) |

**Archivos borrables completos:** `posts/optimizedPostsRoutes.ts`, `audit/activityFeedRoutes.ts`, `utm/utmRoutes.ts` + associated services.

---

## 4. KEEP_AS_INTERNAL — validados sin UI

**Total: 40 endpoints.** Justificación por categoría.

### 4.1 Integraciones externas

| Archivo                        | Endpoints | Justificación                             |
| ------------------------------ | --------: | ----------------------------------------- |
| `integrations/zapierRoutes.ts` |         9 | Zapier.com consume vía webhooks + polling |
| `integrations/makeRoutes.ts`   |         8 | Make.com idem                             |

### 4.2 OAuth / IdP server flows

| Archivo                         | Endpoints | Justificación                 |
| ------------------------------- | --------: | ----------------------------- |
| `auth/enhancedOAuthProvider.ts` |         2 | Browser redirects server-side |
| `auth/oidcRoutes.ts`            |         2 | OIDC server flow              |
| `auth/samlRoutes.ts`            |         3 | SAML server flow              |

### 4.3 Session / auth middleware

| Archivo              | Endpoints | Justificación                                                                        |
| -------------------- | --------: | ------------------------------------------------------------------------------------ |
| `auth/authRoutes.ts` |         4 | `/register`, `/me`, `/sessions`, `/revoke-all` — consumidos vía middleware internals |

### 4.4 Provider backend routing

| Archivo                       | Endpoints | Justificación                               |
| ----------------------------- | --------: | ------------------------------------------- |
| `providers/providerRoutes.ts` |         5 | Lógica backend de selección + health checks |

### 4.5 Billing backend internal

| Archivo                                  | Endpoints | Justificación                                                   |
| ---------------------------------------- | --------: | --------------------------------------------------------------- |
| `billing/subscriptionRoutes.ts` (subset) |         3 | `/validate-limits`, `/suspend` (bulk consumed), `/trials/stats` |

### 4.6 Public redirect

| Archivo                        | Endpoints | Justificación                                    |
| ------------------------------ | --------: | ------------------------------------------------ |
| `links/linkRoutes.ts` (subset) |         1 | `/r/:shortCode` — public redirect click tracking |

### 4.7 Infrastructure WebSocket

| Archivo                          | Endpoints | Justificación                                                                                  |
| -------------------------------- | --------: | ---------------------------------------------------------------------------------------------- |
| `analytics/realtimeAnalytics.ts` |         1 | `/ws/analytics` — WebSocket + Redis pub/sub + connection manager. Protocolo, no UI tradicional |

### 4.8 Compliance audit queries

| Archivo                         | Endpoints | Justificación                                                                                                                                 |
| ------------------------------- | --------: | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit/auditRoutes.ts` (subset) |         2 | `/audit/users/:userId/logs`, `/audit/resources/:resource/logs` — queries compliance por usuario/recurso, scope distinto a `/admin/audit/logs` |

**Total KEEP_AS_INTERNAL: 40.**

---

## 5. RECLASSIFY_TO_PLANNED — roadmap expandido

**Total: 12 endpoints.** Features arquitectónicamente completas sin cableado UI. Requieren spec de producto previo (pattern `content/`).

### 5.1 Features arquitectónicas maduras (CORE_CONCEPTUAL)

| Archivo                                      | Endpoints | Notas                                                                                                                                                              |
| -------------------------------------------- | --------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `approvals/approvalWorkflowRoutes.ts`        |         5 | Multi-level approval aggregate con UoW + domain events. **CORE_CONCEPTUAL** confirmado. Endorsado por producto 2026-04-18 "bueno para el negocio" — roadmap activo |
| `analytics/analyticsRoutes.ts` (core subset) |         2 | `/threads/:threadId/performance` + `/export` — parte de `ThreadAnalytics` CORE (batch optimization + caching + repository pattern + tests robustos)                |

### 5.2 Feature con UI parcial + backend incompleto

| Archivo                 | Endpoints | Notas                                                                                                                                                                                                                                                                                               |
| ----------------------- | --------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trends/trendRoutes.ts` |         5 | `/trends/{analysis,viral,opportunities,predictions,report}` — building blocks para completar feature. Cliente llama `/trends/radar` (mismatch registrado §4). **Decisión producto 2026-04-18:** implementar feature completa. Sprint de integración con spec de UI `/dashboard/ai/trends` existente |

**Total RECLASSIFY_TO_PLANNED: 12.**

---

## 6. INVESTIGATE — cerrado

Todas las preguntas INVESTIGATE resueltas en 2026-04-18:

| Endpoint                          | D1 inicial  | Resolución                                      |
| --------------------------------- | ----------- | ----------------------------------------------- |
| `/ws/analytics`                   | INVESTIGATE | KEEP_AS_INTERNAL (WS infra, no UI tradicional)  |
| `/audit/users/:userId/logs`       | INVESTIGATE | KEEP_AS_INTERNAL (compliance queries legítimas) |
| `/audit/resources/:resource/logs` | INVESTIGATE | KEEP_AS_INTERNAL (compliance queries legítimas) |

---

## 7. Cambios aplicados a `ENDPOINT_AUDIT.md`

D1 añadió referencia en §3 y, en la revisión 2026-04-18:

- `§1` — PATH_MISMATCH count: 8 → 9 (`/trends/radar` nuevo)
- `§3` — total ORPHAN actualizado (~81 → ajustado por reclasificaciones a PLANNED)
- `§3.5 PLANNED` — tabla expandida con ThreadAnalytics core (2) + trends (5) + approvals (5). Content/ (18) separado
- `§4 PATH_MISMATCH` — fila nueva `/trends/radar`

Inventario §2 sin cambios (las clasificaciones viven en este doc).

---

## 8. Hallazgos laterales durante D1

Actualizados en `LATERAL_FINDINGS.md`:

- useSettings doble prefix (bajo — cosmético, registrado 2026-04-18)
- `accounts/page.tsx:247` → `/admin/accounts/:id/settings` inexistente (medio — client-reverse-orphan)
- §5.7 v3 template literals (alto — resuelto, metodología)
- **Nuevo 2026-04-18:** `trends/page.tsx:43` → `/trends/radar` inexistente (alto — PATH_MISMATCH #9, decisión producto: implementar)
- **Nuevo 2026-04-18:** analytics dual arquitectura (`ThreadAnalytics` thread-centric vs `CustomReports` flexible builder) — scope no documentado

---

## 9. Próximos pasos

1. **Sprint 2 BUILD_UI (42 endpoints):**
   - P1 (23): admin monitoring + API keys + billing ops + marketing analytics
   - P2 (18): custom reports + links + brand kit + crisis
   - P3 (7): inbox notes + first comment + audit my-logs
2. **Implementación `/trends/radar` + integración UI trends existente:** mini-sprint dedicado (backend nuevo endpoint + reescritura de 5 building blocks trends existentes como RECLASSIFY_TO_PLANNED).
3. **Roadmap PLANNED (12 endpoints + 18 content/):**
   - Approval workflows multi-level (5): decisión producto Fase 1 vs Fase 2+
   - ThreadAnalytics core (2): integración con dashboard analytics existente
   - Trends (5): ver punto 2
   - Content/ (18): core conceptual, spec de producto en paralelo con D1-D7
4. **Cleanup sprint DELETE (10 endpoints, ~260 LOC):** trivial, priorizable en cualquier momento post-D2.
5. **D2 Standards Compliance:** puede arrancar independiente.

**Estado:** todos los endpoints BUILD_UI endorsed por producto 2026-04-18. Cero pendientes.

---

## 10. Métrica de calibración metodológica

Aplicado §5.7 v3 durante Fase 2 + análisis arquitectónico profundo (2026-04-18):

- Spot-checks ejecutados sobre block-checks "0 hits": confirmados ✓
- Re-evaluación feature-by-feature encontró 19 reclasificaciones (18% del total) — **señal de que la heurística inicial era demasiado agresiva hacia DELETE**
- Patrón `content/` aplicable: CORE_CONCEPTUAL tiene aggregates + UoW + domain events + tests robustos → no DELETE

**Lección incorporada:** D1 inicial clasificó 24 DELETE; re-evaluación redujo a 10 (-58%). Para futuras dimensiones (D2-D7), análisis arquitectónico profundo es obligatorio antes de DELETE — no solo greps de consumer.
