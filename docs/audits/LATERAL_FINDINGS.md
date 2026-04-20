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

---

## Hallazgos D0v4-3 (2026-04-20)

### 2026-04-20 — L-52: `publishHandler.handleJob` silent failure (catch-all sin re-throw)

**Encontrado durante:** D0v4-3 Batch 1
**Descripción:** [apps/workers/src/publishHandler.ts:606-627](apps/workers/src/publishHandler.ts#L606-L627) `handleJob` envuelve el cuerpo en `try { ... } catch (error) { logger.error(...); notifyFailure(...); return; }` sin re-throw. BullMQ interpreta el retorno como éxito → **job nunca es marcado como failed, no reintentado, y removido de la queue**.

Combinado con L-53 (no retry policy explícita) → jobs con fallos transitorios de provider API son silenciosamente perdidos. El usuario ve "publicación confirmada" en UI pero el post nunca llega a Twitter/Instagram/etc.

Compuesto con L-64 (saga fake job status) → double blind: worker reports "success", saga asks job status → stub returns "success". Ninguna capa detecta la pérdida.

**Severidad estimada:** crítico
**Decisión Edward (Cierre D0v4-3):** LATERAL_FINDINGS + crítico.
**Acción propuesta:** Re-throw tras logging + notifyFailure. Permite a BullMQ retry (requiere también fix L-53 attempts explícitos). Alternativa: llamar `job.moveToFailed()` explícito.

---

### 2026-04-20 — L-53: 4/6 workers sin retry policy explícita

**Encontrado durante:** D0v4-3 Batch 1+2
**Descripción:** Tabla consolidada:

| Worker                       | attempts                      | backoff                | Gold standard?                 |
| ---------------------------- | ----------------------------- | ---------------------- | ------------------------------ |
| `publishWorker`              | ❌ BullMQ default (0 retries) | ❌                     | No                             |
| `autoRenewalWorker`          | ❌ default                    | ❌                     | No (cron 1x/día atenúa riesgo) |
| `analyticsIngestWorker`      | ❌ default                    | ❌                     | No                             |
| `inboxSyncWorker`            | ❌ default                    | ❌                     | No                             |
| `webhookJobProcessor` (main) | ✅ 3                          | ✅ exponential 5000ms  | ✅                             |
| `GatewaySwitchJobService`    | ✅ 3                          | ✅ exponential 30000ms | ✅                             |

4 de 6 workers dependen del default BullMQ (**0 retries**). Transient errors de provider = job perdido.

**Severidad estimada:** alto
**Acción propuesta:** Standardize `{ attempts: 3, backoff: { type: 'exponential', delay: 5000 } }` en los 4 workers faltantes. Adjust `delay` para jobs largos (analytics = 30000ms).

---

### 2026-04-20 — L-54: 3/4 workers dedicated sin graceful shutdown

**Encontrado durante:** D0v4-3 Batch 1
**Descripción:** Solo `autoRenewalWorker.ts:159` registra SIGTERM con `worker.close()` + `queue.close()` + Redis disconnect + `prisma.$disconnect()`.

`publishWorker.ts`, `analyticsIngestWorker.ts`, `inboxSyncWorker.ts` NO tienen SIGTERM handler. Durante deploy:

- `publishWorker` in-flight job → publicación parcial a platform social visible al usuario.
- `analyticsIngestWorker` in-flight → metrics ingest incompleto.
- `inboxSyncWorker` in-flight → conversación mid-sync.

Pattern existe (autoRenewalWorker es referencia) pero no replicado.

**Severidad estimada:** alto (ops)
**Acción propuesta:** Extraer `workerShutdownHandler(worker, queue, redis, prisma)` helper. Replicar en los 3 workers faltantes.

---

### 2026-04-20 — L-55: `inboxSyncWorker` bypassa `IngestSocialMessageUseCase` + domain layer

**Encontrado durante:** D0v4-3 Batch 1
**Descripción:** [apps/workers/src/inboxSyncWorker.ts:101-134](apps/workers/src/inboxSyncWorker.ts#L101-L134) reimplementa logica de dedup + create directamente sobre `prisma.socialMessage`:

- L101: `findFirst({ where: { providerMessageId, provider } })`
- L115-134: `prisma.socialMessage.create(...)` directo

D0v4-1 auditó `IngestSocialMessageUseCase` completo con:

- `SocialMessageAggregate.create` + invariants
- `findOrCreateByRoot` conversation linking
- `eventDispatcher.dispatchAll` domain events (trigger triage AI + notifications)

Worker **bypass completo del domain layer** → AI triage + downstream handlers **nunca ejecutan** para comments ingested vía sync. Drift entre webhook path (usa UC) y sync path (bypass). Usuarios ven comments sin triage label ni notifications.

**Severidad estimada:** alto (unificación candidate)
**Acción propuesta:** Refactor worker para invocar `IngestSocialMessageUseCase`. Inyectar via DI similar a `webhookJobProcessor`. Requiere workers compartir container con API (L-65 dependency).

---

### 2026-04-20 — L-56: `analyticsIngest` + `inboxSync` silent AUTH errors

**Encontrado durante:** D0v4-3 Batch 1
**Descripción:**

- [apps/workers/src/analyticsIngestWorker.ts:82-85](apps/workers/src/analyticsIngestWorker.ts#L82-L85): si `channel.credentials` es null/invalid → `logger.warn + return` (skip silently).
- [apps/workers/src/inboxSyncWorker.ts:90-94](apps/workers/src/inboxSyncWorker.ts#L90-L94): patrón idéntico.

Token expirado o revoked → worker skipeando cada 6h (analytics) o 30m (inbox). Usuario **NO es notificado que necesita re-autorizar el canal**. Métricas + comments silently empty.

**Severidad estimada:** medio
**Acción propuesta:** Emit domain event `ChannelAuthFailed` → notification handler → email/in-app al usuario. Alternativa: mark channel `status = 'AUTH_REVOKED'` y bloquear scheduling en UI.

---

### 2026-04-20 — L-57: `publishHandler.ts` God handler 629 LOC

**Encontrado durante:** D0v4-3 Batch 1
**Descripción:** Archivo único mezcla:

- `publishSinglePost` (L105-261, ~157 LOC) — provider switch + DB write
- `publishThreadPost` (L263-514, ~252 LOC) — thread management + batch
- `handleJob` (L516-628, ~113 LOC) — orchestration + idempotency + saga notification + instrumentation

Single Responsibility violado. Difícil testear unitariamente. publishThreadPost 252 LOC es mega-method.

**Severidad estimada:** medio (mantenibilidad)
**Acción propuesta:** Split a `PublishOrchestrator` (handleJob) + `SinglePostPublisher` + `ThreadPostPublisher` + `SagaNotifier` + `PublishMetrics`. Cada clase single concern. Tests granulares.

---

### 2026-04-20 — L-58: High cardinality Prometheus labels (`channel_id`)

**Encontrado durante:** D0v4-3 Batch 1
**Descripción:** [apps/workers/src/metrics/workerMetrics.ts](apps/workers/src/metrics/workerMetrics.ts) define ~35 métricas. Varios counters/histograms usan `channel_id` como label → cardinality explode. En multi-tenant con N accounts × M channels → Prometheus memory + query performance degradation.

Best practice: `channel_id` como label solo en debugging gauges; en counters/histograms agregar por `platform` + `account_id`.

**Severidad estimada:** medio (ops cost)
**Acción propuesta:** Auditar label usage por métrica. Substituir `channel_id` → `platform` + categoría donde aplique.

---

### 2026-04-20 — L-59: `telemetry/initialization.ts:61-63` 3 `any` types exportados

**Encontrado durante:** D0v4-3 Batch 1
**Descripción:** [apps/workers/src/telemetry/initialization.ts:61-63](apps/workers/src/telemetry/initialization.ts#L61-L63):

```ts
export const tracer: any = ...
export const meter: any = ...
export const metrics: any = ...
```

Viola fitness function #3 (no `any` en infrastructure). Mock fallback ok, pero types reales (OpenTelemetry) disponibles.

**Severidad estimada:** bajo (type safety)
**Acción propuesta:** Tipar con `Tracer | MockTracer` + `Meter | MockMeter` explícitos.

---

### 2026-04-20 — L-60: Provider registry drift — 11 vs 10 providers en workers

**Encontrado durante:** D0v4-3 Batch 1
**Descripción:**

- `publishWorker.ts` registra **11** providers (x, instagram, facebook, youtube, tiktok, snapchat, telegram, pinterest, linkedin, bluesky, threads)
- `analyticsIngestWorker.ts` + `inboxSyncWorker.ts` registran **10** (missing `threads`)

Además `apps/api/src/providers/providerRegistry.ts` (D0v4-1 L-14) es el canónico en API → **3 copias del registro de providers** en el monorepo con drift.

Threads posts publican OK pero `analyticsIngestWorker` silently skip analytics + `inboxSyncWorker` silently skip comments.

**Severidad estimada:** bajo (consistency bug)
**Acción propuesta:** Extraer `packages/providers/src/providerRegistry.ts` shared. Workers + API importan del mismo source. Elimina drift.

---

### 2026-04-20 — L-61: **`QueuePort` adapter hardcoded PUBLISH queue → 3 dispatchers misroute jobs**

**Encontrado durante:** D0v4-3 Batch 2
**Descripción:** [packages/adapters/queue-bullmq/src/index.ts:51](packages/adapters/queue-bullmq/src/index.ts#L51):

```ts
const bullJob = await queue.add(QUEUE_NAMES.PUBLISH, job.payload, opts);
```

`createBullMQQueueAdapter` retorna una instancia que enqueue **siempre a `PUBLISH`** ignorando `job.queueName` del payload. Consumer adapter `createBullMQConsumerAdapter` es simétrico: hardcoded PUBLISH.

Dispatchers afectados (3 confirmed, via shared QueuePort):

1. `DispatchAnalyticsIngestionUseCase` — declara queue `ANALYTICS_AGGREGATION`, termina en `PUBLISH`.
2. `DispatchInboxSyncUseCase` — declara `INBOX_SYNC`, termina en `PUBLISH`.
3. `BullMQRepurposeJobDispatcher` — declara `GENERATE_REPURPOSE`, termina en `PUBLISH`.

Resultado:

- `publishWorker` recibe jobs alien payload shape. handleJob filtra por `payload.postId` existence → silently drops (L-52 composición).
- `analyticsIngestWorker` + `inboxSyncWorker` esperan jobs en sus queues dedicadas → reciben 0.
- `GENERATE_REPURPOSE` no tiene worker → doble fallo.

**Severidad estimada:** crítico
**Decisión Edward (Cierre D0v4-3):** LATERAL_FINDINGS + crítico.
**Acción propuesta:** Refactor adapter para leer queue del payload: `const bullJob = await queue.add(job.queueName ?? QUEUE_NAMES.PUBLISH, job.payload, opts)`. Por defecto PUBLISH para retrocompat, pero permitir override. Consumer adapter similar. Añadir fitness function que verifique que queue name del payload existe en QUEUE_NAMES.

---

### 2026-04-20 — L-62: `GATEWAY_SWITCH` queue publisher activo pero consumer missing

**Encontrado durante:** D0v4-3 Batch 2
**Descripción:** [apps/api/src/billing/GatewaySwitchJobService.ts](apps/api/src/billing/GatewaySwitchJobService.ts):

- L47: enqueue reminder 24h delayed `{ jobId: 'gateway-switch-reminder-{accountId}' }`
- L56: enqueue suspend 48h delayed `{ jobId: 'gateway-switch-suspend-{accountId}' }`
- Gold standard retry `{ attempts: 3, backoff: exponential 30000ms }` + jobId determinístico.

**NINGÚN worker declara consumo de `GATEWAY_SWITCH`.** `grep "GATEWAY_SWITCH" apps/workers/src/` = 0. grep en API = 0 (solo publisher).

Billing flow escalation flow roto: jobs se acumulan en Redis sin consumer, delayed 48h, nunca procesados. Usuario que debería ser suspendido por fallo de gateway queda activo.

**Severidad estimada:** crítico (compliance + billing)
**Decisión Edward (Cierre D0v4-3):** LATERAL_FINDINGS + crítico.
**Acción propuesta:** Crear `apps/workers/src/gatewaySwitchWorker.ts` o inline handler en API. UC `ProcessGatewaySwitchReminderUseCase` + `ProcessGatewaySwitchSuspendUseCase` (D0v4-1 los tiene auditados).

---

### 2026-04-20 — L-63: `SagaIntegration:112-114` ejecuta commands via CQRSBus vacío (escalado L-47)

**Encontrado durante:** D0v4-3 Batch 2
**Descripción:** [apps/api/src/saga/SagaIntegration.ts:112-114](apps/api/src/saga/SagaIntegration.ts#L112-L114):

```ts
async (command: Command) => {
  return await this.config.cqrsBus.executeCommand(command);
};
```

Registra command executor en `createPostPublishingSagaDefinition` (imported de `@shared/saga`). `cqrsBus` es `CQRSBusImpl` — D0v4-2 L-47 confirmó que **handler registry está vacío**.

Si saga step invoca command → `No handler registered for command type: X` runtime error. Si saga step solo enqueue jobs (probable mayoría) → no runtime. Dependencia de qué hace `@shared/saga` (out-of-scope D0v4-3, D0v4-7 scope).

D0v4-2 L-47 severidad: medio (runtime risk condicional). Ahora confirmado **callsite real** — escalado a crítico por Edward.

**Severidad estimada:** crítico
**Decisión Edward (Cierre D0v4-3):** LATERAL_FINDINGS + crítico.
**Acción propuesta (orden):**

1. Leer `@shared/saga/createPostPublishingSagaDefinition` (pre-D0v4-7) para confirmar si invoca commands.
2. Si SÍ: wire handlers al CQRSBusImpl **antes** de siguiente deploy, o remover bus injection (usar enqueue directo).
3. Si NO: mantener pero documentar que bus está shell.

---

### 2026-04-20 — L-64: `SagaIntegration:143-152` job status checker STUB fake optimistic

**Encontrado durante:** D0v4-3 Batch 2
**Descripción:** [apps/api/src/saga/SagaIntegration.ts:143-152](apps/api/src/saga/SagaIntegration.ts#L143-L152) provee `jobStatusChecker` al saga manager:

```ts
async getJobStatuses(jobIds: string[]) {
  return { completed: jobIds.length, failed: 0, pending: 0 };
}
```

**Siempre retorna optimistic success.** No consulta BullMQ. Saga flow que depende de "wait all jobs complete" step → saga completa prematuramente, ignorando failures reales.

Compuesto con L-52 (worker silent success) → double blind:

- Worker catch-all → job "success" en BullMQ.
- Saga asks status → stub retorna success.
- Saga emite `SagaCompleted` → UI muestra "post publicado OK".
- Realidad: post nunca llegó a Twitter.

**Severidad estimada:** crítico
**Decisión Edward (Cierre D0v4-3):** LATERAL_FINDINGS + crítico.
**Acción propuesta:** Implementar real job status checker consultando BullMQ `queue.getJob(jobId).getState()`. Map a `completed | failed | waiting | active` del saga domain. Test con job failure injection.

---

### 2026-04-20 — L-65: 3 ubicaciones de workers BullMQ en el monorepo

**Encontrado durante:** D0v4-3 Batch 2
**Descripción:**

1. `apps/workers/src/` — 4 workers dedicated (publish, autoRenewal, analyticsIngest, inboxSync)
2. `apps/api/src/webhooks/webhookJobProcessor.ts` — inline worker en proceso API (WEBHOOK_PROCESSING + WEBHOOK_DEAD_LETTER)
3. `apps/api/src/infrastructure/integration-events/IntegrationEventConsumer` instanciado inline en `apps/api/src/index.ts:531+` (INTEGRATION_EVENTS)

Complejidad operacional:

- ¿Qué worker corre en qué proceso? Depende del deploy config.
- DI no compartido → cada worker bootstrap su propio singletons (L-60 contribuye).
- Lifecycle + graceful shutdown inconsistentes (L-54).
- Observability disperso: prometheus endpoint :9100 en apps/workers, inline en API.

**Severidad estimada:** medio (ops + mantenibilidad)
**Acción propuesta:** ADR sobre worker deployment topology. Opción 1: todos en `apps/workers/` (mover webhookJobProcessor + IntegrationEventConsumer). Opción 2: documentar explícitamente por qué híbrido (algunos necesitan acceso sincrónico al API context).

---

### 2026-04-20 — L-66: 5 queues PLANNED — workers missing (Edward CP4)

**Encontrado durante:** D0v4-3 Batch 2
**Descripción:** De las 16 queues en `QUEUE_NAMES`, 5 sin consumer detectable + sin publisher confirmado vía BullMQ directo:

| Queue               | UC publisher D0v4-1 (si existe)                                            | Worker     |
| ------------------- | -------------------------------------------------------------------------- | ---------- |
| `REPORT_GENERATION` | `GenerateReportUseCase` NO usa queue directo                               | ❌ missing |
| `RECURRING_POSTS`   | `ProcessRecurrenceUseCase` NO usa queue directo                            | ❌ missing |
| `DETECT_REPURPOSE`  | Publisher unconfirmed                                                      | ❌ missing |
| `TRIAGE_INBOX`      | `TriageInboxMessageUseCase` invocado via InboxEventHandlers (event-driven) | ❌ missing |
| `TREND_RADAR`       | Publisher unconfirmed                                                      | ❌ missing |

Queues declaradas en registry pero no wired. Edward decidió CP4: PLANNED, no DEAD_CODE. Sprint futuro cierra el wire-up.

**Severidad estimada:** medio (consolidado Edward CP4)
**Acción propuesta:** Documentar en `docs/architecture/` cada queue PLANNED + fecha target de wire-up. Si >6 meses sin wire → re-evaluar como DEAD_CODE_CANDIDATE.

---

### 2026-04-20 — L-67: `DEAD_LETTER_QUEUE` + `FAILED_OPERATIONS_DLQ` sin publisher ni consumer detectable

**Encontrado durante:** D0v4-3 Batch 2
**Descripción:** Declaradas en [packages/adapters/queue-bullmq/src/constants.ts](packages/adapters/queue-bullmq/src/constants.ts) pero:

- `grep "DEAD_LETTER_QUEUE\|FAILED_OPERATIONS_DLQ" apps/ packages/` → solo referenced en el constants file.
- `WEBHOOK_DEAD_LETTER` (diferente) sí tiene publisher + consumer en `webhookJobProcessor`.

Sospecha: constants legacy de un intento previo de DLQ unificado que fue superseded por `WEBHOOK_DEAD_LETTER` específico. O planned feature nunca wired.

**Severidad estimada:** bajo (pending research CP1)
**Acción propuesta:** Research intent original (git blame + historia). Si legacy → DEAD_CODE_CANDIDATE tras validación Edward. Si planned → clasificar como L-66.

---

## Hallazgos D0v4-4 (2026-04-20)

### Críticos (L-68..L-87)

### 2026-04-20 — L-68: Publishing subsystem DEAD_CODE (~2,711 LOC, 6 archivos huérfanos)

**Encontrado durante:** D0v4-4 Batch 2+3
**Descripción:** `components/publishing/UnifiedPublishingDashboard.tsx` (620 LOC) + su API helper + 4 componentes editor/ que solo lo consumen a él — subsistema completo NO importado por ningún page. Grep confirma: `UnifiedPublishingDashboard` solo aparece en su propio archivo + docs.

Archivos:

- `components/publishing/UnifiedPublishingDashboard.tsx` (620 LOC)
- `components/publishing/publishingDashboardApi.ts` (306 LOC)
- `components/editor/AdminContentEditor.tsx` (360 LOC) — naming mismatch (Admin en client app)
- `components/editor/ContentPreviewSystem.tsx` (604 LOC)
- `components/editor/ProviderAdaptationEngine.tsx` (494 LOC)
- `components/editor/provider-previews.tsx` (327 LOC)

La publishing experience real del cliente pasa por `PublishDialog` + `PublishingInterface` + `PlatformPreview` (otros componentes).

**Severidad estimada:** crítico (candidato unificación/cleanup)
**Acción propuesta:** Edward valida §5.9 → DELETE + unificar con PublishDialog flow o re-wire como entry point unificado.

---

### 2026-04-20 — L-69: Dual auth path — Server Action vs Proxy route con TTLs cookie inconsistentes

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** `app/actions/auth.ts` (Server Action login/register) y `app/api/backend/[...path]/route.ts` (proxy login/register handling) setean **la misma cookie** `customer-session` con TTLs distintos:

| Path          | TTL session          | Refresh cookie            |
| ------------- | -------------------- | ------------------------- |
| Server Action | 24h-30d (rememberMe) | ❌ no setea               |
| Proxy route   | 15 min fijo          | ✅ 7 días separate cookie |

**Problema runtime**: usuario que loguea vía form (Server Action) obtiene session 24h pero **sin refresh cookie**. Cuando proxy intenta renovar token tras 15 min de uso, `injectRefreshToken` no encuentra cookie → backend rechaza → usuario logged out inesperadamente.

**Severidad estimada:** crítico (security + UX breaking)
**Acción propuesta:** Unificar auth flow. Opción 1: Server Action llama al proxy `/api/backend/auth/customer/login`. Opción 2: Server Action setea ambas cookies con TTLs alineados.

---

### 2026-04-20 — L-70: `app/providers.tsx` missing QueryCache + MutationCache global error handlers

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/providers.tsx:14-26](apps/client/app/providers.tsx#L14-L26) configura QueryClient sin `QueryCache({ onError })` ni `MutationCache({ onError })` globales. FRONTEND_STANDARDS §2.4 explicitly requires both for consistent global error handling.

Cada hook debe implementar su propio error handling → patrones inconsistentes en todo el app (4+ UX feedback patterns en §10.1).

**Severidad estimada:** crítico (arquitectura)
**Acción propuesta:** Agregar `QueryCache({ onError: (error) => toast.error(...) })` + `MutationCache({ onError })` al QueryClient config. Replace redundant per-hook error handling.

---

### 2026-04-20 — L-71: SILENT-NO-OP billing gateway switch (confirma L-62)

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/dashboard/settings/billing/page.tsx:332-405](apps/client/app/dashboard/settings/billing/page.tsx#L332-L405) renderiza `GatewaySection` con 3 estados (GatewaySelector, ActiveGatewayBanner, PendingSwitchBanner). Mutations `useInitiateGatewaySwitch` + `useCancelGatewaySwitch` encolan jobs a queue `GATEWAY_SWITCH`.

Queue sin consumer (D0v4-3 L-62). UI muestra "Switch scheduled: your subscription moves to [Paddle] on [date]" pero el switch nunca ocurre. Reminder 24h + suspend 48h no disparan.

**Severidad estimada:** crítico (compliance + billing)
**Acción propuesta:** Fix L-62 backend primero. UI queda correcta.

---

### 2026-04-20 — L-72: SILENT-NO-OP publish/schedule UI (confirma L-52 compound)

**Encontrado durante:** D0v4-4 Batch 1+3
**Descripción:** 4 niveles superpuestos de mentira al usuario:

1. Backend L-52 (publishHandler silent failure).
2. Backend L-64 (saga fake status optimistic).
3. `posts/[id]/page.tsx:68` + `posts/[id]/preview/page.tsx:41`: `await apiClient.publishPost(postId); alert("Post published successfully!")` sin verificar resultado.
4. `PublishingInterface.tsx:138-236`: for-loop con `info({description:"Successfully published to..."})` por provider.

UX irrecuperable sin fix coordinado en toda la pila.

**Severidad estimada:** crítico (compound)
**Acción propuesta:** Fix L-52 + L-64 backend + UI debe verificar job status real post-publish (polling + retry).

---

### 2026-04-20 — L-73: SILENT-NO-OP analytics (confirma L-61 + empty params)

**Encontrado durante:** D0v4-4 Batch 1+3
**Descripción:** `app/dashboard/analytics/page.tsx` usa `useAnalytics(projectId, timeRange)` correctamente. `app/dashboard/analytics/insights/page.tsx:22-25` pasa `accountId=""` + `projectId=""` HARDCODED empty → `PerformanceInsights` consume vía `usePerformanceInsights("")` → endpoint call con projectId vacío → probable 400 o empty response.

Compuesto con L-61: si dispatcher de analytics intenta agregar datos, jobs van a queue equivocada. UI muestra "No performance data yet".

**Severidad estimada:** crítico
**Acción propuesta:** Fix insights page params (accountId/projectId del auth context). Fix L-61 backend.

---

### 2026-04-20 — L-74: SILENT-NO-OP inbox (confirma L-55+L-61)

**Encontrado durante:** D0v4-4 Batch 3
**Descripción:** 8 componentes inbox (InboxLayout, ConversationCard, ConversationHeader, ConversationList, ConversationThread, InboxSidebar, MessageBubble, ReplyComposer) usan `hooks/api/useInbox` canónico correctamente. UI **bien arquitectada**.

Pero backend L-55 (inboxSyncWorker bypass domain layer) + L-61 (INBOX_SYNC misroute a PUBLISH queue) → comments sincronizados vía worker NO llegan al user.

**Severidad estimada:** crítico
**Acción propuesta:** Fix L-55 + L-61 backend. UI queda correcta.

---

### 2026-04-20 — L-75: SILENT-NO-OP repurpose (confirma L-61 GENERATE_REPURPOSE)

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** `app/dashboard/ai/repurpose/page.tsx` usa raw `fetch("/api/backend/repurpose/proposals")` + `/approvals/:id/:action`. Approve action dispatch jobs via `BullMQRepurposeJobDispatcher` que misroute a PUBLISH queue (L-61). Jobs nunca procesados.

UI: `alert()` on error pattern + raw fetch.

**Severidad estimada:** crítico
**Acción propuesta:** Fix L-61 backend + migrar raw fetch a TanStack hook.

---

### 2026-04-20 — L-76: SILENT-NO-OP outgoing webhooks (confirma L-44)

**Encontrado durante:** D0v4-4 Batch 3
**Descripción:** `components/settings/ExternalNotificationConfigs.tsx` + `AddWebhookForm.tsx` permiten agregar webhooks Slack/Teams. UI muestra "Webhook added successfully" + "X event(s)" activos.

Backend L-44: `AnalyticsEventHandler` + `WebhookEventHandler` no-op → **webhooks jamás reciben eventos**. Billing-differentiator feature completamente no funcional.

**Severidad estimada:** crítico (compliance + feature diff)
**Acción propuesta:** Fix L-44 backend. Handlers deben enviar POST a webhook URL del config.

---

### 2026-04-20 — L-77: `useContentLibraryState` stub — ContentLibrary page always empty

**Encontrado durante:** D0v4-4 Batch 4
**Descripción:** [components/content/library/useContentLibraryState.ts:100-115](apps/client/components/content/library/useContentLibraryState.ts#L100-L115):

```ts
const loadContentItems = useCallback(async () => {
  setIsLoading(true);
  try {
    const emptyItems: ContentItem[] = [];
    setContentItems(emptyItems);
    ...
```

Comment explicit: "Initial load returns empty; the useContentLibrary API hook should be wired in by the parent component". **Hook NO fetch data**.

Consecuencia: `app/dashboard/content/library/page.tsx` → `ContentLibrary` → siempre muestra `EmptyState`. Usuario no puede ver posts en library.

Plus `DEFAULT_FILTER_OPTIONS` L20-25: 5 platforms, 5 categories, 6 tags hardcoded → filter panel UI muestra fake options.

**Severidad estimada:** crítico (feature breaking)
**Acción propuesta:** Wire real API fetch via useQuery. Remove hardcoded DEFAULT_FILTER_OPTIONS or derive from real data.

---

### 2026-04-20 — L-78: Fake-AI — SchedulePicker "optimal times" hardcoded heuristics

**Encontrado durante:** D0v4-4 Batch 2
**Descripción:** [editor/SchedulePicker.tsx:49-110](apps/client/components/editor/SchedulePicker.tsx#L49-L110) `getOptimalTimes()` retorna tiempos HARDCODED:

```ts
optimalTimes.push(
  { hour: 9, minute: 0, score: 85, reason: "High engagement during morning commute" },
  { hour: 12, minute: 0, score: 90, reason: "Peak lunch break activity" },
  ...
);
```

UI L271 label: **"Based on historical engagement data for your selected platforms"** — FALSO. Scores (85%, 90%, 92%) son inventados. **UI miente al usuario sobre datos**.

**Severidad estimada:** crítico (engañoso)
**Acción propuesta:** Remove label "historical engagement data" O conectar a backend real (`hooks/api/useOptimalTimes` style). Si no hay data real, no mostrar ratings.

---

### 2026-04-20 — L-79: Fake-AI — `generateRecommendations` hardcoded impact labels "AI"

**Encontrado durante:** D0v4-4 Batch 3
**Descripción:** [components/analytics/insights/utils.ts:22-165](apps/client/components/analytics/insights/utils.ts#L22-L165) `generateRecommendations()` es pure if/else rule-based con mensajes hardcoded:

- `"20-30% improvement in engagement"` (L68)
- `"15-25% increase in discoverability"` (L94)
- `"Sustain or increase current growth rate"` (L116)
- Priority/confidence hardcoded: `"high"`, `confidence: 0.85`, `0.82`, `0.75`, `0.68`.

UI render `🎯 AI Recommendations` (RecommendationsList.tsx:46) + PerformanceInsightsHeader.tsx:33 "AI-driven recommendations". **Usuario cree que hay modelo ML, pero es plantilla estática**.

**Severidad estimada:** crítico (engañoso)
**Acción propuesta:** Renombrar UI label "AI Recommendations" → "Smart Recommendations" (honesto) O conectar a backend ML real.

---

### 2026-04-20 — L-80: Fake-AI — SmartContentOptimizer hashtag scoring fabricated by index

**Encontrado durante:** D0v4-4 Batch 4
**Descripción:** [ai/SmartContentOptimizer.tsx:132-139](apps/client/components/ai/SmartContentOptimizer.tsx#L132-L139):

```ts
relevanceScore: Math.max(10, 90 - i * 10),
popularityIndex: Math.max(10, 80 - i * 8),
competitionLevel: (i < 2 ? "low" : i < 4 ? "medium" : "high"),
trendingStatus: (i < 2 ? "rising" : "stable"),
expectedReach: Math.max(1000, 50000 - i * 8000),
```

Cuando API retorna hashtags pero no scores, UI **fabrica scoring basado en índice de array**. `SmartContentOptimizerHashtags.tsx` muestra "90% relevance", "80/10 popularity", "low competition" como datos reales.

**Severidad estimada:** crítico (engañoso)
**Acción propuesta:** Si API no provee scores, UI no debe mostrar porcentajes. Remove fabricated scoring.

---

### 2026-04-20 — L-81: Fake-AI — ai-content-templates estimatedEngagement hardcoded %

**Encontrado durante:** D0v4-4 Batch 4
**Descripción:** [components/ai/ai-content-templates.ts](apps/client/components/ai/ai-content-templates.ts) define 6 templates con `estimatedEngagement: 85/78/82/76/88/91` hardcoded.

[ai/AITemplateSelector.tsx:83-85](apps/client/components/ai/AITemplateSelector.tsx#L83-L85) renderiza `{template.estimatedEngagement}% engagement` con green TrendingUp icon como si fuera real projection.

**Severidad estimada:** crítico (engañoso)
**Acción propuesta:** Remove estimatedEngagement field o vincular a métricas reales de uso del template.

---

### 2026-04-20 — L-82: Fake-AI — usePredictiveData hardcoded fallbacks

**Encontrado durante:** D0v4-4 Batch 4
**Descripción:** [ai/analytics/hooks/usePredictiveData.ts:248-354](apps/client/components/ai/analytics/hooks/usePredictiveData.ts#L248-L354) retorna hardcoded fake data cuando API retorna null:

- L248-269: factor names "Content Reach" 35%, "Platform Activity" 25%, etc.
- L307-318: demographics "25-44", "Global", "9 AM - 6 PM"
- L319: engagement triggers inventados "Questions, Polls, Behind-the-scenes"
- L333-354: "General Audience" fallback con todo inventado

UI no distingue real vs fallback — muestra los fake datos como si fueran del API.

**Severidad estimada:** crítico (engañoso + silent fallback)
**Acción propuesta:** Remove fake fallbacks. Return empty states con indicación clara al usuario.

---

### 2026-04-20 — L-83: Fake-AI — AIContentGenerator "Powered by GPT-4" hardcoded

**Encontrado durante:** D0v4-4 Batch 4
**Descripción:** [ai/AIContentGenerator.tsx:99](apps/client/components/ai/AIContentGenerator.tsx#L99): `<span className="text-sm text-gray-600">Powered by GPT-4</span>`.

Usuario BYOK puede configurar Anthropic/Claude/Gemini en `settings/ai/page.tsx`. UI **siempre** dice GPT-4 — engañoso.

**Severidad estimada:** crítico (engañoso + BYOK mismatch)
**Acción propuesta:** Fetch current provider de `useAiStatus()` hook y display dinámico.

---

### 2026-04-20 — L-84: Notifications bell + item target `/admin/*` en client app

**Encontrado durante:** D0v4-4 Batch 2
**Descripción:** [components/notifications/NotificationBell.tsx:226](apps/client/components/notifications/NotificationBell.tsx#L226): `<Link href="/admin/settings/notifications">` y [NotificationItem.tsx getTarget()](apps/client/components/notifications/NotificationItem.tsx#L33-L43) retorna:

```ts
case "APPROVAL_REQUESTED":  return "/admin/approvals";
case "POST_APPROVED":       return postId ? `/admin/posts/${postId}` : "/admin/posts";
default:                    return "/admin";
```

**Componentes consumidos en apps/client** (via dashboard layout) **pero todos los links apuntan a /admin/\***. Copy-paste desde admin sin adaptar navegación. Usuario client al hacer click sale del app o ve 404.

**Severidad estimada:** crítico (UX breaking)
**Acción propuesta:** Adaptar getTarget() para client routes (`/dashboard/approvals`, `/dashboard/posts/${postId}`, etc.). Similar para bell footer link.

---

### 2026-04-20 — L-85: ClientContentEditor handleSchedule stub — UI success sin backend

**Encontrado durante:** D0v4-4 Batch 2
**Descripción:** [editor/ClientContentEditor.tsx:174-182](apps/client/components/editor/ClientContentEditor.tsx#L174-L182):

```ts
const handleSchedule = useCallback(
  async (scheduledAt: Date, _timezone?: string) => {
    if (selectedProviders.length === 0) { ... return; }
    // Scheduling API integration pending — show confirmation for now
    success({ title: "Post Scheduled!", ... });
    clearDraft();
  },
  ...
);
```

**UI muestra "Post Scheduled!" sin llamar ningún endpoint backend**. Usuario piensa que programó un post, pero NO SE PROGRAMÓ NADA.

**Severidad estimada:** crítico (silent failure L-52 tipo client-side)
**Acción propuesta:** Wire `useSchedulePost` mutation from `hooks/api/usePosts` (o similar).

---

### 2026-04-20 — L-86: 3 `useProviders` hooks paralelos (confirmación + new evidence D0v4-4)

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** Ya documentado en LATERAL_FINDINGS 2026-04-17. D0v4-4 encuentra que las 3 variantes son consumidas activamente en el mismo sprint:

- `@/hooks/api/useChannels.useProviders` — `channels/page.tsx:9`
- `@/lib/hooks/useProviders` (LEGACY) — `posts/[id]/preview/page.tsx:14`, `ClientContentEditor.tsx:15`
- `@/lib/api/hooks.useProviders` re-export (LEGACY) — `posts/new/page.tsx:5`, `posts/[id]/page.tsx:5`

**5 pages/components con 3 hooks diferentes pero mismo propósito**.

**Severidad estimada:** crítico (confusion, bugs, maintenance)
**Acción propuesta:** Migration plan documentado. Consolidar en `@/hooks/api/useChannels.useProviders`. D0v4-5 scope.

---

### 2026-04-20 — L-87: Instagram stories page 4 callbacks `alert("Coming soon")` — DEAD UI

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/dashboard/instagram/stories/page.tsx:22-34](apps/client/app/dashboard/instagram/stories/page.tsx#L22-L34):

```ts
onSave={() => { alert("Coming soon"); }}
onSchedule={() => { alert("Coming soon"); }}
onPublish={() => { alert("Coming soon"); }}
onError={(_error) => { alert("Coming soon"); }}
```

StoriesEditor completa UI (15 files, ~2,100 LOC) renderiza botones Save/Schedule/Publish que no hacen nada. **El componente StoriesEditor es cuasi-DEAD_CODE** ya que sus callbacks están stub.

**Severidad estimada:** crítico (feature completa dead)
**Acción propuesta:** Wire callbacks a backend (save draft, schedule, publish) O hide/disable StoriesEditor hasta implementación.

---

### Altos (L-88..L-104)

### 2026-04-20 — L-88: `(user as Record<unknown>).accountId` type hack repetido 8+ veces

**Encontrado durante:** D0v4-4 Batch 1+B3
**Descripción:** Patrón `const accountId = ((user as Record<string, unknown> | null)?.accountId as string) ?? "";` aparece en:

- `tasks/page.tsx:25`
- `campaigns/page.tsx:27`
- `settings/ai/page.tsx` (via ProviderCard)
- `settings/sso/page.tsx:15`
- `settings/team/page.tsx:22`
- `settings/usage/page.tsx:53`
- `settings/referral/page.tsx:24`
- `ai/repurpose/page.tsx:33`
- `ai/trends/page.tsx:36`

AuthContext.user type NO expone `accountId` correctamente. Cada consumer hace el mismo cast inseguro. Si auth shape cambia → bugs silenciosos.

**Severidad estimada:** alto (type safety + maintenance)
**Acción propuesta:** Fix AuthContext para exponer `user.accountId` correctamente typed. Remove 9 casts.

---

### 2026-04-20 — L-89: ContentLibrary DEFAULT_FILTER_OPTIONS fake hardcoded

**Encontrado durante:** D0v4-4 Batch 4
**Descripción:** [useContentLibraryState.ts:20-25](apps/client/components/content/library/useContentLibraryState.ts#L20-L25) hardcoded filter options:

```ts
const DEFAULT_FILTER_OPTIONS: FilterOptions = {
  platforms: ["x", "instagram", "facebook", "youtube", "tiktok"],  // missing 6 platforms
  categories: ["Product Updates", "Behind the Scenes", ...],
  tags: ["#Innovation", "#TeamWork", ...],
  authors: [],
};
```

UI FilterPanel muestra estas opciones como si estuvieran disponibles. Compuesto con L-77 (no fetch): filter panel permite filtrar por categorías que no existen en data real.

**Severidad estimada:** alto
**Acción propuesta:** Derive filter options de real data. Fix L-77 primero.

---

### 2026-04-20 — L-90: MultiPlatformSchedulerRefactored dead Edit button + raw fetches

**Encontrado durante:** D0v4-4 Batch 4
**Descripción:** [scheduling/MultiPlatformSchedulerRefactored.tsx:194-196](apps/client/components/scheduling/MultiPlatformSchedulerRefactored.tsx#L194-L196):

```ts
const handleEditRule = useCallback((ruleId: string) => {
  // Edit requires a modal UI — pending rule-editing dialog implementation
  void ruleId;
}, []);
```

User click "Edit" en RulesView → nada. Plus L176 + L202 raw `fetch("/api/backend/scheduling/rules")` + PATCH `/toggle` en lugar de TanStack hooks.

**Severidad estimada:** alto (UX + §2.1 violation)
**Acción propuesta:** Implement edit modal. Migrar raw fetch a `hooks/api/useScheduling`.

---

### 2026-04-20 — L-91: MultiPlatformSchedulerRefactored orphan "Refactored" suffix

**Encontrado durante:** D0v4-4 Batch 5
**Descripción:** File named `MultiPlatformSchedulerRefactored.tsx` pero export es `MultiPlatformScheduler`. Git history confirma: **NO existe `MultiPlatformScheduler.tsx` sin sufijo**. Commits: `ed0f8c9`, `ec8cb2a`, `597bccc`. El sufijo "Refactored" es huérfano — sin contraparte original en historia.

**Severidad estimada:** alto (naming debt)
**Acción propuesta:** Rename a `MultiPlatformScheduler.tsx`. Update imports.

---

### 2026-04-20 — L-92: RecurringPostForm raw fetch + orphan navigation link

**Encontrado durante:** D0v4-4 Batch 4
**Descripción:** [components/scheduling/RecurringPostForm.tsx:104, 118](apps/client/components/scheduling/RecurringPostForm.tsx#L104):

- L104 raw `fetch("/api/backend/recurring-posts")` (o PATCH edit) — no TanStack (viola §2.1).
- L118 `router.push("/scheduling/recurring")` — **missing `/dashboard/` prefix** → CLIENT-REVERSE-ORPHAN-404.

**Severidad estimada:** alto
**Acción propuesta:** Migrate to `useCreateRecurringPost` hook. Fix navigation path.

---

### 2026-04-20 — L-93: scheduling/page.tsx raw fetches + prompt() + alert() UX

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/dashboard/scheduling/page.tsx](apps/client/app/dashboard/scheduling/page.tsx):

- L47, L72, L99, L145, L176, L198 raw `fetch("/api/backend/...")` (6 calls) — all should be TanStack hooks.
- L138, L141 `prompt()` para handleAddRule + handleEditRule.
- L131, L162, L189, L213 `alert()` para feedback.
- L210 "List view coming soon" placeholder.
- L244 `<Link href="/scheduling/recurring">` missing `/dashboard/` prefix.

**Severidad estimada:** alto
**Acción propuesta:** Rewrite con TanStack + toast + modal. Fix orphan link.

---

### 2026-04-20 — L-94: channels page OAuth connect button dead for 10/11 providers

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/dashboard/channels/page.tsx:665-674](apps/client/app/dashboard/channels/page.tsx#L665-L674):

```ts
<button onClick={() => {
  // OAuth flow not yet implemented — requires redirect to provider OAuth URL
  setShowConnectModal(false);
}}>Connect Account</button>
```

Solo Bluesky (L655) tiene handler real (`handleBlueskyConnect`). Los otros 10 providers (X, Instagram, Facebook, YouTube, TikTok, LinkedIn, Pinterest, Snapchat, Telegram, Threads) → button cierra el modal sin conectar nada.

**Severidad estimada:** alto (feature completa no implementada)
**Acción propuesta:** Implement OAuth flow. Backend tiene endpoints (`/auth/connect/{provider}`) según D0v4-1.

---

### 2026-04-20 — L-95: channels page Test/Settings buttons disabled "Coming soon"

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/dashboard/channels/page.tsx:408-424](apps/client/app/dashboard/channels/page.tsx#L408-L424): "Test" + "Settings" buttons con `disabled title="Coming soon"`. Feature promised but not wired.

**Severidad estimada:** alto
**Acción propuesta:** Implement o remove.

---

### 2026-04-20 — L-96: Instagram upload Create Stories/Reels/Carousel dead buttons

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/dashboard/instagram/upload/page.tsx](apps/client/app/dashboard/instagram/upload/page.tsx):

- L89 `handleCreateStories` comment "Navigation to Stories editor with selected files pending router integration" → button clickable pero no navega.
- L498, L502 "Create Reels" + "Create Carousel" buttons sin `onClick`. Solo disabled state.
- L517-520 metadata comment commented-out at EOF.

**Severidad estimada:** alto
**Acción propuesta:** Implement router.push to stories editor con state. Implement Reels/Carousel flows o remove buttons.

---

### 2026-04-20 — L-97: posts/page.tsx raw fetch + no TanStack + 4x `any`

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/dashboard/posts/page.tsx](apps/client/app/dashboard/posts/page.tsx) (669 LOC):

- L71 `fetch("/api/posts?...")` — sin `/api/backend/` prefix, bypass auth injection, uses rewrite path directamente.
- Uses custom `useConcurrentData`, `useBackgroundTasks`, `usePerformanceMonitoring` from `@/lib/scalability/ConcurrentRenderer` — no TanStack Query.
- `post: any`, `StatusIcon: any`, `router: any` (4 `any` types).

Viola §2.1 + zero-any rule.

**Severidad estimada:** alto
**Acción propuesta:** Migrate to `usePosts` TanStack hook. Remove `any`.

---

### 2026-04-20 — L-98: posts/[id] + preview `alert()` + LEGACY hook imports

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** `app/dashboard/posts/[id]/page.tsx` + `posts/[id]/preview/page.tsx`:

- Multiple `alert()` calls (5+ in each file) for success/error feedback.
- Import `usePost`, `useProjects`, `useProviders` from `@/lib/api/hooks` (LEGACY) + `@/lib/hooks/useProviders` (LEGACY) — 2 diferentes LEGACY paths en same file.

**Severidad estimada:** alto (UX + LEGACY path)
**Acción propuesta:** Replace alerts with toast. Consolidate hooks to canonical `/hooks/api/`.

---

### 2026-04-20 — L-99: TemplateManagementDashboard LEGACY hooks con broken URLs (re-confirm)

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/dashboard/templates/TemplateManagementDashboard.tsx:17,69](apps/client/app/dashboard/templates/TemplateManagementDashboard.tsx#L17) usa `useABTests`, `useTemplates`, `useTemplateVersions` de `@/lib/hooks/*` (LEGACY).

CLIENT_LIB_HOOKS_AUDIT.md §3.1 documenta: 3/8 URLs broken (PUT `/api/ab-tests/:id`, POST `/pause`, DELETE `/ab-tests/:id` retornan 404).

Consecuencia real: A/B test update + pause + delete silently fail via 404. UI TemplateManagementDashboard + ABTestManager muestran operación exitosa sin verificar response.

**Severidad estimada:** alto (re-confirmación)
**Acción propuesta:** Ya documentado. Pending fix D0v4-5.

---

### 2026-04-20 — L-100: ProjectProvider raw fetch + single-account stub + window.location.reload()

**Encontrado durante:** D0v4-4 Batch 5
**Descripción:** [providers/ProjectProvider.tsx](apps/client/providers/ProjectProvider.tsx) (327 LOC):

- L102 raw `fetch("/api/backend/auth/customer/me")` — no TanStack.
- L101-118 `fetchAccounts` retorna single-entry array con stub `email: ""`, `name: ""` porque backend solo da accountId. **Architectural mismatch**: provider designed multi-account, backend single.
- L121 raw `fetch("/api/backend/accounts/${accountId}/projects")` — no TanStack.
- L274 `window.location.reload()` anti-pattern en error state.

**Severidad estimada:** alto (architectural + patterns)
**Acción propuesta:** Migrate a TanStack hooks. Fix architectural mismatch (collapse multi-account logic si backend is truly single-account).

---

### 2026-04-20 — L-101: QueryClient config staleTime 60s + retry:1 inconsistente

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/providers.tsx:15-26](apps/client/app/providers.tsx#L15-L26) config:

```ts
staleTime: 60 * 1000,   // 60s generic — no por dominio
gcTime: 5 * 60 * 1000,  // 5 min
retry: 1,               // FRONTEND_STANDARDS §2.3 default: 2
```

Inconsistente con ejemplos de FRONTEND_STANDARDS §2.3.

**Severidad estimada:** alto
**Acción propuesta:** Review + align. staleTime por dominio puede ir en hook individual.

---

### 2026-04-20 — L-102: Ai subsystem size violations (5+ componentes >400 LOC)

**Encontrado durante:** D0v4-4 Batch 4
**Descripción:** Ai folder tiene acumulación size violations:

- `PromptTemplateManager.tsx` 439 LOC
- `SmartContentOptimizer.tsx` 369 LOC
- `AIContentGenerator.tsx` 173 LOC (OK)
- Plus ai-content-templates.ts 263 LOC (utility limit 200)
- Plus usePredictiveData.ts 629 LOC (hook limit 150)
- Plus smartContentOptimizerUtils.ts 243 LOC

Multiple violations in single folder.

**Severidad estimada:** alto
**Acción propuesta:** Refactor per FRONTEND_STANDARDS §1.1.

---

### 2026-04-20 — L-103: Auth actions.ts type casts `as string` on FormData.get

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/actions/auth.ts:22-24](apps/client/app/actions/auth.ts#L22-L24):

```ts
const email = formData.get("email") as string;
const password = formData.get("password") as string;
const rememberMe = formData.get("rememberMe") === "on";
```

`FormData.get()` retorna `FormDataEntryValue | null`. Cast a string puede fail con null/File objects. No validación zod.

**Severidad estimada:** alto (type safety)
**Acción propuesta:** Validate con zod schema antes de cast.

---

### 2026-04-20 — L-104: Auth actions.ts name parsing bug (firstName/lastName)

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/actions/auth.ts:111-112](apps/client/app/actions/auth.ts#L111-L112):

```ts
const firstName = name.split(" ")[0] || name;
const lastName = name.split(" ").slice(1).join(" ") || name;
```

Si `name = "John Smith Doe"`: firstName="John", lastName="Smith Doe" (OK). Si `name = "Madonna"`: firstName="Madonna", lastName="Madonna" (bug — lastName debería ser empty). Plus Spanish user could have 2 firstNames.

**Severidad estimada:** alto (data quality)
**Acción propuesta:** Separar inputs firstName + lastName explícito. No split.

---

### Medios (L-105..L-118)

### 2026-04-20 — L-105: AIImageGenerator "DALL-E 3" hardcoded docstring

**Encontrado durante:** D0v4-4 Batch 4
**Descripción:** [ai/AIImageGenerator.tsx:3](apps/client/components/ai/AIImageGenerator.tsx#L3) docstring: "AI image generation form and gallery. Uses DALL-E 3 via the backend API." Hardcoded provider assumption en docstring. Si backend usa Stable Diffusion o Midjourney, documentación miente.

**Severidad estimada:** medio
**Acción propuesta:** Generalize docstring o vincular a dynamic provider.

---

### 2026-04-20 — L-106: AIGenerationPreview fake progress steps sin vinculación

**Encontrado durante:** D0v4-4 Batch 4
**Descripción:** [ai/AIGenerationPreview.tsx:24-28](apps/client/components/ai/AIGenerationPreview.tsx#L24-L28):

```ts
<div>✨ Analyzing your template and variables</div>
<div>🎯 Optimizing for each platform</div>
<div>🧠 Applying AI creativity and brand consistency</div>
<div>📊 Calculating engagement predictions</div>
```

Static list — no step actual progress tracking. Usuario ve 4 "steps" ficticios.

**Severidad estimada:** medio
**Acción propuesta:** Vincular a stream de progress real del backend O simplificar a "Generating..." genérico.

---

### 2026-04-20 — L-107: providerMapper hardcoded DEFAULT_LIMITS missing 7 platforms

**Encontrado durante:** D0v4-4 Batch 5
**Descripción:** [lib/utils/providerMapper.ts:10-53](apps/client/lib/utils/providerMapper.ts#L10-L53) define `DEFAULT_LIMITS` solo para: x, twitter, instagram, linkedin, facebook (5 platforms).

Missing: youtube, tiktok, pinterest, snapchat, telegram, bluesky, threads (7 platforms). Fallback L82-90 es Twitter limits → youtube (5000 chars max) fallback a 280 chars.

Comment L9: "Default platform limits - these would normally come from the backend".

**Severidad estimada:** medio
**Acción propuesta:** Fetch limits del backend (ya hay endpoint `/providers`). O agregar entries missing.

---

### 2026-04-20 — L-108: providerMapper `authType: "oauth"` hardcoded default

**Encontrado durante:** D0v4-4 Batch 5
**Descripción:** [lib/utils/providerMapper.ts:106](apps/client/lib/utils/providerMapper.ts#L106): `authType: "oauth"`. Pero Bluesky usa `app_password` (per channels/page.tsx UI). Fallback incorrecto.

**Severidad estimada:** medio
**Acción propuesta:** Fetch authType del backend o map per provider.

---

### 2026-04-20 — L-109: error.tsx + global-error.tsx missing ARIA alert roles

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/error.tsx](apps/client/app/error.tsx) + [app/global-error.tsx](apps/client/app/global-error.tsx) containers no tienen `role="alert"` + `aria-live="assertive"` a pesar de ser error screens. Viola FRONTEND_STANDARDS §8.

**Severidad estimada:** medio (a11y)
**Acción propuesta:** Agregar `role="alert"` + `aria-live="assertive"` al div container.

---

### 2026-04-20 — L-110: error.tsx uses console.error (viola logger port)

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/error.tsx:12](apps/client/app/error.tsx#L12): `console.error(error)`. CLAUDE.md requiere `@observability/logger` Pino — zero console.\* en production code.

**Severidad estimada:** medio
**Acción propuesta:** Replace con logger port.

---

### 2026-04-20 — L-111: PublishingInterface `estimatedTime` hardcoded formula

**Encontrado durante:** D0v4-4 Batch 3
**Descripción:** [publishing/PublishingInterface.tsx:133](apps/client/components/publishing/PublishingInterface.tsx#L133): `stats.estimatedTime = Math.ceil(stats.totalProviders * 2 + (stats.rateLimit ? 30 : 0))`.

UI muestra "Est. Time ~Xs" como si fuera estimación real. Es fórmula hardcoded.

**Severidad estimada:** medio
**Acción propuesta:** Remove estimation o vincular a backend metrics.

---

### 2026-04-20 — L-112: PublishingInterface `rateLimit.postsPerHour < 10` hardcoded threshold

**Encontrado durante:** D0v4-4 Batch 3
**Descripción:** [publishing/PublishingInterface.tsx:127](apps/client/components/publishing/PublishingInterface.tsx#L127): `if (rateLimit.postsPerHour < 10) { stats.rateLimit = true; }`. Threshold hardcoded sin justificación.

**Severidad estimada:** medio
**Acción propuesta:** Mover a config o derivar del provider config real.

---

### 2026-04-20 — L-113: Language mix Spanish/English sin i18n

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** Mix inconsistente en UI:

- `scheduling/recurring/page.tsx` "Publicaciones recurrentes"
- `RecurringPostForm.tsx` all Spanish labels
- `channels/page.tsx` Bluesky connect form all Spanish ("Handle y App Password son obligatorios")
- `billing/page.tsx` "Procesador de pago"
- Rest of app English

Sin i18n infrastructure detectada.

**Severidad estimada:** medio
**Acción propuesta:** i18n decision (single language or true i18n). Remove hardcoded Spanish strings.

---

### 2026-04-20 — L-114: dashboard/layout.tsx "Settings" hardcoded to `/dashboard/settings/brand-voice`

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/dashboard/layout.tsx:54](apps/client/app/dashboard/layout.tsx#L54): Settings navigation item `href: "/dashboard/settings/brand-voice"`. **No index page `/dashboard/settings`** — nav directly jumps to brand-voice. Misleading.

**Severidad estimada:** medio
**Acción propuesta:** Create settings index page O rename nav item a "Brand Voice".

---

### 2026-04-20 — L-115: dashboard/layout.tsx "AI Settings" separate item

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** Layout nav has "Settings" + "AI Settings" as separate top-level items. AI Settings link to `/dashboard/settings/ai` which is already a sub-setting. Inconsistent information architecture.

**Severidad estimada:** medio
**Acción propuesta:** IA revisión — mantener en Settings sub-nav o separar conceptualmente (AI as feature?).

---

### 2026-04-20 — L-116: TemplateSelector uses postTemplates static library (not API)

**Encontrado durante:** D0v4-4 Batch 2
**Descripción:** [editor/TemplateSelector.tsx](apps/client/components/editor/TemplateSelector.tsx) imports `postTemplates` + `templateCategories` from `@/lib/templates/postTemplates` (static).

Parallel with dynamic templates via `hooks/api/useTemplates`. Two template systems coexist.

**Severidad estimada:** medio
**Acción propuesta:** Consolidar a API-driven templates.

---

### 2026-04-20 — L-117: AnnouncementBanner uses `/api/announcements/active` (no `/backend/` prefix)

**Encontrado durante:** D0v4-4 Batch 2
**Descripción:** [announcements/AnnouncementBanner.tsx:53](apps/client/components/announcements/AnnouncementBanner.tsx#L53): `fetch("/api/announcements/active")` — no pasa por `/api/backend/` proxy. Uses direct rewrite path (per next.config.mjs). No auth injection. Probably OK because announcements endpoint is public.

Pero inconsistente con resto del app.

**Severidad estimada:** medio
**Acción propuesta:** Document intent public path. Or migrate to `/api/backend/announcements/active` for consistency.

---

### 2026-04-20 — L-118: Recharts used only in analytics page (bundle weight)

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** `recharts` library imported only en `app/dashboard/analytics/page.tsx:15-24`. If this is a heavy lib, consider dynamic import to avoid bloat.

**Severidad estimada:** medio (perf)
**Acción propuesta:** `const BarChart = dynamic(() => import("recharts").then(m => m.BarChart))` if bundle size concern.

---

### Bajos (L-119..L-122)

### 2026-04-20 — L-119: instagram/upload Metadata commented-out at EOF

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/dashboard/instagram/upload/page.tsx:517-520](apps/client/app/dashboard/instagram/upload/page.tsx#L517-L520): 4 lines of commented-out metadata export. Dead comment.

**Severidad estimada:** bajo
**Acción propuesta:** Remove comment.

---

### 2026-04-20 — L-120: `_customDateTime` unused state in SchedulePicker

**Encontrado durante:** D0v4-4 Batch 2
**Descripción:** [editor/SchedulePicker.tsx:129](apps/client/components/editor/SchedulePicker.tsx#L129): `const [_customDateTime, setCustomDateTime] = useState<Date | null>(null);`. Prefixed with `_` (unused) but still in state.

**Severidad estimada:** bajo
**Acción propuesta:** Remove state.

---

### 2026-04-20 — L-121: PlatformPreview unused `_createThreadSegments` function

**Encontrado durante:** D0v4-4 Batch 2
**Descripción:** [editor/PlatformPreview.tsx:51-83](apps/client/components/editor/PlatformPreview.tsx#L51-L83): 32 LOC `_createThreadSegments` function marked unused with underscore prefix but still in file. Thread segmentation already handled by `providerRegistry.getThreadSegments`.

**Severidad estimada:** bajo
**Acción propuesta:** Remove dead function.

---

### 2026-04-20 — L-122: ConversationThread eslint-disable sin documentar

**Encontrado durante:** D0v4-4 Batch 3
**Descripción:** [inbox/ConversationThread.tsx:59](apps/client/components/inbox/ConversationThread.tsx#L59): `// eslint-disable-next-line react-hooks/exhaustive-deps`. Disable sin explicación adjunta.

**Severidad estimada:** bajo
**Acción propuesta:** Agregar comment explicando intent (avoid markRead loop on every allMessages change).

---

### Over-clientization individual (L-123..L-134)

**Per decisión Edward CP1**: cada wrapper page trivial over-clientized se registra individual.

### 2026-04-20 — L-123: integrations/page.tsx — over-clientized wrapper

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/dashboard/integrations/page.tsx](apps/client/app/dashboard/integrations/page.tsx) (29 LOC) `"use client"` pero solo renderiza `<IntegrationMarketplace />`. Sin estado local, sin hooks, sin event handlers. Viola FRONTEND_STANDARDS §1.4.

**Severidad estimada:** medio (performance + bundle)
**Acción propuesta:** Remove `"use client"`. Convert to Server Component.

---

### 2026-04-20 — L-124: settings/integrations/page.tsx — over-clientized wrapper + hardcoded TODO

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/dashboard/settings/integrations/page.tsx](apps/client/app/dashboard/settings/integrations/page.tsx) (30 LOC): `"use client"` + `const projectId = "default"; // TODO: Replace with real project context`. Trivial wrapper.

**Severidad estimada:** medio
**Acción propuesta:** Remove `"use client"`. Use Server Component + pass projectId from ProjectProvider or URL.

---

### 2026-04-20 — L-125: settings/crm/page.tsx — over-clientized wrapper

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/dashboard/settings/crm/page.tsx](apps/client/app/dashboard/settings/crm/page.tsx) (26 LOC): trivial `<CrmSettings />` wrapper.

**Severidad estimada:** medio
**Acción propuesta:** Remove `"use client"`.

---

### 2026-04-20 — L-126: settings/sso/page.tsx — over-clientized wrapper

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/dashboard/settings/sso/page.tsx](apps/client/app/dashboard/settings/sso/page.tsx) (30 LOC): uses `useAuth()` for accountId but otherwise trivial. Could be SC passing accountId from cookies.

**Severidad estimada:** medio
**Acción propuesta:** Review.

---

### 2026-04-20 — L-127: content/library/page.tsx — over-clientized wrapper

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/dashboard/content/library/page.tsx](apps/client/app/dashboard/content/library/page.tsx) (27 LOC): uses `useProject()` + renders `<ContentLibrary />`. Could be SC.

**Severidad estimada:** medio
**Acción propuesta:** Review.

---

### 2026-04-20 — L-128: content/templates/page.tsx — over-clientized wrapper

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/dashboard/content/templates/page.tsx](apps/client/app/dashboard/content/templates/page.tsx) (20 LOC): trivial `<ContentTemplates showAutomation={true} />` wrapper.

**Severidad estimada:** medio
**Acción propuesta:** Remove `"use client"`.

---

### 2026-04-20 — L-129: instagram/stories/page.tsx — over-clientized wrapper + L-87 compound

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/dashboard/instagram/stories/page.tsx](apps/client/app/dashboard/instagram/stories/page.tsx) (38 LOC): trivial wrapper with 4 `alert("Coming soon")` callbacks (ver L-87). Could be Server Component if callbacks wired to server actions.

**Severidad estimada:** medio
**Acción propuesta:** Fix L-87 primero.

---

### 2026-04-20 — L-130: analytics/insights/page.tsx — over-clientized wrapper + L-73 compound

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/dashboard/analytics/insights/page.tsx](apps/client/app/dashboard/analytics/insights/page.tsx) (28 LOC): trivial wrapper with empty params (ver L-73).

**Severidad estimada:** medio
**Acción propuesta:** Fix L-73 + convert to SC.

---

### 2026-04-20 — L-131: ai/analytics/page.tsx — over-clientized wrapper

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/dashboard/ai/analytics/page.tsx](apps/client/app/dashboard/ai/analytics/page.tsx) (24 LOC): trivial `<PredictiveAnalytics />` wrapper.

**Severidad estimada:** medio
**Acción propuesta:** Remove `"use client"`.

---

### 2026-04-20 — L-132: ai/generate/page.tsx — over-clientized wrapper

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/dashboard/ai/generate/page.tsx](apps/client/app/dashboard/ai/generate/page.tsx) (50 LOC): tab state only, could be URL-driven + SC.

**Severidad estimada:** medio
**Acción propuesta:** Review.

---

### 2026-04-20 — L-133: ai/optimizer/page.tsx — over-clientized wrapper

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/dashboard/ai/optimizer/page.tsx](apps/client/app/dashboard/ai/optimizer/page.tsx) (49 LOC): textarea local state — could be moved to SmartContentOptimizer component. Page could be SC.

**Severidad estimada:** medio
**Acción propuesta:** Move state.

---

### 2026-04-20 — L-134: reports/shared/[token]/page.tsx — public page over-clientized

**Encontrado durante:** D0v4-4 Batch 1
**Descripción:** [app/reports/shared/[token]/page.tsx](apps/client/app/reports/shared/[token]/page.tsx) (133 LOC): `"use client"` but **is public read-only** page. Perfect candidate for Server Component (fetch del backend con `await`, render static). **Biggest over-clientization impact** (bundled JS into public route).

**Severidad estimada:** alto (SEO + perf)
**Acción propuesta:** Convert to Server Component + Suspense.

---

### Size violations individual (L-135..L-204)

**Per decisión Edward CP4**: uno por archivo. FRONTEND_STANDARDS §1.1 limits: Component `.tsx` 200 LOC, Page 800, Custom hook 150, Utility 200.

Tabla consolidada (70 archivos). Cada uno es hallazgo individual:

| # L-XX | Archivo                                              | LOC |     Límite |                                     Over |
| ------ | ---------------------------------------------------- | --: | ---------: | ---------------------------------------: |
| L-135  | `editor/PlatformPreview.tsx`                         | 705 |        200 |                                     +505 |
| L-136  | `dashboard/channels/page.tsx`                        | 692 |        200 |                                     +492 |
| L-137  | `settings/billing/page.tsx`                          | 687 |        200 |                                     +487 |
| L-138  | `instagram/MediaUploadZone.tsx`                      | 672 |        200 |                                     +472 |
| L-139  | `dashboard/posts/page.tsx`                           | 669 |        200 |                                     +469 |
| L-140  | `usePredictiveData.ts`                               | 629 |        150 |                              +479 (hook) |
| L-141  | `publishing/UnifiedPublishingDashboard.tsx`          | 620 |        200 |                        +420 (dead, L-68) |
| L-142  | `instagram/VideoSplitPreview.tsx`                    | 613 |        200 |                                     +413 |
| L-143  | `editor/ContentPreviewSystem.tsx`                    | 604 |        200 |                        +404 (dead, L-68) |
| L-144  | `templates/VariableInserter.tsx`                     | 546 |        200 |                                     +346 |
| L-145  | `instagram/upload/page.tsx`                          | 520 |        200 |                                     +320 |
| L-146  | `publishing/PublishingInterface.tsx`                 | 496 |        200 |                                     +296 |
| L-147  | `editor/ProviderAdaptationEngine.tsx`                | 494 |        200 |                        +294 (dead, L-68) |
| L-148  | `posts/[id]/page.tsx`                                | 488 |        200 |                                     +288 |
| L-149  | `templates/TemplateManagementDashboard.tsx`          | 460 |        200 |                                     +260 |
| L-150  | `editor/SchedulePicker.tsx`                          | 442 |        200 |                                     +242 |
| L-151  | `ai/PromptTemplateManager.tsx`                       | 439 |        200 |                                     +239 |
| L-152  | `templates/TipTapEditor.tsx`                         | 421 |        200 |                                     +221 |
| L-153  | `templates/TemplateEditorCanvas.tsx`                 | 417 |        200 |                                     +217 |
| L-154  | `posts/[id]/preview/page.tsx`                        | 392 |        200 |                                     +192 |
| L-155  | `analytics/page.tsx`                                 | 275 |        200 |                                      +75 |
| L-156  | `editor/AdminContentEditor.tsx`                      | 360 |        200 |                        +160 (dead, L-68) |
| L-157  | `templates/TemplateLibraryGrid.tsx`                  | 354 |        200 |                                     +154 |
| L-158  | `templates/TemplateSelector.tsx`                     | 351 |        200 |                                     +151 |
| L-159  | `templates/TemplateLibrary.tsx`                      | 335 |        200 |                                     +135 |
| L-160  | `scheduling/SchedulingDashboardSidebar.tsx`          | 329 |        200 |                                     +129 |
| L-161  | `providers/ProjectProvider.tsx`                      | 327 |        200 |                                     +127 |
| L-162  | `editor/provider-previews.tsx`                       | 327 |        200 |                        +127 (dead, L-68) |
| L-163  | `templates/TemplateVersionControl.tsx`               | 322 |        200 |                                     +122 |
| L-164  | `useContentLibraryState.ts`                          | 290 |        150 |                              +140 (hook) |
| L-165  | `scheduling/CSVBulkUpload.tsx`                       | 317 |        200 |                                     +117 |
| L-166  | `scheduling/useSchedulingDashboard.ts`               | 318 |        150 |                              +168 (hook) |
| L-167  | `templates/TemplateEditor.tsx`                       | 315 |        200 |                                     +115 |
| L-168  | `scheduling/page.tsx`                                | 317 |        200 |                                     +117 |
| L-169  | `publishing/publishingDashboardApi.ts`               | 306 |        200 |                   +106 (util, dead L-68) |
| L-170  | `templates/ABTestCreateDialog.tsx`                   | 300 |        200 |                                     +100 |
| L-171  | `ai/SmartContentOptimizer.tsx`                       | 369 |        200 |                                     +169 |
| L-172  | `ai/PredictiveAnalytics.tsx`                         |  86 |        200 | OK (entry bundled por ai hallazgo L-102) |
| L-173  | `settings/ai/page.tsx`                               | 293 | 800 (page) |            OK page, componentes internos |
| L-174  | `ClientContentEditor.tsx`                            | 297 |        200 |                                      +97 |
| L-175  | `scheduling/MultiPlatformSchedulerRefactored.tsx`    | 278 |        200 |                                      +78 |
| L-176  | `scheduling/RecurringPostForm.tsx`                   | 275 |        200 |                                      +75 |
| L-177  | `settings/privacy/page.tsx`                          | 271 |        800 |                                       OK |
| L-178  | `PublishDialog.tsx`                                  | 272 |        200 |                                      +72 |
| L-179  | `useABTestManager.ts`                                | 273 |        150 |                              +123 (hook) |
| L-180  | `analytics/ScheduledReportsList.tsx`                 | 245 |        200 |                                      +45 |
| L-181  | `approvals/ReviewPanel.tsx`                          | 244 |        200 |                                      +44 |
| L-182  | `content/library/FilterPanel.tsx`                    | 244 |        200 |                                      +44 |
| L-183  | `ai/smartContentOptimizerUtils.ts`                   | 243 |        200 |                               +43 (util) |
| L-184  | `NotificationBell.tsx`                               | 239 |        200 |                                      +39 |
| L-185  | `SchedulingDashboard.tsx`                            | 239 |        200 |                                      +39 |
| L-186  | `NotificationPreferences.tsx`                        | 251 |        200 |                                      +51 |
| L-187  | `scheduling/views/BulkScheduleView.tsx`              | 255 |        200 |                                      +55 |
| L-188  | `PerformanceInsights.tsx`                            | 275 |        200 |                                      +75 |
| L-189  | `ai/AIContentResults.tsx`                            | 208 |        200 |                                       +8 |
| L-190  | `ai/ai-content-templates.ts`                         | 263 |        200 |                               +63 (util) |
| L-191  | `useTemplateVersionControl.ts`                       | 281 |        150 |                              +131 (hook) |
| L-192  | `content/ContentTemplates.tsx`                       | 217 |        200 |                                      +17 |
| L-193  | `SchedulingDashboardPostModal.tsx`                   | 221 |        200 |                                      +21 |
| L-194  | `RecurrenceSelector.tsx`                             | 209 |        200 |                                       +9 |
| L-195  | `SamlConfigForm.tsx`                                 | 211 |        200 |                                      +11 |
| L-196  | `analytics/CreateReportForm.tsx`                     | 206 |        200 |                                       +6 |
| L-197  | `dashboard/layout.tsx`                               | 178 |        200 |                                       OK |
| L-198  | `settings/brand-voice/BrandVoiceForm.tsx`            | 269 |        200 |                                      +69 |
| L-199  | `settings/ExternalNotificationConfigs.tsx`           | 245 |        200 |                                      +45 |
| L-200  | `instagram/StoriesEditor.tsx`                        | 197 |        200 |                                       OK |
| L-201  | `analytics/PerformanceInsights.tsx`                  | 275 |        200 |                                      +75 |
| L-202  | `settings/AddWebhookForm.tsx`                        | 191 |        200 |                                       OK |
| L-203  | `editor/TemplateSelector.tsx` (duplicate ref L-158)  |   - |          - |                                        - |
| L-204  | `publishing/PublishDialog.tsx` (duplicate ref L-178) |   - |          - |                                        - |

**Nota**: algunos archivos listados OK en tabla pero se incluyen como sentinels para review. Acción global: Edward decide per archivo si refactor o accept.

**Severidad estimada** (todos): medio (mantenibilidad)
**Acción propuesta**: refactor por archivo.
