# Caching Architecture

> Single source of truth for the **why** behind the project's caching choices. CLAUDE.md states the rules; this doc explains the reasoning so future contributors can extend the pattern correctly without breaking cross-pod coherence or test isolation.

---

## TL;DR — one port, two adapters, one shared manager

```text
┌──────────────────────────────────────────────────────────────────────┐
│  apps/api/src/**            → resolve `TOKENS.CachePort` from DI     │
│  packages/**                  callers depend on the port abstraction │
│                                                                      │
│  TOKENS.CachePort           → RedisCacheAdapter                      │
│                               (wraps the singleton RedisCacheManager)│
│                                                                      │
│  Tests                      → InMemoryCacheAdapter                   │
│                               (no I/O, deterministic, per-test scope)│
└──────────────────────────────────────────────────────────────────────┘
```

Direct construction of a per-class `Map<>` cache, or instantiation of `RedisCacheManager` outside the composition root, is forbidden by the CI fitness grep for cache anti-patterns. The port IS the abstraction.

---

## Why a port instead of using `RedisCacheManager` directly

Edward asked the same question. The answer is **scope of consumer coupling**.

### Consumers don't need the full manager surface

`RedisCacheManager` exposes 12+ methods: `get`, `set`, `del`, `getOrSet`, `invalidate`, `invalidateByTag`, `invalidateByPattern`, `invalidateByDependencies`, `getStats`, `flush`, `warmCache`, `healthCheck`, `has`, plus options for compression, dependency graphs, smart invalidation strategies, and access pattern tracking. Most callers need exactly six: `get`, `set`, `getOrSet`, `delete`, `invalidateByTag`, `has`.

The CachePort narrows that surface so consumers can be tested with a 90-line in-memory adapter instead of mocking 200+ lines of metrics, L1 LRU eviction, and access-pattern tracking. That maps directly to what BentoCache, PettyCache, and OneUptime's multi-layer caching guide call out as canonical: a small invocation API with the L1+L2 + stampede + tagging mechanics behind the abstraction.

### Tests don't need Redis

Per-class `Map<string, T>` caches were leaky in two ways: (1) state survived across tests because the Map was a private instance field captured by the singleton, (2) cross-pod scenarios couldn't be exercised because every test had its own local Map. The InMemoryCacheAdapter solves both: each test instantiates its own adapter, no shared state, and the adapter implements the same `CachePort` contract the production Redis adapter implements — so swapping in production is a one-line DI change.

### The composition root owns the manager

`RedisCacheManager` is a heavy object: it opens an ioredis connection (lazyConnect), starts background tasks for L1 cleanup and access pattern aging, and registers Prometheus metrics. Two managers in one process means two connections and two metric registrations — the latter was a real bug we hit pre-T4-L. Registering it as a DI singleton (`TOKENS.RedisCacheManager`) and wrapping it once via `RedisCacheAdapter` (`TOKENS.CachePort`) guarantees one-and-only-one instance.

---

## Adapter responsibilities

### `RedisCacheAdapter` — production

Wraps the shared `RedisCacheManager` singleton and translates between the manager's `Result<T, "CACHE_ERROR">` API and the port's plain return shape. Error policy:

- `get` → cache failures degrade silently (return `null`, log warn). A missing cache is not a fatal error.
- `set`, `delete`, `invalidateByTag`, `has` → best-effort, log on error.
- `getOrSet` → re-runs the factory if the cache read errored, propagates factory exceptions to the caller (the value, not the cache, is what they asked for).

The adapter does NOT implement stampede protection (single-flight, XFetch, stale-while-revalidate, jitter). Concurrent factory calls on a missed key each run independently. This matches the underlying manager's behavior; PR-29 in the backlog tracks adding stampede protection once we have hot-key metrics to motivate per-policy decisions.

### `InMemoryCacheAdapter` — tests + per-process scope

Pure `Map`-backed storage with per-entry TTL and a `tag → Set<key>` reverse index for `invalidateByTag`. Optional `BackgroundTaskScheduler` registration drops expired entries periodically; without a scheduler, expired entries are still treated as misses on read but stay resident until overwritten or `clear()`-ed (acceptable for tests; pass a scheduler in long-lived per-process scopes).

