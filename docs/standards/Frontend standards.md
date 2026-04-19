# OmniPost — Frontend Standards

**Applies to:** `apps/admin`, `apps/client`
**Stack:** Next.js 16 (App Router, Turbopack, React Compiler), React 19.2, TypeScript 6, Tailwind CSS, shadcn/ui (`@packages/ui`), TanStack Query v5
**Last updated:** 2026-04-18
**Version:** 2
**Supersedes:** `REACT_STANDARDS.md` v1 (2026-04-03)
**Transversal rules:** see `CODE_STANDARDS.md` for TypeScript, catch blocks, path conventions, code hygiene, dead code policy.

---

## 1. Component Architecture

### 1.1 Size limits (mechanical)

| Artifact           | Max Lines | Action when exceeded                     |
| ------------------ | --------- | ---------------------------------------- |
| Component (`.tsx`) | 200       | Extract child components or custom hooks |
| Page file          | 800       | Split into feature components            |
| Custom hook        | 150       | Decompose into smaller hooks             |
| Utility file       | 200       | Split by domain concern                  |

These are **mechanical indicators**, not hard rules. A 210-line component that has a single clear responsibility can be acceptable. A 180-line component doing five things is not. Use §1.2 to evaluate the underlying quality.

### 1.2 Single Responsibility (semantic)

Every component, hook, or module should do **one thing**. If you can't describe its purpose in a single sentence without using "and", split it.

**Heuristics that indicate a component needs splitting:**

- More than **3 distinct custom hooks** → consider extracting a container hook
- More than **5 `useState` variables** → evaluate whether some belong in separate components
- Mixing **data fetching + UI rendering + business logic** in one component → separate into container hook + presentational component
- **Two or more user workflows** rendered conditionally → each is its own component
- A prop named something like `mode` or `variant` that substantially changes rendering → likely two components

**Guiding questions:**

- What happens if the visual design changes but the data stays the same? (answers: "nothing, because UI is separate" is good)
- What happens if the data source changes but the UI stays the same? (answers: "nothing, because data is in a hook" is good)
- Could two different pages reuse this as-is? (if yes, the boundary is right)

### 1.3 Page vs component responsibilities

Pages own layout, data orchestration, and error boundaries. Components own rendering, local interaction state, and presentation logic. A page should never contain inline `<table>` markup or complex conditional rendering.

```tsx
// CORRECT — page delegates
export default function Dashboard() {
  return <DashboardContent />;
}

function DashboardContent() {
  const { data, isLoading, error, refetch } = useDashboardStats();

  if (isLoading && !data) return <LoadingSkeleton />;
  if (error) return <ErrorPanel error={error} onRetry={refetch} />;

  return (
    <div className="p-6">
      <PageHeader title="Dashboard" actions={<RefreshButton />} />
      <StatsGrid stats={data} />
      <ChartsRow stats={data} />
    </div>
  );
}

// INCORRECT — page renders everything inline
export default function Dashboard() {
  const { data } = useDashboardStats();
  return (
    <div>
      <h1>Dashboard</h1>
      <div>{data?.accounts.total}</div>
      {/* ...300+ lines of inline markup */}
    </div>
  );
}
```

### 1.4 Server Components vs Client Components (Next.js 16)

**Next.js 16 App Router defaults to Server Components.** `"use client"` is opt-in when interactivity is required.

**Use Server Components when:**

- Fetching data for the initial render (database, REST APIs, file system)
- Rendering static content or streaming from the server
- Keeping secrets (API keys, tokens) off the client bundle
- Reducing JavaScript sent to the browser

**Use Client Components (`"use client"`) when:**

- You need React hooks (`useState`, `useEffect`, `useQuery`, etc.)
- You need event handlers (`onClick`, `onChange`)
- You use browser APIs (`window`, `localStorage`, `navigator`)
- You render third-party components that themselves use hooks

**Pattern — Server Component fetching, Client Component interacting:**

