# Authentication Architecture

## Overview

The OmniPost application uses a two-tier authentication system with separate Next.js frontend applications (client and admin) both authenticating against a single Fastify REST API backend.

Both the **client app** (`apps/client`) and **admin app** (`apps/admin`) use the same cookie-based authentication pattern:

- **Server Actions** handle login/logout logic
- **httpOnly cookies** store JWT access tokens (never visible to browser JavaScript)
- **API proxy routes** inject Bearer tokens from cookies before forwarding requests to the backend

This architecture ensures that authentication tokens are never exposed to client-side JavaScript, protecting against XSS attacks and token theft.

## Cookie Configuration

Both applications use httpOnly cookies to store JWT access tokens securely. The cookies are identical in configuration but use different names to prevent cross-app token leakage.

| Configuration | Client App (`apps/client`) | Admin App (`apps/admin`) |
| ------------- | -------------------------- | ------------------------ |
| Cookie name   | `session`                  | `admin-session`          |
| httpOnly      | true                       | true                     |
| secure        | true (production only)     | true (production only)   |
| sameSite      | lax                        | lax                      |
| maxAge        | 86400 seconds (1 day)      | 86400 seconds (1 day)    |
| path          | /                          | /                        |

The `rememberMe` option in the client app extends maxAge to 30 days; the admin app uses a fixed 1-day expiration.

## Authentication Flow

Both applications follow the same login flow:

### Client App (apps/client)

1. User fills login form: email, password, optional "Remember me" checkbox
2. Browser submits form to Server Action `loginAction()` in `app/actions/auth.ts`
3. Server Action calls backend API: `POST http://localhost:3000/auth/login`
4. Backend validates credentials, returns JWT tokens
5. Server Action extracts `accessToken` from response (`response.value.accessToken`)
6. Server Action sets httpOnly cookie with `await cookies().set("session", accessToken, {...})`
7. Server Action calls `redirect("/dashboard")`
8. Middleware confirms cookie is present; user is now authenticated

### Admin App (apps/admin)

1. User fills login form: email, password
2. Browser submits form to Server Action `loginAction()` in `app/actions/auth.ts`
3. Server Action calls backend API: `POST http://localhost:3000/admin/auth/login`
4. Backend may return `status: "mfa_required"` with `mfaSessionToken`
   - If MFA required, login form displays OTP input field
   - User submits OTP (stored in form state alongside email/password)
5. If MFA provided or not required:
   - Server Action calls `authenticateAdmin()` again with OTP token and session token
   - Backend validates and returns success with JWT tokens
6. Server Action sets httpOnly cookie with `await cookies().set("admin-session", accessToken, {...})`
7. Server Action calls `redirect("/")`
8. Middleware confirms cookie is present; user is now authenticated

## MFA Flow (Admin Only)

The admin app supports multi-factor authentication (MFA) as a second layer of security.

### Step 1: Initial Login Attempt

```typescript
loginAction(prevState, formData)
  └─ authenticateAdmin({ email, password })
     └─ POST /admin/auth/login
        └─ Backend: MFA not enabled OR credentials invalid
```

If credentials are valid and MFA is enabled, the backend returns:

```json
{
  "ok": true,
  "value": {
    "requiresMfa": true,
    "mfaSessionToken": "session_token_xyz"
  }
}
```

The login form stores `email` and `password` in React state and displays an OTP input field.

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
  "value": {
    "requiresMfa": false,
    "user": { "id": "...", "email": "..." },
    "tokens": { "accessToken": "...", "refreshToken": "..." }
  }
}
```

### Step 3: Session Creation

The Server Action sets the httpOnly cookie and redirects:

```typescript
const cookieStore = await cookies();
cookieStore.set("admin-session", accessToken, COOKIE_OPTIONS);
redirect("/");
```

## Proxy Pattern

All client-side API calls route through a Next.js API proxy route. This allows the server to read httpOnly cookies and inject authentication headers before forwarding requests to the backend.

### Client App Proxy

**File:** `apps/client/app/api/backend/[...path]/route.ts`

**Pattern:**

```
Browser: fetch("/api/backend/posts")
   ↓
