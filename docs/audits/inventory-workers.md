---
title: Workers app inventory — full-repo audit input
description: File-by-file inventory of apps/workers/src/ — BullMQ processors + bootstrap + metrics + auth-failure helpers + telemetry.
generated: 2026-05-10
auditor: claude-code
---

# Workers app inventory

> Surface: `apps/workers/src/`. 13 files inventoried.
> Veredictos preliminares: VÁLIDO=7, DEAD=3, FORGOTTEN-FEATURE=1, MISMATCH=2, REDUNDANTE=0, UNKNOWN=0.

There is **no `index.ts` bootstrap** in this app. Each worker file is its own entry point (`tsx src/<name>.ts`). The production `Dockerfile` runs **only** `dist/publishWorker.js` (`CMD ["dist/publishWorker.js"]`). The other worker entries (`autoRenewalWorker`, `inboxSyncWorker`, `analyticsIngestWorker`) are wired in code but **not started by the canonical dev command or the production image** — they need separate `pnpm` scripts and a deployment story.

## Summary by Tipo

| Tipo                |  Count | VÁLIDO | REDUNDANTE |  DEAD | FORGOTTEN-FEATURE | MISMATCH | UNKNOWN |
| ------------------- | -----: | -----: | ---------: | ----: | ----------------: | -------: | ------: |
| bootstrap/processor |      5 |      1 |          0 |     2 |                 0 |        2 |       0 |
| processor (dead)    |      1 |      0 |          0 |     1 |                 0 |        0 |       0 |
| handler (logic)     |      1 |      1 |          0 |     0 |                 0 |        0 |       0 |
| types               |      1 |      1 |          0 |     0 |                 0 |        0 |       0 |
| metrics             |      1 |      1 |          0 |     0 |                 0 |        0 |       0 |
| lib helper          |      2 |      2 |          0 |     0 |                 0 |        0 |       0 |
| service             |      2 |      2 |          0 |     0 |                 0 |        0 |       0 |
| telemetry           |      1 |      0 |          0 |     0 |                 1 |        0 |       0 |
| **Total**           | **13** |  **7** |      **0** | **3** |             **1** |    **2** |   **0** |

## Processor inventory (extracted)

| Queue                          | Job name                | Worker file                               | Producer in apps/api?                                                                                                                                                | Provider used                                                                               |
| ------------------------------ | ----------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `publish`                      | (BullMQ default)        | `publishWorker.ts`                        | YES — `index.ts`, `setupServices.ts`, `setupRepurposeUseCases.ts`, `healthRoutes.ts`, `admin/queueRoutes.ts`                                                         | All 11 providers (X, IG, FB, YT, TT, Snap, Telegram, Pinterest, LinkedIn, Bluesky, Threads) |
| `inbox-sync`                   | (BullMQ default)        | `inboxSyncWorker.ts`                      | YES — `setupServices.ts`, `setupInboxUseCases.ts`                                                                                                                    | 10 providers (Threads MISSING)                                                              |
| `analytics-aggregation`        | (BullMQ default)        | `analyticsIngestWorker.ts`                | YES — `setupServices.ts`, `setupAnalyticsUseCases.ts`                                                                                                                | 10 providers (Threads MISSING)                                                              |
| `auto-renewal`                 | `process-auto-renewals` | `autoRenewalWorker.ts`                    | NO BullMQ producer in api (self-schedules via repeatable cron). `apps/api/src/billing` has a separate REST-driven `TrialManagementService.processAutoRenewals` path. | n/a (DB-only)                                                                               |
| `publish` (duplicate consumer) | n/a                     | `providers/instagram/publishingWorker.ts` | YES (same as above)                                                                                                                                                  | Instagram only                                                                              |

## Metrics exposed

Exposed by `publishWorker.ts` on port `3300` at `/metrics`. Collector defined in `metrics/workerMetrics.ts`. Default Node.js metrics from `prom-client.collectDefaultMetrics` also registered.