```tsx
// app/(dashboard)/accounts/page.tsx — Server Component
import { AccountsTable } from "@/components/accounts/AccountsTable";

export default async function AccountsPage() {
  const accounts = await fetchAccountsOnServer(); // direct DB call
  return <AccountsTable initialData={accounts} />;
}

// components/accounts/AccountsTable.tsx — Client Component
("use client");
import { useQuery } from "@tanstack/react-query";

export function AccountsTable({ initialData }: Props) {
  const { data } = useQuery({
    queryKey: ["accounts"],
    queryFn: fetchAccounts,
    initialData, // hydrate from SSR
  });
  // ... interactive UI
}
```

**Rule:** TanStack Query only works in Client Components. Server Components fetch directly with `await`.

### 1.5 Composition primitives

Reuse UI primitives from `apps/admin/components/ui/` and `apps/client/components/ui/`:

- `PageHeader` — title + description + action slot
- `StatCard` — label + value + trend + icon
- `DataTable<T>` — generic table with skeleton, empty state, row click
- `ActionButton` — primary / secondary / danger with loading state
- `Badge` — semantic pill (success, warning, error, info, neutral)
- `TabNav` — horizontal tabs with ARIA roles
- `ConfirmDialog` — accessible confirm/cancel modal
- `InputDialog` — accessible text input modal
- `LoadingSpinner` — accessible spinner with screen reader label

---

## 2. Data Fetching (TanStack Query v5+)

### 2.1 TanStack Query is the only data-fetching method in Client Components

Every API call in Client Components goes through a custom hook built on `useQuery` or `useMutation`. No raw `useEffect` + `fetch` + `useState` patterns.

**Server Components** fetch directly with `await` and are exempt from TanStack.

### 2.2 QueryKey convention

All query keys follow a hierarchical array: `[domain, scope, ...params]`.

```ts
["dashboard", "stats"][("accounts", "summary")][("subscriptions", "summary")][
  ("security", "overview")
][("compliance", "overview")][("audit", "logs", filters)][
  ("webhooks", "metrics", timeRange, selectedProvider)
][("executive", "summary", timeRange)][("billing", "stats")][("pricing", "tiers")][
  ("usage-metrics", accountId, year, month)
][("account", "billing", accountId)];
```

**Rules:**

- First element: domain (`dashboard`, `accounts`, `webhooks`, etc.)
- Second element: scope (`summary`, `overview`, `metrics`, etc.)
- Additional elements: parameters that affect the query
- Mutations invalidate by domain prefix: `queryClient.invalidateQueries({ queryKey: ["accounts"] })`

### 2.3 Standard query hook template

```ts
/**
 * @file useDashboardStats.ts
 * @description TanStack Query hook for fetching admin dashboard statistics.
 */
import { useQuery } from "@tanstack/react-query";
import { api, type DashboardStats } from "../../lib/apiClient";

export function useDashboardStats() {
  return useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: async (): Promise<DashboardStats> => {
      const response = await api.admin.getDashboardStats();
      if (!response.ok) throw new Error("Failed to fetch dashboard stats");
      return response.stats;
    },
    staleTime: 30_000, // 30s
    gcTime: 5 * 60_000, // 5min (v5 rename from cacheTime)
    retry: 2,
  });
}
```

**Pattern requirements:**

- Explicit return type on `queryFn`
- Check `response.ok`, throw descriptive `Error` on failure
- Set `staleTime` appropriate to data volatility
- Set `gcTime` (formerly `cacheTime` in v4) for cache eviction
- Set `retry` for transient failures (default: 2)
- Use `enabled` when the query depends on a parameter: `enabled: !!accountId`

### 2.4 Side effects: queries vs mutations (v5 breaking change)

**TanStack Query v5 removed `onSuccess` / `onError` / `onSettled` from queries.** They remain valid for mutations.

**Queries — use `useEffect` with state flags:**

```tsx
// CORRECT v5 pattern
const query = useQuery({
  queryKey: ["users"],
  queryFn: fetchUsers,
});

useEffect(() => {
  if (query.isSuccess) {
    // side effect triggered by successful query
  }
}, [query.isSuccess, query.data]);

useEffect(() => {
  if (query.isError) {
    toast.error(getErrorMessage(query.error));
  }
}, [query.isError, query.error]);
```

