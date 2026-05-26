# Code Duplications Registry

> Código que **duplica funcionalidad ya escrita**. Se registra aquí (no se repara ni borra en
> caliente) para revisarlo y decidir en conjunto. Convención por entrada: **duplicado ↔ canónico** ·
> **cuál es más completo/canónico** · **veredicto propuesto** (REMOVE+wire / MERGE / KEEP-both).

## DUP-01 — analyticsIngest worker reimplementa un use-case escrito para él · ✅ RESUELTA

- **Estado:** **RESUELTA** (Opción B). El `processJob` duplicado se borró (`apps/workers/src/analyticsIngestWorker.ts`
  eliminado); el use-case canónico `IngestChannelAnalyticsUseCase` ahora se consume **in-process en apps/api** vía
  `apps/api/src/analytics/analyticsIngestConsumer.ts` (patrón bulk-schedule, resuelto del `app.container`). El
  flag-for-reauth en AUTH se preserva componiendo `UpdateChannelAuthStateUseCase`. Single source of truth = el use-case.
- **Duplicado (eliminado):** `apps/workers/src/analyticsIngestWorker.ts` → `processJob()`
- **Canónico:** `apps/api/src/application/analytics/IngestChannelAnalyticsUseCase.ts`
- **Evidencia:** el JSDoc del use-case dice textual _"Called by the analytics ingestion worker (one job
  per channel)"_, pero el worker **nunca lo llama** — reimplementa el cuerpo inline contra `prisma`.
  Misma lógica paso a paso: find channel → resolver adapter + `fetchAnalytics` → ventana `now-30d` →
  upsert de `analyticsDailySummary`.
- **Más completo/canónico:** el **use-case** (ports `ChannelRepository`/`AnalyticsWriteRepository`,
  `UnitOfWork`, `Result<T,E>`, domain errors). El worker pega a `prisma` directo y hace `throw`; son
  equivalentes en cobertura pero el worker no es transaccional vía UoW ni devuelve `Result`.
- **Veredicto propuesto:** **REMOVE** el `processJob` del worker + **wire** al use-case canónico.
- **Bloqueo:** el application core no está en `packages/` → no importable desde `apps/workers`. Requiere
  la épica de compartir el core (Opción B / SMELL-26 + SMELL-39).

## DUP-02 — inboxSync worker reimplementa (degradado) los use-cases de inbox · ✅ RESUELTA

- **Estado:** **RESUELTA** (Opción B). El `processJob` duplicado (que omitía el conversation-grouping) se borró
  (`apps/workers/src/inboxSyncWorker.ts` eliminado); el use-case canónico `SyncProviderCommentsUseCase` (que sí agrupa
  en conversaciones vía `IngestSocialMessageUseCase`) ahora se consume **in-process en apps/api** vía
  `apps/api/src/inbox/inboxSyncConsumer.ts`. El flag-for-reauth en FORBIDDEN/AUTH se preserva vía
  `UpdateChannelAuthStateUseCase`. La copia degradada desapareció.
- **Duplicado (eliminado):** `apps/workers/src/inboxSyncWorker.ts` → `processJob()`
- **Canónico:** `apps/api/src/application/inbox/SyncProviderCommentsUseCase.ts`
  (+ `apps/api/src/application/inbox/IngestSocialMessageUseCase.ts`)
- **Evidencia:** worker = find channel → `adapter.getComments` → por comentario
  `socialMessage.findFirst` (dedup) + `socialMessage.create`. El use-case hace lo mismo pero delega cada
  comentario a `IngestSocialMessageUseCase`.
- **Más completo/canónico:** el **use-case** — además del dedup por `providerMessageId`, agrupa en
  **conversaciones** (`providerParentId` → `SocialConversation`), algo que el worker **OMITE**. El
  duplicado del worker es una copia **degradada** (pierde el conversation-grouping).
- **Veredicto propuesto:** **REMOVE** el `processJob` del worker + **wire** a `SyncProviderCommentsUseCase`
  (recupera el grouping perdido).
- **Bloqueo:** mismo que DUP-01 (core a `packages/`).

> No hay use-case equivalente para `mentionIngestWorker` ni `autoRenewalWorker` — su lógica vive sólo en
> el worker (no son duplicaciones).

## Notas

- Detectado durante **B8** (maratón prisma→DI); **resuelto** justo después vía **Opción B** (consumidores
  in-process en apps/api que corren los use-cases canónicos del `app.container` — patrón bulk-schedule, canon
  CLAUDE.md §DI). Las dos copias de lógica desaparecieron; el use-case es el único hogar.
- **Topología:** los consumidores analytics + inbox pasaron del deployable separado `apps/workers` a in-process
  en `apps/api` (junto a repurpose/triage/trend/bulk-schedule). `mention` (sin use-case) y `autoRenewal`/`publish`
  siguen en `apps/workers`.
- **Pendiente (separado, no es duplicación):** la migración del **application core a `packages/@core`** (para que
  cualquier deployable resuelva los use-cases y los consumidores puedan volver a un proceso aislado si se quiere) —
  trackeada en `roadmap-detected-smells-backlog.md` (SMELL-26/39) y diseñada en
  `docs/architecture/TARGET_ARCHITECTURE_CANON_ES.md`.
