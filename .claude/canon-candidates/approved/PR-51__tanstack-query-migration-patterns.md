# Canon Candidate — TanStack Query v5 migration patterns from raw fetch

## Metadata

- **Task surfacing this gap**: PR-51 (Raw fetches → TanStack hooks repo-wide; 232 raw `fetch()` sites identified across `apps/admin` + `apps/client`).
- **Specific decision**: which TanStack Query v5 patterns should new code adopt for migrating raw `fetch()` to typed hooks? Concretely: (a) `queryOptions()` factory vs inline `useQuery({ queryKey, queryFn })`, (b) error handling — keep the project's `throw ApiError.fromResponse()` pattern or migrate to Result-style? (c) what's the App Router pattern for prefetch + hydration?
- **Decision date**: 2026-05-07
- **Synthesized by**: claude-opus-4-7
- **Status**: pending

## Why this gap exists

**Existing canon adjacent**:

- `react-docs-reusing-logic-with-custom-hooks` — covers the React-level rules for hooks (use prefix, no useMount lifecycle wrappers, etc.) but NOT the TanStack-specific layer.
- `t3-trpc-react-query` (referenced in backlog) — covers QueryClient global wiring (staleTime/gcTime defaults, cache callbacks). The factory `createAppQueryClient` in `packages/query-client/src/index.ts` is canon-aligned.
- No canon entry on `queryOptions()` factory pattern, the prefetch+HydrationBoundary App Router integration, or the explicit decision that the repo's existing `throw ApiError` pattern matches TanStack's idiomatic queryFn behavior.

**What's missing in those entries**: the migration playbook itself. With 232 raw `fetch()` sites awaiting refactor, an authoritative pinned reference avoids drift across sub-batches. Without a canon entry, each sub-batch makes its own choices — some adopt `queryOptions()`, some don't, some accidentally regress to inline-key duplication.

**Why default heuristic is insufficient**: my training data covers TanStack v4-era patterns; v5 introduced `queryOptions()` (Jan 2024), removed callback-level `onSuccess`/`onError` from `useQuery`, and the ecosystem has shifted toward query-options factories as the canonical shape. Without verification, I'd default to inline `useQuery({...})` — the v4 pattern — and produce code that's ~2 years stale on day 1.

## Research scope

- **Search keywords**: `tanstack query v5 query options factory`, `tkdodo query options api`, `react query mutation invalidateQueries pattern`, `nextjs app router tanstack query hydrationboundary`, `react query error handling throw vs result`.
- **Sources targeted**: TanStack official docs (v5 stable), tkdodo (Dominik Dorfmeister, current TanStack maintainer) — canonical practical reference for production.
- **Sources excluded**: Medium / personal blogs without affiliation; v4-era content (the API changed materially); tutorial-grade content (Quickstart, Hello World).

## Sources consulted

### [1] TanStack Query v5 — Query Options API — [tanstack.com](https://tanstack.com/query/latest/docs/framework/react/guides/query-options)

- **Fetched**: 2026-05-07
- **Authority**: TanStack official documentation (v5 stable).
- **Key claims**:
  - `queryOptions()` accepts a config object and returns it at runtime; the value is in TypeScript-level integration, not behavior.
  - Single source of truth for `queryKey` + `queryFn` — co-located instead of split between key factories and custom hooks.
  - Same factory works in `useQuery`, `useSuspenseQuery`, `queryClient.prefetchQuery`, `queryClient.setQueryData`, `useQueries`.
  - Concrete API: `function groupOptions(id: number) { return queryOptions({ queryKey: ['groups', id], queryFn: () => fetchGroups(id), staleTime: 5 * 1000 }) }`.
- **My reading**: this is the v5 canonical migration target. Once a domain has a queryOptions factory, every consumer (component hook, prefetch, manual cache write) shares the exact same key + fetcher — typo-proof at the type level.

### [2] tkdodo — The Query Options API — [tkdodo.eu](https://tkdodo.eu/blog/the-query-options-api)

