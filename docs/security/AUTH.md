# Authentication Architecture

## Overview

The OmniPost application uses a two-tier authentication system with separate Next.js frontend applications (client and admin) both authenticating against a single Fastify REST API backend.

Both the **client app** (`apps/client`) and **admin app** (`apps/admin`) use the same cookie-based authentication pattern:

- **Server Actions** handle login/logout logic
- **httpOnly cookies** store JWT access tokens (never visible to browser JavaScript)
- **API proxy routes** inject Bearer tokens from cookies before forwarding requests to the backend

This architecture ensures that authentication tokens are never exposed to client-side JavaScript, protecting against XSS attacks and token theft.

## Cookie Configuration

Both applications keep their tokens in httpOnly cookies, defined in each app's `lib/auth/sessionCookie.ts`. The names differ per app to prevent cross-app token leakage. All five cookies carry the same attributes: `httpOnly: true`, `sameSite: "lax"`, `path: "/"`, and `secure` only when `NODE_ENV` is `production`. That includes `admin-csrf`: browser code never reads it, because the admin backend proxy copies it server-side into the `X-CSRF-Token` request header.

| Cookie                 | Client App (`apps/client`)                         | Admin App (`apps/admin`)                                                 |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------------------------------ |
| Access token (session) | `customer-session`, 15 minutes                     | `admin-session`, 15 minutes; 24 hours when the backend proxy rewrites it |
| Refresh token          | `customer-refresh`, 7 days (30 with "Remember me") | `admin-refresh`, 7 days                                                  |
| CSRF token             | none                                               | `admin-csrf`, 7 days                                                     |

The access-token cookie is set for as long as the backend access token lives: 15 minutes for both (`CUSTOMER_JWT_EXPIRY` in `apps/api/src/auth/customerJwt.ts`, `accessTokenExpiration` in `apps/api/src/admin/auth/adminAuthConfig.ts`). One writer sits outside `sessionCookie.ts`: after a `TOKEN_EXPIRED` retry, the admin backend proxy (`app/api/backend/[...path]/route.ts`) rewrites `admin-session` itself, with the same attributes but a 24-hour `maxAge`, so that cookie can outlive the 15-minute token it holds. The admin app has no "Remember me" option.

## Authentication Flow

Both applications follow the same login flow:

### Client App (apps/client)

1. User fills the login form at `/{locale}/login` (`app/[locale]/login/page.tsx`): email, password, optional "Remember me" checkbox
2. The form submits through React 19 `useActionState` to the Server Action `loginAction()` in `app/actions/auth.ts`
3. `loginAction()` sends `POST /auth/customer/login` with `{ email, password, rememberMe }`
4. The backend validates the credentials and answers `{ ok: true, data }`, where `data` is either a session (`user`, `account`, `accessToken`, `refreshToken`) or an MFA challenge (`mfaRequired: true`, `challengeToken`, `expiresInSeconds`)
5. On a challenge, the page shows `MfaChallengeForm`, which submits the code to `completeMfaLoginAction()`; that action sends `POST /auth/customer/login/mfa` with `{ challengeToken, code, rememberMe }` and receives the session
6. `readAuthTokens()` (`lib/auth/sessionCookie.ts`) takes the tokens from `data`, and `setSessionCookie()` and `setRefreshCookie()` set `customer-session` and `customer-refresh`
7. The Server Action calls `redirect("/{locale}/dashboard")`, outside its `try/catch` because `redirect()` throws `NEXT_REDIRECT`
8. `proxy.ts` sees the `customer-session` cookie on the dashboard route and lets the request through

### Admin App (apps/admin)

1. User fills the login form (`components/auth/login-form.tsx`) at `/{locale}/login`: email, password
2. The form submits through React 19 `useActionState` to the Server Action `loginAction()` in `app/actions/auth.ts`; `state` holds the last `AdminAuthState` the action returned and `isPending` drives the loading UI
3. `loginAction()` calls `authenticateAdmin()` (`lib/auth/backend-client.ts`), which sends `POST /admin/auth/login` and maps the response to a discriminated union, `AuthenticateAdminResult`:
   - `{ status: "success", user, tokens }`
   - `{ status: "mfa_required", mfaSessionToken }` — the form switches to an OTP input
   - `{ status: "error", error }` — the message is shown on the form
