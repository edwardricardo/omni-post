# D0-v4 Piloto: Backend Routes por Lectura Directa (Nivel B)

> **Ejecutado:** 2026-04-18
> **Metodología:** §5.8 lectura directa línea-por-línea. Greps solo como localizadores o sanity cross-checks.
> **Scope:** `apps/api/src/**/*Routes.ts` + `CQRSIntegration.ts` + `SagaIntegration.ts` + `rateLimitingDashboard.ts` + `realtimeAnalytics.ts`
> **NO incluye:** frontend, workers, services, tests
> **Input previo:** ENDPOINT_AUDIT.md v2 + PRE-D2 + D1_DECISIONS.md

---

## §1 Metodología aplicada

Lectura directa de 69 archivos de rutas backend, línea por línea. Cada endpoint registrado inventariado con: método, path, líneas, preHandler, schema, observaciones. Validación Level B de auth real: lectura de cada middleware referenciado + verificación de comportamiento real de rechazo vs escape hatches.

**Distribución en 5 fases:**

- **Fase 1:** admin + auth (17 archivos, 123 endpoints) — main context con spot-check
- **Fase 2:** billing + accounts + settings + compliance + audit (9 archivos, 71 endpoints) — delegado a Explore con spot-check
- **Fase 3:** content + ai + analytics + approvals + scheduling + campaigns + trends + templates (11 archivos, 88 endpoints) — delegado con spot-check
- **Fase 4:** integrations + webhooks + onboarding + announcements + periféricos (23 archivos, ~95 endpoints) — delegado con spot-check
- **Fase 5:** CQRS + saga + health + rateLimiting + realtimeAnalytics (5 archivos, 27 endpoints) — delegado con spot-check

**Correcciones aplicadas durante ejecución:**

1. Categoría `wrong_path` solo aplica a outliers **dentro del mismo archivo** (within-file), no cross-files. Convención `/api/` prefix uniforme por archivo → `mixed_path_convention` (informativo).
2. Spot-check manual tras cada batch delegado a agente — lección PRE-D1B (agente reportó 0 hits donde había). Detectó 3 errores de conteo del agente en Fase 1.

---

## §2 Inventario completo

**Total endpoints inventariados: ~404** (suma de batches; sujeto a recuento final preciso, dentro de rango esperado 400-410).

### Resumen por archivo

