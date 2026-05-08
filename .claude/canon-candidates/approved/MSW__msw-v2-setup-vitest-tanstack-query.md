# Canon Candidate — MSW v2 setup for Vitest tests with TanStack Query

## Metadata

- **Task surfacing this gap**: Phase 2 audit-toolkit activation (MSW instalado a v2.14.3 pero sin handlers ni server). PR-51 canon entry ya documentó "MSW for tests: not yet wired in the repo" como future work.
- **Specific decision**: how should MSW v2 be wired across `apps/admin` y `apps/client` — handlers per-domain o flat? `setupServer` en `tests/mocks/server.ts` o donde? `onUnhandledRequest: warn|error|bypass` para los tests del repo? lifecycle hooks (beforeAll/afterEach/afterAll) en setup file global o per-test-file?
- **Decision date**: 2026-05-07
- **Synthesized by**: claude-opus-4-7
- **Status**: approved (2026-05-07) — **corrected post-implementation**: the original draft proposed a global `vitest.config.ts setupFiles` entry for MSW lifecycle. Implementation revealed this rejects 65 legacy tests using `vi.stubGlobal('fetch')` because MSW intercepts at the http/undici layer below the fetch global. The corrected pattern (reflected in canon-index.json) is per-test-file lifecycle: each MSW-aware file imports the server and wires `beforeAll/afterEach/afterAll` inside its own scope. Strict `'error'` is preserved within each opted-in file; legacy tests untouched.

## Why this gap exists

**Existing canon adjacent**:

- `tanstack-query-v5-migration-patterns-from-raw-fetch` (recién creada, 2026-05-07) — establece el patrón TanStack pero deja MSW out-of-scope con nota explícita "Hook tests use vi.mock(...) directly. Wiring MSW is a separate canon entry — track as future work."
- React Hooks pattern entry — covers React rules; no MSW guidance.
- No canon entry sobre cómo organizar MSW handlers, dónde vive el `setupServer`, qué hooks de Vitest invocar, ni qué `onUnhandledRequest` strategy usar.

**What's missing**: la canon necesita pinear (a) la organización del código de mocks (handlers per-domain vs flat, server location), (b) el lifecycle de Vitest setup, (c) la default strategy para requests no-mockeados (warn/error/bypass), (d) el formato de respuesta de los handlers para que match el envelope `{ ok, data }` canónico del backend.

**Why default heuristic is insufficient**: MSW v2 cambió API materialmente vs v1 (rest → http, ResponseComposer → HttpResponse, setupServer/setupWorker reorganizado). Mi memoria mezcla v1+v2. Sin verificación me iría con v1 syntax. Además, "Stop mocking fetch" (Kent C. Dodds, citado por tkdodo) es una decisión de arquitectura de tests que vale documentarse: por qué MSW > vi.stubGlobal('fetch').

## Research scope

- **Search keywords**: `msw v2 vitest setup`, `msw setupServer node`, `msw onUnhandledRequest`, `msw http.get HttpResponse`, `tkdodo testing react query msw`.
- **Sources targeted**: docs oficiales MSW (mswjs.io) + tkdodo blog (canonical para TanStack Query testing patterns).
- **Sources excluidas**: tutoriales Medium pre-v2; videos YouTube (no auditable); contenido sobre MSW v1 (API materialmente diferente).

## Sources consulted

### [1] MSW v2 — Integrations · Node — [mswjs.io](https://mswjs.io/docs/integrations/node)

- **Fetched**: 2026-05-07
- **Authority**: MSW official documentation v2.
- **Key claims**:
  - Setup pattern: `import { setupServer } from 'msw/node'; export const server = setupServer(...handlers)`.
  - Vitest lifecycle canónico: `beforeAll(() => server.listen())` / `afterEach(() => server.resetHandlers())` / `afterAll(() => server.close())`.
  - `server.use(http.get(...))` para overrides per-test (NO sobrescribe handlers globales hasta `resetHandlers`).
- **My reading**: el lifecycle es invariante — los 3 hooks van en un setup file global, no en cada test file. Los overrides per-test usan `server.use()` dentro del `it()` que necesita el escenario distinto.

### [2] MSW v2 — server.listen() options — [mswjs.io](https://mswjs.io/docs/api/setup-server/listen)

- **Fetched**: 2026-05-07
- **Authority**: MSW official documentation v2.
- **Key claims**:
  - `onUnhandledRequest` accepts: `'warn'` (default — log warning + perform request), `'error'` (log error + halt), `'bypass'` (silent + perform), or custom function.
  - Pre-built option `isCommonAssetRequest()` para excluir `/assets/` etc. del check.
  - Custom callback ejemplo: `server.listen({ onUnhandledRequest(request, print) { ... print.warning() } })`.