- **Fetched**: 2026-05-07 (post published 2024-01-17)
- **Authority**: Dominik Dorfmeister (tkdodo) — TanStack Query maintainer; this blog is the canonical practical reference cited by the official docs.
- **Key claims**:
  - "Separating QueryKey from QueryFunction was a mistake" — the older Query Key Factory pattern (just centralized keys) lost its value once `queryFn` moved into custom hooks; refactors had to touch two files.
  - Three concrete benefits of `queryOptions()`: (a) excess-property checking on inlined objects catches typos that the abstracted-object pattern lost; (b) unified single-object API across all consumers; (c) `dataTag` typing makes `queryClient.getQueryData(todoQueries.detail(1).queryKey)` return the right type without manual generics.
  - Domain-grouped factory pattern (production shape): mix key-only hierarchy entries with full `queryOptions` entries:
    ```typescript
    const todoQueries = {
      all: () => ["todos"],
      lists: () => [...todoQueries.all(), "list"],
      list: (filters) =>
        queryOptions({
          queryKey: [...todoQueries.lists(), filters],
          queryFn: () => fetchTodos(filters),
        }),
      details: () => [...todoQueries.all(), "detail"],
      detail: (id) =>
        queryOptions({
          queryKey: [...todoQueries.details(), id],
          queryFn: () => fetchTodo(id),
          staleTime: 5000,
        }),
    };
    ```
  - Hierarchy keys (`lists()`, `details()`) are NOT `queryOptions()` — they're plain key arrays, used for partial-key invalidation: `queryClient.invalidateQueries({ queryKey: todoQueries.lists() })` invalidates every list-shaped query.
  - "Makes a lot of sense to pass it everywhere" — replaces custom hooks for many cases.
- **My reading**: the domain-grouped factory shape is the right target for this repo. The hierarchy keys solve a real pain point we have today — every invalidate is hand-typed, and drift is invisible until the cache misses. Adopting this for new code (PR-51 sub-batches) gives us a migration target without forcing a bulk-rewrite of the existing ~50 hooks.

### [3] TanStack Query v5 — Mutations — [tanstack.com](https://tanstack.com/query/latest/docs/framework/react/guides/mutations)

- **Fetched**: 2026-05-07
- **Authority**: TanStack official documentation (v5 stable).
- **Key claims**:
  - Lifecycle order: `onMutate` → (mutation runs) → `onSuccess` / `onError` → `onSettled`. Promises returned from any callback are awaited before the next.
  - `mutate()` for fire-and-forget; `mutateAsync()` when the caller needs the promise (e.g., compose multiple mutations or branch on the resolved value).
  - Optimistic update canonical lifecycle: `onMutate` cancels in-flight queries, snapshots cache, calls `setQueryData()` with the optimistic value, returns context; `onError` rolls back from context; `onSuccess` reconciles with server response (or simply invalidates if the server is the source of truth).
  - Default retries on mutation: `0`. Queries default to retry on failure; mutations do not, because retries on writes can cause duplicates if not idempotent.
  - Errors are thrown from `mutationFn` and surface in the `error` field — no Result wrapper.
- **My reading**: the `retry: 0` default for mutations is exactly what the project already configures in `createAppQueryClient`. Optimistic updates are a future enhancement (no MVP path needs them today). For PR-51, mutations align by adopting `useMutation({ mutationFn, onSuccess: () => qc.invalidateQueries({ queryKey: domainQueries.lists() }) })`.

### [4] TanStack Query v5 — Advanced SSR (App Router) — [tanstack.com](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr)

