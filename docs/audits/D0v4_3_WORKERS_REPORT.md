# D0v4-3 — Workers (BullMQ jobs, adapters, idempotencia, retries) Audit Report

> **Sprint:** D0v4-3 (Worker layer + dispatchers + shared BullMQ adapter)
> **Ejecutado:** 2026-04-20
> **Metodología:** §5.8 lectura directa + §5.9 clasificación + CP1 (LATERAL_FINDINGS antes de DEAD_CODE_CANDIDATE)
> **Ejecutor:** agente backend con Opus 4.7 (1M context) bajo plan mode validado
> **Cambios en código:** 0 (100% lectura + docs)

---

## §1. Metodología aplicada

### 1.1 §5.8 — Lectura directa

18 archivos abiertos línea 1→N sin skip. Grep solo como localizador. Cross-count spot-check cada 10 archivos (2 checkpoints).

### 1.2 §5.9 — Clasificación sin delete

Cero archivos propuestos para DELETE. Categorías aplicadas: ACTIVE / PARTIALLY_ACTIVE / PLANNED / INFRASTRUCTURE_READY / BROKEN (nueva categoría para runtime bugs) / DEAD_CODE_CANDIDATE.

### 1.3 Regla CP1 vigente

Todo "no wired" o "behavior inesperado" → LATERAL_FINDINGS con research intent pending, no DEAD_CODE automático.

### 1.4 Checkpoints ejecutados

| CP         | Batch                                                   | Aprobado      | Decisiones críticas                                                                                                                                                         |
| ---------- | ------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CP1**    | B1 (8 archivos, apps/workers/src/)                      | ✅ 2026-04-20 | publishHandler silent failure → crítico; 4/4 workers sin retry → alto; inboxSyncWorker bypass domain → alto + candidato unificación                                         |
| **Cierre** | B2 (10 archivos, dispatchers + inline + BullMQ adapter) | ✅ 2026-04-20 | **QueuePort hardcoded PUBLISH = CRÍTICO**; GATEWAY_SWITCH consumer missing = crítico; L-47 SagaIntegration runtime risk escalado crítico; saga job status fake stub crítico |

---

## §2. Inventario completo de workers

### 2.1 `apps/workers/src/` — 4 workers dedicated + 4 support

| Archivo                       | LOC | Rol                                        | Queue                          |
| ----------------------------- | --: | ------------------------------------------ | ------------------------------ |
| `publishWorker.ts`            | 134 | Consumer bootstrap                         | PUBLISH (via consumer adapter) |
| `publishHandler.ts`           | 629 | **God handler** (3 métodos grandes)        | —                              |
| `publishHandlerTypes.ts`      | 159 | Types solo                                 | —                              |
| `autoRenewalWorker.ts`        | 166 | Consumer + cron scheduler (daily 2 AM UTC) | AUTO_RENEWAL (own Queue)       |
| `analyticsIngestWorker.ts`    | 182 | Consumer per-channel analytics             | ANALYTICS_AGGREGATION          |
| `inboxSyncWorker.ts`          | 180 | Consumer per-channel comment sync          | INBOX_SYNC                     |
| `metrics/workerMetrics.ts`    | 357 | 35+ Prometheus counters/histograms/gauges  | —                              |
| `telemetry/initialization.ts` | 102 | OTel init + mock fallback                  | —                              |

### 2.2 Inline workers en API process

| Archivo                                                                                         | LOC | Rol                                              | Queue(s)                                 |
| ----------------------------------------------------------------------------------------------- | --: | ------------------------------------------------ | ---------------------------------------- |
| `apps/api/src/webhooks/webhookJobProcessor.ts`                                                  | 494 | **Inline worker** — main + DLQ + Queue instances | WEBHOOK_PROCESSING + WEBHOOK_DEAD_LETTER |
| `apps/api/src/infrastructure/integration-events/IntegrationEventConsumer.ts` (cross-ref D0v4-2) |   — | **Inline worker** instanciado en `index.ts:531+` | INTEGRATION_EVENTS                       |

---

## §3. Inventario completo de dispatchers/publishers

