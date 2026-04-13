# OmniPost -- Social Platform Integrations API Reference

## Overview

OmniPost integrates with 11 social media platforms through a unified adapter pattern. Each provider implements the `AbstractProviderAdapter<TCredentials>` base class, providing consistent interfaces for content rendering, publishing, threading, analytics fetching, and credential management. The API layer exposes provider queries via REST endpoints, while a capability manager scores and matches providers to content requirements.

---

## Provider Registry & Service (`apps/api/src/providers/`)

### ProviderRegistryService

**File:** `apps/api/src/providers/providerRegistry.ts`
**Layer:** infrastructure
**Description:** API-side registry managing metadata and runtime adapter instances for all 11 social media providers. Uses centralized configuration from `@shared/types/providerConfig`.

#### Methods

| Method                     | Signature                                              | Returns                                                    | Description                                                 |
| -------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------- |
| `getProvider`              | `(id: string): ProviderMetadata \| undefined`          | `ProviderMetadata \| undefined`                            | Get provider metadata from centralized config               |
| `getAdapter`               | `(id: string): ProviderAdapter \| undefined`           | `ProviderAdapter \| undefined`                             | Get runtime adapter instance                                |
| `getAllProviders`          | `(): ProviderMetadata[]`                               | `ProviderMetadata[]`                                       | All 11 providers from PROVIDER_CONFIGS                      |
| `getActiveProviders`       | `(): ProviderMetadata[]`                               | `ProviderMetadata[]`                                       | Only providers with status "active"                         |
| `getProvidersByCapability` | `(capability): ProviderMetadata[]`                     | `ProviderMetadata[]`                                       | Filter by specific capability flag                          |
| `getProvidersWithAdapters` | `(): ProviderMetadata[]`                               | `ProviderMetadata[]`                                       | Providers that have adapter implementations                 |
| `registerAdapter`          | `(providerId, adapter): void`                          | `void`                                                     | Register adapter for an existing provider                   |
| `checkProviderHealth`      | `(id): Promise<{ healthy, latency?, error? }>`         | `{ healthy: boolean; latency?: number; error?: string }`   | Health check via dummy credential validation                |
| `checkAllProvidersHealth`  | `(): Promise<Map<string, HealthResult>>`               | `Map<string, { healthy, latency?, error? }>`               | Batch health check for all registered adapters              |
| `validateContent`          | `(providerId, content, mediaCount?): ValidationResult` | `{ valid: boolean; errors: string[]; warnings: string[] }` | Validate content against provider limits                    |
| `getCharLimit`             | `(providerId): number`                                 | `number`                                                   | Character limit for a provider (default: 280)               |
| `getMediaLimits`           | `(providerId): ProviderLimits \| undefined`            | `ProviderLimits \| undefined`                              | Full media limits object                                    |
| `supportsCapability`       | `(providerId, capability): boolean`                    | `boolean`                                                  | Check single capability support                             |
| `needsThreading`           | `(providerId, content): boolean`                       | `boolean`                                                  | Whether content exceeds limit and provider supports threads |
| `calculateThreadSize`      | `(providerId, content): number`                        | `number`                                                   | Number of posts needed for threading                        |

**Has JSDoc:** &#9989; (all public methods)

---

### ProviderService

**File:** `apps/api/src/providers/providerService.ts`
**Layer:** infrastructure
**Description:** Business logic service handling provider queries, content validation, and connection management. Queries the Channel table for project connections.

#### Methods