- **Fetched**: 2026-05-07
- **Authority**: TanStack official documentation (v5 stable).
- **Key claims**:
  - Server Component pattern: create a fresh `QueryClient`, call `await queryClient.prefetchQuery({...})`, wrap children in `<HydrationBoundary state={dehydrate(queryClient)}>`. Client Components inside the boundary then run `useQuery` and read prefetched data without a network round-trip.
  - **"Treat Server Components as a place to prefetch data, nothing more."** Avoid `queryClient.fetchQuery()` results being rendered in Server Components — TanStack has no way to revalidate them and you risk SC/CC drift.
  - Prefetch close to where data is consumed (nested Server Components), not at the route root — over-eager root prefetching loads data for components that don't need it.
  - `staleTime` MUST be > 0 for prefetched data, or the client refetches immediately on hydration. Default repo `staleTime: 60_000` is sufficient.
  - `queryOptions()` factories work transparently: `await queryClient.prefetchQuery(todoQueries.detail(id))` is the same shape used in `useQuery(todoQueries.detail(id))`.
- **My reading**: this is the playbook for the eventual prefetch + hydration migration of routes. PR-51 sub-batches don't enforce SSR adoption — that's orthogonal. But the queryOptions factory pattern adopted here makes that future migration purely additive (no rewrite of consumer hooks).

### [5] tkdodo — Breaking React Query's API on Purpose — [tkdodo.eu](https://tkdodo.eu/blog/breaking-react-querys-api-on-purpose)

- **Fetched**: 2026-05-07 (post published 2023-04-16)
- **Authority**: Dominik Dorfmeister (tkdodo) — TanStack maintainer.
- **Key claims**:
  - Component-level `onError` / `onSuccess` callbacks on `useQuery` are bug-prone and were removed in v5 — they fire per-subscriber rather than per-query, causing duplicate notifications when multiple components subscribe to the same key.
  - Canonical replacement: `QueryCache` global callbacks at the `QueryClient` level. They fire once per query lifecycle event regardless of subscriber count.
  - Per-query metadata via the `meta` field — opt-in customization (e.g. `meta: { errorMessage: "Failed to load posts" }`) consumed by the global callback.
  - Errors are assumed to be thrown from `queryFn` and bubble up naturally; no Result-wrapper pattern is recommended.
- **My reading**: the project's `createAppQueryClient` already implements the QueryCache + MutationCache `onError` callbacks pattern (factory in `packages/query-client/src/index.ts:86-102`). That part is canon-aligned and needs no change. The `throw ApiError.fromResponse()` pattern in `apps/admin/lib/api/clients/http.ts` is also canon-aligned — TanStack expects throws.

## Synthesis

### Recommendation: USE — `queryOptions()` factory pattern for ALL new code

For new hooks created in PR-51 sub-batches and any future feature work:

1. **Co-locate** `queryKey` + `queryFn` + per-query options in a `domainQueries` factory object inside `apps/<app>/lib/api/queries/<domain>Queries.ts` (new convention).
2. **Hierarchy** keys (`all()`, `lists()`, `details()`) are plain functions returning key arrays — NOT `queryOptions()`. Used only for partial-key invalidation.
3. **Leaf** keys (`list(filters)`, `detail(id)`) wrap `queryOptions({ queryKey, queryFn, staleTime? })`.
4. **Hooks consume the factory**: `useQuery(domainQueries.detail(id))` instead of `useQuery({ queryKey: [...], queryFn: ... })` inline.
5. **Prefetch + invalidate** use the same factory: `queryClient.prefetchQuery(domainQueries.detail(id))`, `queryClient.invalidateQueries({ queryKey: domainQueries.lists() })`.
6. **Error handling**: continue to `throw ApiError.fromResponse(status, body)` from the `http<T>()` transport. The factory's `queryFn` simply awaits `await api.<domain>.<method>(...)` and returns the typed payload — no Result wrapper.
7. **Mutation retry default stays 0** (already in `createAppQueryClient`); explicit `onSuccess: (data, vars) => qc.invalidateQueries({ queryKey: domainQueries.lists() })` for cache coherence.
8. **App Router prefetch + HydrationBoundary** is a separate orthogonal migration — out of scope for PR-51 sub-batches but enabled at zero refactor cost by the factory pattern.

### Recommendation: PRESERVE — existing repo conventions that are already canon-aligned

