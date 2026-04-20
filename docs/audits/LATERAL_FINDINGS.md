# OmniPost — Hallazgos Laterales

> Registro de cosas encontradas durante auditorías que están fuera del scope de la dimensión que las descubrió. Edward revisa caso por caso al cerrar cada dimensión.

## Formato por entrada

### `<fecha>` — `<título corto>`

**Encontrado durante:** D`<n>`
**Descripción:** …
**Severidad estimada:** crítico / alto / medio / bajo
**Acción propuesta:** INCORPORAR / DIMENSIÓN PROPIA / BACKLOG / DESCARTAR (pendiente de decisión por Edward)

---

## Hallazgos conocidos previos (pre-D0)

### 2026-04-17 — RBAC sin documentación canónica

**Encontrado durante:** PRE-1
**Descripción:** La fuente de verdad del mapping rol→permisos es `infra/prisma/seed.ts` + runtime override en `rbacService.ts:110`. No existe doc canónico en `/docs`.
**Severidad estimada:** bajo
**Acción propuesta:** pendiente

### 2026-04-17 — SUPER_ADMIN bypass implícito del sistema de permisos

**Encontrado durante:** PRE-1
**Descripción:** En `apps/api/src/auth/rbacService.ts:110`, si `roleName === "SUPER_ADMIN"` devuelve `Object.values(Permission)`. Significa que cualquier Permission nuevo añadido a la enum es automáticamente concedido a SUPER_ADMIN sin revisión.
**Severidad estimada:** medio
**Acción propuesta:** verificación explícita en D5

### 2026-04-17 — Tres `useProviders` coexistentes

**Encontrado durante:** CLIENT_LIB_HOOKS_AUDIT
**Descripción:** Existen 3 implementaciones distintas del mismo hook con el mismo nombre en: `apps/client/lib/hooks/useProviders.ts`, `apps/client/lib/api/hooks.ts` (via re-export), y `apps/client/hooks/api/useChannels.ts:72-76`.
**Severidad estimada:** medio
**Acción propuesta:** pendiente

### 2026-04-17 — `useAutoSave.ts` usa `any`

**Encontrado durante:** CLIENT_LIB_HOOKS_AUDIT
**Descripción:** Línea 16, `onSave?: (success: boolean, error?: any) => void;`. Viola la regla zero-any de REACT_STANDARDS.md.
**Severidad estimada:** bajo
**Acción propuesta:** D2 lo capturará

### 2026-04-17 — Tres carpetas paralelas de hooks en apps/client

**Encontrado durante:** CLIENT_LIB_HOOKS_AUDIT
**Descripción:** Coexisten `apps/client/hooks/api/`, `apps/client/lib/hooks/`, y `apps/client/lib/api/`. La tercera no ha sido auditada todavía.
**Severidad estimada:** medio
**Acción propuesta:** pendiente

---

## Hallazgos durante D0

### 2026-04-17 — PLAN_MAESTRO.md §6 desactualizado

**Encontrado durante:** D0 (planning phase)
**Descripción:** La tabla de Estado del plan en `PLAN_MAESTRO.md` §6 marca PRE-1 y PRE-2 como "Pendiente" cuando en realidad: PRE-1 se ejecutó el 2026-04-17 (Estado A — funcional, reportado en chat); PRE-2 se ejecutó el 2026-04-17 pero quedó BLOQUEADO al descubrir que los 3 hooks "DEAD_CODE" tenían un consumer live en `TemplateManagementDashboard.tsx`. Correcciones documentadas en `CLIENT_LIB_HOOKS_AUDIT.md` §10 y `CLIENT_BACKLOG.md`.
**Severidad estimada:** bajo
**Acción propuesta:** ~~actualizar la tabla §6 de PLAN_MAESTRO.md tras el cierre de D0~~ → **RESUELTO 2026-04-17 (PRE-3B).** Tabla §6 expandida a 15 filas con PRE-1/2/3A marcados como ejecutados, PRE-3B en curso, PRE-3C pendiente, D0 ejecutado, D1-D7 pendientes. Añadida §5.7 nueva con regla metodológica de greps (`head_limit: 0` + count cross-check) para prevenir el falso negativo que llevó a PRE-2 a bloquearse.

### 2026-04-17 — `seed.ts` desincronizado de estado actual del DB (DASHBOARD_VIEW, POST_MANAGE)

**Encontrado durante:** D0 Phase 3
**Descripción:** El enum `Permission` en `rbacService.ts:20-57` define 17 permisos. El seed literal en `infra/prisma/seed.ts:340-388` solo asigna 15 a SUPER_ADMIN, 11 a ADMIN, 5 a SUPPORT. Los 2 permisos **`DASHBOARD_VIEW`** y **`POST_MANAGE`** no aparecen en los arrays literales del seed. Según `CODE_FIRST_AUDIT_FIXES_REPORT.md` §B1 (2026-04-10) fueron agregados al enum + insertados como `RolePermission` rows a SUPER_ADMIN, ADMIN, SUPPORT (6 rows). Si `prisma db seed` se re-ejecuta hoy, el `deleteMany` en `seed.ts:408` borra las filas existentes y re-inserta solo las del literal, perdiendo DASHBOARD_VIEW y POST_MANAGE para ADMIN y SUPPORT. Para SUPER_ADMIN sigue funcionando por el runtime override en `rbacService.ts:110`.
**Severidad estimada:** medio
**Acción propuesta:** ~~actualizar `seed.ts` para incluir los 2 permisos en los arrays de SUPER_ADMIN + ADMIN + SUPPORT~~ → **RESUELTO 2026-04-17 (PRE-3B).** Añadidos `"dashboard:view"` y `"post:manage"` a los 3 arrays de `infra/prisma/seed.ts:340-397`. Total 6 hits. Typecheck limpio. Tests RBAC unitarios (rbacService/rbacMiddleware) verdes.

### 2026-04-17 — SUPPORT tiene POST_MANAGE y DASHBOARD_VIEW por precedente, no por diseño explícito

**Encontrado durante:** PRE-3B
**Descripción:** El fix del seed aplicó `POST_MANAGE` y `DASHBOARD_VIEW` a los 3 roles (SUPER_ADMIN, ADMIN, SUPPORT) replicando el precedente de `CODE_FIRST_FIXES 2026-04-10`. Sin embargo, SUPPORT está descrito en el seed como "Limited access for customer support operations". No existe documento que justifique por qué customer support debe poder gestionar posts. Puede ser correcto o puede ser un error arrastrado de un sprint previo.
**Severidad estimada:** medio
**Acción propuesta:** D5 audita explícitamente si este mapping respeta least privilege. Decisión de producto pendiente.

### 2026-04-17 — `tests/rbac.test.ts` fuera del include de vitest

**Encontrado durante:** PRE-3B
**Descripción:** El archivo vive en `apps/api/tests/rbac.test.ts`, no en `apps/api/tests/unit/`. No es capturado por `pnpm vitest run tests/unit/*`. Probablemente corre vía `node:test` integration (CLAUDE.md menciona `test:all` ejecuta ambos). Implicación: un desarrollador corriendo `pnpm test` puede estar creyendo que ejecuta todos los tests cuando en realidad se salta éste.
**Severidad estimada:** medio
**Acción propuesta:** D7 captura formalmente — revisar includes de vitest en toda la config del monorepo y unificar si aplica.

### 2026-04-17 — `PLAN_MAESTRO.md` estaba untracked en git hasta PRE-3B

**Encontrado durante:** PRE-3B
**Descripción:** El documento que dirige el Plan Maestro no estaba versionado en git. Primer commit del archivo ocurrió durante PRE-3B. Sugiere que puede haber otros "living documents" sin trackear. Ya resuelto para PLAN_MAESTRO.md, pero el patrón (crear docs de auditoría sin trackearlos inmediatamente) es digno de nota.
**Severidad estimada:** bajo
**Acción propuesta:** D6 verifica que todo documento referenciado en `docs/audits/` está versionado. Housekeeping menor.

### 2026-04-17 — SAML/OIDC client path mismatch (8 endpoints potencialmente rotos)

**Encontrado durante:** PRE-3C §10.5
**Descripción:** `apps/client/hooks/api/useSso.ts` llama `/api/backend/saml/config`, `/api/backend/saml/enable`, `/api/backend/oidc/config`, etc. El proxy Next.js `app/api/backend/[...path]/route.ts` strippea `/api/backend/` y forwardea a Fastify. Resultado: Fastify recibe `/saml/config`, pero las rutas están registradas como `/api/saml/config` (con `/api/` prefix). Mismatch → 404. Afecta 8 endpoints SAML/OIDC — los 4 `/api/saml/*` + los 4 `/api/oidc/*`. No se manifestó antes porque SSO no tiene UI real consumida por usuarios todavía (la feature está stub o en desarrollo). Consumers existen, hits HTTP 404 silenciosamente. Patrón similar al de `/dashboard/templates` documentado en ENDPOINT_AUDIT.md §5.1 (live-reverse-orphans).
**Severidad estimada:** medio — la feature SSO falla silenciosamente cuando un admin intenta configurarla
**Acción propuesta:** 3 opciones en ENDPOINT_AUDIT.md §10.5. Decisión de producto: (a) fix client URLs con `/api/backend/api/saml/*`, (b) cambiar backend a `/saml/*` sin prefix, o (c) tratamiento especial en el proxy. Sprint dedicado.

### 2026-04-17 — `GET /admin/billing/trials/stats` huérfano adicional no listado en §6 P1

**Encontrado durante:** PRE-3C §10.8
**Descripción:** Durante el prefix sweep de `/admin/billing/trials`, apareció un segundo endpoint en `subscriptionRoutes.ts:198` — `GET /admin/billing/trials/stats` — que NO está mencionado en `ENDPOINT_AUDIT.md §6 P1`. Cero consumers en apps/admin/ apps/client/ packages/ (excluyendo tests). Es un huérfano adicional que el audit original no captó.
**Severidad estimada:** bajo
**Acción propuesta:** añadir a la lista de STILL_ORPHAN que D1 decida (implementar UI de stats / borrar endpoint / justificar).

### 2026-04-17 — Tasa de falso negativo 43.75% en §6 P1 del ENDPOINT_AUDIT

**Encontrado durante:** PRE-3C §10.2
**Descripción:** De los 48 endpoints re-verificados con metodología robusta, 21 tenían consumer live (FALSE_NEGATIVE). El tasa supera el umbral de 30% definido en PLAN_MAESTRO §5.7. Significa que el inventario de huérfanos del audit original no es confiable globalmente — no solo los 48 verificados. D1 debe re-verificar todos los endpoints, no confiar en §6 P1.
**Severidad estimada:** alto (bloqueante para D1)
**Acción propuesta:** ~~D1 aplica PLAN_MAESTRO §5.7 a los 471 endpoints~~ → **RESUELTO 2026-04-18 (D0-v2).** `ENDPOINT_AUDIT.md` v2 reescrito desde cero con `head_limit: 0` aplicado a los 471 endpoints. D1 arranca con baseline limpia. PATH_MISMATCH extraído como categoría separada (8 endpoints). Ver `ENDPOINT_AUDIT.md §4` v2.

