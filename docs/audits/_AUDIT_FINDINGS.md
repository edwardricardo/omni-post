---
title: Audit findings — full-repo (Fase B + C consolidada)
description: Hallazgos non-VÁLIDO consolidados de los 5 inventarios (api, workers, admin, client, packages) con recomendación honesta del auditor por item. Workbench para revisión punto-por-punto.
generated: 2026-05-11
auditor: claude-code
status: PENDING_REVIEW
---

# Audit findings — full-repo

> Consolidación item-por-item de los hallazgos non-VÁLIDO surfaceados durante la auditoría F5.
>
> **Cómo se construyó:** ver [AUDIT_METHODOLOGY.md](AUDIT_METHODOLOGY.md). **Resumen agregado:** ver [INVENTORY_SUMMARY.md](INVENTORY_SUMMARY.md).
>
> **Workflow esperado:** Edward revisa cada `audit-FN-NN` y marca uno de:
>
> - ✅ **APPROVE** — ejecutar la acción candidata como está.
> - ❌ **REJECT** — falso positivo; documentar la razón.
> - 🔄 **CHANGE-ACTION** — el hallazgo es real pero la acción candidata no es la correcta.
> - ⏸️ **DEFER** — válido pero fuera del scope actual; agendar.
>
> **Convención de recomendación honesta del auditor (mi opinión, no decisión):**
>
> - `DELETE-NOW` — alto confidence, low risk, safe to remove en el commit boundary
> - `WIRE-BACKEND` — completar implementación que ya tiene UI esperándola
> - `WIRE-UI` — completar UI / banner para feature backend lista
> - `CONSOLIDATE-TO-PACKAGE` — duplicación clara, mover a `packages/`
> - `FIX-NOW` — bug operacional reproducible, fix inmediato
> - `DECIDE` — requiere decisión de producto o arquitectura, no acción mecánica
> - `VERIFY` — sospecha pero baja confidence, requiere lectura profunda antes de actuar

---

## Tabla de contenidos