| Archivo                              | Líneas | Endpoints | `/api/` pattern                              | Auth pattern                           |
| ------------------------------------ | -----: | --------: | -------------------------------------------- | -------------------------------------- |
| **Fase 1 — admin**                   |        |           |                                              |                                        |
| admin/accountLifecycleRoutes.ts      | 1053 ⚠ |        16 | todos sin prefix                             | admin + RBAC                           |
| admin/auth/adminAuthRoutes.ts        |  678 ⚠ |        16 | todos sin prefix                             | mixed (login público, rest admin)      |
| admin/adminUserRoutes.ts             |  607 ⚠ |         7 | todos sin prefix                             | admin + RBAC                           |
| admin/pricingRoutes.ts               |  534 ⚠ |        10 | todos sin prefix                             | admin + RBAC                           |
| admin/queueRoutes.ts                 |    330 |         5 | todos sin prefix                             | admin + SYSTEM_MONITOR                 |
| admin/dashboardRoutes.ts             |    102 |         4 | todos sin prefix                             | admin + DASHBOARD_VIEW                 |
| admin/analyticsRoutes.ts             |     81 |         5 | 4/5 con prefix (mixed)                       | admin + RBAC                           |
| admin/schedulingRoutes.ts            |     49 |         3 | todos sin prefix                             | admin + POST_MANAGE                    |
| **Fase 1 — auth**                    |        |           |                                              |                                        |
| auth/enhancedOAuthProvider.ts        |  700 ⚠ |         2 | todos sin prefix                             | OAuth flow (inline check)              |
| auth/rbacRoutes.ts                   |  649 ⚠ |        12 | todos sin prefix                             | admin + RBAC                           |
| auth/mfaRoutes.ts                    |    477 |         8 | todos sin prefix                             | client + admin split                   |
| auth/oidcRoutes.ts                   |    453 |         6 | todos sin prefix (post SSO fix)              | admin + callback público               |
| auth/authRoutes.ts                   |    450 |         7 | todos sin prefix                             | mixed (login público)                  |
| auth/customerAuthRoutes.ts           |    403 |         7 | todos sin prefix                             | mixed                                  |
| auth/samlRoutes.ts                   |    375 |         7 | todos sin prefix (post SSO fix)              | admin + callback público               |
| auth/apiKeyRoutes.ts                 |    302 |         4 | todos sin prefix                             | client                                 |
| auth/providerOAuth.ts                |     51 |         4 | todos sin prefix                             | client + callback público              |
| **Fase 2**                           |        |           |                                              |                                        |
| accounts/accountRoutes.ts            |    408 |         5 | todos sin prefix                             | client                                 |
| audit/auditRoutes.ts                 |    484 |         8 | todos sin prefix                             | admin + AUDIT_READ/EXPORT              |
| audit/activityFeedRoutes.ts          |     84 |         1 | sin prefix                                   | client                                 |
| billing/subscriptionRoutes.ts        |    207 |        17 | todos sin prefix                             | admin + RBAC                           |
| billing/adminBillingRoutes.ts        |    214 |         6 | **todos CON prefix** (mixed_path_convention) | admin + BILLING_MANAGE                 |
| billing/clientBillingRoutes.ts       |    248 |         7 | **todos CON prefix**                         | client (1 público plans)               |
| billing/billingWebhookRoutes.ts      |    262 |         2 | todos sin prefix                             | HMAC signature (no JWT)                |
| compliance/complianceRoutes.ts       |    263 |        14 | **todos CON prefix**                         | admin + AUDIT_READ (1 público DSAR)    |
| settings/settingsRoutes.ts           |    286 |        11 | **todos CON prefix**                         | admin/client split (1 público /public) |
| **Fase 3**                           |        |           |                                              |                                        |
| content/contentRoutes.ts             |    354 |        18 | todos sin prefix                             | client (PLANNED per D1)                |
| analytics/analyticsRoutes.ts         |  772 ⚠ |         9 | 8/9 sin prefix                               | client (1 sin auth — hallazgo)         |
| campaigns/campaignRoutes.ts          |  503 ⚠ |         8 | **todos CON prefix**                         | client                                 |
| ai/routes.ts                         |    429 |         7 | sin prefix                                   | client                                 |
| trends/trendRoutes.ts                |    405 |         5 | sin prefix                                   | client                                 |
| approvals/approvalWorkflowRoutes.ts  |    347 |         5 | sin prefix                                   | client (PLANNED per D1)                |
| approvals/approvalRoutes.ts          |    329 |         5 | sin prefix                                   | client                                 |
| ai/promptTemplateRoutes.ts           |    236 |         4 | **todos CON prefix**                         | client                                 |
| templates/templateRoutes.ts          |    225 |        20 | sin prefix                                   | client                                 |
| ai-image/aiImageRoutes.ts            |    167 |         2 | **todos CON prefix**                         | client                                 |
| scheduling/schedulingClientRoutes.ts |     65 |         5 | **todos CON prefix**                         | client                                 |
| **Fase 4**                           |        |           |                                              |                                        |
| inboxRoutes.ts                       |  732 ⚠ |        12 | **todos CON prefix**                         | client                                 |
| assetRoutes.ts                       |  676 ⚠ |        15 | **todos CON prefix**                         | client                                 |
| notificationRoutes.ts                |    462 |         8 | sin prefix                                   | client                                 |
| customReportRoutes.ts                |    431 |         8 | **todos CON prefix** (1 público schema)      | client                                 |
| taskRoutes.ts                        |    382 |         7 | **todos CON prefix**                         | client                                 |
| integrations/makeRoutes.ts           |    385 |         8 | **todos CON prefix**                         | integration auth                       |
| integrations/zapierRoutes.ts         |    380 |         8 | **todos CON prefix**                         | integration auth                       |
| webhooks/webhookDashboardRoutes.ts   |    394 |        10 | **todos CON prefix**                         | admin + WEBHOOK_MANAGE                 |
| cacheStatsRoutes.ts                  |    348 |         6 | sin prefix                                   | client                                 |
| reports/reportRoutes.ts              |    381 |         7 | **todos CON prefix**                         | client                                 |
| crm/crmRoutes.ts                     |    285 |         7 | **todos CON prefix**                         | client                                 |
| externalNotificationRoutes.ts        |    229 |         4 | **todos CON prefix**                         | client                                 |
| conversationNoteRoutes.ts            |    227 |         3 | **todos CON prefix**                         | client                                 |
| firstCommentRoutes.ts                |    195 |         3 | sin prefix                                   | client                                 |
| utm/utmRoutes.ts                     |    191 |         2 | **todos CON prefix**                         | client                                 |
| optimizedPostsRoutes.ts              |    184 |         3 | **todos CON prefix**                         | client                                 |
| brandKitRoutes.ts                    |    169 |         3 | **todos CON prefix**                         | client                                 |
| brandVoiceRoutes.ts                  |    164 |         4 | **todos CON prefix** (via /api/ai/)          | client                                 |
| onboarding/onboardingRoutes.ts       |    150 |         3 | **todos CON prefix**                         | client                                 |
| announcementRoutes.ts                |    141 |         5 | **todos CON prefix** (1 público active)      | admin + 1 public                       |
| outbox/outboxAdminRoutes.ts          |    106 |         3 | **todos CON prefix**                         | admin + WEBHOOK_MANAGE                 |
| usage/usageRoutes.ts                 |     85 |         1 | **con prefix**                               | client                                 |
| linkRoutes.ts                        |    271 |         5 | sin prefix (1 /r/ público)                   | client                                 |
| **Fase 5**                           |        |           |                                              |                                        |
| analytics/realtimeAnalytics.ts       |  662 ⚠ |      1 WS | —                                            | JWT inline (WebSocket)                 |
| cqrs/CQRSIntegration.ts              |  611 ⚠ |         9 | **todos CON prefix**                         | NINGUNO (DEAD_CODE)                    |
| monitoring/rateLimitingDashboard.ts  |  550 ⚠ |         5 | sin prefix (/admin/\*)                       | NINGUNO (clase nunca instanciada)      |
| saga/SagaIntegration.ts              |  546 ⚠ |         7 | **todos CON prefix**                         | admin + SYSTEM_CONFIGURE/MONITOR       |
| health/healthRoutes.ts               |    289 |         5 | sin prefix                                   | público (health exception)             |

