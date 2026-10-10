# Running the saga test suites

> Developer guide for the saga engine's node:test suites: which services each one
> needs, how to boot the API the live one talks to, and the preconditions that make
> the crash-recovery suite deterministic.

**Owner:** Platform engineering

---

## The suites and what they need

| Suite                                                                      | Services                                 | Runner tier |
| -------------------------------------------------------------------------- | ---------------------------------------- | ----------- |
| `tests/integration/sagaCrashRecovery.integration.test.ts`                  | Postgres + Redis (owns its BullMQ queue) | services    |
| `tests/integration/sagaPublishNowPromotion.integration.test.ts`            | Postgres + Redis (queue is a double)     | services    |
| `tests/integration/sagaTenantIsolation.integration.test.ts`                | Postgres                                 | services    |
| `tests/integration/repositories/sagaAccountIdBackfill.integration.test.ts` | Postgres                                 | services    |
| `tests/chaos/saga-step-retry-recovery.integration.test.ts`                 | none (in-memory doubles)                 | services    |
| `tests/integration/sagaCustomerFlow.live.test.ts`                          | Postgres + Redis + a LIVE API server     | live        |

Unit suites under `tests/unit/saga/` are collected by the Vitest phase and need
nothing. `scripts/run-tests.sh` collects the node:test ones by their suffix, and a
static invariant asserts that every node:test saga suite on disk carries the suffix
of the tier that collects it, because a suite no tier collects never runs while
still reading as coverage; whether a collected suite runs or sits in the quarantine
is reach, which fitness #30 measures.

`sagaPublishNowPromotion` doubles the QUEUE rather than owning a real one: it reports
every scheduled job as completed, which is what puts the saga on the total-success
path without a worker, and it records each enqueue, which is what makes "the rejected
second start enqueued nothing" a direct observation. Everything else is real —
Postgres, the real `PrismaPostRepository` with the real outbox writer, and the real
`SagaIntegration` composition — because the property under test is the PERSISTED row
and the outbox, and only a real row decides atomicity. Like `sagaCrashRecovery`, it
boots real managers, and a boot dispatches every non-terminal row in the table; the
services tier runs one file at a time, so no two such suites share the table at once.

---

## Booting the API for the live suite

`sagaCustomerFlow` signs its customer JWTs from the `.env` + `.env.test` PAIR, and
`.env.test` overrides `CUSTOMER_JWT_SECRET`. The API under test must boot with the
same pair or every token the suite mints is rejected with
`JsonWebTokenError: invalid signature` — a failure that reads like an auth regression
and is not one.

```bash
set -a; source .env; source .env.test; set +a
pnpm dev:api                 # port 3001 comes from .env.test
# in another shell, with the same pair exported and the workers running
# (pnpm --filter @apps/workers dev:test), from apps/api
BASE_URL=http://localhost:3001 TEST_API_URL=http://localhost:3001 \
  TEST_WORKERS_READY_URL=http://localhost:3300/health/ready \
  bash scripts/run-tests.sh tests/integration/sagaCustomerFlow.live.test.ts
```

Kill the server and confirm the port is free afterwards. The suite's older
"start with pnpm dev" hint predates the env split and no longer works.

---

## Why the crash-recovery suite refuses to start on a dirty database

`sagaCrashRecovery` boots REAL `SagaIntegration` instances, and a boot loads and
dispatches every non-terminal saga row in the table — across all tenants, by design.
A row left behind by an earlier suite or an interrupted run would therefore be
EXECUTED by this suite, through its own queue and its own command bus.

So the suite checks the precondition instead of assuming it: its top-level `before`
fails with the offending ids listed if any `RUNNING` / `PENDING` row exists before the
fixtures are created. Clear the residue and re-run:

```sql
SELECT id, status, "definitionId", "startedAt"
FROM   "SagaInstance"
WHERE  status IN ('RUNNING', 'PENDING')
ORDER  BY "startedAt";
```

Determinism here is a property of the suite, not of whatever the database happens to
hold — which is the only version of determinism worth having in CI.

---

## How to extend

1. **New node:test saga suite** → give it the suffix of the tier matching its
   dependencies, `.integration.test.ts` for Postgres and Redis, and a `{ timeout }`
   on any test or hook whose worst case outgrows the runner's default;
   `apps/api/scripts/run-tests.sh` collects it by that suffix. The static invariant
   fails otherwise.
2. **New live-API suite** → the `.live.test.ts` suffix puts it in the live tier,
   which runs under `full-integration` behind the readiness probe; document its boot
   requirements in the table above.
3. **A suite that needs a clean saga table** → assert the precondition and name the
   rows, the way `sagaCrashRecovery` does. Do not rely on the order files run in:
   `TEST_ORDER=reverse` reverses it.
