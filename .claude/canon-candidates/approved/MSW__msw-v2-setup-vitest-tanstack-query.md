# Canon Candidate — MSW v2 setup for Vitest tests with TanStack Query

## Metadata

- **Task surfacing this gap**: Phase 2 audit-toolkit activation (MSW installed at v2.14.3 but with no handlers and no server). The PR-51 canon entry already documented "MSW for tests: not yet wired in the repo" as future work.
- **Specific decision**: how should MSW v2 be wired across `apps/admin` and `apps/client` — handlers per domain or flat? `setupServer` in `tests/mocks/server.ts` or where? `onUnhandledRequest: warn|error|bypass` for the repo's tests? lifecycle hooks (beforeAll/afterEach/afterAll) in a global setup file or per test file?
- **Decision date**: 2026-05-07
- **Synthesized by**: claude-opus-4-7
- **Status**: approved (2026-05-07) — **corrected post-implementation**: the original draft proposed a global `vitest.config.ts setupFiles` entry for MSW lifecycle. Implementation revealed this rejects 65 legacy tests using `vi.stubGlobal('fetch')` because MSW intercepts at the http/undici layer below the fetch global. The corrected pattern (reflected in canon-index.json) is per-test-file lifecycle: each MSW-aware file imports the server and wires `beforeAll/afterEach/afterAll` inside its own scope. Strict `'error'` is preserved within each opted-in file; legacy tests untouched.

## Why this gap exists

**Existing canon adjacent**:

- `tanstack-query-v5-migration-patterns-from-raw-fetch` (just created, 2026-05-07) — establishes the TanStack pattern but leaves MSW out of scope with an explicit note "Hook tests use vi.mock(...) directly. Wiring MSW is a separate canon entry — track as future work."
- React Hooks pattern entry — covers React rules; no MSW guidance.
- No canon entry on how to organize MSW handlers, where the `setupServer` lives, which Vitest hooks to invoke, or which `onUnhandledRequest` strategy to use.

**What's missing**: the canon needs to pin (a) the organization of the mock code (handlers per domain vs flat, server location), (b) the Vitest setup lifecycle, (c) the default strategy for unmocked requests (warn/error/bypass), (d) the response format of the handlers, so that it matches the backend's canonical `{ ok, data }` envelope.

**Why default heuristic is insufficient**: MSW v2 changed the API materially vs v1 (rest → http, ResponseComposer → HttpResponse, setupServer/setupWorker reorganized). My memory mixes v1+v2. Without verification I would go with v1 syntax. Also, "Stop mocking fetch" (Kent C. Dodds, cited by tkdodo) is a test-architecture decision worth documenting: why MSW > vi.stubGlobal('fetch').

## Research scope

- **Search keywords**: `msw v2 vitest setup`, `msw setupServer node`, `msw onUnhandledRequest`, `msw http.get HttpResponse`, `tkdodo testing react query msw`.
- **Sources targeted**: the official MSW docs (mswjs.io) + the tkdodo blog (canonical for TanStack Query testing patterns).
- **Sources excluded**: pre-v2 Medium tutorials; YouTube videos (not auditable); content about MSW v1 (materially different API).

## Sources consulted

### [1] MSW v2 — Integrations · Node — [mswjs.io](https://mswjs.io/docs/integrations/node)

- **Fetched**: 2026-05-07
- **Authority**: MSW official documentation v2.
- **Key claims**:
  - Setup pattern: `import { setupServer } from 'msw/node'; export const server = setupServer(...handlers)`.
  - Canonical Vitest lifecycle: `beforeAll(() => server.listen())` / `afterEach(() => server.resetHandlers())` / `afterAll(() => server.close())`.
  - `server.use(http.get(...))` for per-test overrides (it does NOT overwrite the global handlers until `resetHandlers`).
- **My reading**: the lifecycle is invariant — the 3 hooks go in a global setup file, not in each test file. Per-test overrides use `server.use()` inside the `it()` that needs the different scenario.

### [2] MSW v2 — server.listen() options — [mswjs.io](https://mswjs.io/docs/api/setup-server/listen)

- **Fetched**: 2026-05-07
- **Authority**: MSW official documentation v2.
- **Key claims**:
  - `onUnhandledRequest` accepts: `'warn'` (default — log warning + perform request), `'error'` (log error + halt), `'bypass'` (silent + perform), or custom function.
  - Pre-built option `isCommonAssetRequest()` to exclude `/assets/` etc. from the check.
  - Custom callback example: `server.listen({ onUnhandledRequest(request, print) { ... print.warning() } })`.