- `createAppQueryClient` in `packages/query-client/src/index.ts` — factory with QueryCache/MutationCache callbacks matches tkdodo's canonical pattern (Source 5). No changes.
- Defaults: staleTime=60s, gcTime=5m, retry=1 (queries) / 0 (mutations) — match TanStack's v5 recommendations and the `staleTime > 0` requirement for SSR prefetch (Source 4). No changes.
- `http<T>()` thin transport with `throw ApiError.fromResponse()` (`apps/admin/lib/api/clients/http.ts:28-40`) — matches TanStack's "throw from queryFn" idiom (Source 5). No changes.
- Per-domain client modules under `apps/admin/lib/api/clients/<domain>Client.ts` exposing typed methods — preserves the layering between transport, client, and hook. The new `domainQueries.ts` factory consumes the client directly: `queryFn: () => api.<domain>.<method>()`.

### Recommendation: AVOID

- **Inline `useQuery({ queryKey: [...], queryFn: ..., staleTime })` in new code**. Migration target is the factory; new code that re-introduces inline keys creates fresh drift. Existing inline-key hooks (e.g., `apps/admin/hooks/api/useSecretRotationStatus.ts:21-33`, `useChannelForceReauth.ts:17-27`) stay in place — refactor only when the file is naturally touched for another reason.
- **Bulk migrating all 232 raw `fetch()` sites in one go**. PR-51 stays sub-batched per domain. Each sub-batch creates its own `domainQueries` factory and migrates the sites in that domain together.
- **`mutateAsync()` when `mutate()` suffices**. The async variant exists for promise-composition; default to `mutate()` + callbacks for fire-and-forget UI flows.
- **Component-level `onSuccess` / `onError` callbacks** — removed in v5; centralized handling lives in `createAppQueryClient` (Source 5). Per-query customization via `meta`.
- **`queryClient.fetchQuery()` rendered in Server Components**. It works mechanically but breaks the SC/CC revalidation contract (Source 4).

### Tradeoffs / decision tree

- **New domain, no existing client**: create `lib/api/clients/<domain>Client.ts` (transport-level methods) + `lib/api/queries/<domain>Queries.ts` (factory). Hook consumes the factory.
- **Existing domain with inline-key hook, file naturally touched in this sub-batch**: refactor to factory in the same commit. Acceptable scope-creep when the file was opening anyway.
- **Existing domain with inline-key hook, untouched by this sub-batch**: leave it. No bulk-rewrite. Migration is incremental, opportunistic.
- **Single-page one-off fetch (e.g., admin one-time action)**: still go through the factory if the action belongs to a domain. The factory can have a single `action` entry.

### Pinned values / flags

- **Library version**: `@tanstack/react-query` `5.95.0` (confirmed in `apps/admin/package.json` and `apps/client/package.json`). `queryOptions()` API stable since 5.18.0; the project version is well past.
- **`staleTime`**: 60_000 ms (1 min) — repo default. Override per-query only when data is materially more stable (e.g., feature flags: `staleTime: 5 * 60_000`).
- **`gcTime`**: 5 \* 60_000 ms (5 min) — repo default. Rarely overridden.
- **`retry`**: queries=1, mutations=0 — repo default in `createAppQueryClient`. Mutations stay at 0 to avoid duplicate writes.
- **queryKey hierarchy convention**: `[<domain>, 'list' | 'detail' | <subResource>, ...specifics]`. Factories provide `all()`, `lists()`, `details()` plain-key helpers for partial invalidation.
- **Error handling**: throw from `queryFn` / `mutationFn`; transport layer (`http<T>`) emits `ApiError.fromResponse(status, body)` from `apps/admin/lib/parseApiError.ts`. No Result wrapper.
- **Optimistic updates**: opt-in per-mutation; not default. When used, follow the canonical `onMutate` snapshot → `setQueryData` → `onError` rollback → `onSuccess`/`onSettled` invalidate sequence.
- **App Router SSR prefetch**: orthogonal; enabled by the factory but not enforced. Future migration uses `<HydrationBoundary state={dehydrate(qc)}>` with `await qc.prefetchQuery(domainQueries.detail(id))` in the Server Component.
- **MSW for tests**: not yet wired in the repo. Hook tests use `vi.mock("@/lib/apiClient")` directly. Wiring MSW is a separate canon entry — track as future work.

