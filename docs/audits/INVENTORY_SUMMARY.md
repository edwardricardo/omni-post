---
title: Inventory summary — full-repo audit
description: Resultado agregado de los 5 inventarios paralelos (api, workers, admin, client, packages) ejecutados el 2026-05-11. 1477 archivos clasificados con plantilla uniforme.
generated: 2026-05-11
auditor: claude-code
---

# Inventory summary — full-repo audit

> Digest agregado de los 5 inventarios per-surface. Cada surface tiene su archivo completo en `docs/audits/inventory-<surface>.md` con plantilla per-archivo detallada. Este documento sintetiza para uso de toma de decisiones.
>
> **Metodología:** ver [AUDIT_METHODOLOGY.md](AUDIT_METHODOLOGY.md).
> **Hallazgos item-por-item con recomendación:** ver [\_AUDIT_FINDINGS.md](_AUDIT_FINDINGS.md).

---

## 1. Totales

**1477 archivos `.ts` / `.tsx` inventariados** distribuidos en 5 surfaces. Skip: tests (`*.test.ts`, `tests/`), stories (`*.stories.tsx`), generated (`dist/`, `.next/`, `node_modules`).

| Surface      |    Files |    VÁLIDO |    DEAD | FORGOTTEN | MISMATCH | REDUNDANTE | UNKNOWN |
| ------------ | -------: | --------: | ------: | --------: | -------: | ---------: | ------: |
| **api**      |      823 |      ~770 |      12 |         9 |        1 |          2 |     ~29 |
| **admin**    |      180 |       139 |      11 |         1 |        2 |          4 |       4 |
| **client**   |      226 |       215 |       0 |         6 |        3 |          2 |       0 |
| **packages** |      235 |      ~200 |      ~5 |    varios |   varios |         ~3 |  varios |
| **workers**  |       13 |         7 |       3 |         1 |        2 |          0 |       0 |
| **Total**    | **1477** | **~1331** | **~31** |   **~17** |   **~8** |    **~11** | **~33** |

**~90% de los archivos son VÁLIDO.** El ~10% restante (146 archivos) es el universo de la fase D — la visita punto-por-punto.

## 2. Distribución por sub-package (`packages/`)

235 archivos en `packages/` distribuidos:

| Sub-package    | Files | Notas                                                                                                                                                 |
| -------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| providers/     |    95 | 11 social (facebook=18, tiktok=15, youtube=12, instagram=6, snapchat/linkedin=5, threads=2, x/telegram/pinterest/bluesky=3) + \_template=2 + shared=4 |
| ui/            |    51 | 35 primitives + 12 business + 2 hooks + utils + index                                                                                                 |
| adapters/      |    41 | cache-redis=11, db-prisma=10, queue-bullmq=6, otros 1-2                                                                                               |
| shared/        |    13 | types, CQRS, saga, events, RBAC                                                                                                                       |
| observability/ |    13 | logger=1, browser-logger=4, scheduler=4, opentelemetry=4                                                                                              |
| ports/         |    11 | Interfaces tecnología-free                                                                                                                            |
| monitoring/    |     9 | circuit-breaker=1, health-checks=8                                                                                                                    |
| api-common/    |     4 | base-route, CSV                                                                                                                                       |
| api-errors/    |     2 | error shapes                                                                                                                                          |
| core/          |     2 | engine                                                                                                                                                |
| query-client/  |     1 | TanStack Query wrapper                                                                                                                                |

## 3. Hallazgos cross-surface (categorías principales)

### a) Código superseded por el saga canon retrofit (DELETE candidates)

El retrofit que se acaba de mergear (`f389124` en main, descendiente de T6 decisions 2026-04-21) introdujo el patrón canónico Richardson + Azure con `defineSaga()`, classified steps, `pivotStepIndex`, `RereadCheck` countermeasure. Los siguientes archivos quedan obsoletos:

