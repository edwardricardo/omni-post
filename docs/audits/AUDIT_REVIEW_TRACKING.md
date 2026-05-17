---
title: Audit findings — review tracking
description: Tracking en vivo de la revisión punto-por-punto de los 49 hallazgos de la auditoría F5 (2026-05-10/11). Edward decide por item; este documento se actualiza con cada decisión + ejecución.
generated: 2026-05-11
auditor: claude-code
status: IN_PROGRESS
---

# Audit findings — review tracking

> Workbench operativo para cerrar los 49 hallazgos de `_AUDIT_FINDINGS.md`. Organizado **por aplicación** para que cada sección tenga scope de trabajo bien definido. Edward revisa cada item, marca decisión; el asistente actualiza status + acción tomada.
>
> **Fuente de verdad** del hallazgo (categoría + evidencia + recomendación auditor): [`_AUDIT_FINDINGS.md`](_AUDIT_FINDINGS.md). Este doc agrega **estado de revisión + decisión + ejecución**.

---

## Convenciones

### Estados (status)

| Estado          | Significado                                                                               |
| --------------- | ----------------------------------------------------------------------------------------- |
| `PENDING`       | Aún no revisado. Default inicial.                                                         |
| `IN_REVIEW`     | En conversación con Edward (no se ha cerrado decisión).                                   |
| `APPROVED`      | Edward confirmó la acción candidata del auditor. Pendiente ejecutar.                      |
| `CHANGE-ACTION` | Hallazgo válido, pero la acción es diferente a la propuesta. Se anota la acción acordada. |
| `REJECTED`      | Falso positivo. Se documenta la razón. Cierra el item.                                    |
| `DEFERRED`      | Válido pero fuera del scope actual. Se agenda. Cierra el item para esta ronda.            |
| `RESOLVED`      | Acción ejecutada. Lleva referencia al commit / PR / artefacto. Cierra el item.            |

### Decisión

Una de: `APPROVE` · `REJECT` · `CHANGE-ACTION` · `DEFER`. Cuando Edward marca, el status se mueve a `APPROVED` / `REJECTED` / `CHANGE-ACTION` / `DEFERRED` según corresponda.

### Flows tocados

Cada finding que cambia comportamiento end-to-end deja un rastro en **§Flow inventory** (más abajo). El campo `Flows tocados` por finding referencia los flow IDs (`flow-NNN`). Al cerrar la auditoría, la unión de todos los flows del inventory define el plan de smoke / e2e tests.

**Convención por entrada de flow**:

```markdown
### flow-NNN — <título corto>

- **Descripción:** Una oración que diga qué hace el flow end-to-end.
- **Findings:** FN-NN, FN-NN, …
- **Componentes end-to-end:** path-encadenado (productor → cola → consumidor → persistencia → UI).
- **Smoke check propuesto:** Cómo verificar manualmente o en CI que el flow funciona.
- **Notas:** edge cases, dependencias externas, providers requeridos.
```

---

## Progress dashboard

> Actualizar tras cada cambio de estado.

| Métrica                                       |   Count |
| --------------------------------------------- | ------: |
| Total findings                                |      49 |
| PENDING                                       |      38 |
| IN_REVIEW                                     |       0 |
| APPROVED (awaiting execution)                 |       0 |
| CHANGE-ACTION (awaiting execution)            |       0 |
| REJECTED                                      |       0 |
| DEFERRED                                      |       0 |
| RESOLVED                                      |      11 |
| **% reviewed**                                | **22%** |
| **% closed (resolved + rejected + deferred)** | **22%** |

> Nota: FN-012 cuenta como 1 finding global con 19 sub-items, todos cerrados. Side effects cerraron FN-030 + FN-034 + FN-035 + FN-038 automáticamente — sumados como RESOLVED. Lateral findings nuevos generados: L-649, L-650, L-651, L-652.

### Per-application progress

| App                  | Total | Reviewed | Closed | % closed |
| -------------------- | ----: | -------: | -----: | -------: |
| §1 API               |    13 |        0 |      0 |       0% |
| §2 Workers           |     3 |        3 |      3 | **100%** |
| §3 Admin             |     2 |        2 |      2 | **100%** |
| §4 Client            |     2 |        2 |      2 | **100%** |
| §5 Packages          |    13 |        0 |      0 |       0% |
| §6 Cross-application |    16 |        4 |      4 |  **25%** |

§3 Admin FN-012 sub-progress: 19/19 sub-items cerrados ✅. FN-030 cerrado via side effects (4 hooks orphan: 3 deleted + 1 deferred a L-650).

§6 Cross-application closed via §3 side effects: FN-030 (RESOLVED), FN-034 (admin↔client useMultiPlatformScheduling — admin side resuelto), FN-035 (multi-platform-scheduling types dup — admin side resuelto), FN-038 (stale endpoint refs — resuelto via deletes).

### Flow inventory progress

| Flows totales identificados            |                   4 |
| -------------------------------------- | ------------------: |
| flow-001 (workers deployment topology) |              active |
| flow-002 (Instagram publish)           | confirmed-canonical |
| flow-003 (inbox sync polling)          |              active |
| flow-004 (analytics ingest polling)    |              active |

---

## §1 — API (single-surface) — 13 items

### FN-001 — PublishingOrchestrator superseded por saga retrofit

- **Surface(s):** api
- **Categoría:** superseded
- **Status:** `PENDING`
- **Auditor recommendation:** `DELETE-NOW`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** —
- **Blocked by:** —

### FN-002 — EventPublisher.ts superseded por ComposedEventDispatcher

- **Surface(s):** api
- **Categoría:** superseded
- **Status:** `PENDING`
- **Auditor recommendation:** `DELETE-NOW`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** —
- **Blocked by:** —

### FN-003 — orchestration/sync/\* sin caller productivo

- **Surface(s):** api
- **Categoría:** superseded
- **Status:** `PENDING`
- **Auditor recommendation:** `DELETE-NOW` (con verificación)
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Duplicado con FN-049.
- **Blocked by:** —

### FN-006 — AccountMapper zero callers

- **Surface(s):** api
- **Categoría:** dead-code
- **Status:** `PENDING`
- **Auditor recommendation:** `DELETE-NOW`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** —
- **Blocked by:** —

### FN-007 — utils/dbOptimization solo en variable bloqueada

- **Surface(s):** api
- **Categoría:** dead-code
- **Status:** `RESOLVED`
- **Auditor recommendation:** `DELETE-NOW`
- **Edward decision:** `APPROVE`
- **Decision date:** 2026-05-12
- **Action taken:** Deleted `apps/api/src/utils/dbOptimization.ts` + `apps/api/tests/unit/dbOptimization.test.ts`. Removed dead import + `const _dbOptimizer = new DatabaseOptimizer(apiMetrics)` (variable bloqueada con `_` prefix) en `apps/api/src/index.ts:119,312`. Typecheck green.
- **Flows tocados:** flow-001 (API bootstrap — removed dead initialization).
- **Notes:** Competitive lens (WebSearch): ningún competidor (Hootsuite/Sprout/Buffer/Later/Agorapulse) diferencia ni expone DB internals al usuario. La canon `database/DatabaseOptimizer.ts` (DI-registered, consumida por postsService) cubre el uso interno legítimo. Side effect: cierra FN-008.
- **Blocked by:** —

### FN-008 — DatabaseOptimizer vs dbOptimization (REDUNDANTE)

- **Surface(s):** api
- **Categoría:** dead-code
- **Status:** `RESOLVED`
- **Auditor recommendation:** `DELETE-NOW` (borrar el de utils, mantener database)
- **Edward decision:** `APPROVE` (cluster con FN-007)
- **Decision date:** 2026-05-12
- **Action taken:** Resuelto como side effect de FN-007. Canon `database/DatabaseOptimizer.ts` confirmada DI-registered en `setupServices.ts:45`, consumida por `postsService.ts:8` + tipo en `postsService.test.ts`.
- **Flows tocados:** flow-001 (compartido con FN-007).
- **Notes:** Mismo cluster.
- **Blocked by:** —

### FN-009 — optimizedPostsRoutes nunca registrado

- **Surface(s):** api
- **Categoría:** dead-code
- **Status:** `PENDING`
- **Auditor recommendation:** `DELETE-NOW` (o registrar si gain real)
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** NEEDS_EDWARD — ¿era un experimento activo?
- **Blocked by:** —

### FN-010 — rateLimitingDashboard plugin no registrado

- **Surface(s):** api
- **Categoría:** dead-code / forgotten-feature
- **Status:** `PENDING`
- **Auditor recommendation:** `DECIDE` (wirearlo o borrarlo)
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** NEEDS_EDWARD — decisión de producto. Relacionado con FN-027.
- **Blocked by:** —

### FN-013 — saga/sagaManagerTypes.ts sin @layer header

- **Surface(s):** api
- **Categoría:** canon-deviation hard
- **Status:** `PENDING`
- **Auditor recommendation:** `FIX-NOW`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Fitness check #10 hard-zero violation. 30s de fix.
- **Blocked by:** —