```tsx
// FORBIDDEN — v4 syntax, removed in v5
const query = useQuery({
  queryKey: ["users"],
  queryFn: fetchUsers,
  onSuccess: (data) => { ... },   // NOT SUPPORTED
  onError: (err) => { ... },      // NOT SUPPORTED
});
```

**Global query error handling — use `QueryCache` at client config:**

```ts
// lib/queryClient.ts
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "@packages/ui";
import { getErrorMessage } from "@packages/shared/errors";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      toast.error(`Query failed: ${getErrorMessage(error)}`);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 2,
    },
  },
});
```

**Mutations — `onSuccess` / `onError` / `onSettled` remain valid and are required:**

```ts
export function useUpdateAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateAccountData }) => {
      const response = await fetch(`/api/backend/admin/accounts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ message: "Failed to update account" }));
        throw new Error((errorData as { message?: string }).message ?? "Failed to update account");
      }
      return response.json() as Promise<UpdateAccountResponse>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}
```

**Mutation pattern requirements:**

- Always call `queryClient.invalidateQueries` in `onSuccess` with the domain prefix
- Always provide `onError` (either explicit per-mutation or via `MutationCache` at client level)
- Parse error body in `mutationFn` and throw with a user-readable message
- Never swallow errors silently

### 2.5 v5 terminology updates

| v4 term (deprecated/removed)                | v5 correct term                                                                          |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `cacheTime`                                 | `gcTime`                                                                                 |
| `useErrorBoundary`                          | `throwOnError`                                                                           |
| `keepPreviousData: true`                    | `placeholderData: keepPreviousData` (from `@tanstack/react-query`)                       |
| `isLoading` (v4 semantics)                  | `isPending && isFetching` (v5 semantics; `isLoading` still exported as derived flag)     |
| Query `onSuccess` / `onError` / `onSettled` | Removed — use `useEffect` with state flags or `QueryCache`/`QueryClient` global handlers |

D2 audit flags uses of v4 terminology as violations.

---

## 3. State Management

### 3.1 Decision table

| Need                                    | Solution                                         |
| --------------------------------------- | ------------------------------------------------ |
| Server data                             | `useQuery` / `useMutation` from TanStack Query   |
| Form input state                        | `useState` local to the form component           |
| UI toggle (expand/collapse, modal open) | `useState` local to the nearest parent           |
| Derived data from server state          | `useMemo` over query `data`                      |
| Cross-component theme/auth              | React Context (`ThemeProvider`, `QueryProvider`) |
| URL-driven state (filters, pagination)  | URL search params via `useSearchParams`          |
| Global client state (rare)              | External store (Zustand) only if justified       |

### 3.2 `useMemo` guidelines

Memoize derived data from query results, especially filtering and sorting:

```tsx
const accounts = useMemo(() => {
  if (!data) return [];
  let filtered = [...data];
  if (filters.search) {
    const q = filters.search.toLowerCase();
    filtered = filtered.filter(
      (a) => a.email.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
    );
  }
  filtered.sort((a, b) => {
    const aValue: string | number = a[filters.sortBy] ?? "";
    const bValue: string | number = b[filters.sortBy] ?? "";
    return filters.sortOrder === "asc"
      ? String(aValue).localeCompare(String(bValue))
      : String(bValue).localeCompare(String(aValue));
  });
  return filtered;
}, [data, filters]);
```

### 3.3 React Compiler note

**Next.js 16 ships with React Compiler (stable, 1.0 release).** When enabled (`reactCompiler: true` in `next.config.ts`), the compiler auto-memoizes components and hooks.

**If React Compiler is enabled in your app:**

- Manual `React.memo`, `useMemo`, `useCallback` are usually unnecessary
- The compiler handles stable references automatically
- Write code as if memoization didn't exist; let the compiler optimize

**If React Compiler is NOT enabled:**

- Follow the manual memoization rules in §6 (Performance)

Check your app's `next.config.ts` to know which regime applies. D2 audit treats manual memoization as neutral (not a violation) regardless.

### 3.4 Context guidelines

- Contexts are for truly global concerns: theme, auth session, query client
- Never use Context for server data — use TanStack Query
- Keep Context values stable with `useMemo` on the provider value (unless React Compiler is enabled)

---

## 4. TypeScript (frontend-specific)

For transversal rules (zero `any`, catch blocks, escape hatches), see `CODE_STANDARDS.md` §2.

### 4.1 Component prop types

Prefer `interface` for component props (consistent with React community norms):

```tsx
interface StatCardProps {
  label: string;
  value: string | number;
  trend?: { value: number; isPositive: boolean };
  icon?: ReactNode;
}

