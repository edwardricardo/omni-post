# Admin to Client Migration Guide

> Reference document for applying admin portal fixes and patterns to `apps/client`.
> Based on 10+ commits on `Genesis` branch (2026-04-06 to 2026-04-10).

---

## 1. Executive Summary

During the admin portal overhaul (commits `91aa3b0` through `40f797d`), multiple bugs were fixed and patterns established that also apply to the client app. This document maps each fix to the equivalent work needed in `apps/client`.

### State Comparison (verified 2026-04-10)

| Feature                          | Admin                                                      | Client                                                       | Gap                   |
| -------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ | --------------------- |
| Error handling (`parseApiError`) | `ApiError.fromResponse()` + message resolution             | Inline `ApiError` class, no message resolution               | **P0**                |
| Prisma Decimal wrapping          | All `Number()` wrapped                                     | Raw `.toFixed()` on Decimal strings                          | **P0**                |
| AccessDenied component           | Full component with i18n                                   | Missing                                                      | **P0**                |
| `tw-animate-css`                 | Imported in globals.css                                    | Imported in globals.css                                      | OK                    |
| `@source` directives             | Present                                                    | Present                                                      | OK                    |
| Dialog animation override CSS    | `[role="dialog"][data-state]` neutralizes slide            | Missing                                                      | **P1**                |
| `ui-safelist.ts`                 | Present, referenced by `@source`                           | Missing                                                      | **P1**                |
| Toaster positioning              | `AdminToaster` with inline `style`                         | Direct `@packages/ui` Toaster                                | **P1 (verify)**       |
| Token refresh in proxy           | Auto-refresh on 401 TOKEN_EXPIRED + retry                  | Clears cookies on 401 (no retry)                             | **P1**                |
| CSRF cookie                      | 3-cookie system (session, refresh, csrf)                   | 2-cookie system (session, refresh)                           | **P1 (evaluate)**     |
| CSS design tokens                | `--bg-surface`, `--text-primary`, `--accent`, etc.         | `--color-background`, `--color-foreground`, etc. (HSL-based) | **Different systems** |
| ThemeProvider (toggle)           | localStorage + `useTheme()` hook                           | No provider, relies on system `prefers-color-scheme`         | **P2**                |
| Reusable UI components           | ActionButton, Badge, StatCard, PageHeader, DataTable, etc. | Only `LoadingSpinner` locally                                | **P1**                |
| i18n (`next-intl`)               | Cookie-based, EN/ES                                        | None (English-only UI)                                       | **P2 (decide)**       |
| `useChartColors` SSR hook        | `resolveVar()` + theme context + fallback                  | Recharts used raw, no SSR guard                              | **P2**                |
| RBAC frontend pattern            | `isPermissionDenied()` + `AccessDenied` fallback           | No permission checks in UI                                   | **P2**                |

---

## 2. Critical Fixes (P0 -- Apply First)

### 2.1 Error Handling (`parseApiError`)

**Problem:** Client throws `ApiError` with raw error messages from the backend. No message resolution, no human-friendly fallbacks. Prisma errors or JSON blobs can reach the user.

**Admin pattern:** `apps/admin/lib/parseApiError.ts`

```
Exports: ApiError class, parseApiError(), getErrorMessage(), isPermissionDenied(), isNotFoundError()

Resolution hierarchy:
1. Known error code (PERMISSION_DENIED, TOKEN_EXPIRED, etc.) -> user-friendly message
2. Security-critical statuses (401/403) -> standard message (never raw server text)
3. Human-readable server message (< 200 chars, no JSON) -> pass through
4. Known HTTP status code -> mapped message
5. Server error (>= 500) -> generic "unexpected error"
6. Default fallback
```

**Client current state:** `apps/client/lib/api/types.ts` line 187-197

```typescript
// Current client ApiError -- basic, no message resolution
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: any
  ) {
    super(message);
    this.name = "ApiError";
  }
}
```

**Action:**