| Metric name                                | Type      | Labels                                         |
| ------------------------------------------ | --------- | ---------------------------------------------- |
| `worker_publish_success_total`             | counter   | provider, content_type, channel_id             |
| `worker_publish_errors_total`              | counter   | provider, content_type, error_type, channel_id |
| `worker_publish_duration_seconds`          | histogram | provider, content_type                         |
| `worker_threads_created_total`             | counter   | strategy, provider                             |
| `worker_threads_published_total`           | counter   | strategy, provider, tweet_count                |
| `worker_thread_errors_total`               | counter   | phase, error_type, provider                    |
| `worker_threads_in_progress`               | gauge     | provider                                       |
| `worker_thread_tweet_count`                | histogram | —                                              |
| `worker_thread_duration_seconds`           | histogram | strategy, tweet_count_range                    |
| `worker_jobs_active`                       | gauge     | —                                              |
| `worker_jobs_completed_total`              | counter   | content_type                                   |
| `worker_jobs_failed_total`                 | counter   | error_category                                 |
| `worker_jobs_skipped_total`                | counter   | —                                              |
| `worker_job_processing_duration_seconds`   | histogram | content_type                                   |
| `worker_queue_depth`                       | gauge     | —                                              |
| `worker_health_status`                     | gauge     | —                                              |
| `worker_correlation_requests_active`       | gauge     | —                                              |
| `worker_render_duration_seconds`           | histogram | provider, content_type                         |
| `worker_db_operation_duration_seconds`     | histogram | operation, result                              |
| `worker_provider_request_duration_seconds` | histogram | provider, operation, status                    |
| `worker_errors_by_type_total`              | counter   | component, error_type, recoverable             |
| `worker_retry_attempts_total`              | counter   | component, retry_reason                        |
| `worker_circuit_breaker_trips_total`       | counter   | component, breaker_name                        |
| `omnipost_posts_published_total`           | counter   | —                                              |
| `omnipost_posts_publish_failed_total`      | counter   | —                                              |
| `omnipost_provider_publish_success_total`  | counter   | provider                                       |
| `omnipost_provider_publish_failure_total`  | counter   | provider                                       |

The other three workers (`inboxSyncWorker`, `analyticsIngestWorker`, `autoRenewalWorker`) **do not expose a metrics HTTP server** — they consume from BullMQ but Prometheus has no scrape target for them. Visibility gap.

## Background tasks registered (BackgroundTaskScheduler)

| taskId            | Interval | Registered by                                                                                                                                                                                                                                 | Critical? |
| ----------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| (none registered) | —        | `publishWorker.ts` constructs a `DefaultBackgroundTaskScheduler` and passes it to `createPrismaRepoAdapter`, but the scheduler is **not used to register any worker-side task** — it's an injected dep for the repo adapter's internal tasks. | n/a       |

The other three workers do **not** construct a `DefaultBackgroundTaskScheduler` at all — any background timer in their dependency chain would have to come pre-instantiated from the package. No raw `setInterval` was found in workers source (`metrics/`, `lib/`, processors) — fitness check #11 passes.

## By directory

### apps/workers/src/

#### audit-W-001 — Publish worker bootstrap (canonical entry)

- **Path:** [apps/workers/src/publishWorker.ts](apps/workers/src/publishWorker.ts)
- **Surface:** workers
- **Tipo:** bootstrap · processor
- **@layer declared:** `infrastructure`
- **Propósito real:** Single-process entrypoint that wires all 11 provider adapters into a `providerRegistry`, constructs `PublishHandler`, subscribes to the `publish` queue via `createBullMQConsumerAdapter`, exposes Prometheus metrics + `/health` on port 3300, and registers SIGTERM/SIGINT graceful shutdown.
- **Exports / queues / job names:** subscribes to `QUEUE_NAMES.PUBLISH` (`"publish"`); listens HTTP on port 3300 (`/metrics`, `/health`).
- **Imports significativos:** `@providers/{x,instagram,facebook,youtube,tiktok,snapchat,telegram,pinterest,linkedin,bluesky,threads}`, `@adapters/queue-bullmq`, `@adapters/db-prisma`, `@infra/prisma` (`verifyDatabaseAuth`), `@shared/types` (`decryptChannelCredentials`), `@observability/background-scheduler`, `ioredis`, `prom-client`, `pino`, `dotenv`.
- **Wiring detected:** Production `Dockerfile` CMD = `dist/publishWorker.js`. `pnpm dev:workers` → `tsx src/publishWorker.ts` (only entry in default dev script). PUBLISH queue is produced by `apps/api` (see table above) — supply + demand match.
- **Callers:** none in workers src (process entrypoint).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Uses raw `pino()` factory (not `@observability/logger`) — but workers are exempted from fitness check #13 ("Direct `pino()` factory in the worker entry file" per `CLAUDE.md` Logging table). `commandTimeout: 5_000` is set on **`notifyRedis`** (not on a BullMQ Worker connection — `notifyRedis` is the saga pub/sub publisher used by `notifySaga`). This is **allowed** by canon `feedback_bullmq_no_command_timeout` because the canon prohibits `commandTimeout` only on connections with `maxRetriesPerRequest: null` (BullMQ Worker pattern). `notifyRedis` uses `maxRetriesPerRequest: 1`. OK. `PLATFORM_ENCRYPTION_KEY` is read via direct `process.env` (no typed env factory), which fitness check #16 would block in `apps/api/src` but workers are out of scope for #16.

