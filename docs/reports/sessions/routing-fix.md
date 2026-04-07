# Routing Fix Report

Date: 2026-03-31

## Problem 1 — Admin /auth/login to /login

Root cause: All redirect paths used `/auth/login` but the login page lives at `app/(auth)/login/page.tsx`. In Next.js, route groups `(auth)` do not appear in the URL — the actual URL is `/login`, not `/auth/login`. Every redirect sent users to a non-existent route, causing 404.

Files modified:

- `apps/admin/app/(dashboard)/layout.tsx` — lines 23, 26: `redirect("/auth/login")` changed to `redirect("/login")`
- `apps/admin/app/actions/auth.ts` — line 132: `redirect("/auth/login")` changed to `redirect("/login")`
- `apps/admin/proxy.ts` — lines 12, 19: PUBLIC_PATHS and redirect URL changed to `/login`

Files NOT modified (correctly reference API endpoints, not page routes):

- `apps/admin/lib/apiClient.ts:300` — POST `/auth/login` is the backend API endpoint
- `apps/admin/lib/auth/backend-client.ts:90` — fetch to `/admin/auth/login` API

## Problem 2 — Client root legacy page to redirect

Root cause: `apps/client/app/page.tsx` was a full provider dashboard page (ProviderCard, health checks, etc.) from before the app separation sprint. Unauthenticated users landed on this page instead of being redirected to login.

Files modified:

- `apps/client/app/page.tsx` — replaced 100+ line legacy dashboard with `redirect("/login")`

## Build

TypeScript build: 0 errors, 9/9 tasks
