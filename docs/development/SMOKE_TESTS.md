# Smoke E2E Test Suite

Smoke tests exercise canonical happy paths + critical edge cases across every flow in the omnipost product surface. The suite is split by app and runs in CI via `.github/workflows/smoke-e2e.yml`.

## Layout

```
apps/api/tests/integration/
  helpers/                      <- shared apiClient + fixtures
  *.smoke.test.ts               <- HTTP smoke per area (node:test)

apps/workers/tests/integration/
  helpers/                      <- shared mock providers + saga event awaiter
  *.smoke.test.ts               <- worker pipeline smokes

apps/admin/tests/e2e/
  *.smoke.spec.ts               <- Playwright admin flows

apps/client/tests/e2e/tests/
  *.spec.ts                     <- Playwright client flows
```

## Running locally

```bash
# 1. Boot stack
pnpm db:up                                   # postgres + redis
pnpm dev                                     # api + workers (port 3000, 3300)

# 2. Run by surface
pnpm --filter @apps/api test:integration     # HTTP smokes
pnpm --filter @apps/workers test             # worker smokes
pnpm --filter @apps/admin exec playwright test
pnpm --filter @apps/client exec playwright test

# 3. Single test for debugging
cd apps/api && node --import tsx --test tests/integration/<area>.smoke.test.ts
```

## Authoring conventions

Each smoke test file covers ONE flow area (auth, billing, posts, channels, etc.) and contains:

1. **Happy path** — the canonical user journey from start to terminal state.
2. **Validation rejection** — bad payload returns 400 with shape from Zod.
3. **Cross-tenant rejection** — second account's token returns 404 (anti-IDOR).
4. **Auth/permission denial** — wrong role / missing token returns 401/403.
5. **Concurrency edge** (where applicable) — OCC version conflict returns 409.

Use the shared helpers — `createTestAccount`, `createTestProject`, `createTestChannel`, `apiPost`, `pollSagaUntilTerminal`. Inline fixtures duplicate the saga-test bug we already shipped (see commit `3bfb4d4`: fixture stubs failed crypto auth-tag validation).

## CI

The `smoke-e2e.yml` workflow splits into 4 parallel jobs (api / workers / admin / client). Each job:

- Brings up postgres + redis as services
- Applies migrations + seeds canonical fixtures
- Starts the dev server(s) in background
- Runs the smoke suite for its app
- Uploads Playwright HTML report on failure (admin / client)

Artifact retention: 7 days. Tier 1 (auth) + Tier 2 (billing) failures block PR merge to `main`. Other tiers are advisory until the suite stabilizes.