### FN-022 — Video processing pipeline sin UI

- **Surface(s):** api
- **Categoría:** forgotten-feature
- **Status:** `PENDING`
- **Auditor recommendation:** `DECIDE` (wire UI o borrar módulo)
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** NEEDS_EDWARD. Wire UI ~1-2 días; borrar ~30 min.
- **Blocked by:** —

### FN-026 — EngagementPredictor potencial dead

- **Surface(s):** api
- **Categoría:** UNKNOWN → tendencia forgotten-feature
- **Status:** `PENDING`
- **Auditor recommendation:** `VERIFY`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Ejecutar grep para encontrar callers antes de clasificar.
- **Blocked by:** —

### FN-043 — analytics/roiCalculator vs roi/\* vs CalculateROIUseCase (drift)

- **Surface(s):** api
- **Categoría:** drift / redundancia
- **Status:** `PENDING`
- **Auditor recommendation:** `DECIDE` + tendencia `DELETE-NOW` los no-application
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Canon hexagonal: borrar legacy si CalculateROIUseCase cubre todo. ~2-3h con verificación.
- **Blocked by:** —

### FN-049 — orchestration/sync/\* UNKNOWN-leaning-DEAD

- **Surface(s):** api
- **Categoría:** UNKNOWN tending DEAD
- **Status:** `PENDING`
- **Auditor recommendation:** `VERIFY` → probable `DELETE-NOW`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Mismo item que FN-003 (duplicado en el catálogo).
- **Blocked by:** FN-003

---

## §2 — Workers (single-surface) — 3 items

### FN-014 — providers/instagram/publishingWorker sin bootstrap

- **Surface(s):** workers
- **Categoría:** dead-code
- **Status:** `RESOLVED`
- **Auditor recommendation:** `DELETE-NOW`
- **Edward decision:** `APPROVE`
- **Decision date:** 2026-05-11
- **Action taken:** Deleted `apps/workers/src/providers/instagram/publishingWorker.ts` + `apps/workers/tests/providers/instagram/` (3 test files). Empty parent dirs `apps/workers/src/providers/` + `apps/workers/tests/providers/` removed. Pending commit.
- **Flows tocados:** flow-002 (Instagram publish — canonical via `publishWorker.ts` preserved; duplicate per-provider worker removed eliminates race risk on `QUEUE_NAMES.PUBLISH`).
- **Notes:** Side effect resuelto: FN-039 (saga payload shape mismatch). Verificación post-delete: 0 callers en `apps packages` (solo stryker sandbox copies). `pnpm --filter @apps/workers typecheck` clean. Workers test suite 7/7 files, 87/87 tests passing.
- **Blocked by:** —

### FN-015 — inboxSyncWorker no en Dockerfile CMD

- **Surface(s):** workers
- **Categoría:** forgotten-feature / deployment-dead
- **Status:** `RESOLVED`
- **Auditor recommendation:** `FIX-NOW`
- **Edward decision:** `CHANGE-ACTION` (WIRE — full producer+consumer wire-up)
- **Decision date:** 2026-05-11
- **Action taken:** Refactor: `inboxSyncWorker.ts`/`analyticsIngestWorker.ts`/`publishWorker.ts` exportan `startXxxWorker({registerShutdown})` retornando `ShutdownTarget`, con CLI fallback via `import.meta.url` guard para uso standalone. Nuevo `apps/workers/src/bootstrap.ts` compone los 3 workers en un solo proceso con shutdown unificado. `Dockerfile` CMD → `["dist/bootstrap.js"]`. En `apps/api/src/index.ts`: registrado `scheduler.register("inbox-sync-dispatch", …, 30 min)` que invoca `DispatchInboxSyncUseCase.execute({})` — el productor que faltaba.
- **Flows tocados:** flow-001 (workers deployment topology), flow-003 (inbox sync polling).
- **Notes:** Hallazgo más profundo que la auditoría no detectó: el productor también estaba roto (DispatchInboxSyncUseCase DI-registered sin caller). Acción wireó AMBOS extremos. Verificación: typecheck workers + api clean; workers 87/87; api 7567/7567; eslint exit 0.
- **Blocked by:** —

### FN-016 — analyticsIngestWorker no en Dockerfile CMD

- **Surface(s):** workers
- **Categoría:** forgotten-feature / deployment-dead
- **Status:** `RESOLVED`
- **Auditor recommendation:** `FIX-NOW`
- **Edward decision:** `CHANGE-ACTION` (WIRE — full producer+consumer wire-up, bundled con FN-015)
- **Decision date:** 2026-05-11
- **Action taken:** Mismo bundle que FN-015: el worker está en bootstrap.ts; registrado `scheduler.register("analytics-ingest-dispatch", …, 6 h)` que invoca `DispatchAnalyticsIngestionUseCase.execute({})`. Queue compartida `QUEUE_NAMES.ANALYTICS_AGGREGATION` (producer + consumer alineados).
- **Flows tocados:** flow-001 (workers deployment topology), flow-004 (analytics ingest polling).
- **Notes:** Mismo hallazgo profundo: productor sin caller. Wireado.
- **Blocked by:** FN-015 (resuelto)

---

## §3 — Admin (single-surface) — 2 items

### FN-012 — 19 archivos DEAD en admin (revisión item-por-item en curso)

- **Surface(s):** admin
- **Categoría:** dead-code (bulk — auditor dijo 11, conteo real 19)
- **Status:** `IN_REVIEW` (1/19 cerrado, 18 pendientes)
- **Auditor recommendation:** `DELETE-NOW` (con revisión item-por-item del inventory-admin)
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Caja general — cada archivo se revisa con las 3 preguntas + verifica callers en `app/` antes de decidir. Pre-flight grep mostró que el auditor está incorrecto en varios items (consumers reales en `app/(dashboard)/`). Por item se anota status + decisión + acción.

#### Sub-items de FN-012

##### FN-012.1 — `components/queue/useQueueManager.tsx`

- **Status:** `RESOLVED`
- **3 preguntas:** (1) Hook TanStack Query para queue dashboard admin. (2) Fetch BullMQ jobs + stats con retry/cancel/delete mutations. (3) **SÍ existe equivalente canónico**: `hooks/api/useQueueManagement.ts` (sin "r" final) usa URL pattern correcto `/api/backend/admin/queue/...` y tiene callers reales en `components/maintenance/{FailedJobsTable,QueueHealthPanel}.tsx` + `app/(dashboard)/maintenance/page.tsx`.
- **Diagnóstico inicial mío:** wrong — propuse `WIRE-UI` creyendo que era forgotten-feature. La 3ra pregunta corregida expuso el duplicado canónico.
- **Auditor diagnostic:** correcto pero por motivo diferente — el auditor dijo "no consumers", la causa real es "superseded por implementación canónica con URL prefix correcto" (causa 2 de la memoria `feedback_three_questions_before_delete`).
- **Bug adicional descubierto:** `useQueueManager` usa `/api/backend/queue/...` (sin `admin/` prefix). Aunque tuviera UI, las fetches 404 porque el Next.js proxy forwarda a `${API_URL}/queue/...` y el backend está en `/admin/queue/...`. Era código no-funcional incluso si se "wireara".
- **Edward decision:** `APPROVE` (DELETE)
- **Decision date:** 2026-05-11
- **Action taken:** Deleted `apps/admin/components/queue/useQueueManager.tsx` + dir `apps/admin/components/queue/` (vacío post-delete). Typecheck admin clean.
- **Flows tocados:** flow-005 (admin queue management — workflow canónico preservado; el dup eliminado no participaba).
- **Blocked by:** —

#### FN-012 — pendientes (18)

Quedan 18 archivos clasificados DEAD por el auditor; cada uno requiere 3-preguntas + verify antes de decisión. Lista:

