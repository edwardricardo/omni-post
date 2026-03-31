# Threads Provider Adapter Report

Date: 2026-03-31

## API Capabilities Implemented

| Capability      | Endpoint                                 | Status |
| --------------- | ---------------------------------------- | ------ |
| Text post       | POST /{userId}/threads + threads_publish | Done   |
| Image post      | POST /{userId}/threads (IMAGE type)      | Done   |
| Video post      | POST /{userId}/threads (VIDEO type)      | Done   |
| Carousel        | POST /{userId}/threads (CAROUSEL type)   | Done   |
| Reply to thread | POST with reply_to_id                    | Done   |
| Post insights   | GET /{mediaId}/insights                  | Done   |
| Read replies    | GET /{userId}/replies                    | Done   |
| DMs             | Not available — Threads has no DMs       | N/A    |

## Implementation Notes

### Two-step publishing

Threads requires creating a media container first, then publishing it. For media posts (image/video), the container must reach FINISHED status before publishing. The adapter polls with 2-second intervals, max 10 attempts.

### OAuth

Threads uses the same Meta OAuth system as Instagram. If the Meta developer app is already registered for Instagram, add the Threads product to the same app.

### Platform Profile

THREADS added to PlatformContentProfile: conversational, community-first, 500 chars, minimal hashtags (0-3). AI generates content suited to Threads norms — genuine conversation over broadcast marketing.

## Files Created

- packages/providers/threads/package.json
- packages/providers/threads/tsconfig.json
- packages/providers/threads/src/ThreadsAdapter.ts
- packages/providers/threads/src/index.ts

## Files Modified

- infra/prisma/schema.prisma — THREADS added to Provider enum
- packages/ports/src/ProviderAdapter.ts — "threads" added to ProviderId
- packages/shared/src/types.ts — THREADS added to ProviderName
- packages/shared/src/providers/providerConfig.ts — "threads" added to ProviderId
- packages/adapters/db-prisma/src/mappers.ts — THREADS added to Provider + AppProvider types
- apps/api/src/providers/providerRegistry.ts — threadsAdapter registered
- apps/api/src/providers/providerCapabilityManager.ts — threads reach estimate added
- apps/api/src/auth/providerOAuthConfigs.ts — threads OAuth placeholder added
- apps/workers/src/publishWorker.ts — threadsAdapter added to worker registry
- apps/api/src/domain/ai/PlatformContentProfile.ts — THREADS profile added
- tsconfig.base.json — @providers/threads path alias added

## Build and Test

| Check                   | Result                            |
| ----------------------- | --------------------------------- |
| TypeScript build        | 0 errors, 9/9 tasks               |
| All tests               | 351 files, 7,159 passed, 0 failed |
| Architecture boundaries | Clean                             |

OmniPost now supports 11 social platforms.