| Method                        | Signature                                                          | Returns                                            | Description                                        |
| ----------------------------- | ------------------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------- |
| `getAllProviders`             | `(): Promise<{ providers, total }>`                                | `{ providers: ProviderMetadata[]; total: number }` | All registered providers                           |
| `getActiveProviders`          | `(): Promise<{ providers, total }>`                                | `{ providers: ProviderMetadata[]; total: number }` | Active providers only                              |
| `getProvidersByCapability`    | `(capability): Promise<{ capability, providers, total }>`          | Filtered provider list                             | Filter by capability                               |
| `getProviderById`             | `(providerId): Promise<ProviderMetadata \| null>`                  | `ProviderMetadata \| null`                         | Single provider lookup                             |
| `validateProviderConstraints` | `(providerId, content): Promise<Result<ValidationResult, string>>` | `Result<{ valid, errors? }, string>`               | Text length, media count, media type validation    |
| `getProviderConfig`           | `(providerId): Promise<ProviderConfig>`                            | `{ id, name, displayName, capabilities, limits }`  | Provider configuration and limits                  |
| `getConnectionsByProjectId`   | `(projectId): Promise<ProviderConnectionInfo[]>`                   | `ProviderConnectionInfo[]`                         | Channel-based connections with lastUsed timestamps |

**Has JSDoc:** &#9989; (all public methods)

---

### Provider Routes

**File:** `apps/api/src/providers/providerRoutes.ts`
**Layer:** infrastructure
**Description:** REST API endpoints for querying provider capabilities, connections, content validation, and health checks.

#### Routes

| Method | Path                                   | Auth   | Description                                                          |
| ------ | -------------------------------------- | ------ | -------------------------------------------------------------------- |
| `GET`  | `/providers`                           | None   | Get all providers                                                    |
| `GET`  | `/providers/active`                    | Client | Get active providers                                                 |
| `GET`  | `/providers/by-capability/:capability` | Client | Filter by capability (publish, schedule, analytics, threading, etc.) |
| `GET`  | `/providers/:id`                       | Client | Get provider details by ID                                           |
| `GET`  | `/providers/:id/health`                | Client | Health check for specific provider                                   |
| `GET`  | `/providers/health/all`                | Client | Health check for all providers (summary + per-provider)              |
| `GET`  | `/providers/connections/:projectId`    | Client | Get provider connections for a project                               |

**Valid Capabilities:** `publish`, `schedule`, `analytics`, `comments`, `replies`, `threading`, `stories`, `reels`, `carousel`

**Has JSDoc:** &#9989; (all handler methods)

---

### ProviderCapabilityManager

**File:** `apps/api/src/providers/providerCapabilityManager.ts`
**Layer:** infrastructure
**Description:** Advanced capability matching engine that scores providers against content requirements, checks content compatibility, generates capability matrices, and suggests optimal provider combinations for cross-platform publishing.

#### Methods

| Method                        | Signature                                                      | Returns                          | Description                                                     |
| ----------------------------- | -------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------- |
| `registerProvider`            | `(provider): void`                                             | `void`                           | Register provider with capability manager                       |
| `unregisterProvider`          | `(providerId): void`                                           | `void`                           | Remove provider                                                 |
| `getAllProviders`             | `(): ProviderAdapter[]`                                        | `ProviderAdapter[]`              | All registered providers                                        |
| `getProvidersByCapability`    | `(capability): ProviderAdapter[]`                              | `ProviderAdapter[]`              | Filter by capability                                            |
| `getCompatibleProviders`      | `(query: CapabilityQuery): ProviderScore[]`                    | `ProviderScore[]`                | Score providers against requirements, sorted by score           |
| `checkContentCompatibility`   | `(content, targetProviders?): Promise<ContentCompatibility[]>` | `ContentCompatibility[]`         | Per-provider compatibility with limitations and suggestions     |
| `getCapabilityMatrix`         | `(): CapabilityMatrix`                                         | `{ [capability]: ProviderId[] }` | Matrix showing which providers support which capabilities       |
| `getCapabilityStatistics`     | `(): CapabilityStats`                                          | Aggregated statistics            | Total providers, support counts, averages, most/least supported |
| `suggestProviderCombinations` | `(query): ProviderId[][]`                                      | `ProviderId[][]`                 | Optimal 1/2/3-provider combinations with overlap avoidance      |

#### Scoring System

- Required capability match: +10 points
- Optional capability match: +5 points
- Missing required capability: score = 0 (incompatible)
- Active status: +2, Beta: -1, Maintenance: -5, Deprecated: -10
- Missing media/threading/scheduling/analytics: -4 to -10

