/**
 * @file route.ts
 * @description Universal Next.js backend proxy route handler — injects Bearer tokens from the
 *              httpOnly session cookie, manages cookie lifecycle on login/refresh/logout via the
 *              shared `lib/auth/sessionCookie` helpers (single source of truth for TTLs).
 * @layer infrastructure
 */
/**
 * Universal Backend Proxy -- Route Handler
 *
 * All client-side API calls go through this proxy instead of hitting the
 * backend directly. The server reads the httpOnly `session` cookie and
 * injects an `Authorization: Bearer <token>` header before forwarding
 * the request to the real API.
 *
 * For auth endpoints (login, refresh), the proxy intercepts the response
 * body, extracts the accessToken, and persists it as an httpOnly cookie via
 * the shared `sessionCookie` module so the browser NEVER sees the JWT.
 *
 * For logout, the proxy clears the session cookie via the shared helper.
 *
 * Usage:
 *   fetch("/api/backend/posts")        -> GET  http://localhost:3000/posts
 *   fetch("/api/backend/auth/customer/me")      -> GET  http://localhost:3000/auth/customer/me
 *   fetch("/api/backend/auth/customer/login")   -> POST http://localhost:3000/auth/customer/login
 *
 * Cookie names + TTLs live in `apps/client/lib/auth/sessionCookie.ts`.
 *
 * @module app/api/backend/[...path]/route
 */

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import {
  SESSION_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  clearAuthCookies,
  persistTokensFromAuthResponse,
} from "@/lib/auth/sessionCookie";
import { env } from "../../../../lib/env";
import { forwardedForHeaders } from "../../../../lib/http/forwardedFor";

const API_URL = env.API_URL ?? "http://localhost:3000";

// SSE streams (and any long-lived response) must never be statically optimized
// or cached — force this route dynamic so streamed bodies pass straight through.
export const dynamic = "force-dynamic";

// Auth paths that require special cookie handling (CustomerUser endpoints)
const AUTH_LOGIN_PATH = "auth/customer/login";
const AUTH_REFRESH_PATH = "auth/customer/refresh";
const AUTH_LOGOUT_PATH = "auth/customer/logout";
const AUTH_REGISTER_PATH = "auth/customer/register";

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

  // Relay the real client IP verbatim so the backend resolver hop-counts the
  // caller instead of collapsing every user to this portal's socket.
  for (const [key, value] of Object.entries(forwardedForHeaders(req.headers))) {
    headers.set(key, value);
  }

  // Do not forward body for GET/HEAD -- use conditional spreading to satisfy
  // exactOptionalPropertyTypes (body must not be explicitly undefined)
  const hasBody = !["GET", "HEAD"].includes(req.method);
  let bodyText: string | null = null;
  let rememberMe = false;

  if (hasBody) {
    bodyText = await req.text();

    // For refresh and logout, inject the refresh token from cookie into the body
    // if the client did not provide one (the client no longer has access to it)
    if (path === AUTH_REFRESH_PATH || path === AUTH_LOGOUT_PATH) {
      bodyText = injectRefreshToken(bodyText, refreshCookie?.value);
    }

    // Detect rememberMe on login so the refresh cookie is extended
    if (path === AUTH_LOGIN_PATH) {
      rememberMe = parseRememberMe(bodyText);
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

  // Stream SSE responses straight through. Reading the body via .text() (below)
  // never resolves for an open event stream, so the proxy would hang/buffer
  // forever. Detect text/event-stream and pass the ReadableStream through.
  const upstreamContentType = upstream.headers.get("Content-Type") ?? "";
  if (upstreamContentType.includes("text/event-stream") && upstream.body) {
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const responseText = await upstream.text();

  // Route-specific cookie handling
  if (path === AUTH_LOGIN_PATH || path === AUTH_REGISTER_PATH) {
    const { body } = await persistTokensFromAuthResponse(responseText, upstream.ok, {
      rememberMe,
    });
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  }

  if (path === AUTH_REFRESH_PATH) {
    const { body } = await persistTokensFromAuthResponse(responseText, upstream.ok);
    if (!upstream.ok && upstream.status === 401) {
      await clearAuthCookies();
    }
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

/** Read the `rememberMe` flag from a login request body. Defaults to `false`. */
function parseRememberMe(bodyText: string): boolean {
  try {
    const parsed = JSON.parse(bodyText || "{}") as Record<string, unknown>;
    return parsed.rememberMe === true;
  } catch {
    return false;
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
