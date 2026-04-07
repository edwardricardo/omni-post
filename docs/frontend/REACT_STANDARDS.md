# React Standards for OmniPost Frontend

**Applies to:** `apps/admin`, `apps/client`
**Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn/ui (`@packages/ui`)
**Last updated:** 2026-04-03

---

## 1. Component Architecture

### Size Limits

| Artifact           | Max Lines | Action when exceeded                     |
| ------------------ | --------- | ---------------------------------------- |
| Component (`.tsx`) | 200       | Extract child components or custom hooks |
| Page file          | 800       | Split into feature components            |
| Custom hook        | 150       | Decompose into smaller hooks             |
| Utility file       | 200       | Split by domain concern                  |

### Page vs Component Responsibilities

Pages own layout, data orchestration, and error boundaries. Components own rendering, local interaction state, and presentation logic. A page should never contain inline `<table>` markup or complex conditional rendering -- extract a component.

```tsx
// CORRECT -- page delegates to components
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
```

```tsx
// INCORRECT -- page renders everything inline
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

**Why it matters:** Small, focused components are easier to test, review, and optimize with `React.memo`. Pages that balloon past 800 lines become unreadable and unmaintainable.

### Composition Patterns

Use reusable UI primitives from `apps/admin/components/ui/`:

- `PageHeader` -- title + description + action slot
- `StatCard` -- label + value + trend + icon
- `DataTable<T>` -- generic table with skeleton, empty state, row click
- `ActionButton` -- primary / secondary / danger with loading state
- `Badge` -- semantic pill (success, warning, error, info, neutral)
- `TabNav` -- horizontal tabs with ARIA roles
- `ConfirmDialog` -- accessible confirm/cancel modal
- `InputDialog` -- accessible text input modal
- `LoadingSpinner` -- accessible spinner with screen reader label

---

## 2. Data Fetching

### TanStack Query Is the Only Data Fetching Method

Every API call in client components goes through a custom hook built on `useQuery` or `useMutation`. No raw `useEffect` + `fetch` + `useState` patterns.

### Query Key Convention

All query keys follow a hierarchical array structure: `[domain, scope, ...params]`.

```ts
// Examples from the codebase
["dashboard", "stats"][("accounts", "summary")][("subscriptions", "summary")][
  ("security", "overview")
][("compliance", "overview")][("audit", "logs", filters)][
  ("webhooks", "metrics", timeRange, selectedProvider)
][("executive", "summary", timeRange)][("billing", "stats")][("pricing", "tiers")][
  ("usage-metrics", accountId, year, month)
][("account", "billing", accountId)];
```

**Rules:**

- First element is the domain (`dashboard`, `accounts`, `webhooks`, etc.)
- Second element is the scope (`summary`, `overview`, `metrics`, etc.)
- Additional elements are parameters that affect the query
- Mutations invalidate by domain prefix: `queryKey: ["accounts"]` invalidates all account queries

### Standard Query Hook Template

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

      if (!response.ok) {
        throw new Error("Failed to fetch dashboard stats");
      }

      return response.stats;
    },
    refetchInterval: 60000,
    staleTime: 30000,
    retry: 2,
  });
}
```

**Pattern requirements:**

- Explicit return type annotation on `queryFn`
- Check `response.ok` and throw descriptive `Error` on failure
- Set `staleTime` appropriate to data volatility
- Set `retry` for transient failures (default: 2)
- Use `enabled` when the query depends on a parameter: `enabled: !!accountId`