export function StatCard({ label, value, trend, icon }: StatCardProps) { ... }
```

Use `type` for unions, intersections, and mapped types:

```ts
type Status = "idle" | "loading" | "success" | "error";
type WithChildren<T> = T & { children: ReactNode };
```

### 4.2 Return type annotations

- `queryFn` functions: required explicit return type
- Hook return values: recommended when the shape is non-trivial (>2 fields or branded types)
- Component functions: not required (inferred `JSX.Element`)
- Utility functions: recommended

### 4.3 Event handler types

Use React's built-in types, not raw DOM types:

```tsx
// Correct
onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;

// Acceptable in handler body
const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.preventDefault();
};

// Forbidden
onClick: (event: any) => void;
onClick: Function;
```

---

## 5. Error Handling

### 5.1 Mutation error pattern

All user-facing mutations must show feedback on failure:

```tsx
const mutation = useUpdateAccount();

const handleSubmit = useCallback(
  (data: FormData) => {
    mutation.mutate(data, {
      onError: (error) => {
        toast({
          title: "Error",
          description: `Failed to update: ${getErrorMessage(error)}`,
          variant: "destructive",
        });
      },
      onSuccess: () => {
        toast({ title: "Account updated", variant: "success" });
      },
    });
  },
  [mutation]
);
```

Or centralize via `MutationCache` in `QueryClient` config for consistent global handling.

### 5.2 Query error display

Pages handle the error state from `useQuery`:

```tsx
if (error) {
  return (
    <div role="alert" aria-live="assertive">
      <p className="text-sm text-[var(--error)]">{getErrorMessage(error)}</p>
      <ActionButton variant="danger" size="sm" onClick={() => refetch()}>
        Retry
      </ActionButton>
    </div>
  );
}
```

### 5.3 Error boundaries

Wrap dashboard-level pages in React Error Boundaries to catch render errors:

```tsx
// app/(dashboard)/layout.tsx
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
```

---

## 6. Performance

**Note:** If React Compiler is enabled (Next 16 stable feature), most manual memoization becomes unnecessary. This section applies to codebases where the compiler is **not** enabled, or to hot paths where manual control is explicitly needed.

### 6.1 `React.memo` on pure components

Presentational components that receive props and render JSX without side effects can be wrapped in `React.memo`:

```tsx
export const StatCard = React.memo(function StatCard({ label, value, trend, icon }: StatCardProps) {
  return (
    <div className="rounded-lg border p-4">
      <span>{label}</span>
      <span>{value}</span>
      {trend && <TrendIndicator value={trend.value} isPositive={trend.isPositive} />}
    </div>
  );
});
```

### 6.2 `useCallback` requirements (without React Compiler)

Event handlers passed as props or used in dependency arrays must be wrapped in `useCallback`:

```tsx
// Correct
const handleView = useCallback((accountId: string) => {
  setExpandedAccountId((prev) => (prev === accountId ? null : accountId));
}, []);

