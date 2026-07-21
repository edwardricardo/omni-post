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

## DUP-03 — hooks TanStack de saga vs `runSagaAndAwaitTerminal` (declarativo vs imperativo) · PENDING (KEEP-both)

- **Estado:** **PENDING — veredicto propuesto KEEP-both.** Las dos formas cubren el mismo flow `POST /sagas/post-publishing/start` → `GET /sagas/:sagaId` (polling), pero con semánticas legítimamente distintas: imperativa (resolve-with-Post, sin loading state continuous) vs declarativa (non-blocking, expone status mid-flight para UI progress). Detectado durante S2 cleanup audit (ESTADO_REPO F13+F14; `ESTADO_REPO.md` borrado en la Pre-Fase, findings absorbidos en `MASTER_PLAN_ES.md` §5).
- **"Duplicado":** `apps/client/lib/hooks/useSagaStatus.ts` (F13, TanStack `useQuery` con polling 1s hasta terminal) + `apps/client/lib/hooks/useStartPostPublishingSaga.ts` (F14, TanStack `useMutation`)
- **"Canónico" actual:** `apps/client/lib/api/clients/sagaClient.ts:171-215` → `runSagaAndAwaitTerminal({ start, getStatus })` (helper imperativo). 6 callers reales: `useSchedulePostViaSaga()`, `useCreateDraftViaSaga()`, preview page, editor page, ClientContentEditor publish-now button.
- **Evidencia:**
  - Mismos endpoints consumidos: `apiClient.startPostPublishingSaga()` (POST) + `apiClient.getSagaStatus()` (GET poll).
  - Commit `6c4651c5` (2026-05-09) introdujo AMBAS formas a propósito — message: _"Frontend repoint of the customer post-publishing flow to the saga endpoint. The 6 callers of the legacy create/schedule/publish triplet now drive POST /sagas/post-publishing/start with a mode discriminator, and observe terminal state via either an imperative wait helper (for hooks that must preserve their resolve-with-Post contract) **or polling TanStack queries (for UI loading states)**."_
  - Imperativa adoptada (6 callers reales). Declarativa orfana (0 callers en `apps/admin` + `apps/client`).
- **Más completo/canónico:** **ambas son válidas para su use-case respectivo.** La imperativa preserva contrato `Promise<Post>` que esperan los callers existentes; la declarativa preserva el estado intermedio que un futuro `<SagaProgress>` necesita exponer (status enum, progress, errors visible mid-flight).
- **Veredicto propuesto:** **KEEP-both.** No borrar los hooks declarativos — son la primitiva correcta para UI real-time de saga, su consumer (componente `<SagaProgress>`) sólo está pendiente. Cierre del wire pendiente trackeado como SMELL-46 en `roadmap-detected-smells-backlog.md`.
- **Bloqueo del wire (no de la duplicación):** decisión de producto sobre dónde montar `<SagaProgress>` en la UI (SchedulingDashboard como progress card por cada saga en curso, modal en click, etc.).

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
