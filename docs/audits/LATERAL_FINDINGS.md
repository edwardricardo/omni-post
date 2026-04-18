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
