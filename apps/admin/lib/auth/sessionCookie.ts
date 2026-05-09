/**
 * @file sessionCookie.ts
 * @description Single source of truth for the admin app's auth-cookie lifecycle.
 *              Centralizes cookie names, TTLs, and the helpers that set/clear
 *              session/refresh/csrf cookies. Both the Server Action
 *              (`app/actions/auth.ts`) and the refresh route
 *              (`app/api/auth/refresh/route.ts`) consume these helpers — no
 *              other module should call `cookies().set(...)` for auth tokens.
 *
 *              TTLs match the JWT lifetimes assumed by the Fastify backend:
 *              - Session = 15min (matches access token TTL).
 *              - Refresh = 7d (default).
 *              - CSRF = 7d (paired with refresh).
 *
 *              Server-only module: imports `next/headers`. Do not import from
 *              client components.
 * @layer infrastructure
 */

import { cookies } from "next/headers";

// ---------------------------------------------------------------------------
// Cookie names + TTLs (single source of truth)
// ---------------------------------------------------------------------------

export const SESSION_COOKIE_NAME = "admin-session";
export const REFRESH_COOKIE_NAME = "admin-refresh";
export const CSRF_COOKIE_NAME = "admin-csrf";

/** Session cookie TTL: 15 minutes (matches typical JWT access token TTL). */
const SESSION_MAX_AGE = 15 * 60;

/** Refresh cookie TTL: 7 days. Paired with the CSRF cookie of the same TTL. */
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60;

/** CSRF cookie TTL: matches the refresh cookie. */
const CSRF_MAX_AGE = REFRESH_MAX_AGE;

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const BASE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PRODUCTION,
  sameSite: "lax" as const,
  path: "/",
};

// ---------------------------------------------------------------------------
// Setters / clearers
// ---------------------------------------------------------------------------

/** Persist the access token as the httpOnly admin-session cookie. */
export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    ...BASE_COOKIE_OPTIONS,
    maxAge: SESSION_MAX_AGE,
  });
}

/** Persist the refresh token as the httpOnly admin-refresh cookie. */
async function setRefreshCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(REFRESH_COOKIE_NAME, token, {
    ...BASE_COOKIE_OPTIONS,
    maxAge: REFRESH_MAX_AGE,
  });
}

/** Persist the CSRF token as the httpOnly admin-csrf cookie. */
async function setCsrfCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(CSRF_COOKIE_NAME, token, {
    ...BASE_COOKIE_OPTIONS,
    maxAge: CSRF_MAX_AGE,
  });
}

/**
 * Persist the full admin auth token bundle in one call. Used by the login
 * Server Action. CSRF is optional — if the backend stops issuing it, callers
 * pass `undefined`.
 */
export async function setAuthTokens(tokens: {
  accessToken: string;
  refreshToken: string;
  csrfToken?: string;
}): Promise<void> {
  await setSessionCookie(tokens.accessToken);
  await setRefreshCookie(tokens.refreshToken);
  if (tokens.csrfToken) {
    await setCsrfCookie(tokens.csrfToken);
  }
}

/** Clear all auth cookies — used on logout and refresh failure. */
export async function clearAuthCookies(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
  store.delete(REFRESH_COOKIE_NAME);
  store.delete(CSRF_COOKIE_NAME);
}