**Has JSDoc:** &#9989; (all public methods)

---

## Abstract Provider Adapter (`packages/providers/shared/`)

### AbstractProviderAdapter<TCredentials>

**File:** `packages/providers/shared/src/AbstractProviderAdapter.ts`
**Layer:** infrastructure (shared)
**Description:** Base class for all 11 provider adapters. Enforces a consistent implementation pattern with abstract properties and methods, while providing common functionality for credential management, media upload with retry, error mapping, and content validation.

#### Abstract Properties (implemented by each provider)

| Property       | Type                   | Description                                                      |
| -------------- | ---------------------- | ---------------------------------------------------------------- |
| `id`           | `ProviderId`           | Provider identifier (e.g., "x", "instagram")                     |
| `limits`       | `ProviderLimits`       | `{ maxChars, maxMediaPerPost, allowedMedia }`                    |
| `capabilities` | `ProviderCapabilities` | `{ publish, schedule, analytics, comments, replies, threading }` |
| `metadata`     | `ProviderMetadata`     | Display name, status, auth types                                 |
| `constraints`  | `ProviderConstraints`  | Provider-specific constraints                                    |

#### Abstract Methods (implemented by each provider)

| Method                          | Signature                                                              | Description                                          |
| ------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------- |
| `render`                        | `(canonical: CanonicalPost): Result<RenderedContent, RenderError>`     | Transform canonical post to provider-specific format |
| `publish`                       | `(input: PublishInput): Promise<Result<PublishReceipt, PublishError>>` | Publish content to the platform                      |
| `getCredentialsFromEnvironment` | `(): Result<TCredentials, "AUTH">`                                     | Load credentials from env vars                       |
| `createApiClient`               | `(credentials: TCredentials): unknown`                                 | Create authenticated API client                      |

#### Optional Methods (overridden by providers that support them)

| Method            | Signature                                                        | Description                        |
| ----------------- | ---------------------------------------------------------------- | ---------------------------------- |
| `planThread?`     | `(canonical): Result<ThreadPlan, ThreadError>`                   | Split content into thread segments |
| `publishThread?`  | `(input): Promise<Result<ThreadReceipt, PublishError>>`          | Publish a multi-part thread        |
| `fetchAnalytics?` | `(query): Promise<Result<unknown, "AUTH" \| "NETWORK">>`         | Fetch platform analytics data      |
| `handleWebhook?`  | `(payload): Promise<Result<unknown, "IGNORE" \| "PARSE_ERROR">>` | Process incoming webhooks          |

#### Concrete Methods (inherited by all providers)

| Method                   | Signature                                                               | Returns                                                                      | Description                                                             |
| ------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `validateCredentials`    | `(creds): Promise<Result<void, "AUTH_INVALID" \| "AUTH_EXPIRED">>`      | `Result<void, ...>`                                                          | Validates credential structure and tests with API                       |
| `validateContent`        | `(canonical, config?): Promise<ContentValidationResult>`                | `ContentValidationResult`                                                    | Character limit, media count/type validation with suggestions           |
| `generatePreview`        | `(canonical, config?): Promise<ProviderPreview>`                        | `ProviderPreview`                                                            | Preview with character usage, media, threading info                     |
| `adaptContent`           | `(canonical, targetProvider): Promise<Result<CanonicalPost, ...>>`      | `Result<CanonicalPost, "ADAPTATION_FAILED">`                                 | Content adaptation for cross-posting                                    |
| `healthCheck`            | `(config?): Promise<Result<HealthResult, "HEALTH_CHECK_FAILED">>`       | `Result<{ healthy, latency?, quotaRemaining? }, ...>`                        | Provider health check                                                   |
| `getAccountInfo`         | `(config): Promise<Result<AccountInfo, "AUTH" \| "NETWORK">>`           | `Result<{ id, name, username?, profileImage?, verified?, followers? }, ...>` | Fetch account details                                                   |
| `uploadMediaWithRetry`   | `(url, uploadFn, options?): Promise<Result<MediaUploadResult, ...>>`    | `Result<MediaUploadResult, "MEDIA_UPLOAD_FAILED">`                           | Retry with exponential backoff (default 3 attempts)                     |
| `uploadMediaBatch`       | `(urls, uploadFn, options?): Promise<Result<MediaUploadResult[], ...>>` | `Result<MediaUploadResult[], "MEDIA_UPLOAD_FAILED">`                         | Sequential batch upload                                                 |
| `mapErrorToPublishError` | `(error): PublishError`                                                 | `PublishError`                                                               | Maps HTTP status to typed error (RATE_LIMIT, AUTH, VALIDATION, NETWORK) |

