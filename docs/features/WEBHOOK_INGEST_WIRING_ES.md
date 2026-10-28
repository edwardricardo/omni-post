# WEBHOOK-INGEST — Wiring the inbound ingestion pipeline

> **Status:** workstream **captured, NOT executed** (origin: B7 of the prisma→DI #21 marathon).
> **Premise:** the ingestion pipeline already exists, is migrated to DI and tested; what is missing is
> **wiring it** (inbound route + bootstrap + passing the broadcaster) and hardening it (appsec + E2E).
> Do not reimplement what is already there; only connect it and verify the real runtime.

## Context

During B7 the `apps/api/src/webhooks/` subsystem was audited functionally. Finding: **11 of 13 files
form a complete but orphaned inbound ingestion pipeline** (forgotten-feature, NOT dead — confirmed
by auditing the whole feature + its ~600 tests). B7 migrated it to DI (threading `PrismaClient` through the whole
cascade, #21 17→4) and left it **DI-ready**, but **did not wire it** (the Product Owner's decision: "DI now + wire
as a separate workstream").

### What ALREADY exists and works (tested)

```
WebhookManager(prisma, redis)
  └ createWebhookJobProcessor(prisma, redis)
      └ WebhookJobProcessor(prisma, redis)            BullMQ: WEBHOOK_PROCESSING + WEBHOOK_DEAD_LETTER (+ MENTION_INGEST producer)
          └ UniversalWebhookHandler(prisma, broadcaster?, mentionEnqueue?)
              ├ checkDuplicateEvent → getWebhookSubscription → verifyWithGraceWindow (HMAC + rotation)
              ├ processor.parse → storeWebhookEvent → processor.process → markEventProcessed
              ├ handleEventFailure (retry/backoff) → moveToDeadLetterQueue
              └ 8 processors (facebook, instagram, x, youtube, tiktok, linkedin, snapchat, telegram)
                   process(): resolves channel/publishLog/post, updates analytics,
                              broadcaster.broadcastEngagement/PostStatus (SSE) + mentionEnqueue (worker)
```

- `WebhookManager` also exposes subscription CRUD (HMAC secretKey + verifyToken + setup-instructions per
  provider), stats, retry, cleanup.
- `RealtimeWebhookBroadcaster` (SSE, **live**, registered in the container) and `WebhookDashboardService`
  (admin dashboard, **live**) are the 2 of 13 that are wired — they consume the event model that the
  pipeline persists.

### What is MISSING (the wiring)

1. **Inbound HTTP route** — no endpoint exists that receives events from the providers. Today no external
   webhook reaches `WebhookManager.processIncomingWebhook(...)`.
2. **Bootstrap / composition root** — `WebhookManager` is not constructed anywhere (no token, no registration
   in the container; no startup in `apps/workers`).
3. **Broadcaster gap** — `webhookJobProcessor.ts` builds the handler with
   `new UniversalWebhookHandler(this.prisma, undefined, mentionEnqueue)` → **broadcaster = `undefined`**. Even
   with the route wired, the live SSE path stays dark until the `RealtimeWebhookBroadcaster` resolved
   from the container is passed in.

## Target design (to implement in this workstream)

### 1. Inbound route `/webhooks/:provider`

- **`GET /webhooks/:provider`** — verification handshake. Meta (Facebook/Instagram) sends
  `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`; the handler validates `hub.verify_token` against the
  subscription's `verifyToken` and answers with the `hub.challenge` in plain text. Other providers that use
  their own challenge branch here by `:provider`.
- **`POST /webhooks/:provider`** — event reception. Reads the **raw body** (required for HMAC — not the JSON
  already parsed/reserialized), extracts the signature from the per-provider header, and delegates to
  `webhookManager.processIncomingWebhook(provider, eventType, eventId, signature, payload, headers, accountId?, projectId?)`,
  which enqueues in BullMQ. Answer `200`/`202` fast (providers retry on a non-2xx) and process async.
- **No client auth** (it is server-to-server traffic from the platform) — authenticity is proven by the
  **HMAC signature**, not by a session. Register the route outside `requireClientAuth`/`requireAdminAuth`.
- Raw body capture: configure a Fastify content-type parser that keeps the raw buffer for this
  route (or a scoped `addContentTypeParser`), because signature verification must run over the exact bytes.

### 2. Bootstrap (composition root)

- Add `TOKENS.WebhookManager` and register it in a composition root:
  `new WebhookManager(container.resolve(TOKENS.PrismaClient), redis)`. The internal cascade
  (`createWebhookJobProcessor` → `WebhookJobProcessor` → `UniversalWebhookHandler` → 8 processors) builds
  itself from the injected `prisma`/`redis`.
- Decide operationally where the BullMQ consumer lives: **in-process in `apps/api`** (like repurpose/triage/
  trend/bulk-schedule) **or** as a dedicated executable in `apps/workers` with its own composition root. Both
  are canon (CLAUDE.md §"Composition root per executable") as long as the application core is shared,
  not duplicated.

### 3. Close the broadcaster gap

- Pass the `RealtimeWebhookBroadcaster` resolved from the container to the handler:
  `new UniversalWebhookHandler(prisma, broadcaster, mentionEnqueue)` inside `createWebhookJobProcessor` /
  `WebhookJobProcessor` (threading the broadcaster the way prisma already is). With this, `process()` in the
  processors emits live SSE to the connected dashboards.

### 4. Per-provider signature verification (canon)

- Each provider signs differently (header + algorithm + encoding). It is already modeled in
  `AbstractWebhookProcessor` (`signaturePrefix`, `signatureEncoding`, `getHmacAlgorithm`) and in
  `verifyWithGraceWindow` (secret rotation with a grace window). The workstream must **confirm against
  each provider's canon** (each API's official docs) the exact header and the algorithm, and cover each one with
  a valid/ invalid/ rotated signature test.

### 5. Appsec (mandatory before exposing it)

- **Replay**: deduplication by `eventId` already exists (`checkDuplicateEvent`); also validate a time window /
  `timestamp` where the provider supplies one.
- **Timing-safe compare** of the signature (the base already uses `constantTimeCompare` — verify that no path
  bypasses it).
- **DoS**: a payload size limit, a per-IP/per-subscription rate limit on the inbound route, and BullMQ
  back-pressure (`attempts`/`backoff`/DLQ already exist).
- **Tenancy**: the event resolves `channel`/`post` by `providerAccountId`; confirm there is no cross-tenant
  access when mapping to `accountId`/`projectId`.
- Review with `appsec-security-auditor` (the inbound surface is high-risk).

### 6. Tests + E2E

- Unit: already covered (parse/verify/process/manager/handler/dlq).
- Integration: inbound route (challenge GET + POST with a valid/invalid/rotated signature) via `app.inject` with an injected
  fake prisma.
- Real E2E: `curl` to the deployed inbound endpoint with a signed payload from each provider, and verify that the
  event is persisted, the worker processes it, the SSE emits and (where it applies) the mention-worker receives the job. Smoke-test
  against the real dev environment (not only mocks).

## Notes

- The pipeline is NOT deleted or rewritten: it is complete and tested. This workstream is **connect + harden**.
- Reference for the DI migration that left everything ready: B7 (branch `workstream/prisma-di-migration`).
- Backlog: SMELL-38 in `docs/reports/roadmap-detected-smells-backlog.md`.