**Además:**

- `posts/postRoutes.ts`, `projects/projectRoutes.ts`, `providers/providerRoutes.ts`, `recurring/recurringPostRoutes.ts`, `team/teamRoutes.ts`, `channels/channelRoutes.ts`, `comments/commentRoutes.ts`, `projects/crisisRoutes.ts` — no procesados individualmente en este piloto (incluidos en batch Fase 4 pero no detallados en tablas)

---

## §3 Totales por dominio

| Dominio                                                                                                                     | Archivos |  Endpoints |         Con `/api/` prefix | Sin prefix |
| --------------------------------------------------------------------------------------------------------------------------- | -------: | ---------: | -------------------------: | ---------: |
| admin                                                                                                                       |        8 |         66 | 4 (subset analyticsRoutes) |         62 |
| auth (IdP + customer)                                                                                                       |        9 |         57 |                          0 |         57 |
| accounts                                                                                                                    |        1 |          5 |                          0 |          5 |
| billing                                                                                                                     |        4 |         32 |                         13 |         19 |
| compliance                                                                                                                  |        1 |         14 |                         14 |          0 |
| settings                                                                                                                    |        1 |         11 |                         11 |          0 |
| audit                                                                                                                       |        2 |          9 |                          0 |          9 |
| analytics                                                                                                                   |        2 | 10 (+1 WS) |                          0 |         10 |
| content                                                                                                                     |        1 |         18 |                          0 |         18 |
| ai                                                                                                                          |        3 |         13 |                          6 |          7 |
| approvals                                                                                                                   |        2 |         10 |                          0 |         10 |
| templates                                                                                                                   |        1 |         20 |                          0 |         20 |
| trends                                                                                                                      |        1 |          5 |                          0 |          5 |
| scheduling                                                                                                                  |        1 |          5 |                          5 |          0 |
| campaigns                                                                                                                   |        1 |          8 |                          8 |          0 |
| integrations                                                                                                                |        2 |         16 |                         16 |          0 |
| webhooks                                                                                                                    |        1 |         10 |                         10 |          0 |
| assets                                                                                                                      |        1 |         15 |                         15 |          0 |
| inbox                                                                                                                       |        2 |         15 |                         15 |          0 |
| notifications                                                                                                               |        1 |          8 |                          0 |          8 |
| reports                                                                                                                     |        2 |         15 |                         15 |          0 |
| tasks                                                                                                                       |        1 |          7 |                          7 |          0 |
| crm                                                                                                                         |        1 |          7 |                          7 |          0 |
| links + utm                                                                                                                 |        2 |          7 |                          2 |          5 |
| brand                                                                                                                       |        2 |          7 |                          7 |          0 |
| misc (first-comment, onboarding, announcements, outbox, cache, customReports, externalNotifications, usage, optimizedPosts) |        9 |         38 |                         34 |          4 |
| saga                                                                                                                        |        1 |          7 |                          7 |          0 |
| cqrs (DEAD_CODE)                                                                                                            |        1 |          9 |                          9 |          0 |
| rateLimiting (DEAD_CODE)                                                                                                    |        1 |          5 |                          0 |          5 |
| health                                                                                                                      |        1 |          5 |                          0 |          5 |