- [apps/api/src/orchestration/PublishingOrchestrator.ts](apps/api/src/orchestration/PublishingOrchestrator.ts) + 3 archivos sibling — reemplazado por Saga.
- [apps/api/src/events/EventPublisher.ts](apps/api/src/events/EventPublisher.ts) — reemplazado por `ComposedEventDispatcher`.
- 6 archivos en `apps/api/src/orchestration/sync/` — sin producer-caller en código actual.

### b) Routes / plugins implementados pero nunca registrados (DEAD)

Código completo, tested o no, pero sin path de entrada activa:

- [apps/api/src/posts/optimizedPostsRoutes.ts](apps/api/src/posts/optimizedPostsRoutes.ts) — route file completo, NO está en `apps/api/src/index.ts` ni en feature router.
- [apps/api/src/monitoring/rateLimitingDashboard.ts](apps/api/src/monitoring/rateLimitingDashboard.ts) — Fastify plugin con tests, nunca registered.
- [apps/api/src/mappers/AccountMapper.ts](apps/api/src/mappers/AccountMapper.ts) — zero callers.
- [apps/api/src/utils/dbOptimization.ts](apps/api/src/utils/dbOptimization.ts) — built pero solo asignado a `_dbOptimizer` (variable bloqueada con underscore).

### c) Features con backend completo, UI ausente o stub (FORGOTTEN-FEATURE)

Backend implementado + tested. Frontend ausente, en stub, o llama a un endpoint que devuelve 501.

| Feature                                                                    | Backend                                                                                | Frontend                                                                                                              | Notas                                |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Video processing pipeline                                                  | `apps/api/src/video/` (7 files: thumbnail + uploadPipeline + videoProcessor) — testado | Sin caller productivo                                                                                                 | Implementación completa flotando     |
| Predictive Analytics ML                                                    | Scaffolded → devuelve **501 NOT_IMPLEMENTED**                                          | `apps/client/app/dashboard/ai/analytics/page.tsx` UI completa                                                         | UI funciona, backend nunca terminado |
| Scheduled Reports cron                                                     | Servicio + use case existen                                                            | `apps/client/app/dashboard/analytics/reports/page.tsx` con banner explícito "Manual generation only — cron not wired" | Customer-facing visible debt         |
| AI quality fields (engagement / readability / virality / brandConsistency) | `apps/api/src/ai/` retorna campos `null`                                               | `apps/client/components/ai/{AITemplateSelector,AIContentResults}.tsx` wireados                                        | UI muestra placeholders permanentes  |
| Rate limiting admin dashboard                                              | `apps/api/src/monitoring/rateLimitingDashboard.ts` plugin completo                     | Sin pantalla admin que lo consuma                                                                                     | Plugin huérfano                      |
| EngagementPredictor                                                        | Posible                                                                                | —                                                                                                                     | UNKNOWN — verificar                  |

### d) Duplicación admin↔client (CONSOLIDATE candidates)

Confirmados por `find apps -name <filename>` + diff visual:

1. `lib/auth/sessionCookie.ts` — admin y client tienen versiones casi idénticas → `@packages/auth-cookie` o consolidar en `@packages/api-common`.
2. `components/shared/LoadingSpinner.tsx` — duplicado claro → `@packages/ui`.
3. `lib/stores/notificationStore.ts` — Zustand store probable idéntico → `@packages/state` o `@packages/ui`.
4. `hooks/api/useMultiPlatformScheduling.ts` — admin probable vestigio post-split → diff antes de consolidar.
5. `types/multi-platform-scheduling.ts` — types compartidos → `@shared/types`.

### e) Workers fantasma (deuda operacional silenciosa)

Workers cuyos producers en `apps/api` están vivos pero el `Dockerfile` CMD solo arranca `publishWorker.js`:

- [apps/workers/src/inboxSyncWorker.ts](apps/workers/src/inboxSyncWorker.ts) — jobs encolados, nunca consumidos en prod.
- [apps/workers/src/analyticsIngestWorker.ts](apps/workers/src/analyticsIngestWorker.ts) — mismo problema.
- [apps/workers/src/providers/instagram/publishingWorker.ts](apps/workers/src/providers/instagram/publishingWorker.ts) — sin bootstrap.