1. `components/pricing/ProviderTiersTab.tsx` — **FN-012.2** `RESOLVED` (REJECT, falso positivo). Consumer real en `app/(dashboard)/pricing/page.tsx:30,244`. Flow: flow-006. Decision: 2026-05-11.
2. `components/shared/AccessDenied.tsx` — **FN-012.3** `RESOLVED` (REJECT, falso positivo). 10+ callers en pages protegidas por rol (analytics, logs, subscriptions, billing/gateway-switches, dashboard root, compliance, webhooks, security/secrets, settings). Infraestructura UI transversal admin. Decision: 2026-05-11.
3. `components/shared/ErrorBoundary.tsx` — **FN-012.4** `RESOLVED` (APPROVE → DELETE). Reemplazo histórico (causa 2): Next.js 15 `app/error.tsx` native lo supersedes. Deleted componente + test. Decision: 2026-05-11.
4. `components/shared/SidebarNav.tsx` — **FN-012.5** `RESOLVED` (REJECT, falso positivo). Consumer crítico en `app/(dashboard)/layout.tsx:10,30` — ES el sidebar del layout. NO se borra. Decision: 2026-05-11.
5. `components/shared/SkipLink.tsx` — **FN-012.6** `RESOLVED` (CHANGE-ACTION → WIRE). Forgotten-feature: componente listo + target `id="main-content"` ya en layout; faltaba el mount. Wireado en `apps/admin/app/(dashboard)/layout.tsx` como primer hijo, antes del SidebarNav. Side effect: cliente NO tiene equivalente — elevado a `LATERAL_FINDINGS.md` L-649 para implementación consistente cross-app. Decision: 2026-05-11.
6. `components/shared/VisuallyHidden.tsx` — **FN-012.7** `RESOLVED` (APPROVE → DELETE). Reemplazo histórico: Tailwind `sr-only` class es el canon de facto del repo (usado en login-form, LoadingSpinner, accounts/page, dialog primitive). Deleted componente + test. Decision: 2026-05-11.
7. `hooks/api/useCompliance/types.ts` — **FN-012.8** `RESOLVED` (REJECT, falso positivo). Re-exportado por barrel `index.ts` + importado internamente por `api.ts/mutations.ts/queries.ts`. Hook useCompliance está vivo (compliance page + GdprSettingsForm + DsarTable). NO se borra. Decision: 2026-05-11.
8. `hooks/api/useContentLibrary.ts` — **FN-012.9** `RESOLVED` (DEFER + documentar). Scaffolding intencional para Admin Compliance Content Access (feature legal-protectora — read-only cross-tenant con audit trail inmutable, no vigilancia). Plan completo de wire-up (~1-2d) elevado a `LATERAL_FINDINGS.md` L-650: backend endpoint `/admin/compliance/content` + audit log + UI page + role gate COMPLIANCE_OFFICER + URL fix del hook. NO se borra el hook ni el test; son sustrato útil cuando producto/legal priorice. Decision: 2026-05-11.
9. `hooks/api/useGatewaySwitches/types.ts` — **FN-012.10** `RESOLVED` (REJECT, falso positivo). Re-exportado por barrel `index.ts` (`GatewaySwitchEvent`) + sustrato interno del módulo. Hook useGatewaySwitches alive (`/billing/gateway-switches/page.tsx`). flow-008 documentado. NO se borra. Decision: 2026-05-11.
10. `hooks/api/useMultiPlatformScheduling.ts` — **FN-012.11** `RESOLVED` (APPROVE → DELETE). Vestigio post-split admin↔client. Diff vs client: admin es subset estricto (5 hooks vs 8 client), parsea `body.value` (broken — backend canon usa `data`), sin auto-refetch. Client tiene 3 mutations extra (`useCreateSchedulingRule/Update/Toggle`) que admin no tiene. Nada que migrar de admin → client. Deleted hook + test. Cierra parcial: FN-030 (1/4 hooks orphan), FN-034 (admin side del dup), anticipa FN-012.18 (types dup). Decision: 2026-05-11.
11. `hooks/api/useOidcReplaceClientSecret.ts` — **FN-012.12** `RESOLVED` (REJECT, falso positivo). Consumer real en `app/(dashboard)/security/oidc/page.tsx:14,21`. Backend completo: `POST /admin/oidc/configurations/:accountId/replace-client-secret` + use case + domain entity. flow-012 documentado. NO se borra. Decision: 2026-05-11.
12. `hooks/api/usePerformanceInsights.ts` — **FN-012.13** `RESOLVED` (APPROVE → DELETE admin orphan + DEFER feature completa). Vestigio orphan: deleted hook + test. Análisis profundo expuso que la feature de "performance insights per-project" NO existe en backend — el endpoint `/admin/analytics/overview` ignora `projectId` y retorna business metrics agregadas (no content insights). Cliente componente + hook PRESERVADOS como scaffolding aspiracional. Plan completo de 6 fases (backend pipeline `GetPerformanceInsightsQuery` + endpoint customer + endpoint admin pattern C con audit log + wire client + wire admin section + cleanup legacy) elevado a `LATERAL_FINDINGS.md` L-651. Decision: 2026-05-11.
13. `hooks/api/usePosts.ts` — **FN-012.14** `RESOLVED` (APPROVE → DELETE + DEFER feature legítima). Hook orphan con shape cliente sin scope admin proper (sin audit, sin role gates, sin justification, sin endpoint admin-scoped). Edward confirmó: admin NO gestiona posts (cliente lo hace), pero SÍ debe poder moderar/eliminar en circunstancias legales/operacionales legítimas. Deleted hook + test. Plan completo de "Admin Post Moderation Pattern" (schema con `deletedByAdminAt/Id/Reason` + `contentSnapshot` + `ModerationCategory` + permission `CONTENT_MODERATE` + endpoints admin-scoped + appeals + integration con L-650/L-651) elevado como L-652 en LATERAL_FINDINGS. Side effect: confirma chain DEAD de `postsClient` (item 17 → automático). Decision: 2026-05-11.
14. `hooks/api/useSubscriptions.ts` — **FN-012.15** `RESOLVED` (REJECT, falso positivo). Consumer real en `app/(dashboard)/subscriptions/page.tsx:25,71`. Backend completo `GET /admin/subscriptions/summary`. flow-013 documentado. NO se borra. Decision: 2026-05-11.
15. `hooks/api/useUniversalAnalytics.ts` — **FN-012.16** `RESOLVED` (APPROVE → DELETE). Dead code total: 0 UI consumers + endpoint `GET /dashboard` no existe en backend + 0 reuso de tipos + sin client equivalent. Más severo que items anteriores (no es feature aspiracional sino scaffolding completamente desconectado). Deleted hook + test. Side effect: cierra otro 1/4 de FN-030. Decision: 2026-05-11.
16. `lib/api/clients/oidcAdminClient.ts` — **FN-012.17** `RESOLVED` (REJECT, falso positivo). 2 callers: `useOidcReplaceClientSecret` (alive, FN-012.12) importa types + `apiClient.ts:109` re-exporta el método como `api.security.oidc.replaceClientSecret`. Sustrato del flow-012 (admin OIDC + secret rotation). NO se borra. Decision: 2026-05-11.
17. `lib/api/clients/postsClient.ts` — **FN-012.18** `RESOLVED` (APPROVE → DELETE). Chain dead confirmado tras FN-012.14 (usePosts deleted): 0 consumers de `api.listPosts/createPost/getPost/publish/listLogs/deletePost` fuera de apiClient. JSDoc explicitamente declaraba "legacy ... kept for compatibility with the existing dashboard" — el dashboard ya no existe. Deleted `postsClient.ts` + trimmed 7 líneas en `apiClient.ts` (1 import + 6 re-exports). Typecheck clean. Decision: 2026-05-11.
18. `types/multi-platform-scheduling.ts` — **FN-012.19** `RESOLVED` (APPROVE → DELETE). Chain dead post-FN-012.11: 0 consumers tras delete del único caller (useMultiPlatformScheduling admin). Deleted file + empty parent dir `apps/admin/types/` también removida. Cierra FN-035 admin-side (admin↔client dup). Decision: 2026-05-11.

**FN-012 GLOBAL: RESOLVED (19/19 sub-items)** ✅

- **Eliminados (8)**: FN-012.1 (useQueueManager), FN-012.4 (ErrorBoundary), FN-012.7 (VisuallyHidden), FN-012.11 (useMultiPlatformScheduling admin), FN-012.13 (usePerformanceInsights admin orphan), FN-012.14 (usePosts), FN-012.16 (useUniversalAnalytics), FN-012.18 (postsClient), FN-012.19 (types/multi-platform-scheduling).
- **Falsos positivos del auditor (8)**: FN-012.2 (ProviderTiersTab), FN-012.3 (AccessDenied), FN-012.5 (SidebarNav), FN-012.8 (useCompliance/types), FN-012.10 (useGatewaySwitches/types), FN-012.12 (useOidcReplaceClientSecret), FN-012.15 (useSubscriptions), FN-012.17 (oidcAdminClient).
- **Wire-up (1)**: FN-012.6 (SkipLink WCAG 2.1 wired al layout, flow-007).
- **Diferidos con plan en LATERAL_FINDINGS (2)**: FN-012.9 (useContentLibrary → L-650 compliance content), FN-012.13 (usePerformanceInsights, ya deleted admin orphan, deuda L-651 + L-652 documentadas).
- **Side effects resueltos automáticamente**:
  - FN-030 (4 hooks orphan post-split) — RESOLVED via 4 deletes (useContentLibrary deferred, useMultiPlatformScheduling deleted, usePerformanceInsights deleted, useUniversalAnalytics deleted).
  - FN-034 (useMultiPlatformScheduling admin↔client dup) — RESOLVED admin-side.
  - FN-035 (multi-platform-scheduling types dup) — RESOLVED admin-side.
  - FN-038 (stale endpoint refs heredadas) — RESOLVED via deletes.
- **Lateral findings nuevos generados durante FN-012**:
  - L-649 (SkipLink WCAG 2.1 gap en cliente).
  - L-650 (Admin Compliance Content Access).
  - L-651 (Performance Insights feature backend pipeline).
  - L-652 (Admin Post Moderation Pattern).
