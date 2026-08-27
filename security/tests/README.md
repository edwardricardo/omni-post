# `security/tests` — DO NOT WIRE THIS SUITE INTO CI YET

> **Status: vacuous, not unwired.** These 7 suites are written against an API
> surface that does not exist. They cannot pass. Read this file before adding a
> test tier, a workflow job, or a `package.json` script that runs them.

Tracked as **SMELL-83** in
[`docs/reports/roadmap-detected-smells-backlog.md`](../../docs/reports/roadmap-detected-smells-backlog.md).
Evidence: [`docs/reports/CI_TEST_REACH_AUDIT.md`](../../docs/reports/CI_TEST_REACH_AUDIT.md) §G3.

---

## What is actually wrong

Every URL these suites target lives under an `/api/*` prefix the application
never registers — `/api/auth/register`, `/api/auth/login`, `/api/posts`,
`/api/projects`, `/api/media/upload`, `/api/webhooks`, `/api/health`. All of
them 404.

There is no registration endpoint at any path resembling the one the suites
call. The only account-creation route is `POST /auth/customer/register`, and
the payload the suites send does not satisfy its contract (probed: `400 Invalid
input data`).

The consequence is mechanical: every `before` hook fails on the 404 register,
sets `dbAvailable = false`, and each test then calls `t.skip()`.

## The measurement that refutes the old headers

The headers of these files used to read _"These tests require a running API
server with a database / Tier 1 test: requires PostgreSQL."_ That diagnosis is
wrong, and the measurement says so directly. All 7 suites, one `node:test`
batch:

| Run                               | Result                                      |
| --------------------------------- | ------------------------------------------- |
| Against the live homelab database | `65 tests, 3 pass, 6 fail, 56 skip, exit 1` |
| With Postgres unreachable         | `65 tests, 3 pass, 6 fail, 56 skip, exit 1` |

**Identical.** The database is not the missing dependency. The routes are.

The 3 passes and 6 failures are the handful of tests that do not gate on the
bootstrap; two of the failures are `429`s from the suite hammering
`/auth/login` past the rate limiter.

## Why a naive wiring makes things worse

Adding a Postgres tier and pointing a job at these files lands one of two
outcomes, and the second is worse than the first:

1. A permanently-red required job — 6 failures that no amount of database
   provisioning fixes.
2. A **green** required job with 56 of 65 tests skipped, if the job's gate
   treats skips as passes. That is a new false green, larger than the one
   removed when the vacuous `assert.ok(true)` monoliths and the 5 scripts that
   invoked them were deleted.

Note also that fitness **#30** (test-file reachability) cannot see these files:
its sweep is scoped to `find apps/api/tests`. Relocating the suite under
`apps/api/tests/` without wiring it would raise that ratchet's baseline from 21
to 28 — the gate would record the debt, not close it.

## Disposition — decide before wiring

Both options are open; SMELL-83 carries the decision.

- **(a) Rewrite** the 7 suites against the routes that exist. Needs a real
  bootstrap (the `/auth/customer/register` contract plus a rate-limit-aware
  login), per-endpoint status expectations, and a home under `apps/api/tests/`
  so fitness #30 governs reachability.
- **(b) Delete** the suite as vacuous (inform → authorize → delete) and
  re-derive the injection / SSRF / authz coverage from the routes that exist.

Do **not** "fix" this by adding `--test` to a script that runs the directory:
that makes the runner execute every file instead of one and still exit 0 with
everything skipped, which enlarges the false green rather than removing it.

## What still runs today

The security coverage that actually executes in CI is a different set of
suites, driven by `.github/workflows/security-testing.yml` and
`security/scripts/security-scan.sh`:

```bash
pnpm --filter @apps/api test:auth        # tests/auth.test.ts
pnpm --filter @apps/api test:rbac        # tests/rbac.test.ts
pnpm --filter @apps/api test:security    # tests/security.test.ts
pnpm --filter @apps/api test:mfa         # tests/mfa.test.ts
pnpm --filter @apps/api test:ratelimit   # vitest rate-limit unit suites
```

None of them live in this directory.
