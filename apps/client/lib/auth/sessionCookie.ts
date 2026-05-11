/**
 * @file sessionCookie.ts
 * @description Single source of truth for the client app's auth-cookie lifecycle.
 *              Centralizes cookie names, TTLs, and the helpers that set/clear
 *              session/refresh cookies. Both the Next.js proxy
 *              (`app/api/backend/[...path]/route.ts`) and the Server Actions
 *              (`app/actions/auth.ts`) consume these helpers — no other module
 *              should call `cookies().set(...)` for auth tokens.
 *
 *              TTLs match the JWT lifetimes assumed by the Fastify backend:
 *              - Session = 15min (matches access token TTL).
 *              - Refresh = 7d default; 30d when the user opts into "remember me".
 *
 *              Server-only module: imports `next/headers`. Do not import from
 *              client components.
 * @layer infrastructure
 */

import { cookies } from "next/headers";

// ---------------------------------------------------------------------------
// Cookie names + TTLs (single source of truth)
// ---------------------------------------------------------------------------

export const SESSION_COOKIE_NAME = "customer-session";
export const REFRESH_COOKIE_NAME = "customer-refresh";

/** Session cookie TTL: 15 minutes (matches typical JWT access token TTL). */
const SESSION_MAX_AGE = 15 * 60;

/** Refresh cookie TTL: 7 days (default, no "remember me"). */
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60;

/** Refresh cookie TTL when user opts into "remember me": 30 days. */
const REFRESH_REMEMBER_ME_MAX_AGE = 30 * 24 * 60 * 60;

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

/** Persist the access token as the httpOnly session cookie. */
export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    ...BASE_COOKIE_OPTIONS,
    maxAge: SESSION_MAX_AGE,
  });
}

/**
 * Persist the refresh token as the httpOnly refresh cookie.
 * Pass `{ rememberMe: true }` to extend the TTL to 30 days.
 */
export async function setRefreshCookie(
  token: string,
  options: { rememberMe?: boolean } = {}
): Promise<void> {
  const store = await cookies();
  store.set(REFRESH_COOKIE_NAME, token, {
    ...BASE_COOKIE_OPTIONS,
    maxAge: options.rememberMe ? REFRESH_REMEMBER_ME_MAX_AGE : REFRESH_MAX_AGE,
  });
}

/** Clear both auth cookies — used on logout and refresh failure. */
export async function clearAuthCookies(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
  store.delete(REFRESH_COOKIE_NAME);
}

// ---------------------------------------------------------------------------
// Token extraction (used by proxy + Server Actions on login/refresh responses)
// ---------------------------------------------------------------------------

interface TokensInBody {
  accessToken?: string;
  refreshToken?: string;
}

interface AuthResponseBody {
  data?: TokensInBody;
}

/**
 * Read access + refresh tokens from a backend auth response body.
 * Returns the tokens if present, otherwise `null`. Never throws on shape issues.
 */
export function readAuthTokens(parsed: unknown): TokensInBody | null {
  if (parsed === null || typeof parsed !== "object") return null;
  const body = parsed as AuthResponseBody & TokensInBody;
  const tokens: TokensInBody = {};
  const access = body.data?.accessToken ?? body.accessToken;
  const refresh = body.data?.refreshToken ?? body.refreshToken;
  if (typeof access === "string") tokens.accessToken = access;
  if (typeof refresh === "string") tokens.refreshToken = refresh;
  return tokens.accessToken || tokens.refreshToken ? tokens : null;
}

/**
 * Strip the access token from a parsed auth response body before forwarding it
 * to the browser. The token must never reach the client — only the cookie does.
 */
function stripTokensFromResponse(parsed: Record<string, unknown>): Record<string, unknown> {
  const data = parsed.data as Record<string, unknown> | undefined;
  if (!data) return parsed;
  const { accessToken: _accessToken, refreshToken: _refreshToken, ...safeData } = data;
  return { ...parsed, data: safeData };
}

/**
 * High-level helper: parse a JSON auth response body, extract tokens, persist
 * the cookies, and return the sanitized body (without `accessToken` /
 * `refreshToken`). Used by the proxy on `/login` and `/refresh`.
 *
 * Returns `{ body, cookiesSet }` — `cookiesSet` is `false` if the response
 * was unsuccessful or the body had no tokens (caller passes through unchanged).
 */
export async function persistTokensFromAuthResponse(
  rawBody: string,
  upstreamOk: boolean,
  options: { rememberMe?: boolean } = {}
): Promise<{ body: string; cookiesSet: boolean }> {
  if (!upstreamOk) {
    return { body: rawBody, cookiesSet: false };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { body: rawBody, cookiesSet: false };
  }

  const tokens = readAuthTokens(parsed);
  if (!tokens?.accessToken) {
    return { body: rawBody, cookiesSet: false };
  }

  await setSessionCookie(tokens.accessToken);
  if (tokens.refreshToken) {
    await setRefreshCookie(tokens.refreshToken, options);
  }

  const safeBody = stripTokensFromResponse(parsed);
  return { body: JSON.stringify(safeBody), cookiesSet: true };
}