- **Flows documentados (8 nuevos)**: flow-005 (queue mgmt), flow-006 (pricing), flow-007 (skip-link), flow-008 (gateway switches), flow-009 (RBAC chrome), flow-010 (sidebar chrome), flow-011 (compliance), flow-012 (OIDC rotation), flow-013 (subscriptions).

### FN-030 — Test endpoint analytics (legacy hooks orphan)

- **Surface(s):** admin
- **Categoría:** forgotten-feature (legacy)
- **Status:** `PENDING`
- **Auditor recommendation:** `DELETE-NOW`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** 4 hooks orphan: useContentLibrary, useUniversalAnalytics, useMultiPlatformScheduling, usePerformanceInsights. Solapa con FN-012 (es subset). Resuelve también FN-038.
- **Blocked by:** —

---

## §4 — Client (single-surface) — 2 items

### FN-036 — usePerformanceInsights llama admin endpoint desde client

- **Surface(s):** client
- **Categoría:** mismatch (security + functional)
- **Status:** `RESOLVED`
- **Auditor recommendation:** `FIX-NOW`
- **Edward decision:** `APPROVE` (DELETE clean-slate + DEFER backend a L-651)
- **Decision date:** 2026-05-11
- **Action taken:** Deleted toda la cadena rota: `apps/client/app/dashboard/analytics/insights/page.tsx` (wrapper con `accountId=""` hardcoded), `apps/client/hooks/api/usePerformanceInsights.ts` (URL incorrecta llamando admin endpoint), `apps/client/components/analytics/PerformanceInsights.tsx` (274 LOC UI design), y la subdir `apps/client/components/analytics/insights/` (9 archivos chain dead: PerformanceInsightsHeader, AudienceInsightsPanel, HashtagPerformancePanel, OptimalTimingPanel, RecommendationsList, TopPerformingContent, LoadingState, types.ts, utils.ts). Total: 12 archivos + 1 ruta Next removida.
- **Flows tocados:** ninguno actualmente (feature estaba rota); flow futuro se documentará cuando L-651 se implemente.
- **Notes:** Decisión clean-slate: preservar scaffolding aspiracional creaba chain dead que el próximo audit re-flagería. Git history retiene los ~454 LOC del cliente + admin orphan como referencia de diseño. L-651 actualizado: Fase 4 + Fase 5 ahora describen "build fresh", no "wire URL". Typecheck cliente clean.
- **Blocked by:** L-651 (backend pipeline + endpoints + UI build) cuando producto priorice.

### FN-037 — useReports paths para verificar

- **Surface(s):** client
- **Categoría:** mismatch (potencial → falso positivo confirmado)
- **Status:** `RESOLVED`
- **Auditor recommendation:** `VERIFY`
- **Edward decision:** `REJECT` (verificación pasa, falso positivo)
- **Decision date:** 2026-05-11
- **Action taken:** Verificación URL-por-URL: los 4 endpoints del hook (`GET/POST/DELETE /reports` + `POST /reports/:id/generate`) existen en `apps/api/src/reports/reportRoutes.ts` (líneas 324/362/342/351). Consumers reales: `CreateReportForm.tsx` + `ScheduledReportsList.tsx` montados en `apps/client/app/dashboard/analytics/reports/page.tsx`. flow-014 documentado. NO se borra.
- **Flows tocados:** flow-014 (client scheduled reports management).
- **Notes:** Backend además tiene `PATCH /reports/:id` que el hook no usa (update functionality no expuesta, no bloquea). Gap separado: FN-024 (Scheduled Reports cron no wired) — manual generation funciona, recurring automático no.
- **Blocked by:** —

---

## §5 — Packages (single-surface) — 13 items

### FN-005 — DLQ adapter duplicado

- **Surface(s):** packages
- **Categoría:** superseded
- **Status:** `PENDING`
- **Auditor recommendation:** `DELETE-NOW` (el non-port-bound, mantener `BullMQDeadLetterQueueAdapter`)
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Verificar feature parity antes de borrar. Adapter rico además **viola canon** (raw pino + env reads).
- **Blocked by:** —

### FN-011 — packages/core/planPublication.ts solo en tests

- **Surface(s):** packages
- **Categoría:** dead-code
- **Status:** `PENDING`
- **Auditor recommendation:** `DELETE-NOW` + considerar disolver `packages/core`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** NEEDS_EDWARD — decisión arquitectura sobre si disolver el sub-package.
- **Blocked by:** —

### FN-017 — Queue `recurring-posts` huérfana

- **Surface(s):** packages
- **Categoría:** dead-code
- **Status:** `PENDING`
- **Auditor recommendation:** `DELETE-NOW`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Coincide con spinoff PR-Recurring-Posts (planeado, no abandonado). Quitar constante hasta que se priorice.
- **Blocked by:** —

### FN-018 — Queue `detect-repurpose` huérfana

- **Surface(s):** packages
- **Categoría:** dead-code
- **Status:** `PENDING`
- **Auditor recommendation:** `DELETE-NOW`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Coincide con spinoff PR-Repurpose-AI-Pipeline.
- **Blocked by:** —

### FN-019 — Queue `triage-inbox` huérfana

- **Surface(s):** packages
- **Categoría:** dead-code
- **Status:** `PENDING`
- **Auditor recommendation:** `DELETE-NOW`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Coincide con spinoff PR-Triage-AI-Inbox.
- **Blocked by:** —

### FN-020 — Queue `trend-radar` huérfana

- **Surface(s):** packages
- **Categoría:** dead-code
- **Status:** `PENDING`
- **Auditor recommendation:** `DELETE-NOW` la queue + `DECIDE` sobre el servicio mock
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Backend `trendAnalysisService.ts` retorna mock viralDNA (PR-52). Decidir si cliente confiando en datos falsos es aceptable hasta que esté wireado.
- **Blocked by:** —

### FN-021 — Queue `report-generation` huérfana

- **Surface(s):** packages · client
- **Categoría:** dead-code
- **Status:** `PENDING`
- **Auditor recommendation:** `DELETE-NOW` la queue (banner del cliente queda válido)
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Cliente tiene banner "Manual generation only — cron not wired". Resuelve también escenario de FN-024.
- **Blocked by:** —

### FN-042 — ProviderId declarado en 3 lugares con "twitter" vs "x"

- **Surface(s):** packages
- **Categoría:** drift
- **Status:** `PENDING`
- **Auditor recommendation:** `DECIDE`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** NEEDS_EDWARD — ¿hay compat externa con tabla `provider="twitter"`? Si no → consolidar a `"x"` (implica migración data). Si sí → documentar divergencia intencional.
- **Blocked by:** —

### FN-044 — 15 archivos en packages con `import pino` directo

- **Surface(s):** packages
- **Categoría:** canon-deviation (soft)
- **Status:** `PENDING`
- **Auditor recommendation:** `DEFER` (a menos que sea prioridad uniformidad)
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Fitness #13 actualmente solo cubre `apps/api/src/`. Migrar + extender check ~2-3h.
- **Blocked by:** —

### FN-045 — 29 archivos sin @layer header

- **Surface(s):** packages
- **Categoría:** canon-deviation (medio)
- **Status:** `PENDING`
- **Auditor recommendation:** `FIX-NOW`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Fitness #10 hard-zero debería estar fallando CI. ~1h con script asistido.
- **Blocked by:** —

### FN-046 — packages/providers/\_template/ env reads

- **Surface(s):** packages
- **Categoría:** canon-allow-list (intencional)
- **Status:** `PENDING`
- **Auditor recommendation:** `NO-ACTION` (preservar como está)
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Scaffolding educativo. Confirmar que JSDoc explica la intención.
- **Blocked by:** —

### FN-047 — CRM adapters (HubSpot / Salesforce)

- **Surface(s):** packages
- **Categoría:** UNKNOWN
- **Status:** `PENDING`
- **Auditor recommendation:** `VERIFY`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Posible factory-dispatched via DI. Grep callers reales.
- **Blocked by:** —

### FN-048 — Storage adapters non-S3

- **Surface(s):** packages
- **Categoría:** UNKNOWN
- **Status:** `PENDING`
- **Auditor recommendation:** `VERIFY`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** NEEDS_EDWARD — decisión multi-cloud. Adapters azure/cloudinary/gcs sin caller directo.
- **Blocked by:** —

---

## §6 — Cross-application — 16 items

> Items que requieren cambios coordinados en 2+ apps. Scope de trabajo más complejo; cada uno necesita decisión clara sobre quién hace qué y en qué orden.

### FN-004 — autoRenewalWorker duplica TrialManagementService

- **Surface(s):** workers · api
- **Categoría:** superseded
- **Status:** `PENDING`
- **Auditor recommendation:** `DELETE-NOW` (con confirmación SoT)
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** NEEDS_EDWARD — Dual-write risk: dos procesos pueden cobrar la misma suscripción si race. Preferencia auditor: api con saga, no worker legacy.
- **Blocked by:** —

### FN-023 — PredictiveAnalytics ML — UI ↔ 501

