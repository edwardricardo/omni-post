# Logging Canon — Logging · Background Tasks · Caching

> Authoritative observability rules for omni-post. Auto-loaded via
> `@docs/observability/LOGGING_CANON.md` in CLAUDE.md.

**Owner:** Platform engineering
**Loaded:** every session (Claude Code `@`-import, depth 1)

---

## Logging & Observability

**All logger instances MUST come from one of three named factories — never `import pino from "pino"` directly outside the factory itself.** Each factory targets a distinct scope:

| Where                                                              | Factory                                                | Why                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/**`                                                  | `createLogger(name)` from `apps/api/src/lib/logger.ts` | Applies redaction of sensitive fields (`password`, `token`, `apiKey`, `accessToken`, `refreshToken`, `authorization`, `cookie`, `set-cookie`), sets `service: "omnipost-api"` binding, and uses `pino.destination({ sync: true })` in tests to avoid open handles. |
| `packages/**` (adapters, observability, providers, ui server-side) | `createLogger(name)` from `@observability/logger`      | Lightweight factory for shared packages. No redaction (packages don't see request payloads with credentials directly — that lives in `apps/api`).                                                                                                                  |
| `apps/admin/**`, `apps/client/**`, `packages/ui/**` (browser code) | `useLogger(name)` from `@observability/browser-logger` | Browser-targeted; routes through a `BrowserLoggerPort` (Sentry/console adapter).                                                                                                                                                                                   |
| `apps/workers/**`                                                  | Direct `pino()` factory in the worker entry file       | Workers have distinct ergonomics (separate process, per-worker config); inline factories accepted there.                                                                                                                                                           |
| Tests                                                              | Anything (real factory, `vi.fn()`, or test double)     | No restrictions in `*.test.ts`.                                                                                                                                                                                                                                    |

- **Zero `console.*` in production code** (JSDoc `@example` blocks excluded — those are documentation, not executed).
- **Domain layer: zero logging** — logging is an infrastructure concern; domain stays pure.
- Application layer: `WARN` or `ERROR` only — info/debug belong to infrastructure or routes.
- Every log entry carries: `correlationId`, `layer`, `operation` where applicable.
- Correlation ID propagated through: logger → domain events → outbox → BullMQ job data → error responses.
- OTel SDK initialized as **first import** in entry points (`index.ts`) — before Fastify, before Prisma.
- **Adding a new sensitive field?** Extend the `REDACT_PATHS` array in `apps/api/src/lib/logger.ts` and document the rationale alongside the threat being mitigated. Redact paths are case-sensitive — `req.headers.AUTHORIZATION` does not match `authorization`. See [docs/architecture/logging.md](../architecture/logging.md) for the threat-model and how to extend safely.

---

## Background Tasks

**All recurring work MUST be registered via `BackgroundTaskScheduler` — never call `setInterval` / `setTimeout` directly in backend production code.**

The scheduler lives at `packages/observability/background-scheduler/` and is wired into DI as `TOKENS.BackgroundTaskScheduler`. It applies `.unref()` by default, wraps callbacks with try/catch + logger, tracks in-flight async work, and is torn down on SIGINT/SIGTERM via `scheduler.shutdownAll()`.

- **Register:** `scheduler.register(taskId, callback, intervalMs, options?)` — `taskId` is a stable string constant (one per task, one per class, not a UUID unless the task is per-connection), `callback` may be sync or async, errors go through `options.onError` or the injected logger.
- **Unregister:** `scheduler.unregister(taskId)` on teardown (`stop()` / `shutdown()` / `destroy()` / `onClose` hook / request `close` event).
- **Use `critical: true`** only when the task must NOT let the process exit while still running (rare — default is safer).
- **Use `immediate: true`** when the first execution must fire synchronously instead of after one interval.
- **Libraries in `packages/`** accept `scheduler?: BackgroundTaskScheduler` as an **optional** dependency to stay pure when consumed outside the DI graph. The app's composition root passes the scheduler explicitly.
- **Workers** (apps/workers) construct their own `DefaultBackgroundTaskScheduler` and call `scheduler.shutdownAll()` in their `SIGINT`/`SIGTERM` handlers.
- **Tests** inject a `NoopBackgroundTaskScheduler` and fire callbacks manually via `noopScheduler.triggerTask(taskId)` when the test needs to exercise the task body.

The only legitimate raw `setInterval` call in the entire backend is inside `DefaultBackgroundTaskScheduler` itself. The CI fitness grep blocks new occurrences.

---

## Caching

**All cross-pod cached state MUST go through `TOKENS.CachePort` — never instantiate `RedisCacheManager` outside the composition root, and never declare a per-class `private *Cache = new Map()`.**

The cache port lives at `packages/ports/src/CachePort.ts`. Two adapters implement it: `RedisCacheAdapter` (production, wraps the singleton `RedisCacheManager` with L1 in-process LRU + L2 Redis + tag invalidation) and `InMemoryCacheAdapter` (tests + per-process scopes; pure `Map` + per-entry TTL + tag index, no I/O).

| Scope                                                             | Adapter                | DI token                   |
| ----------------------------------------------------------------- | ---------------------- | -------------------------- |
| Cross-pod shared state (credentials, permissions, computed views) | `RedisCacheAdapter`    | `TOKENS.CachePort`         |
| Underlying L1+L2 manager (singleton, advanced features)           | `RedisCacheManager`    | `TOKENS.RedisCacheManager` |
| Tests (deterministic, no Redis)                                   | `InMemoryCacheAdapter` | injected directly per test |

- **Inject `CachePort`** — never `RedisCacheManager` — into application services. The port surface is `get`, `set`, `getOrSet`, `delete`, `invalidateByTag`, `has`. Use `getOrSet(key, factory, options)` for cache-aside; raw `get` + `set` only when callers compose their own flow (write-only counters, pre-warmed caches with no factory).
- **Namespace your keys** with a feature prefix (`credentials:`, `permissions:`, `branch:`, `version:`, `connection-health:`, `top-performers:`, `trends:`). The Redis manager additionally applies an `api:` prefix on the wire, so the on-the-wire key is e.g. `api:credentials:foo`.
- **Tags** group keys for `invalidateByTag`. Use them for cross-key invalidation patterns (e.g. role-permission cache: every role's permissions share the `rbac:role` tag so `cache.invalidateByTag("rbac:role")` wipes the pool without enumerating roles).
- **Default TTL** is configurable via `CACHE_TTL_DEFAULT` (seconds). Falls back to 3600 when unset. Explicit `ttlSeconds` per call always wins.
- **In tests**, instantiate `new InMemoryCacheAdapter()` directly. Each test gets its own adapter, no shared state, deterministic TTL via `vi.useFakeTimers()`.
- **Stampede protection** (single-flight, XFetch, SWR, jitter) is intentionally NOT implemented yet — tracked as PR-29 in the backlog. Concurrent factory calls on a missed key each run independently.
- **No new `private *Cache = new Map()`** in `apps/api/src/**`. CI fitness grep #14 blocks the pattern (see CLAUDE.md §Automated Compliance Checks). The reason is OWASP A07:2021 (Identification and Authentication Failures): a per-instance Map can't propagate invalidations cross-pod, so a revoked permission stays valid on adjacent pods until their local TTL expires.

Full caching architecture rationale: [docs/architecture/caching.md](../architecture/caching.md).

---

## How to extend

Adding new observability rules:

1. **New sensitive field for redaction** → extend `REDACT_PATHS` in `apps/api/src/lib/logger.ts`. List case variations explicitly (Pino redaction is case-sensitive).
2. **New scheduled task** → register via `scheduler.register(taskId, ...)`. Use a stable `taskId` constant. Unregister on teardown.
3. **New cache namespace** → namespace keys with a colon-suffixed prefix (`credentials:`, etc.). Use tags for cross-key invalidation.
4. **New logger scope** → if a NEW deployable surface appears (e.g. CLI tool, edge function), document its factory in the Logging table. ADR required if the redaction policy differs from the existing 3-factory model (see ADR-0013).
5. **Replacing pino with OTel logs** → ADR required. See ADR-0013 §"Revisit if" for the convergence direction.

Companion fitness checks live in `CLAUDE.md §Automated Compliance Checks`:

- `#11` no raw `setInterval` outside scheduler · `#13` no direct `pino` imports in `apps/api/src` (factory only) · `#14` no per-class cache Maps in `apps/api/src` (CachePort only).