### Standard Mutation Hook Template

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
  });
}
```

**Pattern requirements:**

- Always call `queryClient.invalidateQueries` in `onSuccess` with the domain prefix
- Parse error body in `mutationFn` and throw with a user-readable message
- Never swallow errors silently

```ts
// INCORRECT -- no cache invalidation, no error parsing
export function useUpdateAccount() {
  return useMutation({
    mutationFn: async (data: unknown) => {
      await fetch("/api/backend/admin/accounts/123", {
        method: "PUT",
        body: JSON.stringify(data),
      });
    },
  });
}
```

**Why it matters:** TanStack Query provides automatic caching, deduplication, background refetching, and error retry. Rolling your own fetch-in-useEffect loses all of this and introduces stale data bugs.

---

## 3. State Management

### When to Use What

| Need                                    | Solution                                         |
| --------------------------------------- | ------------------------------------------------ |
| Server data                             | `useQuery` / `useMutation` from TanStack Query   |
| Form input state                        | `useState` local to the form component           |
| UI toggle (expand/collapse, modal open) | `useState` local to the nearest parent           |
| Derived data from server state          | `useMemo` over query `data`                      |
| Cross-component theme/auth              | React Context (`ThemeProvider`, `QueryProvider`) |
| URL-driven state (filters, pagination)  | URL search params via Next.js `useSearchParams`  |

### useMemo Guidelines

Use `useMemo` when computing derived data from query results, especially for filtering and sorting:

```tsx
// CORRECT -- memoize expensive filter/sort over server data
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
    let aValue: string | number = a[filters.sortBy] ?? "";
    let bValue: string | number = b[filters.sortBy] ?? "";
    return filters.sortOrder === "asc"
      ? String(aValue).localeCompare(String(bValue))
      : String(bValue).localeCompare(String(aValue));
  });
  return filtered;
}, [data, filters]);
```

```tsx
// INCORRECT -- recomputes on every render
const accounts = data?.filter((a) => a.name.includes(search)).sort(/*...*/);
```

**Why it matters:** Without `useMemo`, every parent re-render recomputes the list and causes child components to re-render even when the data has not changed.

### Context Guidelines

- Contexts are for truly global concerns: theme, auth session, query client
- Never use Context for server data -- use TanStack Query instead
- Keep Context values stable with `useMemo` on the provider value

---

## 4. TypeScript

### Zero `any` Rule

No `any` in any frontend file. Use proper types, `unknown` with type guards, or generics.

```ts
// CORRECT -- typed sort values
let aValue: string | number = a[filters.sortBy] ?? "";
let bValue: string | number = b[filters.sortBy] ?? "";
```

```ts
// INCORRECT -- any in sort comparison
let aValue: any = a[filters.sortBy];
let bValue: any = b[filters.sortBy];
```

**Why it matters:** `any` disables TypeScript's type checking, which means bugs that the compiler would catch become runtime errors.

### Type Guard Patterns

```ts
// Error narrowing
catch (err) {
  const message = err instanceof Error ? err.message : "Unknown error";
  toast({ title: "Error", description: message, variant: "destructive" });
}

// Response body narrowing
const json = (await res.json()) as { ok: boolean; data?: SomeType };
if (!json.ok || !json.data) {
  throw new Error("Failed to fetch data");
}
return json.data; // narrowed to SomeType
```

### Return Types

All `queryFn` functions must have explicit return type annotations:

```ts
queryFn: async (): Promise<DashboardStats> => {
  /* ... */
};
```

---

## 5. Error Handling

### Mutation Error Pattern

All user-facing mutations must show a toast on failure:

```tsx
const handleAction = useCallback(async () => {
  try {
    const res = await fetch(url, { method: "PUT" /* ... */ });
    if (!res.ok) {
      const err = await res.text().catch(() => "Unknown error");
      throw new Error(err);
    }
    await refetch();
  } catch (err) {
    toast({
      title: "Error",
      description: `Failed to update: ${err instanceof Error ? err.message : "Unknown error"}`,
      variant: "destructive",
    });
  }
}, [refetch]);
```

```tsx
// INCORRECT -- error is swallowed
const handleAction = async () => {
  await fetch(url, { method: "PUT" });
  refetch();
};
```

**Why it matters:** Users must always receive feedback when an operation fails. Silent failures leave them confused about whether their action succeeded.

### Query Error Display

Pages must handle the error state from `useQuery`:

```tsx
if (error) {
  return (
    <div role="alert" aria-live="assertive">
      <p className="text-sm text-[var(--error)]">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <ActionButton variant="danger" size="sm" onClick={() => refetch()}>
        Retry
      </ActionButton>
    </div>
  );
}
```

### Try/Catch Requirements

- Every `await fetch()` call must be inside a `try/catch`
- Every `catch` must type the error as `unknown` (TypeScript default) and narrow with `instanceof Error`
- Never use empty catch blocks

---

## 6. Performance

### React.memo on Pure Components

Presentational components that receive props and render JSX without side effects should be wrapped in `React.memo` or kept as simple function declarations that React can optimize:

```tsx
// Pure presentational component -- stable across re-renders
export function StatCard({ label, value, trend, icon }: StatCardProps) {
  return (
    <div className="rounded-lg border p-4">
      <span>{label}</span>
      <span>{value}</span>
      {trend && <TrendIndicator value={trend.value} isPositive={trend.isPositive} />}
    </div>
  );
}
```

### useCallback Requirements

All event handlers passed as props or used in dependency arrays must be wrapped in `useCallback`:

```tsx
// CORRECT -- stable reference across re-renders
const handleView = useCallback((accountId: string) => {
  setExpandedAccountId((prev) => (prev === accountId ? null : accountId));
}, []);

