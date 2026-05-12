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

| Métrica                                       |  Count |
| --------------------------------------------- | -----: |
| Total findings                                |     49 |
| PENDING                                       |     46 |
| IN_REVIEW                                     |      0 |
| APPROVED (awaiting execution)                 |      0 |
| CHANGE-ACTION (awaiting execution)            |      0 |
| REJECTED                                      |      0 |
| DEFERRED                                      |      0 |
| RESOLVED                                      |      3 |
| **% reviewed**                                | **6%** |
| **% closed (resolved + rejected + deferred)** | **6%** |

### Per-application progress

| App                  | Total | Reviewed | Closed | % closed |
| -------------------- | ----: | -------: | -----: | -------: |
| §1 API               |    13 |        0 |      0 |       0% |
| §2 Workers           |     3 |        3 |      3 | **100%** |
| §3 Admin             |     2 |        0 |      0 |       0% |
| §4 Client            |     2 |        0 |      0 |       0% |
| §5 Packages          |    13 |        0 |      0 |       0% |
| §6 Cross-application |    16 |        0 |      0 |       0% |

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
- **Status:** `PENDING`
- **Auditor recommendation:** `DELETE-NOW`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Bloqueado por FN-008 (verificar que `database/DatabaseOptimizer.ts` cubre todas las funciones antes de borrar).
- **Blocked by:** FN-008

### FN-008 — DatabaseOptimizer vs dbOptimization (REDUNDANTE)

- **Surface(s):** api
- **Categoría:** dead-code
- **Status:** `PENDING`
- **Auditor recommendation:** `DELETE-NOW` (borrar el de utils, mantener database)
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Confirmar que `DatabaseOptimizer` está DI-registered.
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

### FN-012 — 11 archivos DEAD en admin

- **Surface(s):** admin
- **Categoría:** dead-code (bulk)
- **Status:** `PENDING`
- **Auditor recommendation:** `DELETE-NOW` (con revisión item-por-item del inventory-admin)
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Hooks orphan post-split: `useContentLibrary`, `useUniversalAnalytics`, etc. apuntando a `/api/backend/*` no existente. Revisar lista filtrada en `inventory-admin.md`.
- **Blocked by:** —

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
- **Status:** `PENDING`
- **Auditor recommendation:** `FIX-NOW`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** NEEDS_EDWARD — feature client o admin? Hook devuelve siempre 401 en prod, feature rota silenciosa. ~2-4h.
- **Blocked by:** —

### FN-037 — useReports paths para verificar

- **Surface(s):** client
- **Categoría:** mismatch (potencial)
- **Status:** `PENDING`
- **Auditor recommendation:** `VERIFY`
- **Edward decision:** —
- **Decision date:** —
- **Action taken:** —
- **Notes:** Listar cada endpoint que invoca vs route table. Si todos existen → VÁLIDO. Si falta alguno → mover a MISMATCH.
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

---

## Changelog del tracking

> Cada vez que cambia un status o se ejecuta una acción, log aquí.

- **2026-05-11** — Documento creado. 49 findings cargados en estado `PENDING`. Sin decisiones aún.
- **2026-05-11** — FN-014 `RESOLVED` (APPROVE). Deleted `apps/workers/src/providers/instagram/publishingWorker.ts` + 3 test files. Resuelve también FN-039 como side effect. Workers typecheck + suite 87/87 verde. Flow tocado: flow-002.
- **2026-05-11** — Layout `Flow inventory` agregado + retroactivo para FN-014.
- **2026-05-11** — FN-015 + FN-016 `RESOLVED` (CHANGE-ACTION → WIRE). Refactor de 3 workers a pattern `startXxxWorker({registerShutdown})` returning `ShutdownTarget`. Nuevo `apps/workers/src/bootstrap.ts` con shutdown unificado. `Dockerfile` CMD → `dist/bootstrap.js`. API scheduler wirea `DispatchInboxSyncUseCase` (30 min) + `DispatchAnalyticsIngestionUseCase` (6 h) — productores que faltaban. Typecheck + tests + lint clean. Flows tocados: flow-001, flow-003, flow-004.
