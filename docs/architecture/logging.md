# Logging Architecture

> Single source of truth for the **why** behind the project's logging choices. CLAUDE.md states the rules; this doc explains the reasoning so future contributors can extend the pattern correctly without breaking redaction or scope boundaries.

---

## TL;DR — three factories, one responsibility each

```text
┌──────────────────────────────────────────────────────────────────────┐
│  apps/api/src/**            → createLogger() from lib/logger.ts      │
│                               (redaction + "omnipost-api" binding)   │
│                                                                      │
│  packages/**                → createLogger() from @observability/    │
│  (shared, no req payloads)    logger (redacts REDACT_PATHS)          │
│                                                                      │
│  apps/admin, apps/client    → useLogger() from @observability/       │
│  (browser code)               browser-logger (console adapter)       │
│                                                                      │
│  apps/workers/**            → createLogger() from @observability/    │
│                               logger (redacts REDACT_PATHS)          │
└──────────────────────────────────────────────────────────────────────┘
```

Direct `import pino from "pino"` in `apps/api/src/**` is forbidden by CI fitness check #13. The factory IS the abstraction.

---

## Why three factories instead of one

The Maintainer asked the same question. The answer is **scope of the responsibility each factory carries**.

### apps/api/src/lib/logger.ts — credentials hot path

The api process touches:

- HTTP request bodies (login forms with `password`, OAuth callbacks with `accessToken`).
- Provider SDK responses (sometimes leak `apiKey` in error objects).
- BullMQ job payloads (some include `refreshToken` for credential rotation).
- Database query parameters (Prisma logs may include row data with `bearerToken`).

A single `logger.info({ user })` where `user.apiKey` exists would leak the credential to the log aggregator. Pino's `redact: { paths, censor }` mechanism solves this — but **only if the logger instance is created with the redaction config**.

That's why the api factory enforces `redact` with `REDACT_PATHS`, the one list it imports from `@observability/logger` (ADR-0034, decision 8):

```typescript
// apps/api/src/lib/logger.ts
import { REDACT_CENSOR, REDACT_PATHS } from "@observability/logger";

const baseOptions: LoggerOptions = {
  // ...
  redact: { paths: [...REDACT_PATHS], censor: REDACT_CENSOR },
};
```

The list itself, with the threat each added entry mitigates, is `REDACT_PATHS` in `packages/observability/logger/src/index.ts`: the credential field names at the top level (`password`, `token`, `apiKey`, `appPassword`, `clientSecret`, `botToken`, `mfaSecret`, `webhookUrl`, …), their nested forms (`*.token`, `*.accessToken`, `*.credentials`, `*.*.token`, `*.*.secret`, …), the request headers (`req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`) and the arguments of a Redis command an error carries (`*.command.args`, `*.*.command.args`, `*.*.*.command.args`).

Those last three close a leak that needs no developer mistake. ioredis attaches the failed command to the error it emits, `command: { name, args }`, and on an AUTH failure `args` is the password. Pino's error serializer copies every enumerable property of an error, so `logger.error({ err })` wrote the password once per reconnection attempt. Two layers hold it now:

- The list masks `command.args` up to three levels down. That covers an error logged under `err` or `error` (the keys the repository uses), an error one or two levels below them, an array of errors one level down (`{ job: { errors: [err] } }`), and the nested errors of an `AggregateError` logged as the raw object, which the serializer writes under `err.aggregateErrors[i]`.
- The connection-error listener (`createThrottledErrorListener` in `@observability/logger`) never hands the logger the error object. It writes an allow-list: the error's type and message, the diagnostics `code`, `errno`, `syscall`, `address`, `port` and `hostname`, the command's name, the stack, and an `AggregateError`'s nested errors described the same way (at most 4 per level, 2 levels down, the rest counted). It never writes a command's arguments, so it does not depend on the list.

Both layers are pinned by cases that write through the real factories: `packages/observability/logger/tests/redaction.test.ts` and `apps/api/tests/unit/lib/loggerCommandArgsRedaction.test.ts`.