#### audit-W-002 — Auto-renewal worker (cron, not in dev/prod entry)

- **Path:** [apps/workers/src/autoRenewalWorker.ts](apps/workers/src/autoRenewalWorker.ts)
- **Surface:** workers
- **Tipo:** bootstrap · processor · scheduler
- **@layer declared:** `infrastructure`
- **Propósito real:** Standalone worker that registers a BullMQ repeatable cron (`0 2 * * *`) on `QUEUE_NAMES.AUTO_RENEWAL` and processes the resulting `process-auto-renewals` jobs by finding accounts with expired trials + autoRenewal=true and converting them to paid. Writes audit logs directly via Prisma.
- **Exports / queues / job names:** queue `auto-renewal`; job name `process-auto-renewals`; cron `0 2 * * *` UTC.
- **Imports significativos:** `@adapters/queue-bullmq` (`QUEUE_NAMES`), `@infra/prisma` (direct `prisma.account.findMany` etc — bypasses repo port), `bullmq` (Worker + Queue), `ioredis`, `pino`, `dotenv`.
- **Wiring detected:** Has `pnpm --filter @apps/workers dev:auto-renewal` script. NOT spawned by `pnpm dev:workers` (concurrent dev). NOT the CMD of the production Dockerfile. NO docker-compose service. **Effectively unreachable in dev `pnpm dev`** and **unreachable in the deployed worker image** as-is.
- **Callers:** none in workers src.
- **Veredicto preliminar:** MISMATCH
- **Notas:** Bypasses hexagonal — calls `prisma.account.findMany`, `prisma.account.update`, `prisma.auditLog.create`, `prisma.accountSubscription.findUnique` directly. Mirrors logic that **already exists** in `apps/api/src/billing/subscription/TrialManagementService.processAutoRenewals` (called from `SubscriptionTrialHandler`) — there is a parallel REST-driven path for the same operation, increasing the risk of dual-write conflicts. **Deployment gap**: needs its own CMD/service in the Dockerfile or k8s manifest before this cron actually runs in prod. Uses `commandTimeout`? No — connection uses `maxRetriesPerRequest: null` and intentionally omits `commandTimeout` per the documented BullMQ canon. OK. `decryptChannelCredentials` not needed (DB-only logic).

#### audit-W-003 — Inbox sync worker (no entry script, deployment dead)

- **Path:** [apps/workers/src/inboxSyncWorker.ts](apps/workers/src/inboxSyncWorker.ts)
- **Surface:** workers
- **Tipo:** bootstrap · processor
- **@layer declared:** `infrastructure`
- **Propósito real:** Processes `inbox-sync` jobs: fetches comments via `provider.getComments` for a given channel, dedupes by `providerMessageId`, inserts into `SocialMessage`. On AUTH error, records via `ChannelAuthFailureRecorder` and rethrows.
- **Exports / queues / job names:** consumes `QUEUE_NAMES.INBOX_SYNC` (`"inbox-sync"`).
- **Imports significativos:** 10 provider adapters (Threads excluded), `@infra/prisma` (direct Prisma access for channel + SocialMessage), `bullmq`, `ioredis`, `pino`.
- **Wiring detected:** Producer EXISTS in `apps/api/src/infrastructure/container/setupInboxUseCases.ts`. But **NO npm script** launches this worker (`apps/workers/package.json` only has `dev` and `dev:auto-renewal`). **Production Dockerfile** runs only `publishWorker.js`. So jobs enqueued to `inbox-sync` will pile up indefinitely without a consumer running in any environment.
- **Callers:** none in workers src.
- **Veredicto preliminar:** MISMATCH
- **Notas:** Threads provider is missing from `providerAdapters` registry — inbox sync for Threads channels will fall through to "Provider does not support comments" silently. Uses direct `prisma.channel.findFirst` (passes the channel `credentials` blob untouched to `adapter.getComments` rather than going via `CredentialResolver`) — inconsistent with `publishWorker.ts` which uses `CredentialResolver`. `decryptChannelCredentials` is NOT invoked here, so channels with encrypted credentials may break depending on the adapter contract. **Deployment + supply/demand mismatch.**

#### audit-W-004 — Analytics ingest worker (no entry script, deployment dead)