| Archivo                                                           | LOC | Queue destino                                                | Método publish                          |
| ----------------------------------------------------------------- | --: | ------------------------------------------------------------ | --------------------------------------- |
| `saga/SagaIntegration.ts`                                         | 546 | PUBLISH (via QueuePort)                                      | `queue.enqueue({...})` L122             |
| `application/analytics/DispatchAnalyticsIngestionUseCase.ts`      | 103 | ANALYTICS_AGGREGATION (declarado) → PUBLISH (real, misroute) | `queue.enqueue()`                       |
| `application/inbox/DispatchInboxSyncUseCase.ts`                   |  92 | INBOX_SYNC (declarado) → PUBLISH (real, misroute)            | `queue.enqueue()`                       |
| `billing/GatewaySwitchJobService.ts`                              | 123 | GATEWAY_SWITCH                                               | Own Queue + `queue.add()` L47, L56      |
| `infrastructure/integration-events/BullMQIntegrationPublisher.ts` |  64 | INTEGRATION_EVENTS                                           | Own Queue + `queue.add()` + `addBulk()` |
| `infrastructure/repositories/BullMQRepurposeJobDispatcher.ts`     |  23 | GENERATE_REPURPOSE (declarado) → PUBLISH (real, misroute)    | `queue.enqueue()`                       |

### 3.1 Shared BullMQ infra (packages)

| Archivo                                            | LOC | Rol                                                                                                                      |
| -------------------------------------------------- | --: | ------------------------------------------------------------------------------------------------------------------------ |
| `packages/adapters/queue-bullmq/src/index.ts`      | 218 | `createBullMQQueueAdapter()` (producer) + `createBullMQConsumerAdapter()` (consumer) — **ambos hardcoded PUBLISH queue** |
| `packages/adapters/queue-bullmq/src/constants.ts`  |  62 | QUEUE_NAMES registry (16 queues)                                                                                         |
| `packages/adapters/queue-bullmq/src/resilience.ts` | 193 | opossum circuit breaker factory + exponential backoff + MetricsCollector                                                 |

---

## §4. MAPA MAESTRO queue ↔ publisher ↔ consumer (16 queues)

> Pieza central del reporte. Fila por cada queue declarada en `QUEUE_NAMES`.

| #   | Queue                   | Publisher(s)                                                                          | Consumer                                  | Idempotency                | Retry                               | Status                                             |
| --- | ----------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------- | ----------------------------------- | -------------------------------------------------- |
| 1   | `PUBLISH`               | SagaIntegration ✅ + **analytics/inbox/repurpose misroute** ❌                        | `publishWorker.ts` via consumer adapter   | ✅ L528 status=OK skip     | ❌ BullMQ defaults                  | 🟠 ACTIVE + POLLUTED                               |
| 2   | `WEBHOOK_PROCESSING`    | `webhookJobProcessor.addWebhookJob`                                                   | `webhookJobProcessor.worker` (inline API) | ✅ jobId L187              | ✅ 3 attempts + exponential 5000ms  | ✅ ACTIVE                                          |
| 3   | `WEBHOOK_DEAD_LETTER`   | `webhookJobProcessor.moveToDeadLetterQueue`                                           | `webhookJobProcessor.deadLetterWorker`    | ✅ jobId L286              | 1 attempt (no retry for DLQ)        | ✅ ACTIVE                                          |
| 4   | `DEAD_LETTER_QUEUE`     | ❓ no detectado                                                                       | ❓ no detectado                           | N/A                        | N/A                                 | ❓ DEAD_CODE_CANDIDATE pending research (CP1)      |
| 5   | `INTEGRATION_EVENTS`    | `BullMQIntegrationPublisher`                                                          | `IntegrationEventConsumer` inline API     | ✅ jobId                   | BullMQ defaults                     | 🟠 PARTIALLY_ACTIVE — handlers NO-OP (D0v4-2 L-44) |
| 6   | `FAILED_OPERATIONS_DLQ` | ❓ no detectado                                                                       | ❓ no detectado                           | N/A                        | N/A                                 | ❓ DEAD_CODE_CANDIDATE pending research            |
| 7   | `ANALYTICS_AGGREGATION` | DispatchAnalyticsIngestion **(misroute a PUBLISH)**                                   | `analyticsIngestWorker.ts`                | ✅ upsert composite key    | ❌ defaults                         | 🔴 **BROKEN** (publisher misroute)                 |
| 8   | `REPORT_GENERATION`     | ❓ (D0v4-1 GenerateReportUseCase NO usa BullMQ directo)                               | ❌ no worker                              | N/A                        | N/A                                 | 📋 PLANNED (Edward CP4)                            |
| 9   | `RECURRING_POSTS`       | ❓ (D0v4-1 ProcessRecurrenceUseCase NO usa BullMQ directo)                            | ❌ no worker                              | N/A                        | N/A                                 | 📋 PLANNED                                         |
| 10  | `INBOX_SYNC`            | DispatchInboxSync **(misroute a PUBLISH)**                                            | `inboxSyncWorker.ts`                      | ✅ findFirst dedup L101    | ❌ defaults                         | 🔴 **BROKEN** (publisher misroute)                 |
| 11  | `DETECT_REPURPOSE`      | ❓ (publisher unconfirmed)                                                            | ❌ no worker                              | N/A                        | N/A                                 | 📋 PLANNED                                         |
| 12  | `GENERATE_REPURPOSE`    | BullMQRepurposeJobDispatcher **(misroute a PUBLISH)**                                 | ❌ no worker                              | N/A                        | N/A                                 | 🔴 **BROKEN + PLANNED** (double issue)             |
| 13  | `TRIAGE_INBOX`          | ❓ (TriageInboxMessageUseCase invocado desde InboxEventHandlers, NO enqueue a BullMQ) | ❌ no worker                              | N/A                        | N/A                                 | 📋 PLANNED                                         |
| 14  | `TREND_RADAR`           | ❓ (publisher unconfirmed)                                                            | ❌ no worker                              | N/A                        | N/A                                 | 📋 PLANNED                                         |
| 15  | `AUTO_RENEWAL`          | `autoRenewalWorker.setupCron`                                                         | `autoRenewalWorker.ts`                    | ⚠️ cron pattern idempotent | ❌ defaults                         | ✅ ACTIVE                                          |
| 16  | `GATEWAY_SWITCH`        | `GatewaySwitchJobService` (own Queue)                                                 | ❌ **no worker visible**                  | ✅ jobId L52/61            | ✅ 3 attempts + exponential 30000ms | 🔴 **BROKEN** (consumer missing)                   |