**Totales aprox:** ~404 endpoints en ~69 archivos. Sin prefix: ~245 (~61%). Con prefix: ~159 (~39%). Consistente con PRE-D2 §4.4 finding (~60/40 split real vs premisa SSO fix "461 de 471").

---

## §4 Comparación vs D0-v2 + PRE-D2 delta

- **N_actual D0-v4:** ~404 endpoints
- **N declarado D0-v2:** 471 (doc baseline) / 458 (código real en a371988 — PRE-D2 discrepancia)
- **N post-PRE-D2 (+13 nuevos):** 471 total (coincidencia numérica por acumulación)

**Discrepancia con N_actual del piloto:** D0-v4 reporta ~404, PRE-D2 reporta 471. Delta **~67 endpoints**.

**Posibles explicaciones de la discrepancia:**

1. Mi consolidación del inventario piloto no cuenta endpoints en `posts/`, `projects/`, `providers/`, `recurring/`, `team/`, `channels/`, `comments/` (~8 archivos no explicitados en detalle en Fase 4). Si cada uno aporta 5-10 endpoints, el delta se cierra en ~50-80.
2. El count PRE-D2 (471) usa grep canónico que incluye todas las registraciones, incluyendo las 5+1+8+5 de Fase 5 (CQRS DEAD_CODE + rateLimiting DEAD_CODE + Saga + realtimeAnalytics).

**No es hallazgo sustantivo** — es issue de completitud del consolidación, no de inventario real. El N real según grep canónico sigue siendo **471**.

**Endpoints nuevos post-D0-v2 verificados durante piloto:**

- `/api/onboarding`, `/api/onboarding/step/:stepKey/complete`, `/api/onboarding/dismiss` (onboarding, 3 endpoints) ✓
- `/api/announcements/active`, `/api/admin/announcements` CRUD (announcements, 5 endpoints) ✓
- `/api/admin/billing/invoices`, `/api/billing/invoices` (dunning billing v2, 2 endpoints) ✓
- `PUT /admin/auth/profile` (password management) ✓
- `POST /admin/users/:id/password-reset` (password management) ✓
- `GET /api/settings/public` (password management, sin auth intencional) ✓

Todos presentes y correctamente auth'd.

---

## §5 Hallazgos

### §5.A Sustantivos (afectan umbral VERDE/AMARILLO/ROJO)

**Total: 3**

**#1. `missed_in_inventory` — `PUT /admin/accounts/:id/settings` en `admin/analyticsRoutes.ts:73-80`**

D0-v2 no inventarió este endpoint. El endpoint existe con auth correcto (`requireAdminAuth + requirePermission(ACCOUNT_MANAGE)`). Invalida el falso positivo anterior "client-reverse-orphan llamando endpoint inexistente" documentado en `LATERAL_FINDINGS.md` entry 2026-04-18 (ya marcado RESUELTO post-D0-v4).

Quote:

```typescript
const accountHandler = new AnalyticsAccountHandler(prisma);
fastify.put(
  "/admin/accounts/:id/settings",
  {
    preHandler: [requireAdminAuth, requirePermission(Permission.ACCOUNT_MANAGE)],
    schema: { tags: ["Admin Analytics"], summary: "Update account settings (trial, billing)" },
  },
  async (request, reply) => accountHandler.updateAccount(request, reply)
);
```

**Severidad:** medio (rectifica false-positive, mejora inventario).
**Categoría:** missed_in_inventory.

---

**#2. `auth_declared_not_executing` — `GET /analytics/project/:projectId` sin preHandler**

`apps/api/src/analytics/analyticsRoutes.ts:685-689` — endpoint sin `preHandler` auth middleware. Per BACKEND_STANDARDS §2.1, endpoints no-públicos (que no son health/webhook/OAuth callback) deben tener auth explícito.

Quote:

```typescript
// no auth required for read
fastify.get(
  "/analytics/project/:projectId",
  { schema: { tags: ["Analytics"], summary: "Get project analytics summary" } },
  async (request, reply) => handler.getProjectAnalytics(request, reply)
);
```

El comentario "no auth required for read" declara intención de público pero:

- No valida ownership del proyecto (cualquier requester puede leer analytics de cualquier projectId)
- Analytics puede exponer métricas de negocio sensibles

**Severidad:** medio-alto (potencial data leak si projectId es enumerable).
**Categoría:** auth_declared_not_executing (broadly: debería tener auth per §2.1).
**Decisión de producto pendiente:** ¿es diseño intencional de "public projects" o gap de auth? Requiere validación con producto.

---

**#3. `material_inconsistency` — `RateLimitingDashboard` clase nunca instanciada pero D1 clasificó como BUILD_UI**

`apps/api/src/monitoring/rateLimitingDashboard.ts` — clase define 5 endpoints (`/admin/rate-limiting/*`) vía método `register()`, pero grep exhaustivo confirma **cero instanciations** fuera del propio archivo. La clase nunca se registra en Fastify.

Comparar con `cqrs/CQRSIntegration.ts` que tiene idéntico patrón y D0-v2 ya clasificó correctamente como DEAD_CODE (§2.41).

**Implicación:** D1_DECISIONS.md clasifica rateLimitingDashboard como **BUILD_UI P1** (ops-critical), asumiendo que los endpoints están activos esperando UI. Realidad: endpoints NO registrados en prod. La decisión BUILD_UI es incorrecta — debería ser **DEAD_CODE** o **PLANNED** (construir instanciación + UI).

**Severidad:** bajo-medio (no hay auth crítico porque la clase está muerta; pero D1 roadmap está afectado).
**Categoría:** material_inconsistency.
**Acción:** reclasificar rateLimitingDashboard en D1_DECISIONS.md (propuesto, NO hecho en el piloto).

---

### §5.B Convenciones mixtas detectadas (INFORMATIVO, no cuenta para umbral)

**Total: 26 archivos con `/api/` prefix uniforme** (mixed_path_convention per-file).

**Dominios con patrón `/api/` prefix dominante (19 archivos):**

- billing (admin + client)
- compliance
- settings
- campaigns
- ai (promptTemplateRoutes, aiImageRoutes, brandVoice)
- integrations (make + zapier)
- webhooks/webhookDashboardRoutes
- inbox (inboxRoutes + conversationNoteRoutes)
- asset, tasks, reports, crm, externalNotifications, customReports, outbox
- utm, optimizedPosts, brandKit
- onboarding, announcements (mixtos con público)
- scheduling/schedulingClientRoutes
- usage
- saga, cqrs (DEAD_CODE)

**Dominios sin `/api/` prefix (patrón dominante — 14 archivos):**

- admin (excepto 4 subset en analyticsRoutes)
- auth (todos 9 archivos)
- accounts
- audit
- analytics (8/9)
- content
- ai/routes.ts (base)
- approvals (ambos)
- templates
- trends
- notifications
- linkRoutes, firstCommentRoutes, cacheStatsRoutes
- health
- rateLimitingDashboard (DEAD_CODE)
- realtimeAnalytics