- **Surface(s):** client · api
- **Categoría:** forgotten-feature
- **Status:** `PENDING`
- **Auditor recommendation:** `WIRE-BACKEND` o `WIRE-UI` (deshabilitar)
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** NEEDS_EDWARD. Wire backend: XL (requiere infra ML). Deshabilitar UI: S. Auditor recomienda (b) ahora, (a) cuando producto priorice.
- **Blocked by:** —

### FN-024 — Scheduled Reports cron no wired

- **Surface(s):** api · client · workers
- **Categoría:** forgotten-feature
- **Status:** `PENDING`
- **Auditor recommendation:** `WIRE-BACKEND`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Backend servicio + use case existen, solo falta scheduler que dispare por cron. ~2-4h.
- **Blocked by:** FN-015 (decisión bootstrap workers topology)

### FN-025 — AI quality fields sin backend

- **Surface(s):** client · api
- **Categoría:** forgotten-feature
- **Status:** `PENDING`
- **Auditor recommendation:** `DECIDE`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** NEEDS_EDWARD. (a) calcular en backend (M=4-8h, heurística simple); (b) ocultar campos en UI hasta backend real.
- **Blocked by:** —

### FN-027 — rateLimitingDashboard sin UI consumer

- **Surface(s):** api · admin
- **Categoría:** forgotten-feature
- **Status:** `PENDING`
- **Auditor recommendation:** `DECIDE` (mismo que FN-010)
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** NEEDS_EDWARD. Bundle con FN-010.
- **Blocked by:** FN-010

### FN-028 — Settings/referral page sin route backend

- **Surface(s):** client · api
- **Categoría:** mismatch / forgotten-feature
- **Status:** `PENDING`
- **Auditor recommendation:** `DECIDE` + `WIRE-BACKEND` si feature es real
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** NEEDS_EDWARD — ¿programa de referrals es feature activa?
- **Blocked by:** —

### FN-029 — Admin webhook subscription selector roto

- **Surface(s):** admin · api
- **Categoría:** mismatch
- **Status:** `PENDING`
- **Auditor recommendation:** `FIX-NOW`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** NEEDS_EDWARD — decisión permisos: ¿admin ve projects de todas las accounts? Si yes → SUPER_ADMIN gate + endpoint nuevo.
- **Blocked by:** —

### FN-031 — sessionCookie helper duplicado

- **Surface(s):** admin · client
- **Categoría:** duplication
- **Status:** `PENDING`
- **Auditor recommendation:** `CONSOLIDATE-TO-PACKAGE`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Crear `@packages/auth-cookie` o usar `@packages/api-common`. ~1h.
- **Blocked by:** —

### FN-032 — LoadingSpinner duplicado

- **Surface(s):** admin · client
- **Categoría:** duplication
- **Status:** `PENDING`
- **Auditor recommendation:** `CONSOLIDATE-TO-PACKAGE`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Mover a `@packages/ui/LoadingSpinner`. ~15 min.
- **Blocked by:** —

### FN-033 — notificationStore (Zustand) duplicado

- **Surface(s):** admin · client
- **Categoría:** duplication
- **Status:** `PENDING`
- **Auditor recommendation:** `CONSOLIDATE-TO-PACKAGE` (después de confirmar idénticos)
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Diff primero. Si idénticos → `@packages/state` o `@packages/ui/stores`.
- **Blocked by:** —

### FN-034 — useMultiPlatformScheduling hook duplicado

- **Surface(s):** admin · client
- **Categoría:** duplication
- **Status:** `PENDING`
- **Auditor recommendation:** `DELETE-NOW` (la versión admin vestigio) o `CONSOLIDATE`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Diff primero. Solapa con FN-030 si admin es vestigio.
- **Blocked by:** —

### FN-035 — multi-platform-scheduling types duplicados

- **Surface(s):** admin · client
- **Categoría:** duplication
- **Status:** `PENDING`
- **Auditor recommendation:** `CONSOLIDATE-TO-PACKAGE`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Mover a `@shared/types`. ~15 min.
- **Blocked by:** —

### FN-038 — Stale endpoint references heredadas

- **Surface(s):** client · admin
- **Categoría:** mismatch
- **Status:** `PENDING`
- **Auditor recommendation:** `FIX-NOW` o `DELETE-NOW` (los hooks que llaman)
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Duplicado funcional de FN-030.
- **Blocked by:** FN-030

### FN-039 — Saga payload shapes vs producer

- **Surface(s):** api · workers
- **Categoría:** mismatch
- **Status:** `PENDING`
- **Auditor recommendation:** `FIX-NOW` (si keep) o `DELETE-NOW` (si discard)
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Se resuelve si FN-014 (delete instagram worker) se ejecuta.
- **Blocked by:** FN-014

### FN-040 — SemanticLockPort impl en apps/api en lugar de packages/adapters

- **Surface(s):** packages · api
- **Categoría:** architectural-violation
- **Status:** `PENDING`
- **Auditor recommendation:** `DECIDE`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** NEEDS_EDWARD — (a) mover impl a `packages/adapters/semantic-lock-postgres`; (b) mover port a `apps/api/src/domain/ports/`. Decisión arquitectura.
- **Blocked by:** —

### FN-041 — PaymentAdapter impls en apps/api/billing en lugar de packages

- **Surface(s):** packages · api
- **Categoría:** architectural-violation
- **Status:** `PENDING`
- **Auditor recommendation:** `DECIDE`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** NEEDS_EDWARD. Misma decisión que FN-040 pero con consideración extra: si centralizamos billing en api (relacionado FN-004), mover adapter no aporta.
- **Blocked by:** FN-004

---

## Flow inventory

> Catálogo de flows end-to-end que la auditoría toca / repara / preserva. Al cerrar la ronda de findings, esta lista es el input para el plan de smoke / e2e tests.

### flow-001 — Workers deployment topology

- **Descripción:** Un solo container de workers ejecuta `bootstrap.js` que spawnea publishWorker + inboxSyncWorker + analyticsIngestWorker en un solo proceso Node con shutdown unificado (SIGTERM/SIGINT drena los 3 en orden).
- **Findings:** FN-014, FN-015, FN-016
- **Componentes end-to-end:** `apps/workers/Dockerfile` (CMD) → `apps/workers/src/bootstrap.ts` → `startPublishWorker()` + `startInboxSyncWorker()` + `startAnalyticsIngestWorker()` → composed `ShutdownTarget` → unified `registerGracefulShutdown`.
- **Smoke check propuesto:** En CI/dev — `docker run` de la imagen workers + log inspection: confirmar que aparecen las 3 líneas "started" + "Bootstrapping workers process" + "All workers started; bootstrap idle". Luego `docker kill --signal=SIGTERM <container>` y validar que las 3 líneas "Worker shutdown complete" aparecen antes de exit 0.
- **Notas:** `autoRenewalWorker.ts` NO está en este bootstrap (decisión separada FN-004 cross-app). Standalone usage de cada worker .js sigue funcionando via `import.meta.url` main-module guard.

### flow-002 — Instagram publish path

- **Descripción:** Publicación de posts a Instagram via el publishWorker canónico (no per-provider). El path único previene races sobre `QUEUE_NAMES.PUBLISH`.
- **Findings:** FN-014 (negative: confirmado canonical, eliminado duplicate per-provider worker que era footgun)
- **Componentes end-to-end:** API saga → BullMQ `QUEUE_NAMES.PUBLISH` → `publishWorker.ts` → `createInstagramAdapter` → Instagram Graph API.
- **Smoke check propuesto:** Saga `publishPostSaga` con un Channel de provider=INSTAGRAM → verificar que el job consumido por `publishWorker` (no `providers/instagram/publishingWorker.ts`, que ya no existe) → llamada real (o stubbed en CI) a Instagram → `Post.status = PUBLISHED`.
- **Notas:** Pre-FN-014 había un footgun: si alguien arrancaba el per-provider worker en paralelo, ambos competirían por la misma queue. Ya no posible.

### flow-003 — Inbox sync polling (comments + mentions)

- **Descripción:** Cada 30 minutos el API enqueola 1 job por canal activo en `QUEUE_NAMES.INBOX_SYNC`. El worker pulle comments/mentions del provider adapter y los persiste en `SocialMessage`. El cliente `/dashboard/inbox` los muestra.
- **Findings:** FN-015
- **Componentes end-to-end:** `apps/api/src/index.ts` → `scheduler.register("inbox-sync-dispatch", …, 30 min)` → `DispatchInboxSyncUseCase.execute({})` → `QueuePort.enqueue` → BullMQ `inbox-sync` queue → `apps/workers/src/inboxSyncWorker.ts` (vía `bootstrap.ts`) → `provider.getComments` → `prisma.socialMessage.create` → cliente lee via `/api/inbox/...` routes.
- **Smoke check propuesto:** (1) Seed: 1 CustomerUser OWNER + 1 Channel activo (provider con `getComments` soportado). (2) Esperar 30 min OR llamar `DispatchInboxSyncUseCase.execute({})` manualmente vía endpoint admin. (3) Verificar 1+ `SocialMessage` rows con `messageType=COMMENT`. (4) GET `/api/inbox/conversations` desde cliente → ver los mensajes.
- **Notas:** Providers sin `getComments` (e.g., algunos sin comments API) se skip a debug-level. Auth errors flagean el canal vía `handleProviderAuthError`. Idempotencia via `prisma.socialMessage.findFirst` con `providerMessageId`.