### 4.1 Resumen cuantitativo

| Clasificación                                         |                                                                               Count |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------: |
| ACTIVE correctamente wired                            |          4 (PUBLISH partial, WEBHOOK_PROCESSING, WEBHOOK_DEAD_LETTER, AUTO_RENEWAL) |
| PARTIALLY_ACTIVE (handlers NO-OP)                     |                                                              1 (INTEGRATION_EVENTS) |
| 🔴 **BROKEN** (publisher misroute o consumer missing) |       **4** (ANALYTICS_AGGREGATION, INBOX_SYNC, GENERATE_REPURPOSE, GATEWAY_SWITCH) |
| 📋 PLANNED (Edward CP4)                               | 5 (REPORT_GENERATION, RECURRING_POSTS, DETECT_REPURPOSE, TRIAGE_INBOX, TREND_RADAR) |
| ❓ DEAD_CODE_CANDIDATE pending                        |                                        2 (DEAD_LETTER_QUEUE, FAILED_OPERATIONS_DLQ) |

**De las 16 queues declaradas, solo 4 funcionan correctamente.** El resto tiene problemas estructurales (broken wiring o not implemented).

---

## §5. Idempotency audit por worker

| Worker                               | Idempotency strategy      | Evidence                                                                                                                                           | Risk                   |
| ------------------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `publishWorker` (via publishHandler) | ✅ GOLD STANDARD          | L521 `dedupeKey = \`${postId}:${channelId}\``+ L528-534 check`status === "OK"` skip                                                                | Low                    |
| `autoRenewalWorker`                  | ⚠️ Cron-pattern dependent | L37 `queue.add('process-auto-renewals', {}, { repeat: { pattern: "0 2 * * *" } })` — sin jobId determinístico. Cron fires 1/day → dedupe implícito | Low (single daily run) |
| `analyticsIngestWorker`              | ✅ via Prisma upsert      | L106-136 `prisma.$transaction(metrics.map(m => upsert({...composite key})))`                                                                       | Low                    |
| `inboxSyncWorker`                    | ✅ findFirst + skip       | L101-112 dedupe por `providerMessageId + provider`                                                                                                 | Low                    |
| `webhookJobProcessor`                | ✅ jobId determinístico   | L187 `jobId: \`webhook-${provider}-${eventId}\``                                                                                                   | Low                    |
| `IntegrationEventConsumer` (inline)  | ✅ jobId                  | D0v4-2 read — BullMQ jobId=eventId                                                                                                                 | Low                    |