const handleEdit = useCallback((account: Account) => {
  setEditForm({ name: account.name, isActive: account.isActive });
  setEditingAccountId(account.id);
}, []);
```

```tsx
// INCORRECT -- new function reference every render
const handleView = (accountId: string) => {
  setExpandedAccountId(accountId);
};
```

**Why it matters:** Without `useCallback`, child components receive a new function reference on every parent render, defeating `React.memo` and causing unnecessary re-renders.

### Key Prop Rules

- Always use stable, unique IDs for `key` props: `key={account.id}`
- Never use array indices for lists that can be reordered, filtered, or mutated
- Skeleton/placeholder rows may use index-based keys: `key={\`skeleton-${String(index)}\`}`

---

## 7. Code Organization

### File Naming

| Type            | Convention                      | Example                      |
| --------------- | ------------------------------- | ---------------------------- |
| React component | `PascalCase.tsx`                | `StatCard.tsx`               |
| Custom hook     | `camelCase.ts`                  | `useDashboardStats.ts`       |
| Utility         | `kebab-case.ts`                 | `format-utils.ts`            |
| Page            | `page.tsx` (Next.js convention) | `app/(dashboard)/page.tsx`   |
| Layout          | `layout.tsx`                    | `app/(dashboard)/layout.tsx` |
| Server Action   | `camelCase.ts`                  | `auth.ts` in `app/actions/`  |

### Import Ordering

Imports must follow this order, separated by blank lines:

1. React / Next.js (`react`, `next/navigation`, `next/headers`)
2. External libraries (`@tanstack/react-query`, `lucide-react`, `@packages/ui`)
3. Internal project imports (`@/hooks/api/...`, `@/components/...`, `@/lib/...`)
4. Types (if separate from their source)

```tsx
// CORRECT
"use client";

import React, { useCallback, useMemo, useState } from "react";
import { toast } from "@packages/ui";
import { RefreshCw, Users } from "lucide-react";

import { useAccounts } from "@/hooks/api/useAccounts";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
```

### Constants Extraction

Hardcoded strings and configuration objects must be extracted to module-level constants:

```tsx
// CORRECT -- extracted to module scope
const VARIANT_CLASSES: Record<BadgeProps["variant"], string> = {
  success: "bg-[var(--success-subtle)] text-[var(--success)]",
  warning: "bg-[var(--warning-subtle)] text-[var(--warning)]",
  error: "bg-[var(--error-subtle)] text-[var(--error)]",
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      /* ... */
    ],
  },
  {
    label: "Platform",
    items: [
      /* ... */
    ],
  },
];
```

```tsx
// INCORRECT -- inline object recreated every render
<Badge className={status === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
```

### Shared Utilities

Common formatting functions (dates, currency, percentages) must live in shared utility files under `lib/`, not duplicated across components.

---

## 8. Accessibility

### ARIA Label Checklist

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

```tsx
// CORRECT -- accessible icon button
<ActionButton
  variant="primary"
  size="sm"
  onClick={() => refetch()}
  aria-label="Refresh dashboard data"
>
  <RefreshCw className="h-3.5 w-3.5" />
  Refresh
</ActionButton>
```

```tsx
// CORRECT -- accessible loading state
<div role="status" aria-live="polite">
  <div className="animate-spin" aria-hidden="true" />
  <span className="sr-only">Loading...</span>
</div>
```

```tsx
// INCORRECT -- no accessible label
<button onClick={refetch}>
  <RefreshCw className="h-4 w-4" />
</button>
```

### Form Label Requirements

- Every `<input>` must have an associated `<label>` with matching `htmlFor`/`id`
- Required fields must have `aria-required="true"`
- Invalid fields must have `aria-invalid="true"` and `aria-describedby` pointing to the error message
- Error messages use `role="alert"` or `aria-live`

```tsx
// CORRECT -- properly labeled form field
<label htmlFor="email" className="block text-sm font-medium">
  Email address
</label>
<input
  id="email"
  name="email"
  type="email"
  required
  aria-label="Email address"
  aria-required="true"
/>
```

### Focus Management

- All interactive elements must be reachable via keyboard (`Tab`)
- Focus-visible styles must use `focus-visible:ring-2 focus-visible:ring-[var(--accent)]`
- Modals must trap focus and return focus to the trigger on close
- The sidebar collapse toggle must have an `aria-label` describing the current action

**Why it matters:** Accessibility compliance (WCAG AA) is a project requirement. Screen reader users, keyboard-only users, and users with motor impairments depend on correct ARIA attributes and focus management to use the application.

---

## Summary Checklist

Before merging any frontend PR, verify:

- [ ] No file exceeds its size limit (200 lines component, 800 lines page)
- [ ] All data fetching uses TanStack Query hooks
- [ ] Query keys follow `[domain, scope, ...params]` convention
- [ ] Mutations invalidate relevant query caches
- [ ] Zero `any` types
- [ ] All `catch` blocks narrow errors with `instanceof Error`
- [ ] All user-facing errors show a toast or inline error
- [ ] `useCallback` wraps all handlers passed as props or in deps arrays
- [ ] `useMemo` wraps all derived/filtered/sorted data
- [ ] Import order follows the convention
- [ ] All interactive elements have ARIA labels
- [ ] All form inputs have associated labels
- [ ] All loading states have `role="status"` and screen reader text
- [ ] CSS uses design tokens (`var(--...)`) not hardcoded colors
