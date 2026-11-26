# Logging Canon — Logging · Background Tasks · Caching

**Owner:** Maintainers
**Reference:** [LOGGING_CANON_REFERENCE.md](LOGGING_CANON_REFERENCE.md), read as a file: the rationale, the examples and how to extend these rules.

---

## Logging & Observability

**A logger comes from one of three factories or, in the core, from the port. Outside the two backend factories nothing calls `pino()`.**

| Scope                                                       | Logger                                                                                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/**`                                           | `createLogger(name)` from `apps/api/src/lib/logger.ts`                                                                            |
| `apps/workers/**`, and `packages/**` except `packages/core` | `createLogger(name)` from `@observability/logger`                                                                                 |
| `packages/core/**`                                          | `LoggerPort` from `@ports/core`, received by constructor; the composition root passes the logger its deployable's factory returns |
| Browser code: `apps/admin`, `apps/client`, `packages/ui`    | `useLogger(name)` from `@observability/browser-logger`                                                                            |
| Tests                                                       | the real factory or a double                                                                                                      |

- **Redaction is one list.** Both backend factories redact with `REDACT_PATHS` and `REDACT_CENSOR` of `@observability/logger` (`packages/observability/logger/src/index.ts`); a logger built any other way redacts nothing. A new sensitive field goes into that list with the threat it mitigates. Pino's redact paths are case-sensitive: `authorization` does not match `AUTHORIZATION`, so each spelling is listed.
- **The core logs through the port only.** `packages/core` imports neither `@observability/logger` nor `pino`. `LoggerPort` has `warn` and `error` and nothing else: `info` and `debug` belong to infrastructure and routes. It is called context first, Pino's order: `logger.error({ err, ...fields }, "message")`. In a constructor it goes ahead of a trailing `unitOfWork`.
- **The domain does not log.**
- **No `console.*` in production code.** A JSDoc `@example` is documentation, not code.
- A log entry carries `correlationId`, `layer` and `operation` where they apply.
- The correlation id travels with the work: logger, domain events, outbox, BullMQ job data, error responses.
- An entry point starts the OpenTelemetry SDK before any other module loads: before Fastify, before Prisma.

Held by fitness #13 (no `pino` instantiation in `apps/api/src`), ESLint `no-console`, and `pnpm check:architecture` (the core imports no workspace package but the core, the ports and the shared kernel). The reason of each factory and the threat model of the list: [docs/architecture/logging.md](../architecture/logging.md).

---

## Background Tasks

**Recurring work is registered in `BackgroundTaskScheduler` (`@observability/background-scheduler`, `TOKENS.BackgroundTaskScheduler`). No `setInterval` outside it. A `setTimeout` is awaited by the code that sets it (a delay, the timeout of a race); one that nothing awaits is background work with no owner, and is not written.**

- **Register:** `scheduler.register(taskId, callback, intervalMs, options?)`. `taskId` is a stable string constant, one per task; a per-connection task may carry an id of its own. Registering an id again replaces its task. The callback may be sync or async; what it throws goes to `options.onError` or to the scheduler's logger.
- **Unregister:** `scheduler.unregister(taskId)` in the owner's teardown: `stop()`, `shutdown()`, `destroy()`, an `onClose` hook, a request's `close` event.
- `critical: true` only for a task that must keep the process alive while it runs; the default lets the process exit. `immediate: true` runs the callback once at registration.
- **A library in `packages/`** takes `scheduler?: BackgroundTaskScheduler`, and the composition root passes it. Without one, the library's recurring work does not run.
- **A worker that schedules** builds its own `DefaultBackgroundTaskScheduler` and calls `scheduler.shutdownAll()` in its `SIGTERM` and `SIGINT` handlers, as the API does at shutdown.
- **Tests** inject `NoopBackgroundTaskScheduler` and run a task with `noopScheduler.triggerTask(taskId)`.

Held by fitness #11: `setInterval(` is in `default-scheduler.ts` and nowhere else in `apps/api/src`, `apps/workers/src` and `packages/`.

---

## Caching

**Cached state shared across pods goes through `CachePort` (`TOKENS.CachePort`). `RedisCacheManager` is built for the composition root and nowhere else, and no class keeps a cache of its own in a `Map`.**

- **Inject `CachePort`, never the manager.** Production binds it to `RedisCacheAdapter`, over the one `RedisCacheManager` (`TOKENS.RedisCacheManager`: an in-process L1, Redis as L2, tags). Its surface is `get`, `set`, `getOrSet`, `delete`, `invalidateByTag`, `has` and `claim`.
- **Cache-aside is `getOrSet(key, factory, options)`**; `get` with `set` only where the caller composes its own flow, such as a write-only counter or a pre-warmed entry.
- **`claim(key, ttlSeconds)`** is an exclusive claim, such as a per-key throttle, never cache-aside: exactly one caller across every pod wins, and it rejects when Redis cannot decide.
- **Keys** start with a feature prefix that ends in a colon (`credentials:`, `permissions:`); the manager adds `api:` on the wire.
- **Tags** group keys for `invalidateByTag`: every role's permissions share `rbac:role`, and one call drops them all.
- **TTL:** an explicit `ttlSeconds` wins; without one the manager's default applies, one hour unless `CACHE_TTL_DEFAULT` (seconds) sets it.
- **No stampede protection:** concurrent misses of one key each run the factory.
- **Tests** build their own `new InMemoryCacheAdapter()`, one per test, and drive its TTL with fake timers.

Held by fitness #14: no `private *Cache = new Map()` in `apps/api/src`. A map held by one instance cannot carry an invalidation to another pod, so a revoked permission stays valid there until its TTL ends. Rationale and operations: [docs/architecture/caching.md](../architecture/caching.md).