**Has JSDoc:** &#9989;

---

## Provider Adapters (11 Platforms)

### X (Twitter)

**File:** `packages/providers/x/src/XAdapter.ts`
**API Client:** `packages/providers/x/src/apiClient.ts`
**Capabilities:** publish, schedule, analytics, comments, replies, threading

### Instagram

**File:** `packages/providers/instagram/src/InstagramAdapter.ts`
**API Client:** `packages/providers/instagram/src/apiClient.ts`
**Supporting:** `mediaProcessor.ts`, `contentHelpers.ts`, `publishingWorker.ts`, `schedulingService.ts`
**Capabilities:** publish, schedule, analytics, comments, stories, reels, carousel

### Facebook

**File:** `packages/providers/facebook/src/FacebookAdapter.ts`
**API Client:** `packages/providers/facebook/src/apiClient.ts`
**Features:**

- Analytics: `analytics/insights.ts`, `analytics/marketing.ts`
- Community: `features/community.ts`
- Events: `features/events.ts`
- Reels: `features/reels.ts`
- Stories: `features/stories.ts`
- Shop: `features/shop.ts`, `features/shop.catalog.ts`, `features/shop.management.ts`
- Video: `media/videoProcessor.ts`

**Capabilities:** publish, schedule, analytics, comments, replies, stories, reels, carousel

### TikTok

**File:** `packages/providers/tiktok/src/TikTokAdapter.ts`
**API Client:** `packages/providers/tiktok/src/apiClient.ts`
**Supporting:**

- `authService.ts` -- TikTok-specific OAuth
- `videoProcessor.ts` + `videoProcessorHelpers.ts` -- Video processing pipeline
- `contentAnalyticsClient.ts` -- Content performance analytics
- `hashtagManager.ts`, `hashtagAnalytics.ts`, `hashtagDiscovery.ts` -- Hashtag management
- `marketingApiClient.ts` -- Marketing API integration
- `researchApiClient.ts` -- Research API integration

**Capabilities:** publish, schedule, analytics, comments

### YouTube

**File:** `packages/providers/youtube/src/YouTubeAdapter.ts`
**API Client:** `packages/providers/youtube/src/apiClient.ts`
**Features:**

- Analytics: `analytics.ts`
- Shorts: `shorts.ts` + `shortsHelpers.ts`
- Live Streaming: `liveStreaming.ts`
- Playlists: `playlistManager.ts` + `playlistAnalyticsHelpers.ts`
- Community: `communityFeatures.ts`

**Capabilities:** publish, schedule, analytics, comments, replies, liveStreaming

### LinkedIn

**File:** `packages/providers/linkedin/src/LinkedInAdapter.ts`
**API Client:** `packages/providers/linkedin/src/apiClient.ts`
**Types:** `packages/providers/linkedin/src/types.ts`
**Capabilities:** publish, schedule, analytics, comments

### Snapchat

**File:** `packages/providers/snapchat/src/SnapchatAdapter.ts`
**API Client:** `packages/providers/snapchat/src/apiClient.ts`
**Supporting:** `responseParsers.ts`
**Capabilities:** publish, schedule, analytics, stories

### Telegram

**File:** `packages/providers/telegram/src/TelegramAdapter.ts`
**API Client:** `packages/providers/telegram/src/apiClient.ts`
**Capabilities:** publish, schedule, analytics

### Pinterest