---

## Hallazgos durante D0-v2

### 2026-04-18 — 8 endpoints SAML/OIDC PATH_MISMATCH requieren sprint dedicado

**Encontrado durante:** D0-v2 §2.26, §2.29 (confirmado de PRE-3C)
**Descripción:** `ENDPOINT_AUDIT.md §4` v2 lista los 8 endpoints con el mismatch: `useSso.ts` en `apps/client/` llama `/api/backend/(saml|oidc)/config|enable|disable`, el proxy Next.js strippea `/api/backend/` y llegan a Fastify como `/saml/config`, pero las rutas están registradas con prefix `/api/` (e.g. `/api/saml/config`). Resultado: 404 silencioso cuando un admin intenta configurar SSO.
**Severidad estimada:** medio (feature SSO falla en producción, aunque SSO no tiene UI principal activa todavía)
**Acción propuesta:** ~~sprint separado post-D0-v2~~ → **RESUELTO 2026-04-18.** Opción **B** aplicada (backend renombrado a `/saml/*` y `/oidc/*` sin prefix `/api/`, cliente sin cambios). Ver [`ENDPOINT_AUDIT.md §4.1`](ENDPOINT_AUDIT.md#41-fix-aplicado-2026-04-18) para detalle de cambios, verificación `tsc` clean y tests 77/77.

3 opciones originales documentadas en `ENDPOINT_AUDIT.md §4`:

1. Client: cambiar a `/api/backend/api/saml/*` (double prefix, match otros endpoints con `/api/` prefix)
2. Backend: cambiar registro de rutas a `/saml/config` sin prefix ← **elegida**
3. Proxy: preservar `/api/` prefix para rutas específicas

### 2026-04-18 — ~100 endpoints ORPHAN confirmados — top-offender es `content/contentRoutes.ts` con 18 endpoints sin UI

**Encontrado durante:** D0-v2 §3
**Descripción:** El archivo `apps/api/src/content/contentRoutes.ts` contiene 18 endpoints (sync, metrics, versions, conflicts, transform, render, diff) — ninguno tiene consumer en admin ni client. Representa el cluster más grande de orphans en un solo archivo. Otros clusters significativos: `integrations/zapierRoutes` (9), `integrations/makeRoutes` (8), `custom-reports/customReportRoutes` (8), `monitoring/cacheStatsRoutes` (6), `monitoring/rateLimitingDashboard` (5), `approvals/approvalWorkflowRoutes` (5).
**Severidad estimada:** medio (superficie de código sin uso UI, candidatos a eliminación o implementación)
**Acción propuesta:** D1 decide endpoint-por-endpoint (implementar UI / borrar / justificar). Los de `content/` especialmente sospechosos — son CRUD de versiones/transformaciones sin pantalla asociada.

### 2026-04-18 — Sin hallazgos metodológicos adicionales; los 4 validation cases confirmados

**Encontrado durante:** D0-v2 §9 (self-check)
**Descripción:** Los 4 casos de validación de PRE-3A/B/C fueron detectados independientemente por D0-v2 con `head_limit: 0`:

1. TemplateManagementDashboard consume 3 hooks ✅
2. FALSE_NEGATIVE top-offenders reproducidos (accountLifecycle, outbox, adminUser, audit) ✅
3. 8 SAML/OIDC PATH_MISMATCH ✅
4. Seed post-PRE-3B state (6 permission hits) ✅
   La metodología §5.7 funciona como esperado.
   **Severidad estimada:** N/A (confirmación positiva)
   **Acción propuesta:** ninguna. Mantener §5.7 vigente para D1-D7.

### 2026-04-18 — CQRS endpoints replican el patrón `/api/` prefix (latente)

**Encontrado durante:** Fix de PATH_MISMATCH SSO (Fase 1.2)
**Descripción:** Durante la investigación del fix de SAML/OIDC se encontró que `apps/api/src/cqrs/CQRSIntegration.ts` registra 2 rutas con prefix `/api/` siguiendo el mismo patrón que causó los 8 PATH_MISMATCH de SSO. Actualmente CQRSIntegration está clasificado como DEAD_CODE — la clase nunca se instancia en producción (verificado en D0-v2 §2.41). Por eso el bug es latente, no activo. **Implicación:** si en algún momento CQRS se reactiva (client refactor, experimento, nuevo sprint), los endpoints van a reproducir el mismo bug 404 que acabamos de arreglar para SSO, a menos que se strippee el prefix `/api/` antes de instanciar.
**Severidad estimada:** bajo (latente mientras CQRS siga siendo DEAD_CODE)
**Acción propuesta:** dejar como anotación. Si/cuando se reactive CQRS, aplicar Opción B antes de instanciar (cambiar registro a `/cqrs/*` sin prefix). Alternativamente, si se decide finalmente borrar CQRSIntegration como parte del cleanup pre-producción, este hallazgo se resuelve por eliminación.

### 2026-04-18 — `content/` es el core conceptual del producto, construido pero no cableado (7.6k LOC PLANNED)

**Encontrado durante:** Análisis arquitectónico post-D0-v2 (ver reporte "content module analysis")

**Descripción:**
El módulo `apps/api/src/content/` es una implementación arquitectónicamente sofisticada de "Git for content + sync bidireccional multi-plataforma" — la visión de valor diferenciador de OmniPost. Contiene 3 capacidades core:

1. **Adaptación inteligente por provider** (`PlatformContentAdapter`) — post canónico único → transformación automática a Twitter/Instagram/LinkedIn/etc. con reglas por plataforma.
2. **Versionado con branches y merges** (`ContentVersionManager`, `BranchManager`, `MergeManager`, `DiffCalculator`) — historial tipo Git por post, ramas experimentales para A/B, 3-way merge.
3. **Sincronización bidireccional en tiempo real** (`SyncEngine`, `SyncScheduler`, `ConflictDetector`) — cambios externos en cada red detectados y propagados, con UI de resolución de conflictos.

**Estado actual:** 18 endpoints HTTP registrados, todos con `requireClientAuth` (scope correcto). Arquitectura implementada con servicios, tests y DI. **Cero integración con el flow de publicación real** — `publishWorker.ts` hoy publica fire-and-forget sin pasar por `content/`. Los providers en `packages/providers/*/src/features/` hacen su propia lógica de adaptación simple, duplicando parcialmente lo que `PlatformContentAdapter` haría.

**Decisión de producto confirmada por Edward (2026-04-18):** "SI QUEREMOS ESO — es el corazón de la aplicación."

**Implicaciones:**

- **Reclasificación:** los 18 endpoints salen de ORPHAN → **PLANNED / PENDING_INTEGRATION**. No son candidatos a cleanup.
- **Trabajo pendiente estimado (alto nivel, no commitment):** 4-8 semanas con un buen spec de producto. Tres frentes:
  - UI cliente (6+ pantallas en `apps/client/`: timeline de versiones, diff viewer, UI de conflictos, preview por provider, toggles de sync, métricas).
  - Integración con pipeline de publicación (`publishWorker` debe crear snapshot antes de publicar, contenido pasa por `PlatformContentAdapter` antes del provider, webhooks/polling disparan `SyncEngine.detectInboundChange()`).
  - Wire del orquestador (`ContentSynchronizer` está en DI pero nunca resuelto — debe ser entry point desde worker).
- **Decisión arquitectónica pendiente:** resolver duplicación entre `packages/providers/*/features/` y `PlatformContentAdapter`. Default sugerido: adapter gana, providers se vuelven thin.
- **Riesgo estratégico:** el producto hoy vende/muestra con flow simple fire-and-forget, que cualquier competidor clona en un sprint. La diferenciación real (versioning + sync + adaptación unificada) existe como código pero no como feature usable.

**Severidad estimada:** alto (estratégico, no bloqueante técnicamente)

**Acción propuesta:**

1. **Inmediata:** reclasificar en `ENDPOINT_AUDIT.md` §2.40 + §3 de ORPHAN a PLANNED (micro-prompt de 15 min).
2. **Corto plazo:** en paralelo con D1-D7, empezar a trabajar el spec de producto de la feature (mockups, wireframes, user flow de versiones/conflicts). Sin esto, construir UI es tirar dardos.
3. **Mediano plazo:** plan de integración por fases (sugerencia incremental: fase 1 = versioning simple sin branches; fase 2 = adaptación unificada; fase 3 = sync bidireccional + conflicts).
4. **D1 hace:** registrar los 18 endpoints como PLANNED con link a este entry. No actúa sobre ellos (no borra, no implementa UI reactiva ad-hoc, no refactoriza). Producto define cuándo se integra.

**Reporte completo del análisis:** conversación de agente 2026-04-18 (preservado en chat).

### 2026-04-18 — §5.7 v3: template literals añadidos como pattern obligatorio de consumer-detection

**Encontrado durante:** D1 Fase 1 checkpoint + PRE-D1B re-scan

**Descripción:** En D1 Fase 1, 9 de 23 AMBIGUOUS (39%) resultaron ser CONSUMED vía template literals (`fetch(\`${BASE}/${var}\`)`). §5.7 v2 solo capturaba paths literales con comillas simples/dobles — los backticks con interpolación pasaban invisibles. PRE-D1B re-verificó los ~82 ORPHAN con pattern extendido (Query 2 para backticks + Query 3 para constantes BASE); encontró 1 FN adicional: `GET /admin/audit/export`consumido por`apps/admin/app/(dashboard)/logs/page.tsx:99`vía template literal. Tasa FN en ORPHAN = 1/82 = 1.2% (muy distinto del 39% de AMBIGUOUS, confirmando que el blind spot se concentraba en endpoints con`:param` dinámicos). §5.7 actualizada a v3 con pattern obligatorio de 3+1 queries (literal + template + BASE consts + count cross-check).

**Nota de calibración metodológica:** el Explore agent de PRE-D1B reportó "0 FN_TEMPLATE" tras block-check agresivo. Spot-check manual del parent encontró 1 hit que el agente había perdido. **Regla añadida a §5.7 v3:** cuando un agente reporta "0 hits" en block-check, el parent hace al menos 1 spot-check manual antes de aceptar.

**Severidad estimada:** alto (blind spot metodológico histórico, ahora resuelto; pero calibración de confianza en agentes requiere verificación cruzada)

**Acción propuesta:** ~~re-verificar ORPHAN con pattern extendido~~ → **RESUELTO 2026-04-18 (PRE-D1B).** Ver `ENDPOINT_AUDIT.md` §2.20 (`/admin/audit/export` reclasificado CONSUMED), `PLAN_MAESTRO.md` §5.7 v3, §6 fila PRE-D1B.

### 2026-04-18 — `useSettings.ts` doble prefix `/api/backend/api/admin/settings` (code smell, no bug)

**Encontrado durante:** D1 Fase 1 (reportado por agente) + PRE-D1B Fase 2 diagnóstico

**Descripción:** `apps/admin/hooks/api/useSettings.ts` línea 32 define `BASE = "/api/backend/api/admin/settings"` (doble `/api/`). Construye URLs como `${BASE}/${group}` → `/api/backend/api/admin/settings/STRIPE`. El proxy Next.js `apps/admin/app/api/backend/[...path]/route.ts:60` strippea solo `/api/backend/` (una vez), reconstruye como `/api/admin/settings/STRIPE`. El backend registra rutas en `settingsRoutes.ts` con prefix `/api/admin/settings/*` — match correcto. **Escenario A confirmado:** funciona, pero es code smell (los demás hooks usan `/api/backend/` una sola vez, `useSettings` es el único con doble prefix).

**Severidad estimada:** bajo (funciona correctamente, solo inconsistencia cosmética)

**Acción propuesta:** candidato para D6 (pre-production cleanup) o micro-sprint: cambiar `BASE` a `/api/backend/admin/settings` + ajustar las ~5 funciones que usan `${BASE}`. Esfuerzo estimado: 30 min. No urgente.

### 2026-04-18 — `apps/admin/app/(dashboard)/accounts/page.tsx:247` llama endpoint inexistente `/admin/accounts/:id/settings`

**Encontrado durante:** PRE-D1B Fase 1 spot-check

**Descripción:** La página de accounts hace `fetch(\`/api/backend/admin/accounts/${editingId}/settings\`, { method: "PUT", ... })` en línea 247. Grep exhaustivo en backend (`apps/api/src/`buscando`admin/accounts/\*/settings`) retorna cero hits — el endpoint **no existe**. Es un **client-reverse-orphan** (frontend llama ruta inexistente, patrón similar al `/dashboard/templates`documentado en ENDPOINT_AUDIT.md §5.1 o`/trends/radar` en §2.70). La UI probablemente falla silenciosamente con 404 cuando el usuario intenta esa acción.

**Severidad estimada:** medio (funcionalidad de UI rota sin alarma visible)

**Acción propuesta:** D1 Fase 2 evalúa: (a) implementar el endpoint backend si la feature es válida, (b) remover el fetch del frontend si la feature se descontinuó, o (c) investigar con producto si era una feature a medio implementar. Candidato para lista BUILD_UI o DELETE del backlog Sprint 2.

**[RESUELTO por D0-v4 piloto 2026-04-18]** Este hallazgo era un **falso positivo** del blind spot multi-line de §5.7 v3. El endpoint `PUT /admin/accounts/:id/settings` **sí existe**, registrado en `apps/api/src/admin/analyticsRoutes.ts:73-80` con auth correcto (`requireAdminAuth` + `requirePermission(Permission.ACCOUNT_MANAGE)`). El cliente llama `/api/backend/admin/accounts/${id}/settings` → proxy strip de `/api/backend/` → `/admin/accounts/:id/settings` → match backend registrado sin prefix. El endpoint funciona. Confirmado por lectura directa bajo §5.8.

### 2026-04-18 — PATH_MISMATCH #9: `/trends/radar` cliente llama endpoint inexistente (decisión producto: implementar)

**Encontrado durante:** D1 Fase 2 feature-intent deep analysis (análisis arquitectónico post D1 inicial)

**Descripción:** `apps/client/app/dashboard/ai/trends/page.tsx:43` hace `fetch(\`/api/backend/trends/radar?accountId=${accountId}\`)`esperando`ScoredTrend[]`(topic, platform, relevanceScore, postIdea, bestPlatform, urgency, volume). Backend`apps/api/src/trends/trendRoutes.ts` registra 5 endpoints GET (`/analysis`, `/viral`, `/opportunities`, `/predictions`, `/report`) pero **NO registra `/trends/radar`**. UI construida, demanda de cliente explícita, pero backend incompleto. Detectado durante análisis arquitectónico D1 — D1 Fase 1 tenía `trendRoutes.ts` como "DELETE huérfano" pero el re-análisis encontró la UI + mismatch.

**Severidad estimada:** alto — feature visible en UI cliente que falla silenciosamente con 404.

**Acción propuesta:** ~~DELETE feature~~ → **RESUELTO POR DECISIÓN DE PRODUCTO (Edward 2026-04-18): implementar `/trends/radar`.** Feature pasa a roadmap como:

- Los 5 endpoints legacy reclasificados ORPHAN → PLANNED en `ENDPOINT_AUDIT.md §3.5` (building blocks)
- PATH_MISMATCH #9 registrado en `§4` tabla principal
- Sprint dedicado: implementar backend `/trends/radar` con shape esperado + integrar con los 5 building blocks existentes + UI ya está construida
- Ver `D1_DECISIONS.md §5.2` para plan

### 2026-04-18 — D1 rescue pattern: features con arquitectura profunda rescatadas de DELETE

**Encontrado durante:** D1 Fase 2 feature-intent deep analysis tras input Edward "si algo fue concebido y se construyó, tiene razón"

**Descripción:** D1 inicial clasificó 24 endpoints como DELETE usando heurística rápida (cero consumer UI = DELETE). Análisis arquitectónico profundo feature-by-feature (estilo `content/`) tras input de producto reveló que **19 de esos 24 tenían arquitectura CORE_CONCEPTUAL o valor de negocio explícito**. Reducción DELETE 24 → 10 (-58%). Categorías rescatadas:

1. **`analytics/analyticsRoutes.ts` (7):** `ThreadAnalytics` service es CORE (batch optimization + caching + repository pattern + tests robustos). 2 endpoints → PLANNED core, 3 endpoints → BUILD_UI marketing (compare/geographic/media-performance endorsados por Edward "valioso para campañas de marketing"), 2 endpoints pendiente confirmación (engagement/trends, posts/best-times).
2. **`trends/trendRoutes.ts` (5):** Feature con UI parcial (`trends/page.tsx`) + PATH_MISMATCH #9 — no es DELETE, es PLANNED con mismatch a resolver.
3. **`billing/subscriptionRoutes.ts` (2):** `/admin/billing/health` (SaaS metrics MRR/churn) + `/admin/billing/trials/expiring` (retention ops list actionable, no solo count). Valor business confirmado por Edward → BUILD_UI.
4. **`audit/auditRoutes.ts` INVESTIGATE (2):** `/audit/users/:userId/logs`, `/audit/resources/:resource/logs` — queries compliance legítimas → KEEP_AS_INTERNAL.
5. **`analytics/realtimeAnalytics.ts` (1 WS):** WebSocket + Redis pub/sub infra → KEEP_AS_INTERNAL.

**Severidad estimada:** alto (calibración metodológica crítica)

**Lección incorporada:** **NUNCA DELETE sin análisis arquitectónico profundo.** Greps de consumer no bastan — si hay aggregates + UoW + domain events + tests robustos + docs del producto, hay intención. Caso `content/` fue el primer wake-up; D1 reveló el patrón sistemático. Aplicable a D2-D7: antes de decidir DELETE, leer servicios + identificar sofisticación arquitectónica. Ver `D1_DECISIONS.md §10` (calibración metodológica).

**Severidad estimada:** alto
**Acción propuesta:** **APLICADO.** D1 revisado publicado en `D1_DECISIONS.md` (2026-04-18). Para D2-D7, análisis arquitectónico profundo es pre-requisito obligatorio antes de clasificar DELETE en cualquier dimensión.

### 2026-04-18 — `GET /analytics/project/:projectId` sin auth (decisión producto pendiente)

**Encontrado durante:** D0-v4 Piloto Fase 3 lectura directa

**Descripción:** `apps/api/src/analytics/analyticsRoutes.ts:685-689` registra endpoint sin `preHandler` auth middleware. El comentario en código (línea 684) declara "no auth required for read", pero:

- No valida ownership del proyecto — cualquier requester con el `projectId` puede leer analytics.
- Analytics de proyecto puede exponer métricas de negocio sensibles (engagement, audience, performance).

Quote:

```typescript
// no auth required for read
fastify.get(
  "/analytics/project/:projectId",
  { schema: { tags: ["Analytics"], summary: "Get project analytics summary" } },
  async (request, reply) => handler.getProjectAnalytics(request, reply)
);
```

**Severidad estimada:** medio-alto (potencial data leak si `projectId` es enumerable o predictible)

**Acción propuesta:** validar con producto:

- Opción 1: es diseño intencional de "public projects" (portfolios, demos) — añadir standard exception en BACKEND_STANDARDS §2.1 documentando "public read analytics".
- Opción 2: es gap de auth — añadir `preHandler: [requireClientAuth, requireOwnershipOrPermission(projectResolver, ANALYTICS_READ)]`.

Sin decisión: D2 audit reportaría como violation. Sprint de fix según opción elegida.

### 2026-04-18 — `RateLimitingDashboard` clase nunca instanciada — D1 BUILD_UI misclassification

**Encontrado durante:** D0-v4 Piloto Fase 5 verificación

**Descripción:** `apps/api/src/monitoring/rateLimitingDashboard.ts` define clase `RateLimitingDashboard` con método `register(app)` que registra 5 endpoints `/admin/rate-limiting/*`. Grep exhaustivo confirma **cero instanciations** fuera del propio archivo (`grep -rn "new RateLimitingDashboard\|rateLimitingDashboard" apps/api/src/`). Clase nunca se registra en Fastify — endpoints nunca activos en prod.

Mismo patrón que `cqrs/CQRSIntegration.ts` (DEAD_CODE confirmado en D0-v2 §2.41). Pero D1_DECISIONS.md clasificó `rateLimitingDashboard` como **BUILD_UI P1** (ops-critical), asumiendo que los endpoints estaban activos esperando UI. Incorrecto.

**Severidad estimada:** bajo-medio (no hay auth crítico porque la clase está muerta; pero D1 roadmap y Sprint 2 planning están afectados — "5 endpoints de admin monitoring" listados en BUILD_UI priority P1 realmente son DEAD_CODE)

**Acción propuesta:** reclasificar en `D1_DECISIONS.md §2.1 Admin Monitoring & Ops Tooling`:

- Quitar `rateLimitingDashboard.ts (5 endpoints)` de BUILD_UI P1
- Añadir a nueva categoría DEAD_CODE o PLANNED (requiere decisión producto si se quiere la feature → requeriría instanciar la clase + registrarla en index.ts + construir UI; o DELETE si no se quiere)

**Paralelo con CQRS:** mismo patrón, D0-v2 ya lo clasificó correctamente como DEAD_CODE. Tratarlo similar.

### 2026-04-18 — Decisión arquitectónica pendiente: `/api/` prefix convention (~60/40 split real)

**Encontrado durante:** D0-v4 Piloto §8 + PRE-D2 §4.4 cross-confirmation

**Descripción:** D0-v4 Piloto confirmó el finding de PRE-D2: **~39% de endpoints (~159) usan `/api/` prefix, ~61% (~245) no lo usan**. Split cercano a 60/40 real, NO "461 de 471 sin prefix" como declaró `BACKEND_STANDARDS.md §1.1` (cifra errónea también usada en commit SSO fix `7d16e66`).

Patrón no es "outlier minoritario" — es patrón dominante en ~26 archivos con prefix uniforme vs ~40 sin prefix uniforme.

**Dominios consistentes CON prefix:** billing (admin + client), compliance, settings, campaigns, inbox, assets, tasks, reports, crm, integrations (zapier + make), webhooks dashboard, utm, brand (kit + voice), ai (promptTemplate + image), onboarding, announcements, scheduling client, outbox, customReports, externalNotifications, optimizedPosts, usage, saga, cqrs.

**Dominios consistentes SIN prefix:** admin (salvo 4 subset en analyticsRoutes), auth (todos 9), accounts, audit, analytics, content, approvals (ambos), templates, trends, notifications, health, linkRoutes, firstComment, cacheStats.

**Severidad estimada:** alto estratégico (bloquea D2 arranque)

**Acción propuesta — decisión Edward requerida antes de D2:**

- **Opción α:** BACKEND_STANDARDS §1.1 correcto. Los ~159 endpoints con prefix son drift histórico. Sprint dedicado a rename (muy grande, ~10× el SSO fix). Riesgo: rompería consumers frontend.
- **Opción β:** BACKEND_STANDARDS §1.1 incorrecto. Ambos patrones coexisten. Actualizar standard. SSO fix fue válido pero por razón distinta a la declarada.
- **Opción γ (recomendada por piloto):** Coexistencia explícita documentada. Actualizar §1.1 para reflejar split real + describir cuándo aplica cada patrón. Migración gradual en nuevos archivos sin romper existentes.

**D2 no puede arrancar sin esta decisión** — D2 Standards Compliance necesita saber si reportar los ~159 endpoints como violations (α), legítimos (β), o drift histórico aceptable (γ).

Ver `D0_v4_PILOT_BACKEND_ROUTES.md §8` para contexto completo.

### 2026-04-18 — Sprint D0v4-0 ejecutado: estandarización α completada

**Encontrado durante:** Sprint D0v4-0 (Opción α aprobada por Edward)

**Descripción:** Rename masivo de ~141 endpoints para eliminar `/api/` prefix (de 30 archivos backend + 18 hooks/components frontend correspondientes). Motivación: Edward decisión 2026-04-18 — código aún en desarrollo, dos approaches no aceptables, estandarización antes que todo.

**Detalles del sprint (branch `refactor/d0v4-0-rename-api-prefix`):**

- 5 commits de rename backend (archivos agrupados por dominio)
- 1 commit de rename frontend consumers
- Pattern backend: `"/api/<path>"` → `"/<path>"` (replace_all por archivo tras lectura directa §5.8)
- Pattern frontend: `"/api/backend/api/<path>"` → `"/api/backend/<path>"` + idem para backticks
- `ipAllowlistMiddleware.ts:29` EXEMPT_PATHS actualizado: `/api/settings/public` → `/settings/public`
- Grep post-rename: 9 paths con `/api/` restantes — todos CQRS DEAD_CODE esperados
- Grep post-rename frontend: 0 paths con `/api/backend/api/` en source files

**Pendientes derivados:**

- 9 endpoints CQRS (`CQRSIntegration.ts`) NO renombrados — pendientes de decisión §5.9 (DEAD_CODE vs PLANNED vs INFRASTRUCTURE_READY) en Sprint D0v4-2. Si DEAD_CODE se borran; si no se renombran.
- `BACKEND_STANDARDS.md §1.1` + `CODE_STANDARDS.md §3.1` actualizados reflejando contexto histórico real (cifra "461 de 471" corregida).
- Tests NO corridos en sesión — Edward valida al merge.
- Decisión §8 del piloto D0-v4 queda **resuelta como α aplicada**.

**Severidad estimada:** alto (cambio estructural grande, base limpia para D0v4-1+)

**Acción propuesta:** ~~decisión §8 prefix pendiente~~ → **RESUELTO 2026-04-18 por Sprint D0v4-0.** Ver `D0v4_0_RENAME_REPORT.md` para detalles completos y mapping de paths.

---

## Hallazgos durante D0v4-1

### 2026-04-19 — D1 undercount sistemático + misclassification KEEP_AS_INTERNAL (69 endpoints reales vs 49 declarados, 21 mal clasificados)

**Encontrado durante:** Sprint D0v4-1 Fase 0 (pre-B1) tras pregunta de Edward "¿por qué estos se mantienen como internos?"

**Descripción:** Verificación directa (§5.8) de los 11 archivos backend clasificados KEEP_AS_INTERNAL en `D1_DECISIONS.md §4` encontró dos problemas sistemáticos:

**Problema A — D1 undercount:** D1 declaró **49 endpoints** en estos 11 archivos. El conteo real con `grep "fastify\.\(get\|post\|put\|delete\)\|app\.\(get\|post\|put\|delete\)"` retorna **69 endpoints**. Diferencia: +20 endpoints que D1 no contó (saml 4 extra, oidc 4 extra, authRoutes 3 extra, providers 2 extra, zapier undercount de 1).

**Problema B — Misclassification:** 21 de los 69 endpoints tienen consumer UI o deberían tenerlo (BUILD_UI), no son KEEP_AS_INTERNAL. Tabla:

| Archivo                                     | Endpoints reales |                                  KEEP correcto |                                                          BUILD_UI reclasificar | Evidencia                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------- | ---------------: | ---------------------------------------------: | -----------------------------------------------------------------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth/oidcRoutes.ts`                        |                6 |                     2 (login/callback browser) | **3** (`/oidc/config` GET+PUT, `/oidc/enable`) + 1 candidato (`/oidc/disable`) | `apps/client/hooks/api/useSso.ts:87,110,131` consume `/oidc/config` + `/oidc/enable`                                                                                                                                                                                                                                    |
| `auth/samlRoutes.ts`                        |                7 |                         3 (login/metadata/acs) |                **4** (`/saml/config` GET+PUT, `/saml/enable`, `/saml/disable`) | `apps/client/hooks/api/useSso.ts:77,97,123` consume `/saml/config` + `/saml/enable`                                                                                                                                                                                                                                     |
| `auth/enhancedOAuthProvider.ts`             |                2 |                                           2 ✅ |                                                                              — | Browser redirects OAuth providers sociales. D1 correcto.                                                                                                                                                                                                                                                                |
| `auth/authRoutes.ts`                        |                7 |                                              ? |                                                  ? + **7 DEAD_CODE_CANDIDATE** | Cero consumers UI directos a `/register`, `/login`, `/logout`, `/refresh`, `/me`, `/sessions`, `/revoke-all`. Apps reales usan endpoints paralelos `/auth/customer/*` (customer-auth service). Verificar en B5 si admin UI los usa vía `apps/admin/providers/AuthProvider.tsx` o son DEAD.                              |
| `providers/providerRoutes.ts`               |                7 |                                              4 |                       **2** (`/providers/:id/health`, `/providers/health/all`) | `AdminContentEditor.tsx:109` consume `/providers/connections/:projectId`. Los health endpoints van a admin dashboard de "integrations status".                                                                                                                                                                          |
| `saga/SagaIntegration.ts`                   |                7 |                                           7 ✅ |                                                                 — (discutible) | `SagaIntegration` **SÍ instanciado** en `apps/api/src/index.ts:538`. No es DEAD_CODE como CQRS. Cero UI consumers — razonable ops-tooling. Argumento débil BUILD_UI (panel "Active Sagas") queda para decisión producto.                                                                                                |
| `audit/auditRoutes.ts` (compliance queries) |                2 |                                           2 ✅ |                                                                              — | `/admin/audit/users/:userId/logs`, `/admin/audit/resources/:resource/logs` — cero UI. Razonable queries programáticas compliance.                                                                                                                                                                                       |
| `billing/billingWebhookRoutes.ts`           |                2 |                                           2 ✅ |                                                                              — | `POST /webhooks/stripe`, `POST /webhooks/paddle` — firma validada. D1 correcto.                                                                                                                                                                                                                                         |
| `integrations/zapierRoutes.ts`              |   8 (D1 decía 9) |               3 (`/actions/*` + `/triggers/*`) |        **5** (`/zapier/keys` GET+POST+DELETE, `/zapier/subscribe` POST+DELETE) | Usuario OmniPost debe generar API key + configurar subscriptions — no todo se configura en zapier.com. `apps/client/lib/integrations/registry.ts:21` registra Zapier como integración disponible pero sin UI de gestión de keys.                                                                                        |
| `integrations/makeRoutes.ts`                |                8 |                                              3 |                                                    **5** (mismo patrón Zapier) | `apps/client/lib/integrations/registry.ts:33` registra Make. Sin UI de gestión.                                                                                                                                                                                                                                         |
| `health/healthRoutes.ts`                    |                5 | 3 (`/health`, `/health/live`, `/health/ready`) |                         **2** (`/health/detailed`, `/health/dependency/:name`) | Edward: dashboards de Monitoring/Maintenance consumen health checks para visualizar estado de servicios caídos/en línea. `apps/admin/app/(dashboard)/maintenance/page.tsx` usa `useQueueStats` + `useFailedJobs` pero **no consume** `/health/detailed` — falta panel "Dependencies Status" (DB, Redis, S3, providers). |
| **Totales**                                 |           **69** |                                         **34** |                                                 **21** + 8 DEAD_CODE_CANDIDATE |                                                                                                                                                                                                                                                                                                                         |

**Severidad estimada:** alto (D1 backlog Sprint 2 incompleto — 21 endpoints BUILD_UI no priorizados; 8 candidatos DEAD_CODE pueden rescatarse o eliminarse pero no están en cleanup list)

**Implicaciones para Sprint 2 / D2 / cleanup:**

1. **Sprint 2 BUILD_UI debe expandirse +21 endpoints** (de 42 a 63): integración bilateral Zapier/Make (10), SSO admin UI (7: `/oidc/config`+`/oidc/enable`/`/oidc/disable` + `/saml/config`+`/saml/enable`+`/saml/disable`), Providers health dashboard (2), Health dependency panel (2).
2. **`auth/authRoutes.ts` (7 endpoints admin-side)** requiere decisión en B5: si admin UI realmente no los usa, son DEAD_CODE_CANDIDATE (clean pattern similar a CQRSIntegration pero activo — hay que ver si instanciado). Verificar durante lectura directa de Batch 5.
3. **No sobreescribir D1_DECISIONS.md** — decisión Edward 2026-04-19: todo queda aquí en LATERAL_FINDINGS. D1 cerrado.

**Acción propuesta:**

- **No inmediata sobre código.** Sprint D0v4-1 continúa su trabajo de auditoría.
- **Post-sprint:** Edward valida cada reclasificación caso-por-caso. Si aprueba, Sprint 2 backlog se expande. D1 update puede ser micro-sprint o ignorable si el plan maestro deja LATERAL_FINDINGS como fuente de verdad.
- **B5 verificación obligatoria:** `auth/authRoutes.ts` admin-side — ¿cableado o DEAD_CODE? Determina los 7 endpoints.
- **Metodología:** D1 usó greps básicos + heurística rápida; §5.8 lectura directa encontró 20 endpoints fantasma + 21 misclassifications en 11 archivos. **Todas las clasificaciones D1 que no fueron validadas con §5.8 son sospechosas** — no solo estas 11. Revisar extensión del problema.

### 2026-04-19 — D1 classifications sin validación §5.8 son globalmente sospechosas

**Encontrado durante:** Análisis post-hallazgo anterior

**Descripción:** El hallazgo previo muestra que D1 undercount de endpoints en 11 archivos KEEP_AS_INTERNAL fue **+40.8% sobre el declarado** (49 → 69). Si este error rate aplica al resto del inventario D1 (BUILD_UI 42 + KEEP 40 + PLANNED 12 + DELETE 10 = 104 endpoints base), podría haber **~40 endpoints fantasma no contabilizados** en otras categorías. D1 no usó §5.8 porque §5.8 se formalizó post-D1 (durante D0-v4 piloto 2026-04-18). D1 es estadísticamente frágil.

**Severidad estimada:** medio (no bloqueante, pero cualquier sprint posterior basado en D1 hereda imprecisión)

**Acción propuesta:** Opciones a decisión Edward:

- **(a)** Re-validar D1 completo con §5.8 (sprint pequeño dedicado, ~2-3 días). Resultado autoritativo.
- **(b)** Aceptar D1 como baseline aproximada; LATERAL_FINDINGS captura correcciones incrementales sprint a sprint (patrón actual).
- **(c)** Validación §5.8 solo de las categorías que realmente importan para Sprint 2 (BUILD_UI 42) — ignorar KEEP/PLANNED/DELETE precisión.

---

## Hallazgos D0v4-1 (2026-04-20)

> 24 entradas generadas durante el sprint D0v4-1 (~395 archivos auditados: domain + infra repos + services + use cases). Ver `docs/audits/D0v4_1_BACKEND_SERVICES_REPORT.md` para contexto completo.

### 2026-04-20 — L-1: MFA duality con OLD en producción

**Encontrado durante:** D0v4-1 Batch 5
**Descripción:** Coexisten dos implementaciones: `apps/api/src/auth/mfaService.ts` (OLD, 521 LOC, SHA-256 backup codes almacenados en campo `passwordResetToken` L85 HACK) y `apps/api/src/admin/auth/MfaService.ts` (NEW, 244 LOC, `mfaBackupCodes` array + `mfaBackupUsedAt` map + argon2). DI container [`setupServices.ts:84-85`](apps/api/src/infrastructure/container/setupServices.ts#L84-L85) registra **OLD** vía `TOKENS.MfaService`. NEW no está en DI.
**Severidad estimada:** alto (seguridad + consistencia)
**Acción propuesta:** Edward CP3 aprobó: mantener NEW, migrar rutas a NEW (+ data migration de backup codes SHA-256→argon2), eliminar OLD. Sprint dedicado.

### 2026-04-20 — L-2: 3 domain events sin export en index

**Encontrado durante:** D0v4-1 Batch 1
**Descripción:** `apps/api/src/domain/events/PostEvents.ts` (354 LOC) define 13 event classes, pero `index.ts` solo exporta 10. Faltan: `PostUnscheduled`, `PostPublishingStarted`, `PostMediaRemoved`. Pueden ser unreachable o llamarse vía import directo — no verified en este sprint.
**Severidad estimada:** bajo
**Acción propuesta:** BACKLOG — verificar consumers de las 3 clases; si no hay, DEAD_CODE_CANDIDATE.

### 2026-04-20 — L-3: 17 domain repository ports sin adapter Prisma detectable

**Encontrado durante:** D0v4-1 Batch 2
**Descripción:** Grep cross-ref entre `domain/repositories/*.ts` (56 ports) y `infrastructure/repositories/Prisma*.ts` encontró 17 ports sin adapter asociado detectable por naming convention. Posible: ports declarados en anticipación, adapters wired por otro path, ports legacy.
**Severidad estimada:** medio
**Acción propuesta:** Edward CP1: flag only. Pendiente triage caso por caso — algunos pueden ser DEAD_CODE_CANDIDATE.

### 2026-04-20 — L-4: 3 adapters `@deprecated` aún activos

**Encontrado durante:** D0v4-1 Batch 3+4
**Descripción:** En `infrastructure/repositories/` hay 3 adapters marcados `@deprecated` en JSDoc pero sin migration path documentado ni replacement confirmado. Edward CP2: "Si muestra @deprecated muy probablemente lo está" → clasificar como DEAD_CODE_CANDIDATE + estructurar migración.
**Severidad estimada:** medio
**Acción propuesta:** Sprint dedicado de migration paths documentation + delete.

### 2026-04-20 — L-5: `Repository<T,TId>` base usa `Result<void, Error>` (no `DomainError`)

**Encontrado durante:** D0v4-1 Batch 1
**Descripción:** `apps/api/src/domain/repositories/Repository.ts:108` define base con `Result<void, Error>`. Propaga a todos los 56 adapters. Violación §4.1 Backend Standards "Use domain error classes, not plain `Error`". Es infraestructural — cambio mass-scale.
**Severidad estimada:** bajo (no rompe funcionalidad)
**Acción propuesta:** BACKLOG. Migración a `Result<void, DomainError>` probable en sprint de refinamiento domain.

### 2026-04-20 — L-6: `GatewayBillingService.ts` God service + fake eventId rompe idempotency

**Encontrado durante:** D0v4-1 Batch 6
**Descripción:** `apps/api/src/billing/GatewayBillingService.ts` es **1042 LOC** con responsabilidades: Stripe↔Paddle switching, invoice handling, BillingEvent idempotency, refunds, subscriptions. **L732 genera `eventId` sintético** — rompe garantía de idempotency de `BillingEvent` (el evento debería venir del provider webhook, no auto-generado).
**Severidad estimada:** alto (billing consistency)
**Acción propuesta:** Split en services especializados + fix L732 idempotency. Sprint dedicado post-D0v4.

### 2026-04-20 — L-7: `webhookDashboardService.ts` God service + retry queue stub

**Encontrado durante:** D0v4-1 Batch 6
**Descripción:** `apps/api/src/webhooks/webhookDashboardService.ts` es **854 LOC**. Timeline query ejecuta **72 queries por call** (N+1 pattern). **L601 retry queue es stub** (no-op en lugar de enqueue real a BullMQ DLQ retry).
**Severidad estimada:** alto (performance + reliability)
**Acción propuesta:** Performance optimization + implement retry queue real. Sprint dedicado.

### 2026-04-20 — L-8: `trendAnalysisService.ts` mock data hardcoded en 3 métodos críticos

**Encontrado durante:** D0v4-1 Batch 7
**Descripción:** `apps/api/src/trends/trendAnalysisService.ts` (533 LOC) retorna mock data en `analyzeViralContent`, `generateTrendPredictions`, `discoverContentOpportunities`. Código admite vía TODO: "Integrate with real TikTok APIs". Routes `/trends/*` están wired pero backend es ficticio.
**Severidad estimada:** medio (UX degradado, no rompe nada)
**Acción propuesta:** Integrar provider real (TikTok API, etc.) o clasificar como DEMO_MODE explícito en docs.

### 2026-04-20 — L-9: `content/SyncEngineImpl.ts` MASIVOS STUBS con routes wired (CORE_CONCEPTUAL disclaimer)

**Encontrado durante:** D0v4-1 Batch 7
**Descripción:** `apps/api/src/content/SyncEngineImpl.ts` tiene 11 métodos placeholder: `detectChanges`, `detectConflicts`, `applyChanges`, `applyRealtimeChanges`, `getChannelMetrics`, `getGlobalMetrics`, `startTransactionProcessor`, `startConflictProcessor`, `resumeSyncTransaction`, `executeRollback`, `handleProviderStatusChange`. Todos los 20 endpoints `/content/*` están wired en [`index.ts:502`](apps/api/src/index.ts#L502), pero el backend principal es stub.
**Severidad estimada:** alto
**Acción propuesta:** Edward CP4: **mantener CORE_CONCEPTUAL (D1_DECISIONS) + DISCLAIMER** aquí. El sistema es conceptualmente el core del product MVP, pero la implementación está incompleta. Sprint dedicado de completion post-audit cycles.

### 2026-04-20 — L-10: `content/VersionController.ts` DB persistence stub (Redis-only)

**Encontrado durante:** D0v4-1 Batch 7
**Descripción:** `apps/api/src/content/VersionController.ts:303` `storeVersion()` solo escribe Redis (cache + list). `getVersionHistoryFromDatabase` L333 retorna `[]`. `deactivatePreviousVersions` L313 comment-only vacío. `calculateChecksum` L292 admite "simple checksum, in production use proper hashing".
**Severidad estimada:** alto (no hay persistencia permanente de versions de contenido)
**Acción propuesta:** Implementación completa en sprint de content subsystem (complementa L-9).

### 2026-04-20 — L-11: `content/` duplicación huérfana SyncEngineImpl vs ConflictDetector + SyncScheduler

**Encontrado durante:** D0v4-1 Batch 7
**Descripción:** `ConflictDetector.ts` (358 LOC, funcional) y `SyncScheduler.ts` (364 LOC, funcional) tienen métodos nombrados idénticos a los stubs de `SyncEngineImpl` (`detectChanges`, `detectConflicts`, `startContentChangeProcessor`). SyncEngineImpl **no los referencia**. Código funcional accessible solo vía paths alternativos.
**Severidad estimada:** medio
**Acción propuesta:** Refactor: `SyncEngineImpl` debe delegar a `ConflictDetector` + `SyncScheduler` en lugar de duplicar logic como stubs.

### 2026-04-20 — L-12: `templates/*` triple violación standards

**Encontrado durante:** D0v4-1 Batch 7
**Descripción:** `apps/api/src/templates/templateService.ts`, `TemplateABTestService.ts`, `TemplateVersionService.ts`:

- `import { prisma } from "@infra/prisma"` (fitness function rule #1 violation)
- `export const templateService = new TemplateService()` module-level singleton L553
- `any` en tipos de retorno de `compileTemplate` L329, `compileTemplateWithComponents` L396, `getPlatformLimits` L469 (fitness function rule #3 violation)
- Dynamic imports L348/415/462/476/488 vs static imports resto del app

**Severidad estimada:** medio
**Acción propuesta:** Edward CP3: "Solo registrar, los fixes vendrán en próximas fases". Sprint de templates refactor post-audit.

### 2026-04-20 — L-13: Module-level cache pattern (no testeable)

**Encontrado durante:** D0v4-1 Batch 7
**Descripción:** Mismo antipatrón en 2 lugares:

- `application/ai/GetTopPerformersContextUseCase.ts:53` `const cache = new Map<...>()` TTL 6h
- `application/trends/FetchTrendingTopicsUseCase.ts:36` `const cache = new Map<...>()` TTL 30min

Cache a nivel módulo persiste entre tests, no es injectable, no es clearable externamente.
**Severidad estimada:** medio (testing + ops)
**Acción propuesta:** Introducir `CachePort` abstracto + adapter Redis/Memory. Refactor los 2 UCs.

### 2026-04-20 — L-14: `providers/` triple service overlap + module-level singletons + placeholder

**Encontrado durante:** D0v4-1 Batch 8
**Descripción:** 3 módulos con responsabilidades solapadas:

- `providerRegistry.ts` L271 `export const providerRegistry = new ProviderRegistryService()` + `getProvidersByCapability` L131
- `providerCapabilityManager.ts` L497 `export const capabilityManager = new ProviderCapabilityManager()` + `getProvidersByCapability` L91 (duplicado) + `estimateReach` L441 hardcoded placeholder
- `providerConstraintValidator.ts` validation rules — parcialmente solapa con registry

**Severidad estimada:** medio
**Acción propuesta:** Consolidación en un ProviderService unificado + DI.

### 2026-04-20 — L-15: `application/ml/*` viola hexagonal (import de AIService concreto)

**Encontrado durante:** D0v4-1 Batch 8
**Descripción:**

- `application/ml/OptimizeContentUseCase.ts:16` `import type { AIService } from "../../ai/aiService.js"`
- `application/ml/PredictOptimalTimingUseCase.ts:18` idem

Application layer importa concrete class de infrastructure. CLAUDE.md: "application/ imports domain only".
**Severidad estimada:** alto (arquitectura)
**Acción propuesta:** Edward CP4: solo registrar. Introducir `AIServicePort` en `domain/repositories/` + adapter en `infrastructure/`.

### 2026-04-20 — L-16: `SyncProviderCommentsUseCase.ts` provider API calls dentro UoW

**Encontrado durante:** D0v4-1 Batch 8
**Descripción:** `application/inbox/SyncProviderCommentsUseCase.ts:172+` envuelve `doWork` completo dentro `unitOfWork.executeInTransaction`. `doWork` contiene loop con `adapter.getComments(...)` — llamada al provider externo (red HTTP con paginación vía cursor). Violación crítica CLAUDE.md: "Never put external API calls inside the transaction — only DB writes". Riesgo: long-held DB transaction + rollback sobre success parcial.
**Severidad estimada:** crítico
**Acción propuesta:** Fix inmediato en sprint de correcciones post-audit. Mover fetch fuera de UoW; cada ingestión interna (`ingestUseCase.execute`) es su propio UoW.

### 2026-04-20 — L-17: `IngestChannelAnalyticsUseCase.ts` VO factory bypass

**Encontrado durante:** D0v4-1 Batch 8
**Descripción:** `application/analytics/IngestChannelAnalyticsUseCase.ts:61-62` raw cast `{ value: input.channelId } as ChannelId` bypassa `ChannelId.fromString()` validation.
**Severidad estimada:** bajo
**Acción propuesta:** Cambiar a `const idResult = ChannelId.fromString(input.channelId); if (!idResult.ok) return err(...); channelRepository.findById(idResult.value)`.

### 2026-04-20 — L-18: `TriggerIntegrationEventService.ts` raw fetch sin port

**Encontrado durante:** D0v4-1 Batch 8
**Descripción:** `application/integrations/TriggerIntegrationEventService.ts:53` usa `fetch()` directo sin `HttpClientPort`. Fire-and-forget sin retry policy ni delivery guarantees. 10s timeout via `AbortSignal.timeout`. Errores silently consumed.
**Severidad estimada:** medio (observability + reliability)
**Acción propuesta:** Introducir `HttpClientPort` + adapter + delivery log tabla. Retry via BullMQ para idempotent delivery.

### 2026-04-20 — L-19: Cross-domain type import `ChannelQueryForIngestion`

**Encontrado durante:** D0v4-1 Batch 8
**Descripción:** `application/inbox/DispatchInboxSyncUseCase.ts:12` importa `ChannelQueryForIngestion` desde `application/analytics/DispatchAnalyticsIngestionUseCase.ts`. Type debería vivir en `domain/repositories/` (shared interface).
**Severidad estimada:** bajo
**Acción propuesta:** Mover `ChannelQueryForIngestion` a `domain/repositories/ChannelQueryForIngestion.ts`.

### 2026-04-20 — L-20: `reports/` vs `custom-reports/` sistemas paralelos (candidato unificación)

**Encontrado durante:** D0v4-1 Batch 8
**Descripción:** Dos sistemas paralelos con conceptos solapados: `application/reports/` (ScheduledReport entity, CSV/JSON via EmailPort) y `application/custom-reports/` (CustomReport entity, chart-ready via AnalyticsAggregationQueryPort, sharing support). `custom-reports` es el sistema más moderno (más features).
**Severidad estimada:** medio
**Acción propuesta:** Edward CP4: **DUPLICATION + candidato unificación**. Sprint dedicado de consolidación — migrar consumers de `reports/` a `custom-reports/` y eliminar.

### 2026-04-20 — L-21: `GenerateUTMLinksUseCase.ts` mutante sin UoW

**Encontrado durante:** D0v4-1 Batch 8
**Descripción:** `application/utm/GenerateUTMLinksUseCase.ts` llama `link.setUTMParameters` + `repository.save(link)` sin envolver en `unitOfWork.executeInTransaction`. CLAUDE.md: "Every mutating use case MUST use UoW. No exceptions for new code."
**Severidad estimada:** bajo (single save, riesgo mínimo)
**Acción propuesta:** Agregar UoW wrapper para consistencia con patrón del resto de UCs mutantes.

### 2026-04-20 — L-22: Outbox pattern — 3 issues detectados

**Encontrado durante:** D0v4-1 Batch 3+4
**Descripción:** Durante auditoría de `infrastructure/repositories/` y outbox-related adapters se detectaron 3 issues específicos en el dispatcher logic (concurrent claim race potencial, missing idempotency key en 1 code path, retry backoff inconsistente). Detalles in D0v4_1_BACKEND_SERVICES_REPORT.md §2.2 + mejor tratamiento en D0v4-2 (infra scope).
**Severidad estimada:** medio
**Acción propuesta:** Edward CP2: a LATERAL_FINDINGS, fix en sprint D0v4-2 o dedicated.

### 2026-04-20 — L-23: `InviteTeamMemberUseCase.ts` hardcoded baseUrl

**Encontrado durante:** D0v4-1 Batch 5
**Descripción:** `application/team/InviteTeamMemberUseCase.ts:148` `let baseUrl = "https://app.omnipost.io"` como fallback. Solo se sobreescribe si `credentialService.getGroup("PLATFORM")` retorna `baseUrl`. Hardcoded URL en domain/application layer.
**Severidad estimada:** bajo
**Acción propuesta:** Inyectar `baseUrl` vía config port / environment variable obligatorio.

### 2026-04-20 — L-24: `templates/templateService.ts` dynamic imports

**Encontrado durante:** D0v4-1 Batch 7
**Descripción:** `templates/templateService.ts` usa `await import("../lib/templates/templateEngine")` dinámico en L348, L415, L462, L476, L488 en lugar de import estático. Patrón inconsistente con el resto del app. Posiblemente para break circular dep — requiere verificación.
**Severidad estimada:** bajo
**Acción propuesta:** Investigar razón (circular dep?) y convertir a static si posible.

---

## Hallazgos D0v4-2 (2026-04-20)

> 27 entradas generadas durante el sprint D0v4-2 (91 archivos auditados: middlewares + DI container + events + integration-events + outbox + CQRS + libs + observability + bootstrap). Ver `docs/audits/D0v4_2_MIDDLEWARES_DI_INFRA_REPORT.md` para contexto completo. Regla CP1 vigente: todo "no wired" va a LATERAL_FINDINGS con research de intent pending antes de DEAD_CODE_CANDIDATE.

### 2026-04-20 — L-25: 4 tokens DI orfanados — possible implementables

**Encontrado durante:** D0v4-2 Batch 2
**Descripción:** 4 tokens declarados en `infrastructure/container/types.ts` pero NUNCA registrados ni resueltos en el codebase:

- `TOKENS.EnableReportSharingUseCase` (types.ts:415) — grupo "Report Sharing (Sprint 6 — Batch 3)"
- `TOKENS.DisableReportSharingUseCase` (types.ts:416) — grupo "Report Sharing (Sprint 6 — Batch 3)"
- `TOKENS.GenerateContentCalendarUseCase` (types.ts:422) — grupo "AI Differentiation"
- `TOKENS.PaymentAdapter` (types.ts:400) — grupo "Payment Billing (Sprint 6 — Batch 5)"

**Severidad estimada:** medio
**Acción propuesta:** Edward CP2 decidió: LATERAL_FINDINGS con research de intent. Verificar si fueron concebidos para implementación futura, si ya se implementaron bajo otro nombre, o si son genuinamente DEAD. Regla CP1: no DEAD_CODE_CANDIDATE hasta completar investigación.

### 2026-04-20 — L-26: `rbacMiddleware.roleBasedRateLimit` FAKE rate limiter

**Encontrado durante:** D0v4-2 Batch 1
**Descripción:** `apps/api/src/auth/rbacMiddleware.ts:200-221` `roleBasedRateLimit` declara límites distintos por rol (SUPER_ADMIN: 1000 req/15min, ADMIN: 500, SUPPORT: 200) pero solo setea headers `X-RateLimit-Limit` y `X-RateLimit-Window` — NO enforce nada. Security theater. Si código consumidor asume que limita, hay bypass silencioso.
**Severidad estimada:** alto (security)
**Acción propuesta:** Implementar enforcement real usando Redis sorted sets (como security/rateLimit.ts) o eliminar método + docs.

### 2026-04-20 — L-27: `auditLogger.extractUserId` STUB — audit logs sin userId

**Encontrado durante:** D0v4-2 Batch 1
**Descripción:** `apps/api/src/security/auditLogger.ts:430-434` `extractUserId(_req)` retorna `undefined` con comment admitido: "This would be implemented based on your authentication system. For now, return undefined as we don't have auth implemented yet". Todos los audit logs escritos vía `AuditLogger.log()` carecen de userId. Contraste: `PlatformCredentialService.setCredential` L69 SÍ loguea userId correctamente (sistema paralelo de audit logging). Incumplimiento compliance — SOC2/GDPR requieren trazabilidad user-level.
**Severidad estimada:** crítico (compliance)
**Acción propuesta:** Edward CP1 marcó crítico. Extraer userId de `request.auth.user.id` (admin) o `request.customerUser.id` (customer) usando mismo pattern que PlatformCredentialService. Sprint dedicado de compliance + migración de audit logs históricos.

### 2026-04-20 — L-28: `fileUploadValidator` placeholder + simulated scanner

**Encontrado durante:** D0v4-2 Batch 1
**Descripción:** `apps/api/src/security/fileUploadValidator.ts` tiene múltiples placeholders críticos:

- L495-522 `scanForMalware` admite "Simulate ClamAV or other antivirus integration. In production, this would call actual antivirus API"
- L499-503 solo check against `knownMaliciousHashes` array con 2 hashes hardcoded (EICAR test signatures)
- L527-541 `quarantineFile` solo agrega a `Set<string>` en memoria, no escribe al filesystem
- L605-626 `getPlugin()` retorna un hook placeholder con comment "This is a placeholder for the integration point" — NO valida files reales

**Consecuencia**: cualquier file upload pasa sin validación real en producción.
**Severidad estimada:** crítico (security)
**Acción propuesta:** Sprint dedicado: integración real antivirus (ClamAV-REST, VirusTotal, AWS GuardDuty), persistencia de quarantine, wire el plugin a rutas de upload.

### 2026-04-20 — L-29: `slidingWindowRateLimit.extractUserId` STUB

**Encontrado durante:** D0v4-2 Batch 1
**Descripción:** `apps/api/src/security/slidingWindowRateLimit.ts:248-259` `extractUserId(req)` retorna `null` siempre con comment "Would need to decode JWT here - simplified for now". User tracking para rate limiting está roto.
**Severidad estimada:** alto
**Acción propuesta:** Implementar JWT decode o wire solo post-auth donde `request.auth.user.id` esté disponible.

### 2026-04-20 — L-30: 5 rate limiters paralelos — 1 wired, 4 INFRASTRUCTURE_READY

**Encontrado durante:** D0v4-2 Batch 1
**Descripción:** Coexisten 5 sistemas:

- `rbacMiddleware.roleBasedRateLimit` — FAKE (L-26)
- `adminAuthMiddleware.rateLimit` — in-memory Map, NO cluster-safe
- `security/rateLimit.ts` — Redis sorted set (único wired en index.ts:348)
- `security/advancedRateLimit.ts` — Redis + progressive blocking + UA fingerprint (NO wired)
- `security/slidingWindowRateLimit.ts` — sub-window + geo + progressive (NO wired + L-29 STUB)

Plus: `RateLimitConfigs` export duplicado entre `rateLimit.ts:124` y `advancedRateLimit.ts:286` con contenidos distintos.

**Severidad estimada:** medio
**Acción propuesta:** Edward CP1 decidió INFRASTRUCTURE_READY (no DEAD). Investigar intent — ¿advancedRateLimit/slidingWindow eran reemplazo planeado del básico? Si sí, completar migration. Si no, eliminar no-wired.

### 2026-04-20 — L-31: 3 validators paralelos con patrones SQL distintos

**Encontrado durante:** D0v4-2 Batch 1
**Descripción:** 3 implementaciones de validación con lógica solapante pero patrones distintos:

- `security/enhancedValidator.ts` (582 LOC) — OOP stateful + DOMPurify (NO wired)
- `security/inputValidation.ts` (303 LOC) — static `SecurityValidator` + Zod schemas
- `security/securityHeaders.validateRequest` (L279-324) — patterns sqlmap/nmap/XSS/path traversal

Los patrones SQL injection SON DIFERENTES entre los 3. Una request puede pasar uno y fallar otro si se usan en rutas distintas — inconsistencia crítica.

**Severidad estimada:** alto
**Acción propuesta:** Consolidar en un único `ValidationPort` + adapter. Eliminar los 2 no usados. Unificar patterns.

### 2026-04-20 — L-32: 2 sistemas API key hashing paralelos (SHA-256 vs argon2)

**Encontrado durante:** D0v4-2 Batch 1
**Descripción:** Dos sistemas de API key hashing coexisten:

- `security/credentialManager.hashApiKey` L335 — SHA-256 (débil, no adaptive)
- `integrationAuthMiddleware` + `GenerateIntegrationApiKeyUseCase` — argon2id (D0v4-1 confirmed)

Coexisten en producción con hashing distinto según path de entrada: `/api-keys/*` (credentialManager) vs `/zapier/*` + `/make/*` (integrationAuth).

**Severidad estimada:** alto (security)
**Acción propuesta:** Migrar credentialManager a argon2. Data migration de keys hashed con SHA-256 (forzar re-generation o wrapped hash).

### 2026-04-20 — L-33: 2 sistemas paralelos de correlation ID generation

**Encontrado durante:** D0v4-2 Batch 1
**Descripción:**

- `middleware/correlationMiddleware.ts` (128 LOC) — hooks onRequest + onResponse + onError + child logger. Completo pero NO wired en index.ts.
- `middleware/metricsMiddleware.ts:19-22` — también genera correlation ID via `apiMetrics.generateCorrelationId`. Sí wired.

Solo metricsMiddleware es el que corre. correlationMiddleware.ts es DEAD-by-not-wired.

**Severidad estimada:** bajo
**Acción propuesta:** Wire correlationMiddleware (superior: child logger with context) + remover correlation ID generation de metricsMiddleware. O eliminar correlationMiddleware si metricsMiddleware cubre.

### 2026-04-20 — L-34: `index.ts` God file 688 LOC + 37 route registrations

**Encontrado durante:** D0v4-2 Batch 1
**Descripción:** `apps/api/src/index.ts` hace: 37 route registrations + middleware chain + DI container setup + SAGA integration + OTel init + graceful shutdown + daily setInterval jobs + Sentry init. Split candidato a múltiples archivos: `bootstrap.ts`, `routes.ts`, `middlewareChain.ts`, `shutdown.ts`.
**Severidad estimada:** medio (mantenimiento)
**Acción propuesta:** Split en sprint dedicado de refactor.

### 2026-04-20 — L-35: `createRedisConnection()` llamado 13 veces en DI factories

**Encontrado durante:** D0v4-2 Batch 2
**Descripción:** `apps/api/src/infrastructure/container/setupServices.ts` llama `createRedisConnection()` en L177, 198, 215, 232, 259, 275, 284, 313, 337, 360 (+ más en index.ts y otros). Cada factory crea SU propia conexión Redis — ~15+ conexiones simultáneas al iniciar. No hay token DI `Redis`. Redis tiene límite conexiones (default 10000 en Railway, menos en local).
**Severidad estimada:** medio (ops)
**Acción propuesta:** Registrar `TOKENS.Redis` con factory singleton. Todas las factories resolve vs crear nueva.

### 2026-04-20 — L-36: `EventService` sin token DI — 6+ instancias paralelas (unificación candidate)

**Encontrado durante:** D0v4-2 Batch 2+3
**Descripción:** `events/EventService` es un servicio infra completo (Event Sourcing con PostgreSQLEventStore + RedisEventPublisher) pero NUNCA registrado en `TOKENS`. Se instancia 6 veces en `setupServices.ts` factories (L200, 217, 234, 261, 315, 362) + 1 vez en `index.ts:531` para SagaIntegration. Cada instancia:

- Crea su propio PostgreSQLEventStore
- Intenta `ensureTable()` at init → race potencial
- Crea su propio subscriber Redis connection (via `redis.duplicate()`)
- Registra su propio health check interval 30s

Edward CP3 decision: **unificación candidate**. Arquitectónicamente también coexiste con `EventDispatcher`/`ComposedEventDispatcher` (domain events path) — son 2 sistemas event paralelos.

**Severidad estimada:** alto
**Acción propuesta:** Sprint dedicado de event system unification. Registrar `TOKENS.EventService` singleton. Decidir si EventService (Event Sourcing completo) reemplaza EventDispatcher (domain events simples) o son sistemas complementarios con boundary claro.

### 2026-04-20 — L-37: `{} as ApiMetrics` mock vacío en ThreadAnalytics registration

**Encontrado durante:** D0v4-2 Batch 2
**Descripción:** `apps/api/src/infrastructure/container/setupServices.ts:262` registra ThreadAnalytics con `{} as ApiMetrics` — mock vacío. ThreadAnalytics en producción recibe un objeto sin ninguno de los Prometheus counters → cualquier intento de `metrics.rateLimitBlocked.inc()` o similar crash silencioso (el objeto vacío tira TypeError).
**Severidad estimada:** crítico (Edward CP2)
**Acción propuesta:** Registrar `TOKENS.ApiMetrics` correctamente + resolve en factory. Crear shared ApiMetrics instance que se use en toda la app.

### 2026-04-20 — L-38: `UpdatePricingConfigUseCase` registrado con 4 no-op stubs

**Encontrado durante:** D0v4-2 Batch 2
**Descripción:** `apps/api/src/infrastructure/container/setupBillingUseCases.ts:69-81` registra UC con 4 argumentos no-op (`updateEntity`, `findAffectedSubscriptions`, `setSubscriptionStatus`, `createPriceHistory`, `dispatch`). Comentario admite "will be created when the grandfathering flow is wired through the use case. For now, pricing CRUD goes through pricingRoutes.ts handlers directly".

**Severidad estimada:** medio (revisar utilidad negocio per Edward CP2)
**Acción propuesta:** Investigar intent original — ¿grandfathering flow es útil para negocio? Si sí, implementar adapters reales. Si no, decidir eliminar UC o mantener como placeholder documentado.

### 2026-04-20 — L-39: `GenerateRepurposeVariantsUseCase` noOpNotification hardcoded

**Encontrado durante:** D0v4-2 Batch 2
**Descripción:** `apps/api/src/infrastructure/container/setupRepurposeUseCases.ts:90-92` inyecta `NotificationPort` no-op: `{ notify: async () => {} }`. Notifications de repurpose variants nunca se envían.
**Severidad estimada:** medio (revisar utilidad negocio per Edward CP2)
**Acción propuesta:** Investigar intent — ¿usuarios deberían recibir notification cuando variants están listos? Si sí, wire `CreateNotificationUseCase` como en otros UCs. Si no, eliminar dependency.

### 2026-04-20 — L-40: 9 setup files usan Prisma singleton vs resto DI pattern

**Encontrado durante:** D0v4-2 Batch 2
**Descripción:** Patrón inconsistente en DI setup. Mayoría usa lazy factory `container.resolve(TOKENS.PrismaClient)`. 9 files usan `import { prisma } from "@infra/prisma"` singleton + eager `new PrismaXxx(prisma)`:

- setupAssetUseCases.ts
- setupCrmUseCases.ts
- setupCustomReportUseCases.ts
- setupSamlUseCases.ts
- setupBrandVoiceUseCases.ts
- setupBrandKitUseCases.ts
- setupReferralUseCases.ts
- setupTrendUseCases.ts
- setupInboxUseCases.ts (parcial L45, L247, L251)

**Severidad estimada:** medio
**Acción propuesta:** Unificar todos a lazy factory pattern. Registrar repos via `container.register` no `container.registerInstance`.

### 2026-04-20 — L-41: `EventStore.ensureTable` crea tabla via runtime DDL

**Encontrado durante:** D0v4-2 Batch 3
**Descripción:** `apps/api/src/events/EventStore.ts:62-88` usa `$executeRaw\`CREATE TABLE IF NOT EXISTS stored_events...\``al inicializar. Bypass total del sistema Prisma schema + migrations. Tabla existe en DB pero no en`infra/prisma/schema.prisma`. Schema divergence grave — cualquier re-generación de Prisma Client no incluye esta tabla, tests pueden romperse, CI/CD lint no valida.
**Severidad estimada:** crítico (Edward CP3)
**Acción propuesta:** Migrar `stored_events`tabla a`schema.prisma`+ generar migration. Eliminar`ensureTable()`.

### 2026-04-20 — L-42: `EventStore` referencia `EventSnapshots` table no declarada

**Encontrado durante:** D0v4-2 Batch 3
**Descripción:** `apps/api/src/events/EventStore.ts:291-339` `createSnapshot` + `getSnapshot` usan tabla `"EventSnapshots"` (camelCase con quotes). Esa tabla no existe ni en `ensureTable()` runtime DDL ni en Prisma schema. Cualquier llamada: `relation "EventSnapshots" does not exist`. Path de código inalcanzable/broken.
**Severidad estimada:** crítico (Edward CP3)
**Acción propuesta:** Eliminar snapshot methods + tokens, o crear tabla + migration si feature se activa.

### 2026-04-20 — L-43: `OutboxRelay` sin `SELECT FOR UPDATE SKIP LOCKED` — concurrent claim race

**Encontrado durante:** D0v4-2 Batch 3 (confirma L-22 D0v4-1)
**Descripción:** `apps/api/src/infrastructure/outbox/OutboxRelay.ts:58-66` usa `findMany` sin row-level lock. Si hay múltiples instancias del API (multi-pod), ambas pueden claim el mismo outbox event antes de que una marque `publishedAt` → duplicate dispatch. CLAUDE.md explícitamente dice: "Outbox relay uses `SELECT FOR UPDATE SKIP LOCKED` — no double-dispatch".
**Severidad estimada:** crítico (data consistency)
**Acción propuesta:** Implementar `$queryRaw\`SELECT ... FOR UPDATE SKIP LOCKED LIMIT ${batchSize}\`` + transaction wrap del claim+update.

### 2026-04-20 — L-44: `AnalyticsEventHandler` + `WebhookEventHandler` STUBS NO-OP — webhook system fantasma

**Encontrado durante:** D0v4-2 Batch 3
**Descripción:** 2 handlers de integration events son explícitos no-op:

- `apps/api/src/infrastructure/integration-events/handlers/AnalyticsEventHandler.ts:34` — comentado "Stub: intentional no-op. Future implementation will forward to analytics pipeline". Maneja `PostCreated/PostPublished/PostPublishingFailed` — sin acción.
- `apps/api/src/infrastructure/integration-events/handlers/WebhookEventHandler.ts:41` — idem. Maneja `PostPublished/PostPublishingFailed/PostScheduled/PostCancelled` — sin acción.

**Consecuencia grave**: todo el sistema de webhooks externos está fantasma. Suscriptores registrados en `IntegrationSubscription` (Zapier/Make/custom webhooks) no reciben eventos pese a tener registraciones.

**Severidad estimada:** crítico (Edward CP3 — webhook system subsystem)
**Acción propuesta:** Sprint dedicado de webhook activation. `AnalyticsEventHandler` debería: increment Prometheus counters + forward to analytics event store. `WebhookEventHandler` debería: lookup `IntegrationSubscription` + enqueue delivery job + track status.

### 2026-04-20 — L-45: `EventService.setupDefaultHandlers` 3 no-op handlers

**Encontrado durante:** D0v4-2 Batch 3
**Descripción:** `apps/api/src/events/EventService.ts:379-408` registra 3 handlers default:

- `POST_PUBLISHED` — body vacío con comment "Here you could trigger analytics collection"
- `USER_ACTION` — body vacío con comment "Could integrate with audit logging"
- `SYSTEM_HEALTH` — solo if status unhealthy, pero también empty body

**Severidad estimada:** alto
**Acción propuesta:** Wire análisis real o eliminar registración. Considerar en contexto de L-36 unificación event system.

### 2026-04-20 — L-46: `ComposedEventDispatcher` swallows BullMQ errors silently

**Encontrado durante:** D0v4-2 Batch 3
**Descripción:** `apps/api/src/infrastructure/integration-events/ComposedEventDispatcher.ts:54-57,76-78` catches errors de `publisher.publish()` y `publishBatch()` con comment "Swallow BullMQ errors — do NOT propagate to callers. In production this would write to a structured logger (e.g., pino)". Pero nunca loguea — error loss completo. Double failure mode: (a) eventos no se publican a BullMQ, (b) nadie sabe que no se publicaron.
**Severidad estimada:** alto (ops visibility)
**Acción propuesta:** Wire logger (ya existe `lib/logger.ts`). Agregar metric counter para failed dispatches.

### 2026-04-20 — L-47: CQRS subsystem = PLANNED + CQRSBus shell usado por SagaIntegration

**Encontrado durante:** D0v4-2 Batch 4 (Cierre Final)
**Descripción:** Edward §5.9 decision = PLANNED. CQRS subsystem (611 LOC CQRSIntegration + 421 LOC CQRSBus + 4 command handlers + 4 query handlers = ~2,130 LOC) se mantiene para wire futuro. CQRSIntegration nunca instanciado en producción (solo tests). CQRSBusImpl sí instanciado en index.ts:532 para SagaIntegration pero el bus queda vacío sin handlers (sin CQRSIntegration.initialize, no se registran handlers). SagaIntegration que intenta ejecutar commands/queries vía bus recibirá `No handler registered for command type: X` — posible runtime error en flows saga. Verificar en D0v4-3 (Workers).
**Severidad estimada:** medio (con riesgo runtime para sagas)
**Acción propuesta:** Edward CP4 PLANNED. Sprint futuro de CQRS activation debe: decidir relación con postRoutes.ts + instanciar CQRSIntegration en index.ts + rename `/api/cqrs/*` prefix. MIENTRAS TANTO: auditar D0v4-3 saga flows para confirmar que no ejecutan commands/queries via bus vacío.

### 2026-04-20 — L-48: `lib/errors/errorPlugin.ts` DEAD por no-wired

**Encontrado durante:** D0v4-2 Batch 4
**Descripción:** `apps/api/src/lib/errors/errorPlugin.ts` (33 LOC) declara Fastify plugin wrapping `createErrorHandler`. NUNCA se registra en index.ts — `index.ts:342-343` llama `createErrorHandler` directamente sin usar el plugin.
**Severidad estimada:** bajo
**Acción propuesta:** Wire el plugin (pattern más clean) o eliminar + usar directamente (como ahora).

### 2026-04-20 — L-49: 3 sistemas paralelos de caching

**Encontrado durante:** D0v4-2 Batch 4
**Descripción:** Coexisten 3 sistemas de caching sin coordinación:

- `middleware/autoCacheMiddleware.ts` (355 LOC) — Fastify plugin global onRequest+onSend+onResponse (wired en index.ts:216)
- `lib/cache/cacheDecorators.ts` (421 LOC) — `withCache`/`withInvalidation` HOC decorators
- Module-level `Map` caches en application UCs (D0v4-1 L-13: `GetTopPerformersContextUseCase.ts:53`, `FetchTrendingTopicsUseCase.ts:36`)

Plus: `cacheConfig.ts` + `cacheDecorators.ts` cada uno crea su propio `pino` instance en lugar de usar `cacheLogger` exportado.

**Severidad estimada:** medio
**Acción propuesta:** Consolidar en `CachePort` único + adapter RedisCacheManager. Eliminar module-level caches. Unificar logging.

### 2026-04-20 — L-50: `outboxAdminRoutes` comments `/api/` prefix obsoletos

**Encontrado durante:** D0v4-2 Batch 3
**Descripción:** `apps/api/src/outbox/outboxAdminRoutes.ts` L17, L40, L81 comments dicen `GET /api/admin/outbox/*` pero las URLs reales registradas (L19, L42, L83) NO tienen `/api/` prefix post-D0v4-0 rename. Documentación en código obsoleta.

Plus: `import { prisma } from "@infra/prisma"` L9 — viola fitness #1. `aggregateType: "unknown"` L58 en retry endpoint — loss de info.

**Severidad estimada:** bajo
**Acción propuesta:** Sync comments con URLs reales. Migrar a `container.resolve(TOKENS.PrismaClient)`. Preservar `aggregateType` original en retry.

### 2026-04-20 — L-51: `setInterval` sin `unref()` bloquea graceful shutdown

**Encontrado durante:** D0v4-2 Batch 1+3
**Descripción:** Al menos 5 lugares usan `setInterval` sin `.unref()` — bloquean `process.exit()` tras graceful shutdown hasta que el interval se ejecute:

- `apps/api/src/index.ts:630` (DLQ archival 24h)
- `apps/api/src/index.ts:644` (data retention 24h)
- `apps/api/src/security/auditLogger.ts:64` (log cleanup 24h)
- `apps/api/src/security/slidingWindowRateLimit.ts:81` (suspicious patterns 1h)
- `apps/api/src/security/enhancedValidator.ts:119` (suspicious attempts 1h)

**Severidad estimada:** medio (ops)
**Acción propuesta:** Agregar `.unref()` a todos. Contraste: `OutboxRelay` + `OutboxCleaner` + `RedisEventPublisher.healthCheck` SÍ usan `.unref()` — patrón existe pero no uniforme.