### flow-004 — Analytics ingest polling (métricas de posts)

- **Descripción:** Cada 6 horas el API enqueola 1 job por canal activo en `QUEUE_NAMES.ANALYTICS_AGGREGATION`. El worker pulle métricas (impressions/engagement) del provider adapter y upsertea en `AnalyticsDailySummary`. El cliente `/dashboard/analytics` los muestra.
- **Findings:** FN-016
- **Componentes end-to-end:** `apps/api/src/index.ts` → `scheduler.register("analytics-ingest-dispatch", …, 6 h)` → `DispatchAnalyticsIngestionUseCase.execute({})` → `QueuePort.enqueue` → BullMQ `analytics-aggregation` queue → `apps/workers/src/analyticsIngestWorker.ts` (vía `bootstrap.ts`) → `provider.getAnalytics` → `prisma.analyticsDailySummary.upsert` → cliente lee via `/api/analytics/...` routes.
- **Smoke check propuesto:** (1) Seed: 1 Channel activo con post publicado >24h atrás. (2) Esperar 6h OR trigger manual de `DispatchAnalyticsIngestionUseCase.execute({})`. (3) Verificar `AnalyticsDailySummary` upserted con impressions/engagement no-nulos. (4) GET `/api/analytics/overview` desde cliente → ver agregado.
- **Notas:** Lookback de 30 días en el dispatch. Idempotencia via upsert clave (channelId, date). Providers sin `getAnalytics` se skip.

### flow-005 — Admin queue management dashboard

- **Descripción:** Página admin de gestión operacional de queues BullMQ: stats de la queue principal, jobs fallidos con razón de fallo, retry/remove acciones. La página existe y funciona; documentada aquí porque tiene cobertura e2e pendiente y porque FN-012.1 (delete `useQueueManager.tsx` duplicado obsoleto) tocó el área.
- **Findings:** FN-012.1 (negative: confirmado canonical, eliminado duplicate con URL pattern incorrecto)
- **Componentes end-to-end:** Admin browser → `app/(dashboard)/maintenance/page.tsx` → `components/maintenance/{QueueHealthPanel,FailedJobsTable,ScheduledJobsPanel}.tsx` → `hooks/api/useQueueManagement.ts` → fetch `/api/backend/admin/queue/{stats,jobs,jobs/:id/retry,jobs/:id/remove}` → Next.js proxy `app/api/backend/[...path]/route.ts` (inyecta admin-session JWT) → API Fastify `apps/api/src/admin/queueRoutes.ts` (registrado en `index.ts:480`) → BullMQ adapter → Redis.
- **Smoke check propuesto:** (1) Login admin con `admin@omnipost.local`. (2) Navegar a `/maintenance`. (3) Confirmar que `QueueHealthPanel` muestra stats no-nulos (total/queued/processing/published/failed). (4) Si hay un job failed visible: click `Retry` → confirmar que `POST /api/backend/admin/queue/jobs/:id/retry` retorna 200 + el job desaparece de la lista failed tras refetch. (5) Click `Remove` en un job seed-injected (idempotente) → confirmar el remove también funciona.
- **Notas:** El **URL prefix canónico es `/api/backend/admin/queue/...`** (con `admin/` después de `backend/`). Hooks que omiten ese prefijo 404 silencioso. El proxy Next.js `[...path]/route.ts` forwarda `/api/backend/<segments>` → `${API_URL}/<segments>` sin reescribir, por lo que el cliente DEBE incluir `admin/` en el path. Verificado en `useQueueManagement.ts` (canon) vs `useQueueManager.tsx` (obsoleto, deleted en FN-012.1).

### flow-006 — Admin pricing dashboard (provider tiers + account tiers + bundles)

- **Descripción:** Página admin para gestionar la matriz de pricing: provider tiers (precio por provider), account tiers (planes por capacidad), y bundles (paquetes). UI con tablas inline-editable, toggle de status, create/edit dialogs.
- **Findings:** FN-012.2 (false-positive — confirmado canonical, NO borrado).
- **Componentes end-to-end:** Admin browser → `app/(dashboard)/pricing/page.tsx` → `components/pricing/{ProviderTiersTab,AccountTiersTab,BundleFormDialog}.tsx` → `hooks/api/usePricingTiers/{queries,mutations}.ts` → fetch `/api/backend/admin/pricing/{tiers,provider-tiers,account-tiers,bundles}` → Next.js proxy `app/api/backend/[...path]/route.ts` → API Fastify `apps/api/src/admin/pricingRoutes.ts` (8 endpoints registrados) → Prisma → DB tables `ProviderPricingTier`, `AccountPricingTier`, `Bundle`.
- **Smoke check propuesto:** (1) Login admin. (2) Navegar a `/pricing`. (3) Verificar que `ProviderTiersTab` carga rows. (4) Inline-edit un tier (e.g., cambiar `pricePerProviderMonth`) → confirmar `PATCH /api/backend/admin/pricing/provider-tiers/:id` retorna 200 + UI refleja el cambio tras refetch. (5) Toggle status de un tier → confirmar persiste. (6) Repetir con `AccountTiersTab`. (7) Crear un bundle nuevo via `BundleFormDialog` → confirmar `POST /api/backend/admin/pricing/bundles` retorna 200 + bundle aparece en la lista.
- **Notas:** Pricing es crítico para billing; cualquier regression aquí afecta revenue. Bundle + tier shapes están validados en `apps/api/src/admin/pricingRoutes.ts` con Zod. Seed crea 3 provider pricing tiers de baseline.

### flow-007 — Admin a11y skip-link (WCAG 2.1)

- **Descripción:** Link de accesibilidad WCAG 2.1 "Skip to main content" en el admin dashboard. Hidden off-screen por default; visible al focusearse por keyboard (Tab desde el inicio de la página). Permite usuarios de teclado / screen-reader saltar la navegación lateral.
- **Findings:** FN-012.6 (WIRE).
- **Componentes end-to-end:** Admin browser → `apps/admin/app/(dashboard)/layout.tsx` monta `<SkipLink />` como primer hijo de `<AuthProvider>` → tecla Tab focalea el link → click/Enter navega a `#main-content` (id en el `<main>` del mismo layout, línea 34) → focus salta a la región de contenido principal.
- **Smoke check propuesto:** (1) Login admin. (2) Cualquier página `/maintenance`, `/pricing`, `/analytics`, etc. (3) Sin haber hecho click en ningún sitio, presionar Tab. (4) Verificar que aparece visualmente un link "Skip to main content" en top-left (fixed position con bg accent). (5) Enter sobre el link → focus debe saltar al `<main>` (verificable con `document.activeElement` o inspector). (6) Test automatizable con Playwright: `await page.keyboard.press("Tab"); await expect(page.locator("text=Skip to main content")).toBeVisible();`.
- **Notas:** Cliente NO tiene equivalente — gap a11y elevado como L-649 en `LATERAL_FINDINGS.md`. Cuando se cierre L-649, considerar mover SkipLink a `@packages/ui` para no-drift entre admin y client.

### flow-008 — Admin gateway switches management

- **Descripción:** Página admin para gestionar transiciones de gateway de pago (Stripe ↔ Paddle) por tenant: ver eventos programados, completar/cancelar/suspender forzosamente, extender deadlines.
- **Findings:** FN-012.10 (false-positive — confirmado canonical, NO borrado).
- **Componentes end-to-end:** Admin browser → `app/(dashboard)/billing/gateway-switches/page.tsx` → `hooks/api/useGatewaySwitches/{queries,mutations}.ts` → fetch `/api/backend/admin/billing/gateway-switches/{,:id,events}` → Next.js proxy → API Fastify `apps/api/src/billing/adminBillingRoutes.ts` → `GatewaySwitchService` → Prisma → DB.
- **Smoke check propuesto:** (1) Login admin. (2) Navegar `/billing/gateway-switches`. (3) Verificar lista de eventos con sus estados (SCHEDULED / PENDING_CHECKOUT / COMPLETED / etc.). (4) Sobre un evento SCHEDULED: `Extend deadline` (`useExtendSwitchDeadline`) → confirmar el nuevo deadline persiste. (5) Sobre un evento PENDING_CHECKOUT: `Force complete` (`useForceCompleteSwitch`) → confirmar transición a COMPLETED. (6) Sobre un evento SCHEDULED: `Force suspend` → confirmar transición a SUSPENDED.
- **Notas:** Las mutations son operacionales destructivas — UI debería confirmar con dialog. Side-effect: cada switch dispara entries en AuditLog (acción admin auditada).

### flow-009 — Admin role-based access control chrome