Más: 5 queues declaradas en [packages/adapters/queue-bullmq/src/constants.ts](packages/adapters/queue-bullmq/src/constants.ts) sin producer ni processor:

- `recurring-posts`
- `detect-repurpose`
- `triage-inbox`
- `trend-radar`
- `report-generation`

Estas coinciden con los spinoffs `PROPOSED` del POST_BACKLOG histórico (PR-Repurpose-AI-Pipeline, PR-Triage-AI-Inbox, PR-Trend-Radar-Caching, PR-Scheduled-Reports-Cron) — features en planeación, no abandonadas. Pero las constantes deberían quitarse hasta que se wireen.

### f) MISMATCH productivos (features rotas silenciosamente)

Frontend llama backend incorrectamente o backend espera shape distinto al que recibe:

1. **`apps/client/hooks/api/usePerformanceInsights.ts`** llama `/admin/analytics/overview` — endpoint es admin-gated, customer JWT nunca pasa → **feature rota en producción**, cliente nunca ve PerformanceInsights.
2. **`apps/client/app/dashboard/settings/referral/page.tsx`** inline-fetches endpoint que no aparece en route table — falta `referralRoutes.ts` o llama URL incorrecta.
3. **`apps/admin/components/webhooks/`** subscription project selector apunta a `/api/backend/projects` — endpoint no existe.
4. **`autoRenewalWorker.ts`** duplica lógica de `apps/api/src/billing/subscription/TrialManagementService.processAutoRenewals` → dual-write risk; el saga retrofit canonicaliza el path en api, el worker es legacy.
5. **`saga/sagaManagerTypes.ts`** — único archivo en 823 sin `@layer` header (fitness check #10 hard-zero compliance broken).

### g) Asimetría port-adapter (arquitectura quebrada)

Por canon hexagonal: ports viven en `packages/ports/`, adapters viven en `packages/adapters/`. Estos infringen:

- **`SemanticLockPort`** declarado en `packages/ports/` → implementación está en `apps/api/src/saga/` (no en `packages/adapters/`).
- **`PaymentAdapter`** declarado en `packages/ports/` → implementaciones (Stripe / Paddle) están en `apps/api/src/billing/` (no en `packages/adapters/`).

Razón: los flows de pago tienen ramificación de negocio que pesa hacia `apps/api`, no hacia adapter puro. Decisión a tomar: ¿mover impls a `packages/adapters/payment-stripe` + `packages/adapters/payment-paddle`, o mover el port a `apps/api/src/domain/`?

### h) Drift de identificadores (`ProviderId`)

Declarado en 3 lugares con valores divergentes:

- `@ports/core/ProviderAdapter` — usa `"x"`
- `@shared/providers/providerConfig` — usa `"x"`
- `@shared/analytics` — usa `"twitter"` ← drift

El analytics layer es el outlier. O analytics se mantiene "twitter" intencionalmente (compat con tablas externas), o se consolida. Decisión a tomar.

### i) DLQ duplicado

Dos implementaciones del concepto "dead letter queue":

- [packages/adapters/dead-letter-queue/src/index.ts](packages/adapters/dead-letter-queue/src/index.ts) — implementación rica pero **viola canon** (raw `pino` + env reads en adapter file, lo cual fitness #19 prohíbe en providers; aquí es adapter no provider, pero el patrón es el mismo).
- `BullMQDeadLetterQueueAdapter` (port-bound) — canónica.

REDUNDANT. La rica probablemente se escribió antes del port-bound y nadie la borró.

### j) Canon deviations (soft fitness violations)

Items que no rompen funcionalidad pero violan reglas codificadas en CLAUDE.md:

- **15 archivos en `packages/` usan `import pino` directo** en lugar del factory `createLogger` (canon §Logging & Observability). No es bloqueante hoy — fitness check #13 solo cubre `apps/api/src/`, no packages/. Pero es deuda de uniformidad.
- **29 archivos sin `@layer` header** (canon §Documentation). Fitness #10 hard-zero cubre `apps/` y `packages/`; estos archivos están en `packages/` pero el contexto exacto requiere verificación per-archivo.
- **`packages/providers/_template/` env reads** — son **intencionales** (scaffolding educativo). Fitness #15/#19 los excluye explícitamente. NO marcar como violation.

### k) UNKNOWN heavy en api (~29 archivos)

`apps/api/src/orchestration/sync/` (6 files) — sin caller productivo claro, pero podrían ser sibling de la familia PublishingOrchestrator (SUPERSEDED). Requiere lectura profunda.

`apps/api/src/lib/templates/` (2 files) — pendiente clasificar.

`apps/api/src/analytics/roiCalculator.ts` overlap con `analytics/roi/*.ts` y `application/analytics/CalculateROIUseCase.ts` — 3 implementaciones del mismo cálculo? Requiere comparación.

## 4. Endpoints y DI

- **73 route modules** registrados en `apps/api/src/index.ts` (94 `register()` calls totales).
- **~250 DI tokens** declarados en `apps/api/src/infrastructure/container/types.ts`, bindeados en ~30 archivos `setup*.ts`.
- **5 processors** activos en workers (publishWorker, autoRenewalWorker, inboxSyncWorker, analyticsIngestWorker, providers/instagram/publishingWorker) — pero solo 1-2 efectivamente arrancados en prod según Dockerfile CMD.

## 5. Métricas finales

| Métrica                                |                        Valor |
| -------------------------------------- | ---------------------------: |
| Archivos totales analizados            |                        1,477 |
| % VÁLIDO                               |                         ~90% |
| Líneas de inventario generadas         |        ~5,500-6,000 markdown |
| Wall-clock auditoría (paralelo)        |                      ~25 min |
| Wall-clock secuencial estimado         |                      ~50 min |
| Documentos eliminados pre-auditoría    |                          132 |
| Hallazgos non-VÁLIDO (entran a Fase D) |                         ~146 |
| Hallazgos prominentes consolidados     | ~35 (en \_AUDIT_FINDINGS.md) |

## 6. Confianza en los hallazgos

| Categoría                                          | Confianza                                                                | Razón                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| DEAD (superseded by retrofit)                      | ALTA                                                                     | Familia clara, archivo+orquestador desplazado por canon nuevo |
| DEAD (routes/plugins not registered)               | ALTA                                                                     | grep concluyente                                              |
| FORGOTTEN-FEATURE (501 endpoints)                  | ALTA                                                                     | UI calls → backend explícitamente 501                         |
| FORGOTTEN-FEATURE (Dockerfile CMD subset)          | ALTA                                                                     | `cat Dockerfile \| grep CMD` confirma                         |
| DUPLICATION (admin↔client)                         | ALTA en 4/5 casos, MEDIA en 1 (useMultiPlatformScheduling necesita diff) |
| MISMATCH (usePerformanceInsights → admin endpoint) | ALTA                                                                     | reproducible: customer JWT siempre 401 en admin endpoint      |
| ARCHITECTURAL (port-adapter asymmetry)             | ALTA pero requiere DECISIÓN, no fix mecánico                             |
| DRIFT (ProviderId "twitter")                       | ALTA pero requiere DECISIÓN (compat externa?)                            |
| UNKNOWN (CRM adapters, storage non-S3)             | BAJA — posible factory dispatch, requiere verificación                   |

## 7. Cuándo re-auditar

Re-correr la auditoría completa cuando:

- Se mergea trabajo de >2000 LOC en `apps/` (cambios estructurales).
- Se añade un nuevo sub-package a `packages/`.
- Se renombra una entidad de dominio (ej. `Project → Subaccount` cuando se haga).
- Pasan 3-6 meses sin auditar (deriva natural).

Re-auditorías parciales (solo `inventory-<surface>.md`) cuando la deriva está concentrada en una surface.
