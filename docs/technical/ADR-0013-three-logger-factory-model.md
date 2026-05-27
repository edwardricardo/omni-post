# ADR-0013: 3-logger factory model + redaction (apps/api / packages / browser)

- **Status**: Accepted
- **Date**: 2026-05-15
- **Deciders**: Platform engineering
- **Supersedes**: —
- **Superseded by**: —

## Context

Logging in a monorepo has divergent requirements per scope:

1. **`apps/api`** — server-side. Sees request bodies that may contain
   secrets (`password`, `token`, `apiKey`, `accessToken`, etc.).
   MUST redact sensitive fields automatically. Service binding
   `omnipost-api`. Sync destination in tests to avoid open handles.
2. **`packages/*` (adapters, observability, providers, ui server-side)** —
   shared library code. Doesn't see raw HTTP request bodies directly
   (they're already redacted at apps/api ingress). Lighter-weight
   factory, no redaction needed.
3. **Browser code (`apps/admin/*`, `apps/client/*`, `packages/ui/*`
   client-side)** — runs in user's browser. Different transport
   (Sentry / console adapter), different lifecycle, never a real
   pino instance.
4. **`apps/workers`** — separate process, per-worker config. Distinct
   ergonomics; inline `pino()` factory in worker entry files is
   acceptable.

Single shared logger across all scopes either:

- (a) Treats every package as if it might log secrets → redaction
  paths grow noise + perf cost where they're never used, or
- (b) Skips redaction → secrets leak into logs from apps/api request
  handling.

Pre-S0, the codebase had instances of `import pino from "pino"`
directly in `apps/api` modules, bypassing redaction. CWE-209
(information leakage through log channels) was a real risk.

## Decision

**Adopt three named logger factories targeting distinct scopes.
Direct `pino` instantiation is forbidden outside the factory file
itself. Each factory documented in `CLAUDE.md §Logging &
Observability` + enforced by fitness `#13`.**

### The three factories

| Scope                                                         | Factory                                                | Why                                                                                                                                                                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/**`                                             | `createLogger(name)` from `apps/api/src/lib/logger.ts` | Applies redaction of `password`, `token`, `apiKey`, `accessToken`, `refreshToken`, `authorization`, `cookie`, `set-cookie`. Sets `service: "omnipost-api"` binding. Uses `pino.destination({ sync: true })` in tests to avoid open handles. |
| `packages/**` (server-side)                                   | `createLogger(name)` from `@observability/logger`      | Lightweight factory; no redaction (packages don't see request bodies with credentials directly). Single process-wide base pino logger + `child({ name })` calls — avoids `MaxListenersExceededWarning` from N transport-backed loggers.     |
| `apps/admin/**`, `apps/client/**`, `packages/ui/**` (browser) | `useLogger(name)` from `@observability/browser-logger` | Browser-targeted; routes through a `BrowserLoggerPort` (Sentry / console adapter).                                                                                                                                                          |
| `apps/workers/**` (entry only)                                | Direct `pino()` factory in the worker entry file       | Workers have distinct ergonomics (separate process, per-worker config). Acceptable inline.                                                                                                                                                  |
| Tests                                                         | Anything (real factory, `vi.fn()`, or test double)     | No restrictions in `*.test.ts`.                                                                                                                                                                                                             |

### Forbidden

- `import pino from "pino"` outside the three factory files —
  enforced by fitness `#13 No direct pino imports in apps/api`.
- `console.*` in production code — enforced by lint + fitness rule
  scope (JSDoc `@example` blocks excluded — those are
  documentation, not executed).

### Domain logging rule

**Zero logging in domain layer.** Logging is an infrastructure
concern; domain stays pure. Application layer: `WARN` or `ERROR`
only — info/debug belong to infrastructure or routes.

### Correlation ID propagation

Every log entry carries `correlationId`, `layer`, `operation` where
applicable. Correlation ID propagated through: logger → domain
events → outbox → BullMQ job data → error responses.

### Adding a new sensitive field

Extend `REDACT_PATHS` in `apps/api/src/lib/logger.ts`. Document the
rationale + threat being mitigated. Redact paths are case-sensitive:
`req.headers.AUTHORIZATION` does NOT match `authorization` —
duplicates are required for case variations on critical headers.

## Rationale

1. **Right tool per scope.** apps/api needs redaction; packages
   don't (their data is already redacted at ingress); browser
   needs Sentry transport, not pino.
2. **Eliminates `MaxListenersExceededWarning`.** Each
   transport-backed pino logger registers a `process.on("exit")`
   listener (per pino's source). Previously, each
   `createLogger()` call built a fresh transport-backed root
   logger; 11 providers + adapters + observability + cache crossed
   Node's default `MaxListeners` (10). `@observability/logger`
   refactored to a single base logger + `child({ name })` calls —
   exactly one transport and one exit listener.
3. **Test ergonomics.** `pino.destination({ sync: true })` in
   tests avoids the open-handle leak that would prevent the test
   runner from exiting cleanly.
4. **Security baked in.** Redaction is automatic in apps/api; no
   per-call boilerplate. CWE-209 mitigated at the logger layer,
   not at every log call-site.

## Alternatives Considered

- **Single shared logger factory across all scopes.** Rejected:
  forces redaction everywhere (perf + noise) or skips redaction
  everywhere (security leak).
- **Logger-as-port (`LoggerPort` injected via constructor).**
  Considered. Rejected for the apps/api case as ceremony-heavy
  for a process-wide concern. Application services in `@core/
application/` use `@observability/logger` directly (canonical
  for `packages/**` scope per CLAUDE.md §Logging) — not a port
  because the factory is the abstraction, not the instance.
- **Pino transports per scope (one transport per package).**
  Caused the `MaxListenersExceededWarning` issue described
  above. Fixed by single-base-logger + `child()` calls.
- **No automatic redaction — devs remember to redact manually.**
  Rejected as security antipattern. Default-secure is the
  bar.

## Consequences

**Positive**

- Redaction is automatic at the apps/api entry point; no log
  call-site needs to remember.
- Test runner exits cleanly (no open pino handles).
- Single process-wide pino base avoids `MaxListeners` exhaustion.
- Browser uses a different adapter (Sentry) without polluting
  server-side pino types.
- The 3-factory model is documented + enforced by fitness `#13`.

**Negative / costs**

- Devs must remember which factory to import. The decision tree is
  simple: "what scope am I in?" → factory.
- Adding a new sensitive field requires editing the
  `REDACT_PATHS` array (low frequency but easy to forget).
- The single-base-logger in `@observability/logger` is a
  package-scope singleton; tests of that package itself need to
  handle the singleton lifetime carefully (acceptable; the
  package is small).

## Revisit if

If we adopt OpenTelemetry as the primary observability surface
(currently OTel is initialized but pino is the dominant log
emitter), the factory model may converge with OTel's logger API.
The redaction concern doesn't go away — OTel processors can do
redaction at the SDK level — but the factories may become thinner
wrappers around `tracer.getActiveSpan().recordException(...)` and
similar. Not immediate.

## Risks and Mitigations

| Risk                                                        | Mitigation                                                                                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct `pino` import slips into apps/api                    | Fitness `#13 No direct pino imports in apps/api` hard-zero CI gate, excluding the factory file itself + tests + stryker sandboxes.             |
| New sensitive field not added to `REDACT_PATHS`             | Code review heuristic + `docs/architecture/logging.md` threat-model doc explicitly enumerates the kinds of fields that need redaction.         |
| Case-sensitivity bypasses redaction (e.g., `AUTHORIZATION`) | `REDACT_PATHS` lists case variations explicitly for critical headers; documented in CLAUDE.md.                                                 |
| Domain code accidentally logs                               | Fitness `#2 Domain layer is framework-free` + code review: any `logger.*` call in `packages/core/domain/` is a red flag.                       |
| Browser logger leaks into server bundles                    | Webpack DefinePlugin + Next.js `clientPrefix` boundary enforces server/client separation. `useLogger` only imported from `'use client'` files. |

## References

- Pino redaction docs — https://getpino.io/#/docs/redaction
- CWE-209 — Generation of Error Message Containing Sensitive Information
- OmniPost `CLAUDE.md §Logging & Observability`
- OmniPost `docs/architecture/logging.md` — threat-model + REDACT_PATHS rationale
- File: `apps/api/src/lib/logger.ts` (`createLogger` with redaction)
- File: `packages/observability/logger/src/index.ts` (`createLogger` lightweight)
- File: `packages/observability/browser-logger/src/index.ts` (`useLogger`)