**What the list does not cover.** No production code logs an error in these shapes today; a change that starts to must describe the error instead of logging the object:

- An error four or more levels down, such as `{ a: { b: { c: { err } } } }`, or an array of errors two levels down, `{ a: { b: { errors: [err] } } }`.
- An `AggregateError` nested in another one, which the serializer writes five levels down.
- An error passed as a `%o` or `%j` argument of the message. It is formatted into the message string, where no path applies.

Each further wildcard level makes pino walk every key of that level on every line written, so the list stops at three.

**What the connection-error listener guarantees.** It throttles each error identity (name and message) to one line per window. Its header in `packages/observability/logger/src/throttledErrorListener.ts` states two invariants, and its cases pin them:

- Every held-back error is counted in exactly one later written line: the next line of its own identity, the next recovery line, or, when its window expired first, the next line of either kind under `suppressedByExpiredWindows`.
- The last line a source that is ready again wrote is never an error line. `logConnectionErrors` writes a recovery line on `ready` whenever an error line was written since the last one. It writes none when every error since then was held back, which is what a connection that flaps on one error inside its window does.

A BullMQ queue or worker emits no `ready`, so the second invariant applies only to the Redis connections. Where a queue stops failing, its last line can be an error.

If a developer creates a side `pino()` instance without these paths, **the redaction is silently bypassed**. There's no compile-time check or runtime warning. Logs get aggregated, the secret is in plain text, and the threat-model assumes secrets never reach disk — but they did. That class of bug is exactly OWASP A09:2025 (Security Logging and Alerting Failures).

The factory enforces the redaction at the only layer that's compile-time visible: where the logger gets named.

### `@observability/logger` — shared packages

Packages like `@adapters/db-prisma`, `@adapters/queue-bullmq`, `@providers/x` use the lightweight `@observability/logger` factory. They were once assumed to receive only sanitized inputs, but provider packages handle tokens and app passwords directly (DEF-42), so since ADR-0034 decision 8 the base logger redacts with the same `REDACT_PATHS` and censor as the api factory:

```typescript
// packages/observability/logger/src/index.ts
const baseLogger: pino.Logger = pino({
  level: LOG_LEVEL,
  redact: { paths: [...REDACT_PATHS], censor: REDACT_CENSOR },
  ...(process.env.NODE_ENV !== "production" && {
    transport: { target: "pino/file", options: { destination: 1 } },
  }),
});

export function createLogger(name: string): pino.Logger {
  return baseLogger.child({ name });
}
```

One base logger per process, named children, no `service` binding, no test-mode sync destination. A package that builds its own `pino()` instead of calling `createLogger` skips the redaction; moving those files onto the factory is LOGGER-FACTORY-PKGS (`docs/product/plan/cross-cutting.md`).

### `@observability/browser-logger` — browser code

The browser is a different world:

- No `pino` (pino's Node deps don't tree-shake well to the browser).
- No stdout — the transport is `console.*`: `ConsoleLoggerAdapter` is the only implementation of `BrowserLoggerPort`, and both portals mount the provider on it.
- No filesystem — `pino.destination()` is meaningless.
- Often runs inside React components — the factory exposes a `useLogger(name)` hook that handles cleanup via `useEffect`.

Forcing the api factory into the browser would pull `pino` and its destination handling into the bundle. Forcing the browser factory into Node ignores stdout-based aggregation. Different transports demand different factories.

### Workers — separate process, the shared factory

Workers (`apps/workers/**`) run as standalone Node processes with distinct config: a separate Redis, a separate metrics endpoint and no Fastify. Every logger there comes from `createLogger` of `@observability/logger`, in `bootstrap.ts`, `publishWorker.ts`, `mentionIngestWorker.ts` and `telemetry/initialization.ts`; no worker builds its own `pino()`. The workers' lines therefore carry the same `REDACT_PATHS` as the packages' base logger.