## Proposed canon-index.json entry

```json
{
  "key": "tanstack-query-v5-migration-patterns-from-raw-fetch",
  "topic": "TanStack Query v5 migration patterns from raw fetch",
  "area": "Frontend · Data Fetching · TanStack Query",
  "summary": "Canonical migration target for raw fetch() to TanStack Query v5 hooks: domain-grouped queryOptions() factory (tkdodo 2024) co-locates queryKey + queryFn, with plain-key helpers (all/lists/details) for partial-key invalidation. Same factory is consumed by useQuery, useSuspenseQuery, queryClient.prefetchQuery, queryClient.setQueryData, queryClient.invalidateQueries — eliminating the v4-era split between key factories and custom hooks. Repo's existing transport (http<T> throwing ApiError.fromResponse on !res.ok) matches TanStack's throw-from-queryFn idiom; createAppQueryClient already implements QueryCache/MutationCache global error handlers per tkdodo's canonical pattern. App Router prefetch + HydrationBoundary is supported transparently by the factory pattern but is an orthogonal migration. Mutations default retry=0 (no auto-retries on writes); component-level onSuccess/onError callbacks were removed in v5 — centralized handling lives in createAppQueryClient.",
  "keyTakeaway": "New hooks adopt domain-grouped queryOptions() factories at apps/<app>/lib/api/queries/<domain>Queries.ts; existing inline-key hooks stay until naturally touched (no bulk rewrite). Throw ApiError from queryFn (no Result wrapper). Same factory works for prefetch + invalidate + cache writes — single source of truth for queryKey + queryFn per domain. Mutations: retry=0 (existing default), invalidate via partial-key helpers (domainQueries.lists()) in onSuccess. Avoid component-level onSuccess/onError callbacks (removed in v5) — global QueryCache/MutationCache callbacks already wired in createAppQueryClient.",
  "patternAdopted": "For new code in PR-51 sub-batches and future features: (1) per-domain factory file apps/<app>/lib/api/queries/<domain>Queries.ts exporting `domainQueries = { all: () => [<domain>], lists: () => [...all(), 'list'], list: (filters) => queryOptions({ queryKey: [...lists(), filters], queryFn: () => api.<domain>.fetchList(filters) }), details: () => [...all(), 'detail'], detail: (id) => queryOptions({ queryKey: [...details(), id], queryFn: () => api.<domain>.fetchDetail(id), staleTime: 60_000 }) }`. (2) Hooks consume the factory: `useQuery(domainQueries.detail(id))` — no inline keys. (3) Mutations invalidate via partial keys: `onSuccess: () => qc.invalidateQueries({ queryKey: domainQueries.lists() })`. (4) Transport: continue using http<T>() that throws ApiError.fromResponse(status, body) on !res.ok — TanStack's idiomatic throw-from-queryFn behavior. (5) Defaults stay as createAppQueryClient sets them: staleTime=60s, gcTime=5m, retry queries=1 mutations=0. (6) PR-51.A POC implements the pattern in apps/client/lib/api/queries/schedulingQueries.ts + apps/client/hooks/api/useSchedulingDashboardSidebar.ts as the proof-of-concept reference for sub-batches B-N. Existing inline-key hooks (e.g., useSecretRotationStatus, useChannelForceReauth) remain unchanged until each file is opened for unrelated work.",
  "usedIn": "PR-51 (Wave 5 — Raw fetches → TanStack hooks repo-wide; 232 sites). PR-51.A POC = apps/client/components/scheduling/SchedulingDashboardSidebar.tsx migration as reference implementation.",
  "date": "2026-05-07",
  "sources": [
    {
      "url": "https://tanstack.com/query/latest/docs/framework/react/guides/query-options",
      "fetchedAt": "2026-05-07",
      "title": "TanStack Query v5 — Query Options API (queryOptions helper, type-safe factory)"
    },
    {
      "url": "https://tkdodo.eu/blog/the-query-options-api",
      "fetchedAt": "2026-05-07",
      "title": "tkdodo — The Query Options API (canonical practical guide, 2024-01-17)"
    },
    {
      "url": "https://tanstack.com/query/latest/docs/framework/react/guides/mutations",
      "fetchedAt": "2026-05-07",
      "title": "TanStack Query v5 — Mutations (lifecycle, retry=0 default, onSuccess invalidation)"
    },
    {
      "url": "https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr",
      "fetchedAt": "2026-05-07",
      "title": "TanStack Query v5 — Advanced SSR (App Router prefetch + HydrationBoundary)"
    },
    {
      "url": "https://tkdodo.eu/blog/breaking-react-querys-api-on-purpose",
      "fetchedAt": "2026-05-07",
      "title": "tkdodo — Breaking React Query's API on Purpose (v5 callback removal, global QueryCache pattern)"
    }
  ],
  "synthesizedBy": "claude-opus-4-7",
  "confidence": "high",
  "lastVerified": "2026-05-07",
  "version": 1,
  "appliesTo": [
    "apps/admin/hooks/api/",
    "apps/admin/lib/api/clients/",
    "apps/admin/lib/api/queries/",
    "apps/client/hooks/api/",
    "apps/client/lib/api/clients/",
    "apps/client/lib/api/queries/",
    "packages/query-client/"
  ]
}
```