- **Path:** [apps/workers/src/analyticsIngestWorker.ts](apps/workers/src/analyticsIngestWorker.ts)
- **Surface:** workers
- **Tipo:** bootstrap · processor
- **@layer declared:** `infrastructure`
- **Propósito real:** Processes `analytics-aggregation` jobs: fetches per-channel analytics via `provider.fetchAnalytics`, upserts each metric row into `AnalyticsDailySummary`. Recovers from AUTH via `ChannelAuthFailureRecorder`.
- **Exports / queues / job names:** consumes `QUEUE_NAMES.ANALYTICS_AGGREGATION` (`"analytics-aggregation"`).
- **Imports significativos:** 10 provider adapters (Threads excluded), `@infra/prisma` (direct `prisma.channel.findFirst`, `prisma.analyticsDailySummary.upsert`, `prisma.$transaction`), `@adapters/db-prisma` (`createPrismaRepoAdapter`), `@shared/types` (`decryptChannelCredentials`), `bullmq`, `ioredis`, `pino`.
- **Wiring detected:** Producer EXISTS in `apps/api/src/infrastructure/container/setupAnalyticsUseCases.ts`. But **NO npm script** launches this worker, and the production Dockerfile runs only `publishWorker.js`. Same gap as inbox sync.
- **Callers:** none in workers src.
- **Veredicto preliminar:** MISMATCH
- **Notas:** Threads excluded from `providerAdapters`. Uses `CredentialResolver` correctly (unlike inboxSyncWorker). The Prisma `upsert` block has a fragile fallback: `m.postId ?? ""` falls back to empty-string for the composite key — this can collide across providers if `postId` is missing. **Deployment gap + provider gap + key-collision risk.**

#### audit-W-005 — Instagram-specific publishing worker (dead duplicate)

- **Path:** [apps/workers/src/providers/instagram/publishingWorker.ts](apps/workers/src/providers/instagram/publishingWorker.ts)
- **Surface:** workers
- **Tipo:** processor
- **@layer declared:** `infrastructure`
- **Propósito real:** Older single-provider Instagram publisher: subscribes to `QUEUE_NAMES.PUBLISH`, downcasts the payload to `InstagramPublishPayload` (carries credentials + media + retry counters), handles FEED/STORIES/REELS/CAROUSEL via `InstagramApiClient` + `InstagramMediaProcessor`, runs through a circuit breaker, schedules its own exponential retries by re-enqueueing.
- **Exports / queues / job names:** class `InstagramPublishingWorker`, factory `createInstagramPublishingWorker()`. Subscribes to `QUEUE_NAMES.PUBLISH` (same queue as `publishWorker.ts`).
- **Imports significativos:** `@providers/instagram` (`InstagramApiClient`, `InstagramMediaProcessor`), `@adapters/queue-bullmq`, `@adapters/external-apis` (circuit breaker), `@adapters/db-prisma`, `@shared/types`, `prom-client`, `@observability/logger`.
- **Wiring detected:** **Not instantiated anywhere outside its own tests** — `grep -rln "InstagramPublishingWorker|createInstagramPublishingWorker" apps/ packages/` returns only this file + its tests + the graphify artifacts. There is **no bootstrap** spawning this worker. Furthermore, even if it were spawned, it would compete with `publishWorker.ts` for the same `publish` queue — both subscribe to `QUEUE_NAMES.PUBLISH`.
- **Callers:** test files only (`apps/workers/tests/providers/instagram/publishingWorker.test.ts`, `publishingWorker.test-helpers.ts`, `publishingWorker.integration.test.ts`).
- **Veredicto preliminar:** DEAD
- **Notas:** Forgotten code from an earlier per-provider worker architecture before `PublishHandler` consolidated all providers. The payload shape (`InstagramPublishPayload` with `credentials`, `queueId`, `retryCount`, `maxRetries`) **does not match** what `apps/api` produces (`{ postId, channelId, provider?, sagaId? }`) — running it side-by-side with `publishWorker.ts` would crash on the cast. Also reads `AWS_REGION` + `AWS_S3_BUCKET` directly from `process.env` and throws if missing. Strong delete candidate. If kept, requires explicit decision to retire `publishWorker.ts`'s Instagram path and reshape its payload to match.

### apps/workers/src/lib/

#### audit-W-006 — Graceful shutdown helper

- **Path:** [apps/workers/src/lib/gracefulShutdown.ts](apps/workers/src/lib/gracefulShutdown.ts)
- **Surface:** workers
- **Tipo:** lib helper
- **@layer declared:** `infrastructure`
- **Propósito real:** Shared SIGTERM/SIGINT handler that drains BullMQ workers, closes queues, quits aux connections, disconnects Prisma, runs `afterTeardown` hook, then `process.exit(0)`. Idempotent (second signal during shutdown is a no-op).
- **Exports / queues / job names:** `registerGracefulShutdown(options)`, `ShutdownTarget`, `RegisterGracefulShutdownOptions` types.
- **Imports significativos:** `bullmq` (`Worker`, `Queue` types only).
- **Wiring detected:** Called by `publishWorker.ts`, `autoRenewalWorker.ts`, `inboxSyncWorker.ts`, `analyticsIngestWorker.ts` (4 callers). Each passes its own `target` and `name`.
- **Callers:** `publishWorker.ts`, `autoRenewalWorker.ts`, `inboxSyncWorker.ts`, `analyticsIngestWorker.ts`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