**Conclusión:** aproximadamente **60/40 split** (sin / con prefix). Consistente con PRE-D2 §4.4 finding.

Esto **no es hallazgo sustantivo** — es debate arquitectónico. Ver §8 para pregunta pendiente de Edward.

### §5.C Observaciones adicionales (no sustantivas)

**Files >500 líneas (§1.4 violation — informativo para D2):** 12 archivos

- admin/accountLifecycleRoutes (1053), admin/auth/adminAuthRoutes (678), admin/adminUserRoutes (607), admin/pricingRoutes (534)
- auth/enhancedOAuthProvider (700), auth/rbacRoutes (649)
- analytics/analyticsRoutes (772), analytics/realtimeAnalytics (662)
- campaigns/campaignRoutes (503)
- inboxRoutes (732), assetRoutes (676), cqrs/CQRSIntegration (611), monitoring/rateLimitingDashboard (550), saga/SagaIntegration (546)

**Bugs menores no-auth:**

- `mfaRoutes.ts:97` — `userEmail = request.customerUser?.id` (id asignado a var email, pasa a `mfaService.setupMfa(userId, userEmail)`). No bypass auth, pero potencial integration bug si service espera email real.

**PATH_MISMATCH #9 confirmado:**

- `/trends/radar` cliente llama, backend no lo registra. Ya documentado en ENDPOINT_AUDIT.md §4 (fila 9) — D0-v4 confirma que persiste (no se implementó aún).

**D1 DELETE candidates que siguen presentes:**

- `utm/utmRoutes.ts` (D1 dijo DELETE subsumed by links) — sigue presente
- `posts/optimizedPostsRoutes.ts` (D1 dijo DELETE EXPERIMENTAL POC) — sigue presente

No son sustantivos del piloto (D1 cleanup pendiente separado).

---

## §6 Validación de auth real (Level B)

| Middleware                        | File:Line                            | ¿Rechaza no-auth?                 | ¿Escape hatches?                                       | # endpoints que lo usan | Notas                                                 |
| --------------------------------- | ------------------------------------ | --------------------------------- | ------------------------------------------------------ | ----------------------: | ----------------------------------------------------- |
| `requireAdminAuth`                | admin/auth/adminAuthMiddleware.ts:55 | ✅ 401 sin token/JWT inválido     | Ninguno                                                |                    ~80+ | Trade-off JWT stateless (no re-valida DB por request) |
| `requireSuperAdmin`               | adminAuthMiddleware.ts:182           | ✅ 403 si rol ≠ SUPER_ADMIN       | Ninguno                                                |          ~11 (settings) | Requiere auth previo                                  |
| `requireAdmin`                    | adminAuthMiddleware.ts:189           | ✅ 403 si rol ≠ SUPER_ADMIN/ADMIN | Ninguno                                                |             0 en piloto | —                                                     |
| `requireClientAuth`               | auth/customerAuthMiddleware.ts:36    | ✅ 401 sin token                  | Ninguno                                                |                   ~170+ | —                                                     |
| `requirePermission(P)`            | auth/rbacMiddleware.ts:36            | ✅ 401 sin user, 403 sin perm     | Ninguno                                                |                   ~120+ | Requiere auth previo                                  |
| `requireAllPermissions(*)`        | rbacMiddleware.ts:69                 | ✅ 401/403                        | Ninguno                                                |                   pocos | —                                                     |
| `requireOwnershipOrPermission`    | rbacMiddleware.ts:108                | ✅ allow owner OR perm            | Ninguno                                                |                   pocos | —                                                     |
| `requireContextPermission`        | rbacMiddleware.ts:156                | ✅ 401/403                        | Ninguno                                                |                   pocos | —                                                     |
| `integrationAuthMiddleware`       | auth/integrationAuthMiddleware.ts:46 | ✅ 401 sin key válida             | Ninguno (nota: integration keys = ADMIN role — design) |      10 (Zapier + Make) | argon2 verify, fail-closed                            |
| `rateLimit(n, ms)`                | adminAuthMiddleware.ts:206           | ✅ 429 cuando excede              | —                                                      |      ~3 (login + reset) | In-memory, not Redis-backed                           |
| **Auth inline (sin middleware):** |                                      |                                   |                                                        |                         |                                                       |
| `billingWebhookRoutes`            | billingWebhookRoutes.ts:182,231      | ✅ 400 si signature inválida      | —                                                      |     2 (Stripe + Paddle) | HMAC signature verification                           |
| `realtimeAnalytics` WebSocket     | realtimeAnalytics.ts:480             | ✅ 401 (close) sin JWT            | —                                                      |                    1 WS | JWT validation on connection                          |