1. Create `apps/client/lib/parseApiError.ts` -- copy from admin, remove i18n dependency (admin version has no i18n, it's pure English strings)
2. Update `apps/client/lib/api/client.ts` line 50-62 to use `ApiError.fromResponse()`:

```typescript
// Current (inline error parsing):
if (!response.ok) {
  const errorData = await response.json().catch(() => ({ ... }));
  throw new ApiError(errorData.message || errorData.error, response.status, ...);
}

// Target (structured parsing):
if (!response.ok) {
  const body = await response.text();
  throw ApiError.fromResponse(response.status, body);
}
```

3. Update all `catch` blocks across hooks/components to use `getErrorMessage(err)` instead of `err.message`

**Scope:** ~165 components, ~40 hooks in `apps/client/`

---

### 2.2 Prisma Decimal Wrapping

**Problem:** Prisma ORM returns Decimal fields as strings (e.g., `"8.00"` not `8.00`). Calling `.toFixed()` on a string returns `"8.00"` without error, but `.toLocaleString()` treats it as a string, and arithmetic operations cause string concatenation.

**Admin fix pattern:**

```typescript
// WRONG -- value is a string from Prisma
bundle.pricePerAccountMonth.toFixed(2);

// CORRECT -- wrap with Number() first
Number(bundle.pricePerAccountMonth).toFixed(2);
```

Also applies to mutation data sent to Zod validators:

```typescript
// WRONG -- sends string "8.00" to Zod which expects number
{
  pricePerMonth: editForm.pricePerMonth;
}

// CORRECT -- coerce to number
{
  pricePerMonth: Number(editForm.pricePerMonth);
}
```

**Action:**

1. Search for `.toFixed(` and `.toLocaleString(` in `apps/client/`
2. Wrap each instance with `Number()` where the source data comes from an API response that may contain Prisma Decimal fields
3. Fields to watch: any price, amount, rate, percentage, multiplier, revenue, or cost field

**Ref:** Admin commit `7b510bb`, memory file `project_backlog_decimal_fix.md`

---

### 2.3 AccessDenied Component

**Problem:** Client has no way to gracefully handle 403 responses. When a user lacks permission, the page either crashes or shows a generic error.

**Admin pattern:** `apps/admin/components/shared/AccessDenied.tsx`

- ShieldOff icon + heading + description + action buttons (Go to Dashboard / Go Back)
- Uses `useTranslations("errors")` for i18n (client will need hardcoded strings or its own i18n)
- Uses CSS vars: `--error`, `--error-subtle`, `--accent`, `--bg-elevated`, `--border-default`, `--text-primary/secondary/tertiary`

**Action:**

1. Create `apps/client/components/shared/AccessDenied.tsx`
2. Since client has no i18n, use hardcoded English strings
3. Adapt CSS vars to client's token system (e.g., `--error` -> `var(--destructive)` or hardcoded hex)
4. Wire into pages that call protected endpoints: check for 403 status in query error handler

---

## 3. Dialog/Toast/Animation (P1)

### 3.1 tw-animate-css -- OK, no action needed

Client already has `@import 'tw-animate-css'` at line 2 of `apps/client/app/globals.css`.

### 3.2 Dialog Animation Override -- MISSING

**Problem:** Radix UI v1.4.3 removed `data-radix-*` attributes. Without this CSS override, Dialog/AlertDialog components have an unwanted slide animation on open/close.

**Admin fix:** `apps/admin/app/globals.css` lines 181-187

```css
/* Dialog / AlertDialog -- fade+zoom only, neutralize directional slide */
[role="dialog"][data-state],
[role="alertdialog"][data-state] {
  --tw-enter-translate-x: 0 !important;
  --tw-enter-translate-y: 0 !important;
  --tw-exit-translate-x: 0 !important;
  --tw-exit-translate-y: 0 !important;
}
```

**Action:** Add this CSS block to `apps/client/app/globals.css` after the base layer rules.

### 3.3 @source Directives -- OK, no action needed

Client already has `@source '../../packages/ui/src/**/*.{ts,tsx}'` at line 6 of `apps/client/app/globals.css`.

### 3.4 ui-safelist.ts -- MISSING

**Problem:** The Tailwind v4 `@source` scanner cannot resolve all classes from pnpm workspace symlinked packages. Dialog overlay, Toast viewport, and AlertDialog classes may be missing from the generated CSS, causing invisible components.

**Admin fix:** `apps/admin/lib/ui-safelist.ts` -- a file that exports string constants containing all Tailwind classes used by `@packages/ui` components (Dialog, AlertDialog, Toast). Referenced via `@source "../lib/ui-safelist.ts"` in globals.css.

**Action:**

1. Create `apps/client/lib/ui-safelist.ts` -- copy from admin (same `@packages/ui` components)
2. Add `@source '../lib/ui-safelist.ts';` to `apps/client/app/globals.css` (after existing `@source` directives)

### 3.5 Toaster Positioning -- VERIFY

**Problem:** Admin had invisible toasts because Tailwind didn't generate the ToastViewport positioning classes. Fixed with a custom `AdminToaster` component that uses inline `style` props.

**Admin fix:** `apps/admin/components/ui/AdminToaster.tsx`

```tsx
<ToastViewport
  className="fixed flex flex-col gap-2 p-4"
  style={{
    top: "1rem",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 100,
    maxWidth: "420px",
    width: "100%",
  }}
/>
```

**Client state:** Uses `Toaster` directly from `@packages/ui` in `apps/client/app/providers.tsx` line 33.

**Action:**

1. Build the client and verify toasts appear correctly
2. If toasts are invisible or mispositioned, create `apps/client/components/ui/ClientToaster.tsx` following the admin pattern
3. Replace the `<Toaster />` import in `providers.tsx` with the custom component

---

## 4. Authentication & Proxy (P1)

### 4.1 Token Refresh in Proxy -- MISSING AUTO-REFRESH

**Problem:** Client proxy clears cookies on 401 but does NOT attempt to refresh the token and retry the original request. Users get logged out on every token expiration instead of seamless refresh.

**Admin pattern:** `apps/admin/app/api/backend/[...path]/route.ts`

```
1. Request fails with 401
2. Parse error body, check if code === "TOKEN_EXPIRED"
3. If TOKEN_EXPIRED:
   a. Call attemptTokenRefresh() -- POST to /admin/auth/refresh with refresh + csrf tokens
   b. If refresh succeeds, update session cookie, retry original request
   c. If refresh fails, pass through 401
4. If not TOKEN_EXPIRED, pass through 401
```

**Client current state:** `apps/client/app/api/backend/[...path]/route.ts`

- `handleRefreshResponse()` at line 127-156 only handles explicit calls to the refresh endpoint
- No interceptor for 401 on regular API calls
- On refresh failure (401), calls `clearAuthCookies()` -- correct behavior for that case
- Missing: automatic token refresh + retry on regular API 401s

**Action:**

1. Add `attemptTokenRefresh()` function to client proxy (adapt admin pattern):
   - Read `customer-refresh` cookie
   - POST to `/auth/customer/refresh` with refresh token
   - On success, update `customer-session` cookie, return new token
2. Add 401 interception in the main `proxy()` function:
   - After upstream returns 401, check for TOKEN_EXPIRED
   - Call `attemptTokenRefresh()`
   - Retry original request with new token
3. Key differences from admin:
   - Cookie names: `customer-session` / `customer-refresh` (not `admin-session` / `admin-refresh`)
   - Refresh endpoint: `/auth/customer/refresh` (not `/admin/auth/refresh`)
   - No CSRF token in client (2-cookie system vs admin's 3-cookie)

### 4.2 CSRF Protection -- EVALUATE

**Admin:** Uses 3-cookie system (`admin-session`, `admin-refresh`, `admin-csrf`). The CSRF token is required for refresh and sensitive operations.

**Client:** Uses 2-cookie system (`customer-session`, `customer-refresh`). No CSRF cookie.

**Decision needed:** Is CSRF protection necessary for the client? Consider:

- Client operations are user-scoped (not admin-level destructive)
- `SameSite=lax` cookies provide some CSRF protection
- If adding CSRF: create a `customer-csrf` cookie, include in refresh/logout requests

---

## 5. Design System & UI Components (P1)

### 5.1 CSS Design Tokens -- DIFFERENT SYSTEMS

The two apps use completely different token naming conventions:

| Concept           | Admin Token                            | Client Token                                  |
| ----------------- | -------------------------------------- | --------------------------------------------- |
| Page background   | `--bg-surface` (#ffffff / #111111)     | `--background` (HSL: 0 0% 100%)               |
| Text color        | `--text-primary` (#0a0a0a / #f0f0f0)   | `--foreground` (HSL: 222.2 84% 4.9%)          |
| Accent/primary    | `--accent` (#2563eb / #3b82f6)         | `--primary` (HSL: 221.2 83.2% 53.3%)          |
| Error/destructive | `--error` (#dc2626 / #ef4444)          | `--destructive` (HSL: 0 84.2% 60.2%)          |
| Border            | `--border-default` (#e5e5e5 / #2a2a2a) | `--border` (HSL: 214.3 31.8% 91.4%)           |
| Muted text        | `--text-secondary` (#6b6b6b / #888888) | `--muted-foreground` (HSL: 215.4 16.3% 46.9%) |

**Key difference:** Admin uses hex values directly. Client uses HSL values wrapped with `hsl()` in the `@theme` block.

**Admin bridge:** Admin's `@theme inline` block maps admin tokens to Tailwind's expected names:

```css
@theme inline {
  --color-background: var(--bg-surface);
  --color-foreground: var(--text-primary);
  --color-destructive: var(--error);
  /* ... */
}
```

**Decision:** Do NOT unify tokens now. When copying admin components to client, replace CSS var references:

| Admin reference         | Client equivalent                                               |
| ----------------------- | --------------------------------------------------------------- |
| `var(--bg-surface)`     | `hsl(var(--background))` or `bg-background` class               |
| `var(--text-primary)`   | `hsl(var(--foreground))` or `text-foreground` class             |
| `var(--accent)`         | `hsl(var(--primary))` or `text-primary` class                   |
| `var(--error)`          | `hsl(var(--destructive))` or `text-destructive` class           |
| `var(--border-default)` | `hsl(var(--border))` or `border-border` class                   |
| `var(--text-secondary)` | `hsl(var(--muted-foreground))` or `text-muted-foreground` class |
| `var(--bg-elevated)`    | `hsl(var(--muted))` or `bg-muted` class                         |
| `var(--success)`        | No equivalent -- add `--success` token or use hardcoded green   |
| `var(--warning)`        | No equivalent -- add `--warning` token or use hardcoded amber   |

### 5.2 ThemeProvider (Dark/Light Toggle)

**Admin pattern:** `apps/admin/providers/ThemeProvider.tsx`

- Exports `ThemeProvider` and `useTheme()` hook
- Stores preference in `localStorage` under key `"admin-theme"`
- Toggles `.dark` class on `document.documentElement`
- Default: dark

**Client state:** CSS `.dark` class is defined with full token values, but no ThemeProvider exists. Dark mode is only active if something else adds `.dark` to the HTML element.

**Action:** Create `apps/client/providers/ClientThemeProvider.tsx`:

- Same pattern as admin
- Storage key: `"client-theme"` (not `"admin-theme"`)
- Default: light (client-facing app convention)
- Wire into layout provider tree

### 5.3 Reusable UI Components

Admin has custom components that client will need. Options per component:

| Component        | Admin path                             | Recommendation                                            |
| ---------------- | -------------------------------------- | --------------------------------------------------------- |
| `ActionButton`   | `components/ui/ActionButton.tsx`       | Move to `@packages/ui` (generic loading button)           |
| `Badge`          | `components/ui/Badge.tsx`              | `@packages/ui` already has `badge.tsx` -- verify variants |
| `StatCard`       | `components/ui/StatCard.tsx`           | Duplicate in client (admin-specific layout)               |
| `PageHeader`     | `components/ui/PageHeader.tsx`         | Duplicate in client (different nav structure)             |
| `DataTable`      | `components/ui/DataTable.tsx`          | Move to `@packages/ui` (generic table pattern)            |
| `Pagination`     | `components/ui/Pagination.tsx`         | Move to `@packages/ui`                                    |
| `ConfirmDialog`  | `components/ui/ConfirmDialog.tsx`      | Move to `@packages/ui`                                    |
| `InputDialog`    | `components/ui/InputDialog.tsx`        | Move to `@packages/ui`                                    |
| `LoadingSpinner` | `components/shared/LoadingSpinner.tsx` | Client already has one                                    |
| `TabNav`         | `components/ui/TabNav.tsx`             | Duplicate in client (different styling)                   |

**Recommended approach:** Move `ActionButton`, `DataTable`, `Pagination`, `ConfirmDialog`, and `InputDialog` to `@packages/ui`. Keep app-specific components (StatCard, PageHeader, TabNav) as duplicates.

---

## 6. Internationalization (P2 -- Decision Required)

### 6.1 next-intl Setup

**Admin pattern:**

- `next-intl@4.9.0` with cookie-based locale detection
- Cookie: `NEXT_LOCALE` (set by language switcher)
- Supported locales: `["en", "es"]`
- Server config: `apps/admin/i18n/request.ts` reads cookie via `cookies()` from `next/headers`
- Message files: `apps/admin/messages/en.json`, `apps/admin/messages/es.json`
- No URL routing (`/en/`, `/es/`) -- locale is cookie-only

**Client state:** No i18n infrastructure. All UI strings are hardcoded in English. Data-level locale exists for posts (`locale: "es" | "en"`).

**Decision needed:** Does client need multi-language UI?

If yes:

1. Install `next-intl` in `apps/client`
2. Create `apps/client/i18n/request.ts` (copy admin pattern)
3. Create message files `apps/client/messages/{en,es}.json`
4. Add `NextIntlClientProvider` to layout
5. Replace all hardcoded strings with `useTranslations()` calls (~165 components)
6. Add language switcher component

If no: Keep English-only, use hardcoded strings for new components (AccessDenied, etc.)

---

## 7. Charts -- Recharts (P2)

### 7.1 useChartColors Hook (SSR-safe)

**Problem:** Recharts needs concrete color values for SVG `fill`/`stroke`, but CSS custom properties don't resolve in SVG attributes. Without an SSR guard, `getComputedStyle()` throws on the server.

**Admin pattern:** `apps/admin/hooks/useChartColors.ts`

```typescript
function resolveVar(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Uses mounted state to ensure client-side only
// Re-computes on theme toggle via useTheme() dependency
```

**Client state:** Recharts v2.15.0 installed, used in `apps/client/app/dashboard/analytics/page.tsx`. Colors likely hardcoded or using raw CSS var references (which don't work in SVG).

**Action:**

1. Create `apps/client/hooks/useChartColors.ts`
2. Adapt token names to client system:
   - `--accent` -> `--primary` (resolve from HSL)
   - `--success` -> needs custom token or hardcoded `#22c55e`
   - `--error` -> `--destructive` (resolve from HSL)
3. Since client has no ThemeProvider yet, skip theme dependency initially (or add after 5.2)
4. Conversion needed: client tokens are HSL values, `getComputedStyle` returns HSL -- may need `hsl()` wrapping for Recharts

### 7.2 Abstract Chart Components

Admin has: `DonutChart`, `HorizontalBarChart`, `StackedBarChart`, `TrendAreaChart`, `ChartEmptyState`

**Recommendation:** Only abstract if client analytics grows beyond the single page. For now, keep raw Recharts usage but add the `useChartColors` hook for SSR safety.

---

## 8. RBAC & Permissions (P2)

### 8.1 Client Permission Model

**Key difference:** Admin uses role-based permissions (SUPER_ADMIN, ADMIN, MODERATOR, SUPPORT, VIEWER) with 15 granular permissions. Client uses customer roles that are project-scoped (owner, member, viewer).

**Reusable patterns:**

- `isPermissionDenied()` helper from `parseApiError` (same function, both apps)
- `AccessDenied` component (adapted for client tokens)
- Frontend permission check pattern:

```typescript
// In page/component:
if (error) {
  if (isPermissionDenied(error)) {
    return <AccessDenied />;
  }
  // other error handling
}
```

**Not reusable:**

- Admin RBAC routes/hooks (different endpoint structure)
- Admin role hierarchy (irrelevant to customer roles)
- `requirePermission` middleware (admin-specific)

---

## 9. Migration Checklist

| #   | Item                                  | Priority | Client Status       | Files to Create/Modify                                 | Admin Reference                            | Status |
| --- | ------------------------------------- | -------- | ------------------- | ------------------------------------------------------ | ------------------------------------------ | ------ |
| 1   | `parseApiError.ts`                    | P0       | Missing             | `lib/parseApiError.ts`, `lib/api/client.ts`            | `admin/lib/parseApiError.ts`               | TODO   |
| 2   | Prisma Decimal `Number()` wrapping    | P0       | Raw strings         | All components with `.toFixed()` / `.toLocaleString()` | Commit `7b510bb`                           | TODO   |
| 3   | `AccessDenied` component              | P0       | Missing             | `components/shared/AccessDenied.tsx`                   | `admin/components/shared/AccessDenied.tsx` | TODO   |
| 4   | Dialog animation override CSS         | P1       | Missing             | `app/globals.css`                                      | `admin/app/globals.css:181-187`            | TODO   |
| 5   | `ui-safelist.ts`                      | P1       | Missing             | `lib/ui-safelist.ts`, `app/globals.css`                | `admin/lib/ui-safelist.ts`                 | TODO   |
| 6   | Toaster positioning (verify)          | P1       | Unverified          | Possibly `components/ui/ClientToaster.tsx`             | `admin/components/ui/AdminToaster.tsx`     | TODO   |
| 7   | Token refresh + retry in proxy        | P1       | Only clears cookies | `app/api/backend/[...path]/route.ts`                   | `admin/app/api/backend/[...path]/route.ts` | TODO   |
| 8   | CSRF cookie evaluation                | P1       | No CSRF             | Proxy route                                            | Admin 3-cookie pattern                     | DECIDE |
| 9   | Reusable components to `@packages/ui` | P1       | Missing             | `packages/ui/src/components/`                          | Admin `components/ui/`                     | TODO   |
| 10  | `ThemeProvider`                       | P2       | No toggle           | `providers/ClientThemeProvider.tsx`                    | `admin/providers/ThemeProvider.tsx`        | TODO   |
| 11  | i18n decision                         | P2       | No i18n             | Multiple files if yes                                  | `admin/i18n/`, `admin/messages/`           | DECIDE |
| 12  | `useChartColors` SSR hook             | P2       | Raw Recharts        | `hooks/useChartColors.ts`                              | `admin/hooks/useChartColors.ts`            | TODO   |
| 13  | RBAC frontend pattern                 | P2       | No checks           | Pages with protected data                              | Admin page error handlers                  | TODO   |

### Execution Order

```
Phase 1 (P0): Items 1, 2, 3
Phase 2 (P1): Items 4, 5, 6 -> 7 -> 8, 9
Phase 3 (P2): Items 10, 11, 12, 13
```

Items within the same phase can be parallelized. Item 7 (proxy refresh) should be done before 8 (CSRF evaluation). Item 6 depends on a build verification.