#### audit-W-007 — Provider AUTH error helper

- **Path:** [apps/workers/src/lib/handleProviderAuthError.ts](apps/workers/src/lib/handleProviderAuthError.ts)
- **Surface:** workers
- **Tipo:** lib helper
- **@layer declared:** `infrastructure`
- **Propósito real:** Thin wrapper around `ChannelAuthFailureRecorder.record` that records the AUTH failure and throws an `Error` so BullMQ marks the job failed. Returns `never`.
- **Exports / queues / job names:** `handleProviderAuthError(recorder, channelId, provider, context)`.
- **Imports significativos:** `../services/ChannelAuthFailureRecorder.js` (type-only).
- **Wiring detected:** Called by `inboxSyncWorker.processJob` and `analyticsIngestWorker.processJob`. NOT called by `publishWorker` (which has its own inline AUTH path via `credentialResolver` → `Error("AUTH")`).
- **Callers:** `inboxSyncWorker.ts`, `analyticsIngestWorker.ts`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** —

### apps/workers/src/metrics/

#### audit-W-008 — Worker Prometheus metrics collector

- **Path:** [apps/workers/src/metrics/workerMetrics.ts](apps/workers/src/metrics/workerMetrics.ts)
- **Surface:** workers
- **Tipo:** metrics
- **@layer declared:** `infrastructure`
- **Propósito real:** Defines 27 `prom-client` metrics (counters/histograms/gauges) covering publishing, threading, jobs, errors, retries, circuit breakers, plus four `omnipost_*` business SLO metrics that share counter names with `apps/api/src/metrics/businessMetrics.ts` so PromQL queries can aggregate across both processes. Provides helpers (`recordJobStart`, `recordThreadStart`, `recordPostPublished`, etc.) and a `correlationIds` Map for correlation tracking.
- **Exports / queues / job names:** `WorkerMetrics` class, `WorkerMetricsCollector` interface, ~27 metric names (full list in "Metrics exposed" table above).
- **Imports significativos:** `prom-client`, `uuid` (v4).
- **Wiring detected:** Instantiated **only by `publishWorker.ts`** and exposed on `/metrics`. The other three workers do **not** instantiate `WorkerMetrics` → many of these metrics will have zero data for inbox/analytics/auto-renewal regardless of activity.
- **Callers:** `publishWorker.ts` (and tests).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** `correlationIds = new Map<string, string>()` is a per-instance Map for correlation tracking; this is not the cross-pod cache pattern that fitness check #14 blocks (it's a per-request tracking buffer, naturally per-process). OK. Two metric naming conventions coexist: `worker_*` (worker-private) and `omnipost_*` (shared SLO with apps/api). Documented in JSDoc as intentional alignment with `apps/api/src/metrics/businessMetrics.ts` — verify those four counter names match exactly in apps/api during cross-surface audit.

### apps/workers/src/services/

#### audit-W-009 — Channel auth failure recorder

- **Path:** [apps/workers/src/services/ChannelAuthFailureRecorder.ts](apps/workers/src/services/ChannelAuthFailureRecorder.ts)
- **Surface:** workers
- **Tipo:** service
- **@layer declared:** `infrastructure`
- **Propósito real:** Within a single `prisma.$transaction`, flips `Channel.needsReauth = true` (records `authFailedAt`, `authFailureReason`) and writes a `ChannelAuthFailed` outbox event. Couples the state mutation and the integration event in one DB tx so they can never diverge (canon Outbox pattern).
- **Exports / queues / job names:** `ChannelAuthFailureRecorder`, `ChannelAuthFailureRecorderOptions`.
- **Imports significativos:** `node:crypto` (`randomUUID`), `@infra/prisma` (`PrismaClient`, `Prisma`).
- **Wiring detected:** Constructed inline by `inboxSyncWorker` and `analyticsIngestWorker`. Each passes its own `prisma` client.
- **Callers:** `inboxSyncWorker.ts`, `analyticsIngestWorker.ts` (via `handleProviderAuthError`).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Writes `OutboxEvent` row shape directly. Audit comment in JSDoc explicitly identifies this as the contract with `apps/api`'s `OutboxRelay` / `PrismaOutboxWriter` — cross-surface audit should verify event consumer wiring exists for `ChannelAuthFailed`.

#### audit-W-010 — Credential resolver

