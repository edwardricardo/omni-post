/**
 * Universal Backend Proxy -- Route Handler
 *
 * All client-side API calls go through this proxy instead of hitting the
 * backend directly. The server reads the httpOnly `session` cookie and
 * injects an `Authorization: Bearer <token>` header before forwarding
 * the request to the real API.
 *
 * For auth endpoints (login, refresh), the proxy intercepts the response
 * body, extracts the accessToken, and sets it as an httpOnly cookie so
 * the browser NEVER sees the JWT.
 *
 * For logout, the proxy clears the session cookie.
 *
 * Usage:
 *   fetch("/api/backend/posts")        -> GET  http://localhost:3000/posts
 *   fetch("/api/backend/auth/customer/me")      -> GET  http://localhost:3000/auth/customer/me
 *   fetch("/api/backend/auth/customer/login")   -> POST http://localhost:3000/auth/customer/login
 *
 * Cookie: "customer-session" (httpOnly, secure in production, sameSite=lax)
 *
 * @module app/api/backend/[...path]/route
 */

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:3000";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// Session cookie configuration
const SESSION_COOKIE_NAME = "customer-session";
const SESSION_MAX_AGE = 15 * 60; // 15 minutes (matches typical JWT access token TTL)
const REFRESH_COOKIE_NAME = "customer-refresh";
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

// Auth paths that require special cookie handling (CustomerUser endpoints)
const AUTH_LOGIN_PATH = "auth/customer/login";
const AUTH_REFRESH_PATH = "auth/customer/refresh";
const AUTH_LOGOUT_PATH = "auth/customer/logout";
const AUTH_REGISTER_PATH = "auth/customer/register";

/**
 * Set an httpOnly session cookie with the access token
 */
async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
}

/**
 * Set an httpOnly refresh token cookie
 */
async function setRefreshCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "lax",
    maxAge: REFRESH_MAX_AGE,
    path: "/",
  });
}

/**
 * Clear all auth-related cookies
 */
async function clearAuthCookies(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  cookieStore.delete(REFRESH_COOKIE_NAME);
}

/**
 * Build a sanitized response body for auth endpoints.
 * Strips the accessToken from the response so it never reaches the browser.
 */
function stripTokenFromResponse(parsed: Record<string, unknown>): Record<string, unknown> {
  const data = parsed.data as Record<string, unknown> | undefined;
  if (!data) return parsed;

  // Remove accessToken from the response body -- the cookie holds it now
  const { accessToken: _accessToken, ...safeData } = data;
  return { ...parsed, data: safeData };
}

/**
 * Handle login/register response: extract accessToken, set cookies, strip token from body
 */
async function handleAuthTokenResponse(
  text: string,
  upstream: Response
): Promise<{ body: string; cookiesSet: boolean }> {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const data = parsed.data as Record<string, unknown> | undefined;

    // Only process successful responses with an accessToken
    if (upstream.ok && data && typeof data.accessToken === "string") {
      await setSessionCookie(data.accessToken);

      // If the backend also returned a refreshToken in the body, store it
      if (typeof data.refreshToken === "string") {
        await setRefreshCookie(data.refreshToken);
      }

      const safeBody = stripTokenFromResponse(parsed);
      return { body: JSON.stringify(safeBody), cookiesSet: true };
    }

    return { body: text, cookiesSet: false };
  } catch {
    // If parsing fails, pass through unchanged
    return { body: text, cookiesSet: false };
  }
}

/**
 * Handle refresh response: update session cookie with new accessToken
 */
async function handleRefreshResponse(
  text: string,
  upstream: Response
): Promise<{ body: string; cookiesSet: boolean }> {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const data = parsed.data as Record<string, unknown> | undefined;

    if (upstream.ok && data && typeof data.accessToken === "string") {
      await setSessionCookie(data.accessToken);

      // If a new refresh token was issued, update that cookie too
      if (typeof data.refreshToken === "string") {
        await setRefreshCookie(data.refreshToken);
      }

      const safeBody = stripTokenFromResponse(parsed);
      return { body: JSON.stringify(safeBody), cookiesSet: true };
    }

    // If refresh failed (401), clear session cookies
    if (!upstream.ok && upstream.status === 401) {
      await clearAuthCookies();
    }

    return { body: text, cookiesSet: false };
  } catch {
    return { body: text, cookiesSet: false };
  }
}

async function proxy(req: NextRequest, segments: string[]): Promise<NextResponse> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE_NAME);
  const refreshCookie = cookieStore.get(REFRESH_COOKIE_NAME);

  const path = segments.join("/");

  // Reconstruct target URL, forwarding any query string parameters
  const targetUrl = new URL(`/${path}`, API_URL);
  req.nextUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value);
  });

  // Build forwarded headers -- inject Bearer token if session cookie exists
  const headers = new Headers();
  const contentType = req.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);
  if (session) headers.set("Authorization", `Bearer ${session.value}`);

  // Do not forward body for GET/HEAD -- use conditional spreading to satisfy
  // exactOptionalPropertyTypes (body must not be explicitly undefined)
  const hasBody = !["GET", "HEAD"].includes(req.method);
  let bodyText: string | null = null;

  if (hasBody) {
    bodyText = await req.text();

    // For refresh and logout, inject the refresh token from cookie into the body
    // if the client did not provide one (the client no longer has access to it)
    if (path === AUTH_REFRESH_PATH || path === AUTH_LOGOUT_PATH) {
      bodyText = injectRefreshToken(bodyText, refreshCookie?.value);
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl.toString(), {
      method: req.method,
      headers,
      ...(hasBody && bodyText !== null && { body: bodyText }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Backend unavailable" }, { status: 503 });
  }

  const responseText = await upstream.text();

  // Route-specific cookie handling
  if (path === AUTH_LOGIN_PATH || path === AUTH_REGISTER_PATH) {
    const { body } = await handleAuthTokenResponse(responseText, upstream);
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  }

  if (path === AUTH_REFRESH_PATH) {
    const { body } = await handleRefreshResponse(responseText, upstream);
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  }

  if (path === AUTH_LOGOUT_PATH) {
    await clearAuthCookies();
    return new NextResponse(responseText, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  }

  // Default pass-through for non-auth routes
  return new NextResponse(responseText, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    },
  });
}

/**
 * Inject the refresh token from the httpOnly cookie into the request body
 * for refresh/logout calls. The client cannot read the cookie, so the proxy
 * adds it before forwarding to the backend.
 */
function injectRefreshToken(bodyText: string, refreshToken: string | undefined): string {
  if (!refreshToken) return bodyText;

  try {
    const parsed = JSON.parse(bodyText || "{}") as Record<string, unknown>;

    // Only inject if not already present in the body
    if (!parsed.refreshToken) {
      return JSON.stringify({ ...parsed, refreshToken });
    }

    return bodyText;
  } catch {
    // If body is not valid JSON, create a new body with just the refresh token
    return JSON.stringify({ refreshToken });
  }
}

type RouteContext = { params: Promise<{ path: string[] }> };

const handler = (req: NextRequest, ctx: RouteContext): Promise<NextResponse> =>
  ctx.params.then(({ path }) => proxy(req, path));

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
