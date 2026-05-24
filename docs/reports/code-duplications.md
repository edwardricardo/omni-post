# Code Duplications Registry

> Código que **duplica funcionalidad ya escrita**. Se registra aquí (no se repara ni borra en
> caliente) para revisarlo y decidir en conjunto. Convención por entrada: **duplicado ↔ canónico** ·
> **cuál es más completo/canónico** · **veredicto propuesto** (REMOVE+wire / MERGE / KEEP-both).

## DUP-01 — analyticsIngest worker reimplementa un use-case escrito para él

- **Duplicado:** `apps/workers/src/analyticsIngestWorker.ts` → `processJob()`
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

## DUP-02 — inboxSync worker reimplementa (degradado) los use-cases de inbox

- **Duplicado:** `apps/workers/src/inboxSyncWorker.ts` → `processJob()`
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

- Detectado durante **B8** (maratón prisma→DI). B8 sólo inyectó `PrismaClient` en estos workers (DI); **no
  tocó** la lógica duplicada.
- La remoción de ambos duplicados = la épica de **compartir el application core a `packages/`** (Opción B),
  trackeada en `roadmap-detected-smells-backlog.md` (SMELL-26 + SMELL-39). Revisar y decidir tras cerrar
  el DI.