- **Path:** [apps/workers/src/services/CredentialResolver.ts](apps/workers/src/services/CredentialResolver.ts)
- **Surface:** workers
- **Tipo:** service
- **@layer declared:** `application`
- **Propósito real:** Application-layer service that resolves channel credentials via a `ChannelCredentialsRepository` port. Wraps all failure modes (repo error, channel missing, credentials null/undefined, thrown error) into `err("AUTH")` so callers map uniformly to HTTP 401 / publish AUTH error.
- **Exports / queues / job names:** `CredentialResolver`, `ChannelCredentialsRepository` interface.
- **Imports significativos:** `@shared/types` (`ok`, `err`, `Result`).
- **Wiring detected:** Constructed in `publishWorker.ts` and `analyticsIngestWorker.ts`. NOT used in `inboxSyncWorker.ts` (which reads `channel.credentials` directly from Prisma — inconsistent path; see audit-W-003).
- **Callers:** `publishWorker.ts`, `analyticsIngestWorker.ts`.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Only file in workers with `@layer application`. Lives under `apps/workers/src/services/` rather than `application/` — fine per the project's layer-by-context table (workers map paths informally). Duplicated almost-verbatim across surfaces: there's an analogous `CredentialResolver` in `apps/api/src/...` likely — flag for cross-surface dedup audit (could become a shared service in `packages/`).

### apps/workers/src/telemetry/

#### audit-W-011 — OpenTelemetry initialization with no-op fallback

- **Path:** [apps/workers/src/telemetry/initialization.ts](apps/workers/src/telemetry/initialization.ts)
- **Surface:** workers
- **Tipo:** telemetry
- **@layer declared:** `infrastructure`
- **Propósito real:** Loads `@observability/opentelemetry` only when `TRACING_ENABLED === "true"` and falls back to no-op `publishingInstrumentation` / `databaseInstrumentation` / `businessKPITracker` mocks otherwise. Wired as the first import of `publishWorker.ts`.
- **Exports / queues / job names:** `publishingInstrumentation`, `databaseInstrumentation`, `businessKPITracker`, `ContentMetrics`, `UserMetrics`, `ProviderMetrics`, `BusinessMetrics`.
- **Imports significativos:** `pino`, dynamic `import("@observability/opentelemetry")` (conditional), `../publishHandlerTypes.js` (types).
- **Wiring detected:** Imported only by `publishWorker.ts`. The other three workers have **no OTel wiring at all** — they boot without instrumentation regardless of `TRACING_ENABLED`.
- **Callers:** `publishWorker.ts`.
- **Veredicto preliminar:** FORGOTTEN-FEATURE
- **Notas:** Has 3 explicit `any` aliases (`UserMetrics`, `ProviderMetrics`, `BusinessMetrics` all `= any`) — fitness check #3 is scoped to `apps/api/src/{domain,application,infrastructure}` so workers don't trigger it, but these are still dead type aliases re-exported from nowhere visible. Inbox + analytics + auto-renewal workers should consume this initializer (or one parallel to it) for trace coverage to match the publish path. As-is, only the publish path is OTel-instrumented.

### apps/workers/src/ (root files)

#### audit-W-012 — Publish handler (core orchestration class)

- **Path:** [apps/workers/src/publishHandler.ts](apps/workers/src/publishHandler.ts)
- **Surface:** workers
- **Tipo:** handler (logic)
- **@layer declared:** `infrastructure`
- **Propósito real:** Extracted, testable class that owns the publish job lifecycle. Resolves provider from registry (defaults to `"x"`), idempotency-checks via `getLogByDedupeKey`, fetches the canonical post, calls `provider.render()`, then routes to `publishSinglePost` or `publishThreadPost`. Each path: instruments OTel span, resolves credentials, calls provider, logs `PublishLog`, increments metrics, notifies saga via `notifyRedis.publish("saga:events", ...)`.
- **Exports / queues / job names:** `PublishHandler` class. Re-exports all types from `publishHandlerTypes`.
- **Imports significativos:** `@shared/types`, `@ports/core` (`PublishReceipt`), `./telemetry/initialization.js` (type), `./publishHandlerTypes.js`.
- **Wiring detected:** Instantiated by `publishWorker.ts` and exercised by tests.
- **Callers:** `publishWorker.ts`, tests.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** 680 lines — close to the 800-line house limit. `notifySaga` uses Redis pub/sub channel `"saga:events"` — cross-surface audit needs to confirm `apps/api/src/.../SagaManager*` subscribes to this channel and the event types (`publish.job.completed`, `publish.job.failed`) are handled. Idempotency uses `dedupeKey ?? \`${postId}:${channelId}\``— that fallback may collide with retries of different jobs for the same post+channel; relies on the producer always supplying`dedupeKey`. Verify producer side.

