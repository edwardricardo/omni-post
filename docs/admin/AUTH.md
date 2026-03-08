# Admin Authentication Architecture

## Overview

OmniPost Admin uses **Server Actions + httpOnly cookies + backend JWT** for authentication. There is no NextAuth.js -- the system uses a direct integration with the Fastify backend API.

| Aspect            | Detail                                                    |
| ----------------- | --------------------------------------------------------- |
| **Pattern**       | Server Actions (React 19 `useActionState`)                |
| **Session store** | httpOnly cookie (`admin-session`) containing a JWT        |
| **Backend**       | Fastify REST API at `/admin/auth/*`                       |
| **MFA**           | Optional TOTP, two-step form flow                         |
| **Token refresh** | `POST /admin/auth/refresh` (refresh token + CSRF token)   |
| **Proxy**         | `/api/backend/[...path]` injects Bearer token from cookie |

## Architecture Diagram

```
Browser (LoginForm)
    |  form submission (FormData)
    v
loginAction (Server Action)
    |  POST /admin/auth/login
    v
Fastify Backend
    |  returns { user, tokens, requiresMfa? }
    v
Server Action sets httpOnly cookie "admin-session" = accessToken
    |
    v
redirect("/")  -->  DashboardLayout (RSC)
    |  reads cookie, calls verifyAccessToken()
    v
Backend: GET /admin/auth/me  -->  returns AdminUserProfile
    |
    v
Renders dashboard with user info
```

## Key Files

| File                                 | Role                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `app/actions/auth.ts`                | `loginAction` / `logoutAction` Server Actions                                               |
| `lib/auth/backend-client.ts`         | `authenticateAdmin()`, `verifyAccessToken()`, `refreshAccessToken()`, `logoutFromBackend()` |
| `lib/auth/types.ts`                  | `AdminAuthState`, `AuthenticateAdminResult`, `AdminUserProfile`, `TokenPair`                |
| `app/api/backend/[...path]/route.ts` | Universal proxy -- reads cookie, injects `Authorization: Bearer` header                     |
| `app/(dashboard)/layout.tsx`         | RSC guard -- redirects to `/auth/login` if cookie missing or token invalid                  |
| `app/(auth)/login/page.tsx`          | Login page (renders `LoginForm`)                                                            |
| `components/auth/login-form.tsx`     | Client component with `useActionState` for login + MFA                                      |
| `components/auth/logout-button.tsx`  | Client component that calls `logoutAction`                                                  |

## Login Flow

1. User visits `/auth/login` and fills email + password.
2. `LoginForm` uses `useActionState(loginAction, null)` to submit `FormData`.
3. `loginAction` (Server Action) calls `authenticateAdmin({ email, password })`.
4. `authenticateAdmin()` sends `POST /admin/auth/login` to the Fastify backend.
5. Backend responds with a discriminated union:
   - `{ status: "success", user, tokens }` -- cookie is set, redirect to `/`.
   - `{ status: "mfa_required", mfaSessionToken }` -- form transitions to MFA input.
   - `{ status: "error", error }` -- error message displayed.
6. On success, the Server Action sets the `admin-session` httpOnly cookie with the access token and calls `redirect("/")`.

### MFA Flow

1. First submission returns `{ requiresMfa: true, mfaSessionToken }`.
2. `LoginForm` preserves credentials in local state and shows OTP input.
3. Second submission sends email + password + mfaToken + mfaSessionToken.
4. Backend validates OTP and returns tokens on success.

## Logout Flow

1. User clicks `LogoutButton` which calls `logoutAction()`.
2. `logoutAction` reads the `admin-session` cookie.
3. Sends `POST /admin/auth/logout` with `Authorization: Bearer <token>` to invalidate the session server-side.
4. Deletes the `admin-session` cookie (regardless of backend response).
5. Calls `redirect("/auth/login")`.

## Token Refresh Flow

```typescript
import { refreshAccessToken } from "@/lib/auth/backend-client";

const newTokens = await refreshAccessToken(refreshToken, csrfToken);
// POST /admin/auth/refresh -> { tokens: { accessToken, refreshToken, expiresIn, csrfToken } }
```

Token refresh is available via `refreshAccessToken()` in the backend client. The current implementation stores only the access token in the cookie; refresh token handling is delegated to backend-side session management.

## Route Protection

Dashboard routes are protected by the `(dashboard)/layout.tsx` Server Component:

```typescript
const cookieStore = await cookies();
const token = cookieStore.get("admin-session")?.value;
if (!token) redirect("/auth/login");

const user = await verifyAccessToken(token);
if (!user) redirect("/auth/login");
```

There is no Next.js middleware file -- protection is handled at the layout level using RSC and `cookies()`.

## Backend Proxy

Client-side API calls go through `/api/backend/[...path]` which:

1. Reads the `admin-session` httpOnly cookie.
2. Adds `Authorization: Bearer <token>` header.
3. Forwards the request to the Fastify backend.
4. Returns the upstream response.

```typescript
// Client-side usage:
fetch("/api/backend/admin/users");
// Proxied to: GET http://localhost:3000/admin/users (with Bearer token)
```

The browser never sees the JWT directly -- it only exists inside the httpOnly cookie.

## Cookie Configuration

```typescript
const COOKIE_NAME = "admin-session";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 24 * 60 * 60, // 1 day (86400 seconds)
};
```

## Environment Variables

| Variable              | Required    | Description                                                   |
| --------------------- | ----------- | ------------------------------------------------------------- |
| `API_URL`             | Recommended | Fastify backend URL for Server Actions/RSC (server-side only) |
| `NEXT_PUBLIC_API_URL` | Fallback    | Fastify backend URL (default: `http://localhost:3000`)        |

No `NEXTAUTH_SECRET` or `NEXTAUTH_URL` needed -- NextAuth.js has been fully removed.

## Type Definitions

```typescript
// AdminAuthState -- useActionState compatible
interface AdminAuthState {
  error?: string;
  requiresMfa?: boolean;
  mfaSessionToken?: string;
}

// AuthenticateAdminResult -- discriminated union
type AuthenticateAdminResult =
  | { status: "success"; user: AdminUserProfile; tokens: TokenPair }
  | { status: "mfa_required"; mfaSessionToken: string }
  | { status: "error"; error: string };

// TokenPair
interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  csrfToken: string;
}
```

## React 19 useActionState Compatibility

The login form uses React 19's `useActionState` (not the deprecated `useFormState`):

```typescript
const [state, formAction, isPending] = useActionState<AdminAuthState | null, FormData>(
  wrappedAction,
  null
);
```

- `state` contains the last return value from the Server Action.
- `formAction` is passed to `<form action={formAction}>`.
- `isPending` drives the loading UI (disabled inputs, "Signing in..." text).

## Backend Endpoints

| Method | Endpoint              | Purpose                                           |
| ------ | --------------------- | ------------------------------------------------- |
| `POST` | `/admin/auth/login`   | Authenticate with email/password (+ optional MFA) |
| `GET`  | `/admin/auth/me`      | Verify token and get user profile                 |
| `POST` | `/admin/auth/refresh` | Refresh access token                              |
| `POST` | `/admin/auth/logout`  | Invalidate session (supports `allSessions` flag)  |

## Testing

E2E tests use Playwright with the real login flow. The test helpers check for the `admin-session` cookie via `page.context().cookies()` (not `document.cookie`, since httpOnly cookies are invisible to JavaScript).

Test credentials are defined in `tests/e2e/helpers.ts`.