- **My reading**: `'error'` is the correct strict default for tests — it forces every endpoint a component touches to be declared in handlers. `'warn'` (the default) lets real requests through, which breaks the sandbox. `'bypass'` turns the whole check off (worse). For our repo: a global `'error'` with an explicit whitelist if a special case appears.

### [3] MSW v2 — Getting Started (REST handlers) — [mswjs.io](https://mswjs.io/docs/getting-started)

- **Fetched**: 2026-05-07
- **Authority**: MSW official documentation v2.
- **Key claims**:
  - `import { http, HttpResponse } from 'msw'`. Handler factories: `http.get/post/put/patch/delete(path, resolver)`.
  - Path patterns with `:param` (`/users/:id`), and the resolver receives `{ request, params, cookies }`.
  - Body: `await request.json()` async. Response: `HttpResponse.json(body, { status?, headers? })`.
  - Error: `HttpResponse.json({ error: 'msg' }, { status: 500 })`.
- **My reading**: the v2 API is minimal and predictable. For our `{ ok, data }` envelope, the handlers are one-liners: `http.get('/api/backend/...', () => HttpResponse.json({ ok: true, data: [...] }))`. Tests that exercise errors: `HttpResponse.json({ ok: false, error: 'boom' }, { status: 500 })`.

### [4] tkdodo — Testing React Query — [tkdodo.eu](https://tkdodo.eu/blog/testing-react-query)

- **Fetched**: 2026-05-07
- **Authority**: Dominik Dorfmeister (tkdodo) — TanStack Query maintainer.
- **Key claims**:
  - "Stop mocking fetch" (Kent C. Dodds) — MSW is "your single source of truth when it comes to mocking your apis".
  - MSW works in Node + browser + Storybook + Cypress + DevTools — a single handler set for everything.
  - QueryClient test setup: `retry: false` is **critical** because "React Query defaults to three retries with exponential backoff" — without it, error tests time out.
  - createWrapper pattern: fresh QueryClient per test (`useState(() => new QueryClient({...}))` o helper function).
  - Awaiting state transitions: `await waitFor(() => expect(result.current.isSuccess).toBe(true))`.
- **My reading**: the architectural reason for MSW > `vi.stubGlobal('fetch')`: with MSW, the handlers are a source of truth shared across unit/integration/E2E (Playwright can use them too). With `vi.stubGlobal`, each test redefines the response inline → drift is inevitable. The investment pays off for tests with >2-3 distinct endpoints.

## Synthesis

### Recommendation: USE — MSW v2 with strict per-test overrides

For all new HTTP-based test work in `apps/admin/tests/` and `apps/client/tests/`:

1. **`tests/mocks/handlers/<domain>.ts`** per-domain handler files (e.g. `scheduling.ts`, `accounts.ts`, `auth.ts`). Each exports an array `<domain>Handlers: HttpHandler[]`.
2. **`tests/mocks/handlers/index.ts`** barrel: `export const handlers = [...schedulingHandlers, ...accountsHandlers, ...]`.
3. **`tests/mocks/server.ts`**: `import { setupServer } from 'msw/node'; import { handlers } from './handlers'; export const server = setupServer(...handlers)`.
4. **`tests/setup.ts`** (NEW or extend existing) wired via `vitest.config.ts` `setupFiles`. Calls:
   - `beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))`
   - `afterEach(() => server.resetHandlers())`
   - `afterAll(() => server.close())`
5. **Per-test overrides** via `server.use(http.X(path, resolver))` inside the failing-case `it()` block. Reset by `afterEach` automatically.
6. **Default handler responses** match the canon envelope `{ ok: boolean; data?: T }` (matches `BaseRouteHandler.sendSuccess` from `apps/api/src/lib/route-handler/`). Error case: `HttpResponse.json({ ok: false, error: '...' }, { status: 4xx|5xx })`.
7. **QueryClient in tests**: keep current pattern from `useMarkMessageRead.test.tsx` — `retry: false`, `staleTime: Infinity`, fresh client per test via `makeClient()` helper. Already canon-aligned per tkdodo.

### Recommendation: MIGRATE — replace `vi.stubGlobal('fetch', mockFetch)` with MSW handlers when the test file has ≥3 endpoints OR is naturally being touched