// Forbidden (without React Compiler)
const handleView = (accountId: string) => {
  setExpandedAccountId(accountId);
};
```

### 6.3 Key prop rules

- Use stable, unique IDs for `key`: `key={account.id}`
- Never use array indices for lists that can be reordered, filtered, or mutated
- Skeleton/placeholder rows may use index-based keys: `key={\`skeleton-${String(index)}\`}`

### 6.4 `useEffectEvent` (React 19.2)

For effects that contain logic that should not trigger re-runs when dependencies change, extract with `useEffectEvent`:

```tsx
import { useEffect, useEffectEvent } from "react";

function Component({ onVisit }: Props) {
  const onVisitEvent = useEffectEvent((url: string) => {
    onVisit(url); // uses latest onVisit without requiring it in dep array
  });

  useEffect(() => {
    onVisitEvent(currentUrl);
  }, [currentUrl]); // only currentUrl triggers re-run
}
```

**Status:** recommended for new code, not required for existing code.

---

## 7. Code Organization (frontend-specific)

For transversal file naming and import ordering, see `CODE_STANDARDS.md` §5.

### 7.1 Folder structure (per app)

```
apps/<app>/
├── app/                          # Next.js App Router
│   ├── (dashboard)/              # Route group
│   ├── api/                      # API routes (proxies, webhooks)
│   └── layout.tsx, page.tsx
├── components/
│   ├── shared/                   # Cross-feature UI
│   ├── ui/                       # Design system primitives
│   └── <feature>/                # Feature-scoped components
├── hooks/
│   └── api/                      # TanStack Query hooks
├── lib/
│   ├── apiClient.ts              # Central fetch wrapper
│   └── utils/                    # Pure utilities
└── types/                        # Shared types
```

**Rule:** hooks that call backend live in `hooks/api/`. Hooks that don't call backend live in `hooks/`. Only one location per hook — do not duplicate.

### 7.2 Hook location policy (resolving current fragmentation)

The codebase currently has three parallel hook folders in `apps/client/` (documented in `LATERAL_FINDINGS.md`). Going forward:

**Canonical location:** `apps/client/hooks/api/` for data-fetching hooks, `apps/client/hooks/` for non-HTTP hooks.

**Legacy locations to migrate (per `CLIENT_LIB_HOOKS_AUDIT.md` §6 P2):**

- `apps/client/lib/hooks/` — migrate to canonical, then delete folder
- `apps/client/lib/api/hooks.ts` — merge into canonical
- `apps/client/components/{ai,instagram}/hooks/` — component-local, acceptable only if consumed by a single component

**D2 audit flags `lib/hooks/` and `lib/api/hooks.ts` usage as violation with known-migration reference.**

### 7.3 Constants and design tokens

- Colors: use CSS variables (`var(--accent)`, `var(--error)`), not hardcoded Tailwind colors when a token exists
- Spacing: Tailwind utilities (`p-6`, `gap-4`) are fine
- Complex classname maps: extract to module-scope constants (per `CODE_STANDARDS.md` §5.3)

---

## 8. Accessibility

### 8.1 ARIA checklist

Every interactive element must be accessible:

| Element             | Requirement                                                               |
| ------------------- | ------------------------------------------------------------------------- |
| Icon-only button    | `aria-label` describing the action                                        |
| Loading spinner     | `role="status"` + `aria-live="polite"` + `sr-only` text                   |
| Error message       | `role="alert"` + `aria-live="assertive"`                                  |
| Status indicator    | `role="status"` + `aria-live="polite"`                                    |
| Navigation          | `aria-label` on `<nav>` element                                           |
| Tabs                | `role="tablist"` on container, `role="tab"` + `aria-selected` on each tab |
| Current page link   | `aria-current="page"`                                                     |
| Decorative icon     | `aria-hidden="true"`                                                      |
| Expandable section  | `aria-expanded` on trigger                                                |
| Region with heading | `role="region"` + `aria-labelledby` pointing to heading ID                |

### 8.2 Examples

```tsx
// Accessible icon button
<ActionButton
  variant="primary"
  size="sm"
  onClick={() => refetch()}
  aria-label="Refresh dashboard data"
>
  <RefreshCw className="h-3.5 w-3.5" />
  Refresh
</ActionButton>

// Accessible loading state
<div role="status" aria-live="polite">
  <div className="animate-spin" aria-hidden="true" />
  <span className="sr-only">Loading...</span>
</div>
```

### 8.3 Form labels

- Every `<input>` must have an associated `<label>` with matching `htmlFor`/`id`
- Required fields: `aria-required="true"`
- Invalid fields: `aria-invalid="true"` + `aria-describedby` pointing to error message
- Error messages: `role="alert"` or `aria-live`

### 8.4 Focus management

- All interactive elements must be reachable via keyboard (`Tab`)
- Focus-visible styles: `focus-visible:ring-2 focus-visible:ring-[var(--accent)]`
- Modals must trap focus and return focus to the trigger on close
- Sidebar collapse toggle must have `aria-label` describing the current action

**Compliance target:** WCAG AA.

---

## 9. Testing (frontend)

See `CODE_STANDARDS.md` §6 for transversal minimums. Frontend-specific:

### 9.1 Component tests

- Use `@testing-library/react` with Vitest
- Test from the user's perspective (queries by role, label, text)
- Mock TanStack Query with `QueryClient` in test wrapper, not `jest.mock` of the hook
- Avoid testing implementation details (internal state, specific classNames)

### 9.2 Hook tests

- Use `renderHook` from `@testing-library/react`
- Wrap in `QueryClientProvider` for TanStack hooks
- Test loading / success / error transitions explicitly

### 9.3 E2E tests

- Playwright for critical user flows (login, publish, billing)
- Not required for every feature — focus on money paths and irreversible actions

---

## 10. Summary Checklist

Before merging any frontend PR:

- [ ] No file exceeds §1.1 size limits (or has documented reason)
- [ ] §1.2 Single Responsibility heuristics checked
- [ ] `"use client"` present only when hooks/events/browser APIs needed
- [ ] All data fetching in Client Components uses TanStack Query hooks
- [ ] Query keys follow `[domain, scope, ...params]`
- [ ] Mutations invalidate relevant query caches
- [ ] No `onSuccess`/`onError` on `useQuery` (removed in v5)
- [ ] `gcTime` used (not `cacheTime`)
- [ ] Zero `any` (see `CODE_STANDARDS.md` §2)
- [ ] All catch blocks use `unknown` + narrowing (see `CODE_STANDARDS.md` §2.3)
- [ ] All user-facing errors show a toast or inline error
- [ ] `useCallback` / `useMemo` applied per §6 (unless React Compiler handles it)
- [ ] Import order follows `CODE_STANDARDS.md` §5.2
- [ ] All interactive elements have ARIA labels (§8)
- [ ] All form inputs have associated labels
- [ ] CSS uses design tokens (`var(--...)`) not hardcoded colors when tokens exist

---

## Changelog v1 → v2

| #   | v1 rule                                                    | v2 change                                                     | Rationale                         |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------- |
| 1   | "onSuccess/onError in mutations" (ambiguous about queries) | Explicitly: removed from queries in v5, required in mutations | TanStack Query v5 breaking change |
| 2   | `staleTime`, no mention of `gcTime`                        | `gcTime` required (formerly `cacheTime`)                      | v5 terminology                    |
| 3   | Size limits mechanical only                                | Added §1.2 Single Responsibility semantic heuristics          | Edward decision 2026-04-18        |
| 4   | No Server Components mention                               | Added §1.4 Server vs Client Components                        | Next.js 16 App Router default     |
| 5   | React.memo/useCallback/useMemo unconditional               | Added React Compiler note (§3.3, §6)                          | Next 16 ships compiler stable     |
| 6   | Catch block example inline in "TypeScript" section         | Moved to `CODE_STANDARDS.md` §2.3 as transversal              | Avoid duplication with backend    |
| 7   | Zero `any` rule in frontend doc                            | Moved to `CODE_STANDARDS.md` §2.1 as transversal              | Same rule, both runtimes          |
| 8   | No mention of `useEffectEvent`                             | Added §6.4 as recommended                                     | React 19.2 feature                |
| 9   | Path conventions scattered                                 | Moved to `CODE_STANDARDS.md` §3                               | Consolidate with backend rules    |
| 10  | Hook folder fragmentation undocumented                     | §7.2 declares canonical location + migration path             | Resolve LATERAL_FINDINGS entry    |
| 11  | "console.log forbidden" as checklist item                  | Moved to `CODE_STANDARDS.md` §4.1                             | Transversal rule                  |
| 12  | "TODO/FIXME" not explicit                                  | Moved to `CODE_STANDARDS.md` §4.3                             | Transversal rule                  |
| 13  | No `@ts-ignore` / `@ts-expect-error` policy                | Moved to `CODE_STANDARDS.md` §2.4                             | Transversal rule                  |
| 14  | Stack header "Next.js 15"                                  | Updated to "Next.js 16, React 19.2, TanStack v5"              | Current stack                     |