Next.js Proxy: reads "session" cookie
   ↓
Fastify Backend: GET http://localhost:3000/posts
   with Authorization: Bearer <accessToken>
```

**Example Usage in React Components:**

```typescript
// In a client component or Server Action
const response = await fetch("/api/backend/posts", {
  method: "GET",
  // Token is injected by proxy — no manual header injection needed
});

const data = await response.json();
// data.value contains the post list
```

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

Both applications use Next.js middleware to protect routes based on cookie presence.

### Client App Middleware

**File:** `apps/client/middleware.ts`

- **Public paths:** `/login`, `/register`, `/`
- **Redirect rule:** If user is unauthenticated and accesses protected route → redirect to `/login?redirect=<original-path>`
- **Reverse rule:** If user is authenticated and accesses `/login` or `/register` → redirect to `/dashboard`

### Admin App Middleware

**File:** `apps/admin/middleware.ts`

- **Public path:** `/auth/login`
- **Redirect rule:** If user is unauthenticated and accesses any other route → redirect to `/auth/login`
- **Reverse rule:** If user is authenticated and accesses `/auth/login` → redirect to `/`

Both middleware check for cookie presence at request time using `request.cookies.get("<cookie-name>")`. This validation happens before any Server Actions or Route Handlers execute.

## Server Components and Token Verification

Dashboard layouts and other Server Components can verify token validity by reading the httpOnly cookie and validating it against the backend.

### Admin App Example

**File:** `apps/admin/lib/auth/backend-client.ts`

The `verifyAccessToken()` function is used in Server Components:

```typescript
export async function verifyAccessToken(accessToken: string): Promise<AdminUserProfile | null> {
  const response = await fetch(`${API_URL}/admin/auth/me`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return data.value?.user || null;
}
```

**Usage in Dashboard Layout:**

```typescript
export default async function DashboardLayout() {
  const cookieStore = await cookies();
  const session = cookieStore.get("admin-session");

  if (!session) {
    redirect("/auth/login");
  }

  const user = await verifyAccessToken(session.value);
  if (!user) {
    // Token is invalid or expired
    redirect("/auth/login");
  }

  return (
    <div>
      <p>Logged in as {user.email}</p>
      {/* Dashboard content */}
    </div>
  );
}
```

## Key Files

### Client App (`apps/client`)

| File                                 | Purpose                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `app/actions/auth.ts`                | `loginAction()`, `registerAction()`, `logoutAction()` — Server Actions for auth |
| `app/api/backend/[...path]/route.ts` | API proxy that reads `session` cookie and forwards requests                     |
| `middleware.ts`                      | Route protection — redirects unauthenticated users to login                     |
| `lib/auth/authContext.tsx`           | Client-side auth context (user state, login/logout triggers)                    |
| `lib/apiClient.ts`                   | Centralized API client using `/api/backend` proxy                               |

### Admin App (`apps/admin`)

| File                                 | Purpose                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `app/actions/auth.ts`                | `loginAction()`, `logoutAction()` — Server Actions with MFA support          |
| `app/api/backend/[...path]/route.ts` | API proxy that reads `admin-session` cookie and forwards requests            |
| `middleware.ts`                      | Route protection — redirects unauthenticated users to `/auth/login`          |
| `lib/auth/backend-client.ts`         | `authenticateAdmin()`, `verifyAccessToken()`, `logoutFromBackend()`          |
| `lib/auth/types.ts`                  | `AdminAuthState`, `AuthenticateAdminResult`, `AdminUserProfile`, `TokenPair` |
| `lib/apiClient.ts`                   | Centralized API client using `/api/backend` proxy                            |

## Backend Endpoints (Fastify API)

### Client Auth Endpoints

| Endpoint                  | Method | Purpose                 | Request                            | Response                                     |
| ------------------------- | ------ | ----------------------- | ---------------------------------- | -------------------------------------------- |
| `/auth/customer/register` | POST   | Register account + user | `{ email, password, name }`        | `{ ok: true, value: { user, tokens } }`      |
| `/auth/login`             | POST   | Authenticate user       | `{ email, password, rememberMe? }` | `{ ok: true, value: { accessToken, user } }` |
| `/auth/me`                | GET    | Get current user        | `Authorization: Bearer <token>`    | `{ ok: true, value: { user } }`              |
| `/auth/logout`            | POST   | Invalidate session      | `Authorization: Bearer <token>`    | `{ ok: true }`                               |
| `/auth/refresh`           | POST   | Refresh tokens          | `{ refreshToken }`                 | `{ ok: true, value: { tokens } }`            |

> **Note:** the public `POST /auth/register` admin-creation endpoint was removed for CWE-269 (privilege escalation via a client-supplied `role`; PR #126). Client-app user registration uses `POST /auth/customer/register`; admin users are provisioned only via `AuthService.registerAdmin` (seed/bootstrap), never a public route.

### Admin Auth Endpoints

| Endpoint              | Method | Purpose                   | Request                                           | Response                                                                |
| --------------------- | ------ | ------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| `/admin/auth/login`   | POST   | Admin login (MFA support) | `{ email, password, mfaToken?, deviceId? }`       | `{ ok: true, value: { user, tokens, requiresMfa?, mfaSessionToken? } }` |
| `/admin/auth/me`      | GET    | Get admin user            | `Authorization: Bearer <token>`                   | `{ ok: true, value: { user } }`                                         |
| `/admin/auth/logout`  | POST   | Invalidate admin session  | `Authorization: Bearer <token>, { allSessions? }` | `{ ok: true }`                                                          |
| `/admin/auth/refresh` | POST   | Refresh admin tokens      | `{ refreshToken, csrfToken }`                     | `{ ok: true, value: { tokens } }`                                       |

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

- **5 login attempts per 15 minutes** per IP address
- Rate limit headers are included in all responses:
  - `X-RateLimit-Limit`: Max requests per window
  - `X-RateLimit-Remaining`: Requests remaining
  - `X-RateLimit-Reset`: Unix timestamp when limit resets

Exceeded rate limits return HTTP 429 (Too Many Requests).

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

Backend endpoints return a consistent response structure:

```typescript
{
  ok: boolean;
  value?: T;        // Response data (only present if ok: true)
  error?: string;   // Error message (only present if ok: false)
}
```

Client code extracts data using optional chaining:

```typescript
const data = response.value; // Safe: extracts only if ok: true
```

## Logout Flow

Both applications follow the same logout pattern:

1. Server Action reads the httpOnly cookie
2. Server Action calls backend logout endpoint (`POST /auth/logout` or `POST /admin/auth/logout`)
   - Backend invalidates the session/token
   - Errors during backend call are caught and ignored
3. Server Action deletes the httpOnly cookie using `cookieStore.delete("<cookie-name>")`
4. Server Action redirects to login page

The logout is idempotent — even if the backend logout fails, the frontend cookie is still deleted, ensuring the user is logged out locally.

## Troubleshooting

### User Redirected to Login After Valid Login

**Cause:** Token validation failed in Server Component or middleware detected missing cookie.

**Solution:**

1. Verify the backend API is running and returning tokens
2. Check browser DevTools → Network tab → verify the auth request returns `ok: true`
3. Ensure the cookie name matches the app (client uses `session`, admin uses `admin-session`)
4. Verify `secure` flag is correct (false in development, true in production with HTTPS)

### "Authentication failed - no token received"

**Cause:** Backend API returned response but without expected token field.

**Solution:**

1. Check the backend response structure — should be `{ ok: true, value: { accessToken, ... } }`
2. Verify the backend auth service is configured correctly
3. Check backend logs for validation or database errors

### Token Expires Immediately

**Cause:** JWT secret mismatch between backend and frontend token verification.

**Solution:**

1. Ensure backend `JWT_SECRET` environment variable is set
2. Restart the backend after changing JWT_SECRET
3. Clear all cookies in browser DevTools and try again

### MFA Not Working (Admin App)

**Cause:** MFA not enabled in backend for the user account, or session token is invalid.

**Solution:**

1. Verify the user's MFA status in the database (admin panel or direct query)
2. Check backend logs for MFA validation errors
3. Ensure the `mfaSessionToken` is passed correctly on the second form submission
4. Verify the backend MFA endpoint configuration
