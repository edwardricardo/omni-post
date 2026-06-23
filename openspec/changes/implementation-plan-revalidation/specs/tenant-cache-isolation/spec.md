# Tenant Cache Isolation — Specification (§2B confirmed-fix end state)

> The END STATE the confirmed §2B cache cross-tenant fixes MUST satisfy. Two
> distinct sites, one root pattern (cache key omits accountId). Applies only to
> leads Phase A confirmed. RFC 2119 keywords are normative.

## Requirements

### Requirement: HTTP response cache keys are tenant-scoped

The `autoCache` HTTP response cache MUST include the caller's `accountId` in the
cache key on every tenant-scoped (client-portal) route. A cache entry written by
one tenant MUST NOT be served to another tenant (CACHE-XTENANT-HTTP).

#### Scenario: No cross-tenant HTTP cache hit

- GIVEN tenant A requests a cacheable client-portal route, populating the cache
- WHEN tenant B requests the same route path
- THEN tenant B does not receive tenant A's cached response; the response reflects tenant B's own data

#### Scenario: Same-tenant cache still hits

- GIVEN tenant A populated the cache for a route
- WHEN tenant A re-requests the same route within TTL
- THEN the cached response is served (caching is not disabled, only correctly keyed)

### Requirement: AI cache keys are tenant-scoped

The AI response cache key MUST include `accountId`, so an AI response computed for
one tenant is never returned to another (CACHE-XTENANT-AI).

#### Scenario: No cross-tenant AI cache collision

- GIVEN tenant A triggers an AI generation that is cached
- WHEN tenant B issues an equivalent request that would hash to the old key
- THEN tenant B receives its own computed result, not tenant A's cached AI response