4. On success, `setAuthTokens()` (`lib/auth/sessionCookie.ts`) sets the `admin-session`, `admin-refresh` and `admin-csrf` cookies
5. Server Action calls `redirect("/{locale}")`, outside its `try/catch` because `redirect()` throws `NEXT_REDIRECT`
6. `proxy.ts` sees the cookie; the dashboard layout then verifies the token (see [Server Components and Token Verification](#server-components-and-token-verification))

## MFA Flow (Admin App)

The admin app supports multi-factor authentication (MFA) as a second layer of security. The client app's two-step MFA login is steps 4 and 5 of the client flow above.

### Step 1: Initial Login Attempt

```typescript
loginAction(prevState, formData)
  └─ authenticateAdmin({ email, password })
     └─ POST /admin/auth/login
```

If credentials are valid and MFA is enabled, the backend returns:

```json
{
  "ok": true,
  "data": {
    "requiresMfa": true,
    "mfaSessionToken": "session_token_xyz"
  }
}
```

`loginAction()` returns `{ requiresMfa: true, mfaSessionToken }`; the login form keeps `email` and `password` in React state and displays an OTP input field.

### Step 2: OTP Submission

```typescript
loginAction(prevState, formData)  // form includes mfaToken + mfaSessionToken hidden fields
  └─ authenticateAdmin({
       email,
       password,
       mfaToken: "123456",
       deviceId: mfaSessionToken
     })
     └─ POST /admin/auth/login
        └─ Backend: validates OTP against MFA session
```

On successful MFA validation, the backend returns:

```json
{
  "ok": true,
  "data": {
    "user": { "id": "...", "email": "..." },
    "tokens": { "accessToken": "...", "refreshToken": "...", "expiresIn": 900, "csrfToken": "..." }
  }
}
```

### Step 3: Session Creation

The Server Action stores the token bundle and redirects:

```typescript
await setAuthTokens({ accessToken, refreshToken, csrfToken });
redirect(`/${await getLocale()}`);
```

### Token Refresh

The admin access token lasts 15 minutes; two places renew it with the `admin-refresh` and `admin-csrf` cookies through `POST /admin/auth/refresh` (`{ refreshToken, csrfToken }`) and rewrite `admin-session`:

- **Page loads**: when the dashboard layout cannot verify the token it redirects to `GET /api/auth/refresh` (`app/api/auth/refresh/route.ts`), which refreshes and redirects back to `returnTo`, or clears every auth cookie and redirects to login.
- **API calls**: the backend proxy retries a request once after a refresh when the backend answers 401 with error code `TOKEN_EXPIRED`; any other 401, or a failed refresh, is passed through.

## Proxy Pattern

All client-side API calls route through a Next.js API proxy route. This allows the server to read httpOnly cookies and inject authentication headers before forwarding requests to the backend.

### Client App Proxy

**File:** `apps/client/app/api/backend/[...path]/route.ts`

**Pattern:**

```
Browser: fetch("/api/backend/posts")
   ↓
Next.js Proxy: reads "customer-session" cookie
   ↓
Fastify Backend: GET http://localhost:3000/posts
   with Authorization: Bearer <accessToken>
```

**Example Usage in React Components:**

```typescript
// In a client component
const response = await fetch("/api/backend/posts", {
  method: "GET",
  // Token is injected by proxy — no manual header injection needed
});

const body = await response.json();
// body.data contains the post list when body.ok is true
```

The client proxy also handles the customer auth paths itself: on `auth/customer/login`, `auth/customer/login/mfa`, `auth/customer/register` and `auth/customer/refresh` it moves the tokens from the response body into the two cookies and strips them from the body the browser receives; on `auth/customer/refresh` and `auth/customer/logout` it adds the refresh token from `customer-refresh` to the request body; on `auth/customer/logout` it clears both cookies; and a 401 from `auth/customer/refresh` clears them too.

### Admin App Proxy

**File:** `apps/admin/app/api/backend/[...path]/route.ts`

Same pattern as the client app, but uses the `admin-session` cookie instead:

```
Browser: fetch("/api/backend/admin/users")
   ↓
Next.js Proxy: reads "admin-session" cookie
   ↓
Fastify Backend: GET http://localhost:3000/admin/users
   with Authorization: Bearer <accessToken>
```

### Key Proxy Behaviors

1. **Token Injection:** The proxy reads the httpOnly cookie and injects `Authorization: Bearer <token>` header
2. **Query Parameters:** Search params are forwarded as-is to the backend
3. **Request Methods:** All HTTP methods (GET, POST, PUT, PATCH, DELETE) are supported
4. **Cache Control:** Backend responses are marked `cache: "no-store"` to ensure fresh data
5. **Error Handling:** If the backend is unavailable, the proxy returns a 503 with error message
6. **Response Forwarding:** Status code and Content-Type headers are forwarded to the client

## Route Protection

Both applications gate routes on cookie presence before anything renders; the admin dashboard layout then verifies the token itself.

### Client App Proxy Gate

**File:** `apps/client/proxy.ts` (Next.js 16 `proxy`, composed with next-intl locale routing)

- **Public paths:** `/{locale}/login`, `/{locale}/register` and `/{locale}` (compared after stripping the `es` / `en` locale prefix)
- **Redirect rule:** If the `customer-session` cookie is missing on any other route → redirect to `/{locale}/login?redirect=<original-path>`
- **Reverse rule:** If the cookie is present on the login or register page → redirect to the `returnTo` query parameter when one is given, otherwise to `/{locale}/dashboard`
- **Matcher:** every path except `/api`, `/_next`, `/_vercel` and files with an extension, so the backend proxy is not gated here

The gate checks only that the cookie exists; it never validates the token.

### Admin App Proxy Gate

**File:** `apps/admin/proxy.ts` (Next.js 16 `proxy`, composed with next-intl locale routing)

- **Public path:** `/{locale}/login` (compared after stripping the `en` / `es` locale prefix)
- **Redirect rule:** If the `admin-session` cookie is missing on any other route → redirect to `/{locale}/login`
- **Reverse rule:** If the cookie is present on the login page → redirect to `/{locale}`
- **Matcher:** every path except `/api`, `/_next`, `/_vercel` and files with an extension, so the backend proxy and the refresh route are not gated here

The gate checks only that the cookie exists; it never validates the token.

## Server Components and Token Verification

Dashboard layouts and other Server Components can verify token validity by reading the httpOnly cookie and validating it against the backend.

### Admin App Example

**File:** `apps/admin/lib/auth/backend-client.ts`

`verifyAccessToken()` calls `GET /admin/auth/me` with the token and returns the `AdminUserProfile`, or `null` on any non-OK or malformed response. It is wrapped in React `cache()`, so one render verifies once.

**Usage in the Dashboard Layout** (`app/[locale]/(dashboard)/layout.tsx`):

```typescript
const cookieStore = await cookies();
const token = cookieStore.get("admin-session")?.value;
if (!token) redirect(`/${await getLocale()}/login`);

const user = await verifyAccessToken(token);
if (!user) {
  // Token is invalid or expired: try a refresh before sending the user to login
  redirect("/api/auth/refresh");
}
```

## Key Files

### Client App (`apps/client`)

| File                                   | Purpose                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `app/actions/auth.ts`                  | `loginAction()`, `completeMfaLoginAction()`, `registerAction()` — Server Actions for auth      |
| `app/api/backend/[...path]/route.ts`   | API proxy that reads `customer-session`, injects the Bearer token and manages the auth cookies |
| `proxy.ts`                             | Route gate on cookie presence, composed with locale routing                                    |
| `components/auth/MfaChallengeForm.tsx` | Client component: the MFA step-2 form, submitted to `completeMfaLoginAction()`                 |
| `lib/auth/sessionCookie.ts`            | Cookie names and lifetimes, the setters and clearers, and token extraction from auth responses |
| `lib/auth/authApi.ts`                  | Browser calls to `/api/backend/auth/customer/*` (`me`, login, MFA, logout, refresh)            |
| `lib/auth/authContext.tsx`             | Client-side auth context (user state, login/logout triggers)                                   |
| `lib/api/client.ts`                    | Centralized API client using `/api/backend` proxy                                              |

### Admin App (`apps/admin`)

| File                                  | Purpose                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `app/actions/auth.ts`                 | `loginAction()`, `logoutAction()` — Server Actions with MFA support                       |
| `app/api/backend/[...path]/route.ts`  | API proxy that reads `admin-session`, injects the Bearer token and retries once on expiry |
| `app/api/auth/refresh/route.ts`       | Page-load token refresh from the `admin-refresh` and `admin-csrf` cookies                 |
| `app/[locale]/(dashboard)/layout.tsx` | Server Component guard: verifies the token, or redirects to refresh or login              |
| `components/auth/login-form.tsx`      | Client component: `useActionState` login form with the two-step MFA input                 |
| `components/shared/SidebarNav.tsx`    | Calls `logoutAction()`                                                                    |
| `proxy.ts`                            | Route gate on cookie presence, composed with locale routing                               |
| `lib/auth/backend-client.ts`          | `authenticateAdmin()`, `verifyAccessToken()`, `logoutFromBackend()`                       |
| `lib/auth/sessionCookie.ts`           | The only module that sets or clears the three admin auth cookies                          |
| `lib/auth/types.ts`                   | `AdminAuthState`, `AuthenticateAdminResult`, `AdminUserProfile`, `TokenPair`              |
| `lib/apiClient.ts`                    | Centralized API client using `/api/backend` proxy                                         |

E2E tests (`tests/e2e/`) drive the real login flow; `tests/e2e/helpers.ts` reads the `admin-session` cookie through `page.context().cookies()`, because an httpOnly cookie is invisible to `document.cookie`.

## Backend Endpoints (Fastify API)

### Client Auth Endpoints

All routes are in `apps/api/src/auth/customerAuthRoutes.ts`; the client app reaches them through its backend proxy.

| Endpoint                                | Method | Purpose                       | Request                                                                       | Response                                                                                                                                      |
| --------------------------------------- | ------ | ----------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `/auth/customer/register`               | POST   | Register account + user       | `{ accountName, accountEmail?, firstName, lastName, email, password, plan? }` | `{ ok: true, data: { account, user, accessToken, refreshToken } }` (201)                                                                      |
| `/auth/customer/login`                  | POST   | Authenticate (step 1)         | `{ email, password, accountSlug? }`                                           | `{ ok: true, data: { user, account, accessToken, refreshToken } }` or `{ ok: true, data: { mfaRequired, challengeToken, expiresInSeconds } }` |
| `/auth/customer/login/mfa`              | POST   | Complete MFA login (step 2)   | `{ challengeToken, code }`                                                    | `{ ok: true, data: { user, account, accessToken, refreshToken } }`                                                                            |
| `/auth/customer/me`                     | GET    | Get current user              | `Authorization: Bearer <token>`                                               | `{ ok: true, data: { user } }`                                                                                                                |
| `/auth/customer/logout`                 | POST   | Revoke the session            | `Authorization: Bearer <token>`, `{ refreshToken? }`                          | `{ ok: true, data: { message } }`                                                                                                             |
| `/auth/customer/refresh`                | POST   | Refresh tokens                | `{ refreshToken }`                                                            | `{ ok: true, data: { accessToken, refreshToken } }`                                                                                           |
| `/auth/customer/request-password-reset` | POST   | Send a password-reset message | `{ email }`                                                                   | `{ ok: true, data: { message } }`                                                                                                             |
| `/auth/customer/reset-password`         | POST   | Set a new password            | `{ token, newPassword }`                                                      | `{ ok: true, data: { message } }`                                                                                                             |

> **Note:** the public `POST /auth/register` admin-creation endpoint was removed for CWE-269 (privilege escalation via a client-supplied `role`; PR #126). Client-app user registration uses `POST /auth/customer/register`; admin users are provisioned only via `AuthService.registerAdmin` (seed/bootstrap), never a public route.

### Admin Auth Endpoints

| Endpoint              | Method | Purpose                   | Request                                           | Response                                                               |
| --------------------- | ------ | ------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| `/admin/auth/login`   | POST   | Admin login (MFA support) | `{ email, password, mfaToken?, deviceId? }`       | `{ ok: true, data: { user, tokens, requiresMfa?, mfaSessionToken? } }` |
| `/admin/auth/me`      | GET    | Get admin user            | `Authorization: Bearer <token>`                   | `{ ok: true, data: { user } }`                                         |
| `/admin/auth/logout`  | POST   | Invalidate admin session  | `Authorization: Bearer <token>, { allSessions? }` | `{ ok: true }`                                                         |
| `/admin/auth/refresh` | POST   | Refresh admin tokens      | `{ refreshToken, csrfToken }`                     | `{ ok: true, data: { tokens } }`                                       |

## Security Notes

### Token Storage

- Access tokens are **never stored in localStorage or sessionStorage**
- Tokens live only in httpOnly cookies, which are not accessible to JavaScript
- The `secure` flag ensures cookies are only sent over HTTPS in production
- The `sameSite: lax` setting provides CSRF protection while allowing top-level navigation

### Token Injection

- The API proxy reads tokens from httpOnly cookies on the server side
- Tokens are injected into the `Authorization: Bearer` header before sending requests to the backend
- Client-side code never directly handles or transmits tokens

### Rate Limiting

Auth endpoints are subject to rate limiting to prevent brute force attacks:

- **Client:** `/auth/customer/login` (MFA step 2 included) and `/auth/customer/refresh` get the `AUTH` preset of the global limiter, **5 requests per 15 minutes** per client IP and route (`apps/api/src/security/httpRateLimitPreHandler.ts`)
- **Admin:** `/admin/auth/login` carries its own route limit, 15 requests per minute per client IP (`apps/api/src/admin/auth/adminAuthRoutes.ts`)
- The global limiter sets `X-RateLimit-Remaining` (requests left in the bucket) and `X-RateLimit-Reset` (the reset time in epoch milliseconds) on every response it governs; it sends no `X-RateLimit-Limit` header
- An exceeded limit returns HTTP 429 (Too Many Requests) with `Retry-After` in seconds

Repeated login failures are throttled separately, by backoff and account lockout (`BruteForceProtectionPort`).

### MFA Protection (Admin Only)

- MFA tokens are temporary and tied to a session ID
- Each OTP is single-use and expires after a short window (typically 5 minutes)
- Failed OTP attempts are logged and contribute to account lockout after repeated failures
- Successful OTP validation requires both the OTP and the session ID from the initial login

### CSRF Protection

- The `sameSite: lax` cookie setting prevents cross-site request forgery
- All state-changing operations (POST, PUT, DELETE) require proper cookies
- Server Actions inherently provide CSRF protection through Next.js request validation

## Environment Variables

Both client and admin apps support these environment variables:

```bash
# API Backend URL (defaults to http://localhost:3000)
API_URL=http://localhost:3000

# Public API URL (used as fallback only)
NEXT_PUBLIC_API_URL=http://localhost:3000

# Node environment
NODE_ENV=production|development
```

In development, the default `http://localhost:3000` usually suffices. In production, set `API_URL` to your backend domain (e.g., `https://api.example.com`).

## Response Structure

Backend endpoints return a consistent response structure (`sendSuccess` and `sendError` in `apps/api/src/lib/route-handler/BaseRouteHandler.ts`):

```typescript
{
  ok: boolean;
  data?: T;          // Response data (only present if ok: true)
  error?: string;    // Error message (only present if ok: false)
  details?: unknown; // Optional error details (only present if ok: false)
}
```

Client code narrows on `ok` before reading the data:

```typescript
const data = body.ok ? body.data : undefined;
```

## Logout Flow

The two applications log out through different paths:

- **Client:** the auth context's `logout()` calls `POST /api/backend/auth/customer/logout` (`lib/auth/authApi.ts`); the backend proxy adds the refresh token from `customer-refresh`, forwards the call to `POST /auth/customer/logout`, which revokes the session, and clears both cookies whatever the backend answered.
- **Admin:** the Server Action `logoutAction()` calls `POST /admin/auth/logout` with the `admin-session` token and the `admin-csrf` token (the backend logout is CSRF-protected), catches and ignores a backend error, clears the three cookies with `clearAuthCookies()` and redirects to the login page.

Both are idempotent: even if the backend logout fails, the cookies are still deleted, so the user is logged out locally.

## Troubleshooting

### User Redirected to Login After Valid Login

**Cause:** The proxy gate found no session cookie, or a Server Component could not verify the token.

**Solution:**

1. Verify the backend API is running and returning tokens
2. Check browser DevTools → Network tab → verify the auth request returns `ok: true`
3. Ensure the cookie name matches the app (client uses `customer-session`, admin uses `admin-session`)
4. Verify `secure` flag is correct (false in development, true in production with HTTPS)

### "Authentication failed - no token received"

**Cause:** The client's `loginAction()` got a successful backend response with no access token in it.

**Solution:**

1. Check the backend response structure — should be `{ ok: true, data: { accessToken, ... } }`
2. Verify the backend auth service is configured correctly
3. Check backend logs for validation or database errors

### Token Expires Immediately

**Cause:** The backend no longer verifies the token, typically because the secret that signed it changed. Only the backend verifies tokens; the frontends store and forward them.

**Solution:**

1. Ensure the backend signing secrets are set and unchanged since the token was issued: `CUSTOMER_JWT_SECRET` for the client (access, refresh and MFA-challenge tokens, `apps/api/src/auth/customerJwt.ts`), `ADMIN_JWT_ACCESS_SECRET` and `ADMIN_JWT_REFRESH_SECRET` for the admin app (`apps/api/src/admin/auth/adminAuthConfig.ts`)
2. Restart the backend after changing any of them; every token signed with the old value stops verifying
3. Clear all cookies in browser DevTools and try again

### MFA Not Working (Admin App)

**Cause:** MFA not enabled in backend for the user account, or session token is invalid.

**Solution:**

1. Verify the user's MFA status in the database (admin panel or direct query)
2. Check backend logs for MFA validation errors
3. Ensure the `mfaSessionToken` is passed correctly on the second form submission
4. Verify the backend MFA endpoint configuration