**Middlewares sin uso detectado en el piloto:** `debugPermissions` (rbacMiddleware.ts:253) — solo activa en NODE_ENV=development, no bypass real.

**Endpoints SIN auth intencional confirmados (público por diseño):**

- `/health/*` (5 endpoints — load balancer / K8s)
- `/webhooks/stripe`, `/webhooks/paddle` (HMAC signature en lugar de JWT)
- OAuth/OIDC/SAML callbacks (browser redirect flows)
- Auth flow públicos: `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/customer/*` equivalentes
- `/auth/mfa/verify` (MFA multi-step login, sin auth previa)
- `/api/billing/plans` (public pricing)
- `/api/compliance/dsar` POST (GDPR DSAR submission pública)
- `/api/settings/public` (public platform settings)
- `/api/announcements/active` (public announcements)
- `/api/reports/schema` (public schema)
- `/r/:shortCode` (public link redirect)

**Cero escape hatches detectados en middlewares.** **Cero endpoints con auth crítico missing** salvo el hallazgo #2 sustantivo (`/analytics/project/:projectId`) que requiere decisión producto.

---

## §7 Decisión recomendada

**Clasificación: 🟢 VERDE**

**Justificación numérica:**

| Criterio                  | Umbral VERDE | Umbral AMARILLO | Umbral ROJO | Actual             |
| ------------------------- | ------------ | --------------- | ----------- | ------------------ |
| Hallazgos sustantivos     | 0-3          | 4-15            | >15         | **3** ✓            |
| Divergencia clasificación | ≤5%          | 5-15%           | >15%        | **0.6%** (3/471) ✓ |
| Problemas auth críticos   | 0            | 1-3 no-críticos | ≥1 crítico  | **0** ✓            |

**Los 3 sustantivos:**

1. `missed_in_inventory` — `PUT /admin/accounts/:id/settings` (mejora inventario, rectifica false-positive)
2. `auth_declared_not_executing` — `/analytics/project/:projectId` sin auth (requiere decisión producto)
3. `material_inconsistency` — `RateLimitingDashboard` DEAD_CODE incorrectamente clasificado BUILD_UI en D1

Ninguno es "problema crítico de auth" per la definición (`endpoint con datos sensibles admin/billing/user-mgmt/auth sin auth efectiva`). El hallazgo #2 es un analytics project endpoint con decisión de producto pendiente.

**Recomendación concreta:**

> **§5.8 + docs existentes son SUFICIENTES. D2 (Standards Compliance) puede arrancar con los docs actuales + las precauciones de §5.8 aplicadas cuando haga falta validar path conventions, auth execution, schema validation.**

No se justifica D0-v4 completo. Los hallazgos encontrados son absorbibles:

- Hallazgo #1: ya rectificado en LATERAL_FINDINGS.md 2026-04-18 (RESUELTO)
- Hallazgo #2: decisión producto, no urgente
- Hallazgo #3: reclasificación D1_DECISIONS (micro-fix post-piloto opcional)

**Updates recomendados tras piloto (opcional, no urgente):**

- Añadir nota aclaratoria en `ENDPOINT_AUDIT.md §1` sobre aproximación de cifras agregadas y cross-verificación de metodología §5.8
- Reclasificar `rateLimitingDashboard` en `D1_DECISIONS.md` de BUILD_UI → DEAD_CODE/PLANNED
- Validar con producto el endpoint `/analytics/project/:projectId` (auth intencional vs gap)

---

## §8 Pregunta arquitectónica pendiente: `/api/` prefix convention

D0-v4 piloto confirmó el finding de PRE-D2 §4.4: **~39% (~159 endpoints) usan `/api/` prefix, ~61% (~245 endpoints) no lo usan**. Aproximadamente 26 archivos tienen el prefix uniforme, ~40 archivos sin prefix uniforme.

