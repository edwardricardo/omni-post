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
│  (shared, no req payloads)    logger (lightweight, no redaction)     │
│                                                                      │
│  apps/admin, apps/client    → useLogger() from @observability/       │
│  (browser code)               browser-logger (Sentry/console adapter)│
│                                                                      │
│  apps/workers/**            → inline pino() factory in worker entry  │
│                               (workers manage their own config)      │
└──────────────────────────────────────────────────────────────────────┘
```

Direct `import pino from "pino"` in `apps/api/src/**` is forbidden by CI fitness check #13. The factory IS the abstraction.

---

## Why three factories instead of one

Edward asked the same question. The answer is **scope of the responsibility each factory carries**.

### apps/api/src/lib/logger.ts — credentials hot path

The api process touches:

- HTTP request bodies (login forms with `password`, OAuth callbacks with `accessToken`).
- Provider SDK responses (sometimes leak `apiKey` in error objects).
- BullMQ job payloads (some include `refreshToken` for credential rotation).
- Database query parameters (Prisma logs may include row data with `bearerToken`).

A single `logger.info({ user })` where `user.apiKey` exists would leak the credential to the log aggregator. Pino's `redact: { paths, censor }` mechanism solves this — but **only if the logger instance is created with the redaction config**.

That's why the api factory enforces:

```typescript
// apps/api/src/lib/logger.ts:13-34
const REDACT_PATHS = [
  "password",
  "token",
  "apiKey",
  "apiSecret",
  "accessToken",
  "accessTokenSecret",
  "refreshToken",
  "bearerToken",
  "secret",
  "credentials",
  "authorization",
  "cookie",
  "*.password",
  "*.token",
  "*.apiKey",
  "*.secret", // wildcard nested
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]', // bracket syntax for hyphenated
];
```

If a developer creates a side `pino()` instance without these paths, **the redaction is silently bypassed**. There's no compile-time check or runtime warning. Logs get aggregated, the secret is in plain text, and the threat-model assumes secrets never reach disk — but they did. That class of bug is exactly OWASP A09:2025 (Security Logging and Alerting Failures).

The factory enforces the redaction at the only layer that's compile-time visible: where the logger gets named.

### `@observability/logger` — shared packages

Packages like `@adapters/db-prisma`, `@adapters/queue-bullmq`, `@providers/x` don't see request payloads directly. They receive sanitized inputs (e.g. domain objects, queue jobs without auth headers). The redaction overhead would be cosmetic.

These packages also publish to npm in principle (or could), so coupling to `apps/api`-specific config is an anti-pattern. They use the lightweight `@observability/logger` factory:

```typescript
// packages/observability/logger/src/index.ts:11-22
export function createLogger(name: string): pino.Logger {
  return pino({
    name,
    level: process.env.LOG_LEVEL || "info",
    ...(process.env.NODE_ENV !== "production" && {
      transport: { target: "pino/file", options: { destination: 1 } },
    }),
  });
}
```

No redaction, no `service` binding, no test-mode sync destination. Pure delegation to pino with two consistent config knobs (`name`, `LOG_LEVEL`).

### `@observability/browser-logger` — browser code

The browser is a different world:

- No `pino` (pino's Node deps don't tree-shake well to the browser).
- No stdout — the transport is `console.*` for dev or Sentry/DataDog for prod.
- No filesystem — `pino.destination()` is meaningless.
- Often runs inside React components — the factory exposes a `useLogger(name)` hook that handles cleanup via `useEffect`.

Forcing the api factory into the browser would pull `pino` and its destination handling into the bundle. Forcing the browser factory into Node ignores stdout-based aggregation. Different transports demand different factories.

### Workers — separate process, inline factory accepted

Workers (`apps/workers/**`) run as standalone Node processes with distinct config (separate Redis, separate metrics endpoint, no Fastify). They use inline `pino()` factories in the entry file (`autoRenewalWorker.ts:19`, etc.) for two reasons:

1. The worker is its own composition root — there's no `lib/logger.ts` to share with other entries.
2. The worker's redaction needs differ (queue payloads have known shapes; full-blown api redaction is overkill).

Future cleanup could extract a `@workers/logger` factory if scope grows; for now, the inline pattern is acceptable.

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

Edit `apps/api/src/lib/logger.ts:REDACT_PATHS` and **add a comment explaining the threat being mitigated**:

```typescript
const REDACT_PATHS = [
  "password",
  "token",
  // ...existing paths
  "totpSecret", // 2FA shared secret — leak = full account compromise
  "*.totpSecret", // catch nested user objects
];
```

Two important gotchas:

1. **Case-sensitive.** `req.headers.AUTHORIZATION` does NOT match `authorization`. Pino doesn't normalise casing. Always test with the actual log payload structure.
2. **No silent fallback.** If the path doesn't match the actual log structure, the field is logged in clear text. Pino logs no warning. Validate by checking real log entries after deploy.

If the field is PII (email, SSN, credit card, phone, address, DOB) rather than auth credentials, **see PR-28 in the backlog**: PII redaction needs a separate threat-model session because admin/audit/customer-support workflows may legitimately need to read PII in their logs.

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

---

## Why no `LoggerPort` in domain?

Hexagonal purity would suggest a `LoggerPort` interface in `apps/api/src/domain/repositories/` that domain code could depend on. We deliberately don't.

**Reason 1: domain doesn't log.** CLAUDE.md rule: "Domain layer: zero logging". Domain entities/value-objects don't have a logger dependency to abstract.

**Reason 2: pino types are de-facto canonical.** Hundreds of files in the codebase import `Logger` from `pino`. A formal port abstraction would require touching all of them and the gain is negligible — pino is the implementation, would be the implementation, and the type re-export `lib/logger.ts:198` already keeps callers from coupling to pino's package path directly.

**Reason 3: Cockburn alternative.** The hexagonal architecture canon explicitly mentions the **decorator + factory** pattern as a valid alternative for cross-cutting concerns where a full port would add ceremony without payoff. Logging is the textbook example.

If a future change requires swapping pino for another logger (Winston, Bunyan), the migration boundary is the three factories — **that's** the port surface, even if no `interface` declaration exists. Replace the factory bodies; no other code changes.

---

## References

- [Pino docs — redact option](https://github.com/pinojs/pino/blob/main/docs/redaction.md)
- [OWASP A09:2025 — Security Logging and Alerting Failures](https://owasp.org/Top10/2025/A09_2025-Security_Logging_and_Alerting_Failures/)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [Pape — Redacting Secrets from Pino logs](https://blog.lepape.me/nodejs-best-practices-redacting-secrets-from-pino-logs/) — the case-sensitivity gotcha that motivates the single-factory rule.
- [Cockburn — Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture) — alternative patterns for cross-cutting concerns.
- Internal: [apps/api/src/lib/logger.ts](../../apps/api/src/lib/logger.ts), [packages/observability/logger/src/index.ts](../../packages/observability/logger/src/index.ts), [packages/observability/browser-logger/](../../packages/observability/browser-logger/).
