# Admin App Legacy Cleanup Report

**Date:** 2026-04-02

---

## Issues Found

### BLOCKING (2)

**B1 -- Legacy dashboard overrides sprint dashboard**

- **File:** `apps/admin/app/page.tsx` (310 lines)
- **Problem:** Pre-sprint Genesis dashboard (2026-03-08) using `useState`/`useEffect` and direct `api.admin.getDashboardStats()` calls. In Next.js, `app/page.tsx` takes priority over `app/(dashboard)/page.tsx` for the `/` route, so users always saw the legacy version instead of the sprint-built dashboard with auth guards, SidebarNav, and TanStack Query hooks.
- **Fix:** Deleted the file. `(dashboard)/page.tsx` now serves `/` through the route group, wrapped by `(dashboard)/layout.tsx` which provides auth verification, sidebar navigation, and ProjectProvider context.

**B2 -- Root layout renders legacy navbar**

- **File:** `apps/admin/app/layout.tsx` (19 lines)
- **Problem:** Hardcoded header with inline styles: `<a href="/">Admin</a> · <a href="/posts">Posts</a> · <a href="/logs">Logs</a> · <a href="/webhooks">Webhooks</a>`. This wrapped ALL routes including `(dashboard)/*`, causing users to see both the legacy navbar AND the sprint-built SidebarNav simultaneously. The `/posts` link pointed to a route that does not exist.
- **Fix:** Removed the `<header>` element and inline styles. Root layout is now a clean shell: `<html>`, `<body className="antialiased">`, `{children}`, `<Toaster>`. All navigation is handled by `(dashboard)/layout.tsx` → `SidebarNav`.

### VISUAL (0)

None beyond B2.

### DEAD (1)

**D1 -- `/posts` link with no page**

- The legacy navbar linked to `/posts` but no `(dashboard)/posts/page.tsx` exists. Resolved by removing the navbar (B2).

---

## Files Modified

| File                        | Change                                                                     |
| --------------------------- | -------------------------------------------------------------------------- |
| `apps/admin/app/layout.tsx` | Removed legacy navbar header and inline styles. Clean shell with Tailwind. |

## Files Deleted

| File                      | Lines | Reason                                                          |
| ------------------------- | ----- | --------------------------------------------------------------- |
| `apps/admin/app/page.tsx` | 310   | Legacy Genesis dashboard. Duplicated by `(dashboard)/page.tsx`. |

---

## Build: 0 errors, 9/9 tasks

## Result

- **localhost:3100 loads:** Sprint-built dashboard via `(dashboard)/page.tsx` with auth verification, SidebarNav, and ProjectProvider
- **Navigation shows:** Collapsible SidebarNav with grouped links (Dashboard, Platform: Accounts/Subscriptions/Pricing/Executive, Operations: Security/Compliance/Logs/Webhooks)
- **Legacy artifacts remaining:** 0
