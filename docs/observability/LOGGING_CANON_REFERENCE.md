# Logging Canon — Reference

**Owner:** Maintainers
**Rules:** [LOGGING_CANON.md](LOGGING_CANON.md). This file holds their rationale, their examples and how to extend them, each under the heading of the section it belongs to.

---

## Background Tasks

### What the scheduler applies

`.unref()` on every task that is not `critical`; a `try`/`catch` around every callback; the set of in-flight async callbacks, which `shutdownAll(timeoutMs)` awaits up to its timeout; a `register` after `shutdownAll()` throws. Source: `packages/observability/background-scheduler/src/port.ts` and `default-scheduler.ts`.

---

## How to extend

1. **New sensitive field for redaction** → §Logging & Observability, "Redaction is one list"; document the threat in `docs/architecture/logging.md`.
2. **New scheduled task** → §Background Tasks.
3. **New cache namespace** → §Caching, "Keys" and "Tags".
4. **New logger scope** → when a new deployable surface appears (a CLI tool, an edge function), add its row to the table of §Logging & Observability. ADR required if its redaction differs from the three-factory model (ADR-0013).
5. **Application service that must log** → §Logging & Observability, "The core logs through the port only". Why the order is the contract: Pino reads `(message, object)` as a message plus a printf argument and drops the object, so a message-first port would accept a raw Pino logger that compiles and loses every context field. `apps/api/tests/unit/lib/loggerPortContract.type-test.ts` pins the order, and `loggerPortContract.test.ts` beside it pins the written line.
6. **Replacing pino with OTel logs** → ADR required. See ADR-0013 §"Revisit if".

Companion checks, in `docs/development/FITNESS_FUNCTIONS.md` §Inventory:

- `#11` no raw `setInterval` outside the scheduler · `#13` no direct `pino` in `apps/api/src` (the factory only) · `#14` no per-class cache Maps in `apps/api/src` (`CachePort` only).
- Outside the suite: ESLint `no-console`, and `pnpm check:architecture` for what the core imports.