PR-51.A's test `useSchedulingDashboardSidebar.test.tsx` currently uses `vi.stubGlobal('fetch', mockFetch)` — migration target. Demonstrates the new pattern + leaves an in-tree reference for future tests. Other existing tests using `vi.stubGlobal('fetch')` stay until each is naturally touched (no bulk rewrite — same incremental policy as the TanStack canon).

### Recommendation: AVOID

- **`onUnhandledRequest: 'warn'` (the default)** — silent passes through unhandled requests to the real network. In jsdom this fails differently per environment; in CI it's flakier. `'error'` makes the test sandbox actually a sandbox.
- **Inline `vi.fn()` mockResponseOnce chains for >3 calls** — that's the brittle pattern MSW solves. Break the test or write handlers.
- **`vi.mock('@/lib/api/clients/...')` for HTTP behavior** — mocks the layer above the boundary. Lose coverage of the transport (`request<T>()`'s envelope unwrapping, `ApiError.fromResponse` parsing). MSW intercepts at the network boundary, exercising the full transport.
- **Sharing one `server` instance across `apps/admin` and `apps/client`** — they have different proxies, types, and handlers. Each app gets its own `tests/mocks/server.ts`.
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
  "patternAdopted": "For new test work in apps/<app>/tests/: (1) tests/mocks/handlers/<domain>.ts per-domain handler files exporting HttpHandler[] arrays. (2) tests/mocks/handlers/index.ts barrel re-exporting all domain handlers as a flat `handlers` array. (3) tests/mocks/server.ts: `import { setupServer } from 'msw/node'; import { handlers } from './handlers'; export const server = setupServer(...handlers)`. (4) tests/setup.ts: `import { beforeAll, afterEach, afterAll } from 'vitest'; import { server } from './mocks/server'; beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterEach(() => server.resetHandlers()); afterAll(() => server.close());`. (5) vitest.config.ts: `test: { setupFiles: ['./tests/setup.ts'] }`. (6) Default handlers return canon envelope { ok: true, data: T }; error handlers return { ok: false, error, message }, { status: 4xx|5xx }. (7) Per-test scenarios via server.use(http.X(...)) inside specific it() blocks. (8) PR-51.A test (useSchedulingDashboardSidebar.test.tsx) is the migration POC — replaces vi.stubGlobal('fetch') with MSW handlers in apps/client/tests/mocks/handlers/scheduling.ts.",
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

- `apps/client/tests/mocks/handlers/scheduling.ts` — handlers for `/api/backend/campaigns?projectId=...` and `/api/backend/team?projectId=...`
- `apps/client/tests/mocks/handlers/index.ts` — barrel
- `apps/client/tests/mocks/server.ts` — `setupServer(...handlers)`
- Extend `apps/client/tests/setup.ts` (or create it if it does not exist at the location `vitest.config.ts` wires).

**Files MODIFY (POC migration)**:

- `apps/client/tests/integration/useSchedulingDashboardSidebar.test.tsx` — remove `vi.stubGlobal('fetch', mockFetch)`, use `server.use(http.X(...))` for the error/edge cases inside individual it() blocks. The global handler covers the default success case.

**Files NOT touched** (until naturally opened):

- `apps/client/tests/integration/useMarkMessageRead.test.tsx` — still on vi.stubGlobal. It migrates when it is touched for another reason.
- `apps/client/tests/integration/*.test.tsx` — same.
- `apps/admin/tests/` — the admin app is not included in this POC; it keeps its own pattern. The same canon applies when its MSW wiring starts.

**Dependencies**:

- `msw@2.14.3` already in `node_modules/.pnpm/` (transitive via Next.js). There is no need to add it to package.json — MSW is directly importable. (NOTE: if CI blocks on an undeclared dep, add a `"msw": "2.14.3"` exact pin to `apps/client/package.json` devDependencies.)

## Maintainer's review

- [x] Sources are sufficient (4: MSW docs ×3 + tkdodo)
- [x] Recommendations match project values (incremental migration, no bulk rewrite, strict onUnhandledRequest)
- [x] Pinned values reasonable (per-domain handlers, per-app server, error onUnhandledRequest, retry:false QueryClient)
- [x] Approve append to `canon_research_index.md`
- [x] Trigger MSW wiring for `apps/client` + PR-51.A test migration as POC
- Notes: approved 2026-05-07.