## Impact on existing code

**Files that already align with this canon (validation, no changes)**:

- `packages/query-client/src/index.ts` — `createAppQueryClient` factory implements QueryCache + MutationCache `onError` global handlers per tkdodo's canonical pattern; defaults staleTime=60s / gcTime=5m / retry=1 (queries) / 0 (mutations) match v5 recommendations. ✓
- `apps/admin/lib/api/clients/http.ts` — thin transport with `throw ApiError.fromResponse()` matches TanStack's throw-from-queryFn idiom. ✓
- `apps/admin/providers/QueryProvider.tsx`, `apps/client/app/providers.tsx` — both consume `createAppQueryClient(...)` with logger + toast handlers. ✓

**Files that should adopt the new factory pattern (PR-51 scope)**:

- 232 raw `fetch()` sites identified in exploration (91 admin + 141 client). Migration is incremental sub-batch by sub-batch; each sub-batch introduces a `domainQueries.ts` factory for its domain.

**Files that exist as inline-key hooks (legacy, untouched until naturally opened)**:

- `apps/admin/hooks/api/useSecretRotationStatus.ts:21-33` — inline `useQuery({ queryKey: ["admin", "secrets", "rotation-status"], queryFn, staleTime: 60_000 })`. Stays as-is.
- `apps/admin/hooks/api/useChannelForceReauth.ts:17-27` — inline `useMutation({ mutationFn })`. Stays as-is.
- `apps/admin/hooks/api/useAccounts.ts`, `useDashboardStats.ts`, `useAuditLogs.ts`, ~25 more — all inline-key. Stay as-is.

**Files NEW under this canon (PR-51.A POC)**:

- `apps/client/lib/api/queries/schedulingQueries.ts` — NEW factory.
- `apps/client/hooks/api/useSchedulingDashboardSidebar.ts` — NEW hook consuming the factory.
- `apps/client/lib/api/clients/schedulingClient.ts` — NEW transport-level client (if not already present).

## Edward's review

- [x] Sources are sufficient (5: TanStack v5 docs ×3 + tkdodo ×2)
- [x] Recommendations match project values (incremental migration, no bulk rewrite, factory for new code only)
- [x] Pinned values reasonable (60s/5m/1/0, factory hierarchy convention, throw-from-queryFn)
- [x] Approve append to `canon_research_index.md`
- [x] Trigger PR-51.A POC implementation (Phase C of plan)
- Notes: approved 2026-05-07.