- **Descripción:** Componente UI compartido para mostrar pantalla 403 "Access Denied" cuando una página admin detecta que el usuario no tiene rol suficiente. Reemplaza el contenido de la página con un mensaje + ícono + link de vuelta.
- **Findings:** FN-012.3 (false-positive — confirmado canonical, NO borrado).
- **Componentes end-to-end:** Page admin → hook query (e.g., `useAnalyticsOverview`) → backend retorna 403 → page detecta y renderea `<AccessDenied />` en vez del contenido → user ve pantalla de permiso denegado.
- **Smoke check propuesto:** (1) Login admin con rol bajo (e.g., SUPPORT). (2) Navegar a una página que requiera SUPER_ADMIN (`/security/secrets`, `/billing/gateway-switches`, `/compliance`, `/webhooks`, `/settings`). (3) Confirmar que aparece el componente `AccessDenied` con ícono ShieldOff + mensaje i18n + props `requiredRole` mostrado correctamente. (4) Repetir login con SUPER_ADMIN → confirmar que la página renderea su contenido normal.
- **Notas:** Componente transversal — 10+ páginas admin lo usan. La consistencia visual del 403 cross-pages depende de él.

### flow-010 — Admin dashboard navigation chrome

- **Descripción:** Sidebar nav colapsable del dashboard admin con todos los links a secciones (Dashboard, Users, Billing, Compliance, etc.), controles globales (theme toggle, language switcher, logout) y el user-name/role badge.
- **Findings:** FN-012.5 (false-positive — confirmado canonical, NO borrado).
- **Componentes end-to-end:** `app/(dashboard)/layout.tsx` (autentica) → `<SidebarNav userName={user.name} userRole={user.role} />` (en línea 30 del layout, ahora después del SkipLink wireado en FN-012.6) → navegación interna entre todas las páginas admin via Next.js Link.
- **Smoke check propuesto:** (1) Login admin. (2) Confirmar el sidebar aparece a la izquierda con todos los links visibles. (3) Click colapsar → sidebar se reduce a íconos. (4) Click theme toggle → tema light/dark cambia. (5) Click language switcher → locale persiste (cookie + reload). (6) Click logout → redirige a `/login`.
- **Notas:** Chrome del dashboard — todas las páginas autenticadas admin dependen de este componente. Removerlo rompe completamente la navegación.

### flow-011 — Admin compliance dashboard (DSAR + breach reports + settings)

- **Descripción:** Página admin para gestionar cumplimiento RGPD / privacidad: lista de DSARs (Data Subject Access Requests), reportes de breaches, settings de GDPR + Security, y score de compliance agregado.
- **Findings:** FN-012.8 (false-positive — types.ts del módulo, confirmado canonical, NO borrado).
- **Componentes end-to-end:** Admin browser → `app/(dashboard)/compliance/page.tsx` → `components/compliance/{GdprSettingsForm,DsarTable,BreachReportsTable,ComplianceScoreBadge}.tsx` → `hooks/api/useCompliance/{queries,mutations}.ts` (con `types.ts` como sustrato compartido) → fetch `/api/backend/admin/compliance/{metrics,audit-logs,dsar,breaches,settings/gdpr,settings/security,score}` → API Fastify `apps/api/src/compliance/complianceRoutes.ts` → Prisma → DB tables `GdprSettings`, `SecuritySettings`, `DsarRequest`, `BreachReport`, `ComplianceAuditLog`.
- **Smoke check propuesto:** (1) Login admin con permiso compliance. (2) Navegar `/compliance`. (3) Verificar el ComplianceScore se calcula y muestra. (4) Listar DSARs pendientes → acknowledge uno → confirmar transición de estado y entry en audit log. (5) Crear breach report nuevo → confirmar aparece en la lista. (6) Editar GDPR settings (e.g., `dataRetentionDays`) → confirmar persiste.
- **Notas:** Cuando L-650 (Admin Compliance Content Access) se implemente, esta página debería ganar una tab o ruta hija `/compliance/content` (ver L-650 para el plan completo).

### flow-012 — Admin OIDC configuration + client secret rotation

- **Descripción:** Página admin para gestionar OIDC SSO configurations por account: registro, edición, y rotación de client secret. La rotación incluye discovery handshake contra el IdP antes de comprometer el nuevo secret (rollback automático si falla).
- **Findings:** FN-012.12 (false-positive — confirmado canonical, NO borrado).
- **Componentes end-to-end:** Admin browser → `app/(dashboard)/security/oidc/page.tsx` → `hooks/api/useOidcReplaceClientSecret.ts` + (otros hooks OIDC) → `lib/apiClient.ts` (api.security.oidc.replaceClientSecret) → `lib/api/clients/oidcAdminClient.ts` → fetch `/api/backend/admin/oidc/configurations/:accountId/replace-client-secret` → Next.js proxy → API Fastify `apps/api/src/admin/oidcAdminRoutes.ts` → `ReplaceOidcClientSecretUseCase` → discovery handshake → `OidcConfiguration.replaceClientSecret()` (domain) → Prisma upsert encrypted secret en DB.
- **Smoke check propuesto:** (1) Login admin SUPER_ADMIN. (2) Seed: account con OIDC config existente (handshake URL válida — usar IdP mock o Keycloak local). (3) Navegar `/security/oidc`. (4) Para el account, ingresar nuevo client secret (copiado de la consola del IdP). (5) Submit → confirmar que la mutation invoca `POST /admin/oidc/configurations/:accountId/replace-client-secret`. (6) Verificar respuesta 200 con `rotation: { ... }` y mensaje de éxito en UI. (7) Verificar entry en DB con secret rotado + entry en AuditLog. (8) Test negativo: ingresar secret inválido → discovery handshake falla → confirmar error del IdP surface en UI y el secret viejo NO se sobrescribe.
- **Notas:** Crítico para customers SSO-enterprise. Si la rotación falla pero el secret se sobrescribe en DB, customer queda locked-out de su propio SSO. El handshake-before-commit lo protege. Audit trail mandatorio: cada rotación queda registrada con `actorId, accountId, timestamp`.

### flow-013 — Admin subscriptions management dashboard

- **Descripción:** Página admin que muestra el estado agregado de subscriptions: total activas, distribución por plan (Free / Pro / Enterprise), MRR estimate, churn, trials, canceladas, grandfathered. Para platform-ops monitoring del business model.
- **Findings:** FN-012.15 (false-positive — confirmado canonical, NO borrado).
- **Componentes end-to-end:** Admin browser → `app/(dashboard)/subscriptions/page.tsx` → `hooks/api/useSubscriptions.ts` → `lib/apiClient.ts` (`api.admin.getSubscriptionSummary()`) → fetch `/api/backend/admin/subscriptions/summary` → Next.js proxy → API Fastify `apps/api/src/admin/dashboardRoutes.ts:156` (handler `getSubscriptionsSummary`) → `DashboardService.getSubscriptionsSummary()` → Prisma queries (`AccountSubscription`, `SubscriptionPriceHistory`, `Account.trialEndDate`) → response agregado.
- **Smoke check propuesto:** (1) Login admin con `Permission.DASHBOARD_VIEW`. (2) Navegar `/subscriptions`. (3) Verificar StatCards: total subscriptions, breakdown por status (ACTIVE / TRIALING / GRANDFATHERED / CANCELED / EXPIRED), MRR, distribución por plan. (4) Si seed contiene los 10 test accounts: verificar conteos coinciden con la distribución seedeada (alpha=ACTIVE, beta=TRIALING, etc.). (5) `refetch()` post-mutation de account (e.g., cancel trial vía admin) → confirmar valores actualizan.
- **Notas:** Stale time 60s (refresh manual or wait). Crítico para revenue oversight; cualquier regression aquí oculta métricas business del platform-operator.

### flow-014 — Client scheduled reports management

- **Descripción:** Página cliente para gestionar scheduled analytics reports: listar reports configurados, crear nuevo (con cron schedule + format + recipients), eliminar, y generar manualmente (trigger immediate generation bypass del cron).
- **Findings:** FN-037 (false-positive — confirmado canonical, NO borrado).
- **Componentes end-to-end:** Client browser → `app/dashboard/analytics/reports/page.tsx` → `components/analytics/{CreateReportForm,ScheduledReportsList}.tsx` → `hooks/api/useReports.ts` (4 hooks: useReports + useCreateReport + useDeleteReport + useGenerateReport) → fetch `/api/backend/reports{,/:id,/:id/generate}` → Next.js proxy → API Fastify `apps/api/src/reports/reportRoutes.ts` (líneas 324/362/342/351 — GET/POST/DELETE/POST-generate registrados con `requireClientAuth`) → use cases (`CreateScheduledReportUseCase`, `UpdateScheduledReportUseCase`, `DeleteScheduledReportUseCase`, `ListScheduledReportsQuery`, `GenerateReportUseCase`) → Prisma → tablas `ScheduledReport` + queues BullMQ para generación.
- **Smoke check propuesto:** (1) Login cliente. (2) Navegar `/dashboard/analytics/reports`. (3) Crear nuevo report con `CreateReportForm`: name, cronSchedule (`0 9 * * MON`), format `CSV`, recipients (`email@example.com`). (4) Confirmar `POST /api/backend/reports` retorna 200 + el report aparece en `ScheduledReportsList`. (5) Click "Generate Now" → confirmar `POST /api/backend/reports/:id/generate` retorna 200 + se encola job en BullMQ + el report se genera (verificar `lastRunAt` se actualiza tras procesamiento). (6) Delete report → confirmar `DELETE /api/backend/reports/:id` retorna 200 + desaparece de la lista. (7) Test negativo: customer A intenta DELETE reportId de customer B → 403.
- **Notas:** El hook NO usa `PATCH /reports/:id` que el backend SÍ expone (update functionality no implementada todavía — gap menor, no bloquea). Banner visible en la página: _"Manual generation only — cron not wired"_ (FN-024 separado, cross-app finding). Cron automático espera implementación del scheduler trigger en workers.