Not intended for production cross-pod caching: each process keeps its own Map, so writes and invalidations do not propagate across instances. If a future component genuinely needs per-pod caching (e.g. an in-process feature flag cache that's safe to diverge), `InMemoryCacheAdapter` is the right tool — but the canonical path for shared state is the Redis adapter.

---

## Common operations

### Reading and writing through the port

```typescript
import type { CachePort } from "@ports/core";
import { TOKENS } from "../infrastructure/container/types.js";

class MyService {
  constructor(private cache: CachePort) {}

  async getThing(id: string): Promise<Thing> {
    return this.cache.getOrSet<Thing>(`thing:${id}`, () => this.fetchFromDb(id), {
      ttlSeconds: 300,
      tags: ["things"],
    });
  }

  async invalidateAllThings(): Promise<void> {
    await this.cache.invalidateByTag("things");
  }
}

// Wire-up in setupServices.ts
container.register<MyService>(
  TOKENS.MyService,
  () => new MyService(container.resolve<CachePort>(TOKENS.CachePort)),
  true
);
```

Convention: scope-prefix the keys (`credentials:`, `permissions:`, `branch:`, `version:`, `connection-health:`, `top-performers:`, `trends:`) so a Redis `KEYS prefix:*` scan can narrow to one feature without ambiguity. The underlying manager prefixes everything with `api:` at the Redis level, so the on-the-wire key is `api:credentials:foo`.

### `getOrSet` vs `get` + `set`

Prefer `getOrSet` for cache-aside reads. The convenience method consolidates the miss/factory/store path that callers used to write by hand and that's been the source of every cache-related bug we've seen:

- Forgetting to call `set` after computing a fresh value (cold cache forever).
- Storing the in-flight Promise instead of the resolved value (next reader gets a Promise).
- Race-condition double-fetches that nobody notices until the upstream API rate-limits.

Use raw `get` + `set` only when the writes don't follow a "get-or-compute" pattern — e.g. write-only counters, fire-and-forget audit traces, or pre-warmed caches that have no associated factory.

### Adding a new cache consumer

1. Inject `CachePort` via the constructor (last optional parameter unless the cache is mandatory).
2. Resolve `TOKENS.CachePort` in the DI factory.
3. In tests, pass `new InMemoryCacheAdapter()` directly.
4. Pick a unique key prefix (`feature:`) so you can tag-invalidate without collisions.

### Invalidating cross-pod (RbacService example)

`RbacService.invalidateCache(roleName?)` was the canonical broken case before T4-L: in a multi-pod deployment, calling `invalidateCache("editor")` only cleared the Map on the pod that handled the request. Other pods kept the stale permission set until their local TTL expired (60 seconds), opening a window where a revoked permission still passed `hasPermission` checks on adjacent pods. OWASP A07:2021 — Identification and Authentication Failures.

The fix is the port: `cache.delete(key)` and `cache.invalidateByTag(tag)` reach Redis, so every pod sees the invalidation on the next read. The fitness grep blocks new `private *Cache = new Map()` patterns precisely so this regression doesn't recur.

### Configuring the default TTL

The base TTL when callers omit `ttlSeconds` is read from `CACHE_TTL_DEFAULT` (seconds). Falls back to 3600 (1 hour) if unset or unparseable. Explicit `config.defaultTtl` on a `RedisCacheManager` constructor still wins. Set `CACHE_TTL_DEFAULT` in your environment for fleet-wide tuning without code changes.

---

## Multi-tier (L1 + L2)

`RedisCacheManager` runs L1 (in-process LRU) + L2 (Redis) automatically. Reads check L1 first, then L2; writes go to both. The port doesn't surface this because callers don't need to choose tiers — the manager picks the right one based on what's already populated.

Why two tiers: L1 hits avoid the Redis network round-trip (sub-millisecond vs single-digit milliseconds), L2 ensures cross-pod coherence. BentoCache benchmarks show 2,000-5,000x speedup over single-tier distributed cache on hot keys. We get the same property without exposing it to consumers.

L1 is bounded by `L1CacheManager`'s default eviction policy. If you populate too many distinct keys in tight succession, L1 evicts and you lose the speedup; L2 still serves the read.

---

## Known dead caches

### `BranchManager.branchCache` (write-only)

Pre-T4-L, `BranchManager` had `private branchCache = new Map<string, VersionBranch>()`. Audit during migration showed `branchCache.set(...)` in `createBranch()` but **zero reads** anywhere in the file. The Map was write-only.

T4-L preserves the existing behavior: when a `CachePort` is supplied, `cache.set` writes the branch; nothing reads it back. The migration does NOT add a read path that didn't exist before — that would be a behavior change disguised as a refactor.

**PR-30** in the backlog tracks the dead-read investigation: should `getBranchByName`, `branchExists`, or `updateBranchHead` actually read the cache, or is the Map a residue from a pre-merge implementation?

---

## Stampede protection (deferred)

Wikipedia, BentoCache, and the 1xAPI 2026 single-flight write-up all flag stampede protection — single-flight (one factory invocation per key per process), XFetch (probabilistic early refresh), stale-while-revalidate, and jitter — as canonical extensions for production caches.

T4-L deliberately did NOT ship them. Reasons:

1. **No measured thundering herd.** Without metrics on hot-key contention, picking the right policy (single-flight vs XFetch vs SWR) is guesswork. We'd be guarding against a problem we haven't observed.
2. **Per-policy decisions.** Single-flight is right for expensive deterministic factories; SWR is right for caches where stale-by-N-seconds is acceptable; XFetch is right for very-hot keys with predictable-cost regeneration. One global policy fits none of these.
3. **The cost of waiting is bounded.** Factory functions today are mostly DB lookups (~10ms) or HTTP fetches (~100ms). A small thundering herd lasts under a second; the cache is then warm. The real concern is the dozenth pod pile-on after a TTL expiry — and we'd see that in metrics first.

Tracked as **PR-29** in the backlog. When we add it, the port surface stays the same — stampede protection is a property of the adapter, not the contract.

---

## Testing code that uses the cache

The pattern is the same as the logger: inject the port, swap the adapter in tests.

```typescript
import { InMemoryCacheAdapter } from "../../../../packages/adapters/cache-redis/src/in-memory-cache-adapter.js";

describe("MyService", () => {
  let cache: InMemoryCacheAdapter;
  let service: MyService;

  beforeEach(() => {
    cache = new InMemoryCacheAdapter();
    service = new MyService(/* repo, etc, */ cache);
  });

  // Cache state is automatic — `cache` is fresh per test.
});
```

Don't try to spy on the production `RedisCacheManager` — pino-level mocking of the L1+L2 tiering is fragile and tests break on adapter upgrades. The InMemory adapter implements the same contract; if your test passes against it, it passes against Redis.

If you need to assert specific cache calls (e.g. "service set tag X"), wrap the InMemory adapter in a `vi.spyOn`-backed observer. The adapter's API is six methods total, so the observer is small.

### Testing TTL

Use Vitest fake timers + the InMemory adapter's deterministic timestamp checks. The adapter calls `Date.now()` in `get`, `has`, and the periodic cleanup, so `vi.advanceTimersByTime(ttlMs + 100)` reliably evicts entries:

```typescript
it("returns null after TTL elapses", async () => {
  vi.useFakeTimers();
  await cache.set("k", "v", { ttlSeconds: 1 });
  vi.advanceTimersByTime(1500);
  expect(await cache.get("k")).toBeNull();
});
```

---

## Why no additional ports for L1-only or per-process caches?

Hexagonal purity would suggest separate ports for "in-process cache" and "distributed cache" with different contracts. We deliberately don't.

**Reason 1: callers don't pick tiers.** The whole point of L1+L2 is that the cache picks the right tier per key. A per-tier port would push that choice back onto callers — exactly the problem the manager solves.

**Reason 2: tests don't need a distributed surface.** `InMemoryCacheAdapter` satisfies the full `CachePort` contract; tests don't need to know whether they're talking to L1, L2, or a unified surface. Tag invalidation works the same in both.

**Reason 3: the contract is small.** Six methods. If we ever needed a richer contract (per-tier metrics, manual L2 bypass for stale-tolerant reads), we'd extend the port — not split it.

---

## References

- [BentoCache — multi-tier canon](https://bentocache.dev/docs/introduction) — primary reference for the L1+L2 + tagging API.
- [PettyCache (mediocre/petty-cache)](https://github.com/mediocre/petty-cache) — confirms `getOrSet`-style cache-aside as the canonical convenience method.
- [OneUptime — Multi-Layer Caching Redis Node.js (2026)](https://oneuptime.com/blog/post/2026-01-25-multi-layer-caching-redis-nodejs/view) — explicit recommendation that "rather than repositories maintaining private cache instances, they delegate all caching to the injected CacheManager."
- [type-cacheable](https://github.com/joshuaslate/type-cacheable) + [cache-flow](https://github.com/abourdin/cache-flow) — TypeScript ecosystem convergence on adapter interfaces.
- [Wikipedia — Cache stampede](https://en.wikipedia.org/wiki/Cache_stampede) and [1xAPI single-flight 2026](https://1xapi.com/blog/nodejs-cache-stampede-single-flight-pattern-2026) — the deferred work in PR-29.
- [AlachiSoft — Client cache + distributed](https://www.alachisoft.com/blogs/an-insight-into-using-client-cache-with-distributed-caching/) — the cache-coherence problem that motivates collapsing per-class Maps.
- [OWASP A07:2021 — Identification and Authentication Failures](https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/) — the threat model for `RbacService.invalidateCache`.
- Internal: [packages/ports/src/CachePort.ts](../../packages/ports/src/CachePort.ts), [packages/adapters/cache-redis/src/redis-cache-adapter.ts](../../packages/adapters/cache-redis/src/redis-cache-adapter.ts), [packages/adapters/cache-redis/src/in-memory-cache-adapter.ts](../../packages/adapters/cache-redis/src/in-memory-cache-adapter.ts), [packages/adapters/cache-redis/src/cache-manager.ts](../../packages/adapters/cache-redis/src/cache-manager.ts).