#### audit-W-013 — Publish handler types (interface module)

- **Path:** [apps/workers/src/publishHandlerTypes.ts](apps/workers/src/publishHandlerTypes.ts)
- **Surface:** workers
- **Tipo:** types
- **@layer declared:** `infrastructure`
- **Propósito real:** Type-only module holding `PublishRepo`, `PublishProvider`, `CredentialsLookup`, `PublishInstrumentation`, `DatabaseInstrumentation`, `BusinessKPITracker`, `SagaNotifier`, `PublishHandlerDeps`, `PublishJobInput`. Exists to keep `publishHandler.ts` under the line limit.
- **Exports / queues / job names:** all interfaces named above.
- **Imports significativos:** `pino` (type-only), `@shared/types`, `@ports/core`, `./metrics/workerMetrics.js`, `./telemetry/initialization.js`.
- **Wiring detected:** Re-exported from `publishHandler.ts` for backwards compatibility.
- **Callers:** `publishHandler.ts`, telemetry initializer.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** `PublishJobInput.payload` shape (`{postId, channelId, provider?, sagaId?}`) is the contract with `apps/api`'s producer. Cross-reference with producer-side `enqueue(...)` call sites in `apps/api/src/.../PublishHandlerSagaStep` (or equivalent) to confirm field-by-field compatibility.

## Cross-surface signals

### Processors without producers (DEAD queues, workers side)

None — every queue consumed in workers has at least one producer in `apps/api`. But the inverse problem dominates: see next section.

### Workers with producers but no deployment entry

| Worker file                               | Producer in apps/api                            | Has npm script?          | Dockerfile CMD?  | Status                            |
| ----------------------------------------- | ----------------------------------------------- | ------------------------ | ---------------- | --------------------------------- |
| `publishWorker.ts`                        | YES (multiple)                                  | YES (`dev`)              | YES (production) | OK                                |
| `autoRenewalWorker.ts`                    | self-scheduled cron (no enqueue from api)       | YES (`dev:auto-renewal`) | NO               | Runs only when manually started   |
| `inboxSyncWorker.ts`                      | YES (`setupInboxUseCases`, `setupServices`)     | **NO**                   | **NO**           | **Jobs enqueued, never consumed** |
| `analyticsIngestWorker.ts`                | YES (`setupAnalyticsUseCases`, `setupServices`) | **NO**                   | **NO**           | **Jobs enqueued, never consumed** |
| `providers/instagram/publishingWorker.ts` | n/a (would compete with publishWorker)          | NO                       | NO               | Pure dead code                    |

### Queues declared but no consumer in workers

These queue names are produced by `apps/api` but have no worker consumer at all (consumed in-process by `apps/api` itself):

- `webhook-processing`, `webhook-dead-letter` — consumed by `apps/api/src/webhooks/webhookJobProcessor.ts`.
- `gateway-switch` — consumed by `apps/api/src/billing/gatewaySwitchProcessor.ts`.
- `integration-events` — consumed by `apps/api/src/infrastructure/integration-events/IntegrationEventConsumer.ts`.
- `failed-operations-dlq`, `dead-letter-queue` — DLQs, registered as queues but no worker code reads them.
- `generate-repurpose` — wired through `apps/api/src/infrastructure/repositories/BullMQRepurposeJobDispatcher.ts`; consumer location TBD (likely in-process api).

### Queues declared but unused anywhere

- `recurring-posts` (`QUEUES.RECURRING_POSTS`) — declared in `constants.ts`. Only referenced by `apps/api/src/recurring/recurringPostRoutes.ts` + i18n + admin queue health panel. No producer **enqueues** to it; no consumer. **DEAD declaration.**
- `detect-repurpose` (`QUEUES.DETECT_REPURPOSE`) — declared. Zero code references outside `constants.ts`. **DEAD.**
- `triage-inbox` (`QUEUES.TRIAGE_INBOX`) — declared. Zero references. **DEAD.**
- `trend-radar` (`QUEUES.TREND_RADAR`) — declared. Zero references. **DEAD.**
- `report-generation` (`QUEUES.REPORT_GENERATION`) — declared. Zero references. **DEAD.**

These all live in `packages/adapters/queue-bullmq/src/constants.ts` (not in workers) but they distort the worker landscape and the admin queue dashboard. Flag for the packages inventory.

### Job names referenced by apps/api but no processor

The only explicit job name in `apps/workers/` is `process-auto-renewals` (self-emitted). All other workers use BullMQ default job naming (no custom name from the producer side either). No mismatch detected in job naming.

### Provider parity matrix (11 providers, by worker)