**File:** `packages/providers/pinterest/src/PinterestAdapter.ts`
**API Client:** `packages/providers/pinterest/src/apiClient.ts`
**Capabilities:** publish, schedule, analytics

### Bluesky

**File:** `packages/providers/bluesky/src/BlueskyAdapter.ts`
**Client:** `packages/providers/bluesky/src/BlueskyClient.ts`
**Capabilities:** publish, analytics, threading

### Threads (Meta)

**File:** `packages/providers/threads/src/ThreadsAdapter.ts`
**Capabilities:** publish, analytics, threading

---

## Provider OAuth (`apps/api/src/auth/`)

| File                       | Description                                                         |
| -------------------------- | ------------------------------------------------------------------- |
| `providerOAuth.ts`         | Orchestrates OAuth flow for social provider connections             |
| `providerOAuthFlow.ts`     | Redirect and callback handling for OAuth dance                      |
| `providerOAuthConfigs.ts`  | Per-provider OAuth configuration (scopes, authorization/token URLs) |
| `enhancedOAuthProvider.ts` | Enhanced OAuth with automatic token refresh and error recovery      |

---

## Provider Adapter Interface

**File:** `apps/api/src/providers/providerAdapter.interface.ts`
**Description:** TypeScript interface defining the contract all provider adapters must satisfy. Includes `ProviderAdapter`, `ProviderCapabilities`, `ProviderId` types.

---

## Shared Provider Infrastructure

### ProviderError

**File:** `packages/providers/shared/src/ProviderError.ts`
**Description:** Typed error class for provider-specific failures with error codes and metadata.

### ProviderUtils

**File:** `packages/providers/shared/src/AbstractProviderAdapter.ts` (exported class)
**Description:** Utility functions for media ID generation, error message extraction, placeholder detection, and URL sanitization.

| Method                | Signature                      | Description                                    |
| --------------------- | ------------------------------ | ---------------------------------------------- |
| `generateMediaId`     | `(providerId: string): string` | Generates `{providerId}_{uuid}` identifiers    |
| `extractErrorMessage` | `(error: unknown): string`     | Safe error message extraction                  |
| `hasPlaceholders`     | `(credentials): boolean`       | Detects placeholder or empty credential values |
| `sanitizeUrl`         | `(url: string): string`        | Strips access_token/api_key/secret from URLs   |

---

## Capability Reference

| Capability       | Providers                                                                        |
| ---------------- | -------------------------------------------------------------------------------- |
| `publish`        | All 11                                                                           |
| `schedule`       | X, Instagram, Facebook, TikTok, YouTube, LinkedIn, Snapchat, Telegram, Pinterest |
| `analytics`      | All 11                                                                           |
| `comments`       | X, Instagram, Facebook, TikTok, YouTube, LinkedIn                                |
| `replies`        | X, Instagram, Facebook, YouTube                                                  |
| `threading`      | X, Bluesky, Threads                                                              |
| `stories`        | Instagram, Facebook, Snapchat                                                    |
| `reels`          | Instagram, Facebook                                                              |
| `carousel`       | Instagram, Facebook                                                              |
| `liveStreaming`  | YouTube                                                                          |
| `directMessages` | (none currently active)                                                          |

---

## Key Implementation Notes

- **Unified adapter pattern:** All 11 providers extend `AbstractProviderAdapter<TCredentials>` ensuring consistent render/publish/validate interfaces
- **Credential resolution:** Database first (via Channel credentials JSON field), environment variables as fallback
- **Media upload:** Exponential backoff retry (3 attempts, 2/4/8 second delays)
- **Error mapping:** HTTP status codes mapped to typed errors: 429 -> RATE_LIMIT, 401/403 -> AUTH, 4xx -> VALIDATION, 5xx -> NETWORK
- **Content validation:** Provider-specific limits enforced before publishing (character count, media count, media types)
- **Threading:** Automatic detection when content exceeds `maxChars` and provider supports threading
- **Health checks:** Per-provider health check via dummy credential validation (measures latency)
- **Singleton adapters:** Each provider adapter is instantiated once and registered in the ProviderRegistryService