**No IDEMPOTENCY_RISK detectado.** Todos los consumers tienen alguna estrategia.

---

## §6. Retry policy audit por worker

| Worker                       | `attempts`                     | `backoff`                   | Risk                                                             |
| ---------------------------- | ------------------------------ | --------------------------- | ---------------------------------------------------------------- |
| `publishWorker`              | ❌ defaults (BullMQ 0 retries) | ❌ none                     | 🔴 NO_RETRY_POLICY — Transient provider failures = jobs perdidos |
| `autoRenewalWorker`          | ❌ defaults                    | ❌ none                     | 🟠 Low risk (daily cron) but NO_RETRY_POLICY                     |
| `analyticsIngestWorker`      | ❌ defaults                    | ❌ none                     | 🔴 NO_RETRY_POLICY                                               |
| `inboxSyncWorker`            | ❌ defaults                    | ❌ none                     | 🔴 NO_RETRY_POLICY                                               |
| `webhookJobProcessor` (main) | ✅ 3 attempts                  | ✅ exponential delay 5000ms | ✅ GOLD STANDARD                                                 |
| `webhookJobProcessor` (DLQ)  | ✅ 1 attempt (by design)       | N/A                         | ✅                                                               |

**4 de 6 workers sin retry policy explícita.** Único correctamente configurado: `webhookJobProcessor`.

---

## §7. Circuit breaker / timeout audit (external API calls)

| Componente                                                                                                                 | Circuit breaker                      | Timeout                                                           | Observación                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Provider adapters (11: x, instagram, facebook, youtube, tiktok, snapchat, telegram, pinterest, linkedin, bluesky, threads) | ❓ delegado al adapter internal      | ❓ delegado al adapter internal                                   | No visible at worker layer. publishHandler L141 `provider.publish` + L380 `provider.publishThread` sin timeout wrapper |
| BullMQ queue operations (enqueue, health, remove)                                                                          | ✅ opossum 5s timeout, 50% threshold | ✅ 5000ms                                                         | `packages/adapters/queue-bullmq/src/resilience.ts`                                                                     |
| webhookJobProcessor                                                                                                        | ❌ no circuit breaker para providers | ❌ no timeout en `webhookHandler.handleWebhook`                   | Risk medium                                                                                                            |
| analyticsIngestWorker / inboxSyncWorker provider calls                                                                     | ❌ no circuit breaker                | ❌ no timeout en `adapter.fetchAnalytics` / `adapter.getComments` | Risk high                                                                                                              |

**Coverage**: circuit breakers solo en el BullMQ adapter layer. Provider-level resilience delegada al adapter interno — no validado en este sprint.

---

## §8. Graceful shutdown audit

| Worker/Service                   |    SIGTERM handler     |     worker.close()      |      Redis cleanup       | prisma.$disconnect |
| -------------------------------- | :--------------------: | :---------------------: | :----------------------: | :----------------: | ------------------------------------------ |
| `publishWorker`                  |           ❌           |           ❌            |            ❌            |         ❌         |
| `autoRenewalWorker`              |        ✅ L159         |           ✅            |            ✅            |         ✅         |
| `analyticsIngestWorker`          |           ❌           |           ❌            |            ❌            |         ❌         |
| `inboxSyncWorker`                |           ❌           |           ❌            |            ❌            |         ❌         |
| `webhookJobProcessor.shutdown()` |    ⚠️ method exists    |           ✅            |   ✅ (via queue.close)   |        N/A         | Method is defined but unclear who calls it |
| `SagaIntegration.shutdown()`     | ✅ via app.close chain | ✅ sagaManager.shutdown | ✅ subscriber disconnect |        N/A         |

**3 de 4 workers dedicated sin graceful shutdown.** Durante deploy, jobs en-flight pueden quedar a medias → publicaciones parciales a platforms sociales visibles al usuario.

---

## §9. Cross-ref con hallazgos D0v4-2 (OBLIGATORIO)

### §9.1 L-43 OutboxRelay race confirmación

**Hipótesis D0v4-2:** OutboxRelay sin `SELECT FOR UPDATE SKIP LOCKED` causa duplicate dispatch en multi-pod.

