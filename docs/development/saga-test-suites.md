# Running the saga test suites

> Developer guide for the saga engine's node:test suites: which services each one
> needs, how to boot the API the live one talks to, and the preconditions that make
> the crash-recovery suite deterministic.

**Owner:** Platform engineering

---

## The suites and what they need

| Suite                                                                      | Services                                 | Runner batch                   |
| -------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------ |
| `tests/integration/sagaCrashRecovery.test.ts`                              | Postgres + Redis (owns its BullMQ queue) | `integration:saga-recovery`    |
| `tests/integration/sagaTenantIsolation.test.ts`                            | Postgres                                 | `integration:tenant-isolation` |
| `tests/integration/repositories/sagaAccountIdBackfill.integration.test.ts` | Postgres                                 | `integration:tenant-isolation` |
| `tests/chaos/saga-step-retry-recovery.test.ts`                             | none (in-memory doubles)                 | `chaos`                        |
| `tests/integration/sagaCustomerFlow.test.ts`                               | Postgres + Redis + a LIVE API server     | `integration:saga-live`        |

Unit suites under `tests/unit/saga/` are collected by the Vitest phase and need
nothing. A static invariant asserts that every node:test saga suite on disk appears
explicitly in `scripts/run-tests.sh`, because a suite that belongs to no batch never
runs while still reading as coverage.

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
# in another shell
BASE_URL=http://localhost:3001 <the INT-LONG command for sagaCustomerFlow>
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

1. **New node:test saga suite** → add it to an explicit batch in
   `apps/api/scripts/run-tests.sh`, in the tier matching its dependencies, with a
   timeout that fits its worst case. The static invariant fails otherwise.
2. **New live-API suite** → put it in the `full-integration` tier and document its
   boot requirements in the table above.
3. **A suite that needs a clean saga table** → assert the precondition and name the
   rows, the way `sagaCrashRecovery` does. Do not rely on batch ordering.