| Provider    | publishWorker | inboxSyncWorker | analyticsIngestWorker |
| ----------- | :-----------: | :-------------: | :-------------------: |
| x           |      YES      |       YES       |          YES          |
| instagram   |      YES      |       YES       |          YES          |
| facebook    |      YES      |       YES       |          YES          |
| youtube     |      YES      |       YES       |          YES          |
| tiktok      |      YES      |       YES       |          YES          |
| snapchat    |      YES      |       YES       |          YES          |
| telegram    |      YES      |       YES       |          YES          |
| pinterest   |      YES      |       YES       |          YES          |
| linkedin    |      YES      |       YES       |          YES          |
| bluesky     |      YES      |       YES       |          YES          |
| **threads** |    **YES**    |     **NO**      |        **NO**         |

Threads is wired to publish but not to inbox sync or analytics ingest. If Threads channels are exposed in the UI they will silently skip comment/analytics ingestion.

### Memory references to honor

- **`commandTimeout` on BullMQ Worker connections**: checked across all four workers. `inboxSyncWorker`, `analyticsIngestWorker`, `autoRenewalWorker` all use `maxRetriesPerRequest: null` and **do not** set `commandTimeout` — canon-aligned. `publishWorker` sets `commandTimeout: 5_000` only on `notifyRedis` (saga pub/sub publisher, `maxRetriesPerRequest: 1`), which is **not** a Worker connection. OK.
- **11-provider symmetry**: publish achieves it; inbox/analytics do not (Threads missing). FORGOTTEN-FEATURE / half-feature.
- **No raw `setInterval`** in workers source — fitness check #11 holds.
- **Raw `pino()` factory** in every worker entry — explicitly allowed by CLAUDE.md Logging table (workers are exempt from `createLogger` factory rule).
- **No `private *Cache = new Map()`** patterns — fitness check #14 holds.

## Top findings to escalate

1. **`inboxSyncWorker.ts` + `analyticsIngestWorker.ts` are deployment-dead.** Producers in `apps/api` enqueue jobs; nothing consumes them in dev (`pnpm dev:workers` only starts publish) or in prod (`Dockerfile` CMD = publishWorker only). Either add `pnpm` scripts + multi-CMD container/k8s manifests, or remove the producers. Currently jobs accumulate silently in Redis.
2. **`providers/instagram/publishingWorker.ts` is fully dead.** No bootstrap spawns it; its payload shape (`InstagramPublishPayload` with embedded credentials + retry counters) does not match the canonical `PublishJobInput` shape. Strong delete candidate.
3. **`autoRenewalWorker.ts` is a parallel implementation of `TrialManagementService.processAutoRenewals`** (in `apps/api/src/billing`). One should win — either the worker cron drives auto-renewal (delete the REST/service path) or the REST/service path drives it (delete the worker). Today both could run, racing on `prisma.account.update`.
4. **Threads provider missing from inbox + analytics workers.** Half-feature: customers can publish to Threads but inbox/analytics ingestion silently no-ops.
5. **OTel coverage asymmetry**: only `publishWorker` is instrumented; the other three workers run blind even when `TRACING_ENABLED=true`.
6. **Inbox sync bypasses `CredentialResolver`** while publish + analytics use it. If channel credentials are encrypted at rest, inbox sync may break depending on the adapter's contract. Audit `provider.getComments` signatures vs `provider.fetchAnalytics` / `provider.publish` to confirm.
7. **5 queue constants declared but unused anywhere** (`recurring-posts`, `detect-repurpose`, `triage-inbox`, `trend-radar`, `report-generation`). Dead declarations distorting the admin queue dashboard. Owns to packages inventory.

## Methodology + caveats

- All inventory generated from static analysis (`grep`/`Read`) on the working tree at branch `workstream/horizontal-audits-v1`.
- "Producer in apps/api" determined by `grep -rn "QUEUE_NAMES\.<NAME>" apps/api/src`. False positives possible if a queue is enqueued via a string literal — none spotted.
- Tests under `apps/workers/tests/` excluded by scope.
- The graphify report (`apps/workers/graphify-out/GRAPH_REPORT.md`) flags `InstagramPublishingWorker` as a "god node" with 18 edges; all those edges connect to its own tests, confirming the DEAD verdict.
- Cross-surface verdicts (esp. saga pub/sub event handlers, outbox consumers for `ChannelAuthFailed`) require the apps/api inventory to close — flagged inline as cross-surface signals.
- Verdicts use the project's standard ladder: **VÁLIDO** (in use + tested), **DEAD** (no caller anywhere), **MISMATCH** (wired in code but deployment broken or contract mismatch), **FORGOTTEN-FEATURE** (capability exists in source but unreachable / partially wired), **REDUNDANTE** (two implementations of the same behavior — none in this surface, but #3 above is close).