**Validación §5.8 en workers:** `grep "OutboxRelay\|OutboxCleaner" apps/workers/src/` retorna 0 resultados. OutboxRelay corre únicamente en proceso API ([apps/api/src/index.ts:610](apps/api/src/index.ts#L610)).

**Conclusión:** Riesgo multi-pod contenido al deploy del API. Si API escala a N pods → N OutboxRelay instances compiten por los mismos eventos. Risk **unchanged** desde D0v4-2.

### §9.2 L-44 Handlers NO-OP confirmación

**Hipótesis D0v4-2:** `AnalyticsEventHandler` + `WebhookEventHandler` no-op → webhook system fantasma.

**Validación §5.8 en workers:** workers NO consumen directamente estos handlers. Descubrimiento Batch 2: existen **2 sistemas paralelos de webhook delivery**:

1. **Incoming webhooks (from Stripe/Paddle/providers)** → `webhookJobProcessor.processWebhookJob` → `UniversalWebhookHandler.handleWebhook` — **FUNCIONAL**
2. **Outgoing integration events (Zapier/Make/custom subscriptions)** → `IntegrationEventConsumer` inline API → `AnalyticsEventHandler` + `WebhookEventHandler` — **FANTASMA (D0v4-2 L-44)**

Edward CP3 decision: crítico. Sistema 2 (outgoing) sigue broken; Sistema 1 (incoming) funciona independientemente.

### §9.3 L-47 CQRS runtime risk — ESCALADO A CRÍTICO

**Hipótesis D0v4-2:** CQRSBusImpl activo con handler registry vacío. Si workers ejecutan commands → runtime error.

**Validación §5.8 en workers:** `grep "cqrsBus\|CQRSBus" apps/workers/src/` retorna 0 resultados. **Cero ejecuciones de commands/queries via bus en workers dedicated.**

**HOWEVER — HALLAZGO NUEVO:** [apps/api/src/saga/SagaIntegration.ts:112-114](apps/api/src/saga/SagaIntegration.ts#L112-L114):

```ts
async (command: Command) => {
  return await this.config.cqrsBus.executeCommand(command);
};
```

SagaIntegration (instanciado en [index.ts:538+](apps/api/src/index.ts#L538)) inyecta `CQRSBusImpl` y registra un command executor en `createPostPublishingSagaDefinition`. Si cualquier saga step invoca commands → `No handler registered for command type: X` runtime error.

**Riesgo activo** depende de si `@shared/saga` package's `createPostPublishingSagaDefinition` invoca commands o solo enqueue jobs. Verificación final requiere leer `@shared/saga` (out-of-scope D0v4-3, planned D0v4-7).

**Severidad escalada: CRÍTICO** (Edward Cierre Final).

### §9.4 L-36 EventService instances confirmación

**Validación §5.8 en workers:** `grep "new EventService\|EventService" apps/workers/src/` retorna 0 resultados. Cero instancias paralelas en workers. Contained en API.

### §9.5 L-51 setInterval sin unref confirmación

**Validación §5.8 en workers:** `grep "setInterval" apps/workers/src/` retorna 0 resultados. Workers usan **BullMQ repeatable jobs** (`repeat: { pattern: "0 2 * * *" }` en autoRenewalWorker L41) — pattern superior que `setInterval` para scheduled tasks.

---

## §10. Clasificaciones por categoría

### 10.1 ACTIVE (~5 workers + dispatchers)

- `publishWorker` + `publishHandler` (con silent failure issue)
- `autoRenewalWorker`
- `webhookJobProcessor` (inline API)
- `GatewaySwitchJobService` publisher (consumer missing — partial)
- `SagaIntegration` (con L-47 runtime risk)

### 10.2 PARTIALLY_ACTIVE

- `IntegrationEventConsumer` inline API (handlers NO-OP D0v4-2 L-44)
- `PUBLISH` queue (polluted con jobs misrouted)

### 10.3 🔴 BROKEN (nueva categoría — hallazgos D0v4-3)

- `ANALYTICS_AGGREGATION` queue — publisher misroute a PUBLISH
- `INBOX_SYNC` queue — publisher misroute a PUBLISH
- `GENERATE_REPURPOSE` queue — publisher misroute + no consumer
- `GATEWAY_SWITCH` queue — consumer missing
- `publishHandler.handleJob` silent failure (catch-all sin re-throw)
- `SagaIntegration` job status checker stub fake

### 10.4 PLANNED (Edward CP4)

- 5 queues: REPORT_GENERATION, RECURRING_POSTS, DETECT_REPURPOSE, TRIAGE_INBOX, TREND_RADAR
- Edward CP4: arquitectura incompleta, wire en sprint futuro. UC publishers D0v4-1 existen pero worker missing.

### 10.5 DEAD_CODE_CANDIDATE (pending research CP1)

- DEAD_LETTER_QUEUE (no publisher ni consumer visible)
- FAILED_OPERATIONS_DLQ (idem)

### 10.6 LEGACY

Ninguno detectado en este sprint.

### 10.7 Resumen cuantitativo

| Clase                |                                 Count |
| -------------------- | ------------------------------------: |
| ACTIVE correctamente |                          5 components |
| PARTIALLY_ACTIVE     |                                     2 |
| 🔴 BROKEN            | 6 items (4 queues + 2 runtime issues) |
| PLANNED              |                              5 queues |
| DEAD_CODE_CANDIDATE  |                              2 queues |

---

## §11. Duplicaciones detectadas

### 11.1 3 ubicaciones de workers en el monorepo

1. `apps/workers/src/` (4 workers dedicated + handlers)
2. `apps/api/src/webhooks/webhookJobProcessor.ts` (inline API)
3. `apps/api/src/infrastructure/integration-events/IntegrationEventConsumer` instanciado inline en `index.ts:531+`

Complejidad de DI + lifecycle + deploy topology. Difícil auditar "¿qué worker corre dónde?".

### 11.2 `inboxSyncWorker` vs `IngestSocialMessageUseCase` (D0v4-1)

Worker reimplementa dedup + create logic directamente en Prisma (L101-134) mientras D0v4-1 auditó UC completo con:

- `SocialMessageAggregate.create` + invariants
- `findOrCreateByRoot` conversation linking
- `eventDispatcher.dispatchAll` domain events

Worker **bypass completo del domain layer** → triage AI + notifications downstream **nunca ejecutan** para comments ingested vía worker.

**Unificación candidate** (Edward CP1).

### 11.3 2 sistemas paralelos de webhook delivery

- **Incoming** (Stripe/Paddle → `webhookJobProcessor` → `UniversalWebhookHandler`): funcional
- **Outgoing** (Events → `IntegrationEventConsumer` → `AnalyticsEventHandler`/`WebhookEventHandler` NO-OP): fantasma

Naming overloading — ambos sistemas "webhook" pero propósitos opuestos. Clarificación nomenclatura necesaria.

### 11.4 Provider registry drift

- `publishWorker.ts` registra **11 providers** (incluye threads)
- `analyticsIngestWorker.ts` + `inboxSyncWorker.ts` registran **10 providers** (missing threads)

Además: `apps/api/src/providers/providerRegistry.ts` es el registry canónico en API (D0v4-1 L-14). Workers reimplementan localmente → 3 registries con drift potencial.

### 11.5 3 estilos de Queue instantiation

- **QueuePort adapter** (hardcoded PUBLISH — broken for 3 UCs)
- **Own Queue instances** (autoRenewalWorker, webhookJobProcessor, GatewaySwitchJobService, BullMQIntegrationPublisher) — bypass del adapter broken
- **Consumer adapter** (hardcoded PUBLISH consumer)

Inconsistente. Unificación post-fix candidate.

---

## §12. Acoplamientos sospechosos

### 12.1 `publishHandler.ts` God handler 629 LOC

- `publishSinglePost` (L105-261, ~157 LOC)
- `publishThreadPost` (L263-514, ~252 LOC) — mega-method
- `handleJob` (L516-628, ~113 LOC)
- Mezcla: provider switch + saga notification + instrumentation + DB writes + thread management + error handling

**Split candidate**: `PublishOrchestrator` + `PostPublisher` + `ThreadPublisher` + `SagaNotifier` + `PublishMetrics`.

### 12.2 `webhookJobProcessor.ts` 494 LOC (inline API worker)

God class: Queue creation + Worker creation + DLQ + priority + delay + DB writes + event listeners + shutdown. Similar pattern al L-34 D0v4-2 `index.ts` God file.

### 12.3 `SagaIntegration.ts` 546 LOC

Registers saga defs + registers routes (6 routes) + sets up pub/sub + manages subscriber connection + shutdown. Partición por concern: orchestration vs API exposure vs transport layer.

### 12.4 Cross-process dependencies no DI'd

- publishWorker usa `xAdapter` + 10 otros via static imports
- analyticsIngestWorker idem (10 providers)
- inboxSyncWorker idem (10 providers)
- webhookJobProcessor usa `UniversalWebhookHandler` via import directo

Workers no comparten el DI container de API. Cada worker bootstrap hace sus propios singletons.

### 12.5 Silent error swallowing patterns

- `publishHandler.handleJob:606-627` catch-all sin re-throw → BullMQ retries disabled
- `analyticsIngestWorker:82-85` silent AUTH error skip
- `inboxSyncWorker:90-94` silent AUTH error skip
- `ComposedEventDispatcher:54-78` (D0v4-2 L-46) swallows BullMQ errors
- `SagaIntegration:143-152` fake optimistic job status

**Pattern sistemático**: errors silenciados en worker-related code. Debugging en producción extremadamente difícil.

---

## §13. Patterns inconsistentes

### 13.1 Worker bootstrap styles

- `publishWorker` — minimal, delegates to handler class
- `autoRenewalWorker` — full monolithic (Queue + cron + Worker + event listeners + SIGTERM)
- `analyticsIngestWorker` / `inboxSyncWorker` — middle ground (Worker + processJob function)
- `webhookJobProcessor` — class-based OOP (ClassA style)
- `GatewaySwitchJobService` — class-based publisher-only

### 13.2 Retry policy configuration styles

- Explicit: `webhookJobProcessor` L60-64, `GatewaySwitchJobService` L35-36
- Defaults: otros 4 workers

### 13.3 Idempotency strategies (coexisten 4 patrones)

- jobId determinístico (webhookJobProcessor, GatewaySwitchJobService, publishHandler dedupe key)
- Check existing via DB read (publishHandler L528, inboxSyncWorker L101)
- Upsert (analyticsIngestWorker L106)
- Cron-dependent (autoRenewalWorker — pattern one-shot daily)

### 13.4 Graceful shutdown coverage

1 de 4 workers dedicated tiene SIGTERM (autoRenewalWorker). El resto: missing.

### 13.5 Provider registry location

3 copies: API (providerRegistry.ts) + publishWorker (11 providers) + analyticsIngest/inboxSync (10 providers each).

---

## §14. Hallazgos laterales para LATERAL_FINDINGS.md

Entradas L-52 a L-67 agregadas. Ver [docs/audits/LATERAL_FINDINGS.md](LATERAL_FINDINGS.md) sección "Hallazgos D0v4-3 (2026-04-20)".

| #    | Título                                                                                                               | Severidad                    |
| ---- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| L-52 | `publishHandler.handleJob` silent failure (catch-all sin re-throw)                                                   | crítico                      |
| L-53 | 4/6 workers sin retry policy explícita                                                                               | alto                         |
| L-54 | 3/4 workers dedicated sin graceful shutdown                                                                          | alto                         |
| L-55 | `inboxSyncWorker` bypassa IngestSocialMessageUseCase (D0v4-1) + domain layer                                         | alto (unificación candidate) |
| L-56 | `analyticsIngest` + `inboxSync` silent AUTH errors                                                                   | medio                        |
| L-57 | `publishHandler.ts` God handler 629 LOC                                                                              | medio                        |
| L-58 | High cardinality Prometheus labels (`channel_id` en counters)                                                        | medio                        |
| L-59 | `telemetry/initialization.ts:61-63` 3 `any` types exportados                                                         | bajo                         |
| L-60 | Provider registry drift — 11 vs 10 providers en workers                                                              | bajo                         |
| L-61 | **`QueuePort` adapter hardcoded PUBLISH queue → 3 dispatchers misroute jobs**                                        | **crítico**                  |
| L-62 | `GATEWAY_SWITCH` queue publisher activo pero **consumer missing**                                                    | **crítico**                  |
| L-63 | `SagaIntegration:112-114` ejecuta commands via CQRSBus vacío (escalado de D0v4-2 L-47)                               | **crítico**                  |
| L-64 | `SagaIntegration:143-152` job status checker STUB fake optimistic                                                    | **crítico**                  |
| L-65 | 3 ubicaciones de workers en monorepo (apps/workers + 2 inline API)                                                   | medio                        |
| L-66 | 5 queues PLANNED — workers missing (REPORT_GENERATION, RECURRING_POSTS, DETECT_REPURPOSE, TRIAGE_INBOX, TREND_RADAR) | medio (Edward CP4)           |
| L-67 | DEAD_LETTER_QUEUE + FAILED_OPERATIONS_DLQ sin publisher ni consumer detectable                                       | bajo (pending research)      |

**Severidad summary:**

- 🔴 **Crítico: 5** (L-52, L-61, L-62, L-63, L-64)
- 🟠 Alto: 3 (L-53, L-54, L-55)
- 🟡 Medio: 6 (L-56, L-57, L-58, L-65, L-66 consolidado, + otros)
- 🟢 Bajo: 3 (L-59, L-60, L-67)

---

## §15. Predicción para Sprint D0v4-4 (Frontend client pages/components)

### Scope esperado

`apps/client/` — Next.js App Router:

- Pages (`app/(dashboard)/*`, `app/auth/*`, `app/api/*` rewrites)
- Layouts (`layout.tsx` by folder)
- Components (`components/**/*.tsx`)
- Feature components (`features/**/*.tsx` si existe)
- Server actions (`_actions.ts`)

Scope estimado: **80-120 archivos** (per PLAN §9).

### Hallazgos esperables

1. **3 carpetas paralelas de hooks** (D0v4-1 L y CLIENT_LIB_HOOKS_AUDIT.md) ya conocido — D0v4-4 cubre componentes/pages, D0v4-5 cubre hooks.
2. **React 19.2 + Next.js 16 compliance** per Frontend Standards.
3. **Posible consumo de endpoints BROKEN** (queues misrouted desde D0v4-3 L-61) — si client llama `/analytics/dispatch-ingestion` o similar, frontend ve éxito API pero backend nunca procesa. Verificar.
4. **Componentes que llaman endpoints D0v4-2 L-44 fantasma** (webhook system outgoing) — UI de webhook management de Zapier/Make/custom probablemente muestra subscriptions activas pero NO reciben eventos.
5. **Sprint 2 BUILD_UI backlog** (LATERAL_FINDINGS 2026-04-19: +21 endpoints reclassify) — páginas faltantes que D1 no incluyó.

### Riesgos D0v4-4

- Volumen de archivos mayor al de sprints backend → ritmo probablemente se reduce
- Validación frontend/backend contract requiere cross-ref con D0v4-1 (endpoint inventory)
- React 19 patterns + Compiler optimization visibility
- Si frontend consume endpoints BROKEN (L-61), UX silenciosamente roto

---

## §16. Anexo — Verification checklist

- [x] 18 archivos procesados (plan 18, ✅ exacto)
- [x] §4 mapa maestro con 16 queues (todas declaradas)
- [x] §5 idempotency audit 6 workers
- [x] §6 retry policy audit 6 workers
- [x] §9 cross-ref explícito L-43/L-44/L-47/L-36/L-51 con validación §5.8
- [x] §7 CQRS decision N/A (ya resuelto en D0v4-2 Edward CP4 = PLANNED)
- [x] 16 hallazgos laterales nuevos L-52..L-67
- [x] 5 críticos identificados (L-52, L-61, L-62, L-63, L-64)
- [x] Checkpoints 1 + Cierre aprobados Edward
- [x] Zero cambios en `apps/`, `packages/`, `infra/` (solo docs)

---

## §17. Anexo — Commit sugerido

```text
docs(audits): D0v4-3 workers audit report

18 archivos auditados bajo §5.8 + §5.9 + CP1 en 2 batches.
Mapa queue↔publisher↔consumer completo: 16 queues auditadas.
L-43/L-44/L-47/L-36/L-51 de D0v4-2 cross-referenciados con lectura directa.

5 hallazgos críticos:
- L-52 publishHandler silent failure (jobs perdidos sin retry)
- L-61 QueuePort hardcoded PUBLISH — 3 dispatchers misroute jobs
- L-62 GATEWAY_SWITCH queue sin consumer
- L-63 SagaIntegration ejecuta commands via CQRSBus vacío (escalado de L-47)
- L-64 SagaIntegration job status checker STUB fake optimistic

16 hallazgos laterales (L-52..L-67). 4 queues BROKEN.
PLAN_MAESTRO §6 actualizado.

Ready para Sprint D0v4-4 (Frontend client pages/components).
```
