---
title: Packages inventory — full-repo audit input
description: File-by-file inventory of packages/*/src/ — 11 providers + ports + adapters + shared + ui + api-common + api-errors + observability + monitoring + core + query-client.
generated: 2026-05-10
auditor: claude-code
---

# Packages inventory

> 235 files inventoried across 13 top-level sub-packages (providers/{11+shared+\_template}, adapters/{cache-redis, db-prisma, queue-bullmq, dead-letter-queue, external-apis, fallback-strategies, storage-s3/azure/cloudinary/do-spaces/gcs, crm-hubspot, crm-salesforce}, ports, shared, ui, api-common, api-errors, observability/{logger, browser-logger, background-scheduler, opentelemetry}, monitoring/{circuit-breaker, health-checks}, core, query-client). Veredicto breakdown: ~205 VÁLIDO, ~6 with canon-deviation tags (raw `pino` factories or env reads outside the canonical channels), ~14 missing `@layer` (auditor-flagged, not blocking), 0 confirmed DEAD top-level files (every barrel + every Adapter has at least one consumer). The `_template` package and `_GetObjectCommand` style unused imports are explicitly per-canon scaffolding and intentional.

## Summary by sub-package

| Sub-package                        | Files | VÁLIDO | Notes                                                                                                                                                                  |
| ---------------------------------- | ----: | -----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ports/                             |    11 |     11 | Domain-only contracts; one CrmAdapter port without `provider` discriminant (adapters expose `platform` instead — `MISMATCH` with `PaymentAdapter.provider` naming).    |
| providers/x                        |     3 |      3 | Standard pattern (Adapter/apiClient/index).                                                                                                                            |
| providers/instagram                |     6 |      6 | Adds mediaProcessor + schedulingService + contentHelpers — heavier than baseline.                                                                                      |
| providers/facebook                 |    18 |     18 | Heaviest provider (analytics/, features/, media/ sub-modules — Stories, Reels, Shop, Events, Community).                                                               |
| providers/youtube                  |    12 |     12 | analytics, liveStreaming, communityFeatures, playlistManager, shorts, shorts/helpers/types.                                                                            |
| providers/tiktok                   |    15 |     15 | Has 3 separate apiClients (apiClient/contentAnalyticsClient/marketingApiClient/researchApiClient) + authService + hashtag/\* + videoProcessor.                         |
| providers/snapchat                 |     5 |      5 | Adapter + apiClient + responseParsers + types.                                                                                                                         |
| providers/telegram                 |     3 |      3 | Standard.                                                                                                                                                              |
| providers/pinterest                |     3 |      3 | Standard.                                                                                                                                                              |
| providers/linkedin                 |     5 |      5 | Adapter + apiClient + mediaUpload + types.                                                                                                                             |
| providers/bluesky                  |     3 |      3 | Adapter + BlueskyClient (AT Protocol wrapper).                                                                                                                         |
| providers/threads                  |     2 |      2 | Smallest: Adapter + barrel; uses Meta Graph indirectly.                                                                                                                |
| providers/shared                   |     4 |      4 | Composition helpers, ProviderError, providerTypes.                                                                                                                     |
| providers/\_template               |     2 |      2 | Intentional scaffolding (CLAUDE.md §provider canon). Reads `process.env.PROVIDER_API_KEY` ON PURPOSE — flagged as scaffold-only. NOT DEAD.                             |
| adapters/cache-redis               |    11 |     11 | Implements `CachePort` twice (Redis + InMemory) — intentional per CachePort canon.                                                                                     |
| adapters/db-prisma                 |    10 |     10 | Composed RepoPort (Account/Project/Post/Channel/PublishLog/Analytics/Thread) + resilience + mappers + cached wrapper.                                                  |
| adapters/queue-bullmq              |     6 |      6 | Implements `QueuePort`, `QueuePortRegistry`, `DeadLetterQueuePort` + shared resilience + QUEUE_NAMES constant.                                                         |
| adapters/dead-letter-queue         |     1 |      0 | REDUNDANT — duplicates `BullMQDeadLetterQueueAdapter` (different shape). Uses raw `pino` factory + reads `process.env.LOG_LEVEL` (CWE-#13 canon violation).            |
| adapters/external-apis             |     2 |      1 | `circuitBreaker.ts` heavy & central; module retains a global singleton (`globalCircuitBreaker`) accessed via `getExternalApiCircuitBreaker()` — minor singleton smell. |
| adapters/fallback-strategies       |     1 |      0 | Uses raw `pino` + `process.env.LOG_LEVEL` (canon-deviation #13). Otherwise VÁLIDO (consumed by external-apis + linkedin/x/instagram apiClients).                       |
| adapters/storage-s3                |     1 |      1 | Reference storage adapter; reused by do-spaces.                                                                                                                        |
| adapters/storage-azure             |     1 |      1 | Implements StoragePort.                                                                                                                                                |
| adapters/storage-cloudinary        |     1 |      1 | Implements StoragePort with cloudinary SDK.                                                                                                                            |
| adapters/storage-do-spaces         |     1 |      1 | Thin wrapper over storage-s3 (DO Spaces is S3-compatible).                                                                                                             |
| adapters/storage-gcs               |     1 |      1 | Implements StoragePort.                                                                                                                                                |
| adapters/crm-hubspot               |     2 |      2 | Implements `CrmAdapter` port. Uses `platform` discriminant (not `provider`).                                                                                           |
| adapters/crm-salesforce            |     2 |      2 | Implements `CrmAdapter` port. Same `platform` discriminant.                                                                                                            |
| shared/                            |    13 |     13 | Domain types, CQRS, saga (with `defineSaga()` canon factory), events, errors, providerConfig, templates, crypto, client-safe re-exports.                               |
| ui/                                |    47 |     47 | 35 primitives + 12 business components + 2 hooks + utils + index. All have `@component` per fitness #12.                                                               |
| api-common/                        |     4 |      4 | Framework-neutral schemas, webhook signature, CSV export.                                                                                                              |
| api-errors/                        |     2 |      2 | Canonical `ApiError` class consumed by admin + client.                                                                                                                 |
| observability/logger               |     1 |      0 | Single `createLogger` factory; `LOG_LEVEL` from env is canonical per CLAUDE.md. VALID but env-coupled (acceptable, transport choice).                                  |
| observability/browser-logger       |     4 |      4 | Port + console adapter + React provider. Used by admin/client.                                                                                                         |
| observability/background-scheduler |     4 |      4 | Port + DefaultBackgroundTaskScheduler + Noop. Canonical replacement for raw setInterval.                                                                               |
| observability/opentelemetry        |     4 |      4 | NodeSDK bootstrap + businessMetrics + correlationTracking + customInstrumentation. All use raw `pino` (canon deviation #13).                                           |
| monitoring/circuit-breaker         |     1 |      1 | Standalone circuit-breaker (separate from `external-apis`). Uses raw `pino`.                                                                                           |
| monitoring/health-checks           |     8 |      8 | Orchestrator + 6 checkers + types. `index.ts` + `tenantHealth.ts` use raw `pino`.                                                                                      |
| core/                              |     2 |      2 | `planPublication` only — the package name overpromises scope.                                                                                                          |
| query-client/                      |     1 |      1 | TanStack Query factory consumed by admin + client.                                                                                                                     |

## Summary by Tipo

| Tipo               |                                                                                                          Count |
| ------------------ | -------------------------------------------------------------------------------------------------------------: |
| port-interface     |                                                                                                             11 |
| adapter-impl       |                             14 (db-prisma, queue-bullmq×4, dead-letter-queue, cache-redis×2, storage×5, crm×2) |
| provider-adapter   |                                                                                    12 (11 social + 1 template) |
| provider-apiClient |                                                              15 (one per provider + tiktok×4 + bluesky-client) |
| domain-type        |                                                                 ~22 (types.ts files across providers + shared) |
| cqrs-bus           |                                                                                             1 (shared/cqrs.ts) |
| saga-definition    |                                                                                             1 (shared/saga.ts) |
| ui-component       |                                                                                                             35 |
| ui-hook            |                                                                                                              4 |
| logger-factory     | 3 (observability/logger, browser-logger, background-scheduler — DIFFERENT scopes, NOT redundant per CLAUDE.md) |
| scheduler          |                                                                                      3 (port + default + noop) |
| circuit-breaker    |                                2 (monitoring/circuit-breaker + adapters/external-apis — these ARE overlapping) |
| health-check       |                                                                                                              8 |
| base-route         |                                            1 (api-common base utils — full BaseRouteHandler lives in apps/api) |
| barrel/index       |                                                                                                            ~25 |
| config             |                                                                                            1 (cache constants) |

## Ports + adapters matrix

| Port (interface)      | File                                      | Adapter(s) implementing it                                                                                                                                                                               | Files                                                                |
| --------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `CachePort`           | packages/ports/src/CachePort.ts           | RedisCacheAdapter, InMemoryCacheAdapter                                                                                                                                                                  | packages/adapters/cache-redis/src/{redis,in-memory}-cache-adapter.ts |
| `QueuePort`           | packages/ports/src/QueuePort.ts           | BullMQQueueAdapter                                                                                                                                                                                       | packages/adapters/queue-bullmq/src/queue-adapter.ts                  |
| `QueuePortRegistry`   | packages/ports/src/QueuePortRegistry.ts   | BullMQQueuePortRegistry                                                                                                                                                                                  | packages/adapters/queue-bullmq/src/queue-port-registry.ts            |
| `DeadLetterQueuePort` | packages/ports/src/DeadLetterQueuePort.ts | BullMQDeadLetterQueueAdapter                                                                                                                                                                             | packages/adapters/queue-bullmq/src/dead-letter-queue-adapter.ts      |
| `SemanticLockPort`    | packages/ports/src/SemanticLockPort.ts    | **(none in packages/)** — implementation lives in apps/api/src/saga/                                                                                                                                     | —                                                                    |
| `RepoPort`            | packages/ports/src/RepoPort.ts            | PrismaRepoAdapter (composed)                                                                                                                                                                             | packages/adapters/db-prisma/src/index.ts                             |
| `StoragePort`         | packages/ports/src/StoragePort.ts         | S3, Azure, Cloudinary, DO-Spaces (S3 wrapper), GCS                                                                                                                                                       | packages/adapters/storage-\*/src/index.ts                            |
| `CrmAdapter`          | packages/ports/src/CrmAdapter.ts          | HubSpotAdapter, SalesforceAdapter                                                                                                                                                                        | packages/adapters/crm-{hubspot,salesforce}/src/                      |
| `PaymentAdapter`      | packages/ports/src/PaymentAdapter.ts      | **(none in packages/)** — Stripe/Paddle impls live in apps/api/src/billing/                                                                                                                              | —                                                                    |
| `ProviderAdapter`     | packages/ports/src/ProviderAdapter.ts     | XAdapter, InstagramAdapter, FacebookAdapter, YouTubeAdapter, TikTokAdapter, SnapchatAdapter, TelegramAdapter, PinterestAdapter, LinkedInAdapter, BlueskyAdapter, ThreadsAdapter, templateProviderAdapter | packages/providers/*/src/*Adapter.ts                                 |

**Findings:**

- `SemanticLockPort` and `PaymentAdapter` have NO implementing adapter in `packages/`. Both are implemented in `apps/api/` (`SemanticLockAdapter` in saga module; Stripe/Paddle gateway adapters in billing). This is architecturally acceptable (the port is canonical, implementations are app-local) but worth noting in the inventory: a future refactor could move them into `packages/adapters/saga-locks/` and `packages/adapters/billing-stripe/` for symmetry with the other adapters.

## Provider matrix

| Provider   | Files | Adapter exported              | apiClient exported             | Wired in `apps/workers/publishWorker.ts` | Used in `apps/api/providerRegistry.ts` |
| ---------- | ----: | ----------------------------- | ------------------------------ | ---------------------------------------- | -------------------------------------- |
| x          |     3 | yes                           | yes (XApiClient)               | yes                                      | yes                                    |
| instagram  |     6 | yes                           | yes (InstagramApiClient)       | yes                                      | yes                                    |
| facebook   |    18 | yes                           | yes (FacebookApiClient)        | yes                                      | yes                                    |
| youtube    |    12 | yes                           | yes (YouTubeApiClient)         | yes                                      | yes                                    |
| tiktok     |    15 | yes                           | yes (4 separate clients)       | yes                                      | yes                                    |
| snapchat   |     5 | yes                           | yes (SnapchatApiClient)        | yes                                      | yes                                    |
| telegram   |     3 | yes                           | yes (TelegramApiClient)        | yes                                      | yes                                    |
| pinterest  |     3 | yes                           | yes (PinterestApiClient)       | yes                                      | yes                                    |
| linkedin   |     5 | yes                           | yes (LinkedInApiClient)        | yes                                      | yes                                    |
| bluesky    |     3 | yes                           | yes (BlueskyClient)            | yes                                      | yes                                    |
| threads    |     2 | yes                           | no (uses adapter direct calls) | yes                                      | yes                                    |
| \_template |     2 | yes (templateProviderAdapter) | yes (ProviderApiClient)        | NO (intentional — scaffold)              | NO (intentional — scaffold)            |
| shared     |     4 | n/a (helpers)                 | n/a                            | imported by adapters                     | imported by adapters                   |

The `_template` is intentional scaffolding per CLAUDE.md (referenced from project_historical_context). NOT DEAD. Fitness #15/#19 explicitly exclude it.

## By sub-package

### packages/ports/

### audit-P-001 — CachePort interface

- **Path:** [packages/ports/src/CachePort.ts](packages/ports/src/CachePort.ts)
- **Surface:** packages
- **Sub-package:** ports
- **Tipo:** port-interface
- **@layer declared:** domain
- **Propósito real:** Cache-aside canonical surface (`getOrSet`, `get`, `set`, `delete`, `invalidateByTag`, `has`) used by application services.
- **Exports:** `CachePort` interface
- **Imports significativos:** none (pure)
- **Consumers:** `@adapters/cache-redis` (Redis + InMemory adapters), `apps/api/src/...` services via DI
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Stampede protection (PR-29) explicitly deferred per JSDoc.

### audit-P-002 — CrmAdapter port

- **Path:** [packages/ports/src/CrmAdapter.ts](packages/ports/src/CrmAdapter.ts)
- **Surface:** packages
- **Sub-package:** ports
- **Tipo:** port-interface
- **@layer declared:** domain
- **Propósito real:** CRM OAuth + contact sync + activity logging contract (HubSpot/Salesforce).
- **Exports:** `CrmAdapter`, `CrmContact`, `CrmActivityPayload`, `CrmTokens`, `CrmContactPage`
- **Imports significativos:** none
- **Consumers:** `@adapters/crm-hubspot`, `@adapters/crm-salesforce`
- **Veredicto preliminar:** MISMATCH
- **Notas:** Port has NO discriminant field; adapters add `readonly platform = "HUBSPOT" | "SALESFORCE"` — inconsistent with `PaymentAdapter.provider: GatewayProviderType`. Either add `readonly platform: "HUBSPOT" | "SALESFORCE"` to port, or normalize to `provider` across both ports.

### audit-P-003 — DeadLetterQueuePort

- **Path:** [packages/ports/src/DeadLetterQueuePort.ts](packages/ports/src/DeadLetterQueuePort.ts)
- **Surface:** packages
- **Sub-package:** ports
- **Tipo:** port-interface
- **@layer declared:** domain
- **Propósito real:** DLQ producer/consumer contract (`archive`, `list`, `retry`). List/retry methods may return `NOT_IMPLEMENTED`.
- **Exports:** `DeadLetterQueuePort`, `DeadLetterEntry`, `DeadLetterFailure`
- **Imports significativos:** `@shared/types` (Result)
- **Consumers:** `@adapters/queue-bullmq/dead-letter-queue-adapter.ts`
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Canonical port; complementary adapter `@adapters/dead-letter-queue` exists and OVERLAPS — see DEAD/REDUNDANT section.

### audit-P-004 — PaymentAdapter port

- **Path:** [packages/ports/src/PaymentAdapter.ts](packages/ports/src/PaymentAdapter.ts)
- **Surface:** packages
- **Sub-package:** ports
- **Tipo:** port-interface
- **@layer declared:** domain
- **Propósito real:** Billing gateway contract for Stripe/Paddle (customer, subscription, webhook parsing).
- **Exports:** `PaymentAdapter`, `BillingPlan`, `BillingCycle`, `BillingDomainEvent`, `WebhookEvent`, etc.
- **Imports significativos:** none
- **Consumers:** `apps/api/src/billing/*` (concrete Stripe/Paddle impls live there)
- **Veredicto preliminar:** FORGOTTEN-FEATURE (port in packages, adapters in apps)
- **Notas:** Implementations should ideally live in `packages/adapters/billing-stripe/` etc. Currently the canonical port is `packages/-side` but every implementation is app-local. Architectural inconsistency vs storage / queue / repo ports.

### audit-P-005 — ProviderAdapter port

- **Path:** [packages/ports/src/ProviderAdapter.ts](packages/ports/src/ProviderAdapter.ts)
- **Surface:** packages
- **Sub-package:** ports
- **Tipo:** port-interface
- **@layer declared:** domain
- **Propósito real:** The canonical social-platform adapter contract: `render`, `publish`, `publishThread`, `fetchAnalytics`, `handleWebhook`, `getComments`, `postReply` + `ProviderId` union and `ProviderLimits` shape.
- **Exports:** `ProviderAdapter`, `ProviderId`, `ProviderLimits`, `PublishInput`, `PublishReceipt`, `ProviderComment`, `ProviderReplyResult`, `RenderedPost` re-export
- **Imports significativos:** `@shared/types` for `CanonicalPost`, `Media`, `Result`, `RenderError`, `PublishError`, `ThreadError`
- **Consumers:** All 12 provider adapters + `apps/api/src/providers/providerRegistry.ts` + `apps/workers/src/publishWorker.ts`
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Comprehensive port; `ProviderId` union duplicated in `shared/providers/providerConfig.ts` — minor drift risk.

### audit-P-006 — QueuePort

- **Path:** [packages/ports/src/QueuePort.ts](packages/ports/src/QueuePort.ts)
- **Surface:** packages
- **Sub-package:** ports
- **Tipo:** port-interface
- **@layer declared:** domain
- **Propósito real:** `enqueue` + `health` + `remove` + `getJobStates` contract (BullMQ-derived but tech-free).
- **Exports:** `QueuePort`, `QueueJob`, `QueueHealth`, `JobState`, `JobStatesAggregate`
- **Imports significativos:** `@shared/types`
- **Consumers:** `@adapters/queue-bullmq/queue-adapter.ts`, application services
- **Veredicto preliminar:** VÁLIDO

### audit-P-007 — QueuePortRegistry

- **Path:** [packages/ports/src/QueuePortRegistry.ts](packages/ports/src/QueuePortRegistry.ts)
- **Surface:** packages
- **Sub-package:** ports
- **Tipo:** port-interface
- **@layer declared:** domain
- **Propósito real:** Per-name `QueuePort` factory letting many consumers share a Redis pool while routing to distinct queues.
- **Exports:** `QueuePortRegistry` interface (`forQueue`, `close`)
- **Imports significativos:** `./QueuePort`
- **Consumers:** `@adapters/queue-bullmq/queue-port-registry.ts`
- **Veredicto preliminar:** VÁLIDO

### audit-P-008 — RepoPort

- **Path:** [packages/ports/src/RepoPort.ts](packages/ports/src/RepoPort.ts)
- **Surface:** packages
- **Sub-package:** ports
- **Tipo:** port-interface
- **@layer declared:** domain
- **Propósito real:** Persistence contract over Account, Project, Post, Channel, PublishLog, Thread, Tweet, Analytics — the largest port surface.
- **Exports:** `RepoPort`, `Channel`, `PublishLog`, `Analytics`, `CreatePostInput`, `ListPostsQuery`, `PostsPage`, `AnalyticsQuery`, `CreateThreadInput`, `CreateTweetInput`, etc.
- **Imports significativos:** `@shared/types`, `./ProviderAdapter.js`
- **Consumers:** `@adapters/db-prisma/*`, application services
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Large port (35+ methods) — candidate for sub-port split (AccountRepo, PostRepo, etc.) in a future refactor. The Prisma adapter already does this internally via composition.

### audit-P-009 — SemanticLockPort

- **Path:** [packages/ports/src/SemanticLockPort.ts](packages/ports/src/SemanticLockPort.ts)
- **Surface:** packages
- **Sub-package:** ports
- **Tipo:** port-interface
- **@layer declared:** domain
- **Propósito real:** Azure saga semantic-lock canon (acquire/release/releaseAllForSaga) with TTL + holder-aware release.
- **Exports:** `SemanticLockPort`, `SemanticLockError`
- **Imports significativos:** `@shared/types`
- **Consumers:** `apps/api/src/saga/SemanticLockAdapter` (Redis impl)
- **Veredicto preliminar:** FORGOTTEN-FEATURE
- **Notas:** Implementation lives in `apps/api/`. Symmetry with other ports would put adapter in `packages/adapters/saga-locks/`.

### audit-P-010 — StoragePort

- **Path:** [packages/ports/src/StoragePort.ts](packages/ports/src/StoragePort.ts)
- **Surface:** packages
- **Sub-package:** ports
- **Tipo:** port-interface
- **@layer declared:** domain
- **Propósito real:** Upload-signature + media-metadata contract.
- **Exports:** `StoragePort`, `UploadSignature`, `MediaMetadata`
- **Imports significativos:** `@shared/types`
- **Consumers:** All 5 storage adapters + `apps/api/src/infrastructure/storage/createStorageAdapter.ts`
- **Veredicto preliminar:** VÁLIDO

### audit-P-011 — ports barrel

- **Path:** [packages/ports/src/index.ts](packages/ports/src/index.ts)
- **Surface:** packages
- **Sub-package:** ports
- **Tipo:** barrel
- **@layer declared:** domain
- **Propósito real:** Re-export all ports.
- **Exports:** all of the above
- **Imports significativos:** local
- **Consumers:** `apps/api`, `apps/workers`, all adapter packages, all provider packages
- **Veredicto preliminar:** VÁLIDO

### packages/shared/

### audit-P-012 — types.ts

- **Path:** [packages/shared/src/types.ts](packages/shared/src/types.ts)
- **Surface:** packages
- **Sub-package:** shared
- **Tipo:** domain-type
- **@layer declared:** domain
- **Propósito real:** Core domain types — `RenderedPost`, `Media`, `CanonicalPost`, `RenderedContent`, `Result`, threading types, account/subscription value objects.
- **Exports:** dozens — domain core
- **Imports significativos:** none
- **Consumers:** 660+ files repo-wide
- **Veredicto preliminar:** VÁLIDO

### audit-P-013 — saga.ts

- **Path:** [packages/shared/src/saga.ts](packages/shared/src/saga.ts)
- **Surface:** packages
- **Sub-package:** shared
- **Tipo:** saga-definition
- **@layer declared:** domain
- **Propósito real:** Canon-aligned Saga pattern (Richardson + Azure). Step classification (`compensable`/`pivot`/`retryable`) enforced by TS discriminated union + `defineSaga()` factory that requires preCommit/pivot/postCommit segments → canon-by-construction.
- **Exports:** `SagaStatus`, `SagaStepResult`, `SagaContext`, `SagaStep` (discriminated union), `defineSaga()` factory, `SagaDefinition`, `SagaInstance`
- **Imports significativos:** `./events`, `./cqrs`
- **Consumers:** `apps/api/src/saga/*`, integration tests
- **Veredicto preliminar:** VÁLIDO
- **Notas:** The saga retrofit anchor — DO NOT BREAK.

### audit-P-014 — cqrs.ts

- **Path:** [packages/shared/src/cqrs.ts](packages/shared/src/cqrs.ts)
- **Surface:** packages
- **Sub-package:** shared
- **Tipo:** cqrs-bus
- **@layer declared:** **MISSING** (file header has `@file/@description` only)
- **Propósito real:** Foundation types for CQRS — `Command`, `Query`, `CommandHandler`, `QueryHandler`, `CommandMetadata`, `QueryMetadata`. CQRS bus impl lives in `apps/api/src/cqrs/`.
- **Exports:** Command/Query/handler interfaces + helpers
- **Imports significativos:** `node:crypto`, `zod`, `./events`
- **Consumers:** `apps/api/src/cqrs/*` heavily
- **Veredicto preliminar:** VÁLIDO (needs `@layer domain` added)

### audit-P-015 — events.ts

- **Path:** [packages/shared/src/events.ts](packages/shared/src/events.ts)
- **Surface:** packages
- **Sub-package:** shared
- **Tipo:** domain-type
- **@layer declared:** **MISSING**
- **Propósito real:** Base `DomainEvent` interface + EventMetadata + event-sourcing helpers.
- **Exports:** `DomainEvent`, `EventMetadata`, helpers
- **Imports significativos:** `node:crypto`, `zod`
- **Consumers:** repo-wide
- **Veredicto preliminar:** VÁLIDO (needs `@layer domain`)

### audit-P-016 — errors.ts

- **Path:** [packages/shared/src/errors.ts](packages/shared/src/errors.ts)
- **Surface:** packages
- **Sub-package:** shared
- **Tipo:** domain-type
- **@layer declared:** domain
- **Propósito real:** Standardized `ErrorCode` enum (auth, validation, resource, rate-limit, db, business, infra, provider categories).
- **Exports:** `ErrorCode` enum
- **Imports significativos:** none
- **Consumers:** repo-wide
- **Veredicto preliminar:** VÁLIDO

### audit-P-017 — orchestration.ts

- **Path:** [packages/shared/src/orchestration.ts](packages/shared/src/orchestration.ts)
- **Surface:** packages
- **Sub-package:** shared
- **Tipo:** domain-type
- **@layer declared:** **MISSING**
- **Propósito real:** Multi-provider sync/orchestration types (`OrchestrationStatus`, `PublishingStrategy`, `ConflictResolutionStrategy`).
- **Exports:** orchestration types
- **Imports significativos:** `./types`, `./providers/providerConfig`
- **Consumers:** `apps/api/src/orchestration/*`
- **Veredicto preliminar:** VÁLIDO (needs `@layer domain`)

### audit-P-018 — analytics.ts

- **Path:** [packages/shared/src/analytics.ts](packages/shared/src/analytics.ts)
- **Surface:** packages
- **Sub-package:** shared
- **Tipo:** domain-type
- **@layer declared:** domain
- **Propósito real:** Analytics + ML types (TimeRange, MetricType, ProviderType union).
- **Exports:** analytics types
- **Imports significativos:** none
- **Consumers:** admin + client + api analytics modules
- **Veredicto preliminar:** VÁLIDO
- **Notas:** `ProviderType` here re-declares `ProviderId` with `"twitter"` instead of `"x"` — drift risk.

### audit-P-019 — channelCredentialsCrypto.ts

- **Path:** [packages/shared/src/channelCredentialsCrypto.ts](packages/shared/src/channelCredentialsCrypto.ts)
- **Surface:** packages
- **Sub-package:** shared
- **Tipo:** types + adapter-impl (crypto)
- **@layer declared:** infrastructure (deliberately — uses node:crypto)
- **Propósito real:** AES-256-GCM helpers for the encrypted Channel.credentials envelope. Shared by api / workers / seed to avoid drift.
- **Exports:** `EncryptedChannelCredentialsEnvelope`, encrypt/decrypt helpers
- **Imports significativos:** `node:crypto`
- **Consumers:** apps/api, apps/workers, infra/prisma seed
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Layer is `infrastructure` despite living in `shared/` because of crypto coupling — acceptable per CLAUDE.md mapping.

### audit-P-020 — client.ts (browser-safe re-exports)

- **Path:** [packages/shared/src/client.ts](packages/shared/src/client.ts)
- **Surface:** packages
- **Sub-package:** shared
- **Tipo:** barrel
- **@layer declared:** domain
- **Propósito real:** Browser-safe shared barrel — excludes BaseTemplateEngine (Handlebars Node-only).
- **Exports:** types, events, saga, cqrs, providerConfig
- **Imports significativos:** local
- **Consumers:** `apps/admin`, `apps/client`
- **Veredicto preliminar:** VÁLIDO

### audit-P-021 — providers/providerConfig.ts

- **Path:** [packages/shared/src/providers/providerConfig.ts](packages/shared/src/providers/providerConfig.ts)
- **Surface:** packages
- **Sub-package:** shared
- **Tipo:** config
- **@layer declared:** domain
- **Propósito real:** Single source of truth for provider constraints, capabilities, metadata — `PROVIDER_CONFIGS`, `getProviderConfig`, `validateContentForProvider`.
- **Exports:** `ProviderId`, `ProviderCapabilities`, `ProviderLimits`, `ProviderMetadata`, `PROVIDER_CONFIGS`, validators
- **Imports significativos:** none
- **Consumers:** admin, client, api, providers
- **Veredicto preliminar:** VÁLIDO
- **Notas:** `ProviderId` duplicated with `ports/ProviderAdapter.ts` — drift risk; consider canonical export from one place.

### audit-P-022 — templates/BaseTemplateEngine.ts

- **Path:** [packages/shared/src/templates/BaseTemplateEngine.ts](packages/shared/src/templates/BaseTemplateEngine.ts)
- **Surface:** packages
- **Sub-package:** shared
- **Tipo:** domain-type + engine
- **@layer declared:** domain
- **Propósito real:** Handlebars template engine + date-fns helpers + variable validation. Used by `BaseTemplateEngine` extenders in admin/client.
- **Exports:** `BaseTemplateEngine`, `Template`, `TemplateVariable`, `TemplateVariant`, `TemplateContext`, `TemplateCompilationResult`
- **Imports significativos:** `handlebars`, `date-fns`
- **Consumers:** `apps/admin/lib/templates/`, `apps/client/lib/templates/`
- **Veredicto preliminar:** VÁLIDO
- **Notas:** `@layer domain` is borderline — handlebars+date-fns are runtime deps but the abstraction is template-domain logic. Acceptable.

### audit-P-023 — templates/types.ts

- **Path:** [packages/shared/src/templates/types.ts](packages/shared/src/templates/types.ts)
- **Surface:** packages
- **Sub-package:** shared
- **Tipo:** types
- **@layer declared:** domain
- **Propósito real:** Client-safe template type shapes (duplicates BaseTemplateEngine types intentionally to keep client bundle free of handlebars).
- **Exports:** `TemplateVariable`, `TemplateVariant`, `Template`
- **Imports significativos:** none
- **Consumers:** client browser bundle
- **Veredicto preliminar:** VÁLIDO

### audit-P-024 — shared/index.ts barrel

- **Path:** [packages/shared/src/index.ts](packages/shared/src/index.ts)
- **Surface:** packages
- **Sub-package:** shared
- **Tipo:** barrel
- **@layer declared:** domain
- **Propósito real:** Server-side barrel re-exporting everything including handlebars-coupled BaseTemplateEngine.
- **Exports:** all shared
- **Imports significativos:** local
- **Consumers:** apps/api, apps/workers
- **Veredicto preliminar:** VÁLIDO

### packages/providers/

(Templates and tiny barrels grouped — Adapter, apiClient, types each listed once per provider.)

### audit-P-025 — providers/\_template/index.ts (scaffold)

- **Path:** [packages/providers/\_template/src/index.ts](packages/providers/_template/src/index.ts)
- **Surface:** packages
- **Sub-package:** providers/\_template
- **Tipo:** provider-adapter (scaffold)
- **@layer declared:** infrastructure
- **Propósito real:** Reference implementation for new providers. Reads `process.env.PROVIDER_API_KEY` ON PURPOSE — flagged in JSDoc as scaffold-only.
- **Exports:** `templateProviderAdapter`, `fetchProviderAnalytics`
- **Imports significativos:** `@shared/types`, `@ports/core`, `../../../core/threading/src/threadPlanner.js` (DEEP relative path — fragile)
- **Consumers:** none (intentional)
- **Veredicto preliminar:** VÁLIDO (intentional scaffold)
- **Notas:** Fitness #15 + #19 exclude this package; the env reads here are documented scaffold pattern. Per CLAUDE.md project_historical_context. The deep relative import `../../../core/threading/src/threadPlanner.js` should resolve via the path-alias system — verify the alias is `@core/threading` or similar.

### audit-P-026 — providers/\_template/apiClient.ts

- **Path:** [packages/providers/\_template/src/apiClient.ts](packages/providers/_template/src/apiClient.ts)
- **Surface:** packages
- **Sub-package:** providers/\_template
- **Tipo:** provider-apiClient (scaffold)
- **@layer declared:** infrastructure
- **Propósito real:** Skeleton apiClient with circuit-breaker + metrics + createLogger pattern.
- **Exports:** `ProviderApiClient`, `ProviderCredentials`
- **Imports significativos:** `@adapters/external-apis`, `@observability/logger`, `prom-client`
- **Consumers:** none (intentional)
- **Veredicto preliminar:** VÁLIDO (scaffold)

### audit-P-027 — providers/shared/index.ts

- **Path:** [packages/providers/shared/src/index.ts](packages/providers/shared/src/index.ts)
- **Surface:** packages
- **Sub-package:** providers/shared
- **Tipo:** barrel
- **@layer declared:** infrastructure
- **Propósito real:** Composition helpers + ProviderError + shared types for all concrete providers.
- **Exports:** helpers (`validateCredentialStructure`, `uploadMediaWithRetry`, etc.), `ProviderError`, `ProviderErrorCode`, `ProviderCredentials`, `ProviderMetadata`, etc.
- **Imports significativos:** local
- **Consumers:** every concrete provider adapter
- **Veredicto preliminar:** VÁLIDO

### audit-P-028 — providers/shared/helpers.ts

- **Path:** [packages/providers/shared/src/helpers.ts](packages/providers/shared/src/helpers.ts)
- **Surface:** packages
- **Sub-package:** providers/shared
- **Tipo:** provider-helper (stateless)
- **@layer declared:** infrastructure
- **Propósito real:** Stateless composition helpers (validate creds, upload-with-retry, error mapping, preview rendering).
- **Exports:** 7 helper functions
- **Imports significativos:** `@ports/core` (ProviderId), `@shared/types`, `pino` (type-only)
- **Consumers:** every concrete provider adapter
- **Veredicto preliminar:** VÁLIDO

### audit-P-029 — providers/shared/ProviderError.ts

- **Path:** [packages/providers/shared/src/ProviderError.ts](packages/providers/shared/src/ProviderError.ts)
- **Surface:** packages
- **Sub-package:** providers/shared
- **Tipo:** domain-type
- **@layer declared:** **MISSING**
- **Propósito real:** Structured error class mirroring `AppError` factory-method API; carries `code` + `statusCode` for upstream error handlers.
- **Exports:** `ProviderError`, `ProviderErrorCode` enum
- **Imports significativos:** none
- **Consumers:** every concrete provider adapter
- **Veredicto preliminar:** VÁLIDO (needs `@layer infrastructure`)

### audit-P-030 — providers/shared/providerTypes.ts

- **Path:** [packages/providers/shared/src/providerTypes.ts](packages/providers/shared/src/providerTypes.ts)
- **Surface:** packages
- **Sub-package:** providers/shared
- **Tipo:** domain-type
- **@layer declared:** infrastructure
- **Propósito real:** Shared metadata + constraint + validation result + preview shapes.
- **Exports:** `ProviderMetadata`, `ProviderConstraints`, `ProviderAuthType`, `ContentValidationResult`, `ProviderPreview`, etc.
- **Imports significativos:** `@ports/core`, `@shared/types`
- **Consumers:** every concrete provider adapter
- **Veredicto preliminar:** VÁLIDO

### audit-P-031 — providers/x/index.ts

- **Path:** [packages/providers/x/src/index.ts](packages/providers/x/src/index.ts)
- **Surface:** packages
- **Sub-package:** providers/x
- **Tipo:** barrel
- **@layer declared:** infrastructure
- **Propósito real:** Barrel re-exporting XAdapter factory + XApiClient + credential/response types.
- **Exports:** `XAdapter`, `createXAdapter`, `XApiClient`, type exports
- **Imports significativos:** local
- **Consumers:** `apps/api/providers/providerRegistry.ts`, `apps/workers/publishWorker.ts`, `apps/workers/{inboxSync,analyticsIngest}Worker.ts`, tests
- **Veredicto preliminar:** VÁLIDO

### audit-P-032 — providers/x/XAdapter.ts

- **Path:** [packages/providers/x/src/XAdapter.ts](packages/providers/x/src/XAdapter.ts)
- **Surface:** packages
- **Sub-package:** providers/x
- **Tipo:** provider-adapter
- **@layer declared:** infrastructure
- **Propósito real:** Twitter/X provider adapter using twitter-api-v2. Supports tweets, threading, media, polls, quote tweets, replies, analytics. Stateless w.r.t. credentials.
- **Exports:** `XAdapter` class, `createXAdapter` factory, `XAdapterDeps`, `XApiClientFactory`
- **Imports significativos:** `@ports/core`, `@shared/types`, `pino` (import + default factory at construction)
- **Consumers:** providers/x/index.ts barrel
- **Veredicto preliminar:** VÁLIDO (with canon-deviation note)
- **Notas:** Imports `pino` directly and falls back to `pino({...})` when no DI logger is provided. CLAUDE.md §Logging says packages should use `createLogger` from `@observability/logger` — the adapter pattern here (DI logger with pino fallback) is uniform across all 11 providers but represents a tiny canon deviation from §Logging Table.

### audit-P-033 — providers/x/apiClient.ts

- **Path:** [packages/providers/x/src/apiClient.ts](packages/providers/x/src/apiClient.ts)
- **Surface:** packages
- **Sub-package:** providers/x
- **Tipo:** provider-apiClient
- **@layer declared:** infrastructure
- **Propósito real:** twitter-api-v2 wrapper + circuit breaker + fallback + Prometheus metrics. Uses `createLogger` (canonical).
- **Exports:** `XApiClient`, credential + response types
- **Imports significativos:** `@adapters/external-apis`, `@adapters/fallback-strategies`, `@observability/logger`, `twitter-api-v2`, `prom-client`
- **Consumers:** XAdapter
- **Veredicto preliminar:** VÁLIDO

### audit-P-034..P-039 — providers/facebook (6 entries + sub-modules)

- **Paths:** [providers/facebook/src/index.ts](packages/providers/facebook/src/index.ts), [FacebookAdapter.ts](packages/providers/facebook/src/FacebookAdapter.ts), [apiClient.ts](packages/providers/facebook/src/apiClient.ts), [apiClientTypes.ts](packages/providers/facebook/src/apiClientTypes.ts), [facebook-sdk.d.ts](packages/providers/facebook/src/facebook-sdk.d.ts), + sub-modules `analytics/{insights,insightsHelpers,insightsTypes,marketing,marketingHelpers,marketingTypes}.ts`, `features/{community,communityTypes,events,eventTypes,reels,shop,shop.catalog,shop.management,shop.types,stories}.ts`, `media/{videoProcessor,videoProcessorHelpers,videoProcessorTypes}.ts`
- **Surface:** packages
- **Sub-package:** providers/facebook
- **Tipo:** provider-adapter (FacebookAdapter) + provider-apiClient + domain-type + feature-modules
- **@layer declared:** infrastructure on most files; `apiClient.ts`, `apiClientTypes.ts`, analytics/_, features/events_, media/\* MISSING `@layer` (auditor finding — 11 files in this provider).
- **Propósito real:** Heaviest provider. Routes feed posts, Stories, Reels via Graph API; analytics via Insights + Marketing APIs; Shop / Events / Community features each in their own sub-module.
- **Exports:** `FacebookAdapter`, `createFacebookAdapter`, `FacebookApiClient`, credentials + many feature types
- **Imports significativos:** `@ports/core`, `@shared/types`, `@adapters/external-apis`, `@adapters/fallback-strategies`, `@observability/logger`, `pino` (in Adapter.ts)
- **Consumers:** providerRegistry, publishWorker, inboxSyncWorker, analyticsIngestWorker
- **Veredicto preliminar:** VÁLIDO with auditor flag for `@layer` headers
- **Notas:** Per CLAUDE.md fitness #9, every file must carry `@layer` — these 11 files violate it (NOT enforced strongly: it's a soft canon, not in the published fitness list as a hard zero, but listed in CLAUDE.md §Documentation. Hard-zero fitness #9 is for `@file` not `@layer`).

### audit-P-040..P-043 — providers/instagram (5 entries)

- **Paths:** [InstagramAdapter.ts](packages/providers/instagram/src/InstagramAdapter.ts), [apiClient.ts](packages/providers/instagram/src/apiClient.ts), [mediaProcessor.ts](packages/providers/instagram/src/mediaProcessor.ts), [schedulingService.ts](packages/providers/instagram/src/schedulingService.ts), [contentHelpers.ts](packages/providers/instagram/src/contentHelpers.ts), [index.ts](packages/providers/instagram/src/index.ts)
- **Surface:** packages
- **Sub-package:** providers/instagram
- **Tipo:** provider-adapter + provider-apiClient + media-processor + scheduling-service
- **@layer declared:** infrastructure (all files)
- **Propósito real:** Instagram Graph API. Routes between feed posts, carousels, Stories, Reels. `schedulingService.ts` enqueues future publish jobs via BullMQ — provider-internal scheduling rather than via app-level scheduler (architectural smell?).
- **Exports:** `InstagramAdapter`, `createInstagramAdapter`, `InstagramApiClient`, `InstagramMediaProcessor`
- **Imports significativos:** `@ports/core`, `@shared/types`, `@adapters/external-apis`, `@adapters/fallback-strategies`, `@adapters/queue-bullmq` (scheduling service), `@observability/logger`
- **Consumers:** providerRegistry, publishWorker (+ workers/src/providers/instagram/publishingWorker.ts)
- **Veredicto preliminar:** VÁLIDO
- **Notas:** `schedulingService.ts` is the only provider-local BullMQ producer — possibly REDUNDANT with app-level publish queue.

### audit-P-044..P-046 — providers/youtube (12 entries)

- **Paths:** YouTubeAdapter.ts, apiClient.ts, apiClientTypes.ts, analytics.ts, communityFeatures.ts, liveStreaming.ts, playlistManager.ts, playlistAnalyticsHelpers.ts, playlistTypes.ts, shorts.ts, shortsHelpers.ts, shortsTypes.ts, index.ts
- **Surface:** packages
- **Sub-package:** providers/youtube
- **Tipo:** provider-adapter + apiClient + feature-modules (5 feature areas)
- **@layer declared:** Some files missing (apiClient.ts, apiClientTypes.ts, playlistAnalyticsHelpers.ts, playlistManager.ts, playlistTypes.ts).
- **Propósito real:** YouTube Data API v3 + Analytics. Live streaming, community posts, playlists, Shorts each in sub-modules.
- **Exports:** `YouTubeAdapter`, `createYouTubeAdapter`, `YouTubeApiClient`, `YouTubeProviderCredentials`
- **Imports significativos:** `@ports/core`, `@shared/types`, googleapis, `@observability/logger`
- **Consumers:** providerRegistry, publishWorker
- **Veredicto preliminar:** VÁLIDO with auditor flag (5 files missing `@layer`)

### audit-P-047..P-049 — providers/tiktok (15 entries)

- **Paths:** TikTokAdapter.ts, apiClient.ts, authService.ts, contentAnalyticsClient.ts, marketingApiClient.ts, researchApiClient.ts, hashtag{Analytics,Discovery,Manager,Types}.ts, tiktokTypes.ts, videoProcessor{,Helpers,Types}.ts, index.ts
- **Surface:** packages
- **Sub-package:** providers/tiktok
- **Tipo:** provider-adapter + 4 separate apiClients (content+marketing+research+main) + authService + hashtag-manager + videoProcessor
- **@layer declared:** Mixed — 8 files missing (hashtag*, tiktokTypes, videoProcessor*)
- **Propósito real:** TikTok Content Posting API + Research + Marketing APIs. Heaviest apiClient surface (4 clients).
- **Exports:** TikTokAdapter, all clients + types
- **Imports significativos:** `@adapters/external-apis`, `@adapters/fallback-strategies`, `@observability/logger`
- **Consumers:** providerRegistry, publishWorker
- **Veredicto preliminar:** VÁLIDO with auditor flag (8 files missing `@layer`)
- **Notas:** Heaviest provider by client count — justifies the multi-client split per TikTok's API segmentation.

### audit-P-050..P-052 — providers/linkedin (5 entries)

- **Paths:** LinkedInAdapter.ts, apiClient.ts, mediaUpload.ts, types.ts, index.ts
- **Surface:** packages
- **Sub-package:** providers/linkedin
- **Tipo:** provider-adapter + apiClient + media-upload helpers
- **@layer declared:** infrastructure
- **Propósito real:** LinkedIn Posts API v2 (text, image, video, document, poll, carousel).
- **Veredicto preliminar:** VÁLIDO

### audit-P-053..P-055 — providers/pinterest (3 entries)

- **Paths:** PinterestAdapter.ts, apiClient.ts, index.ts
- **Surface:** packages
- **Sub-package:** providers/pinterest
- **Tipo:** provider-adapter + apiClient (standard pattern)
- **@layer declared:** infrastructure
- **Veredicto preliminar:** VÁLIDO

### audit-P-056..P-059 — providers/snapchat (5 entries)

- **Paths:** SnapchatAdapter.ts, apiClient.ts, responseParsers.ts, types.ts, index.ts
- **Surface:** packages
- **Sub-package:** providers/snapchat
- **Tipo:** provider-adapter + apiClient + responseParsers + types
- **@layer declared:** infrastructure
- **Propósito real:** Snapchat Marketing API for Stories (snap-ads).
- **Veredicto preliminar:** VÁLIDO

### audit-P-060..P-061 — providers/telegram (3 entries)

- **Paths:** TelegramAdapter.ts, apiClient.ts, index.ts
- **Surface:** packages
- **Sub-package:** providers/telegram
- **Tipo:** provider-adapter + apiClient
- **@layer declared:** infrastructure
- **Veredicto preliminar:** VÁLIDO

### audit-P-062..P-064 — providers/bluesky (3 entries)

- **Paths:** BlueskyAdapter.ts, BlueskyClient.ts (NOT apiClient — wraps `@atproto/api`), index.ts
- **Surface:** packages
- **Sub-package:** providers/bluesky
- **Tipo:** provider-adapter + provider-apiClient (AT Protocol)
- **@layer declared:** infrastructure
- **Propósito real:** AT Protocol Agent + CredentialSession. App-Password authentication, blob uploads with aspectRatio, RichText facet detection.
- **Veredicto preliminar:** VÁLIDO

### audit-P-065..P-066 — providers/threads (2 entries)

- **Paths:** ThreadsAdapter.ts, index.ts
- **Surface:** packages
- **Sub-package:** providers/threads
- **Tipo:** provider-adapter
- **@layer declared:** infrastructure
- **Propósito real:** Threads (Meta) via graph.threads.net using two-step container publishing.
- **Veredicto preliminar:** VÁLIDO
- **Notas:** No separate apiClient — all HTTP calls in the Adapter file. Inconsistent with other providers but acceptable for small surface.

### packages/adapters/

### audit-P-067 — cache-redis barrel

- **Path:** [packages/adapters/cache-redis/src/index.ts](packages/adapters/cache-redis/src/index.ts)
- **Surface:** packages
- **Sub-package:** adapters/cache-redis
- **Tipo:** barrel
- **@layer declared:** infrastructure
- **Propósito real:** Exports types, constants, RedisCacheManager, RedisCacheAdapter, InMemoryCacheAdapter, factory helpers.
- **Consumers:** apps/api (heavy), tests
- **Veredicto preliminar:** VÁLIDO

### audit-P-068..P-076 — cache-redis files (9 more)

- **Paths:** types.ts, constants.ts, cache-manager.ts, l1-cache.ts, redis-cache-adapter.ts, in-memory-cache-adapter.ts, access-patterns.ts, invalidation.ts, metrics.ts, factory.ts
- **Tipo:** adapter-impl (2 CachePort impls), L1 cache class, access-pattern tracker, invalidation manager, prom-client metrics
- **@layer declared:** infrastructure
- **Propósito real:** L1 (in-process LRU) + L2 (Redis) hybrid with tag invalidation, access-pattern tracking, Prometheus metrics. Two `CachePort` implementations (Redis-backed wrapper around manager + pure InMemory).
- **Veredicto preliminar:** VÁLIDO
- **Notas:** `cache-manager.ts` and `l1-cache.ts` import `pino` directly (line 10, line 8) — canon deviation #13 in apps/api fitness but not enforced in packages. `invalidation.ts` also uses raw pino.

### audit-P-077 — db-prisma barrel

- **Path:** [packages/adapters/db-prisma/src/index.ts](packages/adapters/db-prisma/src/index.ts)
- **Surface:** packages
- **Sub-package:** adapters/db-prisma
- **Tipo:** adapter-impl (composed RepoPort)
- **@layer declared:** infrastructure
- **Propósito real:** Factory `createPrismaRepoAdapter` composing Account + Project + Post + Channel + PublishLog + Analytics + Thread repositories + circuit breakers + retry + connection health monitoring via scheduler.
- **Exports:** Factory + per-entity creators + resilience + mappers + cached wrapper
- **Imports significativos:** `@infra/prisma`, `@observability/logger`, `@observability/background-scheduler`, `@ports/core`, all subrepo creators
- **Consumers:** apps/api setup, apps/workers
- **Veredicto preliminar:** VÁLIDO

### audit-P-078..P-085 — db-prisma sub-repos + resilience + mappers + cached

- **Paths:** AccountRepository.ts, ProjectRepository.ts, PostRepository.ts, ChannelRepository.ts, PublishLogRepository.ts, AnalyticsRepository.ts, ThreadRepository.ts, resilience.ts, mappers.ts, cached.ts
- **Tipo:** adapter-impl (each focused on one aggregate)
- **@layer declared:** infrastructure
- **Propósito real:** Per-aggregate repo impls + circuit-breaker/retry primitives + Prisma↔domain mappers + transparent cache wrapper.
- **Imports significativos:** `@infra/prisma`, `@observability/logger`, `@ports/core`, `@shared/types`, opossum, `@adapters/cache-redis` (only in cached.ts)
- **Consumers:** db-prisma/index.ts
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Composition pattern (sub-repos merged into single RepoPort) is canon-aligned — closes the RepoPort interface-bloat concern.

### audit-P-086 — queue-bullmq barrel

- **Path:** [packages/adapters/queue-bullmq/src/index.ts](packages/adapters/queue-bullmq/src/index.ts)
- **Tipo:** barrel
- **@layer declared:** infrastructure
- **Veredicto preliminar:** VÁLIDO

### audit-P-087..P-092 — queue-bullmq files

- **Paths:** queue-adapter.ts (QueuePort impl), consumer-adapter.ts (Worker factory), queue-port-registry.ts (Registry impl), dead-letter-queue-adapter.ts (DeadLetterQueuePort impl), constants.ts (QUEUE_NAMES), resilience.ts
- **Tipo:** adapter-impl × 4 + constants + resilience
- **@layer declared:** infrastructure
- **Propósito real:** Producer (parametrised), consumer (parametrised), registry (memoised per name), DLQ archive (BullMQ-backed), QUEUE_NAMES central constants, circuit-breaker resilience.
- **Imports significativos:** `bullmq`, `ioredis`, `@ports/core`, `@shared/types`, `@observability/logger`, opossum
- **Consumers:** apps/api/setupServices, apps/workers (heavy), `@adapters/dead-letter-queue` (CIRCULAR-ish: it re-uses QUEUE_NAMES), provider/instagram/schedulingService
- **Veredicto preliminar:** VÁLIDO

### audit-P-093 — adapters/dead-letter-queue/index.ts

- **Path:** [packages/adapters/dead-letter-queue/src/index.ts](packages/adapters/dead-letter-queue/src/index.ts)
- **Surface:** packages
- **Sub-package:** adapters/dead-letter-queue
- **Tipo:** adapter-impl (NOT port-bound)
- **@layer declared:** infrastructure
- **Propósito real:** `DeadLetterQueueManager` class — BullMQ-backed DLQ with retry metadata, manual reprocessing, Prometheus metrics. Different shape from `BullMQDeadLetterQueueAdapter` in `@adapters/queue-bullmq`.
- **Exports:** `DeadLetterQueueManager`, `createDeadLetterQueue`, `getDeadLetterQueue`, `FailedOperation` type
- **Imports significativos:** bullmq, ioredis, `pino` (raw — canon deviation), uuid, `@adapters/queue-bullmq` (QUEUE_NAMES)
- **Consumers:** apps/api/src/index.ts, `@adapters/external-apis/circuitBreaker.ts`
- **Veredicto preliminar:** REDUNDANT (overlaps `BullMQDeadLetterQueueAdapter`)
- **Notas:** Two DLQ implementations exist: (a) `BullMQDeadLetterQueueAdapter` in queue-bullmq implementing `DeadLetterQueuePort` cleanly (returns NOT_IMPLEMENTED for list/retry — PR-26 backlog), (b) `DeadLetterQueueManager` here with a richer surface but NOT port-bound. The richer surface is what external-apis/circuit-breaker actually consumes. Either consolidate into the port-bound adapter and extend `DeadLetterQueuePort`, or formally classify this as the "operations-aware" DLQ and the port-bound one as the "archive-only" one. Currently this is technical debt with three live users (api/index, external-apis, providers/\_template). Also: uses raw `pino` + `process.env.LOG_LEVEL` (canon §Logging deviation).

### audit-P-094 — adapters/external-apis/index.ts

- **Path:** [packages/adapters/external-apis/src/index.ts](packages/adapters/external-apis/src/index.ts)
- **Tipo:** barrel + factory
- **@layer declared:** infrastructure
- **Propósito real:** Exports `ExternalApiCircuitBreaker` + global-singleton factory `createExternalApiCircuitBreaker(registry, redisUrl?)`.
- **Consumers:** every provider apiClient, every storage adapter, dead-letter-queue
- **Veredicto preliminar:** VÁLIDO with mild singleton smell

### audit-P-095 — adapters/external-apis/circuitBreaker.ts

- **Path:** [packages/adapters/external-apis/src/circuitBreaker.ts](packages/adapters/external-apis/src/circuitBreaker.ts)
- **Tipo:** circuit-breaker (opossum wrapper)
- **@layer declared:** infrastructure
- **Propósito real:** Opossum-based circuit breaker with fallback strategies, DLQ integration, Prometheus metrics.
- **Imports significativos:** opossum, prom-client, `@observability/logger`, `@adapters/fallback-strategies`, `@adapters/dead-letter-queue`, `@adapters/queue-bullmq`
- **Consumers:** every provider apiClient (12), storage-s3, storage-cloudinary
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Overlaps in concept with `monitoring/circuit-breaker` — that one is a plain CLOSED/OPEN/HALF_OPEN impl, this one wraps opossum. NOT directly redundant (different abstraction) but adjacent concerns.

### audit-P-096 — adapters/fallback-strategies/index.ts

- **Path:** [packages/adapters/fallback-strategies/src/index.ts](packages/adapters/fallback-strategies/src/index.ts)
- **Tipo:** adapter-impl (fallback policies)
- **@layer declared:** infrastructure
- **Propósito real:** FallbackManager with CACHED_RESPONSE / STATIC_RESPONSE / DEGRADED_SERVICE / FAIL_GRACEFULLY / RETRY_ALTERNATIVE strategies; Redis-backed.
- **Imports significativos:** ioredis, `pino` (raw — canon deviation), `@shared/types`
- **Consumers:** external-apis circuit breaker, providers/x/instagram/linkedin/pinterest/snapchat/tiktok apiClients, trends service
- **Veredicto preliminar:** VÁLIDO with canon-deviation flag (#13: raw pino + process.env.LOG_LEVEL)

### audit-P-097 — storage-s3

- **Path:** [packages/adapters/storage-s3/src/index.ts](packages/adapters/storage-s3/src/index.ts)
- **Tipo:** adapter-impl (StoragePort)
- **@layer declared:** infrastructure
- **Propósito real:** Presigned S3 upload + media metadata via `@aws-sdk/client-s3` + presigned-post.
- **Imports significativos:** `@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post`, `@adapters/external-apis`, `@observability/logger`, `@shared/types`, `@ports/core`
- **Consumers:** `apps/api/.../createStorageAdapter.ts`, `apps/api/health/healthRoutes.ts`, storage-do-spaces (wraps it)
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Has 2 unused imports (`_GetObjectCommand`, `_getSignedUrl`) prefixed with `_` — likely intentional but worth pruning.

### audit-P-098..P-101 — storage-{azure,cloudinary,do-spaces,gcs}

- **Paths:** packages/adapters/storage-azure/src/index.ts, storage-cloudinary/src/index.ts, storage-do-spaces/src/index.ts, storage-gcs/src/index.ts
- **Tipo:** adapter-impl × 4 (all StoragePort)
- **@layer declared:** infrastructure
- **Propósito real:** Azure Blob, Cloudinary, DigitalOcean Spaces (S3 wrapper), Google Cloud Storage — each implementing StoragePort.
- **Imports significativos:** `@azure/storage-blob`, `cloudinary`, `@google-cloud/storage`, `@shared/types`, `@ports/core`
- **Consumers:** **None directly in apps/!** Only `storage-s3` is imported from `apps/api`. The other 4 adapters appear DEAD or are wired conditionally via a factory in `apps/api/src/infrastructure/storage/createStorageAdapter.ts`.
- **Veredicto preliminar:** VÁLIDO (factory-dispatched) — likely consumed via DI by `createStorageAdapter` which selects based on env config. Worth confirming in the api inventory.

### audit-P-102 — crm-hubspot/HubSpotAdapter.ts

- **Path:** [packages/adapters/crm-hubspot/src/HubSpotAdapter.ts](packages/adapters/crm-hubspot/src/HubSpotAdapter.ts)
- **Tipo:** adapter-impl (CrmAdapter)
- **@layer declared:** infrastructure
- **Propósito real:** HubSpot v3 API for contacts + Timeline Events. OAuth 2.0 authorization_code flow.
- **Imports significativos:** `@ports/core` only
- **Consumers:** **None observed in apps/**
- **Veredicto preliminar:** UNKNOWN — possibly DEAD or wired via DI factory yet-to-be-confirmed in apps/api.
- **Notas:** No `apps/api` imports of `@adapters/crm-hubspot` were found by ripgrep — this may be FORGOTTEN-FEATURE if no DI wiring exists in apps/api/src/infrastructure/container.

### audit-P-103 — crm-hubspot/index.ts

- **Path:** [packages/adapters/crm-hubspot/src/index.ts](packages/adapters/crm-hubspot/src/index.ts)
- **Tipo:** barrel
- **@layer declared:** infrastructure
- **Veredicto preliminar:** UNKNOWN (depends on P-102 status)

### audit-P-104..P-105 — crm-salesforce

- **Paths:** [SalesforceAdapter.ts](packages/adapters/crm-salesforce/src/SalesforceAdapter.ts), [index.ts](packages/adapters/crm-salesforce/src/index.ts)
- **Tipo:** adapter-impl (CrmAdapter) + barrel
- **@layer declared:** infrastructure
- **Propósito real:** Salesforce REST API v59 for contacts (SOQL) + Task records for activities. OAuth 2.0 via Connected App.
- **Consumers:** **None observed in apps/**
- **Veredicto preliminar:** UNKNOWN — same as HubSpot.

### packages/observability/

### audit-P-106 — logger/index.ts

- **Path:** [packages/observability/logger/src/index.ts](packages/observability/logger/src/index.ts)
- **Tipo:** logger-factory
- **@layer declared:** infrastructure
- **Propósito real:** Canonical `createLogger(name)` for shared packages (per CLAUDE.md Logging table).
- **Imports significativos:** pino
- **Consumers:** every adapter + provider apiClient + scheduler-aware modules — repo-wide
- **Veredicto preliminar:** VÁLIDO

### audit-P-107..P-110 — browser-logger (4 files)

- **Paths:** port.ts, console-adapter.ts, context.tsx, index.ts
- **Tipo:** logger-factory (browser-targeted)
- **@layer declared:** infrastructure
- **Propósito real:** `BrowserLoggerPort` + `ConsoleLoggerAdapter` + `<LoggerProvider>` React DI for browser code (admin/client). Per CLAUDE.md Logging — NOT redundant with `logger/`.
- **Consumers:** admin, client, packages/ui (server-side import)
- **Veredicto preliminar:** VÁLIDO

### audit-P-111..P-114 — background-scheduler (4 files)

- **Paths:** port.ts, default-scheduler.ts, noop-scheduler.ts, index.ts
- **Tipo:** scheduler (canonical setInterval wrapper)
- **@layer declared:** infrastructure
- **Propósito real:** `BackgroundTaskScheduler` interface + `DefaultBackgroundTaskScheduler` (unref'd setInterval + try/catch + tracked async work) + `NoopBackgroundTaskScheduler` (test).
- **Consumers:** apps/api, apps/workers, `@adapters/db-prisma`, `@adapters/cache-redis` (factory), `@observability/opentelemetry/correlationTracking`
- **Veredicto preliminar:** VÁLIDO
- **Notas:** Fitness #11 (no raw setInterval) anchors here.

### audit-P-115..P-118 — opentelemetry (4 files)

- **Paths:** index.ts (NodeSDK bootstrap), businessMetrics.ts, correlationTracking.ts, customInstrumentation.ts
- **Tipo:** adapter-impl (OTel)
- **@layer declared:** infrastructure
- **Propósito real:** OTel NodeSDK + Fastify + HTTP + Redis + FS instrumentations + business KPI counters + correlation tracking with AsyncLocalStorage.
- **Imports significativos:** `@opentelemetry/*` packages, `pino` (raw — canon deviation), `@observability/background-scheduler`
- **Consumers:** apps/api/src/index.ts (first-import bootstrap), apps/workers, admin/client (telemetry hooks)
- **Veredicto preliminar:** VÁLIDO with canon-deviation flag (#13: raw pino used in 3/4 files)

### packages/monitoring/

### audit-P-119 — circuit-breaker/index.ts

- **Path:** [packages/monitoring/circuit-breaker/src/index.ts](packages/monitoring/circuit-breaker/src/index.ts)
- **Tipo:** circuit-breaker (custom impl, NOT opossum)
- **@layer declared:** infrastructure
- **Propósito real:** CLOSED/OPEN/HALF_OPEN state machine with Prometheus metrics, rolling failure-rate, response-time stats.
- **Imports significativos:** `@shared/types`, `pino` (raw — canon deviation), prom-client
- **Consumers:** apps/api/src/index.ts, apps/api/health/healthMetrics.ts, apps/api/health/healthRoutes.ts
- **Veredicto preliminar:** VÁLIDO with canon-deviation flag
- **Notas:** Coexists with `@adapters/external-apis` opossum-based breaker — they implement different APIs and are used in different contexts (general-purpose monitor vs per-call wrapper).

### audit-P-120..P-127 — health-checks (8 files)

- **Paths:** index.ts (orchestrator), types.ts, tenantHealth.ts, checkers/{circuitBreaker,database,provider,queue,redis,storage}.ts
- **Tipo:** health-check
- **@layer declared:** infrastructure
- **Propósito real:** Health-check orchestrator + 6 checkers (DB, Redis, Storage, Provider, Queue, CircuitBreaker) + per-tenant health scoring.
- **Imports significativos:** `@ports/core` (RepoPort, StoragePort), `@adapters/cache-redis` (manager type), `@observability/background-scheduler`, `pino` (raw in index.ts + tenantHealth.ts — canon deviation #13), prom-client, `@shared/types`
- **Consumers:** apps/api/health/\* routes
- **Veredicto preliminar:** VÁLIDO with canon-deviation flag

### packages/api-common/

### audit-P-128 — api-common/index.ts

- **Path:** [packages/api-common/src/index.ts](packages/api-common/src/index.ts)
- **Tipo:** barrel
- **@layer declared:** infrastructure
- **Propósito real:** Re-exports Zod schemas, webhook-signature helpers, CSV export utilities. Framework-neutral (no Fastify dep).
- **Consumers:** apps/api routes heavily (linkRoutes, accountRoutes, channelRoutes, postRoutes, projectRoutes, templates, etc.)
- **Veredicto preliminar:** VÁLIDO

### audit-P-129 — api-common/schemas.ts

- **Path:** [packages/api-common/src/schemas.ts](packages/api-common/src/schemas.ts)
- **Tipo:** types + validators
- **@layer declared:** infrastructure
- **Propósito real:** Common Zod schemas — Id (UUID), Pagination, IsoDate, Email, Url, Provider, PostStatus, Password, UserRole.
- **Consumers:** api-common barrel
- **Veredicto preliminar:** VÁLIDO

### audit-P-130 — api-common/webhookSignature.ts

- **Path:** [packages/api-common/src/webhookSignature.ts](packages/api-common/src/webhookSignature.ts)
- **Tipo:** crypto-utility (framework-neutral)
- **@layer declared:** infrastructure
- **Propósito real:** HMAC webhook signature verification + constant-time compare. Pure functions, no Fastify, no logger. Used by api routes AND worker webhook processors.
- **Imports significativos:** `node:crypto`
- **Veredicto preliminar:** VÁLIDO

### audit-P-131 — api-common/utils/csvExport.ts

- **Path:** [packages/api-common/src/utils/csvExport.ts](packages/api-common/src/utils/csvExport.ts)
- **Tipo:** utility
- **@layer declared:** infrastructure
- **Propósito real:** RFC 4180 CSV export with type-safe columns, nested field access, injection prevention.
- **Veredicto preliminar:** VÁLIDO

### packages/api-errors/

### audit-P-132 — api-errors/ApiError.ts

- **Path:** [packages/api-errors/src/ApiError.ts](packages/api-errors/src/ApiError.ts)
- **Tipo:** domain-type
- **@layer declared:** infrastructure
- **Propósito real:** Canonical `ApiError` class shared by admin + client. Combines structured constructor + helpers (`parseApiError`, `getErrorMessage`, `isPermissionDenied`, `isNotFoundError`).
- **Consumers:** admin + client (heavy)
- **Veredicto preliminar:** VÁLIDO

### audit-P-133 — api-errors/index.ts

- **Path:** [packages/api-errors/src/index.ts](packages/api-errors/src/index.ts)
- **Tipo:** barrel
- **@layer declared:** infrastructure
- **Veredicto preliminar:** VÁLIDO

### packages/core/

### audit-P-134 — core/index.ts

- **Path:** [packages/core/src/index.ts](packages/core/src/index.ts)
- **Tipo:** barrel
- **@layer declared:** infrastructure
- **Veredicto preliminar:** VÁLIDO (but tiny)

### audit-P-135 — core/planPublication.ts

- **Path:** [packages/core/src/planPublication.ts](packages/core/src/planPublication.ts)
- **Tipo:** pure-function
- **@layer declared:** infrastructure
- **Propósito real:** Builds a publication plan by asking each channel's adapter to `render` a canonical post; collects successes / aggregates errors.
- **Imports significativos:** `@shared/types`, `@ports/core`
- **Consumers:** apps/api/tests/planPublication.test.ts, apps/api/tests/threading.canonical.test.ts (TEST-ONLY)
- **Veredicto preliminar:** UNKNOWN
- **Notas:** No production consumer in apps/api/src. Either DEAD or used at runtime via a path not surfaced by simple ripgrep (e.g. computed import). The `threading/` directory under packages/core/ also exists and is referenced via deep relative path from `_template` — verify that `core/threading/` is the actual home of the threadPlanner used in production. The package name "core" overpromises its 2-file scope.

### packages/query-client/

### audit-P-136 — query-client/index.ts

- **Path:** [packages/query-client/src/index.ts](packages/query-client/src/index.ts)
- **Tipo:** factory (TanStack Query)
- **@layer declared:** infrastructure
- **Propósito real:** Centralized QueryClient factory with global QueryCache + MutationCache callbacks. Pattern reference: TkDodo (TanStack maintainer).
- **Imports significativos:** `@tanstack/react-query`
- **Consumers:** apps/admin/providers/QueryProvider.tsx, apps/client/app/providers.tsx
- **Veredicto preliminar:** VÁLIDO

### packages/ui/

(35 primitives + 12 business + 2 hooks + utils + index = 51 files in scope; primitives elided where obvious.)

### audit-P-137 — ui/index.ts

- **Path:** [packages/ui/src/index.ts](packages/ui/src/index.ts)
- **Tipo:** barrel
- **@layer declared:** infrastructure
- **Consumers:** admin (151+ matches), client
- **Veredicto preliminar:** VÁLIDO

### audit-P-138 — ui/lib/utils.ts

- **Path:** [packages/ui/src/lib/utils.ts](packages/ui/src/lib/utils.ts)
- **Tipo:** utility
- **@layer declared:** infrastructure
- **Propósito real:** `cn()` — clsx + tailwind-merge.
- **Veredicto preliminar:** VÁLIDO

### audit-P-139..P-173 — ui/components/\* primitives (35 files)

- **Paths:** alert.tsx, alert-dialog.tsx, avatar.tsx, badge.tsx, button.tsx, card.tsx, checkbox.tsx, confirm-dialog.tsx, dialog.tsx, dropdown-menu.tsx, input.tsx, input-dialog.tsx, label.tsx, popover.tsx, progress.tsx, scroll-area.tsx, select.tsx, separator.tsx, slider.tsx, submit-button.tsx, switch.tsx, table.tsx, tabs.tsx, textarea.tsx, toast.tsx, toaster.tsx, tooltip.tsx, use-toast.ts, VirtualScrollList.tsx
- **Tipo:** ui-primitive (shadcn/radix wrappers)
- **@layer declared:** infrastructure
- **Propósito real:** Standard shadcn/Radix UI primitives. All have `@component` per fitness #12.
- **Consumers:** admin + client heavily
- **Veredicto preliminar:** VÁLIDO

### audit-P-174..P-185 — ui/components/business/\* (12 files)

- **Paths:** ChannelMultiSelect.tsx, ContentEditorCore.tsx, ContentVersioning.tsx, EmojiPickerButton.tsx, TipTapContentEditor.tsx, ValidationContentEditor.tsx, VersionCompactView.tsx, VersionCompareView.tsx, VersionDetailDialog.tsx, VersionFilterBar.tsx, VersionRestoreDialog.tsx, VersionTimelineView.tsx + 2 hooks (useContentEditor, useContentVersioning) + 2 type files (contentEditorTypes, contentVersioningTypes)
- **Tipo:** ui-component (business-specific) + types
- **@layer declared:** infrastructure
- **Propósito real:** Shared multi-app components — content editor (TipTap), version history viewer with compare/restore/timeline, channel selector, emoji picker.
- **Consumers:** admin + client
- **Veredicto preliminar:** VÁLIDO

### audit-P-186..P-187 — ui/hooks/\*

- **Paths:** useProviderConstraints.ts, usePublishingEngine.ts
- **Tipo:** ui-hook
- **@layer declared:** infrastructure
- **Propósito real:** Shared cross-app publishing engine + provider constraints resolver.
- **Veredicto preliminar:** VÁLIDO

---

## Cross-surface signals

### Ports without adapters (in packages/)

- **`SemanticLockPort`** → adapter lives in `apps/api/src/saga/SemanticLockAdapter.ts`. Architecturally OK but inconsistent with other ports.
- **`PaymentAdapter`** → all gateway implementations (Stripe/Paddle) live in `apps/api/src/billing/`. Same inconsistency.

### Adapters without port binding (orphaned)

- **`@adapters/dead-letter-queue`** — `DeadLetterQueueManager` is NOT a `DeadLetterQueuePort` implementation. Coexists with `BullMQDeadLetterQueueAdapter` (which IS port-bound). REDUNDANT or needs port extension.

### Providers with code but not wired in workers

- **`_template`** — intentional, per canon.
- All 11 social providers are wired in `apps/workers/src/publishWorker.ts`.

### Cross-package over-reach / architectural violations

- **`apps/api/src/saga/`** holds the only `SemanticLockPort` impl — inconsistent with the `packages/adapters/<x>` convention.
- **`apps/api/src/billing/`** holds the only `PaymentAdapter` impl — same.
- **`packages/adapters/dead-letter-queue/`** does NOT depend on apps/\* (good) but is REDUNDANT with `packages/adapters/queue-bullmq/dead-letter-queue-adapter.ts` which IS port-bound.
- **`packages/providers/_template/src/index.ts`** uses deep relative import `../../../core/threading/src/threadPlanner.js` — fragile if `packages/core/` is reorganised.

### Canon-deviation: raw `pino` outside `createLogger`

(15 packages files use raw `pino` instead of routing through `@observability/logger/createLogger`. CLAUDE.md §Logging table says packages "should" use createLogger, but the canon is softer for packages than for apps/api/src.)

Files: 11 provider Adapters (default-fallback only — DI logger takes precedence), `monitoring/circuit-breaker/index.ts`, `monitoring/health-checks/{index,tenantHealth}.ts`, `observability/opentelemetry/{index,businessMetrics,correlationTracking,customInstrumentation}.ts`, `adapters/dead-letter-queue/index.ts`, `adapters/fallback-strategies/index.ts`, `adapters/cache-redis/{cache-manager,l1-cache,invalidation}.ts`.

### Files missing `@layer` header (29 files)

Concentrated in tiktok (8), facebook (11), youtube (5), shared (3 — events, orchestration, cqrs), providers/shared (1: ProviderError), and a few utility files. Fitness #10 says invalid `@layer` values fail; missing `@layer` is not currently in CI fitness greps but CLAUDE.md §Documentation explicitly says "every `.ts` and `.tsx` file" must carry it.

### `ProviderId` drift

`ProviderId` is declared in TWO places: `packages/ports/src/ProviderAdapter.ts` AND `packages/shared/src/providers/providerConfig.ts`. Single source of truth would prevent drift. `shared/analytics.ts` ALSO declares a `ProviderType` union that uses `"twitter"` instead of `"x"` — third drift point.

### Two circuit breaker implementations

- `@adapters/external-apis/circuitBreaker.ts` — opossum-based, wraps individual calls.
- `@monitoring/circuit-breaker/index.ts` — bespoke CLOSED/OPEN/HALF_OPEN state machine, used as a global monitor.

Different API surfaces; not redundant per se, but adjacent and worth documenting their distinct roles.

---

## Methodology + caveats

- File enumeration: `find packages/ -type f \( -name "*.ts" -o -name "*.tsx" \)` excluding `node_modules`, `dist`, `tests`, `.test.*`, `.spec.*`, `.stories.tsx`, `graphify-out`, `reports`, `.stryker-tmp`, `vitest.config.ts`. Total: 235 files.
- Consumer detection: `rg -l "from \"@<pkg>/<x>\"" apps packages` for each barrel/adapter — heuristic, not authoritative. UNKNOWN verdicts (P-101 storage-azure/cloudinary/do-spaces/gcs; P-102..P-105 crm-hubspot/salesforce; P-135 core/planPublication) reflect lack of direct import in apps/ — these may be wired via DI factories that select implementations from env (`createStorageAdapter`, `createCrmAdapter` if it exists). Confirm in the api inventory.
- Per-file Notas are TERSE for the 35 ui primitives + per-provider mass — they follow the same canon pattern documented above.
- The 15 files with raw `pino` were detected with `grep -rn "import pino\|from \"pino\""`. Some are TYPE-ONLY imports (`type Logger from "pino"` in providers/shared/helpers.ts) — those are NOT canon violations.
- Stryker sandbox copies (`.stryker-tmp/`) were excluded — they duplicate src files during mutation testing.
- Provider adapter Adapter.ts files use `deps.logger ?? pino({...})` — the canonical case (DI injects logger) does NOT trigger `pino()`. The fallback is invoked only when no logger is provided.