- **My reading**: `'error'` es el strict default correcto para tests — fuerza que cada endpoint que un componente toca esté declarado en handlers. `'warn'` (default) deja pasar requests reales lo cual rompe el sandbox. `'bypass'` desactiva el check completo (peor). Para nuestro repo: `'error'` global con whitelist explícita si aparece algún case especial.

### [3] MSW v2 — Getting Started (REST handlers) — [mswjs.io](https://mswjs.io/docs/getting-started)

- **Fetched**: 2026-05-07
- **Authority**: MSW official documentation v2.
- **Key claims**:
  - `import { http, HttpResponse } from 'msw'`. Handler factories: `http.get/post/put/patch/delete(path, resolver)`.
  - Path patterns con `:param` (`/users/:id`) y resolver recibe `{ request, params, cookies }`.
  - Body: `await request.json()` async. Response: `HttpResponse.json(body, { status?, headers? })`.
  - Error: `HttpResponse.json({ error: 'msg' }, { status: 500 })`.
- **My reading**: la API v2 es minimal y predecible. Para nuestro envelope `{ ok, data }`, los handlers son one-liners: `http.get('/api/backend/...', () => HttpResponse.json({ ok: true, data: [...] }))`. Tests que ejercitan errores: `HttpResponse.json({ ok: false, error: 'boom' }, { status: 500 })`.

### [4] tkdodo — Testing React Query — [tkdodo.eu](https://tkdodo.eu/blog/testing-react-query)

- **Fetched**: 2026-05-07
- **Authority**: Dominik Dorfmeister (tkdodo) — TanStack Query maintainer.
- **Key claims**:
  - "Stop mocking fetch" (Kent C. Dodds) — MSW es "your single source of truth when it comes to mocking your apis".
  - MSW funciona en Node + browser + Storybook + Cypress + DevTools — un solo handler set para todo.
  - QueryClient test setup: `retry: false` es **crítico** porque "React Query defaults to three retries with exponential backoff" — sin esto, error tests timeoutean.
  - createWrapper pattern: fresh QueryClient per test (`useState(() => new QueryClient({...}))` o helper function).
  - Awaiting state transitions: `await waitFor(() => expect(result.current.isSuccess).toBe(true))`.
- **My reading**: el motivo arquitectónico para MSW > `vi.stubGlobal('fetch')`: con MSW, los handlers son source-of-truth compartida entre unit/integration/E2E (Playwright también puede usarlos). Con `vi.stubGlobal`, cada test redefine la respuesta inline → drift inevitable. La inversión vale para tests con >2-3 endpoints distintos.

## Synthesis

### Recommendation: USE — MSW v2 with strict per-test overrides

For all new HTTP-based test work in `apps/admin/tests/` y `apps/client/tests/`:

1. **`tests/mocks/handlers/<domain>.ts`** per-domain handler files (e.g. `scheduling.ts`, `accounts.ts`, `auth.ts`). Each exports an array `<domain>Handlers: HttpHandler[]`.
2. **`tests/mocks/handlers/index.ts`** barrel: `export const handlers = [...schedulingHandlers, ...accountsHandlers, ...]`.
3. **`tests/mocks/server.ts`**: `import { setupServer } from 'msw/node'; import { handlers } from './handlers'; export const server = setupServer(...handlers)`.
4. **`tests/setup.ts`** (NEW or extend existing) wired via `vitest.config.ts` `setupFiles`. Calls:
   - `beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))`
   - `afterEach(() => server.resetHandlers())`
   - `afterAll(() => server.close())`
5. **Per-test overrides** via `server.use(http.X(path, resolver))` inside the failing-case `it()` block. Reset by `afterEach` automatically.
6. **Default handler responses** match the canon envelope `{ ok: boolean; data?: T }` (matches `BaseRouteHandler.sendSuccess` from `apps/api/src/lib/route-handler/`). Error case: `HttpResponse.json({ ok: false, error: '...' }, { status: 4xx|5xx })`.
7. **QueryClient in tests**: keep current pattern from `useMarkMessageRead.integration.test.tsx` — `retry: false`, `staleTime: Infinity`, fresh client per test via `makeClient()` helper. Already canon-aligned per tkdodo.

### Recommendation: MIGRATE — replace `vi.stubGlobal('fetch', mockFetch)` with MSW handlers when the test file has ≥3 endpoints OR is naturally being touched

PR-51.A's test `useSchedulingDashboardSidebar.integration.test.tsx` currently uses `vi.stubGlobal('fetch', mockFetch)` — migration target. Demonstrates the new pattern + leaves an in-tree reference for future tests. Other existing tests using `vi.stubGlobal('fetch')` stay until each is naturally touched (no bulk rewrite — same incremental policy as the TanStack canon).