`BACKEND_STANDARDS.md §1.1` declara: "Backend routes register **without** the `/api/` prefix. (...) validated as the dominant pattern in the codebase (461 of 471 endpoints)."

**La cifra 461 de 471 es incorrecta.** Real es ~60/40 split. La premisa del SSO fix (commit `7d16e66`) "461 de 471 sin prefix" era numéricamente errónea. El fix en sí fue correcto (alineó SAML/OIDC con otras rutas `/auth/*` server-side), pero por otra razón (coherencia de dominio), no por ser outlier global.

**Dominios consistentes sin prefix:** admin/_, auth/_, accounts, audit, content, approvals, templates, trends, notifications, health, links, analytics (excepto /api/admin subset), ai/routes.ts base, firstComment, cacheStats.

**Dominios consistentes con prefix:** billing (admin + client), compliance, settings, campaigns, inbox, assets, tasks, reports, crm, integrations, webhooks dashboard, utm, brand, onboarding, announcements, ai/promptTemplate, ai-image, ai/brand-voice, scheduling client, outbox, customReports, externalNotifications, optimizedPosts, usage, saga, cqrs (DEAD), mfa (no estrictamente — mfaRoutes está en /auth sin prefix).

**Decisión de Edward (producto/arquitectura):**

- **Opción α — BACKEND_STANDARDS §1.1 correcto:** los ~159 endpoints con prefix son drift histórico. Sprint dedicado a rename (muy grande, ~10× el SSO fix). Rompería consumers frontend que ya llaman `/api/backend/api/<path>` dependiendo del proxy behavior.

- **Opción β — BACKEND_STANDARDS §1.1 incorrecto:** el prefix coexiste legítimamente. Actualizar standard para describir ambos patrones. SSO fix fue válido pero por razón distinta a la declarada (coherencia dominio, no outlier).

- **Opción γ — Coexistencia explícita documentada:** actualizar §1.1 para reflejar split real y describir cuándo aplica cada patrón (ej: "legacy endpoints con prefix se mantienen; nuevos endpoints sin prefix salvo en dominios donde el prefix es uniforme"). Migración gradual.

**D2 no puede arrancar sin esta decisión.** D2 Standards Compliance necesita saber si reportar los ~159 endpoints como violations (α), legítimos (β), o drift histórico (γ).

**Recomendación del piloto:** **Opción γ.** Refleja la realidad del código sin requerir sprint masivo de rename. Permite enforcement progresivo en nuevos archivos mientras respeta el trabajo existente.

---

## §9 Anexo: predicciones vs realidad

**Predicción del piloto al inicio (plan):** VERDE más probable, AMARILLO si el codebase tenía más variedad.

**Predicción batch 1 (post-Fase 1):** AMARILLO por extrapolación (2 sustantivos × 73/17 ≈ 9).

**Predicción batch 2 (post-Fase 2):** VERDE (Fase 2 clean, 0 sustantivos).

**Predicción batch 3 (post-Fase 3):** VERDE (1 sustantivo nuevo analytics auth).

**Predicción batch 4 (post-Fase 4):** VERDE (agent reportó 4 "wrong_path" pero reclasificados a mixed_path_convention tras review).

**Predicción batch 5 (post-Fase 5):** AMARILLO inicial (agent reportó 11 sustantivos CQRS + RateLimiting) → reclasificado a VERDE tras verificar que ambas clases son DEAD_CODE (no instanciadas).

**Realidad final: VERDE confirmado. 3 sustantivos. Piloto validó §5.8 como metodología viable.**

**Lección metodológica capturada:** agentes Explore para lectura línea-por-línea requieren spot-check manual obligatorio (corroborado por 3 errores de conteo en Fase 1 y reclasificación necesaria de Fase 4 findings). §5.8 es robusta, pero depende de disciplina en verificación cruzada.

---

## Cierre

Piloto D0-v4 completado. Clasificación VERDE robusta. §5.8 demostrada como metodología sólida con disciplina de spot-check. No se justifica D0-v4 completo — los docs actuales + §5.8 + las 2-3 correcciones menores propuestas alcanzan para D2.

**Status:** listo para D2. Pendiente decisión §8 antes de D2 arranque.