---

## Changelog del tracking

> Cada vez que cambia un status o se ejecuta una acción, log aquí.

- **2026-05-11** — Documento creado. 49 findings cargados en estado `PENDING`. Sin decisiones aún.
- **2026-05-11** — FN-014 `RESOLVED` (APPROVE). Deleted `apps/workers/src/providers/instagram/publishingWorker.ts` + 3 test files. Resuelve también FN-039 como side effect. Workers typecheck + suite 87/87 verde. Flow tocado: flow-002.
- **2026-05-11** — Layout `Flow inventory` agregado + retroactivo para FN-014.
- **2026-05-11** — FN-015 + FN-016 `RESOLVED` (CHANGE-ACTION → WIRE). Refactor de 3 workers a pattern `startXxxWorker({registerShutdown})` returning `ShutdownTarget`. Nuevo `apps/workers/src/bootstrap.ts` con shutdown unificado. `Dockerfile` CMD → `dist/bootstrap.js`. API scheduler wirea `DispatchInboxSyncUseCase` (30 min) + `DispatchAnalyticsIngestionUseCase` (6 h) — productores que faltaban. Typecheck + tests + lint clean. Flows tocados: flow-001, flow-003, flow-004.
- **2026-05-11** — FN-012 `IN_REVIEW` abierto. Sub-item 1/19 (`useQueueManager.tsx`) `RESOLVED` (APPROVE → DELETE). Causa real: duplicado obsoleto de `useQueueManagement.ts` canon (URL prefix incorrecto, fetches 404 silentes). flow-005 (admin queue management) documentado retroactivamente — workflow canónico vía `/maintenance` page con `useQueueManagement.ts`.
- **2026-05-11** — FN-012.2 (`ProviderTiersTab.tsx`) `RESOLVED` (REJECT, falso positivo del auditor). Consumer real en `app/(dashboard)/pricing/page.tsx:30,244`. NO se borra. flow-006 (admin pricing dashboard) documentado para cobertura e2e.
- **2026-05-11** — FN-012.3 (`AccessDenied.tsx`) `RESOLVED` (REJECT, falso positivo). Infraestructura UI transversal con 10+ callers en pages protegidas por rol. NO se borra.
- **2026-05-11** — FN-012.4 (`ErrorBoundary.tsx`) `RESOLVED` (APPROVE → DELETE). Reemplazo histórico: superseded por `apps/admin/app/error.tsx` (Next.js 15 native). Deleted componente + test.
- **2026-05-11** — FN-012.5 (`SidebarNav.tsx`) `RESOLVED` (REJECT, falso positivo). Chrome crítica del dashboard: consumer en `app/(dashboard)/layout.tsx:10,30`. NO se borra.
- **2026-05-11** — FN-012.6 (`SkipLink.tsx`) `RESOLVED` (CHANGE-ACTION → WIRE). Forgotten-feature a11y WCAG 2.1: componente + anchor `id="main-content"` ya existían, faltaba el mount. Wireado en `app/(dashboard)/layout.tsx`. flow-007 documentado. Side effect: gap en client elevado como L-649 en LATERAL_FINDINGS.
- **2026-05-11** — FN-012.7 (`VisuallyHidden.tsx`) `RESOLVED` (APPROVE → DELETE). Reemplazo histórico por Tailwind `sr-only` (canon de facto en login-form, LoadingSpinner, accounts/page, dialog). Deleted componente + test.
- **2026-05-11** — FN-012.8 (`useCompliance/types.ts`) `RESOLVED` (REJECT, falso positivo). Re-exportado por barrel `index.ts` + sustrato interno del módulo. Hook useCompliance alive. NO se borra.
- **2026-05-11** — FN-012.9 (`useContentLibrary.ts`) `RESOLVED` (DEFER + documentado). Scaffolding intencional para feature legal-protectora "Admin Compliance Content Access". Plan completo (backend `/admin/compliance/content` + audit trail + UI + role) elevado a LATERAL_FINDINGS L-650. NO se borra.
- **2026-05-11** — FN-012.10 (`useGatewaySwitches/types.ts`) `RESOLVED` (REJECT, falso positivo). Re-exportado por barrel + hook alive. flow-008 documentado. NO se borra.
- **2026-05-11** — Workflows retroactivos agregados al inventory: flow-008 (gateway switches), flow-009 (RBAC access-control chrome via AccessDenied), flow-010 (dashboard navigation chrome via SidebarNav), flow-011 (compliance dashboard DSAR+breach+settings).
- **2026-05-11** — FN-012.11 (`useMultiPlatformScheduling.ts`) `RESOLVED` (APPROVE → DELETE). Vestigio inferior vs client (subset 5/8 hooks, parsing roto `value` vs canon `data`, sin refetch). Deleted hook + test. Cierra parcial FN-030, FN-034, anticipa FN-012.18 (types dup).
- **2026-05-11** — FN-012.12 (`useOidcReplaceClientSecret.ts`) `RESOLVED` (REJECT, falso positivo). Feature SSO crítica end-to-end completa. flow-012 documentado. NO se borra.
- **2026-05-11** — FN-012.13 (`usePerformanceInsights.ts`) `RESOLVED` (DELETE admin orphan + DEFER feature). Análisis expuso gap arquitectural: la feature de content insights per-project NO existe en backend (endpoint admin ignora projectId, retorna business metrics). Admin orphan deleted; client componente + hook PRESERVADOS como scaffolding. Plan completo 6 fases elevado como L-651 (pipeline backend + endpoint customer + endpoint admin pattern C con audit log + wires).
- **2026-05-11** — FN-012.14 (`usePosts.ts`) `RESOLVED` (DELETE orphan + DEFER feature). Hook orphan con shape cliente; admin NO gestiona posts pero SÍ debe poder moderar legalmente. Deleted hook + test. Plan completo "Admin Post Moderation Pattern" (schema + permission + endpoints + appeals + L-650/L-651 integration) elevado como L-652.
- **2026-05-11** — FN-012.15 (`useSubscriptions.ts`) `RESOLVED` (REJECT, falso positivo). Feature operacional admin completa end-to-end. flow-013 documentado. NO se borra.
- **2026-05-11** — FN-012.16 (`useUniversalAnalytics.ts`) `RESOLVED` (APPROVE → DELETE). Dead code total: 0 UI consumers + endpoint `GET /dashboard` no existe en backend. Deleted hook + test. Side effect: cierra otro 1/4 de FN-030.
- **2026-05-11** — FN-012.17 (`oidcAdminClient.ts`) `RESOLVED` (REJECT, falso positivo). Sustrato low-level de flow-012 (OIDC rotation). 2 callers reales en hook + apiClient re-export. NO se borra.
- **2026-05-11** — FN-012.18 (`postsClient.ts`) `RESOLVED` (APPROVE → DELETE). Chain dead post-FN-012.14: 0 consumers tras delete del único caller (usePosts). Deleted file + trimmed 7 líneas en apiClient.ts (1 import + 6 re-exports).
- **2026-05-11** — FN-012.19 (`types/multi-platform-scheduling.ts`) `RESOLVED` (APPROVE → DELETE). Chain dead post-FN-012.11. Deleted file + empty parent dir `apps/admin/types/`. Cierra FN-035 admin-side.
- **2026-05-11** — **FN-012 GLOBAL CLOSED** (19/19 sub-items). Side effects automáticos: FN-030, FN-034 (admin-side), FN-035 (admin-side), FN-038 — todos RESOLVED. §3 Admin: 100%.
- **2026-05-11** — FN-036 `RESOLVED` (APPROVE → DELETE clean-slate + DEFER backend a L-651). Deleted 12 archivos client: page `analytics/insights/` + hook usePerformanceInsights + componente principal + subdir `components/analytics/insights/` completa (9 archivos chain dead). L-651 actualizado: Fase 4 + Fase 5 ahora "build fresh".
- **2026-05-11** — FN-037 `RESOLVED` (REJECT, falso positivo). Verificación URL-por-URL pasa: 4 endpoints existen en `reportRoutes.ts` + 2 consumers reales + page live `/dashboard/analytics/reports`. flow-014 documentado.
- **2026-05-11** — **§4 Client CLOSED** (2/2 findings). 11/49 RESOLVED global (22%). §2 + §3 + §4 completos.
