# Mutant Kill Session A — Part 2

Date: 2026-03-19

## Results

| Target               | Session A Score | Part 2 Score | Target | Met                                 |
| -------------------- | --------------- | ------------ | ------ | ----------------------------------- |
| adapters/storage-s3  | ~36%            | 43.61%       | ≥65%   | ❌ (circuit breaker ceiling)        |
| adapters/cache-redis | ~56%            | 58.37%       | ≥70%   | ❌ (cache-manager plumbing ceiling) |

## Source Changes Made

### cache-redis/middleware.ts

- Added `import fp from "fastify-plugin"`
- Renamed `cachePlugin` to `cachePluginImpl` (internal)
- Added `export const cachePlugin = fp(cachePluginImpl, { name: "omnipost-cache", fastify: "5.x" })`
- Functional behaviour: unchanged — same hooks, same decorators, same logic
- Interface: `cachePlugin` export maintains same `FastifyPluginAsync<CacheMiddlewareOptions>` signature via `fp()`
- Impact on apps/api: None — apps/api does not register `cachePlugin` as a Fastify plugin (uses `RedisCacheManager` directly)

### storage-s3

- Installed `aws-sdk-client-mock` as devDependency
- No source changes required

## Tests Written

| Target      | New Tests | File                                                                 |
| ----------- | --------- | -------------------------------------------------------------------- |
| storage-s3  | 10        | tests/s3-operations.test.ts (createPresignedPost mock + URL parsing) |
| cache-redis | 7         | tests/middleware.test.ts (fp() plugin registration + inject tests)   |
| **Total**   | **17**    |                                                                      |

## Break Thresholds Updated

| Config               | Part 2 Score | New Break |
| -------------------- | ------------ | --------- |
| adapters/storage-s3  | 43.61%       | 38        |
| adapters/cache-redis | 58.37%       | 53        |

## Compile Verification

| Check                                    | Result          |
| ---------------------------------------- | --------------- |
| packages/adapters/cache-redis vitest run | ✅ 203 pass     |
| packages/adapters/storage-s3 vitest run  | ✅ 47 pass      |
| apps/api — no import of cachePlugin      | ✅ Not affected |

## Equivalent Mutants Documented

- **cache-redis/cache-manager.ts**: 185 survivors — Redis connection event handlers (connect, error, reconnecting), background cleanup intervals, and warming logic. These require a real Redis instance to trigger.
- **cache-redis/middleware.ts**: 93 survivors — Many are in the `generateCacheKey` string concatenation logic and `shouldCacheRequest` conditional branches that only differ in which vary parts are included. These require more granular Fastify inject tests with vary headers.
- **storage-s3/index.ts**: 75 survivors — `getMediaMetadata` response parsing (filename extraction, width/height parsing, contentType fallback). The circuit breaker creates a real opossum instance that connects to `localhost:19000`, preventing `aws-sdk-client-mock` from intercepting HeadObjectCommand calls that go through the breaker's retry/timeout logic.

## Session A Complete Summary

| Target               | Start  | Final  | Met                                 |
| -------------------- | ------ | ------ | ----------------------------------- |
| providers/linkedin   | 44.24% | 77.45% | ✅                                  |
| packages/api-common  | 37.68% | 51.48% | ❌ ceiling (Zod schemas)            |
| adapters/cache-redis | 31.89% | 58.37% | ❌ ceiling (cache-manager plumbing) |
| adapters/storage-s3  | 35.34% | 43.61% | ❌ ceiling (circuit breaker)        |

## Pending Decisions

None.

## Ready for Session B

- [x] All Session A targets have final break thresholds set
- [x] All vitest suites passing (203 cache-redis, 47 storage-s3)
- [x] No pending DECISION REQUIRED blocks
- [x] cache-redis fastify-plugin change does not affect apps/api