### Recommendation: AVOID

- **`onUnhandledRequest: 'warn'` (the default)** — silent passes through unhandled requests to the real network. In jsdom this fails differently per environment; in CI it's flakier. `'error'` makes the test sandbox actually a sandbox.
- **Inline `vi.fn()` mockResponseOnce chains for >3 calls** — that's the brittle pattern MSW solves. Break the test or write handlers.
- **`vi.mock('@/lib/api/clients/...')` for HTTP behavior** — mocks the layer above the boundary. Lose coverage of the transport (`request<T>()`'s envelope unwrapping, `ApiError.fromResponse` parsing). MSW intercepts at the network boundary, exercising the full transport.
- **Sharing one `server` instance across `apps/admin` y `apps/client`** — they have different proxies, types, and handlers. Each app gets its own `tests/mocks/server.ts`.
- **MSW worker (`setupWorker`) for unit tests** — that's for browser/Storybook. Vitest jsdom uses Node's request interception via `setupServer`.

### Tradeoffs / decision tree

- **New test file with ≥3 endpoints**: write handlers in `tests/mocks/handlers/<domain>.ts` + use them.
- **New test file with 1-2 endpoints**: still prefer MSW (the per-domain handler file may already exist or is small to add).
- **Existing `vi.stubGlobal('fetch')` test, untouched in this sub-batch**: leave it. Migrate only when naturally opening the file.
- **One-off scenario (specific 4xx for one assertion)**: `server.use(http.X(...))` inline within the `it()`. Don't pollute the domain handler file with edge cases.
- **Component test that doesn't make HTTP calls**: no MSW needed. Skip.

### Pinned values / flags

- **MSW version**: `2.14.3` (already installed as transitive dep via Next.js — confirm in package.json before adding direct dep).
- **`onUnhandledRequest`**: `'error'` for the test setup file. Strict by default.
- **Handler file location**: `apps/<app>/tests/mocks/handlers/<domain>.ts` per-domain.
- **Server location**: `apps/<app>/tests/mocks/server.ts` per-app.
- **Setup file**: `apps/<app>/tests/setup.ts` (NEW or extend), wired via `vitest.config.ts` `test.setupFiles: ['./tests/setup.ts']`.
- **Lifecycle**: `beforeAll(server.listen)` / `afterEach(server.resetHandlers)` / `afterAll(server.close)`.
- **Default envelope**: `HttpResponse.json({ ok: true, data: T })` for success, `HttpResponse.json({ ok: false, error: '...', message: '...' }, { status: 4xx|5xx })` for errors. Matches `BaseRouteHandler.sendSuccess` / error response shapes from `apps/api/src/lib/route-handler/`.
- **QueryClient in tests**: `retry: false`, `staleTime: Infinity`, fresh per test (already in use in the repo).

## Proposed canon-index.json entry

```json
{
  "key": "msw-v2-setup-for-vitest-tests-with-tanstack-query",
  "topic": "MSW v2 setup for Vitest tests with TanStack Query",
  "area": "Testing · MSW + Vitest",
  "summary": "Canonical MSW v2 wiring for unit/integration tests in apps/admin and apps/client. Per-domain handler files at tests/mocks/handlers/<domain>.ts (each exports HttpHandler[]); barrel at handlers/index.ts; setupServer instance at tests/mocks/server.ts per app. Vitest setup file (tests/setup.ts wired via vitest.config.ts setupFiles) calls beforeAll(server.listen({ onUnhandledRequest: 'error' })) / afterEach(server.resetHandlers()) / afterAll(server.close()). Strict 'error' onUnhandledRequest forces every endpoint touched in tests to be declared. Per-test overrides via server.use(http.X(...)) inside individual it() blocks; reset automatically by afterEach. Handler responses match the canon envelope { ok, data } shape from BaseRouteHandler.sendSuccess. Migration target: replace vi.stubGlobal('fetch', mockFetch) when test file has ≥3 endpoints or is naturally touched (no bulk rewrite).",
  "keyTakeaway": "MSW v2 = source of truth for mocked HTTP across unit/integration/E2E. setupServer in Node mode (msw/node) + onUnhandledRequest: 'error' + per-domain handler files + vitest setup file with beforeAll/afterEach/afterAll lifecycle. Handler envelope matches { ok, data } from BaseRouteHandler. Per-test overrides via server.use() inside it(). Migrate from vi.stubGlobal('fetch') incrementally — when file is touched or has ≥3 endpoints. Each app (admin, client) has its own server.ts + handlers/* — independent.",
  "patternAdopted": "For new test work in apps/<app>/tests/: (1) tests/mocks/handlers/<domain>.ts per-domain handler files exporting HttpHandler[] arrays. (2) tests/mocks/handlers/index.ts barrel re-exporting all domain handlers as a flat `handlers` array. (3) tests/mocks/server.ts: `import { setupServer } from 'msw/node'; import { handlers } from './handlers'; export const server = setupServer(...handlers)`. (4) tests/setup.ts: `import { beforeAll, afterEach, afterAll } from 'vitest'; import { server } from './mocks/server'; beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterEach(() => server.resetHandlers()); afterAll(() => server.close());`. (5) vitest.config.ts: `test: { setupFiles: ['./tests/setup.ts'] }`. (6) Default handlers return canon envelope { ok: true, data: T }; error handlers return { ok: false, error, message }, { status: 4xx|5xx }. (7) Per-test scenarios via server.use(http.X(...)) inside specific it() blocks. (8) PR-51.A test (useSchedulingDashboardSidebar.integration.test.tsx) is the migration POC — replaces vi.stubGlobal('fetch') with MSW handlers in apps/client/tests/mocks/handlers/scheduling.ts.",
  "usedIn": "Phase 2 audit-toolkit activation (2026-05-07) — MSW wiring + canon. PR-51.A test migration as POC of the pattern.",
  "date": "2026-05-07",
  "sources": [
    {
      "url": "https://mswjs.io/docs/integrations/node",
      "fetchedAt": "2026-05-07",
      "title": "MSW v2 — Integrations · Node (setupServer + Vitest lifecycle)"
    },
    {
      "url": "https://mswjs.io/docs/api/setup-server/listen",
      "fetchedAt": "2026-05-07",
      "title": "MSW v2 — server.listen() options (onUnhandledRequest warn/error/bypass)"
    },
    {
      "url": "https://mswjs.io/docs/getting-started",
      "fetchedAt": "2026-05-07",
      "title": "MSW v2 — Getting Started (http.* + HttpResponse REST API)"
    },
    {
      "url": "https://tkdodo.eu/blog/testing-react-query",
      "fetchedAt": "2026-05-07",
      "title": "tkdodo — Testing React Query (MSW + retry:false rationale)"
    }
  ],
  "synthesizedBy": "claude-opus-4-7",
  "confidence": "high",
  "lastVerified": "2026-05-07",
  "version": 1,
  "appliesTo": [
    "apps/admin/tests/",
    "apps/client/tests/",
    "apps/admin/tests/mocks/",
    "apps/client/tests/mocks/"
  ]
}
```

## Impact on existing code

**Files NEW under this canon (this commit + PR-51.A test migration)**:

- `apps/client/tests/mocks/handlers/scheduling.ts` — handlers para `/api/backend/campaigns?projectId=...` y `/api/backend/team?projectId=...`
- `apps/client/tests/mocks/handlers/index.ts` — barrel
- `apps/client/tests/mocks/server.ts` — `setupServer(...handlers)`
- Extender `apps/client/tests/setup.ts` (o crear si no existe en location wireada por `vitest.config.ts`).

**Files MODIFY (POC migration)**:

- `apps/client/tests/integration/useSchedulingDashboardSidebar.integration.test.tsx` — remove `vi.stubGlobal('fetch', mockFetch)`, use `server.use(http.X(...))` para los casos de error/edge inside individual it() blocks. Default success case lo cubre el handler global.

**Files NOT touched** (until naturally opened):

- `apps/client/tests/integration/useMarkMessageRead.integration.test.tsx` — still on vi.stubGlobal. Migra cuando se toque por otra razón.
- `apps/client/tests/integration/*.integration.test.tsx` — same.
- `apps/admin/tests/` — admin app no se incluye en este POC; sigue patrón propio. Same canon aplica cuando se inicie su MSW wiring.

**Dependencies**:

- `msw@2.14.3` ya en `node_modules/.pnpm/` (transitiva via Next.js). No hace falta agregar a package.json — MSW es directly importable. (NOTA: si CI bloquea por dep no declarada, agregar `"msw": "2.14.3"` exact pin a `apps/client/package.json` devDependencies.)

## Edward's review

- [x] Sources are sufficient (4: MSW docs ×3 + tkdodo)
- [x] Recommendations match project values (incremental migration, no bulk rewrite, strict onUnhandledRequest)
- [x] Pinned values reasonable (per-domain handlers, per-app server, error onUnhandledRequest, retry:false QueryClient)
- [x] Approve append to `canon_research_index.md`
- [x] Trigger MSW wiring for `apps/client` + PR-51.A test migration as POC
- Notes: approved 2026-05-07.