- [§1 SUPERSEDED — por saga canon retrofit (8 items)](#1-superseded--por-saga-canon-retrofit)
- [§2 DEAD-CODE — routes/plugins/mappers no registrados (5 items)](#2-dead-code--routes-plugins-mappers-no-registrados)
- [§3 DEAD-CODE — workers no bootstrapped (3 items)](#3-dead-code--workers-no-bootstrapped)
- [§4 DEAD-CODE — queues huérfanas en packages (5 items)](#4-dead-code--queues-huerfanas-en-packages)
- [§5 FORGOTTEN-FEATURE — backend listo, UI ausente o llamando 501 (6 items)](#5-forgotten-feature--backend-listo-ui-ausente-o-llamando-501)
- [§6 FORGOTTEN-FEATURE — UI lista, backend pendiente (3 items)](#6-forgotten-feature--ui-lista-backend-pendiente)
- [§7 DUPLICATION — admin↔client a consolidar (5 items)](#7-duplication--admin-client-a-consolidar)
- [§8 MISMATCH — funcionalmente rotos hoy (4 items)](#8-mismatch--funcionalmente-rotos-hoy)
- [§9 ARCHITECTURAL-VIOLATION — port-adapter asymmetry (2 items)](#9-architectural-violation--port-adapter-asymmetry)
- [§10 DRIFT — múltiples sources of truth (2 items)](#10-drift--multiples-sources-of-truth)
- [§11 CANON-DEVIATION — fitness check violations soft (3 items)](#11-canon-deviation--fitness-check-violations-soft)
- [§12 UNKNOWN — requiere verificación (3 items)](#12-unknown--requiere-verificacion)

**Total: 49 items para revisar.**

---

## §1 SUPERSEDED — por saga canon retrofit

> El retrofit canon Richardson + Azure que se acaba de mergear (`f389124`) introdujo `defineSaga()` factory, classified steps, `pivotStepIndex`, `RereadCheck`. Lo siguiente queda obsoleto por diseño.

### audit-FN-001 — PublishingOrchestrator superseded

- **Categoría:** superseded
- **Surface(s):** api
- **Evidencia:** [apps/api/src/orchestration/PublishingOrchestrator.ts](apps/api/src/orchestration/PublishingOrchestrator.ts) + 3 archivos sibling. El nuevo saga `publishPostSaga` cubre la misma orquestación con clasificación de pasos canon.
- **Recomendación honesta:** `DELETE-NOW`
- **Acción candidata:** Borrar `PublishingOrchestrator.ts` + 3 siblings. Verificar antes que no quede ningún `import.*PublishingOrchestrator` activo (`rg "PublishingOrchestrator" apps packages | grep -v test`).
- **NEEDS_EDWARD:** no
- **Bloqueado por:** —

### audit-FN-002 — EventPublisher.ts superseded

- **Categoría:** superseded
- **Surface(s):** api
- **Evidencia:** [apps/api/src/events/EventPublisher.ts](apps/api/src/events/EventPublisher.ts) — reemplazado por `ComposedEventDispatcher` que combina outbox + in-process dispatch. Doble implementación.
- **Recomendación honesta:** `DELETE-NOW`
- **Acción candidata:** Borrar el archivo. Verificar callers (`rg "EventPublisher" apps packages`) — debe haber 0 fuera del propio archivo.
- **NEEDS_EDWARD:** no
- **Bloqueado por:** —

### audit-FN-003 — orchestration/sync/\* sin caller

- **Categoría:** superseded
- **Surface(s):** api
- **Evidencia:** `apps/api/src/orchestration/sync/` (6 archivos) — sin caller productivo. Posibles siblings de PublishingOrchestrator. Heredados del modelo orchestration anterior al saga.
- **Recomendación honesta:** `DELETE-NOW` (con verificación una pasada)
- **Acción candidata:** Para cada archivo, ejecutar `rg "<symbol>" apps packages | grep -v test | grep -v orchestration/sync`. Si 0 callers fuera del propio dir, borrar el dir completo.
- **NEEDS_EDWARD:** no
- **Bloqueado por:** —

### audit-FN-004 — autoRenewalWorker duplica TrialManagementService

- **Categoría:** superseded
- **Surface(s):** workers · api
- **Evidencia:** `apps/workers/src/autoRenewalWorker.ts` ejecuta lógica de auto-renewal en paralelo a `apps/api/src/billing/subscription/TrialManagementService.processAutoRenewals`. Dual-write risk: dos procesos pueden cobrar la misma suscripción si race.
- **Recomendación honesta:** `DELETE-NOW`
- **Acción candidata:** Decidir SoT (preferencia: api con saga, no worker legacy). Borrar `autoRenewalWorker.ts`. Confirmar que `TrialManagementService.processAutoRenewals` está siendo invocado por cron-task vía `BackgroundTaskScheduler` o BullMQ schedule.
- **NEEDS_EDWARD:** yes (confirmar SoT)
- **Bloqueado por:** —

### audit-FN-005 — DLQ adapter duplicado

- **Categoría:** superseded
- **Surface(s):** packages
- **Evidencia:** [packages/adapters/dead-letter-queue/src/index.ts](packages/adapters/dead-letter-queue/src/index.ts) — implementación rica pero no port-bound. `BullMQDeadLetterQueueAdapter` es el port-bound canónico. Coexisten.
- **Recomendación honesta:** `DELETE-NOW`
- **Acción candidata:** Borrar el adapter no-port-bound. Verificar que `BullMQDeadLetterQueueAdapter` cubre las features de la versión rica; si no, portar lo faltante al adapter port-bound antes de borrar.
- **NEEDS_EDWARD:** no (con verificación de features)
- **Bloqueado por:** —

### audit-FN-006 — AccountMapper zero callers

- **Categoría:** dead-code
- **Surface(s):** api
- **Evidencia:** [apps/api/src/mappers/AccountMapper.ts](apps/api/src/mappers/AccountMapper.ts) — `rg "AccountMapper" apps packages` reporta 0 callers fuera del propio archivo.
- **Recomendación honesta:** `DELETE-NOW`
- **Acción candidata:** Borrar.
- **NEEDS_EDWARD:** no
- **Bloqueado por:** —

### audit-FN-007 — utils/dbOptimization solo en variable bloqueada

- **Categoría:** dead-code
- **Surface(s):** api
- **Evidencia:** [apps/api/src/utils/dbOptimization.ts](apps/api/src/utils/dbOptimization.ts) — exportado, pero solo asignado a `_dbOptimizer` (variable underscore-prefixed → marcada como unused per convención). DI nunca lo resuelve.
- **Recomendación honesta:** `DELETE-NOW`
- **Acción candidata:** Borrar. Confirmar que `database/DatabaseOptimizer.ts` (que sí está wired) cubre todas sus funciones — si overlap parcial, portar lo faltante.
- **NEEDS_EDWARD:** no
- **Bloqueado por:** ver §audit-FN-008

### audit-FN-008 — DatabaseOptimizer vs dbOptimization (REDUNDANTE)

- **Categoría:** dead-code
- **Surface(s):** api
- **Evidencia:** `apps/api/src/database/DatabaseOptimizer.ts` y [apps/api/src/utils/dbOptimization.ts](apps/api/src/utils/dbOptimization.ts) — ambos hacen optimización de queries Prisma. Probable historical fork.
- **Recomendación honesta:** `DELETE-NOW` (el de utils, mantener el de database)
- **Acción candidata:** Borrar `utils/dbOptimization.ts` (es el unused). Confirmar que `DatabaseOptimizer` está DI-registered.
- **NEEDS_EDWARD:** no
- **Bloqueado por:** —

---

## §2 DEAD-CODE — routes / plugins / mappers no registrados

### audit-FN-009 — optimizedPostsRoutes nunca registrado

- **Categoría:** dead-code
- **Surface(s):** api
- **Evidencia:** [apps/api/src/posts/optimizedPostsRoutes.ts](apps/api/src/posts/optimizedPostsRoutes.ts) — route file completo, no aparece en `apps/api/src/index.ts` ni en `apps/api/src/posts/postRoutes.ts` como sub-router.
- **Recomendación honesta:** `DELETE-NOW`
- **Acción candidata:** Confirmar que `postRoutes.ts` cubre el caso de uso "optimizado" o si hay performance gain real. Si overlap completo → borrar. Si gain real → registrar.
- **NEEDS_EDWARD:** yes (verificar si era un experiment activo)
- **Bloqueado por:** —

### audit-FN-010 — rateLimitingDashboard plugin no registrado

- **Categoría:** dead-code (o FORGOTTEN-FEATURE)
- **Surface(s):** api
- **Evidencia:** [apps/api/src/monitoring/rateLimitingDashboard.ts](apps/api/src/monitoring/rateLimitingDashboard.ts) — Fastify plugin tested, nunca registered en `index.ts`. No hay pantalla admin que lo consuma tampoco.
- **Recomendación honesta:** `DECIDE`
- **Acción candidata:** O wirearlo (registrar plugin + crear pantalla admin) o borrarlo. El esfuerzo de wire es M (~4 h). Si producto no lo necesita, borrar.
- **NEEDS_EDWARD:** yes (decisión de producto)
- **Bloqueado por:** —

### audit-FN-011 — packages/core/planPublication.ts solo tests

- **Categoría:** dead-code
- **Surface(s):** packages
- **Evidencia:** [packages/core/src/planPublication.ts](packages/core/src/planPublication.ts) — callers solo en tests, ninguno en `apps/api/src/`. El package `core` overpromete con scope de 2 archivos.
- **Recomendación honesta:** `DELETE-NOW` el archivo + considerar disolver el sub-package `packages/core` completo
- **Acción candidata:** Borrar `planPublication.ts`. Evaluar si el otro archivo en `packages/core/src/` justifica mantener el sub-package o si se puede mover a `@shared/` y disolver.
- **NEEDS_EDWARD:** yes (decisión arquitectura — disolver sub-package)
- **Bloqueado por:** —

### audit-FN-012 — 11 archivos DEAD en admin

- **Categoría:** dead-code
- **Surface(s):** admin
- **Evidencia:** 11 archivos en `apps/admin/` flagged DEAD por el inventario admin — ver [docs/audits/inventory-admin.md](inventory-admin.md). Hooks orphan `useContentLibrary`, `useUniversalAnalytics`, etc. — apuntan a `/api/backend/*` no existentes.
- **Recomendación honesta:** `DELETE-NOW` (con revisión item-por-item del inventory-admin)
- **Acción candidata:** Abrir `inventory-admin.md`, lista filtrada por veredicto=DEAD, borrar uno a uno.
- **NEEDS_EDWARD:** no (pero querrás validar cada uno antes de borrar)
- **Bloqueado por:** —

### audit-FN-013 — saga/sagaManagerTypes.ts sin @layer

- **Categoría:** canon-deviation hard
- **Surface(s):** api
- **Evidencia:** Único archivo en 823 de `apps/api/src/` sin `@layer` header. Fitness check #10 es hard-zero — esto deja CI orange en perpetuidad.
- **Recomendación honesta:** `FIX-NOW`
- **Acción candidata:** Añadir `@layer infrastructure` al JSDoc header del archivo. 30 segundos.
- **NEEDS_EDWARD:** no
- **Bloqueado por:** —

---

## §3 DEAD-CODE — workers no bootstrapped

### audit-FN-014 — providers/instagram/publishingWorker sin bootstrap

- **Categoría:** dead-code
- **Surface(s):** workers
- **Evidencia:** [apps/workers/src/providers/instagram/publishingWorker.ts](apps/workers/src/providers/instagram/publishingWorker.ts) — no spawn en `apps/workers/src/index.ts`. Payload shape mismatchea `PublishJobInput`.
- **Recomendación honesta:** `DELETE-NOW`
- **Acción candidata:** Confirmar que la publicación Instagram está cubierta por el `publishWorker.ts` central (con la `InstagramAdapter` resolved). Si yes → borrar.
- **NEEDS_EDWARD:** no
- **Bloqueado por:** —

### audit-FN-015 — inboxSyncWorker no en Dockerfile CMD

- **Categoría:** forgotten-feature / deployment-dead
- **Surface(s):** workers
- **Evidencia:** [apps/workers/src/inboxSyncWorker.ts](apps/workers/src/inboxSyncWorker.ts) — producer en `apps/api` encola jobs `inbox-sync`, pero el `apps/workers/Dockerfile` `CMD` solo arranca `publishWorker.js`. Los jobs encolados nunca se consumen en producción.
- **Recomendación honesta:** `FIX-NOW`
- **Acción candidata:** Decidir: (a) cambiar Dockerfile a un script de bootstrap que arranque todos los workers necesarios (`bootstrap.ts`), o (b) crear container separado por worker. Yo recomiendo (a) — un solo bootstrap.ts que sigue el patrón canon de DI container.
- **NEEDS_EDWARD:** yes (decisión deployment topology)
- **Bloqueado por:** —

### audit-FN-016 — analyticsIngestWorker no en Dockerfile CMD

- **Categoría:** forgotten-feature / deployment-dead
- **Surface(s):** workers
- **Evidencia:** [apps/workers/src/analyticsIngestWorker.ts](apps/workers/src/analyticsIngestWorker.ts) — mismo problema que audit-FN-015.
- **Recomendación honesta:** `FIX-NOW`
- **Acción candidata:** Mismo fix que audit-FN-015 (bundled).
- **NEEDS_EDWARD:** yes (junto con FN-015)
- **Bloqueado por:** audit-FN-015

---

## §4 DEAD-CODE — queues huérfanas en packages

> 5 queues declaradas en [packages/adapters/queue-bullmq/src/constants.ts](packages/adapters/queue-bullmq/src/constants.ts) sin producer ni processor. Coinciden con spinoffs `PROPOSED` del POST_BACKLOG histórico — features en planeación, no abandonadas. Pero declarar constantes sin uso causa confusión.

### audit-FN-017 — Queue `recurring-posts` huérfana

- **Categoría:** dead-code
- **Surface(s):** packages
- **Evidencia:** Constante declarada, sin producer ni processor.
- **Recomendación honesta:** `DELETE-NOW` (mover a un comment "reserved for future feature" si quieres preservar el namespace)
- **Acción candidata:** Quitar la constante. Re-añadir cuando el spinoff `PR-Recurring-Posts` se priorice.
- **NEEDS_EDWARD:** no (decisión de claridad)
- **Bloqueado por:** —

### audit-FN-018 — Queue `detect-repurpose` huérfana

- **Categoría:** dead-code
- **Surface(s):** packages
- **Evidencia:** Coincide con spinoff PR-Repurpose-AI-Pipeline.
- **Recomendación honesta:** `DELETE-NOW`
- **Acción candidata:** Quitar. Backend para esa feature requiere PR-Repurpose-AI-Pipeline (501 endpoints + scheduler).
- **NEEDS_EDWARD:** no
- **Bloqueado por:** —

### audit-FN-019 — Queue `triage-inbox` huérfana

- **Categoría:** dead-code
- **Surface(s):** packages
- **Evidencia:** Coincide con spinoff PR-Triage-AI-Inbox.
- **Recomendación honesta:** `DELETE-NOW`
- **Acción candidata:** Quitar.
- **NEEDS_EDWARD:** no
- **Bloqueado por:** —

### audit-FN-020 — Queue `trend-radar` huérfana

- **Categoría:** dead-code
- **Surface(s):** packages
- **Evidencia:** Coincide con spinoff PR-Trend-Radar-Caching. Backend `trendAnalysisService.ts` retorna mock viralDNA (PR-52 del backlog histórico).
- **Recomendación honesta:** `DELETE-NOW` la queue; **DECIDE** sobre el servicio mock.
- **Acción candidata:** Quitar la queue. Para el servicio: revisar si vale el riesgo de tenerlo retornando mock (cliente confiando en datos falsos) o si se debería disable el endpoint hasta que esté wireado.
- **NEEDS_EDWARD:** yes (decisión sobre mock retornado)
- **Bloqueado por:** —

### audit-FN-021 — Queue `report-generation` huérfana

- **Categoría:** dead-code
- **Surface(s):** packages · client
- **Evidencia:** Coincide con spinoff PR-Scheduled-Reports-Cron. Cliente tiene banner "Manual generation only — cron not wired" en `dashboard/analytics/reports/`.
- **Recomendación honesta:** `DELETE-NOW` la queue
- **Acción candidata:** Quitar la queue. Banner del cliente queda como signal honest hasta que el cron se priorice.
- **NEEDS_EDWARD:** no (banner sigue válido)
- **Bloqueado por:** —

---

## §5 FORGOTTEN-FEATURE — backend listo, UI ausente o llamando 501

### audit-FN-022 — Video processing pipeline sin UI

- **Categoría:** forgotten-feature
- **Surface(s):** api
- **Evidencia:** `apps/api/src/video/` — 7 archivos (thumbnail + uploadPipeline + videoProcessor), tested, sin caller productivo. Ninguna pantalla en admin o client lo consume.
- **Recomendación honesta:** `DECIDE`
- **Acción candidata:** Pregunta a producto: ¿feature de subida/preview de video es prioridad? Si yes → wire UI (estimación: L = 1-2 días). Si no → borrar el módulo (estimación: S = 30 min).
- **NEEDS_EDWARD:** yes (decisión de producto)
- **Bloqueado por:** —

### audit-FN-023 — PredictiveAnalytics ML — UI ↔ 501

- **Categoría:** forgotten-feature
- **Surface(s):** client · api
- **Evidencia:** `apps/client/app/dashboard/ai/analytics/page.tsx` UI completa de PredictiveAnalytics consume endpoints ML que retornan `501 NOT_IMPLEMENTED` en `apps/api/`.
- **Recomendación honesta:** `WIRE-BACKEND` o `WIRE-UI` (deshabilitar)
- **Acción candidata:** Dos caminos: (a) implementar los ML endpoints (estimación: XL = >1 día, requiere infra ML); (b) deshabilitar la pantalla UI con banner "Coming soon" o ocultarla del nav. Mi recomendación: (b) ahora, (a) cuando producto priorice.
- **NEEDS_EDWARD:** yes
- **Bloqueado por:** —

### audit-FN-024 — Scheduled Reports cron no wired

- **Categoría:** forgotten-feature
- **Surface(s):** api · client · workers
- **Evidencia:** `apps/client/app/dashboard/analytics/reports/page.tsx` con banner explícito "Manual generation only — cron not wired". Backend tiene servicio + use case. Solo falta scheduler que dispare por cron.
- **Recomendación honesta:** `WIRE-BACKEND` (oportunidad pequeña)
- **Acción candidata:** Registrar la generación periódica de reports vía `BackgroundTaskScheduler` o BullMQ schedule en `apps/workers/src/`. Estimación: M = 2-4 h.
- **NEEDS_EDWARD:** no (deuda pequeña, ya está casi)
- **Bloqueado por:** decisión §audit-FN-015 (bootstrap workers topology)

### audit-FN-025 — AI quality fields sin backend

- **Categoría:** forgotten-feature
- **Surface(s):** client · api
- **Evidencia:** `apps/client/components/ai/{AITemplateSelector,AIContentResults}.tsx` muestran campos `estimatedEngagement`, `readabilityScore`, `engagementScore`, `viralPotential`, `brandConsistency` — backend retorna `null` para todos. UI muestra placeholders permanentes.
- **Recomendación honesta:** `DECIDE`
- **Acción candidata:** Dos caminos: (a) calcular los scores en backend con heurística simple (caps + sentiment + readability via FK score — estimación: M = 4-8 h); (b) ocultar los campos en UI hasta que backend tenga datos reales. Recomendación: (b) ahora, (a) si producto lo justifica.
- **NEEDS_EDWARD:** yes
- **Bloqueado por:** —

### audit-FN-026 — EngagementPredictor potencial dead

- **Categoría:** UNKNOWN → tendencia forgotten-feature
- **Surface(s):** api
- **Evidencia:** Reportado en inventario api como potential. Requiere verificación de callers.
- **Recomendación honesta:** `VERIFY`
- **Acción candidata:** `rg "EngagementPredictor" apps packages` — si 0 callers fuera del archivo, mover a §5 o §2 según corresponda.
- **NEEDS_EDWARD:** no
- **Bloqueado por:** —

### audit-FN-027 — rateLimitingDashboard sin UI consumer

- **Categoría:** forgotten-feature
- **Surface(s):** api · admin
- **Evidencia:** Ver audit-FN-010. Plugin existe en api, sin pantalla admin consumidora.
- **Recomendación honesta:** `DECIDE` (igual que FN-010)
- **Acción candidata:** Decidir si crear pantalla admin de monitoreo de rate limits o borrar el plugin.
- **NEEDS_EDWARD:** yes
- **Bloqueado por:** decisión §audit-FN-010

---

## §6 FORGOTTEN-FEATURE — UI lista, backend pendiente

### audit-FN-028 — Settings/referral page sin route backend

- **Categoría:** mismatch / forgotten-feature
- **Surface(s):** client · api
- **Evidencia:** `apps/client/app/dashboard/settings/referral/page.tsx` inline-fetches un endpoint de referral stats que no aparece en el route table de `apps/api/src/`. Falta `referralRoutes.ts` o llama URL incorrecta.
- **Recomendación honesta:** `DECIDE` + `WIRE-BACKEND` si feature es real
- **Acción candidata:** Confirmar si el programa de referrals es feature activa. Si yes → implementar `referralRoutes.ts` + use case. Si no → quitar la pantalla del nav y archivarla.
- **NEEDS_EDWARD:** yes
- **Bloqueado por:** —

### audit-FN-029 — Admin webhook subscription selector roto

- **Categoría:** mismatch
- **Surface(s):** admin · api
- **Evidencia:** `apps/admin/components/webhooks/` — `fetchProjectsForSubscriptionForm` apunta a `/api/backend/projects` (endpoint no existe). El selector muestra lista vacía siempre.
- **Recomendación honesta:** `FIX-NOW`
- **Acción candidata:** Cambiar el endpoint al correcto (`/projects` o `/admin/projects` según permisos). Verificar permisos: ¿admin necesita ver projects de todas las accounts? Si yes → SUPER_ADMIN gate + endpoint nuevo.
- **NEEDS_EDWARD:** yes (decisión permisos)
- **Bloqueado por:** —

### audit-FN-030 — Test endpoint analytics (legacy hooks orphan)

- **Categoría:** forgotten-feature (legacy)
- **Surface(s):** admin
- **Evidencia:** 4 hooks orphan en `apps/admin/` apuntan a `/api/backend/*` que no existen: `useContentLibrary`, `useUniversalAnalytics`, `useMultiPlatformScheduling`, `usePerformanceInsights`. Resaca de la separación admin↔client.
- **Recomendación honesta:** `DELETE-NOW`
- **Acción candidata:** Borrar los 4 hooks orphan. Si alguna pantalla los importa todavía → borrar también la pantalla o reescribir contra endpoint real.
- **NEEDS_EDWARD:** no (cleanup post-split)
- **Bloqueado por:** —

---

## §7 DUPLICATION — admin↔client a consolidar

> 5 archivos confirmados con cuasi-duplicación entre `apps/admin` y `apps/client`. Resaca de la separación de apps. Consolidar a `packages/` mejora mantenibilidad.

### audit-FN-031 — sessionCookie helper duplicado

- **Categoría:** duplication
- **Surface(s):** admin · client
- **Evidencia:** [apps/admin/lib/auth/sessionCookie.ts](apps/admin/lib/auth/sessionCookie.ts) y `apps/client/lib/auth/sessionCookie.ts` — helpers casi idénticos para read/write cookies de sesión.
- **Recomendación honesta:** `CONSOLIDATE-TO-PACKAGE`
- **Acción candidata:** Crear `@packages/auth-cookie` con la lógica compartida. Migrar admin + client a importarlo. Estimación: S = 1 h.
- **NEEDS_EDWARD:** no
- **Bloqueado por:** —

### audit-FN-032 — LoadingSpinner duplicado

- **Categoría:** duplication
- **Surface(s):** admin · client
- **Evidencia:** `apps/admin/components/shared/LoadingSpinner.tsx` ≈ `apps/client/components/shared/LoadingSpinner.tsx`.
- **Recomendación honesta:** `CONSOLIDATE-TO-PACKAGE`
- **Acción candidata:** Mover a `@packages/ui/LoadingSpinner`. Borrar copias en apps. Estimación: XS = 15 min.
- **NEEDS_EDWARD:** no
- **Bloqueado por:** —

### audit-FN-033 — notificationStore (Zustand) duplicado

- **Categoría:** duplication
- **Surface(s):** admin · client
- **Evidencia:** `lib/stores/notificationStore.ts` en ambos apps. Probablemente idénticos.
- **Recomendación honesta:** `CONSOLIDATE-TO-PACKAGE`
- **Acción candidata:** Diff entre los dos primero. Si idénticos → mover a `@packages/ui/stores` o `@packages/state`. Si divergentes → revisar por qué.
- **NEEDS_EDWARD:** no (después de confirmar idénticos)
- **Bloqueado por:** —

### audit-FN-034 — useMultiPlatformScheduling hook duplicado

- **Categoría:** duplication
- **Surface(s):** admin · client
- **Evidencia:** `hooks/api/useMultiPlatformScheduling.ts` en ambos. Admin probablemente vestigio.
- **Recomendación honesta:** `DELETE-NOW` (la versión admin si no se usa) o `CONSOLIDATE-TO-PACKAGE`
- **Acción candidata:** Diff entre los dos. Si admin es vestigio → borrar admin's. Si los dos se usan distintamente → consolidar a `@shared/hooks` o documentar la diferencia.
- **NEEDS_EDWARD:** no
- **Bloqueado por:** —

### audit-FN-035 — multi-platform-scheduling types duplicados

- **Categoría:** duplication
- **Surface(s):** admin · client
- **Evidencia:** `types/multi-platform-scheduling.ts` en ambos apps.
- **Recomendación honesta:** `CONSOLIDATE-TO-PACKAGE`
- **Acción candidata:** Mover a `@shared/types/multi-platform-scheduling.ts`. Importar de ahí en ambos apps. Estimación: XS = 15 min.
- **NEEDS_EDWARD:** no
- **Bloqueado por:** —

---

## §8 MISMATCH — funcionalmente rotos hoy

### audit-FN-036 — usePerformanceInsights llama admin endpoint desde client

- **Categoría:** mismatch (security + functional)
- **Surface(s):** client
- **Evidencia:** `apps/client/hooks/api/usePerformanceInsights.ts` invoca `/admin/analytics/overview` — pero el customer JWT nunca pasa el admin gate del backend. El hook siempre retorna 401. La feature está rota silenciosamente: el cliente no ve PerformanceInsights jamás.
- **Recomendación honesta:** `FIX-NOW`
- **Acción candidata:** Crear endpoint customer-facing equivalente (`/analytics/performance-insights` con filtro por `accountId` del JWT), o quitar la feature del cliente si era admin-only. Estimación: M = 2-4 h.
- **NEEDS_EDWARD:** yes (intent original — feature client o admin)
- **Bloqueado por:** —

### audit-FN-037 — useReports paths para verificar

- **Categoría:** mismatch (potencial)
- **Surface(s):** client
- **Evidencia:** Hook flagged en inventory-client por el grep no extraer todos los paths que llama. Requiere verificación manual.
- **Recomendación honesta:** `VERIFY`
- **Acción candidata:** Abrir el archivo, listar cada endpoint que invoca, verificar contra `apps/api/src/**/*Routes.ts`. Si todos existen → VÁLIDO. Si alguno no → MISMATCH y mover a §8.
- **NEEDS_EDWARD:** no
- **Bloqueado por:** —

### audit-FN-038 — Stale endpoint references heredadas

- **Categoría:** mismatch
- **Surface(s):** client · admin
- **Evidencia:** Inventario client + admin reportan múltiples `fetch("/api/backend/*")` apuntando a endpoints inexistentes. Heredados de la era pre-separation admin↔client.
- **Recomendación honesta:** `FIX-NOW` o `DELETE-NOW` (los hooks que llaman, ver audit-FN-030)
- **Acción candidata:** Ya cubierto por §audit-FN-030. Marcar como duplicado de ese.
- **NEEDS_EDWARD:** no
- **Bloqueado por:** audit-FN-030

### audit-FN-039 — Saga payload shapes vs producer

- **Categoría:** mismatch
- **Surface(s):** api · workers
- **Evidencia:** Algunos processors esperan payload shape X, producer en saga envía shape Y. Caso concreto: `providers/instagram/publishingWorker` payload no match `PublishJobInput` (mencionado en inventario workers).
- **Recomendación honesta:** `FIX-NOW` (si keep) o `DELETE-NOW` (si discard)
- **Acción candidata:** Si audit-FN-014 se ejecuta (delete instagram worker) → este se resuelve. Otherwise reconciliar el payload.
- **NEEDS_EDWARD:** no
- **Bloqueado por:** audit-FN-014

---

## §9 ARCHITECTURAL-VIOLATION — port-adapter asymmetry

### audit-FN-040 — SemanticLockPort impl en apps/api en lugar de packages/adapters

- **Categoría:** architectural-violation
- **Surface(s):** packages · api
- **Evidencia:** `packages/ports/src/SemanticLockPort.ts` (interface) — pero la implementación vive en `apps/api/src/saga/` en lugar de `packages/adapters/semantic-lock-*`.
- **Recomendación honesta:** `DECIDE`
- **Acción candidata:** Dos caminos: (a) mover impl a `packages/adapters/semantic-lock-postgres` (canon hexagonal puro); (b) mover port a `apps/api/src/domain/ports/` y reconocer que es interno (no shared con workers ni otros apps). Recomendación: (a) si workers van a usar SemanticLock también; (b) si solo api.
- **NEEDS_EDWARD:** yes (decisión arquitectura)
- **Bloqueado por:** —

### audit-FN-041 — PaymentAdapter impls en apps/api/billing en lugar de packages

- **Categoría:** architectural-violation
- **Surface(s):** packages · api
- **Evidencia:** `packages/ports/src/PaymentAdapter.ts` (interface) — implementaciones Stripe + Paddle viven en `apps/api/src/billing/` en lugar de `packages/adapters/payment-{stripe,paddle}`.
- **Recomendación honesta:** `DECIDE`
- **Acción candidata:** Igual que audit-FN-040 — (a) mover a packages, (b) reconocer port como api-internal. Recomendación: (a) si quieres permitir reuse desde workers (auto-renewal worker podría usar el adapter directamente en lugar de duplicar lógica — relacionado con audit-FN-004).
- **NEEDS_EDWARD:** yes
- **Bloqueado por:** audit-FN-004 (si decidimos centralizar billing en api, mover adapter no aporta)

---

## §10 DRIFT — múltiples sources of truth

### audit-FN-042 — ProviderId declarado en 3 lugares (con "twitter" vs "x")

- **Categoría:** drift
- **Surface(s):** packages
- **Evidencia:** `ProviderId` type declared in:
  - `@ports/core/ProviderAdapter` → `"x"`
  - `@shared/providers/providerConfig` → `"x"`
  - `@shared/analytics` → `"twitter"` ← outlier
- **Recomendación honesta:** `DECIDE`
- **Acción candidata:** Decidir SoT. Opciones: (a) consolidar todo a `"x"` (renombrar `"twitter"` en analytics — implica migración de datos si la tabla analytics tiene `provider="twitter"` en filas existentes); (b) mantener `"twitter"` en analytics intencionalmente por compat con un sistema externo y documentar la divergencia. Recomendación: (a) si no hay sistema externo; (b) si lo hay.
- **NEEDS_EDWARD:** yes (verificar compat externa)
- **Bloqueado por:** —

### audit-FN-043 — analytics/roiCalculator vs analytics/roi/\* vs CalculateROIUseCase

- **Categoría:** drift / redundancia
- **Surface(s):** api
- **Evidencia:** Tres lugares calculan ROI:
  - `apps/api/src/analytics/roiCalculator.ts`
  - `apps/api/src/analytics/roi/*.ts` (varios archivos)
  - `apps/api/src/application/analytics/CalculateROIUseCase.ts` (canónico por estar en application layer)
- **Recomendación honesta:** `DECIDE` + tendencia `DELETE-NOW` los no-application
- **Acción candidata:** El use case en `application/` es el canon hexagonal. Los otros son legacy. Confirmar que `CalculateROIUseCase` cubre los cálculos de los otros dos, luego borrar legacy. Estimación: M = 2-3 h con verificación.
- **NEEDS_EDWARD:** no (canónico hexagonal: borrar legacy)
- **Bloqueado por:** —

---

## §11 CANON-DEVIATION — fitness check violations soft

### audit-FN-044 — 15 archivos en packages con `import pino` directo

- **Categoría:** canon-deviation (soft)
- **Surface(s):** packages
- **Evidencia:** 15 archivos en `packages/` importan `pino` directo en lugar del factory `createLogger` (canon §Logging & Observability). Fitness check #13 actualmente cubre solo `apps/api/src/` — los packages quedan fuera del enforcement.
- **Recomendación honesta:** `DEFER` (a menos que sea una prioridad de uniformidad ahora)
- **Acción candidata:** Migrar los 15 archivos a `createLogger` del factory `@observability/logger`. Estimación: M = 2-3 h. Plus: extender fitness check #13 a `packages/` para prevenir regresión.
- **NEEDS_EDWARD:** no (técnico)
- **Bloqueado por:** —

### audit-FN-045 — 29 archivos sin @layer header

- **Categoría:** canon-deviation (medio)
- **Surface(s):** packages
- **Evidencia:** 29 archivos sin `@layer` declarado. Fitness check #10 es hard-zero pero cubre `apps/` + `packages/`. Esto debería estar fallando CI ahora.
- **Recomendación honesta:** `FIX-NOW`
- **Acción candidata:** Para cada archivo: leer su contexto + añadir `@layer infrastructure` (todos en packages son infrastructure por mapping de §10 CLAUDE.md). Estimación: S = 1 h con script asistido.
- **NEEDS_EDWARD:** no
- **Bloqueado por:** —

### audit-FN-046 — packages/providers/\_template/ env reads

- **Categoría:** canon-allow-list (intencional)
- **Surface(s):** packages
- **Evidencia:** Archivos en `packages/providers/_template/` leen `process.env.*` directamente. Fitness checks #15/#19 lo excluyen explícitamente porque es scaffolding educativo.
- **Recomendación honesta:** `NO-ACTION` — preservar como está
- **Acción candidata:** Confirmar que el JSDoc del template explica que las env reads son intencionales para enseñar el patrón. Si no, añadir nota.
- **NEEDS_EDWARD:** no
- **Bloqueado por:** —

---

## §12 UNKNOWN — requiere verificación

### audit-FN-047 — CRM adapters (HubSpot / Salesforce)

- **Categoría:** UNKNOWN
- **Surface(s):** packages
- **Evidencia:** `packages/adapters/crm-hubspot/`, `packages/adapters/crm-salesforce/` — no aparecen importados directamente en `apps/`. Posible factory-dispatched via DI.
- **Recomendación honesta:** `VERIFY`
- **Acción candidata:** `rg "crm-hubspot\|crm-salesforce\|HubspotAdapter\|SalesforceAdapter" apps packages` para encontrar callers reales. Si 0 → DEAD. Si DI factory → VÁLIDO.
- **NEEDS_EDWARD:** no
- **Bloqueado por:** —

### audit-FN-048 — Storage adapters non-S3

- **Categoría:** UNKNOWN
- **Surface(s):** packages
- **Evidencia:** `packages/adapters/storage-{azure,cloudinary,gcs}/` — solo `storage-s3` importado directamente. Resto posible factory-dispatched.
- **Recomendación honesta:** `VERIFY`
- **Acción candidata:** Mismo enfoque que FN-047. Verificar si producto los necesita o si son scaffold no-prod.
- **NEEDS_EDWARD:** yes (decisión multi-cloud)
- **Bloqueado por:** —

### audit-FN-049 — orchestration/sync/\* UNKNOWN-leaning-DEAD

- **Categoría:** UNKNOWN tending DEAD
- **Surface(s):** api
- **Evidencia:** `apps/api/src/orchestration/sync/` — 6 archivos. Sin caller productivo aparente.
- **Recomendación honesta:** `VERIFY` y probable `DELETE-NOW`
- **Acción candidata:** Ya cubierto por audit-FN-003. Duplicado.
- **NEEDS_EDWARD:** no
- **Bloqueado por:** audit-FN-003 (mismo item)

---

## Resumen ejecutivo de recomendaciones

| Recomendación                                         |  Count | Items                                                                                  |
| ----------------------------------------------------- | -----: | -------------------------------------------------------------------------------------- |
| DELETE-NOW (alto confidence)                          |     17 | FN-001, 002, 003, 004, 005, 006, 007, 008, 009, 012, 014, 017, 018, 019, 020, 021, 030 |
| FIX-NOW (bug operacional o canon)                     |      5 | FN-013, 015, 016, 029, 045                                                             |
| CONSOLIDATE-TO-PACKAGE (duplicación clara)            |      5 | FN-031, 032, 033, 034, 035                                                             |
| WIRE-BACKEND (oportunidad pequeña)                    |      1 | FN-024                                                                                 |
| DECIDE (requiere decisión de producto o arquitectura) |     12 | FN-010, 011, 022, 023, 025, 027, 028, 040, 041, 042, 036 (intent), 043                 |
| VERIFY (sospecha pero baja confidence)                |      5 | FN-026, 037, 047, 048, 049                                                             |
| DEFER                                                 |      1 | FN-044                                                                                 |
| NO-ACTION                                             |      1 | FN-046                                                                                 |
| Mismo que otro item                                   |      2 | FN-038, FN-039                                                                         |
| **Total**                                             | **49** |                                                                                        |

## Recomendación honesta agregada del auditor

Si tuviera que ejecutar el plan SIN consultar más:

1. **Día 1 (~3-5 h):** los 17 DELETE-NOW + los 5 CONSOLIDATE-TO-PACKAGE + los 5 FIX-NOW. Bloque de cleanup mecánico. Branch dedicada (`refactor/audit-cleanup-v1`). 1 commit por categoría (§1/§2/§3/§4/§5/§6/§7 → 7-8 commits cohesivos).
2. **Día 2 (~2-3 h):** los 5 VERIFY ejecutados. Si confirman DEAD → mover al bucket de §1. Si VÁLIDO → cerrar el item.
3. **Después:** una sesión de revisión con producto sobre los 12 DECIDE. Cada uno tiene tradeoff claro, requiere ~5-10 min de Edward decidir. Sesión total ~1-2 h.
4. **Por último:** los DEFER y NO-ACTION quedan documentados como deuda asumida.

Net effect estimado:

- -~5000-8000 LOC eliminadas (dead code + duplicaciones + superseded)
- +~1500 LOC consolidadas en packages/
- 8-12 features fantasma resueltas (wire o discard explícito)
- 1 vulnerabilidad funcional fija (usePerformanceInsights)
- 2 deudas operacionales de deployment cerradas (workers en Dockerfile)
- Arquitectura hexagonal más limpia tras decidir port-adapter asymmetry

**Tiempo estimado total:** ~10-15 h de ejecución mecánica + ~1-2 h de decisiones con Edward = 1-2 semanas de calendario.

Una vez consolidado, OmniPost queda en estado **post-auditoría** medible: la próxima auditoría puede comparar tabla-a-tabla contra esta.