---

## Common operations

### Adding a new named logger

In `apps/api/src/`:

```typescript
import { createLogger } from "../lib/logger.js";

const logger = createLogger("my-feature");
```

In `packages/`:

```typescript
import { createLogger } from "@observability/logger";

const logger = createLogger("adapter:my-feature");
```

Convention: scope-prefix the name (`adapter:`, `worker:`, `route:`) so log aggregators can filter cheaply.

### Adding a new sensitive field to redaction

Edit `REDACT_PATHS` in `packages/observability/logger/src/index.ts` (`@observability/logger`) and **add a comment explaining the threat being mitigated**. The api factory and the packages' base logger both apply it, so one edit covers both:

```typescript
export const REDACT_PATHS: readonly string[] = Object.freeze([
  "password",
  "token",
  // ...existing paths
  "totpSecret", // 2FA shared secret — leak = full account compromise
  "*.totpSecret", // catch nested user objects
]);
```

Two important gotchas:

1. **Case-sensitive.** `req.headers.AUTHORIZATION` does NOT match `authorization`. Pino doesn't normalise casing. Always test with the actual log payload structure.
2. **No silent fallback.** If the path doesn't match the actual log structure, the field is logged in clear text. Pino logs no warning. Validate by checking real log entries after deploy.

If the field is PII (email, SSN, credit card, phone, address, DOB) rather than auth credentials, PII redaction needs a separate threat-model session, because admin/audit/customer-support workflows may legitimately need to read PII in their logs.

### Testing code that logs

The factory honours `NODE_ENV=test` to use sync destinations — tests don't hang on open log handles.

If the test needs to assert specific log calls, mock the factory:

```typescript
vi.mock("../../src/lib/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));
```

Don't try to spy on a real pino instance — the prototype chain pino uses internally is fragile and tests break on pino upgrades.

### Verifying redaction works in production

After a deploy that touches the redaction paths:

1. Trigger a request that exercises the new path (e.g. login with valid creds).
2. Inspect the log aggregator's most recent entries for that endpoint.
3. Confirm the field appears as `[REDACTED]` (not as the literal value, not missing entirely).
4. If it appears literal: **the path didn't match**. Check casing, nesting, and bracket vs. dot notation.

Don't ship redaction changes blind. Verify after each deploy.

### Redacting sensitive query parameters in traces

Traces carry URLs, and a URL's query can carry a credential: an OAuth callback receives `code` and `state`, and the Graph API clients send `access_token`. The redaction covers the URLs and query strings a span records, in its attributes, its name, its status message and the attributes of its events. It does not cover span links, nor a credential that reaches a span outside a query parameter: the OAuth `state` inside the Redis key the Redis instrumentation writes into `db.statement`, and the Telegram bot token and the Slack and Teams incoming-webhook URLs in a URL path (plan rows OTEL-REDIS-KEY-CARRIES-OAUTH-STATE and OTEL-URL-PATH-CARRIES-TELEGRAM-TOKEN in `docs/product/plan/cross-cutting.md`). The list of the sensitive parameter names is one exported constant, `SENSITIVE_QUERY_PARAMETERS` in `packages/observability/opentelemetry/src/queryRedaction.ts`, and three places read it. That module and its two functions import no OpenTelemetry package at run time, so the API's Sentry initializer loads them at boot with tracing off; the span processor, the exporter guard and the reporter live in `spanQueryRedaction.ts` beside it, which only the tracing set-up imports:

| Channel                                             | What applies the list                                                                                                                                                                                                                          |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every span the OpenTelemetry SDK exports            | `QueryParameterRedactionSpanProcessor`, which `createTelemetrySpanProcessors()` registers ahead of every exporter's processor; each exporter sits behind `RedactionGuardedSpanExporter`, which forwards only the spans that processor redacted |
| Server and client spans of the HTTP instrumentation | The instrumentation's own `redactedQueryParams` and `redactedQueryParamsServer`, set in `createTelemetryInstrumentations()`: a second layer                                                                                                    |
| Spans Sentry sends                                  | `scrubSpanForSentry`, the `beforeSendSpan` hook of `apps/api/src/observability/sentryInit.ts`                                                                                                                                                  |

