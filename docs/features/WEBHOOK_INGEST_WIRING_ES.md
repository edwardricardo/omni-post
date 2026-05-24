# WEBHOOK-INGEST — Cableado del pipeline de ingestión inbound

> **Estado:** workstream **capturado, NO ejecutado** (origen: B7 del maratón prisma→DI #21).
> **Premisa:** el pipeline de ingestión ya existe, está migrado a DI y testeado; lo que falta es
> **cablearlo** (ruta inbound + bootstrap + pasar el broadcaster) y blindarlo (appsec + E2E).
> No reimplementar lo que ya está; sólo conectar y verificar runtime real.

## Contexto

Durante B7 se auditó funcionalmente el subsistema `apps/api/src/webhooks/`. Hallazgo: **11 de 13 archivos
forman un pipeline de ingestión inbound completo pero huérfano** (forgotten-feature, NO dead — se confirmó
auditando la feature completa + sus ~600 tests). B7 lo migró a DI (threading de `PrismaClient` por todo el
cascade, #21 17→4) y lo dejó **DI-ready**, pero **no lo cableó** (decisión de Edward: "DI ahora + cablear
como workstream aparte").

### Lo que YA existe y funciona (testeado)

```
WebhookManager(prisma, redis)
  └ createWebhookJobProcessor(prisma, redis)
      └ WebhookJobProcessor(prisma, redis)            BullMQ: WEBHOOK_PROCESSING + WEBHOOK_DEAD_LETTER (+ MENTION_INGEST producer)
          └ UniversalWebhookHandler(prisma, broadcaster?, mentionEnqueue?)
              ├ checkDuplicateEvent → getWebhookSubscription → verifyWithGraceWindow (HMAC + rotación)
              ├ processor.parse → storeWebhookEvent → processor.process → markEventProcessed
              ├ handleEventFailure (retry/backoff) → moveToDeadLetterQueue
              └ 8 processors (facebook, instagram, x, youtube, tiktok, linkedin, snapchat, telegram)
                   process(): resuelve channel/publishLog/post, actualiza analytics,
                              broadcaster.broadcastEngagement/PostStatus (SSE) + mentionEnqueue (worker)
```

- `WebhookManager` también expone CRUD de suscripciones (secretKey HMAC + verifyToken + setup-instructions por
  provider), stats, retry, cleanup.
- `RealtimeWebhookBroadcaster` (SSE, **vivo**, registrado en el container) y `WebhookDashboardService`
  (dashboard admin, **vivo**) son los 2 de 13 que sí están cableados — consumen el modelo de eventos que el
  pipeline persiste.

### Lo que FALTA (el cableado)

1. **Ruta inbound HTTP** — no existe ningún endpoint que reciba eventos de los providers. Hoy ningún webcap
   externo llega al `WebhookManager.processIncomingWebhook(...)`.
2. **Bootstrap / composition root** — `WebhookManager` no se construye en ningún sitio (sin token ni registro
   en el container; sin arranque en `apps/workers`).
3. **Gap del broadcaster** — `webhookJobProcessor.ts` construye el handler con
   `new UniversalWebhookHandler(this.prisma, undefined, mentionEnqueue)` → **broadcaster = `undefined`**. Aun
   cableando la ruta, el path de SSE en vivo queda apagado hasta pasar el `RealtimeWebhookBroadcaster` resuelto
   del container.

## Diseño objetivo (a implementar en este workstream)

### 1. Ruta inbound `/webhooks/:provider`

- **`GET /webhooks/:provider`** — handshake de verificación. Meta (Facebook/Instagram) envía
  `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`; el handler valida `hub.verify_token` contra el
  `verifyToken` de la suscripción y responde el `hub.challenge` en texto plano. Otros providers que usen
  challenge propio se ramifican aquí por `:provider`.
- **`POST /webhooks/:provider`** — recepción del evento. Lee el **raw body** (necesario para HMAC — no el JSON
  ya parseado/reserializado), extrae la firma del header per-provider, y delega en
  `webhookManager.processIncomingWebhook(provider, eventType, eventId, signature, payload, headers, accountId?, projectId?)`,
  que encola en BullMQ. Responder `200`/`202` rápido (los providers reintentan ante no-2xx) y procesar async.
- **Sin auth de cliente** (es tráfico server-to-server de la plataforma) — la autenticidad se prueba por
  **firma HMAC**, no por sesión. Registrar la ruta fuera del `requireClientAuth`/`requireAdminAuth`.
- Captura del raw body: configurar un content-type parser de Fastify que preserve el buffer crudo para esta
  ruta (o `addContentTypeParser` scoped), porque la verificación de firma debe correr sobre los bytes exactos.

### 2. Bootstrap (composition root)

- Añadir `TOKENS.WebhookManager` y registrarlo en un composition root:
  `new WebhookManager(container.resolve(TOKENS.PrismaClient), redis)`. El cascade interno
  (`createWebhookJobProcessor` → `WebhookJobProcessor` → `UniversalWebhookHandler` → 8 processors) se
  autoconstruye con el `prisma`/`redis` inyectados.
- Decidir operativamente dónde vive el consumer BullMQ: **in-process en `apps/api`** (como repurpose/triage/
  trend/bulk-schedule) **o** como ejecutable dedicado en `apps/workers` con su propio composition root. Ambas
  son canon (CLAUDE.md §"Composition root per executable") siempre que el core de aplicación sea compartido,
  no duplicado.

### 3. Cerrar el gap del broadcaster

- Pasar el `RealtimeWebhookBroadcaster` resuelto del container al handler:
  `new UniversalWebhookHandler(prisma, broadcaster, mentionEnqueue)` dentro de `createWebhookJobProcessor` /
  `WebhookJobProcessor` (threading del broadcaster como ya se hace con prisma). Con esto, `process()` de los
  processors emite SSE en vivo a los dashboards conectados.

### 4. Verificación de firma per-provider (canon)

- Cada provider firma distinto (header + algoritmo + encoding). Ya está modelado en
  `AbstractWebhookProcessor` (`signaturePrefix`, `signatureEncoding`, `getHmacAlgorithm`) y en
  `verifyWithGraceWindow` (rotación de secreto con ventana de gracia). El workstream debe **confirmar contra
  el canon de cada provider** (doc oficial de cada API) el header exacto y el algoritmo, y cubrir cada uno con
  test de firma válida/ inválida/ rotada.

### 5. Appsec (obligatorio antes de exponer)

- **Replay**: deduplicación por `eventId` ya existe (`checkDuplicateEvent`); validar además ventana temporal /
  `timestamp` donde el provider lo provea.
- **Timing-safe compare** de la firma (ya usa `constantTimeCompare` en la base — verificar que ningún path lo
  evada).
- **DoS**: límite de tamaño de payload, rate-limit por IP/suscripción de la ruta inbound, y back-pressure de
  BullMQ (ya hay `attempts`/`backoff`/DLQ).
- **Tenancy**: el evento resuelve `channel`/`post` por `providerAccountId`; confirmar que no haya cross-tenant
  al mapear a `accountId`/`projectId`.
- Revisar con `appsec-security-auditor` (la superficie inbound es alto-riesgo).

### 6. Tests + E2E

- Unit: ya cubierto (parse/verify/process/manager/handler/dlq).
- Integración: ruta inbound (challenge GET + POST con firma válida/inválida/rotada) vía `app.inject` con prisma
  fake inyectado.
- E2E real: `curl` al endpoint inbound desplegado con un payload firmado de cada provider y verificar que el
  evento se persiste, el worker procesa, el SSE emite y (si aplica) el mention-worker recibe el job. Smoke-test
  contra el entorno dev real (no sólo mocks).

## Notas

- El pipeline NO se borra ni se reescribe: está completo y testeado. Este workstream es **conectar + blindar**.
- Referencia de la migración DI que dejó todo listo: B7 (rama `workstream/prisma-di-migration`).
- Backlog: SMELL-38 en `docs/reports/roadmap-detected-smells-backlog.md`.