The value becomes `REDACTED` and the name stays, so a trace still shows which parameter a request carried. A parameter is a `name=value` pair after a `?`, an `&` or a `#`; every other parameter and the rest of the URL stay as written. A value runs to the next `&`, `#`, `?` or white space, so in free text the punctuation attached after a sensitive value (a closing parenthesis or quote) is replaced with it.

To add a name, append it to `SENSITIVE_QUERY_PARAMETERS` with a comment naming where this product receives or sends it in a query string, or hands it out in a link; every channel above picks it up, and `tests/queryRedaction.test.ts` checks every name of the list. Two gotchas:

1. **Exact name.** The match is on the whole name, letter case included, after the percent and `+` decoding a query parser applies: `code` does not match `Code`, `postal_code` or `code_challenge`.
2. **Only through the set-up.** A span exporter registered without `createTelemetrySpanProcessors()` gets no redaction. Without an `otlpEndpoint`, `SocialMediaTelemetry` exports nothing: it still hands the NodeSDK its span processors, because given none the SDK would build exporters from `OTEL_TRACES_EXPORTER` behind no redaction. The processor runs in `onEnding`, a hook upstream marks experimental. If an SDK stops calling it, or the redaction processor is not registered on the tracer provider, the guard drops every span instead of exporting it unredacted. It reports the drop once for the whole set-up, not once per exporter, with the count of the first batch: one error-level line through the telemetry's own `pino` logger, which prints with default settings, and the same text through the OpenTelemetry diagnostics logger, which prints only when a diag logger is registered. The line holds fixed wording and a count of spans, never a span name, an attribute value or a URL. Sentry's transaction events and breadcrumbs carry the query outside the spans, where `beforeSendSpan` does not reach (plan row SENTRY-EVENT-QUERY-SECRETS in `docs/product/plan/cross-cutting.md`).

---

## The core logs through `LoggerPort`; the domain does not log

**The domain does not log.** Logging is an infrastructure concern, and domain entities and value objects have no logger dependency to abstract.

**The application core logs through a port.** `packages/core` takes `LoggerPort` (`packages/ports/src/LoggerPort.ts`, exported by `@ports/core`) by constructor and imports neither `@observability/logger` nor `pino`. The composition root passes the logger its deployable's own factory returns (`createLogger(name)` from `apps/api/src/lib/logger.ts` in the API). That logger implements the port as it is, because the port uses Pino's `(context, message)` order, so a core entry carries that factory's redaction and its `name`. The port exposes `warn` and `error` only: `info` and `debug` belong to infrastructure and routes.

**Infrastructure keeps Pino's types.** Outside the core, code takes the `Logger` type of `pino`, and the type re-export of `apps/api/src/lib/logger.ts` keeps callers in the API from coupling to pino's package path. A change that swaps pino for another logger has its boundary at the three factories and the port: the factory bodies change, and the port's callers do not.

---

## References

- [Pino docs — redact option](https://github.com/pinojs/pino/blob/main/docs/redaction.md)
- [OWASP A09:2025 — Security Logging and Alerting Failures](https://owasp.org/Top10/2025/A09_2025-Security_Logging_and_Alerting_Failures/)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [Pape — Redacting Secrets from Pino logs](https://blog.lepape.me/nodejs-best-practices-redacting-secrets-from-pino-logs/) — the case-sensitivity gotcha that motivates the single-factory rule.
- [Cockburn — Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture) — alternative patterns for cross-cutting concerns.
- Internal: [apps/api/src/lib/logger.ts](../../apps/api/src/lib/logger.ts), [packages/observability/logger/src/index.ts](../../packages/observability/logger/src/index.ts), [packages/observability/browser-logger/](../../packages/observability/browser-logger/).
